#!/usr/bin/env node
/**
 * Postproducción de MR · Chronicle.
 *
 *   node herramientas/post/mr-chronicle-post.mjs <carpeta-sesion> [opciones]
 *
 * <carpeta-sesion> es lo que dejan las entregas en el servidor: Data/mr-chronicle/<sesion>/,
 * con una subcarpeta por participante.
 *
 * Opciones:
 *   --salida <dir>     Carpeta de resultados (por defecto <carpeta-sesion>/salida)
 *   --config <json>    Ajustes de campaña (ver campana.ejemplo.json)
 *   --sin-ruido        No limpiar el ruido
 *   --sin-whisper      No transcribir
 *
 * Necesita ffmpeg; para limpiar, deep-filter (DeepFilterNet); para transcribir, whisper-cli.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import {
  leerNDJSON, regresion, segmentosWhisper, marcarEcos,
  transcripcionMD, subtitulosSRT, etiquetasAudacity, reloj
} from "./lib.mjs";

const { values: op, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    salida: { type: "string" },
    config: { type: "string" },
    "sin-ruido": { type: "boolean", default: false },
    "sin-whisper": { type: "boolean", default: false }
  }
});
if (!positionals[0]) {
  console.error("Uso: mr-chronicle-post <carpeta-sesion> [--salida dir] [--config campana.json] [--sin-ruido] [--sin-whisper]");
  process.exit(1);
}

const SESION = path.resolve(positionals[0]);
const SALIDA = path.resolve(op.salida ?? path.join(SESION, "salida"));
const TMP = path.join(SALIDA, ".tmp");
const config = op.config ? JSON.parse(fs.readFileSync(op.config, "utf8")) : {};
const casa = r => r?.replace(/^~(?=\/|$)/, os.homedir());
const MODELO = casa(config.modelo ?? process.env.MR_CHRONICLE_MODELO ?? "~/.cache/mr-chronicle/ggml-large-v3-turbo.bin");
if (config.vad) config.vad = casa(config.vad);
const avisos = [];
const aviso = t => { avisos.push(t); console.warn(`⚠ ${t}`); };
const paso = t => console.log(`\n▸ ${t}`);

const hay = bin => { try { execFileSync("which", [bin], { stdio: "ignore" }); return true; } catch { return false; } };
const ejecutar = (bin, args) => execFileSync(bin, args, { stdio: ["ignore", "ignore", "pipe"], maxBuffer: 1 << 26 });
const slug = t => t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");

if (!hay("ffmpeg")) { console.error("Falta ffmpeg (brew install ffmpeg)."); process.exit(1); }
fs.mkdirSync(path.join(SALIDA, "stems"), { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

// ─── 1. Leer las entregas ─────────────────────────────────────────────────

paso("Leyendo entregas");
const participantes = [];
for (const userId of fs.readdirSync(SESION).sort()) {
  const dir = path.join(SESION, userId);
  if (!fs.statSync(dir).isDirectory() || userId === path.basename(SALIDA)) continue;
  const archivos = fs.readdirSync(dir);
  const manifiesto = archivos.includes("manifiesto.json")
    ? JSON.parse(fs.readFileSync(path.join(dir, "manifiesto.json"), "utf8"))
    : null;
  if (!manifiesto) aviso(`${userId}: falta manifiesto.json (entrega incompleta). Se usa lo que haya.`);
  const tramos = {};
  for (const a of archivos) {
    const m = a.match(/^(voz|musica|ambiente|efectos)-(\d+)-(\d{6})\.wav$/);
    if (m) (tramos[`${m[1]}-${m[2]}`] ??= []).push(a);
  }
  const leer = n => fs.existsSync(path.join(dir, n)) ? leerNDJSON(fs.readFileSync(path.join(dir, n), "utf8")) : [];
  participantes.push({
    userId, dir, manifiesto,
    nombre: manifiesto?.usuario.nombre ?? userId,
    personaje: manifiesto?.usuario.personaje ?? null,
    tramos: Object.fromEntries(Object.entries(tramos).map(([k, v]) => [k, v.sort()])),
    marcadores: leer("marcadores.txt"),
    musica: leer("musica.txt"),
    leer
  });
  console.log(`  ${manifiesto?.usuario.nombre ?? userId}: ${Object.keys(tramos).join(", ") || "sin audio"}`);
}
if (!participantes.length) { console.error("No hay entregas en esa carpeta."); process.exit(1); }

const sesion = participantes.map(p => p.manifiesto?.sesion).find(Boolean) ?? { id: path.basename(SESION), nombre: path.basename(SESION) };
for (const p of participantes) {
  if (p.manifiesto && !p.manifiesto.consentimiento.publicar) aviso(`${p.nombre} NO ha aceptado que se publique su voz. No uses su pista en el podcast.`);
}

// ─── 2. Deriva y alineación ───────────────────────────────────────────────

paso("Calculando deriva");
const ajuste = p => config.ajustesMs?.[p.nombre] ?? config.ajustesMs?.[p.userId] ?? 0;
const tramos = [];
let reinicio = false;
for (const p of participantes) {
  // La hora del servidor de Foundry cuenta desde que se lanzó el mundo. Si el servidor se
  // reinició, los tramos siguientes vienen en otra base; el reloj del equipo lo delata.
  const diferencia = anclas => {
    const d = anclas.filter(a => Number.isFinite(a.epochMs)).map(a => a.epochMs - a.serverMs).sort((x, y) => x - y);
    return d.length ? d[Math.floor(d.length / 2)] : null;
  };
  const porNumero = Object.keys(p.tramos).sort((x, y) => Number(x.split("-")[1]) - Number(y.split("-")[1]));
  const referencia = porNumero.length ? diferencia(p.leer(`${porNumero[0]}-anclas.txt`)) : null;

  for (const [prefijo, trozos] of Object.entries(p.tramos)) {
    const cab = fs.readFileSync(path.join(p.dir, trozos[0])).subarray(0, 44);
    const canales = cab.readUInt16LE(22), fsNominal = cab.readUInt32LE(24);
    // No se usa el tamaño de la cabecera: si el navegador murió a mitad, estaría mal.
    const frames = trozos.map(t => (fs.statSync(path.join(p.dir, t)).size - 44) / (2 * canales));
    let anclas = p.leer(`${prefijo}-anclas.txt`);
    const d = diferencia(anclas);
    if (referencia !== null && d !== null && Math.abs(d - referencia) > 2000) {
      anclas = anclas.map(a => ({ ...a, serverMs: a.serverMs + (d - referencia) }));
      reinicio = true;
      aviso(`${p.nombre} ${prefijo}: el servidor de Foundry se reinició durante la sesión. Tramo recolocado con el reloj del equipo (precisión menor: revisa a oído).`);
    }
    let r;
    try { r = regresion(anclas); }
    catch (e) { aviso(`${p.nombre} ${prefijo}: ${e.message} Se omite.`); continue; }
    const ppm = (r.fsReal / fsNominal - 1) * 1e6;
    if (r.hueco) aviso(`${p.nombre} ${prefijo}: error residual de ${r.residuoMax.toFixed(0)} ms. Probablemente se perdieron muestras; revisa la alineación a oído.`);
    if (Math.abs(ppm) > 300) aviso(`${p.nombre} ${prefijo}: deriva de ${ppm.toFixed(0)} ppm, anormalmente alta.`);
    tramos.push({ p, prefijo, tipo: prefijo.split("-")[0], trozos, canales, fsNominal, frames: frames.reduce((a, b) => a + b, 0), r, ppm });
  }
}
if (!tramos.length) { console.error("Ningún tramo tiene anclas suficientes."); process.exit(1); }

const t0 = sesion.inicioServerMs ?? Math.min(...tramos.map(t => t.r.a));
const finTramos = Math.max(...tramos.map(t => t.r.a + t.r.b * t.frames));
const fin = reinicio ? finTramos : sesion.finServerMs ?? finTramos;
const duracion = (fin - t0) / 1000;
console.log(`  Sesión: ${reloj(duracion * 1000)}`);

paso("Alineando pistas");
for (const t of tramos) {
  const raw = path.join(TMP, `${t.p.userId}-${t.prefijo}.raw`);
  const fd = fs.openSync(raw, "w");
  for (const trozo of t.trozos) fs.writeSync(fd, fs.readFileSync(path.join(t.p.dir, trozo)).subarray(44));
  fs.closeSync(fd);
  const inicio = (t.r.a + ajuste(t.p) - t0) / 1000;
  t.alineado = path.join(TMP, `${t.p.userId}-${t.prefijo}.wav`);
  // Cada muestra recibe su instante real (frecuencia medida + inicio en la sesión) y
  // aresample la lleva a una rejilla exacta de 48 kHz, rellenando o recortando el principio.
  ejecutar("ffmpeg", ["-v", "error", "-y", "-f", "s16le", "-ar", String(t.fsNominal), "-ac", String(t.canales), "-i", raw,
    "-af", `asetpts=N/${t.r.fsReal}/TB+${inicio}/TB,aresample=48000:async=1000:first_pts=0,apad=whole_dur=${duracion},atrim=0:${duracion}`,
    "-c:a", "pcm_s16le", t.alineado]);
  fs.rmSync(raw);
  console.log(`  ${t.p.nombre} ${t.prefijo}: empieza en ${inicio.toFixed(3)} s · deriva ${t.ppm.toFixed(1)} ppm · residuo ${t.r.residuoMax.toFixed(1)} ms`);
}

// Varios tramos de una misma pista (alguien recargó el navegador): se juntan en una.
const pistas = new Map();
for (const t of tramos) {
  const clave = `${t.p.userId}|${t.tipo}`;
  if (!pistas.has(clave)) pistas.set(clave, { p: t.p, tipo: t.tipo, archivos: [] });
  pistas.get(clave).archivos.push(t.alineado);
}
const nombreStem = pista => pista.tipo === "voz" ? `voz-${slug(pista.p.nombre)}` : `foundry-${pista.tipo}`;
for (const pista of pistas.values()) {
  const bruto = path.join(SALIDA, "stems", `${nombreStem(pista)}${pista.tipo === "voz" ? ".bruta" : ""}.wav`);
  if (pista.archivos.length === 1) fs.renameSync(pista.archivos[0], bruto);
  else {
    ejecutar("ffmpeg", ["-v", "error", "-y", ...pista.archivos.flatMap(a => ["-i", a]),
      "-filter_complex", `amix=inputs=${pista.archivos.length}:normalize=0:duration=longest`, "-c:a", "pcm_s16le", bruto]);
  }
  pista.bruto = bruto;
}

// ─── 3. Ruido ─────────────────────────────────────────────────────────────

const voces = [...pistas.values()].filter(p => p.tipo === "voz");
if (!op["sin-ruido"]) {
  paso("Limpiando ruido (DeepFilterNet)");
  if (!hay("deep-filter")) aviso("No está deep-filter (DeepFilterNet). Las voces se quedan sin limpiar. Instálalo o usa --sin-ruido.");
  else {
    for (const v of voces) {
      const destino = path.join(TMP, "limpio");
      // -D compensa el retardo del filtro: sin él, la voz limpia se desplazaría unos ms.
      ejecutar("deep-filter", ["-D", "-a", String(config.reduccionRuidoDb ?? 30), "-o", destino, v.bruto]);
      v.limpio = path.join(SALIDA, "stems", `${nombreStem(v)}.wav`);
      fs.renameSync(path.join(destino, path.basename(v.bruto)), v.limpio);
      console.log(`  ${v.p.nombre}`);
    }
  }
}

// ─── 4. Transcripción ─────────────────────────────────────────────────────

let segmentos = [];
if (!op["sin-whisper"]) {
  paso("Transcribiendo (whisper.cpp)");
  if (!hay("whisper-cli")) aviso("No está whisper-cli (brew install whisper-cpp). Sin transcripción.");
  else if (!fs.existsSync(MODELO)) aviso(`No encuentro el modelo de Whisper en ${MODELO}. Sin transcripción.`);
  else {
    const prompt = (config.diccionario ?? []).join(", ");
    for (const v of voces) {
      const wav16 = path.join(TMP, `${v.p.userId}-16k.wav`);
      ejecutar("ffmpeg", ["-v", "error", "-y", "-i", v.limpio ?? v.bruto, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav16]);
      const base = path.join(TMP, `${v.p.userId}-whisper`);
      const args = ["-m", MODELO, "-l", "es", "-ojf", "-of", base, "-f", wav16];
      if (prompt) args.push("--prompt", prompt);
      if (config.vad) args.push("--vad", "-vm", config.vad);
      const antes = Date.now();
      ejecutar("whisper-cli", args);
      const json = JSON.parse(fs.readFileSync(`${base}.json`, "utf8"));
      segmentos.push(...segmentosWhisper(json, {
        sessionId: sesion.id, participantId: v.p.userId, speaker: v.p.nombre, character: v.p.personaje,
        engine: `whisper.cpp/${path.basename(MODELO, ".bin").replace(/^ggml-/, "")}`
      }));
      console.log(`  ${v.p.nombre}: ${((Date.now() - antes) / 1000).toFixed(0)} s`);
    }
    segmentos = marcarEcos(segmentos);
    const alucinaciones = segmentos.filter(s => s.flags.includes("alucinacion")).length;
    const ecos = segmentos.filter(s => s.flags.includes("posible-eco")).length;
    if (alucinaciones) console.log(`  ${alucinaciones} frases inventadas por Whisper descartadas.`);
    if (ecos) aviso(`${ecos} frases parecen eco de otro micro (¿alguien sin cascos?). Están en transcript.json marcadas y fuera del .md.`);
  }
}

// ─── 5. Exportar ──────────────────────────────────────────────────────────

paso("Exportando");
const escribir = (nombre, contenido) => fs.writeFileSync(path.join(SALIDA, nombre), contenido);

if (segmentos.length) {
  escribir("transcript.json", JSON.stringify(segmentos, null, 2));
  escribir("transcript.md", transcripcionMD(segmentos, sesion.nombre));
  escribir("transcript.srt", subtitulosSRT(segmentos));
}

const marcadores = participantes.flatMap(p => p.marcadores.map(m => ({
  ms: m.serverMs - t0, tipo: m.tipo,
  etiqueta: `${p.nombre}: ${{ momento: "★", cortar: "✂ CORTAR", pausa: "❚❚ pausa", reanuda: "▶ reanuda" }[m.tipo] ?? m.tipo}${m.texto ? ` ${m.texto}` : ""}`
}))).sort((a, b) => a.ms - b.ms);
if (marcadores.length) escribir("marcadores.txt", etiquetasAudacity(marcadores));

const musica = participantes.flatMap(p => p.musica.map(m => ({ ...m, segundo: Math.round(m.serverMs - t0) / 1000 })));
if (musica.length) escribir("musica.json", JSON.stringify(musica, null, 2));

const lista = (items, vacio) => (items.length ? items : [vacio]).map(i => `- ${i}`);
const informe = [
  `# Informe de postproducción · ${sesion.nombre}`,
  "",
  `Duración: ${reloj(duracion * 1000)} · Participantes: ${participantes.map(p => p.nombre).join(", ")}`,
  "",
  "## Avisos",
  "",
  ...lista(avisos, "Ninguno."),
  "",
  "## Pistas",
  "",
  "| Participante | Tramo | Inicio | Deriva | Residuo | Anclas |",
  "|---|---|---|---|---|---|",
  ...tramos.map(t => `| ${t.p.nombre} | ${t.prefijo} | ${((t.r.a + ajuste(t.p) - t0) / 1000).toFixed(3)} s | ${t.ppm.toFixed(1)} ppm | ${t.r.residuoMax.toFixed(1)} ms | ${t.r.anclasUsadas}/${t.r.anclasTotales} |`),
  "",
  "Todas las pistas de `stems/` empiezan en 0:00 y duran lo mismo: arrástralas al editor y ya están alineadas.",
  "Importa `marcadores.txt` en Audacity con Archivo → Importar → Etiquetas.",
  "",
  "## Para cortar antes de publicar",
  "",
  ...lista(marcadores.filter(m => m.tipo === "cortar").map(m => `\`${reloj(m.ms)}\` ${m.etiqueta}`), "Nada marcado."),
  "",
  "## Música que ha sonado (revisa licencias)",
  "",
  ...lista([...new Set(musica.map(m => m.ruta).filter(Boolean))], "Sin registro.")
].join("\n") + "\n";
escribir("informe.md", informe);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n✔ Listo: ${SALIDA}`);
if (avisos.length) console.log(`  ${avisos.length} avisos: mira informe.md`);
