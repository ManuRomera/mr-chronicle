/**
 * Casos de la auditoría del 30-09-2026 (D09–D11 y otros), escritos como comportamiento correcto.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { escribirZip } from "../../../module/zip.mjs";
import { extraerZip } from "../zip.mjs";
import { corregirReinicios } from "../lib.mjs";
import { paginas } from "../ogg.mjs";

const SCRIPT = path.join(import.meta.dirname, "..", "mr-chronicle-post.mjs");
const T0 = 1_000_000;

function wav(segundos, clic = null) {
  const b = Buffer.alloc(44 + segundos * 48000 * 2);
  b.write("RIFF"); b.writeUInt32LE(b.length - 8, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(48000, 24);
  b.writeUInt32LE(96000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(b.length - 44, 40);
  if (clic !== null) for (let i = 0; i < 24; i++) b.writeInt16LE(30000, 44 + 2 * (clic * 48000 + i));
  return b;
}

function participante(raiz, carpeta, { id = carpeta, nombre, duracion, anclas }) {
  const dir = path.join(raiz, carpeta);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "manifiesto.json"), JSON.stringify({
    usuario: { id, nombre }, consentimiento: { grabar: true, publicar: true },
    sesion: { id: "s", nombre: "Auditoría", inicioServerMs: T0, finServerMs: T0 + duracion * 1000 }
  }));
  anclas ??= [0, 30, 60, 90, 120, 150, 180].filter(s => s <= duracion)
    .map(s => ({ frame: s * 48000, serverMs: T0 + s * 1000, epochMs: 1.7e12 + s * 1000, rttMs: 1 }));
  fs.writeFileSync(path.join(dir, "voz-1-anclas.txt"), anclas.map(a => JSON.stringify(a)).join("\n"));
  return dir;
}

const procesar = (raiz, extra = []) =>
  execFileSync(process.execPath, [SCRIPT, raiz, "--sin-ruido", "--sin-whisper", "--formato", "wav", ...extra], { encoding: "utf8", stdio: "pipe" });

function primerClic(archivo) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", archivo, "-f", "s16le", "-ac", "1", "-"], { maxBuffer: 64 * 1024 * 1024 });
  for (let i = 0; i < raw.length; i += 2) if (raw.readInt16LE(i) > 15000) return i / 2 / 48000;
  return null;
}

const conRaiz = fn => async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "mrc-rob-"));
  try { await fn(raiz); } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
};

test("D09: dos participantes llamados Ana conservan cada uno su pista", conRaiz(raiz => {
  for (const id of ["a1b2c3", "d4e5f6"]) {
    const d = participante(raiz, id, { nombre: "Ana", duracion: 2 });
    fs.writeFileSync(path.join(d, "voz-1-000001.wav"), wav(2, id === "a1b2c3" ? 0 : 1));
  }
  procesar(raiz);
  assert.deepEqual(fs.readdirSync(path.join(raiz, "salida/stems")).sort(), ["voz-Ana-a1b2.wav", "voz-Ana-d4e5.wav"]);
}));

test("D10: si falta un trozo se rellena con silencio, lo siguiente no se desplaza y se avisa", conRaiz(raiz => {
  const d = participante(raiz, "a", { nombre: "Ana", duracion: 180 });
  fs.writeFileSync(path.join(d, "voz-1-000001.wav"), wav(60));
  fs.writeFileSync(path.join(d, "voz-1-000003.wav"), wav(60, 30)); // clic en el segundo 150 de la sesión
  procesar(raiz);
  assert.ok(Math.abs(primerClic(path.join(raiz, "salida/stems/voz-Ana.wav")) - 150) < 0.01);
  assert.match(fs.readFileSync(path.join(raiz, "salida/informe.md"), "utf8"), /falta el trozo 2/);
}));

test("D11: un reinicio del servidor dentro del mismo tramo se corrige y el audio queda en su sitio", conRaiz(raiz => {
  const anclas = [0, 30, 60, 90, 120].map(s => ({
    frame: s * 48000, serverMs: T0 + s * 1000 - (s >= 60 ? T0 + 60_000 : 0), epochMs: 1.7e12 + s * 1000, rttMs: 1
  }));
  const d = participante(raiz, "a", { nombre: "Ana", duracion: 120, anclas });
  fs.writeFileSync(path.join(d, "voz-1-000001.wav"), wav(60));
  fs.writeFileSync(path.join(d, "voz-1-000002.wav"), wav(60, 40)); // clic en el segundo 100
  fs.writeFileSync(path.join(d, "marcadores.txt"), JSON.stringify({ serverMs: 100_000 - 60_000, epochMs: 1.7e12 + 100_000, tipo: "momento", texto: "" }) + "\n");
  procesar(raiz);
  assert.ok(Math.abs(primerClic(path.join(raiz, "salida/stems/voz-Ana.wav")) - 100) < 0.01);
  // El marcador, hecho tras el reinicio, también vuelve a su sitio.
  assert.match(fs.readFileSync(path.join(raiz, "salida/marcadores.txt"), "utf8"), /^100\.000\t/);
  assert.match(fs.readFileSync(path.join(raiz, "salida/informe.md"), "utf8"), /se reinició/);
}));

test("un tramo con una sola ancla se procesa con la frecuencia nominal, con aviso", conRaiz(raiz => {
  const d = participante(raiz, "a", { nombre: "Ana", duracion: 5, anclas: [{ frame: 0, serverMs: T0 + 2000, epochMs: 1.7e12, rttMs: 1 }] });
  fs.writeFileSync(path.join(d, "voz-1-000001.wav"), wav(3, 1));
  procesar(raiz);
  assert.ok(Math.abs(primerClic(path.join(raiz, "salida/stems/voz-Ana.wav")) - 3) < 0.01);
  assert.match(fs.readFileSync(path.join(raiz, "salida/informe.md"), "utf8"), /solo tiene un ancla/);
}));

test("las copias .zip se procesan tal cual; si falta un archivo del inventario, se avisa", conRaiz(async raiz => {
  // Se prepara una entrega en una carpeta aparte y se empaqueta como lo hace el panel.
  const origen = path.join(raiz, "..", `${path.basename(raiz)}-origen`);
  const d = participante(origen, "Ana-u123", { id: "u123", nombre: "Ana", duracion: 60 });
  fs.writeFileSync(path.join(d, "voz-1-000001.wav"), wav(60, 20));
  const archivos = fs.readdirSync(d).map(n => ({ nombre: `s/Ana-u123/${n}`, archivo: new Blob([fs.readFileSync(path.join(d, n))]) }));
  // El inventario menciona un trozo que no llegó a la copia.
  archivos.push({ nombre: "s/Ana-u123/inventario.json", archivo: new Blob([JSON.stringify({ archivos: [{ nombre: "voz-1-000002.wav", bytes: 10, crc32: 0 }] })]) });
  const fd = fs.openSync(path.join(raiz, "MR-Chronicle_s_Ana-u123.zip"), "w");
  await escribirZip(async b => fs.writeSync(fd, b), archivos, { limite: 1000 }); // con ZIP64 forzado
  fs.closeSync(fd);
  fs.rmSync(origen, { recursive: true });

  procesar(raiz);
  assert.ok(Math.abs(primerClic(path.join(raiz, "salida/stems/voz-Ana.wav")) - 20) < 0.01);
  assert.match(fs.readFileSync(path.join(raiz, "salida/informe.md"), "utf8"), /falta voz-1-000002\.wav/);
}));

test("un zip dañado se detecta por su CRC", conRaiz(async raiz => {
  const ruta = path.join(raiz, "c.zip");
  const fd = fs.openSync(ruta, "w");
  await escribirZip(async b => fs.writeSync(fd, b), [{ nombre: "s/p/a.txt", archivo: new Blob(["hola, mundo"]) }]);
  fs.closeSync(fd);
  const b = fs.readFileSync(ruta);
  b[b.indexOf("hola")] = 0x48; // «Hola»: un byte cambiado
  fs.writeFileSync(ruta, b);
  assert.deepEqual(extraerZip(ruta, path.join(raiz, "x")).danados, ["p/a.txt"]);
}));

test("la corrección de reinicios deja igual lo que no se reinició", () => {
  const anclas = [0, 30].map(s => ({ serverMs: T0 + s * 1000, epochMs: 1.7e12 + s * 1000 }));
  const c = corregirReinicios(anclas);
  assert.equal(c.reinicios, false);
  assert.deepEqual(c.corregir({ serverMs: T0 + 10, epochMs: 1.7e12 + 10 }).serverMs, T0 + 10);
  assert.equal(c.corregir({ serverMs: 5 }).serverMs, 5); // sin epochMs (datos antiguos): intacto
});

test("si falta un trozo de una pista Ogg de Foundry, se rellena con silencio y lo siguiente no se desplaza", conRaiz(raiz => {
  const d = participante(raiz, "a", { nombre: "Ana", duracion: 10 });
  fs.writeFileSync(path.join(d, "voz-1-000001.wav"), wav(10));
  const ogg = path.join(raiz, "origen.ogg");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "aevalsrc='if(between(t,9,9.01),0.9,0)':s=48000:d=10", "-ac", "1",
    "-c:a", "libopus", "-frame_duration", "20", "-page_duration", "20000", ogg]);
  const buf = fs.readFileSync(ogg);
  const ps = paginas(buf);
  const corte = [0, 102, 202, 302, 402, ps.length].map(i => (ps[i] ? ps[i].o : buf.length));
  // Trozo n = de corte[n-1] a corte[n]; falta el 3.
  for (const n of [1, 2, 4, 5]) fs.writeFileSync(path.join(d, `musica-1-${String(n).padStart(6, "0")}.ogg`), buf.subarray(corte[n - 1], corte[n]));
  fs.writeFileSync(path.join(d, "musica-1-anclas.txt"), [0, 5, 10].map(sg => JSON.stringify({ frame: sg * 48000, serverMs: T0 + sg * 1000, epochMs: 1.7e12 + sg * 1000, rttMs: 1 })).join("\n"));
  procesar(raiz);
  assert.ok(Math.abs(primerClic(path.join(raiz, "salida/stems/foundry-musica.wav")) - 9) < 0.05);
  assert.match(fs.readFileSync(path.join(raiz, "salida/informe.md"), "utf8"), /faltaban 1 trozo/);
}));
