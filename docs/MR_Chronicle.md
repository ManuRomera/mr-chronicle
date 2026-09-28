# MR · Chronicle

**Grabación multipista, transcripción y memoria de partidas de rol desde Foundry VTT, sin instalar nada para jugar y sin coste recurrente**

| | |
|---|---|
| **Autor** | Manuel Romera Chinchilla |
| **Versión del diseño** | 2.2 — 28 de septiembre de 2026 |
| **Estado** | En desarrollo: versión 0.1.0 del módulo y de la herramienta de postproducción implementadas y probadas en local. Falta la prueba real con varios jugadores (§20). |
| **Objetivo económico** | 0 € de coste recurrente obligatorio |
| **Id del módulo** | `mr-chronicle` |

> **Cambios respecto a la versión 1.0.** Se descarta el programa nativo por jugador (Rust + servidor local + emparejamiento). La grabación pasa al navegador, dentro del propio módulo de Foundry. La transcripción y la limpieza de ruido se hacen después de la partida, en un solo equipo. El audio de la sesión se publica como podcast, así que la alineación entre pistas y la corrección de deriva pasan a ser requisitos. Se añade la grabación de la música y los efectos de Foundry.
>
> **Cambios en la 2.1.** Opciones cerradas: la entrega se hace subiendo los trozos uno a uno al servidor de Foundry; el ruido se limpia con DeepFilterNet; el modelo de Whisper es `large-v3-turbo`; los navegadores soportados son Chrome, Edge y la app de Foundry. El prompt maestro pasa a ser para Claude Code.
>
> **Cambios en la 2.2 (tras implementar).**
> - La hora del servidor de Foundry cuenta desde que se lanzó el mundo, no es una fecha: las anclas llevan además `epochMs` para sobrevivir a un reinicio (§9.1).
> - Los contextos de audio de Foundry pierden muestras en segundo plano, así que su salida se graba en un contexto propio (§10.1).
> - Solo el máster puede crear carpetas en el servidor, y las extensiones permitidas obligan a usar `.wav` y `.txt` (§11, §15).
> - La herramienta está en `herramientas/post/`.

---

## Contenido

1. Resumen
2. Objetivos y principios
3. Fuera de alcance
4. Arquitectura
5. Decisiones de diseño
6. Componentes
7. Flujo de una sesión
8. Captura de voz en el navegador
9. Tiempo, sincronización y deriva
10. Grabación de música y efectos de Foundry
11. Entrega de las pistas
12. Postproducción
13. Transcripción con Whisper
14. Memoria de campaña
15. Formatos de datos
16. Privacidad, consentimiento y publicación
17. Tolerancia a fallos
18. Coste cero
19. Riesgos abiertos
20. Plan por fases
21. Pruebas y criterios de aceptación
22. Mantenimiento
23. Mejoras futuras
24. Prompt maestro para Claude Code
25. Referencias

---

## 1. Resumen

MR · Chronicle convierte una partida de rol jugada con Foundry VTT y voz por Discord en tres cosas:

1. **Un podcast multipista:** una pista limpia por participante más música, ambiente y efectos de Foundry, todas alineadas desde el mismo 0:00 y listas para mezclar en Reaper o Audacity.
2. **Una transcripción cronológica** con hablante y marca de tiempo inequívocos.
3. **Material de campaña:** crónica, resumen, PNJ, lugares, pistas, objetos y cabos abiertos.

Los jugadores no instalan nada. El módulo de Foundry graba el micrófono de cada uno **en su propio navegador**, en bruto y por trozos. Al terminar, cada jugador entrega su pista. Todo el procesamiento pesado (corregir la deriva, alinear, limpiar el ruido, transcribir y fusionar) se hace **después de la partida en un único equipo**: el de quien edita el podcast.

La idea que sostiene el proyecto: **cada micrófono pertenece a una sola persona.** Así no hay que adivinar quién habla, no hace falta ningún bot de Discord y cada voz queda en su propia pista, que es justo lo que necesita un podcast.

| Pieza | Función |
|---|---|
| Discord | Solo voz entre jugadores. Chronicle no se integra con Discord. |
| Módulo Foundry `mr-chronicle` | Consentimiento, inicio y fin, grabación del micro en el navegador, marcas de tiempo, marcadores, pistas de Foundry y entrega. |
| Herramienta de postproducción | Script en el equipo del editor: deriva, alineación, ruido, Whisper, fusión y exportaciones. |
| Procesador de campaña | Convierte la transcripción en crónica y memoria. Empieza siendo un prompt; la automatización llega después. |

---

## 2. Objetivos y principios

- **Coste recurrente de 0 €.** Ninguna función básica depende de una API de pago, nube, suscripción ni firma de código.
- **Cero instalación para jugar.** Un jugador solo necesita Foundry en un navegador compatible y cascos.
- **Calidad de podcast.** Voz en bruto a 48 kHz, sin procesado destructivo durante la partida y con pistas alineadas a ±30 ms durante toda la sesión.
- **Grabar primero y procesar después.** Durante la partida solo se graba. Nada de Whisper ni limpieza de ruido en directo.
- **Hablante inequívoco.** Una pista por usuario de Foundry.
- **Tolerancia a fallos.** Una caída de Foundry, Discord, Internet o del navegador no destruye lo ya grabado.
- **Consentimiento visible,** tanto para grabar como para publicar.
- **API pública de Foundry siempre que se pueda.** Los puntos que usan API no documentada se aíslan en un solo archivo y se revisan en cada versión mayor.
- **Compatibilidad con Foundry V13 y V14.** Interfaz con ApplicationV2.

