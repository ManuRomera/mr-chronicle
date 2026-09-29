/**
 * Coordinación de la sesión.
 *
 * El control lo lleva el máster con el ajuste de mundo `sesion`: Foundry lo reparte a todos los
 * clientes y lo conserva si alguien recarga. El socket del módulo solo lleva el estado de cada
 * participante (para el panel) y la petición de crear carpetas en el servidor.
 *
 * sesion = {id, nombre, fase: preparada|grabando|pausada|finalizada, canales: {musica, ambiente, efectos},
 *           inicioServerMs, finServerMs}
 * Al iniciar, inicioServerMs queda 5 s en el futuro: todos ven la misma cuenta atrás y empiezan a la vez.
 */
import { pistaMicro, probarAlmacenamiento } from "./grabadora.mjs";
import { pistasFoundry, registrarMusica } from "./foundry-audio-tap.mjs";
import { RAIZ, escribirJSON, leerJSON, anadirLinea, borrar, existe, siFalla } from "./opfs.mjs";
import { ahora, sincronizar } from "./tiempo.mjs";
import { subir, descargar, crearCarpetas } from "./entrega.mjs";

export const ID = "mr-chronicle";
const SOCKET = `module.${ID}`;
const ESTADO_CADA_MS = 3000;
const CUENTA_ATRAS_MS = 5000;
export const CANALES = { musica: "Música", ambiente: "Ambiente", efectos: "Efectos" };

