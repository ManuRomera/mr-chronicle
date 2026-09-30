# MR · Chronicle

> [!WARNING]
> **En desarrollo (WIP).** Funciona de principio a fin en pruebas locales, pero todavía no se ha probado en una partida real larga con varios jugadores. Úsalo para hacer pruebas, no para una sesión que no puedas repetir. Si encuentras un fallo, abre una [issue](https://github.com/ManuRomera/mr-chronicle/issues).

Graba tus partidas de Foundry VTT como **podcast multipista**, sin instalar nada para jugar y sin coste.

- Cada participante graba **su propio micro, en su navegador**, en bruto y a 48 kHz.
- El máster graba además la **música, el ambiente y los efectos** de Foundry, cada uno en su pista.
- Al acabar, cada uno **guarda una copia .zip** de su grabación (y la sube a la carpeta compartida del grupo: Drive, MEGA…) o la **entrega** al servidor de Foundry.
- Una herramienta de **postproducción** corrige la deriva de reloj de cada tarjeta de sonido, alinea todas las pistas al mismo 0:00, limpia el ruido (DeepFilterNet) y transcribe con Whisper sabiendo quién dijo cada cosa.

📖 **[Manual de instrucciones](docs/MANUAL.md)**, paso a paso. El diseño completo, con las decisiones y sus porqués, está en [docs/MR_Chronicle.md](docs/MR_Chronicle.md).

## Antes de nada: HTTPS y navegador

El navegador **solo permite el micro y guardar la grabación en páginas seguras**: las que van por `https://` o por `localhost`. Si en la barra de direcciones pone «No es seguro» (por ejemplo, `http://192.168.1.20:30000` o `http://tu-ip:30000`), no se puede grabar, y el panel lo avisa y dice qué hacer. Es una regla de los navegadores; ningún módulo puede saltársela.

**Navegador:** Chrome o Edge. **No uses la app de escritorio de Foundry para grabar:** no guarda la grabación y el panel lo bloquea.

### Foundry en casa: HTTPS gratis con un túnel

Si el máster tiene Foundry en su ordenador y los demás se conectan desde sus casas, lo más sencillo es un **túnel de Cloudflare**. Es gratis, no necesita dominio ni abrir puertos del router, y los jugadores no instalan nada:

1. Arranca Foundry y lanza el mundo.
2. Abre **Compartir Foundry**, que está en `herramientas/servidor/` (y en el zip de herramientas):
   - **Mac:** doble clic en `compartir-foundry.command`.
   - **Windows:** doble clic en `Compartir Foundry (Windows).bat`.
   - **Linux:** `bash compartir-foundry.command`.
3. Te pregunta el puerto (30000 por defecto) y muestra una dirección `https://algo.trycloudflare.com`. **Pásasela a los jugadores y úsala tú también.** Deja la ventana abierta durante la partida.

Ten en cuenta:
- La dirección cambia cada vez que abres el túnel.
- Cualquiera con la dirección llega a tu Foundry: **pon contraseña a los usuarios**, sobre todo al máster.
- También funciona en un servidor Linux, como la capa gratuita de Oracle: es más sencillo que montar un dominio con Caddy.

**Otras opciones:**
- **En el ordenador que tiene Foundry:** abrir `http://localhost:30000` ya cuenta como seguro.
- **Dominio propio:** con uno gratuito (DuckDNS, por ejemplo) y [Caddy](https://caddyserver.com) delante de Foundry, que saca el certificado solo.
- **Solo para una prueba rápida en tu red:** en Chrome, `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, añade la dirección de Foundry y reinicia Chrome.

## Instalación

Solo se instala en el **servidor de Foundry** (el ordenador o el servicio donde corre). Los jugadores no instalan nada.

En Foundry: **Configuración → Módulos → Instalar módulo**, y en *URL del manifiesto* pega:

```
https://github.com/ManuRomera/mr-chronicle/releases/latest/download/module.json
```

Después activa **MR · Chronicle** en el mundo (Gestionar módulos). Compatible con Foundry V13 (V14 sin probar todavía).

## Para jugar

**Requisitos:**
- **Chrome o Edge**, con Foundry abierto por `https://` o `localhost` (ver arriba). Ni la app de escritorio de Foundry, ni Firefox, ni Safari.
- **Cascos:** con altavoces, tu micro recogería a los demás.
- Espacio libre para 4 horas de partida: **1,5 GB** los jugadores, **unos 2,5 GB** el máster (su voz más la música y los efectos de Foundry, estos comprimidos en Opus).
- **No suspendas el ordenador** (ni cierres la tapa del portátil) durante la partida: la grabación se para hasta que vuelvas. **No uses el modo incógnito** ni borres los datos del navegador antes de entregar.

**Pasos:**
1. El máster abre el panel con el indicador **MR · Chronicle** (arriba, en el centro), marca qué **pistas de Foundry** quiere grabar (música, ambiente, efectos; lo que no marque no se graba ni se procesa) y pulsa **Preparar sesión**.
2. A cada participante se le abre el panel: elige micro, comprueba que pone «Micro encendido · captando sonido», marca si acepta grabar (y, aparte, publicar) y pulsa **Guardar**. Nadie más tiene que pulsar nada: es el máster quien inicia. Al guardar se hace una prueba de escritura; si el navegador no puede guardar, lo dice.
3. El máster pulsa **Iniciar grabación**. En todas las pantallas sale una **cuenta atrás de 5 segundos** y todos empiezan a grabar a la vez. No se puede iniciar si nadie ha aceptado, y si falta alguien avisa de a quién no se grabará. Si el propio máster no acepta, no se graba su voz ni las pistas de Foundry.
4. Durante la partida:
   - **★ Marcar momento** (o `Ctrl+Shift+M`) deja una marca para la edición.
   - **✂ Cortar esto** avisa de algo que no debe publicarse.
   - **Pausar mi micro** graba silencio en tu voz mientras dure (la música de Foundry sigue; para todo, **Pausar a todos**).
5. El máster pulsa **Finalizar**. Cada uno, **nada más acabar**:
   - **Guardar copia (.zip):** un único archivo con su grabación, que sube a la carpeta compartida del grupo. Quien procesa los usa tal cual. Imprescindible con el túnel, cuya dirección cambia: el navegador solo enseña la grabación desde la dirección en la que se hizo.
   - **Entregar al servidor** (opcional): la sube a Foundry trozo a trozo, comprobando el tamaño de cada archivo. Si se corta, se vuelve a pulsar y solo sube lo que falte.

El panel guarda la lista de **Grabaciones en este navegador**: aunque se cierre la sesión, se puede guardar la copia de cualquiera más tarde (desde la misma dirección de Foundry). Solo puede grabar una pestaña a la vez por persona.

Si alguien recarga o cierra el navegador a mitad, lo ya grabado está a salvo. Al volver a entrar, la grabación sigue en cuanto hace clic en la mesa. Junto a la grabación, el panel indica si el micro está encendido y si capta sonido. Si se desconecta, la grabación sigue (en silencio) y el micro se engancha solo al volver a conectarlo. Si la grabación deja de guardarse en el disco, sale una alerta roja, y el máster lo ve en la lista de la mesa.

### Configuración del máster (una sola vez)

- **Configurar permisos → Subir archivos** (y **Explorar archivos**): actívalo para el rol **Jugador**. Sin eso, los jugadores usarán **Guardar copia (.zip)**.
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
| `formato` | `flac` (por defecto), `opus` o `wav`: ver abajo. |
| `reduccionRuidoDb` | Cuánto ruido quita DeepFilterNet (30 dB deja la voz natural; 100 lo quita todo). |
| `umbralSilencioDb` | Por debajo de este nivel se considera silencio al ajustar los tiempos de la transcripción. |

No actives `vad`: el detector de voz de whisper.cpp junta toda la voz de una persona en segmentos enormes. La herramienta ya detecta la voz por su cuenta sobre la pista limpia.

**Resultado en `salida/`:**

| Archivo | Qué es |
|---|---|
| `stems/voz-<nombre>.flac` | Voz limpia. Todas las pistas empiezan en 0:00 y duran lo mismo. |
| `stems/foundry-musica.flac`, `foundry-ambiente.flac`, `foundry-efectos.flac` | Lo que sonó en Foundry (grabado en Opus a 160 kbps; llega unos 0,1 s tarde respecto a las voces, sin importancia para música de fondo). |
| `stems/voz-<nombre>.bruta.flac` | Solo con `--con-bruta`: la voz sin limpiar, alineada. El original sin alinear siempre está en la carpeta de cada participante. |

**Formato de las pistas** (`--formato` o `"formato"` en `campana.json`):

| Formato | Qué es | 4 h de voz |
|---|---|---|
| `flac` (por defecto) | Sin pérdida: idéntico al WAV y unas 3 veces más pequeño. Lo abren Reaper, Audacity y la mayoría de editores. | ~0,5 GB |
| `opus` | Lo más pequeño, con una pérdida que en un podcast no se nota. | ~0,15 GB |
| `wav` | Sin comprimir, para editores que no abran FLAC. | ~1,4 GB |
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
