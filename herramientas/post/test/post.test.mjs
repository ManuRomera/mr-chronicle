import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { regresion, esAlucinacion, marcarEcos, leerNDJSON } from "../lib.mjs";

test("la regresión recupera frecuencia real e inicio pese al ruido", () => {
  const fsReal = 48000 * (1 + 80e-6), inicio = 1_000_000;
  const anclas = Array.from({ length: 40 }, (_, i) => {
    const frame = i * 30 * 48000;
    return { frame, serverMs: inicio + (frame / fsReal) * 1000 + (Math.sin(i * 7) * 3), rttMs: 20 };
  });
  anclas.push({ frame: 10 * 48000, serverMs: inicio + 9000, rttMs: 400 }); // medida mala, se descarta
  const r = regresion(anclas);
  assert.ok(Math.abs(r.fsReal - fsReal) < 0.05, `fsReal ${r.fsReal}`);
  assert.ok(Math.abs(r.a - inicio) < 3);
  assert.equal(r.hueco, false);
  assert.equal(r.anclasUsadas, 40);
});

test("filtra las frases que Whisper se inventa en los silencios", () => {
  assert.ok(esAlucinacion("Subtítulos realizados por la comunidad de Amara.org"));
  assert.ok(esAlucinacion("¡Gracias por ver el vídeo!"));
  assert.ok(esAlucinacion(" ... "));
  assert.ok(!esAlucinacion("Gracias, pero no voy a entrar en esa cripta."));
});

test("marca como eco la frase repetida por otro micro", () => {
  const s = (participantId, startMs, text, confidence) => ({ participantId, startMs, endMs: startMs + 2000, text, confidence, flags: [] });
  const r = marcarEcos([
    s("a", 1000, "Entro con la espada preparada en la mano", 0.9),
    s("b", 1300, "entro con la espada preparada en la mano", 0.4),
    s("b", 9000, "Espera, no entres todavía", 0.8)
  ]);
  assert.deepEqual(r.map(x => x.flags.length), [0, 1, 0]);
});

test("NDJSON cortado a mitad no rompe la lectura", () => {
  assert.equal(leerNDJSON('{"a":1}\n{"a":2}\n{"a":').length, 2);
});

// ─── De extremo a extremo: sesión sintética → pistas alineadas ────────────

const T0 = 1_790_000_000_000;
const DURACION = 300;

function wav(datos, canales = 1, sampleRate = 48000) {
  const c = Buffer.alloc(44);
  c.write("RIFF", 0); c.writeUInt32LE(36 + datos.length, 4); c.write("WAVE", 8); c.write("fmt ", 12);
  c.writeUInt32LE(16, 16); c.writeUInt16LE(1, 20); c.writeUInt16LE(canales, 22); c.writeUInt32LE(sampleRate, 24);
  c.writeUInt32LE(sampleRate * canales * 2, 28); c.writeUInt16LE(canales * 2, 32); c.writeUInt16LE(16, 34);
  c.write("data", 36); c.writeUInt32LE(0, 40); // tamaño a 0: como si el navegador hubiera muerto
  return Buffer.concat([c, datos]);
}

/** Graba un tramo como lo haría el navegador: reloj con deriva, clics en instantes reales. */
function tramo(dir, prefijo, { desde, hasta, ppm, clics, reinicioMs = 0 }) {
  const fsReal = 48000 * (1 + ppm * 1e-6);
  const frames = Math.round((hasta - desde) * fsReal);
  const pcm = Buffer.alloc(frames * 2);
  for (const t of clics.filter(t => t > desde && t < hasta)) {
    const f = Math.round((t - desde) * fsReal);
    for (let i = 0; i < 24; i++) pcm.writeInt16LE(30000, (f + i) * 2);
  }
  const porTrozo = 60 * 48000 * 2;
  for (let n = 0; n * porTrozo < pcm.length; n++) {
    fs.writeFileSync(path.join(dir, `${prefijo}-${String(n + 1).padStart(6, "0")}.wav`), wav(pcm.subarray(n * porTrozo, (n + 1) * porTrozo)));
  }
  const anclas = [];
  for (let frame = 0; frame < frames; frame += 30 * 48000) {
    const ruido = Math.sin(frame) * 4; // ±4 ms de error de medida
    const real = T0 + desde * 1000 + (frame / fsReal) * 1000 + ruido;
    // Tras un reinicio, el servidor cuenta desde cero; el reloj del equipo sigue igual.
    anclas.push(JSON.stringify({ frame, serverMs: real - reinicioMs, epochMs: real + 5_000, rttMs: 25 }));
  }
  fs.writeFileSync(path.join(dir, `${prefijo}-anclas.txt`), anclas.join("\n") + "\n");
}

