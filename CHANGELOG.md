# Cambios

## 0.3.1 · Marca MR

- Añadido el botón «Créditos» en los ajustes del paquete (Manu Romera · Digital RPG Design). No cambia el juego.

## 0.3.0 · Auditoría del 03-10-2026

Corrige los puntos de `docs/AUDITORIA.md`. **Sigue en desarrollo (WIP)**, pendiente de una partida real larga.

**Grabación**
- Si el disco no da abasto, se avisa en pantalla antes de que la pestaña se quede sin memoria.
- Dos pestañas del mismo usuario: el máster ve el estado de la que graba, no el de la que está callada.
- Cerrar o recargar la pestaña mientras se graba pide confirmación.
- El máster ve que las pistas de Foundry esperan un clic en la mesa (en su panel y en la lista de participantes).
- Las casillas de consentimiento y el micro se guardan al cambiarlos (ya no hay botón «Guardar»).
- «Dejar de grabar» pide confirmación.
- Panel: el micro sin nombres explica cómo verlos; la biblioteca muestra el consentimiento y «cierre sin confirmar» y se guarda 15 s en lugar de recorrerse en cada repintado; sección «Procesar la sesión» con la ruta de las herramientas y su descarga.
- Accesibilidad: roles `meter`/`progressbar`/`status`/`alert`, foco visible, sin animación con «reducir movimiento» y mejor contraste.
- La copia .zip no recalcula el CRC que ya calculó el inventario.
- Se anotan en el manifiesto los avisos de cada pista (`diagnostico`).

**Postproducción**
- Un trozo que falta en una pista de música, ambiente o efectos se rellena con silencio en su sitio (antes solo se avisaba y la pista quedaba desplazada).
- Ctrl‑C o cierre de la terminal ya no dejan temporales; los de ejecuciones muertas se limpian al empezar.
- Se comprueba el espacio libre antes de empezar (`--temporal` para usar otro disco); el original de cada voz se borra en cuanto existe la versión limpia.
- DeepFilterNet limpia varias voces a la vez.
- `--normalizar`: iguala el volumen de las voces.
- Aviso si hay pocas anclas para la duración de la pista; se valida la cabecera OpusHead.

**Instaladores y publicación**
- Las descargas con versión fija (DeepFilterNet, Whisper, modelo, cloudflared) se comprueban con su huella SHA-256.
- La publicación falla si el CHANGELOG no tiene la versión.

## 0.2.0 · Robustez

Corrige los fallos de la auditoría del 30-09-2026. **Sigue en desarrollo (WIP)**, pendiente de una partida real larga.

**Nunca perder ni sobrescribir**
- **Guardar copia (.zip)**: un único archivo por participante (con ZIP64 si pasa de 4 GB), con inventario de tamaños y CRC. Se sube a la carpeta compartida y la postproducción lo lee tal cual.
- **Grabaciones en este navegador**: la lista sigue ahí aunque se cierre la sesión.
- El número de tramo sale también de los archivos que existen, y el escritor nunca escribe encima de un archivo con datos.
- Identificador de sesión con sufijo único, y una sola pestaña grabando por persona.
- Escrituras completas hasta el último byte.
- Nombres únicos: dos «Ana» no se pisan, y solo el máster que prepara la sesión graba las pistas de Foundry.

**Parar y retirar de verdad**
- Parar corta la captura al momento; la hora del servidor se mide después y no bloquea.
- Retirar el consentimiento cierra el micro aunque no haya llegado a grabar.
- Un inicio pendiente no se queda grabando si mientras tanto se detiene o cambia la sesión.
- El cierre se confirma, y si no se puede, se avisa («cierre sin confirmar»).
- «Pausar mi micro» ya no pausa la música del máster.

**Entrega verificada**
- Cada archivo se da por entregado al servidor solo si allí tiene el mismo tamaño; reintentos con pausa creciente.
- El estado de entrega va aparte, en `entregas.json`, que no viaja: el manifiesto no cambia después de entregarlo.

**Coste durante la partida**
- El panel ya no acumula escuchadores.
- Los refrescos parciales no consultan micros ni disco.
- Una sola medición de hora compartida por todas las pistas.
- Los estados caducan: «Sin comunicación».

**Postproducción**
- Un trozo que falta se rellena con silencio y se avisa: lo siguiente no se desplaza.
- Un reinicio del servidor se corrige ancla a ancla, también dentro de un tramo, y en marcadores y música.
- Los tramos con menos de dos anclas o con una deriva imposible se procesan con la frecuencia nominal, con aviso.
- Las pistas de quien no autorizó publicar van a `stems/no-publicar/`.
- Memoria acotada al pegar el Ogg, temporal único por ejecución y ningún resto de procesados anteriores.
- Un programa que se lanza pero falla ya no cuenta como instalado.

**Pruebas:** 23 (antes 7), incluidas las reproducciones de la auditoría escritas como comportamiento correcto.

## 0.1.5

