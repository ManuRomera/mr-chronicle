/**
 * Panel de MR · Chronicle. Una sola ventana para todos: el máster ve además los controles
 * de la sesión. La lista de participantes y el medidor se actualizan solos, sin repintar
 * el resto (para no cerrar desplegables ni borrar lo que se está escribiendo).
 */
import { ConMemoria } from "./memoria.mjs";
import { chronicle, ID } from "./sesion.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const RUTA = `modules/${ID}/templates`;

const FASES = {
  preparada: "Preparada: esperando consentimientos",
  grabando: "Grabando",
  pausada: "En pausa",
  finalizada: "Finalizada: toca entregar"
};

const PROBLEMAS = {
  https: "No puede grabar: Foundry sin HTTPS",
  app: "No puede grabar: está en la app de Foundry",
  navegador: "No puede grabar: navegador no compatible"
};

/** Quién está conectado y no ha aceptado grabar (según el último estado recibido). */
const sinConsentimiento = () =>
  game.users.filter(u => u.active && !chronicle.estados.get(u.id)?.acepta);

const minutosATexto = m => `${Math.floor(m / 60)} h ${String(Math.floor(m % 60)).padStart(2, "0")} min`;

export class Panel extends ConMemoria(HandlebarsApplicationMixin(ApplicationV2)) {
  static MEMORIA = "panel";

  static DEFAULT_OPTIONS = {
    id: "mr-chronicle-panel",
    classes: ["mr-chronicle"],
    tag: "form",
    position: { width: 440, height: "auto" },
    window: { title: "MR · Chronicle", icon: "fa-solid fa-microphone-lines", resizable: true },
    form: { handler: () => {}, submitOnChange: false },
    actions: {
      preparar: Panel.#preparar,
      fase: Panel.#fase,
      cerrarSesion: () => chronicle.cerrarSesion(),
      aceptar: Panel.#aceptar,
      retirar: () => chronicle.retirar(),
      probar: Panel.#probar,
      pausarMia: (e, b) => chronicle.pausar(b.dataset.valor === "1"),
      marcar: Panel.#marcar,
      entregar: (e, b) => chronicle.entregar(b.dataset.modo),
      borrarLocal: () => chronicle.borrarLocal()
    }
  };

  static PARTS = {
    principal: { template: `${RUTA}/panel.hbs` },
    mesa: { template: `${RUTA}/mesa.hbs` }
  };

  async _prepareContext() {
    const s = chronicle.sesion;
    const yo = chronicle.miEstado;
    let micros = [];
    try {
      micros = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput");
    } catch { /* sin permisos todavía */ }
    const elegido = chronicle.micro?.deviceId ?? localStorage.getItem(`${ID}.micro`) ?? "";
    const e = chronicle.entrega;
    let libreGB = null;
    try {
      const { quota, usage } = await navigator.storage.estimate();
      libreGB = ((quota - usage) / 1e9).toFixed(1);
    } catch { /* sin estimación */ }
    return {
      esGM: game.user.isGM,
      s,
      faseTexto: FASES[s?.fase] ?? "",
      grabarFoundry: s?.grabarFoundry ?? true,
      problema: chronicle.problemaNavegador?.texto ?? null,
      sinHttps: chronicle.problemaNavegador?.codigo === "https" ? chronicle.problemaNavegador : null,
      consentimientos: (() => {
        const activos = game.users.filter(u => u.active).length;
        const faltan = sinConsentimiento().length;
        return { aceptados: activos - faltan, activos, todos: faltan === 0, nadie: faltan === activos };
      })(),
      yo,
      manifiesto: chronicle.manifiesto,
      micros: micros.map((d, i) => ({ id: d.deviceId, nombre: d.label || `Micrófono ${i + 1}`, elegido: d.deviceId === elegido })),
      minutos: minutosATexto(yo.minutos),
      fase: s?.fase,
      grabable: ["preparada", "grabando", "pausada"].includes(s?.fase),
      finalizada: s?.fase === "finalizada",
      hayLocal: await chronicle.hayLocal(),
      puedeSubir: game.user.can("FILES_UPLOAD"),
      entrega: e && {
        ...e,
        porcentaje: e.total ? Math.round((100 * e.hechos) / e.total) : 0,
        enCurso: !e.fin && !e.error
      },
      libreGB,
      pocoEspacio: libreGB !== null && libreGB < 3
    };
  }

