/**
 * Hora del servidor de Foundry vista desde este navegador.
 *
 * Usa la misma petición que Foundry (`socket "time"`), pero en vez de la media de latencias
 * se queda con la muestra de menor ida y vuelta, que es la que menos error tiene.
 * Todo se mide con `performance.now()`, que es monótono (no salta si cambia la hora del sistema).
 */
const MUESTRAS = 8;
const ESPERA_MS = 2000;

let ultimo = null; // {offset, rttMs}: horaServidor = performance.now() + offset

function pedirHora() {
  return new Promise(resolve => {
    const t0 = performance.now();
    const temporizador = setTimeout(() => resolve(null), ESPERA_MS);
    game.socket.emit("time", respuesta => {
      clearTimeout(temporizador);
      const t1 = performance.now();
      if (!Number.isFinite(respuesta?.serverTime)) return resolve(null);
      resolve({ offset: respuesta.serverTime - (t0 + t1) / 2, rttMs: t1 - t0 });
    });
  });
}

/** Mide el desfase. Devuelve null si el servidor no responde (sin conexión). */
export async function sincronizar() {
  let mejor = null;
  for (let i = 0; i < MUESTRAS; i++) {
    const m = await pedirHora();
    if (m && (!mejor || m.rttMs < mejor.rttMs)) mejor = m;
  }
  if (mejor) ultimo = mejor;
  return mejor;
}

/** Hora del servidor ahora mismo, con el último desfase conocido. */
export function ahora() {
  return ultimo ? performance.now() + ultimo.offset : game.time.serverTime;
}

export const desfase = () => ultimo;
