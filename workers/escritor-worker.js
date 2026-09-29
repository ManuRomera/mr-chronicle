/**
 * Escritor de trozos. Un Worker (de módulo) por pista.
 *
 * Recibe bloques int16 del worklet y los escribe en OPFS en trozos de 60 s:
 * - formato "wav" (voz): `<prefijo>-000001.wav`… La cabecera se escribe al abrir el trozo y se
 *   corrige al cerrarlo; si el navegador muere a mitad, la postproducción usa el tamaño real.
 * - formato "opus" (música y efectos de Foundry): `<prefijo>-000001.ogg`… un único flujo Ogg Opus
 *   a 160 kbps repartido en archivos consecutivos. Ocupa ~10 veces menos.
 */
import { FlujoOgg, PRE_SKIP } from "./ogg.js";

const SEGUNDOS_POR_TROZO = 60;
const BITRATE_OPUS = 160_000;

let cfg = null;      // {ruta, prefijo, sampleRate, canales, formato}
let dir = null;
let trozo = null;    // {handle, bytes}
let n = 0;
let framesPorTrozo = 0;

// Opus
let codificador = null;
let ogg = null;
let framesEntrada = 0;   // muestras entregadas al codificador
let framesSalida = 0;    // muestras ya codificadas (para el gránulo y para rotar trozos)
let inicioTrozo = 0;

self.onmessage = async ({ data }) => {
  if (!data.iniciar) return;
  try {
    cfg = data.iniciar;
    framesPorTrozo = cfg.sampleRate * SEGUNDOS_POR_TROZO;
    dir = await navigator.storage.getDirectory();
    for (const parte of cfg.ruta) dir = await dir.getDirectoryHandle(parte, { create: true });
    if (cfg.formato === "opus" && !(await prepararOpus())) {
      cfg.formato = "wav";
      self.postMessage({ aviso: "Este navegador no puede codificar Opus: esta pista se guarda en WAV y ocupará más." });
    }
    data.puerto.onmessage = ({ data }) => escribir(data);
    self.postMessage({ listo: true, formato: cfg.formato });
  } catch (error) {
    self.postMessage({ error: `No se pudo preparar el almacenamiento: ${error.message}` });
  }
};

async function prepararOpus() {
  const config = { codec: "opus", sampleRate: 48000, numberOfChannels: cfg.canales, bitrate: BITRATE_OPUS };
  if (typeof AudioEncoder === "undefined" || cfg.sampleRate !== 48000) return false;
  if (!(await AudioEncoder.isConfigSupported(config)).supported) return false;
  ogg = new FlujoOgg(cfg.canales);
  codificador = new AudioEncoder({
    output: paquete => {
      const bytes = new Uint8Array(paquete.byteLength);
      paquete.copyTo(bytes);
      framesSalida += Math.round((paquete.duration * 48000) / 1e6);
      const hasta = framesSalida; // se fija ya: la escritura va en cola y framesSalida sigue avanzando
      encolar(async () => {
        if (!trozo) await abrir(hasta);
        escribirBytes(ogg.pagina(bytes, PRE_SKIP + hasta));
        if (hasta - inicioTrozo >= framesPorTrozo) cerrar();
      });
    },
    error: e => self.postMessage({ error: `Error del codificador: ${e.message}` })
  });
  codificador.configure(config);
  return true;
}

async function abrir(desde = 0) {
  n += 1;
  const nombre = `${cfg.prefijo}-${String(n).padStart(6, "0")}.${cfg.formato === "opus" ? "ogg" : "wav"}`;
  const archivo = await dir.getFileHandle(nombre, { create: true });
  const handle = await archivo.createSyncAccessHandle();
  handle.truncate(0);
  trozo = { handle, bytes: 0 };
  if (cfg.formato === "wav") trozo.handle.write(cabecera(0), { at: 0 });
  else {
    inicioTrozo = desde;
    if (n === 1) for (const p of ogg.cabeceras()) escribirBytes(p);
  }
}

let totalBytes = 0; // todo lo escrito en esta pista, para mostrarlo en el panel

function escribirBytes(bytes) {
  const desplazamiento = cfg.formato === "wav" ? 44 : 0;
  trozo.handle.write(bytes, { at: desplazamiento + trozo.bytes });
  trozo.bytes += bytes.length;
  totalBytes += bytes.length;
}

// Señal de vida para el hilo principal: si deja de llegar, la grabación no se está guardando.
let ultimoAviso = 0;
function informar() {
  const t = Date.now();
  if (t - ultimoAviso > 2000) { ultimoAviso = t; self.postMessage({ escrito: totalBytes }); }
}

function cerrar() {
  if (!trozo) return;
  if (cfg.formato === "wav") trozo.handle.write(cabecera(trozo.bytes), { at: 0 });
  trozo.handle.flush();
  trozo.handle.close();
  trozo = null;
}

// abrir() es asíncrono: todas las escrituras se encadenan para no solaparse.
let cola = Promise.resolve();
const encolar = tarea => (cola = cola.then(tarea).catch(error =>
  // Lo más probable: disco lleno. Se avisa; lo ya escrito sigue a salvo.
  self.postMessage({ error: `Error al escribir: ${error.message}` })));

function escribir(msg) {
  if (cfg.formato === "opus") return escribirOpus(msg);
  encolar(async () => {
    let datos = new Uint8Array(msg.datos.buffer, msg.datos.byteOffset, msg.datos.byteLength);
    const bytesPorTrozo = framesPorTrozo * cfg.canales * 2;
    while (datos.length) {
      if (!trozo) await abrir();
      const cabe = Math.min(datos.length, bytesPorTrozo - trozo.bytes);
      escribirBytes(datos.subarray(0, cabe));
      datos = datos.subarray(cabe);
      if (trozo.bytes >= bytesPorTrozo) cerrar();
    }
    if (trozo) { trozo.handle.flush(); informar(); }
    if (msg.fin) { cerrar(); self.postMessage({ cerrado: true, trozos: n }); }
  });
}

async function escribirOpus(msg) {
  const frames = msg.datos.length / cfg.canales;
  if (frames) {
    const audio = new AudioData({
      format: "s16", sampleRate: 48000, numberOfChannels: cfg.canales, numberOfFrames: frames,
      timestamp: Math.round((framesEntrada * 1e6) / 48000), data: msg.datos
    });
    framesEntrada += frames;
    codificador.encode(audio);
    audio.close();
  }
  encolar(async () => { if (trozo) { trozo.handle.flush(); informar(); } });
  if (msg.fin) {
    await codificador.flush();
    encolar(async () => { cerrar(); self.postMessage({ cerrado: true, trozos: n }); });
  }
}

function cabecera(bytesDatos) {
  const { sampleRate, canales } = cfg;
  const b = new DataView(new ArrayBuffer(44));
  const texto = (o, s) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  texto(0, "RIFF");
  b.setUint32(4, 36 + bytesDatos, true);
  texto(8, "WAVE");
  texto(12, "fmt ");
  b.setUint32(16, 16, true);
  b.setUint16(20, 1, true);                       // PCM
  b.setUint16(22, canales, true);
  b.setUint32(24, sampleRate, true);
  b.setUint32(28, sampleRate * canales * 2, true);
  b.setUint16(32, canales * 2, true);
  b.setUint16(34, 16, true);
  texto(36, "data");
  b.setUint32(40, bytesDatos, true);
  return new Uint8Array(b.buffer);
}
