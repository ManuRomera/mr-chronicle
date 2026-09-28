/**
 * MR · Chronicle — grabación multipista de la partida para podcast.
 * Diseño completo: docs/MR_Chronicle.md
 */
import { chronicle } from "./module/sesion.mjs";
import { Panel } from "./module/panel.mjs";

chronicle.Panel = Panel;

Hooks.once("init", () => chronicle.registrar());
Hooks.once("ready", () => chronicle.preparado());

// Aviso al cerrar o recargar la pestaña mientras se graba: lo grabado está a salvo,
// pero hasta que se vuelva no se graba nada.
window.addEventListener("beforeunload", evento => {
  if (chronicle.grabando) evento.preventDefault();
});
