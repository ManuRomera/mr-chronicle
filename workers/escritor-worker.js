/**
 * Escritor de trozos. Un Worker por pista.
 *
 * Recibe bloques int16 del worklet y los escribe en OPFS como WAV de 60 s:
 * `<prefijo>-000001.wav`, `<prefijo>-000002.wav`… La cabecera se escribe al abrir el trozo
 * y se corrige al cerrarlo; si el navegador muere a mitad, la postproducción no se fía de
 * la cabecera y usa el tamaño del archivo, así que no se pierde nada ya escrito.
 */
const SEGUNDOS_POR_TROZO = 60;

let cfg = null;      // {ruta, prefijo, sampleRate, canales}
let dir = null;
let trozo = null;    // {handle, bytes, n}
let n = 0;
let framesPorTrozo = 0;

self.onmessage = async ({ data }) => {
  if (data.iniciar) {
    try {
      cfg = data.iniciar;
      framesPorTrozo = cfg.sampleRate * SEGUNDOS_POR_TROZO;
      dir = await navigator.storage.getDirectory();
      for (const parte of cfg.ruta) dir = await dir.getDirectoryHandle(parte, { create: true });
      data.puerto.onmessage = ({ data }) => escribir(data);
      self.postMessage({ listo: true });
    } catch (error) {
      self.postMessage({ error: `No se pudo preparar el almacenamiento: ${error.message}` });
    }
  }
};

async function abrir() {
  n += 1;
  const nombre = `${cfg.prefijo}-${String(n).padStart(6, "0")}.wav`;
  const archivo = await dir.getFileHandle(nombre, { create: true });
  const handle = await archivo.createSyncAccessHandle();
  handle.truncate(0);
  handle.write(cabecera(0), { at: 0 });
  trozo = { handle, bytes: 0 };
}

function cerrar() {
  if (!trozo) return;
  trozo.handle.write(cabecera(trozo.bytes), { at: 0 });
  trozo.handle.flush();
  trozo.handle.close();
  trozo = null;
}

// Los mensajes llegan en orden, pero abrir() es asíncrono: se encadenan para no solaparse.
let cola = Promise.resolve();
function escribir(msg) {
  cola = cola.then(async () => {
    try {
      let datos = new Uint8Array(msg.datos.buffer, msg.datos.byteOffset, msg.datos.byteLength);
      const bytesPorTrozo = framesPorTrozo * cfg.canales * 2;
      while (datos.length) {
        if (!trozo) await abrir();
        const cabe = Math.min(datos.length, bytesPorTrozo - trozo.bytes);
        trozo.handle.write(datos.subarray(0, cabe), { at: 44 + trozo.bytes });
        trozo.bytes += cabe;
        datos = datos.subarray(cabe);
        if (trozo.bytes >= bytesPorTrozo) cerrar();
      }
      if (trozo) trozo.handle.flush();
      if (msg.fin) {
        cerrar();
        self.postMessage({ cerrado: true, trozos: n });
      }
    } catch (error) {
      // Lo más probable: disco lleno. Se avisa; lo ya escrito sigue a salvo.
      self.postMessage({ error: `Error al escribir: ${error.message}` });
    }
  });
}

function cabecera(bytesDatos) {
  const { sampleRate, canales } = cfg;
  const b = new DataView(new ArrayBuffer(44));
  const texto = (o, s) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  texto(0, "RIFF");
  b.setUint32(4, 36 + bytesDatos, true);
  texto(8, "WAVE");
  texto(12, "fmt ");
  b.setUint32(16, 16, true);
  b.setUint16(20, 1, true);                       // PCM
  b.setUint16(22, canales, true);
  b.setUint32(24, sampleRate, true);
  b.setUint32(28, sampleRate * canales * 2, true);
  b.setUint16(32, canales * 2, true);
  b.setUint16(34, 16, true);
  texto(36, "data");
  b.setUint32(40, bytesDatos, true);
  return new Uint8Array(b.buffer);
}