---

## 3. Fuera de alcance

- Capturar el audio que llega por Discord.
- Saber automáticamente qué PNJ interpreta el máster.
- Transcripción en tiempo real.
- Mezcla final automática del podcast: Chronicle entrega las pistas alineadas y la mezcla la hace una persona.
- Jugadores sin cascos. Con altavoces, el micro recoge a los demás; ese caso no se soporta, solo se avisa.
- Varios jugadores compartiendo micrófono en la misma sala. El diseño asume un micro por persona.

---

## 4. Arquitectura

```
DURANTE LA PARTIDA (navegador de cada participante, sin instalar nada)

  Foundry (módulo mr-chronicle)
   ├─ Micro ──getUserMedia (en bruto)──> AudioWorklet ──> Worker ──> OPFS
   │                                          │              (trozos PCM 48 kHz)
   │                                          └─> anclas: muestra ↔ hora del servidor
   ├─ Marcadores (botón / tecla)
   └─ Solo en el cliente del máster:
        game.audio.music       ─┐
        game.audio.environment ─┼─> 3 pistas más, grabadas igual
        game.audio.interface   ─┘
        + log de eventos de listas de reproducción

  Socket del módulo: solo mensajes ligeros (preparar, iniciar, parar,
  estado, marcadores). El audio NUNCA pasa por el socket.

AL TERMINAR
  Cada participante entrega: pista.wav + anchors.json + manifest.json

DESPUÉS (equipo del editor, script de línea de comandos)
  corregir deriva ─> alinear a 0:00 ─> limpiar ruido ─> whisper.cpp
        │                                                  │
        └─> pistas alineadas para el DAW                   └─> transcript.md / .json / .srt
                                                               + marcadores + log de música
```

---

## 5. Decisiones de diseño

| Decisión | Estado | Motivo |
|---|---|---|
| Bot de Discord | Descartado | Depende de permisos de terceros y complica las mesas simultáneas. |
| Programa nativo por jugador | **Descartado (v2)** | Instalación, firma de código (cuesta dinero), permisos de red local, emparejamiento y compilaciones por plataforma. El navegador cubre la captura. |
| Grabación | En el navegador, con AudioWorklet + OPFS | Sin instalación. El AudioWorklet cuenta muestras exactas, que es lo que necesita la corrección de deriva. |
| MediaRecorder | Descartado para la voz | No da una posición de muestra fiable y sus trozos no se pueden decodificar por separado. |
| Supresión de ruido | **DeepFilterNet, después de la partida** | La del navegador está pensada para llamadas, deja artefactos y no se puede deshacer. DeepFilterNet suena mejor que RNNoise en voz hablada. Se graba en bruto y se limpia después. |
| Entrega de pistas | **Subida por trozos al servidor de Foundry** | Un solo clic para el jugador y sin servicios externos. Por trozos para no saturar la memoria del servidor (§11). |
| Modelo de Whisper | `large-v3-turbo` | Casi la calidad de `large-v3` a varias veces su velocidad; en un Mac con Metal va holgado en diferido. |
| Navegadores | Chrome, Edge y app de Foundry | Mismo motor (Chromium) y soporte completo de AudioWorklet y OPFS. |
| Transcripción | Después de la partida, en el equipo del editor | El audio se centraliza de todas formas para el podcast. Una sola instalación de whisper.cpp. |
| Identificación de hablantes | No necesaria | Una pista por persona. |
| Sincronización NTP propia por socket | Descartada | Se usa la petición de hora de Foundry (`game.socket.emit("time")`) más anclas periódicas y regresión. |
| LLM | Manual primero (prompt), local opcional después | Un modelo local pequeño no admite una transcripción de 4 horas en un solo contexto. |
| Servidores externos (Oracle, etc.) | No | No forman parte de ningún camino. |

---

## 6. Componentes

### 6.1. Módulo Foundry `mr-chronicle`

- Panel de sesión (ApplicationV2) con cada participante y su estado: consentimiento, micro, nivel de señal, grabando, espacio libre y trozos guardados.
- Consentimiento individual para **grabar** y para **publicar**.
- Preparar, iniciar, pausar, reanudar y finalizar, controlado por el máster y propagado por el socket del módulo (`socket: true`).
- **Grabadora de voz:** captura en bruto, AudioWorklet, Worker y OPFS.
- **Anclas de tiempo** cada 30 s.
- **Marcadores:** cualquiera los añade con un botón o una tecla, con texto opcional.
- **Solo en el máster:** grabación de las 3 pistas de audio de Foundry y log de eventos de las listas de reproducción.
- **Entrega:** exportar o subir la pista, las anclas y el manifiesto.
- **Recuperación:** si el navegador se cerró, retomar la sesión desde OPFS.
- Indicador de grabación siempre visible.

### 6.2. Herramienta de postproducción (`herramientas/post`)

- Se ejecuta en el equipo del editor (Mac como objetivo inicial).
- Depende de `ffmpeg`, `whisper-cli` (whisper.cpp) y `deep-filter` (DeepFilterNet). Todo gratuito. En Mac: `brew install ffmpeg whisper-cpp`, y DeepFilterNet desde su página de versiones.
- Script en JavaScript con Node.js que orquesta esos binarios. Mismo lenguaje que el módulo y sin frameworks.
- Uso: `mr-chronicle-post <carpeta-de-sesion>`.

### 6.3. Procesador de campaña

- **MVP:** un prompt versionado en el repositorio más `transcript.md`, que se pega en el asistente que ya se use.
- **Después:** adaptador para Ollama o llama.cpp, resumiendo por tramos (primero cada tramo, luego el conjunto).

