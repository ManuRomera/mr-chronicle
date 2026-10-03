/**
 * Funciones puras de la postproducción (sin archivos ni procesos): se prueban en test/.
 */

/** NDJSON tolerante: una línea rota al final (corte a mitad de escritura) se ignora. */
export function leerNDJSON(texto) {
  return texto.split("\n").filter(Boolean).flatMap(l => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
}

export const mediana = xs => {
  const o = [...xs].sort((x, y) => x - y);
  return o.length ? o[Math.floor(o.length / 2)] : NaN;
};

/**
 * Reinicios del servidor de Foundry: su hora (serverMs) vuelve a cero, pero el reloj del equipo
 * (epochMs) no. La diferencia epochMs − serverMs es casi constante mientras no haya reinicio; si
 * salta, esa ancla (o marcador, o evento de música) se devuelve a la base de la primera época.
 * Funciona aunque el reinicio pase en mitad de un tramo.
 * @returns {{reinicios: boolean, corregir: (x: object) => object}}
 */
export function corregirReinicios(anclas, { umbralMs = 2000 } = {}) {
  const con = anclas.filter(a => Number.isFinite(a?.epochMs) && Number.isFinite(a?.serverMs))
    .sort((x, y) => x.epochMs - y.epochMs);
  if (!con.length) return { reinicios: false, corregir: x => x };
  const d0 = con[0].epochMs - con[0].serverMs;
  const ref = mediana(con.map(a => a.epochMs - a.serverMs).filter(d => Math.abs(d - d0) <= umbralMs));
  return {
    reinicios: con.some(a => Math.abs(a.epochMs - a.serverMs - ref) > umbralMs),
    corregir: x => {
      if (!Number.isFinite(x?.epochMs) || !Number.isFinite(x?.serverMs)) return x;
      const d = x.epochMs - x.serverMs;
      return Math.abs(d - ref) > umbralMs ? { ...x, serverMs: x.serverMs + (d - ref) } : x;
    }
  };
}

/**
 * Recta serverMs = a + b·frame por mínimos cuadrados.
 * Descarta las anclas con ida y vuelta alta (medidas peores) y avisa si queda un residuo
 * grande, que indica muestras perdidas.
 * ponytail: una sola recta por tramo. Si aparecen huecos reales, partir el tramo en el hueco.
 */
export function regresion(anclas, { toleranciaMs = 20 } = {}) {
  if (anclas.length < 2) throw new Error("Hacen falta al menos dos anclas para calcular la deriva.");
  const rtts = anclas.map(a => a.rttMs).sort((x, y) => x - y);
  const mediana = rtts[Math.floor(rtts.length / 2)];
  let buenas = anclas.filter(a => a.rttMs <= Math.max(2 * mediana, mediana + 20));
  if (buenas.length < 2) buenas = anclas;

  const n = buenas.length;
  const mx = buenas.reduce((s, a) => s + a.frame, 0) / n;
  const my = buenas.reduce((s, a) => s + a.serverMs, 0) / n;
  let sxy = 0, sxx = 0;
  for (const a of buenas) { sxy += (a.frame - mx) * (a.serverMs - my); sxx += (a.frame - mx) ** 2; }
  const b = sxx ? sxy / sxx : 1000 / 48000;
  const a = my - b * mx;
  const residuos = buenas.map(p => p.serverMs - (a + b * p.frame));
  const residuoMax = Math.max(...residuos.map(Math.abs));
  return {
    a, b,
    fsReal: 1000 / b,
    residuoMax,
    anclasUsadas: n,
    anclasTotales: anclas.length,
    hueco: residuoMax > toleranciaMs
  };
}

const normalizar = t => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9ñ\s]/g, " ").replace(/\s+/g, " ").trim();

/** Frases que Whisper se inventa en los silencios (sobre todo en castellano). */
export const ALUCINACIONES = [
  "subtitulos realizados por la comunidad de amara org",
  "subtitulos por la comunidad de amara org",
  "gracias por ver el video",
  "gracias por ver",
  "suscribete",
  "no olvides suscribirte",
  "musica"
];

export function esAlucinacion(texto) {
  const t = normalizar(texto);
  return !t || ALUCINACIONES.some(a => t === a || (t.includes(a) && a.split(" ").length >= 3));
}

const palabras = t => new Set(normalizar(t).split(" ").filter(Boolean));
function parecido(x, y) {
  const a = palabras(x), b = palabras(y);
  if (a.size < 3 || b.size < 3) return 0;
  let comun = 0;
  for (const p of a) if (b.has(p)) comun++;
  return comun / (a.size + b.size - comun);
}

/**
 * Eco: el micro de alguien sin cascos recoge a otro. Si dos hablantes distintos dicen casi lo
 * mismo casi a la vez, el de menor confianza se marca como eco.
 */
