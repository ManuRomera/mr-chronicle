/**
 * Salidas de audio de Foundry que graba el máster.
 *
 * ÚNICO punto que usa API no documentada: `game.audio.<contexto>.gainNode`, el volumen maestro
 * que Foundry crea en cada AudioContext (client/audio/helper.mjs, V13). Revisar en cada versión
 * mayor de Foundry.
 *
 * No se graba dentro de los contextos de Foundry: usan búfer corto y, con la pestaña en segundo
 * plano, se saltan trozos (en las pruebas, hasta 100 ms en 3 minutos). Su salida se lleva por un
 * MediaStream a un contexto propio de búfer largo, que es el que da la cuenta de muestras.
 */
import { Pista } from "./grabadora.mjs";

export const CONTEXTOS = { musica: "music", ambiente: "environment", efectos: "interface" };

export async function pistasFoundry() {
  await game.audio.unlock; // los contextos se crean con el primer gesto del usuario
  const propio = new AudioContext({ sampleRate: 48000, latencyHint: "playback" });
  const pistas = [];
  for (const [tipo, nombre] of Object.entries(CONTEXTOS)) {
    const ctx = game.audio[nombre];
    if (!ctx?.gainNode) {
      console.warn(`mr-chronicle | Foundry no expone game.audio.${nombre}.gainNode; no se grabará ${tipo}.`);
      continue;
    }
    const puente = ctx.createMediaStreamDestination();
    ctx.gainNode.connect(puente);
    const p = new Pista({
      ctx: propio, fuente: propio.createMediaStreamSource(puente.stream), canales: 2, tipo,
      info: { contexto: nombre, sampleRateFoundry: ctx.sampleRate }
    });
    const soltar = p.soltar.bind(p);
    p.soltar = () => {
      soltar();
      try { ctx.gainNode.disconnect(puente); } catch { /* ya desconectado */ }
      if (pistas.every(q => !q.grabando) && propio.state !== "closed") propio.close();
    };
    await p.preparar();
    pistas.push(p);
  }
  return pistas;
}

/** Registra qué suena y cuándo, para poder rehacer la música con los archivos originales. */
export function registrarMusica(anotar) {
  const campos = ["playing", "volume", "repeat", "pausedTime"];
  const cambio = (tipo, doc, cambios) => {
    if (!campos.some(c => c in cambios)) return;
    anotar({
      evento: tipo,
      lista: doc.parent?.name ?? doc.name,
      sonido: tipo === "sonido" ? doc.name : null,
      ruta: doc.path ?? null,
      ...Object.fromEntries(campos.filter(c => c in cambios).map(c => [c, cambios[c]]))
    });
  };
  // Lo que ya sonaba al empezar a grabar.
  for (const lista of game.playlists.playing) {
    for (const sonido of lista.sounds.filter(x => x.playing)) {
      anotar({ evento: "sonando", lista: lista.name, sonido: sonido.name, ruta: sonido.path, volume: sonido.volume, repeat: sonido.repeat });
    }
  }
  const ids = [
    ["updatePlaylistSound", Hooks.on("updatePlaylistSound", (doc, cambios) => cambio("sonido", doc, cambios))],
    ["updatePlaylist", Hooks.on("updatePlaylist", (doc, cambios) => cambio("lista", doc, cambios))]
  ];
  return () => ids.forEach(([hook, id]) => Hooks.off(hook, id));
}