---

## 7. Flujo de una sesión

1. El máster abre el panel de Chronicle y pulsa **Preparar**. Se genera un `sessionId`.
2. Cada participante ve la petición y acepta **grabar** (y, si procede, **publicar**). Quien no acepta sigue jugando sin que se le grabe.
3. Cada participante elige su micro. El panel muestra el nivel de señal y avisa si no detecta cascos (se le pregunta; no se puede detectar de forma fiable).
4. El máster pulsa **Iniciar**. Cada cliente arranca su grabadora y registra el ancla inicial.
5. Durante la partida, cada Worker escribe trozos en OPFS y se añade un ancla cada 30 s. El máster graba además las pistas de Foundry.
6. Cualquiera añade marcadores («momento para el tráiler», «cortar esto»).
7. El máster pulsa **Finalizar**. Cada cliente cierra su pista y genera `manifest.json` y `anchors.json`.
8. Cada participante **entrega** su paquete (ver §11).
9. El editor ejecuta la postproducción y obtiene las pistas alineadas, la transcripción, los subtítulos y los marcadores.
10. Opcionalmente se genera la crónica y se guarda en un Journal de Foundry.

---

## 8. Captura de voz en el navegador

### 8.1. Restricciones de captura

```js
navigator.mediaDevices.getUserMedia({ audio: {
  deviceId, channelCount: 1, sampleRate: 48000,
  echoCancellation: false, noiseSuppression: false, autoGainControl: false
}});
```

- El micro se abre en modo compartido y convive con Discord.
- Hay que comprobar con `track.getSettings()` que se han respetado las restricciones y avisar si no.
- Avisar a usuarios de macOS de que no activen «Aislamiento de voz» en el micro, porque procesa la señal antes de que llegue al navegador.

### 8.2. Cadena

```
micrófono ─> MediaStreamSource ─> AudioWorkletNode (cuenta muestras, pasa a int16)
          ─> MessagePort ─> Worker dedicado ─> OPFS (createSyncAccessHandle)
```

- El Worklet no hace nada pesado: convierte a int16 y envía bloques al Worker por un `MessageChannel`, sin pasar por el hilo principal.
- El Worker escribe con `FileSystemSyncAccessHandle` en trozos de 60 s: `voice-000001.pcm`, …
- Cada trozo lleva en su registro la muestra inicial, el número de muestras y un checksum.
- El hilo principal solo lleva el panel y las anclas.

### 8.3. Formato y espacio

- PCM mono de 16 bits a 48 kHz ≈ **346 MB por hora** (≈ 1,4 GB en 4 h).
- Antes de iniciar se comprueba `navigator.storage.estimate()` y se pide `navigator.storage.persist()`.
- Al entregar, el paquete se genera como WAV. Comprimir (FLAC u Opus con WebCodecs) es una mejora posterior (§23).

### 8.4. Pestaña en segundo plano

El jugador estará mirando Discord o Foundry, pero la pestaña de Foundry puede quedar en segundo plano. El AudioWorklet corre en el hilo de audio y una pestaña que captura el micro no debería congelarse, pero **hay que demostrarlo en la Fase 0** con 4 horas reales. Si se pierden muestras, se registra como hueco en las anclas (§9.4).

### 8.5. Navegadores

- **Soportados:** Chrome y Edge actuales, y la app de escritorio de Foundry (Electron). Los tres usan Chromium.
- **Firefox y Safari:** no se soportan en el MVP. El panel lo detecta y lo avisa antes de empezar.

---

## 9. Tiempo, sincronización y deriva

Whisper da tiempos **relativos al principio de cada archivo.** Colocar cada archivo en una línea de tiempo común es trabajo de Chronicle, y tiene dos partes: cuándo empezó cada pista y cuánto se desvía su reloj.

### 9.1. Hora del servidor

Foundry V13 ya sincroniza la hora con el servidor (`client/helpers/time.mjs`): llama a `game.socket.emit("time", cb)` cada 5 minutos y calcula con la **media** de las latencias. Chronicle usa esa misma petición, pero con más rigor:

- Hace 8 peticiones seguidas y se queda con la de **menor tiempo de ida y vuelta**:
  `offset = horaServidor − (t0 + t1) / 2`, con `t0` y `t1` medidos con `performance.timeOrigin + performance.now()`.
- Se repite con cada ancla.

**Comprobado al implementar:** `serverTime` son los milisegundos **desde que se lanzó el mundo** (`dist/components/activity.mjs`), no una fecha. Es un reloj común para todos los clientes, pero vuelve a cero si el servidor se reinicia. Por eso cada ancla guarda también `epochMs` (el reloj del equipo). Si en un tramo la diferencia `epochMs − serverMs` salta más de 2 s respecto al primer tramo de ese participante, la postproducción lo trata como un reinicio y lo recoloca.

### 9.2. Anclas

Cada 30 s el cliente guarda:

```json
{ "frame": 1440000, "serverMs": 157333.78, "epochMs": 1790628107123, "rttMs": 0.2 }
```

- `frame`: la muestra del archivo, contada por el Worklet, junto con el `currentTime` del contexto en ese instante.
- `AudioContext.getOutputTimestamp()` pasa ese `currentTime` a `performance.now()`. En el micro se restan además `baseLatency + outputLatency + latencia de entrada`: es el instante en que se dijo.
- `serverMs`: hora del servidor en ese instante (§9.1). `epochMs`: lo mismo con el reloj del equipo.
- Lo que no se pueda medir de la latencia del micro es constante por participante y se corrige con `ajustesMs` (palmadas).

