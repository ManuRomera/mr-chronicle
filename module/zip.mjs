/**
 * Zip mínimo sin compresión («store») para la copia de una grabación.
 *
 * - Sin compresión: el audio apenas se comprime y así no se gasta CPU.
 * - Archivo a archivo: cada trozo (≤ 12 MB) se lee entero para calcular su CRC y se escribe;
 *   nunca hay en memoria más de un trozo, aunque la grabación ocupe gigas.
 * - ZIP64 en cuanto algo pasa de 4 GB (una sesión muy larga del máster).
 * - Sin dependencias de Foundry: se prueba en Node (herramientas/post/test).
 */

const TABLA = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** CRC-32 (el de zip), acumulable por bloques. */
export function crc32(bytes, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABLA[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function fechaDos(d = new Date()) {
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    dia: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

/**
 * @param {(bytes: Uint8Array) => Promise<void>} escribir  destino (p. ej. un FileSystemWritableFileStream)
 * @param {{nombre: string, archivo: Blob}[]} entradas
 * @param {object} [o]
 * @param {(hechos: number, total: number) => void} [o.progreso]
 * @param {number} [o.limite]  a partir de qué valor se usa ZIP64 (solo se cambia en las pruebas)
 * @returns {Promise<{nombre: string, bytes: number, crc32: number}[]>} lo que se ha escrito
 */
export async function escribirZip(escribir, entradas, { progreso = () => {}, limite = 0xffffffff } = {}) {
  const { hora, dia } = fechaDos();
  const utf8 = new TextEncoder();
  const central = [];
  const hecho = [];
  let posicion = 0;
  const salida = async bytes => { await escribir(bytes); posicion += bytes.length; };

  for (const [i, { nombre, archivo }] of entradas.entries()) {
    const datos = new Uint8Array(await archivo.arrayBuffer());
    const crc = crc32(datos);
    const nombreBytes = utf8.encode(nombre);
    const offset = posicion;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);            // versión necesaria
    local.setUint16(6, 0x0800, true);        // nombres en UTF-8
    local.setUint16(8, 0, true);             // sin compresión
    local.setUint16(10, hora, true);
    local.setUint16(12, dia, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, datos.length, true);
    local.setUint32(22, datos.length, true);
    local.setUint16(26, nombreBytes.length, true);
    await salida(new Uint8Array(local.buffer));
    await salida(nombreBytes);
    await salida(datos);

    central.push({ nombreBytes, crc, bytes: datos.length, offset });
    hecho.push({ nombre, bytes: datos.length, crc32: crc });
    progreso(i + 1, entradas.length);
  }

  // Directorio central.
  const inicioCentral = posicion;
  for (const e of central) {
    const zip64 = e.offset >= limite;
    const extra = zip64 ? 12 : 0;
    const v = new DataView(new ArrayBuffer(46 + extra));
    v.setUint32(0, 0x02014b50, true);
    v.setUint16(4, zip64 ? 45 : 20, true);   // versión que lo creó
    v.setUint16(6, zip64 ? 45 : 20, true);   // versión necesaria
    v.setUint16(8, 0x0800, true);
    v.setUint16(10, 0, true);
    v.setUint16(12, hora, true);
    v.setUint16(14, dia, true);
    v.setUint32(16, e.crc, true);
    v.setUint32(20, e.bytes, true);
    v.setUint32(24, e.bytes, true);
    v.setUint16(28, e.nombreBytes.length, true);
    v.setUint16(30, extra, true);
    v.setUint32(42, zip64 ? 0xffffffff : e.offset, true);
    if (zip64) {
      v.setUint16(46, 0x0001, true);         // campo extra ZIP64: solo el desplazamiento
      v.setUint16(48, 8, true);
      v.setBigUint64(50, BigInt(e.offset), true);
    }
    const bytes = new Uint8Array(v.buffer);
    await salida(bytes.subarray(0, 46));
    await salida(e.nombreBytes);
    if (zip64) await salida(bytes.subarray(46));
  }
  const tamanoCentral = posicion - inicioCentral;

  const necesita64 = central.length > 0xfffe || inicioCentral >= limite || tamanoCentral >= limite;
  if (necesita64) {
    const inicio64 = posicion;
    const r = new DataView(new ArrayBuffer(56));
    r.setUint32(0, 0x06064b50, true);
    r.setBigUint64(4, 44n, true);
    r.setUint16(12, 45, true);
    r.setUint16(14, 45, true);
    r.setBigUint64(24, BigInt(central.length), true);
    r.setBigUint64(32, BigInt(central.length), true);
    r.setBigUint64(40, BigInt(tamanoCentral), true);
    r.setBigUint64(48, BigInt(inicioCentral), true);
    await salida(new Uint8Array(r.buffer));
    const l = new DataView(new ArrayBuffer(20));
    l.setUint32(0, 0x07064b50, true);
    l.setBigUint64(8, BigInt(inicio64), true);
    l.setUint32(16, 1, true);
    await salida(new Uint8Array(l.buffer));
  }
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, necesita64 ? 0xffff : central.length, true);
  fin.setUint16(10, necesita64 ? 0xffff : central.length, true);
  fin.setUint32(12, necesita64 ? 0xffffffff : tamanoCentral, true);
  fin.setUint32(16, necesita64 ? 0xffffffff : inicioCentral, true);
  await salida(new Uint8Array(fin.buffer));
  return hecho;
}
