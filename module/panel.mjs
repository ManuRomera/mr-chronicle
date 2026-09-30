/**
 * Panel de MR · Chronicle. Una sola ventana para todos: el máster ve además los controles
 * de la sesión. La lista de participantes y el medidor se actualizan solos, sin repintar
 * el resto (para no cerrar desplegables ni borrar lo que se está escribiendo).
 */
import { ConMemoria } from "./memoria.mjs";
import { chronicle, ID, reloj, CANALES } from "./sesion.mjs";

/** La última elección de pistas de Foundry del máster, para proponerla en la siguiente sesión. */
const CLAVE_CANALES = `${ID}.canales`;
function canalesRecordados() {
  try { return JSON.parse(localStorage.getItem(CLAVE_CANALES)) ?? {}; } catch { return {}; }
}

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

// Lo que cuesta consultar se guarda un rato: el panel se repinta a menudo.
let micros = null;
navigator.mediaDevices?.addEventListener?.("devicechange", () => { micros = null; });
async function microsDisponibles() {
  try { micros ??= (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput"); }
  catch { micros = []; }
  return micros;
}
let espacio = { gb: null, en: -Infinity };
async function espacioLibreGB() {
  if (performance.now() - espacio.en > 30_000) {
    try {
      const { quota, usage } = await navigator.storage.estimate();
      espacio = { gb: Number(((quota - usage) / 1e9).toFixed(1)), en: performance.now() };
    } catch { espacio = { gb: null, en: performance.now() }; }
  }
  return espacio.gb;
}


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
      entregar: (e, b) => chronicle.entregar(b.dataset.modo, b.dataset.sesion || undefined),
      borrarLocal: (e, b) => chronicle.borrarLocal(b.dataset.sesion || undefined)
    }
  };

  static PARTS = {
    principal: { template: `${RUTA}/panel.hbs` },
    mesa: { template: `${RUTA}/mesa.hbs` }
  };

  async _prepareContext(opciones) {
    const s = chronicle.sesion;
    const base = { s, finalizada: s?.fase === "finalizada" };
    // Si solo se repinta la lista de participantes, no hace falta nada más.
    if (opciones.parts?.length && !opciones.parts.includes("principal")) return base;

    const yo = chronicle.miEstado;
    const elegido = chronicle.micro?.deviceId ?? localStorage.getItem(`${ID}.micro`) ?? "";
    const e = chronicle.entrega;
    const libreGB = await espacioLibreGB();
    const biblioteca = await chronicle.biblioteca();
    return {
      ...base,
      esGM: game.user.isGM,
      faseTexto: FASES[s?.fase] ?? "",
      canales: Object.entries(CANALES).map(([id, nombre]) => ({
        id, nombre, marcado: s ? chronicle.canalesFoundry.includes(id) : Boolean(canalesRecordados()[id])
      })),
      canalesElegidos: chronicle.canalesFoundry.map(c => CANALES[c].toLowerCase()).join(", "),
      problema: chronicle.problemaNavegador?.texto ?? null,
      sinHttps: chronicle.problemaNavegador?.codigo === "https" ? chronicle.problemaNavegador : null,
      consentimientos: (() => {
        const activos = game.users.filter(u => u.active).length;
        const faltan = sinConsentimiento().length;
        return { aceptados: activos - faltan, activos, todos: faltan === 0, nadie: faltan === activos };
      })(),
      yo,
      manifiesto: chronicle.manifiesto,
      micros: (await microsDisponibles()).map((d, i) => ({ id: d.deviceId, nombre: d.label || `Micrófono ${i + 1}`, elegido: d.deviceId === elegido })),
      reloj: reloj(yo.segundos),
      fase: s?.fase,
      grabable: ["preparada", "grabando", "pausada"].includes(s?.fase),
      actual: biblioteca.find(b => b.activa) ?? null,
      otras: biblioteca.filter(b => !b.activa),
      puedeSubir: game.user.can("FILES_UPLOAD"),
      // Con el túnel rápido la dirección cambia cada vez: lo que no se guarde ahora no se ve después.
      direccionCambiante: location.hostname.endsWith("trycloudflare.com"),
      entrega: e && {
        ...e,
        porcentaje: e.total ? Math.round((100 * e.hechos) / e.total) : 0
      },
      libreGB,
      pocoEspacio: libreGB !== null && libreGB < (chronicle.soyGrabadorFoundry && chronicle.canalesFoundry.length ? 3 : 2)
    };
  }

  async _preparePartContext(parte, contexto) {
    if (parte !== "mesa") return contexto;
    contexto.participantes = game.users.filter(u => u.active).map(u => {
      const e = chronicle.estados.get(u.id);
      let clase = "gris", texto = "Sin respuesta";
      // Un estado viejo no es prueba de que siga grabando.
      if (e && !u.isSelf && performance.now() - e.recibido > 10_000) [clase, texto] = ["gris", "Sin comunicación"];
      else if (e?.problema) [clase, texto] = ["rojo", PROBLEMAS[e.problema] ?? "No puede grabar"];
      else if (e?.error) [clase, texto] = ["rojo", e.error];
      else if (e?.grabando && !e.microEncendido) [clase, texto] = ["ambar", `Grabando · ${reloj(e.segundos ?? 0)} · micro apagado`];
      else if (e?.grabando) [clase, texto] = e.pausa ? ["ambar", `En pausa · ${reloj(e.segundos ?? 0)}`] : ["verde", `Grabando · ${reloj(e.segundos ?? 0)} · ${e.guardadoMB ?? 0} MB`];
      else if (e?.cierreSinConfirmar) [clase, texto] = ["ambar", "Cierre sin confirmar: que guarde la copia (.zip)"];
      else if (e?.entregado) [clase, texto] = ["verde", e.entregado === "subir" ? "Entregado" : "Copia guardada"];
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

  /** Una sola vez: los cambios de las casillas de canales se escuchan en el formulario. */
  async _onFirstRender(contexto, opciones) {
    await super._onFirstRender?.(contexto, opciones);
    this.element.addEventListener("change", evento => {
      if (!evento.target.name?.startsWith("canal-") || chronicle.sesion?.fase !== "preparada") return;
      const canales = Object.fromEntries(Object.keys(CANALES).map(c =>
        [c, this.element.querySelector(`[name='canal-${c}']`)?.checked ?? false]));
      try { localStorage.setItem(CLAVE_CANALES, JSON.stringify(canales)); } catch { /* sin almacenamiento */ }
      chronicle.elegirCanales(canales);
    });
  }

  async _onRender(contexto, opciones) {
    await super._onRender(contexto, opciones);
    // El medidor solo depende de la parte principal.
    if (opciones.parts?.length && !opciones.parts.includes("principal")) return;
    clearInterval(this.medidor);
    const barra = this.element.querySelector(".mrc-nivel > span");
    const tiempo = this.element.querySelector("[data-mrc-reloj]");
    const guardado = this.element.querySelector("[data-mrc-guardado]");
    const micro = this.element.querySelector("[data-mrc-micro]");
    if (!barra && !tiempo && !micro) return;
    const poner = (el, texto) => { if (el && el.textContent !== texto) el.textContent = texto; };
    let ciclo = 0;
    this.medidor = setInterval(() => {
      const nivel = chronicle.micro?.nivel ?? 0;
      if (barra) {
        barra.style.width = `${Math.min(100, Math.sqrt(nivel) * 100)}%`;
        barra.dataset.saturado = nivel > 0.98;
      }
      if (++ciclo % 8) return; // los textos cambian despacio: cada ~0,5 s basta
      const yo = chronicle.miEstado;
      poner(tiempo, reloj(yo.segundos));
      poner(guardado, `${yo.guardadoMB} MB guardados en este ordenador`);
      if (micro) {
        const estado = !chronicle.micro ? "apagado" : !yo.microEncendido ? "apagado" : yo.captando ? "capta" : "silencio";
        micro.dataset.estado = estado;
        poner(micro, {
          capta: "Micro encendido · captando sonido",
          silencio: "Micro encendido · no capta nada ahora mismo",
          apagado: chronicle.micro ? "Micro apagado o desconectado: al volver a conectarlo, se engancha solo" : "Micro sin abrir: pulsa «Probar micro»"
        }[estado]);
      }
    }, 60);
  }

  async close(opciones) {
    clearInterval(this.medidor);
    return super.close(opciones);
  }

  static async #preparar() {
    const f = new FormData(this.element);
    const canales = Object.fromEntries(Object.keys(CANALES).map(c => [c, f.get(`canal-${c}`) === "on"]));
    try { localStorage.setItem(CLAVE_CANALES, JSON.stringify(canales)); } catch { /* sin almacenamiento */ }
    await chronicle.preparar(f.get("nombre")?.trim(), canales);
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
            + (yoFalto && chronicle.canalesFoundry.length ? "<p>Tú tampoco has aceptado: no se grabará tu voz <strong>ni las pistas de Foundry</strong>.</p>" : "")
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
