#!/usr/bin/env node
/**
 * Postproducción de MR · Chronicle.
 *
 *   node herramientas/post/mr-chronicle-post.mjs <carpeta-sesion> [opciones]
 *   node herramientas/post/mr-chronicle-post.mjs --comprobar
 *
 * <carpeta-sesion> tiene una subcarpeta por participante: la que dejan las entregas en el
 * servidor (Data/mr-chronicle/<sesion>/) o las descargas en una carpeta compartida.
 *
 * Opciones:
 *   --salida <dir>     Carpeta de resultados (por defecto <carpeta-sesion>/salida)
 *   --config <json>    Ajustes de campaña. Si no se indica, se usa campana.json de la
 *                      carpeta de la sesión o de la de encima, si existe.
 *   --sin-ruido        No limpiar el ruido
 *   --sin-whisper      No transcribir
 *   --formato <f>      Formato de las pistas: flac (por defecto, sin pérdida, ~3 veces menos
 *                      que wav), wav u opus (lo más pequeño, con pérdida mínima)
 *   --con-bruta        Guardar también la voz sin limpiar (el original ya está en la entrega)
 *   --comprobar        Solo comprobar que están instalados los programas y el modelo
 *
 * Necesita ffmpeg; para limpiar, deep-filter (DeepFilterNet); para transcribir, whisper-cli.
 * Los busca primero en ~/.cache/mr-chronicle/bin (donde los dejan los instaladores) y luego
 * en el PATH.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import {
  leerNDJSON, regresion, segmentosWhisper, marcarEcos, tramosDeVoz, ajustarAVoz, corregir,
  transcripcionMD, subtitulosSRT, etiquetasAudacity, reloj
} from "./lib.mjs";

const { values: op, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    salida: { type: "string" },
    config: { type: "string" },
    "sin-ruido": { type: "boolean", default: false },
    "sin-whisper": { type: "boolean", default: false },
    formato: { type: "string" },
    "con-bruta": { type: "boolean", default: false },
    comprobar: { type: "boolean", default: false }
  }
});

const CASA = path.join(os.homedir(), ".cache", "mr-chronicle");
const BIN = path.join(CASA, "bin");
const casa = r => r?.replace(/^~(?=[\\/]|$)/, os.homedir());

/** Ruta del programa: el de los instaladores si existe; si no, el del PATH. */
function programa(nombre) {
  const propio = path.join(BIN, process.platform === "win32" ? `${nombre}.exe` : nombre);
  return fs.existsSync(propio) ? propio : nombre;
}
// Funciona en Mac, Linux y Windows: si el programa no existe, spawnSync da ENOENT.
const hay = nombre => !spawnSync(programa(nombre), ["-h"], { stdio: "ignore" }).error;

function buscarConfig(sesion) {
  if (op.config) return op.config;
  return [path.join(sesion, "campana.json"), path.join(path.dirname(sesion), "campana.json")].find(f => fs.existsSync(f));
}

if (op.comprobar) {
  const modelo = casa(process.env.MR_CHRONICLE_MODELO ?? path.join(CASA, "ggml-large-v3-turbo.bin"));
  const filas = [
    ["ffmpeg", hay("ffmpeg"), "imprescindible"],
    ["deep-filter (DeepFilterNet)", hay("deep-filter"), "para limpiar el ruido"],
    ["whisper-cli (whisper.cpp)", hay("whisper-cli"), "para transcribir"],
    [`modelo ${path.basename(modelo)}`, fs.existsSync(modelo), "para transcribir"]
  ];
  for (const [que, ok, para] of filas) console.log(`${ok ? "✔" : "✖"} ${que}${ok ? "" : ` — falta (${para})`}`);
  process.exit(filas.every(f => f[1]) ? 0 : 1);
}

if (!positionals[0]) {
  console.error("Uso: mr-chronicle-post <carpeta-sesion> [--salida dir] [--config campana.json] [--formato flac|wav|opus] [--con-bruta] [--sin-ruido] [--sin-whisper]\n       mr-chronicle-post --comprobar");
  process.exit(1);
}

const SESION = path.resolve(positionals[0]);
const SALIDA = path.resolve(op.salida ?? path.join(SESION, "salida"));
const TMP = path.join(SALIDA, ".tmp");
const rutaConfig = buscarConfig(SESION);
const config = rutaConfig ? JSON.parse(fs.readFileSync(rutaConfig, "utf8")) : {};
if (rutaConfig) console.log(`Configuración: ${rutaConfig}`);
const MODELO = casa(config.modelo ?? process.env.MR_CHRONICLE_MODELO ?? path.join(CASA, "ggml-large-v3-turbo.bin"));
if (config.vad) config.vad = casa(config.vad);
const FORMATO = op.formato ?? config.formato ?? "flac";
if (!["flac", "wav", "opus"].includes(FORMATO)) { console.error(`Formato desconocido: ${FORMATO} (usa flac, wav u opus).`); process.exit(1); }
const GUARDAR_BRUTA = op["con-bruta"] || config.guardarBruta === true;
const avisos = [];
const aviso = t => { avisos.push(t); console.warn(`⚠ ${t}`); };
const paso = t => console.log(`\n▸ ${t}`);

