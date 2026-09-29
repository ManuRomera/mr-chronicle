/**
 * Procesador de captura. Corre en el hilo de audio.
 *
 * - Convierte a int16 entrelazado y manda bloques al Worker escritor por un puerto propio,
 *   sin pasar por el hilo principal.
 * - Cuenta las muestras escritas: esa cuenta es la posición exacta en el archivo, lo que
 *   permite después corregir la deriva del reloj de la tarjeta de sonido.
 * - Cada segundo manda al hilo principal la pareja (muestra, currentTime); el nivel, 20 veces por segundo.
 * - En pausa escribe silencio: la línea de tiempo nunca se rompe.
 */
const CUANTOS_POR_BLOQUE = 256; // ≈ 0,68 s a 48 kHz

class Captura extends AudioWorkletProcessor {
  constructor({ processorOptions }) {
    super();
    this.canales = processorOptions.canales;
    this.grabando = false;
    this.pausa = false;
    this.fin = false;
    this.frames = 0;         // muestras escritas desde que empezó a grabar
    this.escritor = null;    // MessagePort hacia el Worker
    this.nuevoBloque();
    this.pico = 0;
    this.cuantosMeta = 0;
    this.cuantosNivel = 0;
    this.port.onmessage = ({ data }) => {
      if (data.escritor) this.escritor = data.escritor;
      if ("grabar" in data) { this.grabando = data.grabar; this.cuantosMeta = 0; }
      if ("pausa" in data) this.pausa = data.pausa;
      if (data.fin) this.terminar();
    };
  }

  nuevoBloque() {
    this.bloque = new Int16Array(128 * CUANTOS_POR_BLOQUE * this.canales);
    this.pos = 0;
  }

  enviarBloque(fin = false) {
    const datos = this.bloque.subarray(0, this.pos).slice();
    this.escritor?.postMessage({ datos, fin }, [datos.buffer]);
    this.nuevoBloque();
  }

  terminar() {
    this.enviarBloque(true);
    this.grabando = false;
    this.fin = true;
  }

  process(inputs) {
    if (this.fin) return false;
    const entrada = inputs[0] ?? [];
    const n = entrada[0]?.length ?? 128;

    // Nivel para el medidor, también antes de grabar (sirve para probar el micro).
    for (let i = 0; i < (entrada[0]?.length ?? 0); i++) this.pico = Math.max(this.pico, Math.abs(entrada[0][i]));

    // Nivel para el medidor unas 20 veces por segundo, para que la barra se mueva con fluidez.
    if (++this.cuantosNivel >= 19) {
      this.port.postMessage({ nivel: this.pico });
      this.pico = 0;
      this.cuantosNivel = 0;
    }

    if (this.grabando) {
      if (this.cuantosMeta === 0) {
        // `frames` es la muestra del archivo que corresponde a `currentTime`.
        this.port.postMessage({ frame: this.frames, ctxTime: currentTime });
      }
      this.cuantosMeta = (this.cuantosMeta + 1) % 375; // ≈ 1 s

      for (let i = 0; i < n; i++) {
        for (let c = 0; c < this.canales; c++) {
          const canal = entrada[c] ?? entrada[0];
          const s = this.pausa || !canal ? 0 : Math.max(-1, Math.min(1, canal[i]));
          this.bloque[this.pos++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
      }
      this.frames += n;
      if (this.pos >= this.bloque.length) this.enviarBloque();
    }
    return true;
  }
}

registerProcessor("mr-chronicle-captura", Captura);
