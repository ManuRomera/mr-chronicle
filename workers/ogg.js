/**
 * Escritor mínimo de Ogg Opus: una página por paquete (la sobrecarga es ~1,4 KB/s, despreciable).
 * Los trozos de 60 s son pedazos consecutivos de un único flujo Ogg: pegados en orden forman un
 * archivo válido, y si el navegador muere a mitad, ffmpeg tolera el final cortado.
 */
export const PRE_SKIP = 312; // retardo de libopus a 48 kHz; se descuenta al decodificar

const TABLA = new Uint32Array(256).map((_, i) => {
  let r = i << 24;
  for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
  return r >>> 0;
});
function crc(bytes) {
  let c = 0;
  for (const b of bytes) c = ((c << 8) ^ TABLA[((c >>> 24) ^ b) & 0xff]) >>> 0;
  return c;
}

export class FlujoOgg {
  constructor(canales) {
    this.canales = canales;
    this.serie = (Math.random() * 0xffffffff) >>> 0;
    this.secuencia = 0;
  }

  pagina(paquete, granulo, tipo = 0) {
    const lacing = [];
    let resto = paquete.length;
    while (resto >= 255) { lacing.push(255); resto -= 255; }
    lacing.push(resto);
    const p = new Uint8Array(27 + lacing.length + paquete.length);
    const v = new DataView(p.buffer);
    p.set([0x4f, 0x67, 0x67, 0x53]); // OggS
    v.setUint8(5, tipo);
    v.setBigInt64(6, BigInt(granulo), true);
    v.setUint32(14, this.serie, true);
    v.setUint32(18, this.secuencia++, true);
    v.setUint8(26, lacing.length);
    p.set(lacing, 27);
    p.set(paquete, 27 + lacing.length);
    v.setUint32(22, crc(p), true);
    return p;
  }

  cabeceras() {
    const cabeza = new Uint8Array(19);
    const v = new DataView(cabeza.buffer);
    cabeza.set(new TextEncoder().encode("OpusHead"));
    v.setUint8(8, 1);
    v.setUint8(9, this.canales);
    v.setUint16(10, PRE_SKIP, true);
    v.setUint32(12, 48000, true);
    const vendedor = new TextEncoder().encode("mr-chronicle");
    const etiquetas = new Uint8Array(8 + 4 + vendedor.length + 4);
    etiquetas.set(new TextEncoder().encode("OpusTags"));
    new DataView(etiquetas.buffer).setUint32(8, vendedor.length, true);
    etiquetas.set(vendedor, 12);
    return [this.pagina(cabeza, 0, 0x02), this.pagina(etiquetas, 0)];
  }
}
