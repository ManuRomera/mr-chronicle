/**
 * Funciones puras de la postproducción (sin archivos ni procesos): se prueban en test/.
 */

/** NDJSON tolerante: una línea rota al final (corte a mitad de escritura) se ignora. */
export function leerNDJSON(texto) {
  return texto.split("\n").filter(Boolean).flatMap(l => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
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