- **El máster elige qué pistas de Foundry se graban** (música, ambiente, efectos, cada una por separado). Lo que no marque no se graba, no se entrega y no se procesa. Se recuerda para la próxima sesión.
- **Cuenta atrás de 5 segundos en todas las pantallas** al iniciar, sincronizada con el servidor: todos empiezan a la vez. Los jugadores solo marcan los consentimientos y pulsan **Guardar**.
- **Sin alertas del micro.** Junto a la grabación, una línea dice si el micro está encendido y si capta sonido.
- **El micro se reconecta solo:** si se desconecta, la grabación sigue en silencio y, al volver a conectarlo, se engancha al mismo archivo, sin recargar ni cortar.
- Corregido: tras reiniciar el servidor podía aparecer una cuenta atrás absurda de una sesión antigua.

## 0.1.4

- **Pistas procesadas en FLAC por defecto** (sin pérdida, unas 3 veces menos que WAV). Opción `--formato opus` (o `"formato": "opus"`) para lo mínimo, y `wav` si hace falta. Una sesión de 4 horas con 5 personas pasa de ~22 GB en `stems/` a ~3–4 GB (o ~1 GB en Opus).
- **Ya no se guarda por defecto la voz sin limpiar** en `stems/` (el original sigue en la entrega). Con `--con-bruta` se guarda también, alineada.

## 0.1.3

- **Reloj de grabación con segundos** (h:mm:ss) en el indicador, el panel y la mesa. Antes solo contaba minutos enteros y parecía parado.
- **MB guardados en este ordenador**, en el panel y en la mesa: la prueba de que se está escribiendo de verdad.
- **La voz empieza a grabarse siempre al momento.** Las pistas de Foundry se suman cuando su audio se desbloquea (primer clic en la página), sin retrasar la voz.
- **Corregida una grabación duplicada:** al recargar durante una sesión, si la sesión cambiaba antes del primer clic, se arrancaba un segundo tramo y el primero seguía grabando sin control.

## 0.1.2

- **Compartir Foundry con HTTPS, gratis:** scripts de doble clic (Mac, Windows y Linux) que abren un túnel de Cloudflare y dan una dirección `https://…trycloudflare.com`. Resuelve el caso del máster con Foundry en casa: sin HTTPS, los jugadores no pueden grabar. Probado de extremo a extremo: grabación y entrega de una jugadora por el túnel, sincronía de 13 ms o menos con el máster en local.
- **Aviso del panel sin HTTPS más útil:** enlace directo a `localhost` si Foundry está en ese ordenador, y explicación del túnel.

## 0.1.1

Correcciones tras la primera prueba real. **Sigue en desarrollo (WIP).**

- **Diagnóstico claro** en lugar de «este navegador no puede grabar»:
  - Foundry abierto sin HTTPS (el navegador bloquea el micro y el almacenamiento), con la solución.
  - Grabación bloqueada en la app de escritorio de Foundry, que no guardaba nada.
- **No se puede iniciar la grabación sin consentimientos.** Si falta alguien, el máster ve a quién no se grabará y tiene que confirmar. El recuento se actualiza en cuanto alguien acepta.
- **Prueba de guardado al aceptar:** si el navegador no consigue escribir la grabación, no deja aceptar y lo explica.
- **Vigilancia durante la partida:** alerta en pantalla y en la mesa si una pista deja de guardarse. Los errores de disco ya no se quedan en la consola.
- **Una entrega sin grabación es un error,** no «Entregado».
- **Barra de nivel del micro fluida** (20 veces por segundo en vez de una).

## 0.1.0

Primera versión pública. **En desarrollo (WIP):** probada de principio a fin en local, pendiente de una partida real larga con varios jugadores.

- Grabación del micro de cada participante en su navegador (AudioWorklet + OPFS), en bruto y a 48 kHz, en trozos WAV de 60 s.
- Grabación de la música, el ambiente y los efectos de Foundry en el cliente del máster, comprimida en Ogg Opus a 160 kbps con WebCodecs (unas 10 veces menos que WAV; los silencios casi no ocupan), más un registro de lo que suena.
- Entrega también a una carpeta compartida (Google Drive, MEGA, Dropbox): «Descargar» guarda en `<sesión>/<nombre>/` y las grabaciones de todos se juntan solas.
- Instaladores de doble clic para procesar en Windows, Mac y Linux (sin permisos de administrador; todo en `~/.cache/mr-chronicle`) y paquete `npm run herramientas` para repartirlos al grupo. La herramienta carga sola el `campana.json` de la carpeta de la sesión y tiene `--comprobar`.
- Aviso si el micro se desconecta o deja de llegar sonido durante 30 s.
- Sesión coordinada por el máster: preparar, consentimientos (grabar y publicar por separado), iniciar, pausar, finalizar.
- Marcadores de momento y de «cortar esto», pausa del micro propio, indicador de grabación siempre visible.
- La grabación se retoma tras recargar el navegador.
- Entrega trozo a trozo al servidor de Foundry, reanudable, o descarga local.
- Tiempos de la transcripción recortados a la voz real con `silencedetect` (a unos ms del inicio real). Los segmentos sin voz debajo se descartan como inventados. Correcciones de nombres propios en `campana.json`.
- Herramienta de postproducción: corrección de deriva, alineación a 0:00 (también tras un reinicio del servidor), limpieza con DeepFilterNet, transcripción con whisper.cpp, filtro de frases inventadas y de ecos, transcripción en MD/JSON/SRT, marcadores para Audacity e informe.
