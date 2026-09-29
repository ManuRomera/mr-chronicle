/**
 * Almacenamiento privado del navegador (OPFS). Cada participante guarda su sesión en
 * `mr-chronicle/<sesion>/<usuario>/`, con la misma estructura plana que se sube al servidor.
 */
export const RAIZ = "mr-chronicle";

export async function carpeta(ruta, crear = true) {
  let dir = await navigator.storage.getDirectory();
  for (const parte of ruta) dir = await dir.getDirectoryHandle(parte, { create: crear });
  return dir;
}

export async function existe(ruta) {
  try { await carpeta(ruta, false); return true; }
  catch { return false; }
}

export async function listar(ruta) {
  const dir = await carpeta(ruta, false);
  const archivos = [];
  for await (const [nombre, handle] of dir.entries()) {
    if (handle.kind === "file") archivos.push({ nombre, archivo: await handle.getFile() });
  }
  return archivos.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export async function leerJSON(ruta, nombre) {
  try {
    const dir = await carpeta(ruta, false);
    return JSON.parse(await (await (await dir.getFileHandle(nombre)).getFile()).text());
  } catch { return null; }
}

/** Quién se entera de un fallo de escritura (el panel lo muestra en pantalla). */
let alFallar = error => console.error("mr-chronicle | Error de almacenamiento", error);
export const siFalla = fn => { alFallar = fn; };

// Una cola por archivo: dos escrituras al mismo archivo nunca se pisan. Un fallo no bloquea la
// cola, pero sí llega a quien escribía y a la pantalla: una grabación que no se guarda no puede
// pasar en silencio.
const colas = new Map();
function enCola(clave, tarea) {
  const siguiente = (colas.get(clave) ?? Promise.resolve()).then(tarea);
  colas.set(clave, siguiente.catch(() => {}));
  return siguiente.catch(error => { alFallar(error); throw error; });
}

export function escribirJSON(ruta, nombre, datos) {
  return enCola([...ruta, nombre].join("/"), async () => {
    const dir = await carpeta(ruta);
    const w = await (await dir.getFileHandle(nombre, { create: true })).createWritable();
    await w.write(JSON.stringify(datos, null, 2));
    await w.close();
  });
}

/** Añade una línea JSON al final (formato NDJSON, con extensión .txt para poder subirlo). */
export function anadirLinea(ruta, nombre, datos) {
  return enCola([...ruta, nombre].join("/"), async () => {
    const dir = await carpeta(ruta);
    const handle = await dir.getFileHandle(nombre, { create: true });
    const tamano = (await handle.getFile()).size;
    const w = await handle.createWritable({ keepExistingData: true });
    await w.seek(tamano);
    await w.write(JSON.stringify(datos) + "\n");
    await w.close();
  });
}

export async function borrar(ruta) {
  const padre = await carpeta(ruta.slice(0, -1), false);
  await padre.removeEntry(ruta.at(-1), { recursive: true });
}

/** Sesiones guardadas en este navegador para este usuario. */
export async function sesionesLocales(userId) {
  const sesiones = [];
  try {
    const raiz = await carpeta([RAIZ], false);
    for await (const [id, handle] of raiz.entries()) {
      if (handle.kind !== "directory") continue;
      try { await handle.getDirectoryHandle(userId); sesiones.push(id); }
      catch { /* sesión de otro usuario en este navegador */ }
    }
  } catch { /* nunca se ha grabado aquí */ }
  return sesiones.sort();
}
