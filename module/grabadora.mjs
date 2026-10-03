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
import { sincronizar, desfase } from "./tiempo.mjs";

const RUTA = foundry.utils.getRoute("modules/mr-chronicle/workers");
const INTERVALO_ANCLAS_MS = 30_000;
const PLAZO_ARRANQUE_MS = 8000;
const PLAZO_CIERRE_MS = 8000;
const COLA_MAX_BYTES = 32_000_000; // ~5 min de voz esperando al disco: algo va mal
const espera = ms => new Promise(r => setTimeout(r, ms));
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
    // Si el navegador suspende el contexto mientras se graba, se intenta reanudar.
    this.ctx.addEventListener?.("statechange", () => {
      if (this.grabando && this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    });
    this.nodo.port.onmessage = ({ data }) => {
      if ("nivel" in data) this.nivel = data.nivel;
      if ("frame" in data) this.meta = data;
      // Por encima de ~-50 dB hay algo más que el ruido de fondo de un micro encendido.
      if (this.latenciaEntradaMs !== null && this.nivel > 0.003) this.ultimaSenal = performance.now();
    };
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  /** Empieza a grabar en `ruta` (carpeta OPFS) con nombres `<prefijo>-000001.wav`. */
  async iniciar(ruta, prefijo) {
    Object.assign(this, { ruta, prefijo, errores: [] });
    this.worker = new Worker(`${RUTA}/escritor-worker.js`, { type: "module" });
    const canal = new MessageChannel();
    const listo = new Promise((resolve, reject) => {
      const plazo = setTimeout(() => reject(new Error("el escritor no arranca")), PLAZO_ARRANQUE_MS);
      const falla = mensaje => { clearTimeout(plazo); reject(new Error(mensaje)); this.fallo(mensaje); };
      this.worker.onerror = e => falla(`no se pudo cargar el escritor (${e.message || "error desconocido"})`);
      this.worker.onmessageerror = () => falla("el escritor recibió datos ilegibles");
      this.worker.onmessage = ({ data }) => {
        if (data.listo) { clearTimeout(plazo); this.info.formato = data.formato; resolve(); }
        if (data.aviso) ui.notifications.warn(`MR · Chronicle: ${data.aviso}`);
        if (data.error) falla(data.error);
        if (data.cerrado) this.cerrado?.(data);
        if (data.escrito) { this.ultimaEscritura = performance.now(); this.bytes = data.escrito; this.cola = data.cola ?? 0; }
      };
    });
    this.worker.postMessage({
      iniciar: { ruta, prefijo, sampleRate: this.ctx.sampleRate, canales: this.canales, formato: this.formato },
      puerto: canal.port2
    }, [canal.port2]);
    try { await listo; }
    catch (error) { this.worker.terminate(); canal.port1.close(); throw error; }
    this.nodo.port.postMessage({ escritor: canal.port1 }, [canal.port1]);
    this.nodo.port.postMessage({ grabar: true });
    this.grabando = true;
    this.inicioPerf = performance.now();
    setTimeout(() => this.anclar(), 1500); // primera ancla en cuanto haya una muestra de referencia
    this.intervalo = setInterval(() => this.anclar(), INTERVALO_ANCLAS_MS);
  }

  /** Para el panel: ¿el micro está encendido y está captando sonido ahora mismo? */
  get estadoMicro() {
    const pista = this.stream?.getAudioTracks()[0];
    const encendido = Boolean(pista && pista.readyState === "live" && pista.enabled && !pista.muted);
    return { encendido, captando: encendido && performance.now() - (this.ultimaSenal ?? -1e9) < 1500 };
  }

  pausar(pausa) {
    this.nodo?.port.postMessage({ pausa });
  }

  /** Avisa en pantalla (una vez) y en la lista de la mesa. */
  fallo(mensaje) {
    this.errores ??= [];
    if (this.errores.includes(mensaje) || this.errores.length > 20) return;
    this.errores.push(mensaje);
    ui.notifications.error(`MR · Chronicle: ${mensaje}`, { permanent: true });
    this.alCambiar();
  }

  /**
   * Foto instantánea (sin red) de qué muestra del archivo se capturó en qué instante de
   * `performance.now()`. La hora del servidor se le suma después, cuando se tenga.
   */
  medir() {
    const meta = this.meta;
    const ts = this.ctx.getOutputTimestamp?.();
    if (!meta || !ts?.contextTime) return null;
    // `ts` dice cuándo sale por los altavoces cada instante del contexto. Para una pista de
    // Foundry eso es justo cuando se oye. Para el micro hay que restar lo que tarda el audio
    // en entrar y en salir: es el instante en que se dijo.
    // ponytail: la latencia real del micro no se puede medir en el navegador con precisión;
    // el error que quede es constante por participante y se corrige con `ajustesMs` (palmadas).
    const latencia = this.latenciaEntradaMs === null ? 0
      : (this.ctx.baseLatency + (this.ctx.outputLatency || 0)) * 1000 + this.latenciaEntradaMs;
    return { frame: meta.frame, perfMs: ts.performanceTime + (meta.ctxTime - ts.contextTime) * 1000 - latencia };
  }

  /** Guarda un ancla {frame, serverMs}. serverMs cuenta desde que se lanzó el mundo; epochMs
   *  (reloj de este equipo) permite a la postproducción detectar un reinicio del servidor. */
  guardarAncla(medida, reloj) {
    return anadirLinea(this.ruta, `${this.prefijo}-anclas.txt`, {
      frame: medida.frame,
      serverMs: Math.round((medida.perfMs + reloj.offset) * 1000) / 1000,
      epochMs: Math.round(performance.timeOrigin + medida.perfMs),
      rttMs: Math.round(reloj.rttMs * 10) / 10
    }).catch(() => {}); // el fallo ya se muestra en pantalla
  }

  /** Ancla periódica. */
  async anclar() {
    // De paso, se vigila que la grabación siga llegando al disco.
    if (this.grabando && performance.now() - (this.ultimaEscritura ?? this.inicioPerf) > 20_000) {
      this.fallo(`la pista de ${this.tipo} no se está guardando en el disco. Avisa al máster y revisa el espacio libre.`);
    }
    if (this.grabando && this.cola > COLA_MAX_BYTES) {
      this.fallo(`el disco no da abasto con la pista de ${this.tipo} (${Math.round(this.cola / 1e6)} MB esperando). Cierra otras pestañas o programas; si sigue, la pestaña podría quedarse sin memoria.`);
    }
    const medida = this.medir();
    const reloj = await sincronizar();
    if (!medida || !reloj || !this.grabando) return; // sin conexión: la regresión interpola con las demás
    await this.guardarAncla(medida, reloj);
  }

  /** Segundos grabados (por muestras: es lo que de verdad hay en el archivo). */
  get segundos() {
    return this.grabando ? (this.meta?.frame ?? 0) / this.ctx.sampleRate : 0;
  }

  /**
   * Cierra la pista. Primero se deja de captar (sin esperar a nada de la red); después se espera
   * a que el escritor confirme que el último trozo quedó guardado, y por último se guarda el ancla
   * final con la hora del servidor si responde pronto, o con el último desfase conocido.
   * @returns {Promise<boolean>} si el cierre quedó confirmado
   */
  async detener() {
    if (!this.grabando) return true;
    clearInterval(this.intervalo);
    const medida = this.medir();
    const cerrado = new Promise(resolve => { this.cerrado = resolve; });
    this.nodo.port.postMessage({ fin: true });
    this.grabando = false;
    const confirmado = await Promise.race([cerrado.then(() => true), espera(PLAZO_CIERRE_MS).then(() => false)]);
    this.worker.terminate();
    this.soltar();
    const reloj = await Promise.race([sincronizar({ maxEdadMs: 60_000 }), espera(3000).then(() => null)]) ?? desfase();
    if (medida && reloj) await this.guardarAncla(medida, reloj);
    if (!confirmado) {
      this.fallo(`no se pudo confirmar que el final de la pista de ${this.tipo} quedó guardado. Lo grabado hasta entonces sigue en este navegador: guárdalo o entrégalo igualmente.`);
    }
    return confirmado;
  }

  /** Desconecta los nodos. No cierra el contexto: puede ser uno de Foundry. Se puede llamar varias veces. */
  soltar() {
    if (this.soltado) return;
    this.soltado = true;
    try { this.fuente.disconnect(this.nodo); } catch { /* ya desconectado */ }
    this.nodo?.disconnect();
    this.silencio?.disconnect();
  }
}