### 9.3. Corrección de la deriva

Ninguna tarjeta de sonido va exactamente a 48.000 Hz. Con un desvío típico de 20-50 ppm, en 4 horas una pista se descuadra entre 0,3 y 0,7 s. En la postproducción:

1. Regresión lineal `serverMs = a + b·frame` con todas las anclas; se descartan las que tengan un tiempo de ida y vuelta alto.
2. `a` da el inicio de la pista en la línea común; `b` da la frecuencia real (`fsReal = 1000 / b`).
3. ffmpeg corrige y alinea:
   `-af "asetrate=<fsReal>,aresample=48000,adelay=<ms>"`
   El cambio de tono de 50 ppm es inaudible.
4. Todas las pistas salen empezando en el mismo 0:00 (el inicio de sesión) y con la misma duración.

### 9.4. Huecos

Si la diferencia entre las anclas y la recta supera 20 ms, se asume que se perdieron muestras. Se corrige por tramos y se avisa en el informe de postproducción.

### 9.5. Precisión objetivo

| Uso | Objetivo |
|---|---|
| Mezcla del podcast | ±30 ms entre pistas durante toda la sesión |
| Transcripción cronológica | ±250 ms |
| Marcadores | ±500 ms |

**Validación a oído:** al empezar y al acabar, todos dan una palmada contando «3, 2, 1» en voz alta. Tras la alineación, las palmadas deben coincidir en todas las pistas.

---

## 10. Grabación de música y efectos de Foundry

### 10.1. Captura directa (cliente del máster)

En Foundry V13 (`client/audio/helper.mjs`) hay tres `AudioContext` separados, cada uno con un nodo de volumen `ctx.gainNode` que va a los altavoces:

| Contexto | Contenido | Pista |
|---|---|---|
| `game.audio.music` | Listas de reproducción | `foundry-music` |
| `game.audio.environment` | Sonidos ambientales | `foundry-ambient` |
| `game.audio.interface` | Interfaz, dados y efectos | `foundry-sfx` |

```js
const propio = new AudioContext({ sampleRate: 48000, latencyHint: "playback" });
for (const name of ["music", "environment", "interface"]) {
  const ctx = game.audio[name];
  const puente = ctx.createMediaStreamDestination();
  ctx.gainNode.connect(puente);
  propio.createMediaStreamSource(puente.stream);  // → mismo pipeline que la voz
}
```

- Se graba con el mismo sistema que la voz (Worklet, Worker, OPFS y anclas). Estéreo, 48 kHz.
- **Comprobado al implementar:** los contextos de Foundry usan búfer corto y, con la pestaña en segundo plano, se saltan trozos (hasta 100 ms en 3 minutos). Así que **no se graba dentro de ellos**: `gainNode → createMediaStreamDestination()` lleva su salida a un contexto propio con `latencyHint: "playback"`, que es el que cuenta las muestras.
- `gainNode` no es API documentada. Se aísla en `foundry-audio-tap.mjs` y se revisa en cada versión mayor.
- **Se graba lo que oye el máster:** los sonidos ambientales dependen de su posición en la escena y el volumen depende de sus deslizadores.
- Los tres contextos se crean cuando el usuario interactúa por primera vez con la página. Hay que engancharse después de que existan.

### 10.2. Log de eventos (complementario)

Con los hooks públicos `updatePlaylist`, `updatePlaylistSound` y `createPlaylistSound` se registra:

```json
{ "serverMs": 1790000123456, "event": "play", "playlist": "Combate", "sound": "Tambores.ogg", "path": "…", "volume": 0.6 }
```

Así el editor puede **rehacer la música con los archivos originales**, sin pérdida de calidad y con el volumen que quiera. En la Fase 0 hay que comprobar si con eso basta y ya no hace falta la captura directa.

### 10.3. Licencias

Parte de la música para rol permite usarla en partida pero no en un podcast publicado. La herramienta lista qué archivos han sonado para poder revisar las licencias antes de publicar.

---

## 11. Entrega de las pistas

**Decisión: subir los trozos uno a uno al servidor de Foundry.**

En el código del servidor de Foundry V13 (`dist/server/express.mjs`), las subidas usan `express-fileupload` sin límite de tamaño y sin archivos temporales: **cada archivo subido se guarda entero en la memoria RAM del servidor.** Subir un WAV de 1,4 GB por jugador podría tumbar un servidor pequeño. Además, un proxy delante (nginx, Cloudflare) suele limitar el tamaño de cada petición.

Por eso la entrega aprovecha que la grabación ya está en trozos de 60 s (≈ 5,8 MB cada uno):

1. Al pulsar **Entregar**, el cliente pide al máster por el socket que cree `Data/mr-chronicle/<sessionId>/<userId>/`: solo el rol Asistente o superior puede crear carpetas. Después sube con `FilePicker.upload` cada trozo `.wav`, los `.txt` (anclas, marcadores, música) y, el último, `manifiesto.json`. El servidor solo admite ciertas extensiones, por eso el NDJSON va en `.txt`.
2. **Se puede reanudar:** antes de subir, se consulta con `FilePicker.browse` qué trozos ya están en el servidor y solo se suben los que faltan. Si se corta, se pulsa otra vez.
3. Se sube **después de la partida,** no durante, para no competir con la voz de Discord.
4. Cuando el servidor tiene todos los trozos con el checksum correcto, el panel lo confirma y ofrece **«Borrar grabación local»**.
5. El editor se trae la carpeta del servidor (`rsync`/`scp`) y ejecuta la postproducción.

