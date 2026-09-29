# MR · Chronicle — Manual de instrucciones

> **En desarrollo (WIP).** Úsalo para pruebas antes de confiarle una partida importante.

MR · Chronicle graba vuestras partidas de Foundry VTT como **podcast multipista**:

- Cada participante graba **su propio micrófono en su navegador**.
- El máster graba además la **música, el ambiente y los efectos** de Foundry.
- Al acabar, una herramienta de **postproducción** alinea todas las pistas, limpia el ruido y transcribe quién dijo qué.

Sin instalar nada para jugar y sin coste.

**Contenido**

1. [Dónde está cada cosa](#1-dónde-está-cada-cosa)
2. [Lo que necesitáis](#2-lo-que-necesitáis)
3. [Instalar el módulo](#3-instalar-el-módulo)
4. [Configuración del máster (una sola vez)](#4-configuración-del-máster-una-sola-vez)
5. [HTTPS: imprescindible para grabar](#5-https-imprescindible-para-grabar)
6. [Antes de cada partida](#6-antes-de-cada-partida)
7. [Durante la partida](#7-durante-la-partida)
8. [Al acabar: entregar las grabaciones](#8-al-acabar-entregar-las-grabaciones)
9. [Procesar la sesión](#9-procesar-la-sesión)
10. [Editar el podcast y la crónica](#10-editar-el-podcast-y-la-crónica)
11. [Si algo falla](#11-si-algo-falla)
12. [Espacio y tiempos](#12-espacio-y-tiempos)
13. [Para el desarrollo](#13-para-el-desarrollo)

---

## 1. Dónde está cada cosa

### En Internet

| Qué | Dónde |
|---|---|
| Repositorio (código, documentación, incidencias) | https://github.com/ManuRomera/mr-chronicle |
| Manifiesto para instalar en Foundry | `https://github.com/ManuRomera/mr-chronicle/releases/latest/download/module.json` |
| Versiones publicadas (módulo y zip de herramientas) | https://github.com/ManuRomera/mr-chronicle/releases |

### En el ordenador de Manu (Mac)

| Qué | Ruta |
|---|---|
| **Módulo y repositorio** (es la misma carpeta) | `/Volumes/Datos_Dock/FoundryVTT/Data/modules/mr-chronicle/` |
| Este manual | `…/mr-chronicle/docs/MANUAL.md` |
| Diseño técnico completo | `…/mr-chronicle/docs/MR_Chronicle.md` (copia en `~/Downloads/MR_Chronicle.md`) |
| Guía para quien procesa | `…/mr-chronicle/herramientas/LEEME.md` |
| Instaladores y lanzadores | `…/mr-chronicle/herramientas/instalar/` |
| Túnel HTTPS (Compartir Foundry) | `…/mr-chronicle/herramientas/servidor/` |
| Herramienta de postproducción | `…/mr-chronicle/herramientas/post/mr-chronicle-post.mjs` |
| Ejemplo de configuración de campaña | `…/mr-chronicle/herramientas/post/campana.ejemplo.json` |
| Prompt para la crónica | `…/mr-chronicle/prompts/cronica.md` |
| **Zip de herramientas para el grupo** | `~/Downloads/MR-Chronicle-herramientas.zip` (se regenera con `npm run herramientas` en `dist/`) |
| Programas instalados (ffmpeg aparte) | `~/.cache/mr-chronicle/bin/` (`deep-filter`, `cloudflared`) |
| Modelo de Whisper | `~/.cache/mr-chronicle/ggml-large-v3-turbo.bin` |
| **Entregas que llegan al Foundry de este Mac** | `/Volumes/Datos_Dock/FoundryVTT/Data/mr-chronicle/<sesión>/<usuario>/` |

### En cualquier ordenador

| Qué | Ruta |
|---|---|
| Programas y modelo que instalan los instaladores | Mac/Linux: `~/.cache/mr-chronicle/` · Windows: `%USERPROFILE%\.cache\mr-chronicle\` |
| Entregas en un servidor Foundry | `<carpeta de datos de Foundry>/Data/mr-chronicle/<sesión>/<usuario>/` |
| Foundry en Windows (carpeta de datos por defecto) | `%LOCALAPPDATA%\FoundryVTT\Data\` |
| Resultado de procesar una sesión | `<carpeta de la sesión>/salida/` |
| **La grabación mientras se juega** | Dentro del navegador de cada uno (almacenamiento privado del navegador). No es una carpeta visible: se saca con **Entregar** o **Descargar**. |

### Qué hay dentro de una entrega

```
<sesión>/                      p. ej. 2026-10-05-2130-curse-of-strahd-26
  <usuario>/                   uno por participante
    manifiesto.json            quién es, consentimientos, pistas
    voz-1-000001.wav …         su micro, en trozos de 60 s (sin comprimir)
    voz-1-anclas.txt           marcas de tiempo para sincronizar
    marcadores.txt             momentos marcados y «cortar esto»
    (solo el máster)
    musica-1-000001.ogg …      música, ambiente y efectos de Foundry (Opus)
    ambiente-1-…  efectos-1-…
    musica.txt                 qué sonó y cuándo
  campana.json                 (opcional) nombres propios y ajustes
  salida/                      lo crea la postproducción
```

El número tras `voz-` es el **tramo**: si alguien recarga el navegador a mitad de partida, empieza el tramo 2, y la postproducción los junta.

---

## 2. Lo que necesitáis

**Todos los que graban:**
- **Chrome o Edge.** Ni la app de escritorio de Foundry, ni Firefox, ni Safari.
- **Cascos.** Con altavoces, tu micro recogería a los demás.
- **Foundry abierto por `https://` o por `localhost`** (ver [sección 5](#5-https-imprescindible-para-grabar)).
- **Espacio libre** para 4 horas: unos **1,5 GB** los jugadores y unos **2,5 GB** el máster.

**El máster, además:** Foundry V13 con el módulo instalado.

**Quien procese la sesión** (cualquiera del grupo): Windows, Mac o Linux, unos 2 GB de descarga la primera vez y paciencia si su ordenador no tiene tarjeta gráfica (ver [sección 12](#12-espacio-y-tiempos)).

---

## 3. Instalar el módulo

Solo se instala en el **Foundry que hace de servidor**. Los jugadores no instalan nada.

1. En Foundry, en la pantalla de inicio: **Módulos** (*Add-on Modules*) → **Instalar módulo**.
2. En **URL del manifiesto**, pega:
   ```
   https://github.com/ManuRomera/mr-chronicle/releases/latest/download/module.json
   ```
3. Pulsa **Instalar**.
4. Entra en el mundo → **Configuración** → **Gestionar módulos** → activa **MR · Chronicle**.

Para actualizar: Foundry avisa cuando hay versión nueva, en la pantalla de módulos → **Actualizar**.

> ⚠️ **Manu: en el Foundry de tu Mac no instales ni actualices MR · Chronicle desde el manifiesto.** Esa carpeta es el repositorio de desarrollo y ya tiene siempre la última versión. Si Foundry la sustituye, se pierde el historial de git (ver [sección 13](#13-para-el-desarrollo)).

---

## 4. Configuración del máster (una sola vez)

1. **Permisos de subida** (solo si vais a entregar al servidor de Foundry): **Configuración** → **Configurar permisos** → marca **Subir archivos** y **Explorar archivos** para el rol **Jugador**. Sin esto, los jugadores tendrán que usar **Descargar**.
2. **Contraseñas:** si vas a usar el túnel o un servidor en Internet, **pon contraseña a todos los usuarios**, sobre todo al máster (**Configuración** → **Usuarios**).
3. **Proxy:** solo si Foundry va detrás de nginx. Pon `client_max_body_size 16m;` o fallarán las entregas. Con Caddy, con el túnel o sin proxy, no hace falta nada.

---

## 5. HTTPS: imprescindible para grabar

Los navegadores **solo permiten el micrófono y guardar la grabación en páginas seguras**, las que empiezan por `https://` o por `localhost`. Si en la barra de direcciones pone **«No es seguro»**, no se puede grabar, y el panel lo avisa. Es una regla de los navegadores; ningún módulo puede saltársela.

Elige tu caso:

| Caso | Qué hacer |
|---|---|
| **Juegas en el mismo ordenador que tiene Foundry** | Abre `http://localhost:30000` (no la IP). El aviso del panel trae el enlace. |
| **Foundry en casa del máster y los demás desde sus casas** | Usa **Compartir Foundry** (abajo). |
| **Foundry en un servidor** (Oracle, etc.) | También **Compartir Foundry**, o un dominio con HTTPS (Caddy). |
| **Prueba rápida en la misma red, sin HTTPS** | En Chrome: `chrome://flags/#unsafely-treat-insecure-origin-as-secure` → añade la dirección de Foundry → **Relaunch**. Solo para pruebas. |

### Compartir Foundry (túnel HTTPS gratuito)

Da una dirección `https://algo.trycloudflare.com` que lleva a tu Foundry. No necesita dominio ni abrir puertos del router, y los jugadores no instalan nada.

1. Arranca Foundry y **lanza el mundo**.
2. Abre, según tu sistema:
   - **Mac:** doble clic en `herramientas/servidor/compartir-foundry.command`.
   - **Windows:** doble clic en `herramientas/servidor/Compartir Foundry (Windows).bat`.
   - **Linux:** `bash herramientas/servidor/compartir-foundry.command`.
3. Pulsa Intro para el puerto 30000, o escribe el tuyo.
4. Copia la dirección del recuadro y pásala por Discord. **Tú también entras por ella.**
5. **Deja esa ventana abierta** toda la partida. Para cerrar el túnel: `Ctrl+C` o cierra la ventana.

La dirección **cambia cada vez**. La primera vez descarga el programa del túnel (unos 40 MB).

---

## 6. Antes de cada partida

**Máster:**
- [ ] Foundry arrancado y mundo lanzado.
- [ ] Túnel abierto y dirección enviada (si jugáis a distancia).
- [ ] Entras tú también por esa dirección, o por `localhost`, **en Chrome o Edge**.
- [ ] Espacio libre: unos 2,5 GB.

**Jugadores:**
- [ ] Chrome o Edge, y la dirección que ha pasado el máster.
- [ ] Cascos puestos.
- [ ] Ordenador enchufado y sin suspensión automática: **si el ordenador se suspende, la grabación se para**.
- [ ] Nada de modo incógnito.

---

## 7. Durante la partida

### El indicador

Arriba, en el centro de Foundry. Siempre visible; al hacer clic se abre el panel.

| Muestra | Significa |
|---|---|
| `MR · Chronicle · preparada` | Hay sesión; falta aceptar o que el máster inicie. |
| `● Grabando · 0:01:23` (rojo) | **Te está grabando.** El reloj (horas:minutos:segundos) avanza cada segundo. |
| `❚❚ En pausa · 0:01:23` | En pausa: se graba silencio. |
| `… haz clic en la mesa para seguir grabando` | Has recargado; la grabación sigue al primer clic. |
| `… sesión en marcha (no te grabas)` | Se está grabando, pero tú no has aceptado. |
| `MR · Chronicle · entregar` | Ha terminado: toca entregar. |

### Paso a paso

**1. El máster prepara la sesión.** Abre el panel y escribe un nombre (por ejemplo, *Curse of Strahd 26*). En **Pistas de Foundry que se grabarán**, marca solo lo que quieras: **Música**, **Ambiente**, **Efectos**. Lo que no marques no se graba, no se entrega y no se procesa. Se recuerda tu elección para la próxima vez, y se puede cambiar hasta que inicies. Pulsa **Preparar sesión**.

**2. Cada uno acepta, el máster también.** A todos se les abre el panel:
1. Elige tu micro en **Micrófono** y habla: la barra verde debe moverse y debajo debe poner **«Micro encendido · captando sonido»**.
2. Marca **Acepto que se grabe mi voz en esta sesión**.
3. Si quieres, marca **Acepto que se publique en el podcast**. Son dos cosas distintas.
4. Pulsa **Guardar**. Se hace una prueba de escritura; si sale un aviso rojo, léelo (ver [sección 11](#11-si-algo-falla)).

**Los jugadores no tienen que pulsar nada más:** es el máster quien inicia la grabación, aunque luego cada uno grabe en su ordenador.

**3. El máster inicia.** Pulsa **● Iniciar grabación**:
- Está desactivado hasta que alguien acepte. La nota de debajo dice cuántos han aceptado.
- Si falta alguien, te dice a quién **no** se grabará y pide confirmación. Si alguien acepta más tarde, empieza a grabar en ese momento.
- **Si tú, como máster, no aceptas, no se graba tu voz ni las pistas de Foundry.**
- En **todas las pantallas** aparece una **cuenta atrás de 5 segundos** («La grabación empieza en 5… 4…») y todos empiezan a grabar a la vez.

**4. Palmada de sincronía.** Nada más empezar, todos a la vez, contando «3, 2, 1» en voz alta, dan una palmada cerca del micro. Repetidlo justo antes de finalizar. Sirve para comprobar la alineación en el editor.

**5. Jugad.** Junto a la grabación, el panel indica el estado del micro:

| Pone | Significa |
|---|---|
| ● Micro encendido · captando sonido (verde) | Todo bien. |
| ● Micro encendido · no capta nada ahora mismo (ámbar) | Está en silencio o silenciado: si hablas y no cambia, revisa el micro. |
| ● Micro apagado o desconectado (rojo) | Se sigue grabando en silencio. **Vuelve a conectarlo: se engancha solo**, sin recargar ni cortar la grabación. |

Botones del panel:

| Botón | Para qué |
|---|---|
| **★ Marcar momento** (o `Ctrl+Shift+M`) | Deja una marca para la edición. Puedes escribir antes un texto en *Marcador*. |
| **✂ Cortar esto** | Avisa de que ese momento no debe publicarse. Sale en el informe. |
| **❚❚ Pausar mi micro** | Graba silencio hasta que pulses **▶ Reanudar mi micro**. |
| **Retirar mi consentimiento…** | Deja de grabarte en ese momento. |
| **❚❚ Pausar a todos** (máster) | Pausa todas las grabaciones. |

En el panel, bajo el reloj, **«N MB guardados en este ordenador»** tiene que ir creciendo (unos 5,8 MB por minuto de voz): es la prueba de que la grabación se está escribiendo de verdad.

La lista **En la mesa** muestra el estado de cada uno, con su tiempo y sus MB. El verde es que todo va bien; el rojo lleva la explicación del problema.

**6. El máster finaliza.** Pulsa **■ Finalizar** y confirma. Se para la grabación de todos.

---

## 8. Al acabar: entregar las grabaciones

En el panel, sección **Entregar tu grabación**. Hay dos formas.

### Entregar (al servidor de Foundry)

- Pulsa **Entregar**. Sube la grabación trozo a trozo, y el máster tiene que estar conectado.
- Si se corta, vuelve a pulsar: solo sube lo que falte.
- Queda en `Data/mr-chronicle/<sesión>/<usuario>/` del servidor.
- Tiempo: 1,4 GB con 10 Mbps de subida son unos 20 minutos.

### Descargar (a una carpeta compartida: Drive, MEGA o Dropbox)

1. Crea una carpeta compartida del grupo y que cada uno la tenga sincronizada en su ordenador (Google Drive para escritorio, MEGAsync o Dropbox).
2. Pulsa **Descargar** y elige esa carpeta. Se crea `<sesión>/<tu nombre>/` y se sube sola.
3. Si no tienes el programa de sincronización, descarga en cualquier carpeta y arrástrala a la web de Drive o MEGA, dentro de la carpeta de la sesión.

En Mac, puede que Chrome no deje elegir la carpeta de Google Drive, que vive en `~/Library/CloudStorage`. En ese caso, descarga en Descargas y arrástrala a la web.

### Después

Cuando la sesión esté procesada, cada uno pulsa **Borrar la grabación de este navegador** para liberar espacio. **Hasta entregar, no borres los datos del navegador.**

---

## 9. Procesar la sesión

Lo puede hacer cualquiera del grupo. Todo lo necesario está en el **zip de herramientas** (`MR-Chronicle-herramientas.zip`, también en las *releases* de GitHub). Descomprímelo donde quieras.

### 9.1. Instalar (solo la primera vez)

| Sistema | Qué hacer |
|---|---|
| **Windows** | Doble clic en `instalar/Instalar en Windows.bat`. Si sale «Windows protegió su PC»: **Más información → Ejecutar de todas formas**. |
| **Mac** | Doble clic en `instalar/instalar-mac.command`. Necesita [Homebrew](https://brew.sh); si no lo tienes, te dice cómo ponerlo. Si macOS no deja abrirlo: **clic derecho → Abrir → Abrir**. |
| **Linux** | `bash instalar/instalar-linux.sh` (Ubuntu 22.04+, Debian 12+, Oracle Linux 9+). |

- **Qué instala:** ffmpeg, whisper.cpp, DeepFilterNet, Node si falta, y el modelo de Whisper (1,6 GB). Todo en la carpeta `.cache/mr-chronicle` de tu usuario; no toca el resto del sistema ni pide permisos de administrador (salvo Homebrew en Mac).
- **Si se corta la descarga,** vuelve a abrirlo: sigue donde iba.
- **Al final** muestra ✔ o ✖ en cada pieza.

### 9.2. Configurar la campaña (opcional, recomendado)

Copia `post/campana.ejemplo.json` como **`campana.json`** en la carpeta de la sesión, o en la de encima (la carpeta compartida, y así sirve para todas las sesiones). Se usa sola.

```json
{
  "diccionario": ["Strahd von Zarovich", "Barovia", "Ireena", "Vallaki"],
  "correcciones": { "Strath": "Strahd", "Irena": "Ireena" },
  "ajustesMs": { "Ana": 0, "Gamemaster": 0 },
  "formato": "flac",
  "reduccionRuidoDb": 30,
  "umbralSilencioDb": -40
}
```

| Campo | Para qué |
|---|---|
| `diccionario` | Nombres propios de la campaña: Whisper los escribirá mejor. |
| `correcciones` | Los que aun así escribe mal. Solo cambia palabras completas. |
| `ajustesMs` | Desfase fijo de alguien, en milisegundos (ver [sección 10](#10-editar-el-podcast-y-la-crónica)). |
| `formato` | Formato de las pistas: `flac` (por defecto), `opus` o `wav`. |
| `reduccionRuidoDb` | Cuánto ruido quita: 30 deja la voz natural; 100 lo quita todo. |
| `umbralSilencioDb` | Nivel por debajo del cual se considera silencio al ajustar los tiempos del texto. |

### 9.3. Procesar

| Sistema | Qué hacer |
|---|---|
| **Windows** | Doble clic en `instalar/Procesar sesion (Windows).bat`, o arrastra la carpeta de la sesión encima de ese archivo. |
| **Mac** | Doble clic en `instalar/procesar.command`. |
| **Linux** | `bash instalar/procesar.command` |

Cuando lo pida, **arrastra a la ventana la carpeta de la sesión** (la que tiene una subcarpeta por participante) y pulsa Intro.

**En Terminal, con opciones:**

```bash
node herramientas/post/mr-chronicle-post.mjs <carpeta-sesión> --salida <otra-carpeta>
```

| Opción | Qué hace |
|---|---|
| `--salida <dir>` | Guarda el resultado en otra carpeta; útil si la compartida se queda sin espacio. |
| `--config <json>` | Usa otro archivo de configuración. |
| `--sin-ruido` | No limpia el ruido. |
| `--sin-whisper` | No transcribe. |
| `--formato flac\|opus\|wav` | Formato de las pistas (por defecto, `flac`). |
| `--con-bruta` | Guarda también la voz sin limpiar, alineada. |
| `--comprobar` | Solo dice qué falta por instalar. |

### 9.4. Qué hace, por orden

1. **Lee** las entregas y avisa si falta algo.
2. **Calcula la deriva:** la tarjeta de sonido de cada uno va a una velocidad ligeramente distinta.
3. **Alinea** todas las pistas al mismo 0:00, a unos milisegundos.
4. **Limpia el ruido** de las voces (DeepFilterNet).
5. **Transcribe** cada voz (Whisper), descarta las frases que Whisper se inventa en los silencios y marca los ecos.
6. **Exporta** el resultado.

### 9.5. Resultado, en `<sesión>/salida/`

| Archivo | Qué es |
|---|---|
| **`informe.md`** | **Léelo primero:** quién **no** quiere que se publique su voz, qué hay que cortar, qué música revisar por licencias y si alguna pista tiene problemas. |
| `stems/voz-<nombre>.flac` | Voz limpia de cada uno. |
| `stems/foundry-musica.flac`, `foundry-ambiente.flac`, `foundry-efectos.flac` | Lo que sonó en Foundry. Llega unos 0,1 s tarde respecto a las voces. |
| `stems/voz-<nombre>.bruta.flac` | Solo con `--con-bruta`: la voz sin limpiar, alineada. El original sin alinear siempre queda en la carpeta de cada participante. |

**Formato de las pistas:** por defecto **FLAC**, que es sin pérdida (idéntico a WAV) y unas 3 veces más pequeño. Para cambiarlo, usa `--formato` o `"formato"` en `campana.json`:
- `opus`: lo más pequeño, con una pérdida que en un podcast no se nota.
- `wav`: sin comprimir, para un editor que no abra FLAC.
| `transcript.md` | Transcripción legible, con hora, jugador y personaje. |
| `transcript.srt` | Subtítulos. |
| `transcript.json` | Transcripción completa con datos, incluidas las frases descartadas. |
| `marcadores.txt` | Marcadores para Audacity. |
| `musica.json` | Qué sonó y cuándo. |

---

## 10. Editar el podcast y la crónica

**Montaje:**
1. Arrastra todos los archivos de `stems/` a **Reaper** o **Audacity**. Todos empiezan en 0:00 y duran lo mismo: ya están alineados.
2. En Audacity: **Archivo → Importar → Etiquetas** → `marcadores.txt`. Verás los ★ y los ✂.
3. Busca las **palmadas** del principio y del final: deben coincidir en todas las pistas.
4. **No uses la pista de quien no aceptó publicar.** El informe lo dice.

**Si alguien sale siempre desplazado:**
1. Mide cuántos milisegundos va por delante o por detrás.
2. Ponlo en `ajustesMs` de `campana.json`, con signo: un número positivo retrasa su pista.
3. Vuelve a procesar.

**Crónica:** abre `cronica.md` (en el zip, o `prompts/cronica.md` en el repositorio), pégalo en tu asistente y, debajo, el contenido de `transcript.md`. Obtendrás resumen, crónica, escenas, PNJ, lugares, pistas, objetos, cabos sueltos y momentos para el podcast.

---

## 11. Si algo falla

### Avisos del panel

| Aviso | Qué hacer |
|---|---|
| **Foundry está abierto sin HTTPS…** | Ver [sección 5](#5-https-imprescindible-para-grabar). En el ordenador de Foundry, usa el enlace a `localhost` del aviso. |
| **Estás en la app de escritorio de Foundry…** | Abre la partida en Chrome o Edge, con la misma dirección. |
| **Este navegador no puede grabar…** | Usa Chrome o Edge actualizados. |
| **Este navegador no consigue guardar la grabación…** | Al aceptar ha fallado la prueba de guardado. Actualiza Chrome, comprueba el espacio libre y que no estés en incógnito. |
| **Micro apagado o desconectado** (bajo la grabación) | Vuelve a conectarlo: se engancha solo y la grabación sigue. |
| **Micro encendido · no capta nada ahora mismo** | Si hablas y no cambia: micro silenciado o mal elegido. |
| **La pista de … no se está guardando en el disco** | Probablemente, disco lleno. Libera espacio y avisa al máster. |
| **El navegador está procesando tu micro…** | Tu sistema aplica filtros al micro (en Mac, desactiva «Aislamiento de voz» en el Centro de control). |
| **Tu rol no puede subir archivos** | El máster tiene que activar el permiso (ver [sección 4](#4-configuración-del-máster-una-sola-vez)), o usa **Descargar**. |
| **En este navegador no hay ninguna grabación de esta sesión** | Grabaste en otro navegador u ordenador: entrega desde allí. |
| **El máster tiene que estar conectado…** / **no ha respondido** | La entrega al servidor necesita al máster. Espera o usa **Descargar**. |

### Situaciones

| Qué pasa | Qué ocurre y qué hacer |
|---|---|
| **Se recarga o se cierra el navegador** | Lo grabado está a salvo. Al volver, haz clic en la mesa y sigue grabando. |
| **Se cae Internet o el servidor** | Se sigue grabando en tu ordenador; la sincronía se recupera sola. |
| **Se reinicia el servidor de Foundry** | La postproducción lo detecta y recoloca las pistas (lo verás en el informe). |
| **El ordenador se suspende** | Se para la grabación hasta que vuelva. Evítalo. |
| **Frases repetidas en la transcripción** | Alguien sin cascos: su micro recogió a otro. Salen marcadas como posible eco y fuera del `transcript.md`. |
| **Nombres propios mal escritos** | Añádelos a `diccionario` y, si hace falta, a `correcciones`. |
| **El procesado dice que falta un programa** | Vuelve a ejecutar el instalador, o `--comprobar` para ver qué falta. |

**Para pedir ayuda,** manda:
- una captura del panel;
- la consola del navegador (F12 → pestaña *Console*);
- el `informe.md`.

Las incidencias se abren en https://github.com/ManuRomera/mr-chronicle/issues.

---

## 12. Espacio y tiempos

| Qué | 4 horas de partida |
|---|---|
| Voz de un jugador (sin comprimir) | ~1,4 GB |
| Máster: su voz más la música y los efectos de Foundry (Opus) | ~1,7–2,5 GB |
| Sesión completa con 4 jugadores y máster (entregas) | ~8 GB |
| Resultado procesado (`salida/`) en FLAC | ~3–4 GB (en Opus, ~1 GB) |
| Subir una voz a 10 Mbps | ~20 min |
| Procesar una voz en un Mac con chip Apple o en un PC con tarjeta NVIDIA | ~15 min |
| Procesar una voz en un PC sin tarjeta gráfica | Puede ser más de una hora |

Si Foundry está en un servidor con poco disco, bájate las sesiones y bórralas del servidor:

```bash
rsync -av usuario@servidor:/ruta/a/Data/mr-chronicle/ ~/Podcast/mr-chronicle/
```

---

## 13. Para el desarrollo

| Qué | Cómo |
|---|---|
| Pruebas | `npm test` en la carpeta del repositorio |
| Generar el zip de herramientas | `npm run herramientas` → `dist/MR-Chronicle-herramientas.zip` |
| Publicar una versión | Sube la versión en `module.json` y en `package.json`, añade la entrada en `CHANGELOG.md`, haz commit y `git tag vX.Y.Z && git push origin vX.Y.Z`. GitHub pasa las pruebas y publica el módulo y el zip. |
| Notas para Claude | `CLAUDE.md` en la raíz del repositorio |

**Si Foundry sobrescribe la carpeta de desarrollo** (al actualizar desde el manifiesto), el código de la versión publicada sigue ahí, pero se pierde `.git` y todo lo que no va en el zip. Para recuperarlo:

```bash
cd /Volumes/Datos_Dock/FoundryVTT/Data/modules/mr-chronicle
git clone --no-checkout https://github.com/ManuRomera/mr-chronicle.git /tmp/mrc
mv /tmp/mrc/.git . && git reset
git status   # lo marcado con D falta: recupéralo con git checkout -- <ruta>
```