/** Pista del micro del participante, en bruto. */
const abrirMicro = deviceId => navigator.mediaDevices.getUserMedia({
  audio: {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    channelCount: 1, sampleRate: 48000,
    echoCancellation: false, noiseSuppression: false, autoGainControl: false
  }
});

export async function pistaMicro(deviceId) {
  const stream = await abrirMicro(deviceId);
  const pista = stream.getAudioTracks()[0];
  const ajustes = pista.getSettings();
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: "playback" });
  const p = new Pista({
    ctx, fuente: ctx.createMediaStreamSource(stream), canales: 1, tipo: "voz",
    latenciaEntradaMs: Number.isFinite(ajustes.latency) ? ajustes.latency * 1000 : 0,
    info: { dispositivo: pista.label, ajustes }
  });
  p.stream = stream;

  // Si el micro se desconecta, la grabación sigue (en silencio) y, en cuanto vuelve a haber un
  // micro, se engancha de nuevo al mismo procesador: mismo archivo, misma cuenta de muestras.
  const reconectar = async () => {
    if (p.soltado || p.stream.getAudioTracks()[0]?.readyState !== "ended" || p.reconectando) return;
    p.reconectando = true;
    try {
      const nuevo = await abrirMicro(deviceId).catch(() => abrirMicro());
      // Mientras se pedía el micro, la pista pudo cerrarse: no se reabre nada que el usuario cerró.
      if (p.soltado) { nuevo.getTracks().forEach(t => t.stop()); return; }
      const fuente = ctx.createMediaStreamSource(nuevo);
      try { p.fuente.disconnect(); } catch { /* ya desconectada */ }
      fuente.connect(p.nodo);
      Object.assign(p, { fuente, stream: nuevo });
      p.alCambiar();
    } catch { /* aún no hay micro: se reintenta en el próximo cambio de dispositivos */ }
    finally { p.reconectando = false; }
  };
  navigator.mediaDevices.addEventListener("devicechange", reconectar);

  // Si el navegador ignoró la petición de audio en bruto, hay que avisar: afecta al podcast.
  p.procesado = ["echoCancellation", "noiseSuppression", "autoGainControl"].filter(k => ajustes[k] === true);
  const soltar = p.soltar.bind(p);
  p.soltar = () => {
    if (p.soltado) return;
    navigator.mediaDevices.removeEventListener("devicechange", reconectar);
    soltar();
    p.stream.getTracks().forEach(t => t.stop());
    ctx.close().catch(() => {});
  };
  // Si falla la preparación, no puede quedar el micro abierto.
  try { await p.preparar(); }
  catch (error) { p.soltar(); throw error; }
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