**Requisitos:**
- El máster da a los jugadores el permiso de subir archivos en la configuración de permisos de Foundry.
- Si hay un proxy, debe aceptar peticiones de al menos 16 MB (en nginx, `client_max_body_size 16m`); un trozo estéreo de 60 s ocupa 11,5 MB.
- El máster debe estar conectado durante la entrega, para crear las carpetas.

**Plan B,** siempre disponible: botón **«Descargar mi pista»**, que genera un ZIP con lo mismo, para enviarlo a mano.

## 12. Postproducción

```
mr-chronicle-post sesiones/2026-10-05-cos-26/
```

1. **Validar:** manifiestos, checksums y que no falte ningún trozo.
2. **Montar** cada pista desde sus trozos.
3. **Corregir la deriva y alinear** (§9.3). Informe con `fsReal`, desfase inicial, error residual y huecos por pista.
4. **Limpiar el ruido** de la voz con DeepFilterNet (`deep-filter`). El original se conserva siempre. La intensidad de la reducción se ajusta en `campaign.json`.
5. **Transcribir** cada pista de voz **limpia** con whisper.cpp (§13).
6. **Fusionar** los segmentos de todos, ordenados por tiempo y conservando los solapamientos.
7. **Exportar:**

```
salida/
  stems/        voz-<nombre>.wav (limpia), voz-<nombre>.raw.wav, foundry-music.wav, foundry-ambient.wav, foundry-sfx.wav
  transcript.md
  transcript.json
  transcript.srt
  markers.txt        # formato de pistas de etiquetas de Audacity: inicio<TAB>fin<TAB>texto
  music-log.json
  report.md          # deriva, huecos, avisos, archivos de música usados
```

Todas las pistas empiezan en 0:00: se arrastran al editor de audio y ya están alineadas.

---

## 13. Transcripción con Whisper

- **Motor:** `whisper-cli` de whisper.cpp, nativo en el equipo del editor (Metal en Mac).
- **Modelo:** `large-v3-turbo` (multilingüe; nunca los `.en`). Verificar el nombre exacto del archivo al implementar. Si en la Fase 0 resultara demasiado lento, bajar a `medium`.
- **Idioma fijo:** `-l es`.
- **Salida:** `-oj` (JSON con segmentos). Precisión esperada: ±200-500 ms por segmento. `--dtw` para tiempos por palabra si hacen falta.
- **VAD:** activar el detector de voz de whisper.cpp. **Comprobar** que los tiempos devueltos siguen referidos al audio original.
- **Nombres propios:** `--prompt` con un diccionario por campaña (PNJ, lugares, términos inventados).
- **Invenciones en los silencios:** Whisper genera frases que nadie dijo en tramos sin voz. Hay una lista negra filtrable (por ejemplo «Subtítulos realizados por la comunidad de Amara.org», «Gracias por ver el vídeo») más un umbral de confianza y de energía.
- **Eco residual:** si un segmento de A casi coincide en texto con uno de B en ±2 s, se marca como posible eco y se conserva el de mayor energía.

Segmento:

```json
{
  "schemaVersion": 1,
  "sessionId": "2026-10-05-cos-26",
  "participantId": "foundryUserId",
  "speaker": "Manu",
  "character": "Director",
  "startMs": 128453,
  "endMs": 134812,
  "text": "Al abrir la puerta veis una estancia completamente a oscuras.",
  "confidence": 0.91,
  "flags": [],
  "engine": "whisper.cpp/large-v3-turbo"
}
```

`startMs` y `endMs` son relativos al 0:00 de la sesión, ya alineados.

---

## 14. Memoria de campaña

Material que se extrae:

- Crónica narrativa.
- Resumen corto para jugadores.
- Escenas.
- PNJ.
- Lugares.
- Pistas.
- Objetos.
- Decisiones y promesas.
- Combates.
- Cabos abiertos.
- Momentos marcados.

- **MVP:** `prompts/cronica.md` versionado más `transcript.md`, pegados en el asistente que se use. Coste 0 € extra.
- **Después:** un adaptador para Ollama. Una transcripción de 4 horas son más de 50.000 tokens, así que se resume por tramos de unos 20 minutos y luego se unen los resúmenes, siempre con referencias a sesión y minuto.
- **Resultado:** un Journal de Foundry por sesión y un `memory.json` acumulado por campaña.

La transcripción y la fusión funcionan sin ningún LLM.

---

## 15. Formatos de datos

### 15.1. OPFS de cada participante (y servidor, con la misma estructura plana)

```
mr-chronicle/<sessionId>/<userId>/
  manifiesto.json          # schemaVersion, sesión, usuario, consentimiento, tramos, pistas, estado, entregado
  voz-1-000001.wav …       # trozos de 60 s; <tipo>-<tramo>-<n>.wav
  voz-1-anclas.txt         # NDJSON: {frame, serverMs, epochMs, rttMs}
  marcadores.txt           # NDJSON: {serverMs, tipo: momento|cortar|pausa|reanuda, texto}
  # solo en el máster:
  musica-1-000001.wav …  ambiente-1-…  efectos-1-…  (+ sus anclas)
  musica.txt               # NDJSON: qué suena y cuándo
```

- **Tramo:** cada vez que un participante empieza a grabar en una sesión (al iniciar o tras recargar), se abre uno nuevo, con sus propias anclas.
- **Sin índice de trozos:** el número de muestras sale del tamaño de cada archivo (menos 44 bytes de cabecera). La cabecera no es fiable si el navegador murió a mitad.
- **Todo NDJSON es de solo añadir:** si se corta a mitad, se pierde como mucho la última línea.

