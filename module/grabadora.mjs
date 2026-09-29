/**
 * Una pista grabándose: el micro de este participante o una de las salidas de audio de Foundry.
 *
 * fuente (nodo de audio) ─> AudioWorklet ──puerto──> Worker ─> OPFS (trozos WAV)
 *                               └─> hilo principal: (muestra, currentTime) cada segundo
 *
 * Cada 30 s se guarda un ancla {frame, serverMs}: qué muestra del archivo se capturó en qué
 * instante del reloj del servidor. Con todas las anclas, la postproducción calcula la
 * frecuencia real de la tarjeta de sonido y coloca la pista en la línea de tiempo común.
 */
import { RAIZ, anadirLinea, escribirJSON, listar, borrar } from "./opfs.mjs";
import { sincronizar } from "./tiempo.mjs";

const RUTA = foundry.utils.getRoute("modules/mr-chronicle/workers");
const INTERVALO_ANCLAS_MS = 30_000;
const contextosConWorklet = new WeakSet();

export class Pista {
  /**
   * @param {object} o
   * @param {AudioContext} o.ctx
   * @param {AudioNode} o.fuente
   * @param {number} o.canales
   * @param {string} o.tipo               voz | musica | ambiente | efectos
   * @param {number} [o.latenciaEntradaMs] Solo micro: retraso entre captura y procesado.
   * @param {object} [o.info]              Datos para el manifiesto.
   * @param {string} [o.formato]           wav (voz, sin pérdida) | opus (música y efectos, ~10 veces menos)
   */
  constructor({ ctx, fuente, canales, tipo, latenciaEntradaMs = null, info = {}, formato = "wav" }) {
    Object.assign(this, { ctx, fuente, canales, tipo, latenciaEntradaMs, info, formato });
    this.nivel = 0;
    this.meta = null;
    this.grabando = false;
    this.alCambiar = () => {};
  }

