/**
 * Coordinación de la sesión.
 *
 * El control lo lleva el máster con el ajuste de mundo `sesion`: Foundry lo reparte a todos los
 * clientes y lo conserva si alguien recarga. El socket del módulo solo lleva el estado de cada
 * participante (para el panel) y la petición de crear carpetas en el servidor.
 *
 * sesion = {id, nombre, fase: preparada|grabando|pausada|finalizada, inicioServerMs, finServerMs, grabarFoundry}
 */
import { pistaMicro } from "./grabadora.mjs";
import { pistasFoundry, registrarMusica } from "./foundry-audio-tap.mjs";
import { RAIZ, escribirJSON, leerJSON, anadirLinea, borrar, existe } from "./opfs.mjs";
import { ahora, sincronizar } from "./tiempo.mjs";
import { subir, descargar, crearCarpetas } from "./entrega.mjs";

export const ID = "mr-chronicle";
const SOCKET = `module.${ID}`;
const ESTADO_CADA_MS = 3000;

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
  get puedeGrabar() { return Boolean(navigator.userAgentData?.brands?.some(b => b.brand === "Chromium")); }

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
    game.socket.on(SOCKET, msg => this.alRecibir(msg));
    this.indicador();
    setInterval(() => this.emitirEstado(), ESTADO_CADA_MS);
    await sincronizar();
    this.emitir({ tipo: "hola" });
    await this.alCambiarSesion(true);
  }

  // ─── Máster ─────────────────────────────────────────────────────────────

  async preparar(nombre, grabarFoundry) {
    const fecha = new Date();
    const pad = n => String(n).padStart(2, "0");
    const slug = (nombre || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const id = `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())}-${pad(fecha.getHours())}${pad(fecha.getMinutes())}${slug ? `-${slug}` : ""}`;
    await game.settings.set(ID, "sesion", { id, nombre: nombre || id, fase: "preparada", grabarFoundry, inicioServerMs: null, finServerMs: null });
  }

  async fase(fase) {
    const s = { ...this.sesion, fase };
    if (fase === "grabando" && !s.inicioServerMs) Object.assign(s, { inicioServerMs: ahora(), inicioEpochMs: Date.now() });
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
    if (!s) {
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

    if (s.fase === "preparada" && !acepto) this.abrirPanel();
    if (["grabando", "pausada"].includes(s.fase) && acepto && !this.grabando) {
      if (alCargar) {
        ui.notifications.info("MR · Chronicle: tu grabación seguirá en cuanto hagas clic en la mesa.");
        await game.audio.unlock;
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
    try { localStorage.setItem(`${ID}.micro`, deviceId ?? ""); } catch { /* sin almacenamiento local */ }
    await navigator.storage.persist?.();
    const previo = this.manifiesto?.consentimiento;
    await this.guardarManifiesto({
      consentimiento: { grabar: true, publicar, fecha: previo?.fecha ?? new Date().toISOString() }
    });
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
    if (this.ocupado) return;
    this.ocupado = true;
    try {
      const tramo = (this.manifiesto?.tramos ?? 0) + 1;
      if (!this.micro) await this.probarMicro(localStorage.getItem(`${ID}.micro`) || undefined);
      if (!this.micro) return;
      const pistas = [this.micro];
      if (game.user.isGM && this.sesion.grabarFoundry) pistas.push(...await pistasFoundry());

      const info = {};
      for (const p of pistas) {
        const prefijo = `${p.tipo}-${tramo}`;
        await p.iniciar(this.ruta, prefijo);
        p.alCambiar = () => this.refrescar();
        info[prefijo] = { tipo: p.tipo, sampleRate: p.ctx.sampleRate, canales: p.canales, ...p.info };
      }
      this.pistas = pistas;
      if (game.user.isGM && this.sesion.grabarFoundry) {
        this.soltarMusica = registrarMusica(e => anadirLinea(this.ruta, "musica.txt", { serverMs: ahora(), ...e }));
      }
      await this.guardarManifiesto({ tramos: tramo, pistas: { ...this.manifiesto?.pistas, ...info }, estado: "grabando" });
      this.aplicarPausa();
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
        ? await descargar({ rutaLocal: this.ruta, nombreCarpeta: `${this.sesion.id}-${game.user.name}`, progreso })
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
      minutos: voz?.minutos ?? 0,
      pistas: this.pistas.length,
      entregado: this.manifiesto?.entregado ?? null,
      error: this.error ?? this.pistas.flatMap(p => p.errores ?? [])[0] ?? null,
      navegador: this.puedeGrabar
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
    el.dataset.estado = estado;
    const minutos = this.miEstado.minutos;
    const reloj = `${Math.floor(minutos / 60)}:${String(Math.floor(minutos % 60)).padStart(2, "0")}`;
    el.textContent = {
      grabando: `● Grabando · ${reloj}`,
      pausa: `❚❚ En pausa · ${reloj}`,
      preparada: "MR · Chronicle · preparada",
      finalizada: "MR · Chronicle · entregar",
      espera: "MR · Chronicle · haz clic en la mesa para seguir grabando",
      ajena: "MR · Chronicle · sesión en marcha (no te grabas)",
      inactivo: "MR · Chronicle"
    }[estado] ?? "MR · Chronicle";
    el.title = "Abrir MR · Chronicle";
  }
}

export const chronicle = new Chronicle();