### 15.2. Carpeta de sesión del editor

```
campañas/<campaignId>/
  campaign.json          # diccionario de nombres, participantes, personajes
  sesiones/<sessionId>/
    entrada/<participante>/…   # paquetes recibidos
    salida/…                   # §12
    cronica.md
    resumen.md
    memory.json
```

Todos los JSON llevan `schemaVersion`.

---

## 16. Privacidad, consentimiento y publicación

- Cada participante graba solo su propio micrófono, en su navegador.
- Hay **dos consentimientos separados:** grabar y publicar en el podcast. Se guardan en `manifest.json` con fecha.
- No empieza a grabar a nadie que no haya aceptado. Quien no acepta sigue jugando con normalidad.
- Si alguien entra a mitad de sesión, no se le graba hasta que acepte.
- Indicador de grabación siempre visible. El participante puede **pausar solo su pista**, y la pausa queda registrada.
- **Marcadores de «cortar esto»:** cualquier participante puede marcar un fragmento propio para eliminarlo antes de publicar. La postproducción lo lista en `report.md`.
- Revisión de la transcripción: cada participante puede pedir que se retiren frases suyas antes de compartirla.
- Sin telemetría. El audio solo sale del equipo en la entrega explícita al editor.
- `THIRD_PARTY_NOTICES.md` con las licencias de whisper.cpp, los modelos y DeepFilterNet.
- Hay que respetar la ley aplicable (la voz es un dato personal) y las normas de la comunidad donde se juega.

---

## 17. Tolerancia a fallos

| Fallo | Comportamiento |
|---|---|
| Se cae Discord | Chronicle sigue grabando; Discord no forma parte del proceso. |
| Se cae Internet o el servidor de Foundry | La captura sigue en local. Las anclas se pausan (no hay hora del servidor) y la regresión interpola. Aviso al volver. |
| Se cierra o recarga el navegador | Los trozos ya escritos están en OPFS. Al volver, el panel ofrece **retomar**: nueva pista, mismo `sessionId`, sus propias anclas. |
| El navegador pierde muestras | Se detecta en las anclas (§9.4) y se corrige por tramos. |
| Poco espacio en disco | Aviso antes de iniciar y durante la sesión; se para limpiamente antes de corromper nada. |
| Falla la entrega | Los datos siguen en OPFS. Al volver a pulsar Entregar solo se suben los trozos que faltan; si no, se descarga el ZIP. |
| El máster se desconecta | Cada cliente sigue grabando. Cualquier participante con el panel abierto puede finalizar su propia pista. |
| Falla Whisper con una pista | La postproducción continúa con las demás y lo refleja en el informe. |

---

## 18. Coste cero

| Elemento | Coste recurrente |
|---|---|
| Foundry VTT | Ya se usa |
| Módulo y herramienta | Código propio, 0 € |
| ffmpeg, whisper.cpp, DeepFilterNet | Libres, 0 € |
| Modelos Whisper | Locales, 0 € |
| Almacenamiento | Disco de cada uno + disco del editor |
| Firma de código / instaladores | **No hace falta:** no hay programa para los jugadores |
| LLM | Asistente que ya se tenga (manual) o local |

---

## 19. Riesgos abiertos

1. **La pestaña en segundo plano durante 4 horas** (§8.4). Es el riesgo principal y va el primero en la Fase 0.
2. **Precisión de la hora del servidor** detrás de alojamientos con latencia variable.
3. **Subida de 1,4 GB por jugador:** resuelta con trozos pequeños (§11), pero hay que comprobar el espacio libre en el servidor y el límite del proxy.
4. **`gainNode` no documentado** para las pistas de Foundry.
5. **Disciplina de cascos** de los jugadores.
6. **Calidad de Whisper** con nombres de fantasía y habla rápida y solapada.
7. **DeepFilterNet** lleva tiempo sin versiones nuevas. Si dejara de funcionar en el Mac del editor, el plan B es el filtro `arnndn` de ffmpeg (RNNoise), que no requiere instalar nada más.

---

## 20. Plan por fases

No empezar por la interfaz bonita ni por la crónica. Primero demostrar que lo difícil funciona.

### Fase 0 — Viabilidad (spikes desechables)

- **A. Grabación larga:** 4 horas de voz en el navegador con Foundry en segundo plano y Discord usando el mismo micro. Sin cortes ni congelaciones. Probarlo en Chrome, Edge y la app de Foundry.
- **B. Deriva y alineación:** 2-3 equipos reales, anclas, regresión y ffmpeg. Palmadas al inicio y al final, alineadas a ±30 ms.
- **C. Pistas de Foundry:** captura de los 3 contextos durante una sesión con música y efectos, sin afectar a la grabación de voz. Comparar con rehacer la música desde el log de eventos.
- **D. Ruido:** DeepFilterNet frente al original. Escuchar como podcast, ajustar la intensidad y comprobar que Whisper no empeora.
- **E. Whisper:** grabación real en castellano con `large-v3-turbo`: nombres propios, invenciones en los silencios, precisión de tiempos con VAD y tiempo de proceso en el Mac del editor.
- **F. Entrega:** subir 4 h de trozos al servidor real con `FilePicker.upload`, cortar la subida a mitad y reanudarla. Vigilar la memoria del servidor.

**Salida:** `docs/feasibility-report.md` con métricas y decisión GO / GO CON CAMBIOS / NO-GO.