  async preparar() {
    if (!contextosConWorklet.has(this.ctx)) {
      await this.ctx.audioWorklet.addModule(`${RUTA}/captura-worklet.js`);
      contextosConWorklet.add(this.ctx);
    }
    this.nodo = new AudioWorkletNode(this.ctx, "mr-chronicle-captura", {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      channelCount: this.canales, channelCountMode: "explicit",
      processorOptions: { canales: this.canales }
    });
    // Se conecta al destino a través de un silencio para que el navegador lo procese siempre.
    this.silencio = new GainNode(this.ctx, { gain: 0 });
    this.fuente.connect(this.nodo);
    this.nodo.connect(this.silencio).connect(this.ctx.destination);
    this.nodo.port.onmessage = ({ data }) => {
      if ("nivel" in data) this.nivel = data.nivel;
      if ("frame" in data) this.meta = data;
      if (this.latenciaEntradaMs !== null && this.grabando) this.vigilarSenal();
    };
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  /** Empieza a grabar en `ruta` (carpeta OPFS) con nombres `<prefijo>-000001.wav`. */
  async iniciar(ruta, prefijo) {
    Object.assign(this, { ruta, prefijo, errores: [] });
    this.worker = new Worker(`${RUTA}/escritor-worker.js`, { type: "module" });
    const canal = new MessageChannel();
    const listo = new Promise((resolve, reject) => {
      this.worker.onmessage = ({ data }) => {
        if (data.listo) { this.info.formato = data.formato; resolve(); }
        if (data.aviso) ui.notifications.warn(`MR · Chronicle: ${data.aviso}`);
        if (data.error) { this.errores.push(data.error); reject(new Error(data.error)); this.alCambiar(); }
        if (data.cerrado) this.cerrado?.(data);
        if (data.escrito) { this.ultimaEscritura = performance.now(); this.bytes = data.escrito; }
      };
    });
    this.worker.postMessage({
      iniciar: { ruta, prefijo, sampleRate: this.ctx.sampleRate, canales: this.canales, formato: this.formato },
      puerto: canal.port2
    }, [canal.port2]);
    await listo;
    this.nodo.port.postMessage({ escritor: canal.port1 }, [canal.port1]);
    this.nodo.port.postMessage({ grabar: true });
    this.grabando = true;
    this.inicioPerf = performance.now();
    setTimeout(() => this.anclar(), 1500); // primera ancla en cuanto haya una muestra de referencia
    this.intervalo = setInterval(() => this.anclar(), INTERVALO_ANCLAS_MS);
  }

  /**
   * Micro silenciado o desconectado: se sigue grabando (silencio), pero hay que avisar.
   * Un micro real nunca da silencio absoluto (siempre hay ruido de la sala); -80 dB lo es.
   */
  vigilarSenal() {
    const ahora = performance.now();
    if (this.nivel > 1e-4) this.ultimaSenal = ahora;
    const sinSenal = ahora - (this.ultimaSenal ?? this.inicioPerf) > 30_000;
    if (sinSenal === Boolean(this.sinSenal)) return;
    this.sinSenal = sinSenal;
    if (sinSenal) ui.notifications.error("MR · Chronicle: no llega sonido de tu micro desde hace 30 s. ¿Está silenciado o desconectado?", { permanent: true });
    this.alCambiar();
  }

  pausar(pausa) {
    this.nodo?.port.postMessage({ pausa });
  }

  /** Avisa en pantalla (una vez) y en la lista de la mesa. */
  fallo(mensaje) {
    this.errores ??= [];
    if (this.errores.includes(mensaje)) return;
    this.errores.push(mensaje);
    ui.notifications.error(`MR · Chronicle: ${mensaje}`, { permanent: true });
    this.alCambiar();
  }

  /** Relaciona la última muestra conocida con la hora del servidor y lo guarda. */
  async anclar() {
    // De paso, se vigila que la grabación siga llegando al disco.
    if (this.grabando && performance.now() - (this.ultimaEscritura ?? this.inicioPerf) > 20_000) {
      this.fallo(`la pista de ${this.tipo} no se está guardando en el disco. Avisa al máster y revisa el espacio libre.`);
    }
    const meta = this.meta;
    const reloj = await sincronizar();
    if (!meta || !reloj) return; // sin conexión: la regresión interpola con las demás anclas
    const ts = this.ctx.getOutputTimestamp();
    if (!ts.contextTime) return;
    // `ts` dice cuándo sale por los altavoces cada instante del contexto. Para una pista de
    // Foundry eso es justo cuando se oye. Para el micro hay que restar lo que tarda el audio
    // en entrar y en salir: es el instante en que se dijo.
    // ponytail: la latencia real del micro no se puede medir en el navegador con precisión;
    // el error que quede es constante por participante y se corrige con `ajustesMs` (palmadas).
    const latencia = this.latenciaEntradaMs === null ? 0
      : (this.ctx.baseLatency + (this.ctx.outputLatency || 0)) * 1000 + this.latenciaEntradaMs;
    const perfMs = ts.performanceTime + (meta.ctxTime - ts.contextTime) * 1000 - latencia;
    // serverMs cuenta desde que se lanzó el mundo: si el servidor se reinicia, vuelve a cero.
    // epochMs (reloj de este equipo) permite a la postproducción detectar ese salto.
    await anadirLinea(this.ruta, `${this.prefijo}-anclas.txt`, {
      frame: meta.frame,
      serverMs: Math.round((perfMs + reloj.offset) * 1000) / 1000,
      epochMs: Math.round(performance.timeOrigin + perfMs),
      rttMs: Math.round(reloj.rttMs * 10) / 10
    }).catch(() => {}); // el fallo ya se muestra en pantalla
  }

  /** Segundos grabados (por muestras: es lo que de verdad hay en el archivo). */
  get segundos() {
    return this.grabando ? (this.meta?.frame ?? 0) / this.ctx.sampleRate : 0;
  }

  /** Cierra la pista: última ancla, vacía lo pendiente y espera a que el Worker cierre el trozo. */
  async detener() {
    if (!this.grabando) return;
    clearInterval(this.intervalo);
    await this.anclar();
    const cerrado = new Promise(resolve => { this.cerrado = resolve; });
    this.nodo.port.postMessage({ fin: true });
    await Promise.race([cerrado, new Promise(r => setTimeout(r, 5000))]);
    this.worker.terminate();
    this.grabando = false;
    this.soltar();
  }

  /** Desconecta los nodos. No cierra el contexto: puede ser uno de Foundry. */
  soltar() {
    try { this.fuente.disconnect(this.nodo); } catch { /* ya desconectado */ }
    this.nodo?.disconnect();
    this.silencio?.disconnect();
  }
}

/** Pista del micro del participante, en bruto. */
export async function pistaMicro(deviceId) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      channelCount: 1, sampleRate: 48000,
      echoCancellation: false, noiseSuppression: false, autoGainControl: false
    }
  });
  const pista = stream.getAudioTracks()[0];
  const ajustes = pista.getSettings();
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: "playback" });
  const p = new Pista({
    ctx, fuente: ctx.createMediaStreamSource(stream), canales: 1, tipo: "voz",
    latenciaEntradaMs: Number.isFinite(ajustes.latency) ? ajustes.latency * 1000 : 0,
    info: { dispositivo: pista.label, ajustes }
  });
  p.stream = stream;
  pista.addEventListener("ended", () => {
    p.errores?.push("Se ha desconectado el micro. Vuelve a conectarlo y recarga la página: la grabación seguirá en un tramo nuevo.");
    ui.notifications.error("MR · Chronicle: se ha desconectado tu micro.", { permanent: true });
    p.alCambiar();
  });
  // Si el navegador ignoró la petición de audio en bruto, hay que avisar: afecta al podcast.
  p.procesado = ["echoCancellation", "noiseSuppression", "autoGainControl"].filter(k => ajustes[k] === true);
  const soltar = p.soltar.bind(p);
  p.soltar = () => { soltar(); stream.getTracks().forEach(t => t.stop()); ctx.close(); };
  await p.preparar();
  return p;
}

