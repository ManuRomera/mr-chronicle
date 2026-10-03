/**
 * Lectura mínima de páginas Ogg Opus, para encontrar los trozos que faltan en una pista de Foundry.
 * El módulo escribe un paquete por página, con el gránulo acumulado (PRE_SKIP + muestras): si el
 * número de secuencia salta, el gránulo dice cuántas muestras se perdieron.
 */

/** Páginas de un búfer: número de secuencia y gránulo de cada una. */
export function paginas(buf) {
  const r = [];
  let o = 0;
  while (o + 27 <= buf.length && buf.toString("latin1", o, o + 4) === "OggS") {
    const n = buf[o + 26];
    if (o + 27 + n > buf.length) break;
    let datos = 0;
    for (let i = 0; i < n; i++) datos += buf[o + 27 + i];
    const total = 27 + n + datos;
    if (o + total > buf.length) break; // página cortada al final: no cuenta
    r.push({ seq: buf.readUInt32LE(o + 18), granulo: Number(buf.readBigInt64LE(o + 6)), o, total });
    o += total;
  }
  return r;
}

/** Cabecera OpusHead de la primera página: canales y retardo del codificador. */
export function cabeceraOpus(buf) {
  const base = buf.indexOf("OpusHead");
  if (base < 0) throw new Error("no es un Ogg Opus (falta OpusHead)");
  return { canales: buf[base + 9], preSkip: buf.readUInt16LE(base + 10) };
}

/**
 * Huecos de una pista: [{pos, muestras}] con `pos` en muestras de la salida decodificada
 * (ya descontado el retardo del codificador) y `muestras` lo que falta.
 * @param {Buffer[]} trozos  en orden de número de trozo
 */
export function huecosOgg(trozos, preSkip) {
  const todas = trozos.flatMap(t => paginas(t)).filter(p => p.granulo > 0);
  const huecos = [];
  for (let i = 1; i < todas.length; i++) {
    const antes = todas[i - 1], p = todas[i];
    if (p.seq === antes.seq + 1) continue;
    // Lo que dura la página de después de un hueco se mide con la siguiente (un paquete por página).
    const dur = todas[i + 1] && todas[i + 1].seq === p.seq + 1 ? todas[i + 1].granulo - p.granulo : 960;
    const muestras = p.granulo - antes.granulo - dur;
    if (muestras > 0) huecos.push({ pos: antes.granulo - preSkip, muestras });
  }
  return huecos;
}