### Fase 1 — Grabadora robusta

- Panel.
- Consentimientos.
- Inicio y fin coordinados.
- AudioWorklet, Worker y OPFS.
- Anclas.
- Recuperación tras recarga.
- Marcadores.
- Entrega.

### Fase 2 — Postproducción

- Validación.
- Deriva y alineación.
- Ruido.
- Whisper.
- Fusión.
- Exportaciones.
- Informe.

### Fase 3 — Pistas de Foundry

- Captura de los 3 contextos.
- Log de música.
- Lista para revisar licencias.

### Fase 4 — Integración en Foundry

- Relación usuario-personaje.
- Journal de sesión con la transcripción.
- Marcadores enlazados.

### Fase 5 — Memoria de campaña

- Prompt versionado.
- Diccionario por campaña.
- Adaptador para Ollama.
- `memory.json`.

### Fase 6 — Pulido

- Compresión en el navegador.
- Documentación para jugadores.
- Pruebas con mesas reales.

---

## 21. Pruebas y criterios de aceptación

| Prueba | Criterio |
|---|---|
| Grabación larga | 4 h sin huecos con la pestaña en segundo plano y Discord abierto. |
| Alineación | Palmadas inicial y final a ±30 ms en todas las pistas tras la postproducción. |
| Recuperación | Recargar el navegador a mitad: no se pierde nada ya escrito y la sesión se retoma. |
| Desconexión | 5 min sin servidor: la pista sigue, la alineación se mantiene dentro del objetivo. |
| Pistas de Foundry | Música y efectos grabados sin afectar a la voz. |
| Ruido | El editor prefiere la pista limpia en una escucha a ciegas y Whisper no empeora. |
| Entrega | 4 h de un jugador suben al servidor sin que el uso de RAM de Foundry crezca de forma notable; una subida cortada se reanuda sin repetir trozos. |
| Transcripción | Menos de un 10 % de errores en nombres del diccionario; ninguna invención de silencio en la salida final. |
| Coste | Todo funciona sin claves de API ni servicios en la nube. |
| Privacidad | El audio solo sale en la entrega explícita; no se graba a nadie sin consentimiento. |

**Corpus de prueba:** una sesión corta real con nombres propios, interrupciones y términos de fantasía, **grabada con consentimiento y fuera del repositorio.**

---

## 22. Mantenimiento

- Fijar versiones de ffmpeg, whisper.cpp y los modelos en el README de la herramienta; actualizarlas a propósito, no automáticamente.
- En cada versión mayor de Foundry, revisar `foundry-audio-tap.mjs` (`gainNode`), la petición de hora (`socket "time"`) y cómo gestiona el servidor las subidas.
- Revisar los cambios de los navegadores en AudioWorklet, OPFS y la gestión de pestañas en segundo plano.
- Mantener un test de integración de 30 minutos con dos navegadores.
- Formatos versionados (`schemaVersion`) con migraciones para el histórico.

---

## 23. Mejoras futuras

- Compresión en el navegador con WebCodecs (Opus 160 kbps ≈ 290 MB en 4 h) o FLAC.
- Editor de transcripción que salta al audio por marca de tiempo.
- Modo máster para marcar qué PNJ está hablando.
- Búsqueda semántica y RAG local sobre toda la campaña.
- Proyecto de Reaper (`.rpp`) generado automáticamente con pistas y marcadores.
- Rehacer la música automáticamente a partir del log de eventos.
- Importar sesiones antiguas grabadas de otras formas.

---

## 24. Prompt maestro para Claude Code

> **Ya usado:** el proyecto se empezó con este prompt, pero se construyó la versión 0.1.0 completa en lugar de solo los spikes; la Fase 0 se sustituyó por pruebas automáticas y en vivo en local. Para seguir trabajando, Claude Code debe leer `CLAUDE.md` en la raíz del repositorio. Se conserva como referencia.

