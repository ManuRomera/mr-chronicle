/**
 * Casos D01–D08 de la auditoría del 30-09-2026, escritos como comportamiento correcto.
 * Usan dobles del navegador y de Foundry: comprueban la lógica, no sustituyen a una partida real.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "..");

// ─── Dobles ────────────────────────────────────────────────────────────────
let sesion = null;
let opfs = {}; // árbol en memoria: carpetas = objetos, archivos = {size}
function carpetaFalsa(nodo) {
  return {
    kind: "directory",
    async getDirectoryHandle(n, { create } = {}) {
      if (!nodo[n]) { if (!create) throw new Error("NotFound"); nodo[n] = {}; }
      return carpetaFalsa(nodo[n]);
    },
    async getFileHandle(n) { if (!nodo[n]) throw new Error("NotFound"); return { getFile: async () => ({ size: nodo[n].size, text: async () => "" }) }; },
    async *entries() {
      for (const [n, v] of Object.entries(nodo)) {
        yield [n, "size" in v ? { kind: "file", getFile: async () => ({ size: v.size }) } : carpetaFalsa(v)];
      }
    }
  };
}
globalThis.foundry = {
  utils: { getRoute: r => r, mergeObject: (a, b) => ({ ...a, ...b }) },
  applications: { api: { ApplicationV2: class { async _onRender() {} }, HandlebarsApplicationMixin: B => B } }
};
globalThis.window = { isSecureContext: true };
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    userAgent: "Chromium", userAgentData: { brands: [{ brand: "Chromium" }] },
    storage: { getDirectory: async () => carpetaFalsa(opfs) }
  }
});
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.game = {
  settings: { get: () => sesion, set: async (_m, _k, s) => { sesion = s; return s; } },
  user: { id: "u", name: "Ana", isGM: false, isSelf: true },
  users: { has: () => true, get: () => ({}), filter: () => [] },
  world: { id: "mundo" },
  audio: { locked: false },
  time: { serverTime: 0 },
  socket: { emit: (_t, cb) => typeof cb === "function" && cb({ serverTime: 1000 }) }
};
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };

const { chronicle } = await import(path.join(repo, "module/sesion.mjs"));
const { Pista } = await import(path.join(repo, "module/grabadora.mjs"));
const { Panel } = await import(path.join(repo, "module/panel.mjs"));
chronicle.refrescar = () => {};
chronicle.refrescarPanel = () => {};
chronicle.guardarManifiesto = async cambios => { chronicle.manifiesto = { ...chronicle.manifiesto, ...cambios }; };

function reiniciar(fase = "preparada") {
  sesion = { id: "s", fase, canales: {} };
  opfs = {};
  Object.assign(chronicle, {
    pistas: [], micro: null, ocupado: false, soltarMusica: null, pausaPropia: false,
    manifiesto: { sesion: { id: "s" }, consentimiento: { grabar: true } }
  });
}

const pistaFalsa = (tipo = "voz", extra = {}) => ({
  tipo, ctx: { sampleRate: 48000 }, canales: 1, info: {}, grabando: false,
  async iniciar(_ruta, prefijo) { this.prefijo = prefijo; this.grabando = true; },
  async detener() { this.detenida = true; this.grabando = false; return true; },
  soltar() { this.soltada = (this.soltada ?? 0) + 1; },
  pausar(p) { this.pausa = p; },
  ...extra
});

// ─── Casos ─────────────────────────────────────────────────────────────────

test("D01: retirar el consentimiento cierra el micro preparado aunque no haya grabado", async () => {
  reiniciar();
  const micro = pistaFalsa();
  chronicle.micro = micro;
  await chronicle.retirar();
  assert.equal(micro.soltada, 1);
  assert.equal(chronicle.micro, null);
});

test("D02: parar corta la captura al momento, sin esperar a la hora del servidor", async () => {
  const mensajes = [];
  const p = new Pista({ ctx: { sampleRate: 48000 }, fuente: {}, canales: 1, tipo: "voz" });
  Object.assign(p, {
    grabando: true, ruta: ["x"], prefijo: "voz-1", worker: { terminate() {} }, soltar() {},
    nodo: { port: { postMessage: m => { mensajes.push(m); if (m.fin) queueMicrotask(() => p.cerrado?.({ cerrado: true })); } } }
  });
  const fin = p.detener();
  // Antes de cualquier espera ya se ha pedido el fin y la pista ha dejado de grabar.
  assert.deepEqual(mensajes, [{ fin: true }]);
  assert.equal(p.grabando, false);
  assert.equal(await fin, true);
});

test("D03: un inicio pendiente no se queda grabando si mientras tanto se detiene todo", async () => {
  reiniciar("grabando");
  let soltar;
  const pendiente = new Promise(r => { soltar = r; });
  const micro = pistaFalsa("voz", { async iniciar(_r, prefijo) { this.prefijo = prefijo; await pendiente; this.grabando = true; } });
  chronicle.micro = micro;
  const inicio = chronicle.empezarTramo();
  await new Promise(r => setTimeout(r, 10));
  await chronicle.detenerTodo();
  soltar();
  await inicio;
  assert.equal(chronicle.grabando, false);
  assert.equal(chronicle.pistas.length, 0);
  assert.equal(micro.detenida, true);
});

test("D04: los repintados parciales no añaden escuchadores a las casillas", async () => {
  let escuchadores = 0;
  const p = Object.create(Panel.prototype);
  p._memoria = { scroll: {}, secciones: {} };
  p.element = { addEventListener: () => escuchadores++, querySelectorAll: () => [], querySelector: () => null };
  await p._onFirstRender({}, {});
  for (let i = 0; i < 5; i++) await p._onRender({}, { parts: ["mesa"] });
  await p._onRender({}, { parts: ["principal", "mesa"] });
  assert.equal(escuchadores, 1);
});

test("D05: dos sesiones con el mismo nombre en el mismo minuto tienen identificadores distintos", async () => {
  reiniciar();
  await chronicle.preparar("Prueba", {});
  const primero = sesion.id;
  await chronicle.preparar("Prueba", {});
  assert.notEqual(sesion.id, primero);
  assert.equal(sesion.grabadorFoundry, "u");
});

test("D06: «Pausar mi micro» pausa solo la voz; «Pausar a todos», todo", () => {
  reiniciar("grabando");
  chronicle.pistas = ["voz", "musica", "ambiente", "efectos"].map(t => pistaFalsa(t));
  chronicle.pausaPropia = true;
  chronicle.aplicarPausa();
  assert.deepEqual(chronicle.pistas.map(p => p.pausa), [true, false, false, false]);
  sesion.fase = "pausada";
  chronicle.aplicarPausa();
  assert.deepEqual(chronicle.pistas.map(p => p.pausa), [true, true, true, true]);
});

test("D07: una escritura parcial se completa hasta el último byte", async () => {
  const fuente = fs.readFileSync(path.join(repo, "workers/escritor-worker.js"), "utf8").replace(/^import .*;$/m, "");
  const avisos = [];
  const escrito = [];
  const handle = {
    flush() {}, close() {},
    write: (b, { at }) => { const n = Math.ceil(b.length / 2); escrito.push([at, n]); return n; } // escribe la mitad
  };
  const dir = {
    getDirectoryHandle: async () => dir,
    getFileHandle: async () => ({ getFile: async () => ({ size: 0 }), createSyncAccessHandle: async () => handle })
  };
  const ctx = vm.createContext({
    navigator: { storage: { getDirectory: async () => dir } }, self: { postMessage: m => avisos.push(m) },
    Uint8Array, DataView, ArrayBuffer, Promise, Date, Error
  });
  vm.runInContext(fuente, ctx);
  const puerto = {};
  await ctx.self.onmessage({ data: { iniciar: { ruta: [], prefijo: "voz-1", sampleRate: 48000, canales: 1, formato: "wav" }, puerto } });
  puerto.onmessage({ data: { datos: new Int16Array(100), fin: true } });
  await vm.runInContext("cola", ctx);
  assert.equal(avisos.some(m => m.error), false);
  assert.ok(avisos.some(m => m.cerrado));
  // Los 200 bytes de audio quedan escritos (en varias llamadas) a partir del byte 44.
  const audio = escrito.filter(([at]) => at >= 44).reduce((t, [, n]) => t + n, 0);
  assert.equal(audio, 200);
});

test("D08: sin manifiesto pero con audio antiguo, el nuevo tramo no reutiliza voz-1", async () => {
  reiniciar("grabando");
  opfs = { "mr-chronicle": { s: { u: { "voz-1-000001.wav": { size: 1000 } } } } };
  chronicle.manifiesto = { sesion: { id: "s" }, consentimiento: { grabar: true } }; // sin «tramos»
  const micro = pistaFalsa();
  chronicle.micro = micro;
  await chronicle.empezarTramo();
  assert.equal(micro.prefijo, "voz-2");
  await chronicle.detenerTodo();
});

test("los estados de otra sesión o de usuarios inexistentes se ignoran", async () => {
  reiniciar();
  chronicle.estados.clear();
  await chronicle.alRecibir({ tipo: "estado", estado: { userId: "otro", sesionId: "vieja", acepta: true } });
  assert.equal(chronicle.estados.size, 0);
  await chronicle.alRecibir({ tipo: "estado", estado: { userId: "otro", sesionId: "s", acepta: true } });
  assert.equal(chronicle.estados.get("otro").acepta, true);
  assert.ok(Number.isFinite(chronicle.estados.get("otro").recibido));
});

test("dos pestañas del mismo usuario: la que graba no la pisa la que está callada, y mi propio estado no se sobrescribe", async () => {
  reiniciar("grabando");
  chronicle.estados.clear();
  await chronicle.alRecibir({ tipo: "estado", estado: { userId: "otro", pestana: "A", sesionId: "s", grabando: true } });
  await chronicle.alRecibir({ tipo: "estado", estado: { userId: "otro", pestana: "B", sesionId: "s", grabando: false } });
  assert.equal(chronicle.estados.get("otro").grabando, true);
  // Si es la misma pestaña, sí se actualiza.
  await chronicle.alRecibir({ tipo: "estado", estado: { userId: "otro", pestana: "A", sesionId: "s", grabando: false } });
  assert.equal(chronicle.estados.get("otro").grabando, false);
  // Un estado mío que llega de otra pestaña no pisa el de esta.
  chronicle.estados.set("u", { userId: "u", grabando: true, recibido: 0 });
  await chronicle.alRecibir({ tipo: "estado", estado: { userId: "u", pestana: "X", sesionId: "s", grabando: false } });
  assert.equal(chronicle.estados.get("u").grabando, true);
});

test("el máster ve que las pistas de Foundry esperan un clic", () => {
  reiniciar("grabando");
  sesion.canales = { musica: true };
  sesion.grabadorFoundry = "u";
  chronicle.pistas = [Object.assign(pistaFalsa("voz"), { grabando: true })];
  game.audio.locked = true;
  assert.equal(chronicle.miEstado.esperaClic, true);
  game.audio.locked = false;
  assert.equal(chronicle.miEstado.esperaClic, false);
  chronicle.pistas = [];
});

test("la biblioteca se guarda un rato y se renueva al borrar o entregar", async () => {
  reiniciar();
  opfs = { "mr-chronicle": { s: { u: { "voz-1-000001.wav": { size: 2_000_000 } } } } };
  const a = await chronicle.biblioteca();
  assert.equal(a.length, 1);
  delete opfs["mr-chronicle"].s;
  assert.equal((await chronicle.biblioteca()).length, 1); // aún en caché
  chronicle.olvidarBiblioteca();
  assert.equal((await chronicle.biblioteca()).length, 0);
});

test("la cola del escritor se avisa en el hilo principal cuando el disco no da abasto", async () => {
  const mensajes = [];
  const p = new Pista({ ctx: { sampleRate: 48000 }, fuente: {}, canales: 1, tipo: "voz" });
  p.grabando = true; p.cola = 40_000_000; p.ultimaEscritura = performance.now();
  p.medir = () => null;
  p.fallo = m => mensajes.push(m);
  await p.anclar();
  assert.match(mensajes[0], /no da abasto/);
});
