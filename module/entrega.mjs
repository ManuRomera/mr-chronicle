/**
 * Entrega de la grabación: copia .zip para guardar o subir a una carpeta compartida (Drive,
 * MEGA…), o subida trozo a trozo al servidor de Foundry.
 *
 * Por qué trozo a trozo: el servidor de Foundry (express-fileupload, sin límites ni archivos
 * temporales) guarda cada subida entera en RAM. Trozos de 60 s (≈ 6 MB) no le afectan.
 * Por qué pedir la carpeta al máster: solo un usuario con rol de Asistente o superior puede
 * crear carpetas en el servidor.
 */
import { listar } from "./opfs.mjs";
import { escribirZip, crc32 } from "./zip.mjs";

const FP = () => foundry.applications.apps.FilePicker.implementation;
const esAudio = nombre => /\.(wav|ogg)$/.test(nombre);

/** Lo que hay en este navegador; error si no hay ni un trozo de audio. */
async function grabacionLocal(rutaLocal) {
  // entregas.json es un apunte solo de este navegador (qué se ha guardado o entregado): no viaja.
  const archivos = (await listar(rutaLocal).catch(() => [])).filter(a => !a.nombre.startsWith("inventario") && a.nombre !== "entregas.json");
  if (!archivos.some(a => esAudio(a.nombre))) {
    throw new Error("En este navegador no hay ninguna grabación de esta sesión. Si grabaste en otro navegador u ordenador, entrégala desde allí.");
  }
  return archivos;
}

/** Inventario con tamaño y CRC de cada archivo: la postproducción comprueba con él que no falta ni se ha dañado nada. */
async function inventario(archivos) {
  const lista = [];
  for (const { nombre, archivo } of archivos) {
    lista.push({ nombre, bytes: archivo.size, crc32: crc32(new Uint8Array(await archivo.arrayBuffer())) });
  }
  return { creado: new Date().toISOString(), archivos: lista };
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

/**
 * Tamaño real de un archivo del servidor (null si no está). El audio se mira con HEAD; los
 * textos se descargan, porque Foundry los sirve comprimidos y su Content-Length no es el real.
 */
async function tamanoEnServidor(ruta) {
  try {
    const url = foundry.utils.getRoute(ruta);
    if (esAudio(ruta)) {
      const r = await fetch(url, { method: "HEAD", cache: "no-store" });
      const largo = r.headers.get("content-length");
      if (r.ok && largo !== null) return Number(largo);
      if (!r.ok) return null;
    }
    const r = await fetch(url, { cache: "no-store" });
    return r.ok ? (await r.blob()).size : null;
  } catch { return null; }
}

/** Nombres que ya hay en la carpeta del servidor (null si no hay permiso para mirar). */
async function listaServidor(destino) {
  if (!game.user.can("FILES_BROWSE")) return null;
  try {
    const { files } = await FP().browse("data", destino);
    return new Set(files.map(f => decodeURIComponent(f.split("/").pop())));
  } catch { return new Set(); }
}

/**
 * Sube la grabación. Cada archivo se da por entregado solo si en el servidor tiene exactamente
 * el mismo tamaño que aquí; el inventario (con CRC) va al final.
 * @param {string[]} rutaLocal       carpeta OPFS de la sesión de este usuario
 * @param {Function} pedirCarpeta    async () => void (la crea el máster)
 * @param {Function} progreso        (hechos, total) => void
 */
export async function subir({ rutaLocal, sesionId, userId, pedirCarpeta, progreso }) {
  if (!game.user.can("FILES_UPLOAD")) {
    throw new Error("No tienes permiso para subir archivos. El máster debe activarlo para el rol Jugador en Configurar permisos, o guarda la copia (.zip) y súbela a la carpeta compartida.");
  }
  const destino = rutaServidor(sesionId, userId);
  await pedirCarpeta();

  // Primero el audio, luego las anclas y marcadores, y el manifiesto el último.
  const orden = n => esAudio(n) ? 0 : n === "manifiesto.json" ? 2 : 1;
  const archivos = (await grabacionLocal(rutaLocal)).sort((a, b) => orden(a.nombre) - orden(b.nombre));
  const total = archivos.length + 1;
  let hechos = 0;
  progreso(hechos, total);
  const ya = await listaServidor(destino);

  for (const { nombre, archivo } of archivos) {
    const ruta = `${destino}/${nombre}`;
    // Solo se pregunta el tamaño de lo que ya está (o si no se puede mirar la carpeta).
    let enServidor = !ya || ya.has(nombre) ? await tamanoEnServidor(ruta) : null;
    // Reintentos con pausa creciente; solo se sube si no está o no coincide.
    for (let intento = 0; enServidor !== archivo.size && intento < 4; intento++) {
      if (intento) await new Promise(r => setTimeout(r, 1000 * 2 ** intento));
      await FP().upload("data", destino, archivo, {}, { notify: false });
      enServidor = await tamanoEnServidor(ruta);
    }
    if (enServidor !== archivo.size) {
      throw new Error(enServidor === null
        ? `No se pudo subir ${nombre}. Vuelve a pulsar «Entregar»: solo se subirá lo que falte.`
        : `${nombre} está en el servidor con otro tamaño (versión antigua o incompleta) y Foundry no deja reemplazarlo. Guarda la copia (.zip) y entrégala por la carpeta compartida.`);
    }
    progreso(++hechos, total);
  }

  // Inventario con nombre único: Foundry no deja sobrescribir archivos que no son multimedia.
  const inv = new File([JSON.stringify(await inventario(archivos), null, 2)], `inventario-${Date.now()}.json`, { type: "application/json" });
  await FP().upload("data", destino, inv, {}, { notify: false });
  progreso(++hechos, total);
  return archivos.length;
}

/**
 * Guarda la grabación como un único .zip (sin comprimir) en la carpeta que elija el participante.
 * Es la copia de seguridad y la forma de entregar por una carpeta compartida: el .zip se sube tal
 * cual a Drive o MEGA, y la postproducción lo lee sin descomprimirlo a mano.
 */
export async function guardarCopia({ rutaLocal, sesionId, carpeta, nombreArchivo, progreso }) {
  // El selector se abre lo primero: el navegador exige que venga directamente del clic.
  const destino = await window.showSaveFilePicker({
    id: "mr-chronicle", suggestedName: nombreArchivo,
    types: [{ description: "Copia de la grabación (.zip)", accept: { "application/zip": [".zip"] } }]
  });
  const archivos = await grabacionLocal(rutaLocal);
  const inv = await inventario(archivos);
  const entradas = [
    ...archivos.map(({ nombre, archivo }) => ({ nombre: `${sesionId}/${carpeta}/${nombre}`, archivo })),
    { nombre: `${sesionId}/${carpeta}/inventario.json`, archivo: new Blob([JSON.stringify(inv, null, 2)]) }
  ];
  const w = await destino.createWritable();
  try {
    await escribirZip(bytes => w.write(bytes), entradas, { progreso });
    await w.close();
  } catch (error) {
    await w.abort().catch(() => {});
    throw error;
  }
  return archivos.length;
}
