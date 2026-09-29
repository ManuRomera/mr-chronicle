# MR · Chronicle — notas para Claude

Módulo de Foundry VTT (`mr-chronicle`) + herramienta de postproducción en Node.js. La fuente de verdad del diseño es `docs/MR_Chronicle.md`: léela antes de cambiar la arquitectura.

## Reglas

- Todo en español: código, comentarios, commits, documentación y respuestas.
- Coste 0 €: nada de servicios de pago, nube ni claves de API. Nada de programas nativos para los jugadores.
- Sin dependencias en el módulo ni en la herramienta (solo la plataforma, ffmpeg, whisper-cli y deep-filter).
- No hacer commits ni pushes sin preguntar.
- Foundry V13 y V14; comprobar APIs en el código real:
  `/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app/` (`client/`, `common/`, `dist/`).

## Dónde está cada cosa

| Archivo | Qué hace |
|---|---|
| `module/sesion.mjs` | Coordinación. El control va en el ajuste de mundo `sesion`; el socket solo lleva estados y la petición de crear carpetas. |
| `module/grabadora.mjs` | `Pista`: AudioWorklet → Worker → OPFS, y anclas cada 30 s. |
| `workers/` | Worklet de captura y escritor de trozos WAV de 60 s. |
| `module/tiempo.mjs` | Hora del servidor con `socket "time"`, muestra de menor ida y vuelta. |
| `module/foundry-audio-tap.mjs` | Único uso de API no documentada (`game.audio.*.gainNode`). |
| `module/entrega.mjs` | Subida trozo a trozo con `FilePicker.upload` y descarga local. |
| `herramientas/post/` | Postproducción. `lib.mjs` son funciones puras con pruebas. Busca los programas en `~/.cache/mr-chronicle/bin` antes que en el PATH. |
| `herramientas/instalar/` | Instaladores y lanzadores por sistema. Versiones fijadas: whisper.cpp v1.9.2 (la última con ejecutables para Windows y Linux; v1.9.3 y v1.9.4 no traen), DeepFilterNet 0.5.6. |

## Trampas ya encontradas

- `serverTime` de Foundry cuenta **desde que se lanzó el mundo**, no es una fecha. Si el servidor se reinicia, vuelve a cero; por eso las anclas llevan también `epochMs`, y la postproducción recoloca los tramos.
- Los AudioContext de Foundry usan búfer corto y **se saltan trozos** con la pestaña en segundo plano. Nunca grabar dentro de ellos: su salida pasa por un MediaStream a un contexto propio con `latencyHint: "playback"`.
- Solo el rol Asistente o superior puede crear carpetas en el servidor. El jugador se la pide al máster por el socket.
- El servidor solo acepta ciertas extensiones: por eso el audio va en `.wav`, y las anclas y marcadores en `.txt` (con contenido NDJSON). Los archivos que no son multimedia no se pueden sobrescribir.
- `express-fileupload` guarda cada subida entera en RAM: nunca subir archivos grandes de una vez.
- Foundry no tiene el helper de Handlebars `selected`.
- Alineación en ffmpeg: **nunca por marcas de tiempo** (`asetpts`, `first_pts`, `atrim=0:dur`). Cada versión las trata distinto: ffmpeg 6.1 aplicaba el desplazamiento dos veces. Se hace por muestras: `asetrate`×100 + `aresample`, `adelay …S`, `atrim start_sample/end_sample`, `apad whole_len`. Para probar con ffmpeg 6.1 en Mac: build estática de evermeet.cx antepuesta al PATH.
- Instaladores: `brew install` actualiza lo que ya está instalado, así que solo se instala lo que falte. El `.ps1` necesita BOM UTF-8 para el PowerShell 5.1 de Windows; en PowerShell, `Invoke-RestMethod` pasa la lista JSON por la tubería como un único objeto (recórrela con `foreach`). El instalador de Windows se prueba en Mac con PowerShell portátil: `USERPROFILE=<tmp> MRC_SIN_MODELO=1 MRC_SIN_COMPROBAR=1 MRC_SIN_PAUSA=1 pwsh -File instalar-windows.ps1`.
- Pistas de Foundry en Opus (`workers/ogg.js`): el gránulo de cada página hay que fijarlo al salir el paquete del codificador, no al escribirlo (la escritura va en cola). El retardo del codificador es `PRE_SKIP` = 312; comprobado con un clic que cae en su muestra exacta.
- El paso por MediaStream retrasa las pistas de Foundry unos 100 ms respecto a las voces.
- Whisper pone el inicio de una frase al principio de su ventana de 30 s si antes hubo silencio. El VAD de whisper.cpp no lo arregla: junta toda la voz en un segmento. Se recortan los tiempos con `silencedetect` sobre la pista limpia (`ajustarAVoz` en `lib.mjs`).

## Probar

```bash
npm test
```

Para probar el módulo en vivo, usa una carpeta de datos aparte con `Config/license.json` copiado, el módulo enlazado en `Data/modules`, un mundo mínimo y:

```bash
node main.js --dataPath=<carpeta> --port=30015 --world=<mundo> --noupnp
```

- Para tener dos usuarios, abre una pestaña en `localhost:30015` (máster) y otra en `127.0.0.1:30015` (jugador).
- El navegador integrado no tiene micro: sustituye `navigator.mediaDevices.getUserMedia` por un `MediaStreamDestination` con clics programados a la hora del servidor, y comprueba la alineación con la herramienta de postproducción.