/**
 * Prueba de verdad que este navegador puede guardar una grabación: el mismo Worker escribe un
 * trozo corto en OPFS y se comprueba que se puede leer. Se hace al aceptar, antes de la partida.
 */
export async function probarAlmacenamiento() {
  const ruta = [RAIZ, "_prueba"];
  const worker = new Worker(`${RUTA}/escritor-worker.js`, { type: "module" });
  const canal = new MessageChannel();
  try {
    const cerrado = new Promise((resolve, reject) => {
      const espera = setTimeout(() => reject(new Error("el almacenamiento no responde")), 8000);
      worker.onerror = e => { clearTimeout(espera); reject(new Error(e.message || "no se pudo cargar el escritor")); };
      worker.onmessage = ({ data }) => {
        if (data.error) { clearTimeout(espera); reject(new Error(data.error)); }
        if (data.listo) canal.port1.postMessage({ datos: new Int16Array(4800), fin: true });
        if (data.cerrado) { clearTimeout(espera); resolve(); }
      };
    });
    worker.postMessage({ iniciar: { ruta, prefijo: "prueba", sampleRate: 48000, canales: 1, formato: "wav" }, puerto: canal.port2 }, [canal.port2]);
    await cerrado;
    await escribirJSON(ruta, "prueba.json", { ok: true });
    const archivos = await listar(ruta);
    const wav = archivos.find(a => a.nombre === "prueba-000001.wav");
    if (wav?.archivo.size !== 44 + 9600 || !archivos.some(a => a.nombre === "prueba.json")) {
      throw new Error("lo escrito no aparece al leerlo");
    }
  } finally {
    worker.terminate();
    await borrar(ruta).catch(() => {});
  }
}