export function marcarEcos(segmentos, { ventanaMs = 2000, umbral = 0.7 } = {}) {
  const orden = [...segmentos].sort((x, y) => x.startMs - y.startMs);
  for (let i = 0; i < orden.length; i++) {
    for (let j = i + 1; j < orden.length && orden[j].startMs - orden[i].startMs <= ventanaMs; j++) {
      const [x, y] = [orden[i], orden[j]];
      if (x.participantId === y.participantId || parecido(x.text, y.text) < umbral) continue;
      const eco = (x.confidence ?? 0) >= (y.confidence ?? 0) ? y : x;
      if (!eco.flags.includes("posible-eco")) eco.flags.push("posible-eco");
    }
  }
  return orden;
}

/** Segmentos de whisper.cpp (-ojf) → segmentos de sesión, desplazados a la línea común. */
export function segmentosWhisper(json, base) {
  return (json.transcription ?? []).map(s => {
    const ps = (s.tokens ?? []).map(t => t.p).filter(Number.isFinite);
    const texto = s.text.trim();
    return {
      schemaVersion: 1,
      ...base,
      startMs: s.offsets.from,
      endMs: s.offsets.to,
      text: texto,
      confidence: ps.length ? Math.round((ps.reduce((a, b) => a + b, 0) / ps.length) * 100) / 100 : null,
      flags: esAlucinacion(texto) ? ["alucinacion"] : []
    };
  });
}

const dos = n => String(n).padStart(2, "0");
export function reloj(ms, { milis = false, coma = false } = {}) {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000), m = Math.floor(t / 60_000) % 60, s = Math.floor(t / 1000) % 60;
  const base = `${dos(h)}:${dos(m)}:${dos(s)}`;
  return milis ? `${base}${coma ? "," : "."}${String(t % 1000).padStart(3, "0")}` : base;
}

const visibles = segs => segs.filter(s => !s.flags.length);
const quien = s => s.character && s.character !== s.speaker ? `${s.speaker} (${s.character})` : s.speaker;

export function transcripcionMD(segmentos, titulo) {
  const lineas = [`# ${titulo}`, ""];
  let anterior = null;
  for (const s of visibles(segmentos)) {
    if (anterior && anterior.participantId === s.participantId && s.startMs - anterior.endMs < 3000) {
      lineas[lineas.length - 1] += ` ${s.text}`;
    } else {
      lineas.push("", `\`${reloj(s.startMs)}\` **${quien(s)}:** ${s.text}`);
    }
    anterior = s;
  }
  return lineas.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

export function subtitulosSRT(segmentos) {
  return visibles(segmentos).map((s, i) =>
    `${i + 1}\n${reloj(s.startMs, { milis: true, coma: true })} --> ${reloj(s.endMs, { milis: true, coma: true })}\n${s.speaker}: ${s.text}\n`
  ).join("\n");
}

/** Pista de etiquetas de Audacity: inicio<TAB>fin<TAB>texto, en segundos. */
export function etiquetasAudacity(marcadores) {
  return marcadores.map(m => `${(m.ms / 1000).toFixed(3)}\t${(m.ms / 1000).toFixed(3)}\t${m.etiqueta}`).join("\n") + "\n";
}

/** Tramos con voz a partir de la salida de `ffmpeg -af silencedetect` (stderr), en ms. */
export function tramosDeVoz(salida, duracionMs) {
  const tramos = [];
  let desde = 0;
  for (const linea of salida.split("\n")) {
    const ini = linea.match(/silence_start: (-?[\d.]+)/);
    const fin = linea.match(/silence_end: ([\d.]+)/);
    if (ini) { const t = Math.max(0, Number(ini[1]) * 1000); if (t > desde) tramos.push([desde, t]); desde = null; }
    if (fin) desde = Number(fin[1]) * 1000;
  }
  if (desde !== null && desde < duracionMs) tramos.push([desde, duracionMs]);
  return tramos;
}

/**
 * Whisper sitúa el inicio de una frase al principio de su ventana de 30 s si antes hubo
 * silencio. Se recorta cada segmento a la voz que de verdad hay debajo; si no hay ninguna,
 * se lo ha inventado.
 */
export function ajustarAVoz(segmentos, tramos) {
  for (const s of segmentos) {
    const debajo = tramos.filter(([a, b]) => a < s.endMs && b > s.startMs);
    if (!debajo.length) { if (!s.flags.includes("alucinacion")) s.flags.push("sin-voz"); continue; }
    // La frase termina en el primer silencio largo: lo que sigue es otra intervención.
    let fin = debajo[0][1];
    for (const [a, b] of debajo.slice(1)) { if (a - fin > 2000) break; fin = b; }
    s.startMs = Math.round(Math.max(s.startMs, debajo[0][0]));
    s.endMs = Math.round(Math.min(s.endMs, fin));
  }
  return segmentos;
}

/** Correcciones fijas de nombres propios que Whisper escribe mal: {"Strath": "Strahd"}. */
const compiladas = new WeakMap(); // las expresiones se construyen una vez por lista de correcciones
export function corregir(texto, correcciones = {}) {
  let reglas = compiladas.get(correcciones);
  if (!reglas) {
    reglas = Object.entries(correcciones).map(([mal, bien]) =>
      [new RegExp(`(?<![\\p{L}])${mal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "gu"), bien]);
    compiladas.set(correcciones, reglas);
  }
  let t = texto;
  for (const [re, bien] of reglas) t = t.replace(re, bien);
  return t;
}
