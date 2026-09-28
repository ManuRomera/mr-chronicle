/**
 * Memoria de ventanas. Cada ventana del sistema recuerda, por usuario y mundo:
 * posición y tamaño (uno para el modo normal y otro para el compacto), pestaña
 * activa, secciones plegadas, modo compacto y desplazamiento. Una ficha nueva
 * hereda el último tamaño usado para su clase de ventana.
 *
 * Vive en localStorage: es una preferencia de este navegador, no un dato del mundo.
 */
const PREFIJO = "mr-chronicle.ventana.";
const CAMPOS = ["left", "top", "width", "height"];

const clave = id => `${PREFIJO}${game.world?.id}.${game.user?.id}.${id}`;

export function leer(id) {
  try { return JSON.parse(localStorage.getItem(clave(id))) ?? {}; }
  catch { return {}; }
}

function escribir(id, cambios) {
  try { localStorage.setItem(clave(id), JSON.stringify({ ...leer(id), ...cambios })); }
  catch (error) { console.warn("mr-chronicle | No se pudo guardar la ventana", error); }
}

export function olvidarTodo() {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k?.startsWith(PREFIJO)) localStorage.removeItem(k);
  }
}

const numericos = (pos, campos) =>
  Object.fromEntries(campos.filter(c => Number.isFinite(pos?.[c])).map(c => [c, Math.round(pos[c])]));

/**
 * @param {typeof foundry.applications.api.ApplicationV2} Base
 * Opciones estáticas que puede declarar la subclase:
 *  - MEMORIA: identificador fijo (ventanas únicas). Las hojas usan el uuid del documento.
 *  - CAMPOS_MEMORIA: qué dimensiones recordar (los diálogos de alto automático omiten height).
 *  - COMPACTO: {width, height} del modo compacto, si la ventana lo tiene.
 * Opción de instancia `memoria`: identificador para diálogos que comparten clase.
 */
export function ConMemoria(Base) {
  return class extends Base {
    static CAMPOS_MEMORIA = CAMPOS;

    constructor(options = {}) {
      const Clase = new.target;
      const id = options.memoria ?? options.document?.uuid ?? Clase.MEMORIA ?? Clase.name;
      const propia = leer(id);
      const compacto = Boolean(Clase.COMPACTO && propia.compacto);
      const modo = compacto ? "compacta" : "posicion";
      const heredada = propia[modo] ? {} : numericos(leer(`clase.${Clase.name}`)[modo], ["width", "height"]);
      const guardada = numericos(propia[modo], Clase.CAMPOS_MEMORIA);
      const porDefecto = compacto ? Clase.COMPACTO : {};
      super({ ...options, position: { ...options.position, ...porDefecto, ...heredada, ...guardada } });
      this._memoria = { id, compacto, secciones: propia.secciones ?? {}, scroll: propia.scroll ?? {} };
      if (propia.pestanas) Object.assign(this.tabGroups, propia.pestanas);
    }

    get compacto() { return this._memoria.compacto; }

    /** Guardar al moverse o redimensionar (el motor llama a esto tras cada setPosition). */
    _onPosition(position) {
      super._onPosition?.(position);
      if (!this.rendered) return;
      clearTimeout(this._memoria.temporizador);
      this._memoria.temporizador = setTimeout(() => this.#guardarPosicion(), 250);
    }

    #guardarPosicion() {
      // Minimizada, la altura es la de la barra de título: solo vale la posición.
      const campos = this.minimized ? ["left", "top"] : this.constructor.CAMPOS_MEMORIA;
      const modo = this._memoria.compacto ? "compacta" : "posicion";
      const pos = numericos(this.position, campos);
      escribir(this._memoria.id, { [modo]: { ...leer(this._memoria.id)[modo], ...pos } });
      if (!this.minimized) escribir(`clase.${this.constructor.name}`, { [modo]: numericos(this.position, ["width", "height"]) });
    }

    changeTab(tab, group, opciones) {
      super.changeTab(tab, group, opciones);
      escribir(this._memoria.id, { pestanas: { ...this.tabGroups } });
    }

    /** ¿Está abierta esta sección plegable? `porDefecto` si nunca se tocó. */
    abierto(seccion, porDefecto = true) {
      return this._memoria.secciones[seccion] ?? porDefecto;
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      for (const d of this.element.querySelectorAll("details[data-memoria]")) {
        d.addEventListener("toggle", () => this.#recordarSeccion(d.dataset.memoria, d.open));
      }
      if (options.isFirstRender) {
        for (const [selector, top] of Object.entries(this._memoria.scroll)) {
          const el = this.element.querySelector(selector);
          if (el) el.scrollTop = top;
        }
      }
    }

    /**
     * La mesa es compartida: otro jugador puede provocar un repintado mientras escribes.
     * El motor devuelve el foco, pero no el texto aún sin guardar; aquí se conserva.
     */
    _preSyncPartState(partId, nuevo, anterior, estado) {
      super._preSyncPartState?.(partId, nuevo, anterior, estado);
      const campo = document.activeElement;
      if (!anterior.contains(campo) || !campo.name || !campo.matches("input[type=text], textarea")) return;
      estado.escrito = { selector: `${campo.tagName}[name="${campo.name}"]`, valor: campo.value, desde: campo.selectionStart, hasta: campo.selectionEnd };
    }

    _syncPartState(partId, nuevo, anterior, estado) {
      super._syncPartState?.(partId, nuevo, anterior, estado);
      const campo = estado.escrito && nuevo.querySelector(estado.escrito.selector);
      if (!campo) return;
      campo.value = estado.escrito.valor;
      campo.focus();
      campo.setSelectionRange(estado.escrito.desde, estado.escrito.hasta);
    }

    #recordarSeccion(seccion, abierta) {
      this._memoria.secciones[seccion] = abierta;
      escribir(this._memoria.id, { secciones: this._memoria.secciones });
    }

    async close(options) {
      if (this.rendered) {
        const scroll = {};
        for (const selector of this.constructor.SCROLL_MEMORIA ?? []) {
          const el = this.element.querySelector(selector);
          if (el) scroll[selector] = el.scrollTop;
        }
        this.#guardarPosicion();
        escribir(this._memoria.id, { scroll });
      }
      return super.close(options);
    }

    /** Alterna el modo compacto conservando la geometría de cada modo por separado. */
    async alternarCompacto() {
      this.#guardarPosicion();
      const compacto = !this._memoria.compacto;
      this._memoria.compacto = compacto;
      escribir(this._memoria.id, { compacto });
      const guardada = numericos(leer(this._memoria.id)[compacto ? "compacta" : "posicion"], ["width", "height"]);
      const porDefecto = compacto ? this.constructor.COMPACTO : this.constructor.DEFAULT_OPTIONS.position;
      await this.render();
      this.setPosition({ ...numericos(porDefecto, ["width", "height"]), ...guardada });
    }
  };
}
