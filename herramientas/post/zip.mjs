/**
 * Lector de las copias .zip que genera el panel (sin compresión, con ZIP64 si hace falta).
 * Extrae por bloques (memoria acotada) y comprueba el CRC de cada archivo.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const BLOQUE = 8 * 1024 * 1024;

const TABLA = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
/** CRC-32 acumulable; usa el de Node (en C) si existe, que es mucho más rápido. */
export function crc32(bytes, crc = 0) {
  if (zlib.crc32) return zlib.crc32(bytes, crc);
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABLA[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function leer(fd, posicion, largo) {
  const b = Buffer.alloc(largo);
  const n = fs.readSync(fd, b, 0, largo, posicion);
  return b.subarray(0, n);
}

/** Índice del zip: [{nombre, crc, bytes, datos (posición de los datos)}]. */
export function indiceZip(ruta) {
  const fd = fs.openSync(ruta, "r");
  try {
    const tamano = fs.fstatSync(fd).size;
    const cola = leer(fd, Math.max(0, tamano - 65_557), Math.min(tamano, 65_557));
    const pos = cola.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (pos < 0) throw new Error("no es un zip válido (falta el final)");
    const inicioCola = Math.max(0, tamano - 65_557);
    let total = cola.readUInt16LE(pos + 10);
    let tamanoCentral = cola.readUInt32LE(pos + 12);
    let inicioCentral = cola.readUInt32LE(pos + 16);
    if (total === 0xffff || tamanoCentral === 0xffffffff || inicioCentral === 0xffffffff) {
      const loc = leer(fd, inicioCola + pos - 20, 20);
      if (loc.readUInt32LE(0) !== 0x07064b50) throw new Error("zip de más de 4 GB sin localizador ZIP64");
      const r = leer(fd, Number(loc.readBigUInt64LE(8)), 56);
      if (r.readUInt32LE(0) !== 0x06064b50) throw new Error("registro ZIP64 dañado");
      total = Number(r.readBigUInt64LE(32));
      tamanoCentral = Number(r.readBigUInt64LE(40));
      inicioCentral = Number(r.readBigUInt64LE(48));
    }
    const c = leer(fd, inicioCentral, tamanoCentral);
    const entradas = [];
    let o = 0;
    for (let i = 0; i < total; i++) {
      if (c.readUInt32LE(o) !== 0x02014b50) throw new Error("directorio del zip dañado");
      const metodo = c.readUInt16LE(o + 10);
      const crc = c.readUInt32LE(o + 16);
      let bytes = c.readUInt32LE(o + 20);
      let sinComprimir = c.readUInt32LE(o + 24);
      const largoNombre = c.readUInt16LE(o + 28);
      const largoExtra = c.readUInt16LE(o + 30);
      const largoComentario = c.readUInt16LE(o + 32);
      let offset = c.readUInt32LE(o + 42);
      const nombre = c.subarray(o + 46, o + 46 + largoNombre).toString("utf8");
      // Campo extra ZIP64: en orden, los valores que valen 0xFFFFFFFF en la cabecera.
      let e = o + 46 + largoNombre;
      const finExtra = e + largoExtra;
      while (e + 4 <= finExtra) {
        const id = c.readUInt16LE(e), largo = c.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let k = e + 4;
          if (sinComprimir === 0xffffffff) { sinComprimir = Number(c.readBigUInt64LE(k)); k += 8; }
          if (bytes === 0xffffffff) { bytes = Number(c.readBigUInt64LE(k)); k += 8; }
          if (offset === 0xffffffff) { offset = Number(c.readBigUInt64LE(k)); }
        }
        e += 4 + largo;
      }
      if (metodo !== 0) throw new Error(`${nombre}: está comprimido; esta herramienta solo lee las copias que genera MR · Chronicle`);
      const local = leer(fd, offset, 30);
      if (local.readUInt32LE(0) !== 0x04034b50) throw new Error(`${nombre}: cabecera dañada`);
      entradas.push({ nombre, crc, bytes, datos: offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28) });
      o += 46 + largoNombre + largoExtra + largoComentario;
    }
    return entradas;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Extrae el zip en `destino`, quitando la primera carpeta (la de la sesión): queda
 * `destino/<participante>/<archivos>`. Devuelve las carpetas de participante creadas y los
 * archivos cuyo CRC no coincide (dañados).
 */
export function extraerZip(ruta, destino) {
  const entradas = indiceZip(ruta);
  const fd = fs.openSync(ruta, "r");
  const carpetas = new Set();
  const danados = [];
  try {
    for (const e of entradas) {
      if (e.nombre.endsWith("/")) continue;
      const partes = e.nombre.split("/").filter(Boolean);
      if (partes.length < 2 || partes.some(p => p === ".." || p.includes("\\"))) throw new Error(`nombre no permitido en el zip: ${e.nombre}`);
      const relativo = partes.slice(1).join("/");
      const final = path.resolve(destino, relativo);
      if (!final.startsWith(path.resolve(destino) + path.sep)) throw new Error(`nombre no permitido en el zip: ${e.nombre}`);
      fs.mkdirSync(path.dirname(final), { recursive: true });
      carpetas.add(path.resolve(destino, partes[1]));
      const salida = fs.openSync(final, "w");
      let crc = 0;
      try {
        for (let hecho = 0; hecho < e.bytes; hecho += BLOQUE) {
          const trozo = leer(fd, e.datos + hecho, Math.min(BLOQUE, e.bytes - hecho));
          crc = crc32(trozo, crc);
          fs.writeSync(salida, trozo);
        }
      } finally {
        fs.closeSync(salida);
      }
      if (crc !== e.crc) danados.push(relativo);
    }
  } finally {
    fs.closeSync(fd);
  }
  return { carpetas: [...carpetas], danados };
}
