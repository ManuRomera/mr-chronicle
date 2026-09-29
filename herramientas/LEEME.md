# MR · Chronicle — procesar una sesión

Con esto conviertes las grabaciones de una partida en pistas alineadas y limpias para el podcast, una transcripción con quién dijo qué y un informe. Funciona en **Windows, Mac y Linux**. Cualquiera del grupo puede hacerlo.

## 1. Instalar (solo la primera vez)

Descarga unos 2 GB en total (el modelo de Whisper son 1,6 GB). No necesita permisos de administrador. Si se corta, vuelve a abrirlo: sigue donde iba y no repite lo que ya está.

| Sistema | Qué abrir |
|---|---|
| **Windows** | Doble clic en `instalar/Instalar en Windows.bat`. |
| **Mac** | Doble clic en `instalar/instalar-mac.command`. Necesita [Homebrew](https://brew.sh); si no lo tienes, el instalador te dice cómo ponerlo. |
| **Linux** | En una terminal: `bash instalar/instalar-linux.sh` (Ubuntu 22.04+, Debian 12+, Oracle Linux 9+…). |

**Avisos de seguridad del sistema** (los archivos vienen de Internet):
- **Windows** puede decir «Windows protegió su PC». Pulsa **Más información → Ejecutar de todas formas**.
- **Mac** puede decir que no puede abrirse porque es de un desarrollador no identificado. Haz **clic derecho → Abrir → Abrir**.

Al terminar, el instalador comprueba que está todo y muestra ✔ o ✖ en cada pieza.

**Velocidad:** en un Mac con chip Apple o en un Windows con tarjeta NVIDIA (el instalador lo detecta y usa la versión rápida), una sesión de 4 horas tarda unos 15 minutos por jugador. En un ordenador sin tarjeta gráfica puede tardar varias horas: déjalo trabajando.

## Para el máster con Foundry en casa

Para poder grabar, los jugadores necesitan entrar por `https://`. En `servidor/` está **Compartir Foundry** (`compartir-foundry.command` en Mac y Linux, `Compartir Foundry (Windows).bat` en Windows): abre un túnel gratuito de Cloudflare y te da una dirección `https://…trycloudflare.com` para todos. Deja la ventana abierta durante la partida y pon contraseña a los usuarios de Foundry.

## 2. Juntar las grabaciones

Al acabar la partida, cada jugador pulsa en el panel de MR · Chronicle:

- **Descargar**, y elige la **carpeta compartida del grupo** en Google Drive, MEGA o Dropbox, la que su programa de sincronización tiene en el ordenador. Se crea `<sesión>/<nombre>/` y todo se junta solo.
  - Si no tiene el programa de sincronización, puede descargar en cualquier carpeta y luego arrastrar esa carpeta a la web de Drive o MEGA, dentro de la carpeta de la sesión.
- O **Entregar**, que la sube al servidor de Foundry. Luego alguien tiene que copiar `Data/mr-chronicle/<sesión>` del servidor.

Cuando estén todos, la carpeta de la sesión tiene una subcarpeta por participante.

## 3. Procesar

| Sistema | Qué abrir |
|---|---|
| **Windows** | Doble clic en `instalar/Procesar sesion (Windows).bat`. También puedes arrastrar la carpeta de la sesión encima del archivo. |
| **Mac** | Doble clic en `instalar/procesar.command`. |
| **Linux** | `bash instalar/procesar.command` |

Te pedirá la carpeta de la sesión: **arrástrala a la ventana** y pulsa Intro.

Si en la carpeta de la sesión, o en la de encima (la carpeta compartida del grupo), hay un `campana.json`, se usa solo. Copia `post/campana.ejemplo.json` allí con ese nombre y pon los nombres propios de vuestra campaña:

- `diccionario`: los nombres que Whisper debe conocer.
- `correcciones`: los que aun así escribe mal, por ejemplo `{"Strath": "Strahd"}`.
- `ajustesMs`: el desfase fijo de alguien, calibrado con las palmadas.

## 4. Resultado

En `<sesión>/salida/`:

| Archivo | Qué es |
|---|---|
| `informe.md` | **Léelo primero.** Quién no quiere que se publique su voz, qué hay que cortar, qué música revisar por licencias y si alguna pista tiene problemas. |
| `stems/` | Una pista por persona (limpia y en bruto), más música, ambiente y efectos. Todas empiezan en 0:00: arrástralas a Reaper o Audacity y ya están alineadas. |
| `marcadores.txt` | Marcadores de la partida. En Audacity: Archivo → Importar → Etiquetas. |
| `transcript.md`, `.srt`, `.json` | Transcripción con hora y hablante; subtítulos. |

Para la crónica, pega el contenido de `cronica.md` en tu asistente y, debajo, `transcript.md`.

Si la carpeta compartida se queda corta de espacio, procesa con la salida en tu disco: añade `--salida <carpeta>` al final de la orden en Terminal.