/** 3725 → «1:02:05». */
export const reloj = segundos => {
  const s = Math.floor(segundos);
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

class Chronicle {
  pistas = [];          // pistas grabando en este cliente
  micro = null;         // pista del micro, preparada al aceptar (sirve de medidor)
  pausaPropia = false;
  estados = new Map();  // userId → último estado recibido
  entrega = null;       // {hechos, total, error, fin}
  manifiesto = null;
  ocupado = false;

  get sesion() { return game.settings.get(ID, "sesion"); }
  get ruta() { return [RAIZ, this.sesion.id, game.user.id]; }
  get grabando() { return this.pistas.some(p => p.grabando); }

  /** Por qué este navegador no puede grabar, o null si puede. */
  get problemaNavegador() {
    if (!window.isSecureContext) {
      return {
        codigo: "https",
        texto: `Foundry está abierto sin HTTPS (${location.origin}) y el navegador solo deja usar el micro y guardar la grabación en páginas seguras.`,
        local: `http://localhost:${location.port || 80}${location.pathname}`
      };
    }
    // La app de escritorio de Foundry (Electron) no guardó la grabación en las pruebas y no
    // puede mostrar el selector de carpetas de «Descargar».
    if (/Electron\//.test(navigator.userAgent)) {
      return { codigo: "app", texto: "Estás en la app de escritorio de Foundry, que no puede grabar. Abre la partida en Chrome o Edge (con la misma dirección)." };
    }
    if (!navigator.userAgentData?.brands?.some(b => b.brand === "Chromium")) {
      return { codigo: "navegador", texto: "Este navegador no puede grabar. Usa Chrome o Edge." };
    }
    return null;
  }

  registrar() {
    game.settings.register(ID, "sesion", {
      scope: "world", config: false, type: Object, default: null,
      onChange: () => this.alCambiarSesion()
    });
    game.keybindings.register(ID, "marcar", {
      name: "Marcar momento", hint: "Añade un marcador en la grabación de MR · Chronicle.",
      editable: [{ key: "KeyM", modifiers: ["Control", "Shift"] }],
      onDown: () => { this.marcar("momento"); return true; }
    });
    game.keybindings.register(ID, "abrir", {
      name: "Abrir panel", editable: [],
      onDown: () => { this.abrirPanel(); return true; }
    });
  }

  async preparado() {
    siFalla(error => {
      const texto = `No se pudo guardar en el disco: ${error.message}`;
      if (this.error !== texto) ui.notifications.error(`MR · Chronicle: ${texto}`, { permanent: true });
      this.error = texto;
      this.refrescar();
    });
    game.socket.on(SOCKET, msg => this.alRecibir(msg));
    this.indicador();
    setInterval(() => this.emitirEstado(), ESTADO_CADA_MS);
    setInterval(() => { if (this.grabando || this.faltaParaEmpezar) this.indicador(); }, 250); // el reloj avanza a la vista
    await sincronizar();
    this.emitir({ tipo: "hola" });
    await this.alCambiarSesion(true);
  }

  // ─── Máster ─────────────────────────────────────────────────────────────

  /** Pistas de Foundry que ha elegido el máster (las sesiones antiguas usaban grabarFoundry). */
  get canalesFoundry() {
    const s = this.sesion;
    const canales = s?.canales ?? (s?.grabarFoundry ? { musica: true, ambiente: true, efectos: true } : {});
    return Object.keys(CANALES).filter(c => canales[c]);
  }

  async preparar(nombre, canales) {
    const fecha = new Date();
    const pad = n => String(n).padStart(2, "0");
    const slug = (nombre || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const id = `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())}-${pad(fecha.getHours())}${pad(fecha.getMinutes())}${slug ? `-${slug}` : ""}`;
    await game.settings.set(ID, "sesion", { id, nombre: nombre || id, fase: "preparada", canales, inicioServerMs: null, finServerMs: null });
  }

  async elegirCanales(canales) {
    await game.settings.set(ID, "sesion", { ...this.sesion, canales });
  }

  async fase(fase) {
    const s = { ...this.sesion, fase };
    if (fase === "grabando" && !s.inicioServerMs) {
      Object.assign(s, { inicioServerMs: ahora() + CUENTA_ATRAS_MS, inicioEpochMs: Date.now() + CUENTA_ATRAS_MS });
    }
    if (fase === "finalizada") Object.assign(s, { finServerMs: ahora(), finEpochMs: Date.now() });
    await game.settings.set(ID, "sesion", s);
  }

  async cerrarSesion() {
    await game.settings.set(ID, "sesion", null);
  }

  // ─── Todos ──────────────────────────────────────────────────────────────

  /** Reacciona a la fase que marca el máster. `alCargar`: tras entrar o recargar la página. */
  async alCambiarSesion(alCargar = false) {
    const s = this.sesion;
    clearTimeout(this.temporizadorInicio);
    if (!s) {
      this.quitarCuenta();
      await this.detenerTodo();
      this.manifiesto = null;
      return this.refrescar();
    }
    if (this.manifiesto?.sesion.id !== s.id) {
      await this.detenerTodo();
      this.manifiesto = await leerJSON(this.ruta, "manifiesto.json");
      this.entrega = null;
    }
    const acepto = this.manifiesto?.consentimiento.grabar;

    // Cuenta atrás: todos la ven, y cada uno empieza a grabar cuando llega a cero.
    const falta = this.faltaParaEmpezar;
    if (falta > 0) {
      this.cuentaAtras(s.inicioServerMs, acepto);
      this.temporizadorInicio = setTimeout(() => this.alCambiarSesion(), falta);
      return this.refrescar();
    }
    this.quitarCuenta();

    if (s.fase === "preparada" && !acepto) this.abrirPanel();
    if (["grabando", "pausada"].includes(s.fase) && acepto && !this.grabando && !this.problemaNavegador) {
      if (alCargar) {
        ui.notifications.info("MR · Chronicle: tu grabación seguirá en cuanto hagas clic en la mesa.");
        await game.audio.unlock;
        // Mientras se esperaba el clic, la sesión pudo cambiar o terminar.
        const ahoraSesion = this.sesion;
        if (ahoraSesion?.id !== s.id || !["grabando", "pausada"].includes(ahoraSesion.fase)) return;
      }
      await this.empezarTramo();
    }
    this.aplicarPausa();
    if (s.fase === "finalizada" && this.grabando) {
      await this.detenerTodo();
      this.abrirPanel();
    }
    if (this.manifiesto) await this.guardarManifiesto({ sesion: s });
    this.refrescar();
  }

  async aceptar({ grabar, publicar, deviceId }) {
    if (!grabar) return this.retirar();
    const problema = this.problemaNavegador;
    if (problema) { this.error = problema.texto; return this.refrescar(); }
    try { localStorage.setItem(`${ID}.micro`, deviceId ?? ""); } catch { /* sin almacenamiento local */ }
    await navigator.storage.persist?.();
    // Antes de dar por bueno el consentimiento, se comprueba que de verdad se puede guardar.
    try {
      await probarAlmacenamiento();
      const previo = this.manifiesto?.consentimiento;
      await this.guardarManifiesto({
        consentimiento: { grabar: true, publicar, fecha: previo?.fecha ?? new Date().toISOString() }
      });
    } catch (error) {
      this.error = `Este navegador no consigue guardar la grabación (${error.message}). No se ha registrado tu consentimiento: prueba con Chrome o Edge actualizados.`;
      return this.refrescar();
    }
    this.error = null;
    if (!this.micro || this.micro.deviceId !== deviceId) await this.probarMicro(deviceId);
    if (["grabando", "pausada"].includes(this.sesion.fase) && !this.grabando) await this.empezarTramo();
    this.refrescar();
  }

  async retirar() {
    await this.detenerTodo();
    this.micro?.soltar();
    this.micro = null;
    if (this.manifiesto) {
      await this.guardarManifiesto({ consentimiento: { grabar: false, publicar: false, fecha: new Date().toISOString() } });
    }
    this.refrescar();
  }

  /** Abre el micro sin grabar: el medidor confirma que llega señal. */
  async probarMicro(deviceId) {
    if (this.grabando) return;
    this.micro?.soltar();
    this.micro = null;
    try {
      this.micro = await pistaMicro(deviceId);
      this.micro.deviceId = deviceId;
      this.error = this.micro.procesado.length
        ? `El navegador está procesando tu micro (${this.micro.procesado.join(", ")}). La voz del podcast no saldrá en bruto.`
        : null;
    } catch (error) {
      this.error = `No se pudo abrir el micro: ${error.message}`;
    }
    this.refrescar();
  }

  async empezarTramo() {
    // Nunca una grabación encima de otra: la anterior quedaría grabando sin control.
    if (this.ocupado || this.grabando || this.problemaNavegador) return;
    this.ocupado = true;
    try {
      const tramo = (this.manifiesto?.tramos ?? 0) + 1;
      if (!this.micro) await this.probarMicro(localStorage.getItem(`${ID}.micro`) || undefined);
      if (!this.micro) return;

      const iniciar = async p => {
        const prefijo = `${p.tipo}-${tramo}`;
        await p.iniciar(this.ruta, prefijo);
        p.alCambiar = () => this.refrescar();
        this.pistas.push(p);
        await this.guardarManifiesto({
          tramos: tramo, estado: "grabando",
          pistas: { ...this.manifiesto?.pistas, [prefijo]: { tipo: p.tipo, sampleRate: p.ctx.sampleRate, canales: p.canales, ...p.info } }
        });
        this.aplicarPausa();
      };

      // La voz, siempre ya.
      this.pistas = [];
      await iniciar(this.micro);

      // Las pistas de Foundry, cuando su audio esté disponible: Foundry lo desbloquea con el
      // primer clic en la página, y la voz no puede quedarse esperando a eso.
      const canales = game.user.isGM ? this.canalesFoundry : [];
      if (canales.length) {
        if (canales.includes("musica")) {
          this.soltarMusica = registrarMusica(e => anadirLinea(this.ruta, "musica.txt", { serverMs: ahora(), ...e }).catch(() => {}));
        }
        const foundry = async () => {
          if (!this.grabando) return; // se paró mientras tanto
          try { for (const p of await pistasFoundry(canales)) await iniciar(p); }
          catch (error) { this.error = `No se pudo grabar la música de Foundry: ${error.message}`; }
          this.refrescar();
        };
        if (game.audio.locked) {
          ui.notifications.info("MR · Chronicle: tu voz ya se graba. La música de Foundry empezará a grabarse en cuanto hagas clic en la mesa.");
          game.audio.unlock.then(foundry);
        } else await foundry();
      }
    } catch (error) {
      this.error = `No se pudo empezar a grabar: ${error.message}`;
      console.error(error);
    } finally {
      this.ocupado = false;
      this.refrescar();
    }
  }

  async detenerTodo() {
    this.soltarMusica?.();
    this.soltarMusica = null;
    const habia = this.pistas.length;
    await Promise.all(this.pistas.map(p => p.detener()));
    this.pistas = [];
    this.micro = null; // detener() ya soltó el micro
    if (habia && this.manifiesto) await this.guardarManifiesto({ estado: "finalizada" });
  }

  pausar(pausa) {
    this.pausaPropia = pausa;
    this.marcar(pausa ? "pausa" : "reanuda");
    this.aplicarPausa();
    this.refrescar();
  }

  aplicarPausa() {
    const pausa = this.pausaPropia || this.sesion?.fase === "pausada";
    for (const p of this.pistas) p.pausar(pausa);
  }

  /** tipo: momento | cortar | pausa | reanuda */
  async marcar(tipo, texto = "") {
    if (!this.grabando) return ui.notifications.warn("MR · Chronicle: no estás grabando.");
    await anadirLinea(this.ruta, "marcadores.txt", { serverMs: ahora(), tipo, texto });
    if (["momento", "cortar"].includes(tipo)) ui.notifications.info(tipo === "cortar" ? "Marcado para cortar." : "Momento marcado.");
  }

  async guardarManifiesto(cambios) {
    const s = this.sesion;
    this.manifiesto = foundry.utils.mergeObject(this.manifiesto ?? {
      schemaVersion: 1,
      usuario: { id: game.user.id, nombre: game.user.name, esGM: game.user.isGM },
      consentimiento: { grabar: false, publicar: false, fecha: null },
      tramos: 0, pistas: {}, estado: "preparada",
      navegador: navigator.userAgent
    }, { sesion: s, ...cambios }, { inplace: false });
    this.manifiesto.usuario.personaje = game.user.character?.name ?? null;
    await escribirJSON(this.ruta, "manifiesto.json", this.manifiesto);
  }

  // ─── Entrega ────────────────────────────────────────────────────────────

  async entregar(modo) {
    const progreso = (hechos, total) => { this.entrega = { hechos, total }; this.refrescar(); };
    this.entrega = { hechos: 0, total: 0 };
    try {
      const total = modo === "descargar"
        ? await descargar({ rutaLocal: this.ruta, sesionId: this.sesion.id, carpeta: game.user.name.replace(/[\\/:*?"<>|]/g, "-"), progreso })
        : await subir({ rutaLocal: this.ruta, sesionId: this.sesion.id, userId: game.user.id, progreso, pedirCarpeta: () => this.pedirCarpeta() });
      this.entrega = { hechos: total, total, fin: modo };
      await this.guardarManifiesto({ entregado: modo });
    } catch (error) {
      if (error.name === "AbortError") this.entrega = null;
      else this.entrega = { ...this.entrega, error: error.message };
    }
    this.refrescar();
  }

  pedirCarpeta() {
    const { id } = this.sesion;
    if (game.user.isGM) return crearCarpetas(id, game.user.id);
    if (!game.users.activeGM) throw new Error("El máster tiene que estar conectado para crear tu carpeta en el servidor. Si no puede, usa «Descargar».");
    return new Promise((resolve, reject) => {
      const temporizador = setTimeout(() => reject(new Error("El máster no ha respondido. Prueba otra vez o usa «Descargar».")), 15000);
      this.esperandoCarpeta = msg => {
        clearTimeout(temporizador);
        this.esperandoCarpeta = null;
        msg.error ? reject(new Error(msg.error)) : resolve();
      };
      this.emitir({ tipo: "carpeta", sesionId: id, userId: game.user.id });
    });
  }

  async borrarLocal() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Borrar grabación local" },
      content: "<p>Se borrará de este navegador tu grabación de esta sesión. Hazlo solo si ya la has entregado.</p>"
    });
    if (!ok) return;
    await borrar(this.ruta);
    this.manifiesto = null;
    this.entrega = null;
    this.refrescar();
  }

  async hayLocal() {
    return this.sesion ? existe(this.ruta) : false;
  }

  // ─── Estado compartido ──────────────────────────────────────────────────

  emitir(msg) { game.socket.emit(SOCKET, msg); }

  async alRecibir(msg) {
    if (msg.tipo === "estado") {
      this.estados.set(msg.estado.userId, msg.estado);
      this.panel?.refrescarMesa();
    } else if (msg.tipo === "hola") {
      this.emitirEstado();
    } else if (msg.tipo === "carpeta" && game.users.activeGM?.isSelf) {
      let error = null;
      try { await crearCarpetas(msg.sesionId, msg.userId); }
      catch (e) { error = e.message; }
      this.emitir({ tipo: "carpetaLista", userId: msg.userId, error });
    } else if (msg.tipo === "carpetaLista" && msg.userId === game.user.id) {
      this.esperandoCarpeta?.(msg);
    }
  }

  get miEstado() {
    const voz = this.pistas.find(p => p.tipo === "voz");
    return {
      userId: game.user.id,
      acepta: Boolean(this.manifiesto?.consentimiento.grabar),
      publica: Boolean(this.manifiesto?.consentimiento.publicar),
      micro: Boolean(this.micro),
      nivel: this.micro?.nivel ?? 0,
      grabando: this.grabando,
      pausa: this.pausaPropia,
      segundos: voz?.segundos ?? 0,
      // Lo escrito de verdad en el disco: la prueba de que se está grabando.
      guardadoMB: Math.round(this.pistas.reduce((t, p) => t + (p.bytes ?? 0), 0) / 1e6),
      pistas: this.pistas.length,
      entregado: this.manifiesto?.entregado ?? null,
      error: this.error ?? this.pistas.flatMap(p => p.errores ?? [])[0] ?? null,
      microEncendido: this.micro?.estadoMicro.encendido ?? false,
      captando: this.micro?.estadoMicro.captando ?? false,
      problema: this.problemaNavegador?.codigo ?? null
    };
  }

  emitirEstado() {
    if (!this.sesion) return;
    const estado = this.miEstado;
    this.estados.set(game.user.id, estado);
    this.emitir({ tipo: "estado", estado });
    this.indicador();
    this.panel?.refrescarMesa();
  }

  // ─── Interfaz ───────────────────────────────────────────────────────────

  abrirPanel() {
    this.panel ??= new this.Panel();
    this.panel.render({ force: true });
  }

  refrescar() {
    this.emitirEstado();
    this.indicador();
    if (this.panel?.rendered) this.panel.render();
  }

  /**
   * Milisegundos que faltan para que empiece la grabación (0 si no hay cuenta atrás).
   * Más de la cuenta atrás no puede faltar: si pasa, es que el servidor se reinició (su hora
   * vuelve a cero) y la sesión ya había empezado.
   */
  get faltaParaEmpezar() {
    const s = this.sesion;
    if (s?.fase !== "grabando" || !s.inicioServerMs) return 0;
    const falta = s.inicioServerMs - ahora();
    return falta > 0 && falta <= CUENTA_ATRAS_MS + 1000 ? falta : 0;
  }

  quitarCuenta() {
    clearInterval(this.intervaloCuenta);
    document.getElementById("mr-chronicle-cuenta")?.remove();
  }

  /** Cuenta atrás a pantalla completa, sincronizada con la hora del servidor. */
  cuentaAtras(empiezaServerMs, acepto) {
    let el = document.getElementById("mr-chronicle-cuenta");
    if (!el) {
      el = document.createElement("div");
      el.id = "mr-chronicle-cuenta";
      document.body.append(el);
    }
    clearInterval(this.intervaloCuenta);
    const pintar = () => {
      const falta = empiezaServerMs - ahora();
      if (falta <= -1200) { clearInterval(this.intervaloCuenta); return el.remove(); }
      el.dataset.fase = falta > 0 ? "cuenta" : "ya";
      el.innerHTML = falta > 0
        ? `<span class="mrc-cuenta-texto">La grabación empieza en</span><span class="mrc-cuenta-numero">${Math.ceil(falta / 1000)}</span>`
          + `<span class="mrc-cuenta-nota">${acepto ? "Todos a la vez: no hace falta que pulses nada." : "A ti no se te va a grabar: no has aceptado."}</span>`
        : `<span class="mrc-cuenta-numero">● Grabando</span>`;
    };
    pintar();
    this.intervaloCuenta = setInterval(pintar, 100);
  }

  indicador() {
    let el = document.getElementById("mr-chronicle-indicador");
    const s = this.sesion;
    if (!s && !game.user.isGM) return el?.remove();
    if (!el) {
      el = document.createElement("button");
      el.id = "mr-chronicle-indicador";
      el.type = "button";
      el.addEventListener("click", () => this.abrirPanel());
      document.body.append(el);
    }
    const pausa = this.pausaPropia || s?.fase === "pausada";
    const acepto = this.manifiesto?.consentimiento.grabar;
    let estado = this.grabando ? (pausa ? "pausa" : "grabando") : s?.fase ?? "inactivo";
    // La sesión graba pero este equipo no (aún no aceptó, o espera un clic tras recargar).
    if (!this.grabando && ["grabando", "pausada"].includes(estado)) estado = acepto ? "espera" : "ajena";
    const falta = this.faltaParaEmpezar;
    if (!this.grabando && falta > 0) estado = "cuenta";
    el.dataset.estado = estado;
    const tiempo = reloj(this.miEstado.segundos);
    el.textContent = {
      grabando: `● Grabando · ${tiempo}`,
      pausa: `❚❚ En pausa · ${tiempo}`,
      preparada: "MR · Chronicle · preparada",
      finalizada: "MR · Chronicle · entregar",
      espera: "MR · Chronicle · haz clic en la mesa para seguir grabando",
      cuenta: `MR · Chronicle · la grabación empieza en ${Math.ceil(falta / 1000)}`,
      ajena: "MR · Chronicle · sesión en marcha (no te grabas)",
      inactivo: "MR · Chronicle"
    }[estado] ?? "MR · Chronicle";
    el.title = "Abrir MR · Chronicle";
  }
}

export const chronicle = new Chronicle();