```
Vamos a empezar MR · Chronicle (id de módulo Foundry: mr-chronicle).

CONTEXTO
Lee docs/MR_Chronicle.md entero antes de hacer nada: es la fuente de verdad.
Resumen: módulo de Foundry VTT que graba el micro de cada participante EN SU
NAVEGADOR (sin instalar nada) para publicar las partidas como podcast. Al terminar,
cada uno sube sus trozos al servidor de Foundry; un script en mi Mac corrige la
deriva, alinea, limpia el ruido con DeepFilterNet, transcribe con whisper.cpp
(large-v3-turbo) y fusiona.

CÓMO QUIERO QUE TRABAJES
- Empieza en modo plan: propón el plan de la Fase 0 y espera a que lo apruebe.
- Crea un CLAUDE.md con las reglas de este mensaje para las próximas sesiones.
- Haz SOLO la Fase 0. No pases a la Fase 1 sin que te lo diga explícitamente.
- Los spikes son desechables: el código mínimo que responda a la pregunta,
  sin arquitectura prematura. Cada uno con un README de cómo probarlo.
- Antes de programar algo sensible a la versión, comprueba la documentación
  vigente (Foundry, MDN, whisper.cpp, ffmpeg, DeepFilterNet) y, en Foundry,
  el código fuente real de mi instalación:
  /Applications/Foundry Virtual Tabletop.app/Contents/Resources/app/client
  Si algo del documento está desactualizado, dímelo y elige la alternativa
  más simple que respete los principios.
- Lo que no puedas probar tú (Discord, varios jugadores, 4 horas reales),
  déjalo en una lista de pruebas manuales con pasos claros.
- Escríbeme en español.

REGLAS TÉCNICAS
- Coste 0 €: nada de servicios de pago, nube, claves de API ni bots de Discord.
- Nada de programas nativos para los jugadores.
- Durante la partida no se procesa audio: getUserMedia en bruto
  (echoCancellation, noiseSuppression y autoGainControl a false).
- Voz: AudioWorklet (cuenta muestras, int16) → MessageChannel → Worker →
  OPFS con createSyncAccessHandle, trozos de 60 s. Nunca MediaRecorder para la voz.
- Tiempo: anclas cada 30 s {frame, ctxTime, perfMs, serverMs, rttMs}.
  serverMs con game.socket.emit("time", cb), 8 muestras, la de menor RTT.
  Postproducción: regresión serverMs = a + b·frame → ffmpeg asetrate/aresample/adelay.
- Pistas de Foundry (solo máster): game.audio.{music,environment,interface}.gainNode
  → createMediaStreamDestination → mismo pipeline, aislado en foundry-audio-tap.mjs.
  Además, log de los hooks updatePlaylist y updatePlaylistSound.
- Entrega: FilePicker.upload trozo a trozo a Data/mr-chronicle/<sessionId>/<userId>/,
  reanudable con FilePicker.browse. Nunca un archivo grande de una vez: el servidor
  guarda cada subida entera en RAM (express-fileupload).
- Foundry V13 y V14, API pública siempre que se pueda, ApplicationV2, socket: true.
- Navegadores: Chrome, Edge y la app de Foundry.
- JavaScript ESM en el módulo y en la herramienta (Node.js). Sin frameworks ni
  dependencias que no aporten un valor claro.
- No subas al repositorio audios, modelos ni sesiones. .gitignore correcto.
- No hagas commits ni pushes sin preguntarme.

FASE 0 — SPIKES
A. Grabación larga: módulo mínimo que graba el micro con la pestaña en segundo plano;
   informe de huecos a partir de las anclas y uso de disco.
B. Deriva: script que recibe N paquetes, calcula la regresión, alinea con ffmpeg y
   reporta fsReal, desfase y error residual. Instrucciones para la prueba de palmadas.
C. Pistas de Foundry: grabar los 3 contextos + log de música a la vez que la voz.
D. Ruido: DeepFilterNet frente al original; instrucciones de escucha y efecto en Whisper.
E. Whisper: whisper-cli -l es -oj con VAD, --prompt con diccionario, large-v3-turbo.
   Medir tiempo, errores en nombres, invenciones en silencios y si los tiempos con
   VAD siguen referidos al audio original.
F. Entrega: subida trozo a trozo reanudable; medir la RAM del servidor de Foundry.

ESTRUCTURA
mr-chronicle/
  CLAUDE.md  README.md  LICENSE  THIRD_PARTY_NOTICES.md  .gitignore
  docs/MR_Chronicle.md  docs/feasibility-report.md
  spikes/a-recording/  spikes/b-drift/  spikes/c-foundry-audio/
  spikes/d-noise/  spikes/e-whisper/  spikes/f-delivery/

AL TERMINAR LA FASE 0
docs/feasibility-report.md con plataforma, versiones, métricas, resultado de cada
spike, problemas, riesgos, decisión GO / GO CON CAMBIOS / NO-GO y los cambios de
arquitectura que propongas. Luego para y espera.
```

## 25. Referencias

**Comprobado en el código de Foundry VTT 13.351** (app de escritorio local, 28-09-2026):

- `client/helpers/time.mjs`: `GameTime#sync` usa `game.socket.emit("time")`, `SYNC_INTERVAL_MS = 5 min` y la media de 10 viajes de ida y vuelta.
- `client/audio/helper.mjs`: `AUDIO_CONTEXTS = ["music","environment","interface"]`; cada contexto tiene `ctx.gainNode → ctx.destination`.
- `dist/components/activity.mjs`: `serverTime = Date.now() − inicio del mundo`.
- `dist/files/local.mjs`: `createDirectory` exige `isAdmin` (rol Asistente o superior); no se puede sobrescribir un archivo que no sea multimedia.
- `common/constants.mjs`: `UPLOADABLE_FILE_EXTENSIONS` (audio, `json`, `txt`…); `FILES_UPLOAD` es de Asistente por defecto y `FILES_BROWSE`, de Jugador de confianza.
- `dist/server/express.mjs`: las subidas usan `express-fileupload` sin `limits` ni `useTempFiles` (cada archivo se guarda entero en memoria); socket.io con `maxHttpBufferSize: 1e8`.

**Documentación que hay que volver a verificar al empezar:**

- Foundry VTT, desarrollo de módulos y sockets: https://foundryvtt.com/article/module-development/
- Foundry VTT API: https://foundryvtt.com/api/
- MDN, AudioWorklet: https://developer.mozilla.org/docs/Web/API/AudioWorklet
- MDN, Origin Private File System: https://developer.mozilla.org/docs/Web/API/File_System_API/Origin_private_file_system
- MDN, `AudioContext.getOutputTimestamp()`: https://developer.mozilla.org/docs/Web/API/AudioContext/getOutputTimestamp
- whisper.cpp: https://github.com/ggml-org/whisper.cpp
- ffmpeg, filtros (`asetrate`, `aresample`, `adelay`, `arnndn` como plan B): https://ffmpeg.org/ffmpeg-filters.html
- DeepFilterNet: https://github.com/Rikorose/DeepFilterNet

---

**Regla del proyecto:** primero demostrar que se graban 4 horas sin cortes, que las pistas quedan alineadas y que Whisper entiende la mesa. Después, construir el producto.