const ejecutar = (bin, args) => execFileSync(programa(bin), args, { stdio: ["ignore", "ignore", "pipe"], maxBuffer: 1 << 26 });
function detectarSilencios(archivo) {
  // silencedetect informa por stderr.
  const r = spawnSync(programa("ffmpeg"), ["-hide_banner", "-nostats", "-i", archivo, "-af", `silencedetect=noise=${config.umbralSilencioDb ?? -40}dB:d=0.5`, "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 28 });
  return r.stderr;
}
const slug = t => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");

if (!hay("ffmpeg")) { console.error("Falta ffmpeg. Ejecuta el instalador de herramientas/instalar/."); process.exit(1); }
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
    const m = a.match(/^(voz|musica|ambiente|efectos)-(\d+)-(\d{6})\.(wav|ogg)$/);
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
    let canales, fsNominal, frames, raw = null;
    if (trozos[0].endsWith(".ogg")) {
      // Música y efectos: trozos consecutivos de un único flujo Ogg Opus. Se pegan y se decodifican.
      canales = fs.readFileSync(path.join(p.dir, trozos[0]))[37]; // OpusHead: canales
      fsNominal = 48000;
      const ogg = path.join(TMP, `${p.userId}-${prefijo}.ogg`);
      fs.writeFileSync(ogg, Buffer.concat(trozos.map(t => fs.readFileSync(path.join(p.dir, t)))));
      raw = path.join(TMP, `${p.userId}-${prefijo}.raw`);
      ejecutar("ffmpeg", ["-v", "error", "-y", "-i", ogg, "-f", "s16le", "-ar", "48000", "-ac", String(canales), raw]);
      fs.rmSync(ogg);
      frames = [fs.statSync(raw).size / (2 * canales)];
    } else {
      const cab = fs.readFileSync(path.join(p.dir, trozos[0])).subarray(0, 44);
      canales = cab.readUInt16LE(22); fsNominal = cab.readUInt32LE(24);
      // No se usa el tamaño de la cabecera: si el navegador murió a mitad, estaría mal.
      frames = trozos.map(t => (fs.statSync(path.join(p.dir, t)).size - 44) / (2 * canales));
    }
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
    tramos.push({ p, prefijo, tipo: prefijo.split("-")[0], trozos, canales, fsNominal, frames: frames.reduce((a, b) => a + b, 0), r, ppm, raw });
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
  const raw = t.raw ?? path.join(TMP, `${t.p.userId}-${t.prefijo}.raw`);
  if (!t.raw) {
    const fd = fs.openSync(raw, "w");
    for (const trozo of t.trozos) fs.writeSync(fd, fs.readFileSync(path.join(t.p.dir, trozo)).subarray(44));
    fs.closeSync(fd);
  }
  const inicio = (t.r.a + ajuste(t.p) - t0) / 1000;
  t.alineado = path.join(TMP, `${t.p.userId}-${t.prefijo}.wav`);
  // Todo por número de muestras, nunca por marcas de tiempo: cada versión de ffmpeg las
  // trata distinto (la 6.1 aplicaba el desplazamiento dos veces y no recortaba el final).
  // 1) Deriva: se etiqueta con la frecuencia real medida y se remuestrea a 48 kHz exactos.
  //    aresample solo admite frecuencias enteras: se trabaja a escala ×100 (0,01 Hz de precisión).
  // 2) Inicio: silencio delante (adelay) o recorte (atrim) de tantas muestras como toque.
  // 3) Final: relleno y recorte a la duración de la sesión.
  const desplazamiento = Math.round(inicio * 48000);
  const totalMuestras = Math.round(duracion * 48000);
  const filtros = [
    `asetrate=${Math.round(t.r.fsReal * 100)}`, "aresample=4800000", "asetrate=48000",
    desplazamiento > 0 ? `adelay=delays=${desplazamiento}S:all=1` : desplazamiento < 0 ? `atrim=start_sample=${-desplazamiento}` : null,
    `apad=whole_len=${totalMuestras}`, `atrim=end_sample=${totalMuestras}`
  ].filter(Boolean);
  ejecutar("ffmpeg", ["-v", "error", "-y", "-f", "s16le", "-ar", String(t.fsNominal), "-ac", String(t.canales), "-i", raw,
    "-af", filtros.join(","), "-c:a", "pcm_s16le", t.alineado]);
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
  const bruto = path.join(TMP, `${nombreStem(pista)}.bruto.wav`);
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
  if (!hay("deep-filter")) aviso("No está deep-filter (DeepFilterNet). Las voces se quedan sin limpiar. Ejecuta el instalador o usa --sin-ruido.");
  else {
    for (const v of voces) {
      const destino = path.join(TMP, "limpio");
      // -D compensa el retardo del filtro: sin él, la voz limpia se desplazaría unos ms.
      ejecutar("deep-filter", ["-D", "-a", String(config.reduccionRuidoDb ?? 30), "-o", destino, v.bruto]);
      v.limpio = path.join(TMP, `${nombreStem(v)}.limpio.wav`);
      fs.renameSync(path.join(destino, path.basename(v.bruto)), v.limpio);
      console.log(`  ${v.p.nombre}`);
    }
  }
}

// ─── 4. Transcripción ─────────────────────────────────────────────────────

let segmentos = [];
if (!op["sin-whisper"]) {
  paso("Transcribiendo (whisper.cpp)");
  if (!hay("whisper-cli")) aviso("No está whisper-cli (whisper.cpp). Sin transcripción: ejecuta el instalador.");
  else if (!fs.existsSync(MODELO)) aviso(`No encuentro el modelo de Whisper en ${MODELO}. Sin transcripción.`);
  else {
    const prompt = (config.diccionario ?? []).join(", ");
    for (const v of voces) {
      const wav16 = path.join(TMP, `${v.p.userId}-16k.wav`);
      ejecutar("ffmpeg", ["-v", "error", "-y", "-i", v.limpio ?? v.bruto, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav16]);
      const base = path.join(TMP, `${v.p.userId}-whisper`);
      const args = ["-m", MODELO, "-l", "es", "-ojf", "-of", base, "-f", wav16];
      if (prompt) args.push("--prompt", prompt);
      // ponytail: el VAD de whisper.cpp junta toda la voz en segmentos enormes; se usa silencedetect.
      if (config.vad) args.push("--vad", "-vm", config.vad);
      const antes = Date.now();
      ejecutar("whisper-cli", args);
      const json = JSON.parse(fs.readFileSync(`${base}.json`, "utf8"));
      const propios = segmentosWhisper(json, {
        sessionId: sesion.id, participantId: v.p.userId, speaker: v.p.nombre, character: v.p.personaje,
        engine: `whisper.cpp/${path.basename(MODELO, ".bin").replace(/^ggml-/, "")}`
      });
      ajustarAVoz(propios, tramosDeVoz(detectarSilencios(v.limpio ?? v.bruto), duracion * 1000));
      for (const s of propios) s.text = corregir(s.text, config.correcciones);
      segmentos.push(...propios);
      console.log(`  ${v.p.nombre}: ${((Date.now() - antes) / 1000).toFixed(0)} s`);
    }
    segmentos = marcarEcos(segmentos);
    const alucinaciones = segmentos.filter(s => s.flags.includes("alucinacion") || s.flags.includes("sin-voz")).length;
    const ecos = segmentos.filter(s => s.flags.includes("posible-eco")).length;
    if (alucinaciones) console.log(`  ${alucinaciones} frases inventadas por Whisper descartadas.`);
    if (ecos) aviso(`${ecos} frases parecen eco de otro micro (¿alguien sin cascos?). Están en transcript.json marcadas y fuera del .md.`);
  }
}

// ─── 5. Exportar ──────────────────────────────────────────────────────────

paso(`Exportando (pistas en ${FORMATO})`);

/** Pasa una pista de trabajo (WAV) al formato final de stems/. */
function codificar(entrada, nombre, canales) {
  const opciones = {
    wav: ["-c:a", "pcm_s16le"],
    flac: ["-c:a", "flac"],
    opus: ["-c:a", "libopus", "-b:a", canales === 2 ? "160k" : "96k"]
  }[FORMATO];
  ejecutar("ffmpeg", ["-v", "error", "-y", "-i", entrada, ...opciones, path.join(SALIDA, "stems", `${nombre}.${FORMATO}`)]);
}
for (const pista of pistas.values()) {
  const canales = pista.tipo === "voz" ? 1 : 2;
  codificar(pista.limpio ?? pista.bruto, nombreStem(pista), canales);
  if (pista.tipo === "voz" && pista.limpio && GUARDAR_BRUTA) codificar(pista.bruto, `${nombreStem(pista)}.bruta`, canales);
}

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
  `Todas las pistas de \`stems/\` (en ${FORMATO}) empiezan en 0:00 y duran lo mismo: arrástralas al editor y ya están alineadas.`,
  "La voz original, sin limpiar, sigue en la carpeta de cada participante (o usa --con-bruta para tenerla también alineada en stems/).",
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
