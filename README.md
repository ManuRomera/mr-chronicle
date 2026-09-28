# MR · Chronicle

Graba tus partidas de Foundry VTT como **podcast multipista**, sin instalar nada para jugar y sin coste.

- Cada participante graba **su propio micro, en su navegador**, en bruto y a 48 kHz.
- El máster graba además la **música, el ambiente y los efectos** de Foundry, cada uno en su pista.
- Al acabar, cada uno **entrega** su grabación al servidor de Foundry con un botón.
- Una herramienta de **postproducción** corrige la deriva de reloj de cada tarjeta de sonido, alinea todas las pistas al mismo 0:00, limpia el ruido (DeepFilterNet) y transcribe con Whisper sabiendo quién dijo cada cosa.

El diseño completo, con las decisiones y sus porqués, está en [docs/MR_Chronicle.md](docs/MR_Chronicle.md).

## Para jugar

**Requisitos:**
- **Chrome, Edge o la app de escritorio de Foundry.** Firefox y Safari no están soportados.
- **Cascos:** con altavoces, tu micro recogería a los demás.
- Unos **1,5 GB libres** por cada 4 horas de partida.

**Pasos:**
1. El máster abre el panel con el indicador **MR · Chronicle** (arriba, en el centro) y pulsa **Preparar sesión**.
2. A cada participante se le abre el panel: elige micro, comprueba que el medidor se mueve y **acepta** grabar (y, aparte, publicar).
3. El máster pulsa **Iniciar grabación**. El indicador se pone rojo en todos los que graban.
4. Durante la partida:
   - **★ Marcar momento** (o `Ctrl+Shift+M`) deja una marca para la edición.
   - **✂ Cortar esto** avisa de algo que no debe publicarse.
   - **Pausar mi micro** graba silencio mientras dure.
5. El máster pulsa **Finalizar**. Cada uno pulsa **Entregar**. Si se corta, se vuelve a pulsar: solo sube lo que falte.

Si alguien recarga o cierra el navegador a mitad, lo ya grabado está a salvo. Al volver a entrar, la grabación sigue en cuanto hace clic en la mesa.

### Configuración del máster (una sola vez)

- **Configurar permisos → Subir archivos** (y **Explorar archivos**): actívalo para el rol **Jugador**. Sin eso, los jugadores tendrán que usar **Descargar** y enviarte la carpeta.
- Si Foundry va detrás de un proxy (nginx, Cloudflare…), debe aceptar peticiones de al menos 16 MB (`client_max_body_size 16m` en nginx).
- Durante la entrega el máster tiene que estar conectado: es quien crea la carpeta de cada jugador en el servidor.

Las entregas quedan en `Data/mr-chronicle/<sesión>/<usuario>/`.

## Postproducción

**Requisitos (Mac):**

```bash
brew install ffmpeg whisper-cpp
```

- **DeepFilterNet:** descarga el ejecutable `deep-filter` para tu sistema desde https://github.com/Rikorose/DeepFilterNet/releases y ponlo en el PATH.
- **Modelo de Whisper:** `ggml-large-v3-turbo.bin` en `~/.cache/mr-chronicle/` (o indica otra ruta en `campana.json` o con la variable `MR_CHRONICLE_MODELO`).

**Uso:**

```bash
node herramientas/post/mr-chronicle-post.mjs /ruta/a/Data/mr-chronicle/<sesión> --config campana.json
```

Opciones:
- `--salida <dir>`
- `--sin-ruido`
- `--sin-whisper`

Copia [herramientas/post/campana.ejemplo.json](herramientas/post/campana.ejemplo.json) para configurar:

| Campo | Para qué |
|---|---|
| `diccionario` | Nombres propios de la campaña; ayudan a Whisper a escribirlos bien. |
| `correcciones` | Los que aun así escribe mal: `{"Strath": "Strahd"}`. Solo cambia palabras completas. |
| `ajustesMs` | Desfase fijo por participante, calibrado con las palmadas (ver abajo). |
| `reduccionRuidoDb` | Cuánto ruido quita DeepFilterNet (30 dB deja la voz natural; 100 lo quita todo). |
| `umbralSilencioDb` | Por debajo de este nivel se considera silencio al ajustar los tiempos de la transcripción. |

No actives `vad`: el detector de voz de whisper.cpp junta toda la voz de una persona en segmentos enormes. La herramienta ya detecta la voz por su cuenta sobre la pista limpia.

**Resultado en `salida/`:**

| Archivo | Qué es |
|---|---|
| `stems/voz-<nombre>.wav` | Voz limpia. Todas las pistas empiezan en 0:00 y duran lo mismo. |
| `stems/voz-<nombre>.bruta.wav` | Voz original, alineada. |
| `stems/foundry-musica.wav`, `foundry-ambiente.wav`, `foundry-efectos.wav` | Lo que sonó en Foundry. |
| `transcript.md`, `.json`, `.srt` | Transcripción con hablante y hora. |
| `marcadores.txt` | Marcadores, para importar en Audacity (Archivo → Importar → Etiquetas). |
| `musica.json` | Qué sonó y cuándo. |
| `informe.md` | Deriva y error de cada pista, avisos, qué cortar y qué música revisar por licencias. |

### Afinar la sincronía con palmadas

Al empezar y al acabar la partida, todos dan una palmada contando «3, 2, 1» en voz alta. Si en el editor la palmada de alguien sale siempre desplazada, pon ese desfase en `ajustesMs` de `campana.json`, en milisegundos y con signo (positivo retrasa la pista), y vuelve a ejecutar.

### Crónica de la sesión

Pega [prompts/cronica.md](prompts/cronica.md) y después `transcript.md` en tu asistente.

## Desarrollo

```bash
npm test
```

Ejecuta las pruebas de la postproducción: regresión, filtros y una sesión sintética de extremo a extremo con deriva, recarga y reinicio del servidor.

Compatibilidad: Foundry V13 (comprobado en 13.351). V14 queda pendiente de prueba.
