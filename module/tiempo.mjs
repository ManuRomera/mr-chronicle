/**
 * Hora del servidor de Foundry vista desde este navegador.
 *
 * Usa la misma petición que Foundry (`socket "time"`), pero en vez de la media de latencias
 * se queda con la muestra de menor ida y vuelta, que es la que menos error tiene.
 * Todo se mide con `performance.now()`, que es monótono (no salta si cambia la hora del sistema).
 *
 * Una sola medición compartida: todas las pistas de este cliente usan la misma, y mientras una
 * está en curso las demás la esperan en vez de lanzar otra.
 */
const MUESTRAS = 8;
const ESPERA_MS = 2000;

let ultimo = null;      // {offset, rttMs}: horaServidor = performance.now() + offset
let medidoEn = -Infinity;
let enCurso = null;

function pedirHora(esperaMs) {
  return new Promise(resolve => {
    const t0 = performance.now();
    const temporizador = setTimeout(() => resolve(null), esperaMs);
    game.socket.emit("time", respuesta => {
      clearTimeout(temporizador);
      const t1 = performance.now();
      if (!Number.isFinite(respuesta?.serverTime)) return resolve(null);
      resolve({ offset: respuesta.serverTime - (t0 + t1) / 2, rttMs: t1 - t0 });
    });
  });
}

/**
 * Mide el desfase. Devuelve null si el servidor no responde (sin conexión).
 * @param {object} [o]
 * @param {number} [o.maxEdadMs]  si la última medida es más reciente, se reutiliza
 * @param {number} [o.plazoMs]    tiempo máximo total esperando al servidor
 */
export function sincronizar({ maxEdadMs = 10_000, plazoMs = 16_000 } = {}) {
  if (ultimo && performance.now() - medidoEn < maxEdadMs) return Promise.resolve(ultimo);
  enCurso ??= (async () => {
    const limite = performance.now() + plazoMs;
    let mejor = null;
    for (let i = 0; i < MUESTRAS; i++) {
      const queda = limite - performance.now();
      if (queda <= 0) break;
      const m = await pedirHora(Math.min(ESPERA_MS, queda));
      if (m && (!mejor || m.rttMs < mejor.rttMs)) mejor = m;
    }
    if (mejor) { ultimo = mejor; medidoEn = performance.now(); }
    return mejor;
  })().finally(() => { enCurso = null; });
  return enCurso;
}

/** Hora del servidor ahora mismo, con el último desfase conocido. */
export function ahora() {
  return ultimo ? performance.now() + ultimo.offset : game.time.serverTime;
}

export const desfase = () => ultimo;