function clicsEn(archivo) {
  const b = fs.readFileSync(archivo);
  const i = b.indexOf("data") + 8;
  const datos = b.subarray(i);
  const encontrados = [];
  let ultimo = -1e9;
  for (let n = 0; n < datos.length / 2; n++) {
    if (datos.readInt16LE(n * 2) > 15000 && n - ultimo > 4800) { encontrados.push(n / 48); ultimo = n; }
  }
  return { ms: encontrados, duracion: datos.length / 2 / 48000 };
}

test("alinea pistas con deriva, una recarga y un reinicio del servidor", () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "mrc-"));
  const sesion = { id: "prueba", nombre: "Prueba", inicioServerMs: T0, finServerMs: T0 + DURACION * 1000 };
  const clics = [10, 145, 290];
  for (const [id, nombre, publicar] of [["ana", "Ana", true], ["beto", "Beto", false]]) {
    const dir = path.join(raiz, id);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "manifiesto.json"), JSON.stringify({
      schemaVersion: 1, sesion, usuario: { id, nombre, personaje: null },
      consentimiento: { grabar: true, publicar }
    }));
  }
  tramo(path.join(raiz, "ana"), "voz-1", { desde: 1.2, hasta: DURACION, ppm: 80, clics });
  // Beto recarga el navegador entre los segundos 150 y 160 (el servidor se reinicia): dos tramos.
  tramo(path.join(raiz, "beto"), "voz-1", { desde: 0.4, hasta: 150, ppm: -60, clics });
  tramo(path.join(raiz, "beto"), "voz-2", { desde: 160, hasta: DURACION, ppm: -60, clics, reinicioMs: 155_000 });
  fs.writeFileSync(path.join(raiz, "beto", "marcadores.txt"), JSON.stringify({ serverMs: T0 + 200_000, tipo: "cortar", texto: "" }) + "\n");

  execFileSync("node", [path.join(import.meta.dirname, "..", "mr-chronicle-post.mjs"), raiz, "--sin-ruido", "--sin-whisper"], { stdio: "pipe" });

  const salida = path.join(raiz, "salida");
  for (const [archivo, esperados] of [["voz-Ana.bruta.wav", clics], ["voz-Beto.bruta.wav", [10, 145, 290]]]) {
    const { ms, duracion } = clicsEn(path.join(salida, "stems", archivo));
    assert.equal(Math.round(duracion), DURACION, `${archivo} dura ${duracion}`);
    assert.equal(ms.length, esperados.length, `${archivo}: ${ms}`);
    ms.forEach((m, i) => assert.ok(Math.abs(m - esperados[i] * 1000) < 5, `${archivo}: clic en ${m} ms, esperado ${esperados[i] * 1000}`));
  }
  const informe = fs.readFileSync(path.join(salida, "informe.md"), "utf8");
  assert.match(informe, /Beto NO ha aceptado que se publique/);
  assert.match(informe, /Beto voz-2: el servidor de Foundry se reinició/);
  assert.match(informe, /00:03:20.*CORTAR/);
  assert.match(fs.readFileSync(path.join(salida, "marcadores.txt"), "utf8"), /^200\.000\t200\.000\tBeto: ✂ CORTAR/);
  fs.rmSync(raiz, { recursive: true });
});