  async _preparePartContext(parte, contexto) {
    if (parte !== "mesa") return contexto;
    contexto.participantes = game.users.filter(u => u.active).map(u => {
      const e = chronicle.estados.get(u.id);
      let clase = "gris", texto = "Sin respuesta";
      if (e?.problema) [clase, texto] = ["rojo", PROBLEMAS[e.problema] ?? "No puede grabar"];
      else if (e?.error) [clase, texto] = ["rojo", e.error];
      else if (e?.grabando) [clase, texto] = e.pausa ? ["ambar", `En pausa · ${minutosATexto(e.minutos)}`] : ["verde", `Grabando · ${minutosATexto(e.minutos)}`];
      else if (e?.entregado) [clase, texto] = ["verde", "Entregado"];
      else if (e?.acepta && contexto.finalizada) [clase, texto] = ["ambar", "Falta entregar"];
      else if (e?.acepta) [clase, texto] = e.micro ? ["verde", "Listo"] : ["ambar", "Aceptó · sin micro"];
      else if (e) [clase, texto] = ["ambar", "Falta consentimiento"];
      return { nombre: u.name, esGM: u.isGM, clase, texto, publica: e?.acepta && !e.publica ? "No publicar" : null };
    });
    return contexto;
  }

  /** Solo la lista de participantes: la llama el estado que llega por el socket. */
  refrescarMesa() {
    if (!this.rendered) return;
    // Si cambia quién ha aceptado, también cambian la nota y el botón de iniciar: se repinta todo.
    const firma = sinConsentimiento().map(u => u.id).join() + "|" + game.users.filter(u => u.active).length;
    if (firma !== this.firma) { this.firma = firma; return this.render(); }
    this.render({ parts: ["mesa"] });
  }

  async _onRender(contexto, opciones) {
    await super._onRender(contexto, opciones);
    clearInterval(this.medidor);
    const barra = this.element.querySelector(".mrc-nivel > span");
    if (barra) {
      this.medidor = setInterval(() => {
        const nivel = chronicle.micro?.nivel ?? 0;
        barra.style.width = `${Math.min(100, Math.sqrt(nivel) * 100)}%`;
        barra.dataset.saturado = nivel > 0.98;
      }, 60);
    }
  }

  async close(opciones) {
    clearInterval(this.medidor);
    return super.close(opciones);
  }

  static async #preparar() {
    const f = new FormData(this.element);
    await chronicle.preparar(f.get("nombre")?.trim(), f.get("grabarFoundry") === "on");
  }

  static async #fase(evento, boton) {
    const fase = boton.dataset.fase;
    // Iniciar: nunca sin consentimientos, y avisando de a quién no se va a grabar.
    if (fase === "grabando" && chronicle.sesion?.fase === "preparada") {
      const faltan = sinConsentimiento();
      if (faltan.length === game.users.filter(u => u.active).length) {
        return ui.notifications.error("MR · Chronicle: nadie ha aceptado todavía. Cada participante tiene que aceptar en su panel antes de iniciar.");
      }
      if (faltan.length) {
        const yoFalto = faltan.some(u => u.isSelf);
        const ok = await foundry.applications.api.DialogV2.confirm({
          window: { title: "Faltan consentimientos" },
          content: `<p>No han aceptado y <strong>no se les grabará</strong>: ${faltan.map(u => foundry.utils.escapeHTML(u.name)).join(", ")}.</p>`
            + (yoFalto && chronicle.sesion.grabarFoundry ? "<p>Tú tampoco has aceptado: no se grabará tu voz <strong>ni la música y los efectos de Foundry</strong>.</p>" : "")
            + "<p>Si alguien acepta después, empezará a grabar en ese momento. ¿Iniciar igualmente?</p>"
        });
        if (!ok) return;
      }
    }
    if (fase === "finalizada") {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Finalizar la sesión" },
        content: "<p>Se detiene la grabación de todos. Después cada uno tendrá que entregar su pista.</p>"
      });
      if (!ok) return;
    }
    await chronicle.fase(fase);
  }

  static async #aceptar() {
    const f = new FormData(this.element);
    await chronicle.aceptar({ grabar: f.get("grabar") === "on", publicar: f.get("publicar") === "on", deviceId: f.get("micro") || undefined });
  }

  static async #probar() {
    const f = new FormData(this.element);
    await chronicle.probarMicro(f.get("micro") || undefined);
  }

  static async #marcar(evento, boton) {
    const campo = this.element.querySelector("[name=marcador]");
    await chronicle.marcar(boton.dataset.tipo, campo?.value.trim() ?? "");
    if (campo) campo.value = "";
  }
}
