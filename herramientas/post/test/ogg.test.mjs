import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { paginas, cabeceraOpus, huecosOgg } from "../ogg.mjs";

const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

test("un trozo que falta en una pista Ogg Opus se detecta con su duración", { skip: !ffmpeg }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mrc-ogg-"));
  const f = path.join(dir, "a.ogg");
  // Un paquete por página, como escribe el módulo.
  const r = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=f=440:d=10", "-ar", "48000", "-ac", "1",
    "-c:a", "libopus", "-frame_duration", "20", "-page_duration", "20000", f]);
  assert.equal(r.status, 0, String(r.stderr));
  const buf = fs.readFileSync(f);
  const { preSkip, canales } = cabeceraOpus(buf.subarray(0, 128));
  assert.equal(canales, 1);
  const ps = paginas(buf);
  // Trozos de 100 páginas (2 s); el primero lleva además las dos cabeceras. Se quita el tercero.
  const corte = [0, 102, 202, 302, 402, ps.length].map(i => (ps[i] ? ps[i].o : buf.length));
  const trozos = corte.slice(0, -1).map((c, i) => buf.subarray(c, corte[i + 1]));
  assert.deepEqual(huecosOgg(trozos, preSkip), []);
  const huecos = huecosOgg(trozos.filter((_, i) => i !== 2), preSkip);
  assert.equal(huecos.length, 1);
  assert.equal(huecos[0].muestras, 100 * 960);
  assert.ok(Math.abs(huecos[0].pos - 4 * 48000) <= 960 * 2, `pos=${huecos[0].pos}`);
  fs.rmSync(dir, { recursive: true });
});
