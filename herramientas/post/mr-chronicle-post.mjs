#!/usr/bin/env node
/**
 * Postproducción de MR · Chronicle.
 *
 *   node herramientas/post/mr-chronicle-post.mjs <carpeta-sesion> [opciones]
 *   node herramientas/post/mr-chronicle-post.mjs --comprobar
 *
 * <carpeta-sesion> tiene una subcarpeta por participante (lo que dejan las entregas en el
 * servidor: Data/mr-chronicle/<sesion>/) y/o las copias .zip que guarda cada uno desde el panel.
 * Se pueden mezclar: los .zip se leen tal cual, sin descomprimirlos a mano.
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
 *   --normalizar       Igualar el volumen de las voces (EBU R128, -19 LUFS) para el podcast
 *   --temporal <dir>   Carpeta de trabajo (por defecto, dentro de la de salida). Hace falta sitio:
 *                      ~1,6 veces el audio sin comprimir de la sesión
 *   --comprobar        Solo comprobar que están instalados los programas y el modelo
 *
 * Necesita ffmpeg; para limpiar, deep-filter (DeepFilterNet); para transcribir, whisper-cli.
 * Los busca primero en ~/.cache/mr-chronicle/bin (donde los dejan los instaladores) y luego
 * en el PATH.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";
import { execFileSync, spawnSync, spawn } from "node:child_process";
import { parseArgs } from "node:util";
import {
  leerNDJSON, regresion, segmentosWhisper, marcarEcos, tramosDeVoz, ajustarAVoz, corregir,
  transcripcionMD, subtitulosSRT, etiquetasAudacity, reloj, corregirReinicios, mediana
} from "./lib.mjs";
import { extraerZip, crc32 } from "./zip.mjs";
import { huecosOgg, cabeceraOpus } from "./ogg.mjs";

const { values: op, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    salida: { type: "string" },
    config: { type: "string" },
    "sin-ruido": { type: "boolean", default: false },
    "sin-whisper": { type: "boolean", default: false },
    formato: { type: "string" },
    "con-bruta": { type: "boolean", default: false },
    normalizar: { type: "boolean", default: false },
    temporal: { type: "string" },
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
// Funciona en Mac, Linux y Windows. Además de existir, tiene que arrancar: un programa al que le
// faltan librerías se lanza pero termina con error, y eso no cuenta como instalado.
const hay = nombre => {
  const r = spawnSync(programa(nombre), ["-h"], { stdio: "ignore", timeout: 20_000 });
  return !r.error && r.status !== null && r.status < 2;
};

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
  console.error("Uso: mr-chronicle-post <carpeta-sesion> [--salida dir] [--config campana.json] [--formato flac|wav|opus] [--con-bruta] [--normalizar] [--temporal dir] [--sin-ruido] [--sin-whisper]\n       mr-chronicle-post --comprobar");
  process.exit(1);
}

const SESION = path.resolve(positionals[0]);
const SALIDA = path.resolve(op.salida ?? path.join(SESION, "salida"));
// Temporal propio de esta ejecución: dos procesados a la vez no se pisan, y se borra al salir.
const BASE_TMP = path.resolve(op.temporal ?? SALIDA);
const TMP = path.join(BASE_TMP, `.tmp-${process.pid}-${Date.now()}`);
process.on("exit", () => fs.rmSync(TMP, { recursive: true, force: true }));
// Ctrl‑C, cierre de la terminal o `kill`: salir con normalidad para que se borre el temporal.
for (const señal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(señal, () => process.exit(130));
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
const zlibRapido = Boolean(zlib.crc32); // con Node reciente el CRC es rápido: se comprueba todo

/** Como `ejecutar`, pero sin bloquear: permite limpiar varias voces a la vez. */
const ejecutarAsync = (bin, args) => new Promise((resolve, reject) => {
  const p = spawn(programa(bin), args, { stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  p.stderr.on("data", d => { err = (err + d).slice(-2000); });
  p.on("error", reject);
  p.on("close", c => c === 0 ? resolve() : reject(new Error(`${bin} terminó con error ${c}: ${err}`)));
});
const ejecutar = (bin, args) => execFileSync(programa(bin), args, { stdio: ["ignore", "ignore", "pipe"], maxBuffer: 1 << 26 });
function detectarSilencios(archivo) {
  // silencedetect informa por stderr.
  const r = spawnSync(programa("ffmpeg"), ["-hide_banner", "-nostats", "-i", archivo, "-af", `silencedetect=noise=${config.umbralSilencioDb ?? -40}dB:d=0.5`, "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 28 });
  return r.status === 0 ? r.stderr : null;
}
/** Inserta silencio (muestras s16le) en las posiciones dadas, reescribiendo `raw` por bloques. */
function rellenarHuecos(raw, huecos, canales) {
  const paso = 2 * canales;
  const nuevo = `${raw}.relleno`;
  const entrada = fs.openSync(raw, "r"), salida = fs.openSync(nuevo, "w");
  const buf = Buffer.alloc(1 << 22);
  let leido = 0;
  const copiar = hasta => {
    while (leido < hasta) {
      const n = fs.readSync(entrada, buf, 0, Math.min(buf.length, hasta - leido), leido);
      if (!n) break;
      fs.writeSync(salida, buf, 0, n);
      leido += n;
    }
  };
  for (const h of [...huecos].sort((a, b) => a.pos - b.pos)) {
    copiar(Math.max(0, h.pos) * paso);
    let falta = h.muestras * paso;
    while (falta > 0) { const n = Math.min(buf.length, falta); fs.writeSync(salida, Buffer.alloc(n), 0, n); falta -= n; }
  }
  copiar(Infinity);
  fs.closeSync(entrada); fs.closeSync(salida);
  fs.renameSync(nuevo, raw);
}
const slug = t => t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");

if (!hay("ffmpeg")) { console.error("Falta ffmpeg. Ejecuta el instalador de herramientas/instalar/."); process.exit(1); }
// Se empieza de cero: nunca se mezclan resultados de un procesado anterior con los nuevos.
for (const f of ["stems", "transcript.json", "transcript.md", "transcript.srt", "marcadores.txt", "musica.json", "informe.md"]) {
  fs.rmSync(path.join(SALIDA, f), { recursive: true, force: true });
}
fs.mkdirSync(path.join(SALIDA, "stems"), { recursive: true });
// Temporales de ejecuciones que murieron sin limpiar (su proceso ya no existe).
fs.mkdirSync(BASE_TMP, { recursive: true });
for (const nombre of fs.readdirSync(BASE_TMP)) {
  const pid = Number(nombre.match(/^\.tmp-(\d+)-\d+$/)?.[1]);
  if (!pid) continue;
  try { process.kill(pid, 0); } catch (e) { if (e.code === "ESRCH") fs.rmSync(path.join(BASE_TMP, nombre), { recursive: true, force: true }); }
}
fs.mkdirSync(TMP, { recursive: true });

// ─── 1. Leer las entregas ─────────────────────────────────────────────────

paso("Leyendo entregas");
const carpetas = [];
for (const nombre of fs.readdirSync(SESION).sort()) {
  const ruta = path.join(SESION, nombre);
  if (nombre.startsWith(".") || path.resolve(ruta) === SALIDA) continue;
  if (fs.statSync(ruta).isDirectory()) carpetas.push(ruta);
  else if (/\.zip$/i.test(nombre)) {
    try {
      const { carpetas: dentro, danados } = extraerZip(ruta, path.join(TMP, "zips", nombre));
      carpetas.push(...dentro);
      for (const d of danados) aviso(`${nombre}: ${d} está dañado (no coincide su comprobación). Vuelve a pedir esa copia.`);
    } catch (e) { aviso(`${nombre}: ${e.message}. Se omite.`); }
  }
}

const participantes = [];
for (const dir of carpetas) {
  const archivos = fs.readdirSync(dir);
  let manifiesto = null;
  if (archivos.includes("manifiesto.json")) {
    try { manifiesto = JSON.parse(fs.readFileSync(path.join(dir, "manifiesto.json"), "utf8")); }
    catch { aviso(`${path.basename(dir)}: manifiesto.json está dañado. Se usa lo que haya.`); }
  } else aviso(`${path.basename(dir)}: falta manifiesto.json (entrega incompleta). Se usa lo que haya.`);
  const userId = manifiesto?.usuario?.id ?? path.basename(dir);

  // Inventario (lo generan la copia .zip y la entrega al servidor): nada falta ni está dañado.
  const inventarios = archivos.filter(a => /^inventario.*\.json$/.test(a)).sort();
  if (inventarios.length) {
    try {
      const inv = JSON.parse(fs.readFileSync(path.join(dir, inventarios.at(-1)), "utf8"));
      for (const f of inv.archivos ?? []) {
        const ruta = path.join(dir, f.nombre);
        if (!fs.existsSync(ruta)) aviso(`${manifiesto?.usuario?.nombre ?? userId}: falta ${f.nombre}, que estaba en su grabación.`);
        else if (fs.statSync(ruta).size !== f.bytes) aviso(`${manifiesto?.usuario?.nombre ?? userId}: ${f.nombre} está incompleto (${fs.statSync(ruta).size} de ${f.bytes} bytes).`);
        else if (zlibRapido && crc32(fs.readFileSync(ruta)) !== f.crc32) aviso(`${manifiesto?.usuario?.nombre ?? userId}: ${f.nombre} está dañado.`);
      }
    } catch { aviso(`${path.basename(dir)}: el inventario está dañado; no se ha podido comprobar la entrega.`); }
  }

  const tramos = {};
  for (const a of archivos) {
    const m = a.match(/^(voz|musica|ambiente|efectos)-(\d+)-(\d{6})\.(wav|ogg)$/);
    if (m) (tramos[`${m[1]}-${m[2]}`] ??= []).push({ archivo: a, n: Number(m[3]) });
  }
  const leer = n => fs.existsSync(path.join(dir, n)) ? leerNDJSON(fs.readFileSync(path.join(dir, n), "utf8")) : [];
  const nuevo = {
    userId, dir, manifiesto,
    nombre: manifiesto?.usuario?.nombre ?? userId,
    personaje: manifiesto?.usuario?.personaje ?? null,
    publica: manifiesto?.consentimiento?.publicar !== false,
    tramos: Object.fromEntries(Object.entries(tramos).map(([k, v]) => [k, v.sort((x, y) => x.n - y.n)])),
    marcadores: leer("marcadores.txt"),
    musica: leer("musica.txt"),
    leer
  };
  // La misma persona dos veces (carpeta y .zip, o dos copias): se usa la que tiene más audio.
  const audio = p => Object.values(p.tramos).flat().reduce((t, x) => t + fs.statSync(path.join(p.dir, x.archivo)).size, 0);
  const previo = participantes.findIndex(p => p.userId === userId);
  if (previo >= 0) {
    aviso(`${nuevo.nombre} aparece dos veces (carpeta y copia, o dos copias). Se usa la que tiene más audio.`);
    if (audio(nuevo) > audio(participantes[previo])) participantes[previo] = nuevo;
    continue;
  }
  participantes.push(nuevo);
}
if (!participantes.length) { console.error("No hay entregas en esa carpeta."); process.exit(1); }

// Etiqueta legible y única: si hay dos «Ana», se distinguen por el principio de su identificador.
for (const p of participantes) {
  const iguales = participantes.filter(q => slug(q.nombre) === slug(p.nombre)).length > 1;
  p.etiqueta = iguales ? `${p.nombre} (${p.userId.slice(0, 4)})` : p.nombre;
  console.log(`  ${p.etiqueta}: ${Object.keys(p.tramos).join(", ") || "sin audio"}`);
}

const sesiones = new Set(participantes.map(p => p.manifiesto?.sesion?.id).filter(Boolean));
if (sesiones.size > 1) aviso(`Hay entregas de varias sesiones mezcladas (${[...sesiones].join(", ")}). Revisa la carpeta.`);
const sesion = participantes.map(p => p.manifiesto?.sesion).find(Boolean) ?? { id: path.basename(SESION), nombre: path.basename(SESION) };
for (const p of participantes) {
  if (!p.publica) aviso(`${p.etiqueta} NO ha aceptado que se publique su voz: su pista está en stems/no-publicar/.`);
}

// ─── 2. Deriva y alineación ───────────────────────────────────────────────

paso("Calculando deriva");
const ajuste = p => config.ajustesMs?.[p.nombre] ?? config.ajustesMs?.[p.userId] ?? 0;
const tramos = [];
let reinicio = false;
for (const p of participantes) {
  // La hora del servidor de Foundry cuenta desde que se lanzó el mundo: si el servidor se
  // reinicia, vuelve a cero. El reloj del equipo (epochMs) lo delata, ancla a ancla, aunque
  // pase en mitad de un tramo; con el mismo mapa se corrigen marcadores y música.
  const todas = Object.keys(p.tramos).flatMap(k => p.leer(`${k}-anclas.txt`));
  const corrector = corregirReinicios(todas);
  if (corrector.reinicios) {
    reinicio = true;
    aviso(`${p.etiqueta}: el servidor de Foundry se reinició durante la sesión. Se ha recolocado con el reloj del equipo (precisión algo menor: revisa a oído).`);
  }
  p.marcadores = p.marcadores.map(corrector.corregir);
  p.musica = p.musica.map(corrector.corregir);

  for (const [prefijo, trozos] of Object.entries(p.tramos)) {
    const numeroTramo = Number(prefijo.split("-")[1]);
    let canales, fsNominal, frames, raw;
    raw = path.join(TMP, `${p.userId}-${prefijo}.raw`);
    if (trozos[0].archivo.endsWith(".ogg")) {
      // Música y efectos: trozos consecutivos de un único flujo Ogg Opus. Se pegan (por partes:
      // nunca todo en memoria) y se decodifican.
      if (trozos[0].n !== 1) { aviso(`${p.etiqueta} ${prefijo}: falta el primer trozo, que tiene las cabeceras. Se omite esta pista.`); continue; }
      const buffers = trozos.map(t => fs.readFileSync(path.join(p.dir, t.archivo)));
      let cab;
      try { cab = cabeceraOpus(buffers[0].subarray(0, 128)); }
      catch (e) { aviso(`${p.etiqueta} ${prefijo}: ${e.message}. Se omite esta pista.`); continue; }
      canales = cab.canales;
      fsNominal = 48000;
      // Los números de secuencia de las páginas delatan los trozos que faltan; el gránulo, cuánto duraban.
      const huecos = huecosOgg(buffers, cab.preSkip);
      const ogg = path.join(TMP, `${p.userId}-${prefijo}.ogg`);
      const fd = fs.openSync(ogg, "w");
      for (const t of trozos) fs.writeSync(fd, fs.readFileSync(path.join(p.dir, t.archivo)));
      fs.closeSync(fd);
      ejecutar("ffmpeg", ["-v", "error", "-y", "-i", ogg, "-f", "s16le", "-ar", "48000", "-ac", String(canales), raw]);
      fs.rmSync(ogg);
      if (huecos.length) {
        rellenarHuecos(raw, huecos, canales);
        const total = huecos.reduce((t, h) => t + h.muestras, 0);
        aviso(`${p.etiqueta} ${prefijo}: faltaban ${huecos.length} trozo(s) de la pista de Foundry (${(total / 48000).toFixed(1)} s); se han rellenado con silencio en su sitio.`);
      }
      frames = fs.statSync(raw).size / (2 * canales);
    } else {
      const cab = fs.readFileSync(path.join(p.dir, trozos[0].archivo)).subarray(0, 44);
      canales = cab.readUInt16LE(22); fsNominal = cab.readUInt32LE(24);
      // Trozos de 60 s exactos salvo el último. Un trozo que falta o se quedó corto se rellena con
      // silencio de su duración: lo que viene detrás sigue en su sitio.
      const porTrozo = 60 * fsNominal * canales * 2;
      const fd = fs.openSync(raw, "w");
      let bytes = 0;
      const ultimo = trozos.at(-1).n;
      for (let n = 1; n <= ultimo; n++) {
        const t = trozos.find(x => x.n === n);
        let datos = t ? fs.readFileSync(path.join(p.dir, t.archivo)).subarray(44) : Buffer.alloc(0);
        datos = datos.subarray(0, datos.length - (datos.length % (2 * canales)));
        if (!t) aviso(`${p.etiqueta} ${prefijo}: falta el trozo ${n} (minuto ${n}); se rellena con silencio para no desplazar el resto.`);
        else if (n < ultimo && datos.length < porTrozo) aviso(`${p.etiqueta} ${prefijo}: el trozo ${n} está incompleto; se completa con silencio.`);
        fs.writeSync(fd, datos);
        bytes += datos.length;
        if (n < ultimo && datos.length < porTrozo) {
          fs.writeSync(fd, Buffer.alloc(porTrozo - datos.length));
          bytes += porTrozo - datos.length;
        }
      }
      fs.closeSync(fd);
      frames = bytes / (2 * canales);
    }

    // Anclas corregidas; si hay pocas o dan una frecuencia imposible, frecuencia nominal y aviso.
    const anclas = p.leer(`${prefijo}-anclas.txt`).map(corrector.corregir);
    const nominal = 1000 / fsNominal;
    let r;
    try {
      r = regresion(anclas);
      const ppmCalculado = (r.fsReal / fsNominal - 1) * 1e6;
      if (!Number.isFinite(ppmCalculado) || Math.abs(ppmCalculado) > 1000) {
        const a = mediana(anclas.map(x => x.serverMs - x.frame * nominal));
        aviso(`${p.etiqueta} ${prefijo}: las anclas dan una deriva imposible (${Math.round(ppmCalculado)} ppm). Se usa la frecuencia nominal: revisa la alineación a oído.`);
        r = { ...r, a, b: nominal, fsReal: fsNominal, residuoMax: NaN };
      }
    } catch {
      if (anclas.length === 1) {
        r = { a: anclas[0].serverMs - anclas[0].frame * nominal, b: nominal, fsReal: fsNominal, residuoMax: 0, anclasUsadas: 1, anclasTotales: 1 };
        aviso(`${p.etiqueta} ${prefijo}: solo tiene un ancla (tramo muy corto o sin conexión). Se asume la frecuencia nominal.`);
      } else if (numeroTramo === 1 && Number.isFinite(sesion.inicioServerMs)) {
        r = { a: sesion.inicioServerMs, b: nominal, fsReal: fsNominal, residuoMax: NaN, anclasUsadas: 0, anclasTotales: 0 };
        aviso(`${p.etiqueta} ${prefijo}: no tiene anclas. Se coloca al inicio de la sesión: revisa la alineación a oído.`);
      } else {
        aviso(`${p.etiqueta} ${prefijo}: no tiene anclas y no se puede saber dónde va. Se omite (el audio sigue en su carpeta).`);
        fs.rmSync(raw, { force: true });
        continue;
      }
    }
    const ppm = (r.fsReal / fsNominal - 1) * 1e6;
    if ((r.anclasUsadas ?? 0) < 4 && frames / fsNominal > 300) aviso(`${p.etiqueta} ${prefijo}: solo ${r.anclasUsadas ?? 0} anclas útiles para ${Math.round(frames / fsNominal / 60)} min de audio; la deriva calculada es poco fiable. Revisa la alineación a oído.`);
    if (r.hueco) aviso(`${p.etiqueta} ${prefijo}: error residual de ${r.residuoMax.toFixed(0)} ms. Probablemente se perdieron muestras; revisa la alineación a oído.`);
    else if (Math.abs(ppm) > 300) aviso(`${p.etiqueta} ${prefijo}: deriva de ${ppm.toFixed(0)} ppm, anormalmente alta.`);
    tramos.push({ p, prefijo, tipo: prefijo.split("-")[0], canales, fsNominal, frames, r, ppm, raw });
  }
}
if (!tramos.length) { console.error("No hay ninguna pista que se pueda colocar."); process.exit(1); }

// El inicio de sesión está en la base de la primera época, que es a la que se corrige todo; el
// final lo marca el máster, quizá tras un reinicio, así que entonces manda el final de las pistas.
const t0 = Number.isFinite(sesion.inicioServerMs) ? sesion.inicioServerMs : Math.min(...tramos.map(t => t.r.a));
const finTramos = Math.max(...tramos.map(t => t.r.a + t.r.b * t.frames));
const fin = reinicio || !Number.isFinite(sesion.finServerMs) ? finTramos : Math.max(sesion.finServerMs, t0 + 1000);
const duracion = (fin - t0) / 1000;
console.log(`  Sesión: ${reloj(duracion * 1000)}`);

{
  // Sitio en disco: el audio sin comprimir de todas las pistas, más la versión limpia.
  const necesario = tramos.reduce((t, x) => t + x.frames * x.canales * 2, 0) * 1.6;
  let libre = null;
  try { const st = fs.statfsSync(BASE_TMP); libre = st.bavail * st.bsize; } catch { /* Node antiguo: no se puede mirar */ }
  const GB = n => (n / 1e9).toFixed(1);
  if (libre !== null && libre < necesario) {
    console.error(`Falta sitio en disco: hacen falta unos ${GB(necesario)} GB libres y hay ${GB(libre)} GB en ${BASE_TMP}. Libera espacio o usa --temporal <carpeta en otro disco>.`);
    process.exit(1);
  }
  console.log(`  Espacio de trabajo: ~${GB(necesario)} GB (libres: ${libre === null ? "?" : GB(libre) + " GB"})`);
}
paso("Alineando pistas");
// Varios tramos de una misma pista (alguien recargó el navegador) se colocan cada uno en su sitio
// y luego se juntan en una.
const pistas = new Map();
for (const t of tramos) {
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
  ejecutar("ffmpeg", ["-v", "error", "-y", "-f", "s16le", "-ar", String(t.fsNominal), "-ac", String(t.canales), "-i", t.raw,
    "-af", filtros.join(","), "-c:a", "pcm_s16le", t.alineado]);
  fs.rmSync(t.raw);
  console.log(`  ${t.p.etiqueta} ${t.prefijo}: empieza en ${inicio.toFixed(3)} s · deriva ${t.ppm.toFixed(1)} ppm · residuo ${Number.isFinite(t.r.residuoMax) ? t.r.residuoMax.toFixed(1) : "?"} ms`);
  const clave = `${t.p.userId}|${t.tipo}`;
  if (!pistas.has(clave)) pistas.set(clave, { p: t.p, tipo: t.tipo, archivos: [] });
  pistas.get(clave).archivos.push(t.alineado);
}

// Nombres de archivo únicos: dos «Ana», o dos personas que graban música de Foundry, no se pisan.
const base = pista => pista.tipo === "voz" ? `voz-${slug(pista.p.nombre)}` : `foundry-${pista.tipo}`;
const todasPistas = [...pistas.values()];
for (const pista of todasPistas) {
  const repetido = todasPistas.filter(q => base(q) === base(pista)).length > 1;
  pista.nombre = !repetido ? base(pista)
    : pista.tipo === "voz" ? `${base(pista)}-${pista.p.userId.slice(0, 4)}` : `${base(pista)}-${slug(pista.p.nombre)}-${pista.p.userId.slice(0, 4)}`;
}
const nombreStem = pista => pista.nombre;
for (const pista of pistas.values()) {
  const bruto = path.join(TMP, `${nombreStem(pista)}.bruto.wav`);
  if (pista.archivos.length === 1) fs.renameSync(pista.archivos[0], bruto);
  else {
    ejecutar("ffmpeg", ["-v", "error", "-y", ...pista.archivos.flatMap(a => ["-i", a]),
      "-filter_complex", `amix=inputs=${pista.archivos.length}:normalize=0:duration=longest`, "-c:a", "pcm_s16le", bruto]);
    for (const a of pista.archivos) fs.rmSync(a);
  }
  pista.bruto = bruto;
}

// ─── 3. Ruido ─────────────────────────────────────────────────────────────

const voces = [...pistas.values()].filter(p => p.tipo === "voz");
if (!op["sin-ruido"]) {
  paso("Limpiando ruido (DeepFilterNet)");
  if (!hay("deep-filter")) aviso("No está deep-filter (DeepFilterNet). Las voces se quedan sin limpiar. Ejecuta el instalador o usa --sin-ruido.");
  else {
    // Varias voces a la vez (DeepFilterNet usa poco CPU por voz). El original se borra en cuanto
    // existe la versión limpia, salvo con --con-bruta: así el disco no se llena.
    const destino = path.join(TMP, "limpio");
    const hilos = Math.max(1, Math.min(voces.length, Math.floor(os.cpus().length / 2), 4));
    let siguiente = 0;
    await Promise.all(Array.from({ length: hilos }, async () => {
      while (siguiente < voces.length) {
        const v = voces[siguiente++];
        // -D compensa el retardo del filtro: sin él, la voz limpia se desplazaría unos ms.
        await ejecutarAsync("deep-filter", ["-D", "-a", String(config.reduccionRuidoDb ?? 30), "-o", destino, v.bruto]);
        v.limpio = path.join(TMP, `${nombreStem(v)}.limpio.wav`);
        fs.renameSync(path.join(destino, path.basename(v.bruto)), v.limpio);
        if (!GUARDAR_BRUTA) { fs.rmSync(v.bruto); v.bruto = null; }
        console.log(`  ${v.p.etiqueta}`);
      }
    }));
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
        sessionId: sesion.id, participantId: v.p.userId, speaker: v.p.etiqueta, character: v.p.personaje,
        engine: `whisper.cpp/${path.basename(MODELO, ".bin").replace(/^ggml-/, "")}`
      });
      const silencios = detectarSilencios(v.limpio ?? v.bruto);
      if (silencios === null) aviso(`${v.p.etiqueta}: no se pudo analizar dónde hay voz; los tiempos del texto son los de Whisper (menos precisos).`);
      else ajustarAVoz(propios, tramosDeVoz(silencios, duracion * 1000));
      for (const s of propios) s.text = corregir(s.text, config.correcciones);
      segmentos.push(...propios);
      console.log(`  ${v.p.etiqueta}: ${((Date.now() - antes) / 1000).toFixed(0)} s`);
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

/** Pasa una pista de trabajo (WAV) al formato final de stems/ (o stems/no-publicar/). */
function codificar(entrada, nombre, canales, carpeta = "stems", normalizar = false) {
  const opciones = {
    wav: ["-c:a", "pcm_s16le"],
    flac: ["-c:a", "flac"],
    opus: ["-c:a", "libopus", "-b:a", canales === 2 ? "160k" : "96k"]
  }[FORMATO];
  fs.mkdirSync(path.join(SALIDA, carpeta), { recursive: true });
  // loudnorm trabaja a 192 kHz por dentro: se vuelve a 48 kHz para que todas las pistas sigan alineadas.
  const filtro = normalizar ? ["-af", "loudnorm=I=-19:TP=-1.5:LRA=11,aresample=48000"] : [];
  ejecutar("ffmpeg", ["-v", "error", "-y", "-i", entrada, ...filtro, ...opciones, path.join(SALIDA, carpeta, `${nombre}.${FORMATO}`)]);
}
for (const pista of pistas.values()) {
  const canales = pista.tipo === "voz" ? 1 : 2;
  // La voz de quien no autorizó publicar va aparte, para no montarla por error.
  const carpeta = pista.tipo === "voz" && !pista.p.publica ? "stems/no-publicar" : "stems";
  codificar(pista.limpio ?? pista.bruto, nombreStem(pista), canales, carpeta, pista.tipo === "voz" && op.normalizar);
  if (pista.tipo === "voz" && pista.limpio && pista.bruto) codificar(pista.bruto, `${nombreStem(pista)}.bruta`, canales, carpeta);
}

const escribir = (nombre, contenido) => fs.writeFileSync(path.join(SALIDA, nombre), contenido);

if (segmentos.length) {
  escribir("transcript.json", JSON.stringify(segmentos, null, 2));
  escribir("transcript.md", transcripcionMD(segmentos, sesion.nombre));
  escribir("transcript.srt", subtitulosSRT(segmentos));
}

const marcadores = participantes.flatMap(p => p.marcadores.map(m => ({
  ms: m.serverMs - t0, tipo: m.tipo,
  etiqueta: `${p.etiqueta}: ${{ momento: "★", cortar: "✂ CORTAR", pausa: "❚❚ pausa", reanuda: "▶ reanuda" }[m.tipo] ?? m.tipo}${m.texto ? ` ${m.texto}` : ""}`
}))).sort((a, b) => a.ms - b.ms);
if (marcadores.length) escribir("marcadores.txt", etiquetasAudacity(marcadores));

const musica = participantes.flatMap(p => p.musica.map(m => ({ ...m, segundo: Math.round(m.serverMs - t0) / 1000 })));
if (musica.length) escribir("musica.json", JSON.stringify(musica, null, 2));

const lista = (items, vacio) => (items.length ? items : [vacio]).map(i => `- ${i}`);
const informe = [
  `# Informe de postproducción · ${sesion.nombre}`,
  "",
  `Duración: ${reloj(duracion * 1000)} · Participantes: ${participantes.map(p => p.etiqueta).join(", ")}`,
  "",
  "## Avisos",
  "",
  ...lista(avisos, "Ninguno."),
  "",
  "## Pistas",
  "",
  "| Participante | Tramo | Inicio | Deriva | Residuo | Anclas |",
  "|---|---|---|---|---|---|",
  ...tramos.map(t => `| ${t.p.etiqueta} | ${t.prefijo} | ${((t.r.a + ajuste(t.p) - t0) / 1000).toFixed(3)} s | ${t.ppm.toFixed(1)} ppm | ${Number.isFinite(t.r.residuoMax) ? `${t.r.residuoMax.toFixed(1)} ms` : "—"} | ${t.r.anclasUsadas ?? "?"}/${t.r.anclasTotales ?? "?"} |`),
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

console.log(`\n✔ Listo: ${SALIDA}`);
if (avisos.length) console.log(`  ${avisos.length} avisos: mira informe.md`);
