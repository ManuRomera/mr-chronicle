/**
 * Entrega de la grabación: subida trozo a trozo al servidor de Foundry, o descarga local.
 *
 * Por qué trozo a trozo: el servidor de Foundry (express-fileupload, sin límites ni archivos
 * temporales) guarda cada subida entera en RAM. Trozos de 60 s (≈ 6 MB) no le afectan.
 * Por qué pedir la carpeta al máster: solo un usuario con rol de Asistente o superior puede
 * crear carpetas en el servidor.
 */
import { listar } from "./opfs.mjs";

const FP = () => foundry.applications.apps.FilePicker.implementation;

/** Lo que hay en este navegador; error si no hay ni un trozo de audio. */
async function grabacionLocal(rutaLocal) {
  const archivos = await listar(rutaLocal).catch(() => []);
  if (!archivos.some(a => /\.(wav|ogg)$/.test(a.nombre))) {
    throw new Error("En este navegador no hay ninguna grabación de esta sesión. Si grabaste en otro navegador u ordenador, entrégala desde allí.");
  }
  return archivos;
}

export const rutaServidor = (sesionId, userId) => `mr-chronicle/${sesionId}/${userId}`;

/** La crea quien pueda (el máster). Ignora las carpetas que ya existen. */
export async function crearCarpetas(sesionId, userId) {
  let ruta = "";
  for (const parte of rutaServidor(sesionId, userId).split("/")) {
    ruta = ruta ? `${ruta}/${parte}` : parte;
    try { await FP().createDirectory("data", ruta, { notify: false }); }
    catch (error) { if (!/exist/i.test(error.message)) throw error; }
  }
}

async function enServidor(destino) {
  if (!game.user.can("FILES_BROWSE")) return null; // no se puede comprobar: se sube todo
  try {
    const { files } = await FP().browse("data", destino);
    return new Set(files.map(f => decodeURIComponent(f.split("/").pop())));
  } catch { return new Set(); }
}

/**
 * @param {string[]} rutaLocal       carpeta OPFS de la sesión de este usuario
 * @param {Function} pedirCarpeta    async () => void (la crea el máster)
 * @param {Function} progreso        (hechos, total) => void
 */
export async function subir({ rutaLocal, sesionId, userId, pedirCarpeta, progreso }) {
  if (!game.user.can("FILES_UPLOAD")) {
    throw new Error("No tienes permiso para subir archivos. El máster debe activarlo para el rol Jugador en Configurar permisos, o usa «Descargar».");
  }
  const destino = rutaServidor(sesionId, userId);
  await pedirCarpeta();
  const ya = await enServidor(destino) ?? new Set();

  // Primero el audio, luego las anclas y marcadores, y el manifiesto el último:
  // si el manifiesto está en el servidor, la entrega está completa.
  const orden = n => n.endsWith(".wav") ? 0 : n === "manifiesto.json" ? 2 : 1;
  const archivos = (await grabacionLocal(rutaLocal)).sort((a, b) => orden(a.nombre) - orden(b.nombre));
  const pendientes = archivos.filter(a => !ya.has(a.nombre));

  let hechos = archivos.length - pendientes.length;
  progreso(hechos, archivos.length);
  for (const { nombre, archivo } of pendientes) {
    let respuesta = null;
    for (let intento = 0; intento < 3 && !respuesta?.path; intento++) {
      respuesta = await FP().upload("data", destino, archivo, {}, { notify: false });
    }
    if (!respuesta?.path) throw new Error(`No se pudo subir ${nombre}. Vuelve a pulsar «Entregar»: solo se subirá lo que falte.`);
    progreso(++hechos, archivos.length);
  }

  const final = await enServidor(destino);
  if (final && archivos.some(a => !final.has(a.nombre))) {
    throw new Error("Faltan archivos en el servidor. Vuelve a pulsar «Entregar».");
  }
  return archivos.length;
}

/**
 * Copia la grabación a una carpeta que elija el participante, como `<sesion>/<nombre>/`.
 * Si todos eligen la misma carpeta compartida de Google Drive, MEGA o Dropbox (la que su
 * programa de sincronización tiene en el ordenador), las grabaciones se juntan solas y
 * cualquiera del grupo puede procesar la sesión.
 */
export async function descargar({ rutaLocal, sesionId, carpeta, progreso }) {
  const archivos = await grabacionLocal(rutaLocal);
  const elegida = await window.showDirectoryPicker({ id: "mr-chronicle", mode: "readwrite" });
  const sesion = elegida.name === sesionId ? elegida : await elegida.getDirectoryHandle(sesionId, { create: true });
  const dir = await sesion.getDirectoryHandle(carpeta, { create: true });
  let hechos = 0;
  for (const { nombre, archivo } of archivos) {
    const w = await (await dir.getFileHandle(nombre, { create: true })).createWritable();
    await archivo.stream().pipeTo(w);
    progreso(++hechos, archivos.length);
  }
  return archivos.length;
}
