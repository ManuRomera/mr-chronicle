# MR · Chronicle

> [!WARNING]
> **En desarrollo (WIP).** Funciona de principio a fin en pruebas locales, pero todavía no se ha probado en una partida real larga con varios jugadores. Úsalo para hacer pruebas, no para una sesión que no puedas repetir. Si encuentras un fallo, abre una [issue](https://github.com/ManuRomera/mr-chronicle/issues).

Graba tus partidas de Foundry VTT como **podcast multipista**, sin instalar nada para jugar y sin coste.

- Cada participante graba **su propio micro, en su navegador**, en bruto y a 48 kHz.
- El máster graba además la **música, el ambiente y los efectos** de Foundry, cada uno en su pista.
- Al acabar, cada uno **entrega** su grabación: al servidor de Foundry o a una carpeta compartida de Google Drive, MEGA o Dropbox.
- Una herramienta de **postproducción** corrige la deriva de reloj de cada tarjeta de sonido, alinea todas las pistas al mismo 0:00, limpia el ruido (DeepFilterNet) y transcribe con Whisper sabiendo quién dijo cada cosa.

El diseño completo, con las decisiones y sus porqués, está en [docs/MR_Chronicle.md](docs/MR_Chronicle.md).

## Instalación

Solo se instala en el **servidor de Foundry** (el ordenador o el servicio donde corre). Los jugadores no instalan nada.

En Foundry: **Configuración → Módulos → Instalar módulo**, y en *URL del manifiesto* pega:

```
https://github.com/ManuRomera/mr-chronicle/releases/latest/download/module.json
```

Después activa **MR · Chronicle** en el mundo (Gestionar módulos). Compatible con Foundry V13 (V14 sin probar todavía).

## Para jugar

**Requisitos:**
- **Chrome, Edge o la app de escritorio de Foundry.** Firefox y Safari no están soportados.
- **Cascos:** con altavoces, tu micro recogería a los demás.
- Espacio libre para 4 horas de partida: **1,5 GB** los jugadores, **unos 2,5 GB** el máster (su voz más la música y los efectos de Foundry, estos comprimidos en Opus).
- **No suspendas el ordenador** (ni cierres la tapa del portátil) durante la partida: la grabación se para hasta que vuelvas. **No uses el modo incógnito** ni borres los datos del navegador antes de entregar.

**Pasos:**
1. El máster abre el panel con el indicador **MR · Chronicle** (arriba, en el centro) y pulsa **Preparar sesión**.
2. A cada participante se le abre el panel: elige micro, comprueba que el medidor se mueve y **acepta** grabar (y, aparte, publicar).
3. El máster pulsa **Iniciar grabación**. El indicador se pone rojo en todos los que graban.
4. Durante la partida:
   - **★ Marcar momento** (o `Ctrl+Shift+M`) deja una marca para la edición.
   - **✂ Cortar esto** avisa de algo que no debe publicarse.
   - **Pausar mi micro** graba silencio mientras dure.
5. El máster pulsa **Finalizar**. Cada uno entrega su grabación de una de estas dos formas:
   - **Entregar:** la sube al servidor de Foundry. Si se corta, se vuelve a pulsar y solo sube lo que falte.
   - **Descargar:** la guarda en la carpeta que elija. Si todos eligen la **carpeta compartida del grupo** en Google Drive, MEGA o Dropbox (la que sincroniza su ordenador), las grabaciones se juntan solas en `<sesión>/<nombre>/`, y cualquiera del grupo puede procesarlas.

Si alguien recarga o cierra el navegador a mitad, lo ya grabado está a salvo. Al volver a entrar, la grabación sigue en cuanto hace clic en la mesa. Si el micro se desconecta o deja de llegar sonido durante 30 s, avisa en pantalla (y el máster lo ve en la lista de la mesa).

### Configuración del máster (una sola vez)

- **Configurar permisos → Subir archivos** (y **Explorar archivos**): actívalo para el rol **Jugador**. Sin eso, los jugadores tendrán que usar **Descargar** y enviarte la carpeta.
- Si Foundry va detrás de un proxy (nginx, Cloudflare…), debe aceptar peticiones de al menos 16 MB (`client_max_body_size 16m` en nginx).
- Durante la entrega el máster tiene que estar conectado: es quien crea la carpeta de cada jugador en el servidor.

Las entregas quedan en `Data/mr-chronicle/<sesión>/<usuario>/`.

### Dónde está Foundry: da igual

La grabación la hace el navegador de cada participante, así que funciona igual con Foundry en tu ordenador, en el Windows de otro máster o en un servidor (Oracle, Forge, etc.). Lo que cambia es dónde acaban las entregas con **Entregar**:

- **Foundry en el ordenador de un máster** (Windows: `%LOCALAPPDATA%\FoundryVTT\Data\mr-chronicle\`). Ese ordenador hace de servidor y además graba: en un portátil justo puede notarse.
- **Foundry en un servidor Linux** (por ejemplo, la capa gratuita de Oracle):
  - **Espacio:** unos 8 GB por sesión de 4 horas con 4 jugadores. Bájate las sesiones y bórralas del servidor.
  - **Proxy:** si va detrás de nginx, pon `client_max_body_size 16m;`, porque por defecto rechaza la entrega. Caddy no tiene límite.
  - **Tiempo de subida:** 1,4 GB con 10 Mbps de subida son unos 20 minutos por jugador. Con la carpeta compartida, en cambio, cada uno sube a Drive o MEGA a su ritmo.
  - **Para bajarlo:** `rsync -av usuario@servidor:/ruta/a/Data/mr-chronicle/ ./mr-chronicle/`
  - No proceses en el servidor: Whisper sin tarjeta gráfica tardaría horas.

## Postproducción

Cualquiera del grupo puede procesar una sesión, en **Windows, Mac o Linux**, con instaladores de doble clic. La guía completa para quien procese está en [herramientas/LEEME.md](herramientas/LEEME.md).

Como el repositorio es privado, para tus amigos hay un paquete con solo lo necesario:

```bash
npm run herramientas
```

Genera `dist/MR-Chronicle-herramientas.zip` (instaladores, herramienta, guía y prompt de crónica). Déjalo en la carpeta compartida del grupo.

**Resumen:**
1. `herramientas/instalar/`: *Instalar en Windows.bat*, *instalar-mac.command* o *instalar-linux.sh* (una vez). Instala ffmpeg, whisper.cpp, DeepFilterNet, Node si falta y el modelo de Whisper en `~/.cache/mr-chronicle`, sin tocar el sistema.
2. *Procesar sesion (Windows).bat* o *procesar.command* (Mac y Linux), y arrastrar la carpeta de la sesión.

En la línea de órdenes:

```bash
node herramientas/post/mr-chronicle-post.mjs <carpeta-sesión> [--salida dir] [--config campana.json] [--sin-ruido] [--sin-whisper]
```

`--comprobar` dice qué falta por instalar.

Si en la carpeta de la sesión, o en la de encima, hay un `campana.json`, se usa solo. Copia [herramientas/post/campana.ejemplo.json](herramientas/post/campana.ejemplo.json):

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
| `stems/foundry-musica.wav`, `foundry-ambiente.wav`, `foundry-efectos.wav` | Lo que sonó en Foundry (grabado en Opus a 160 kbps; llega unos 0,1 s tarde respecto a las voces, sin importancia para música de fondo). |
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
