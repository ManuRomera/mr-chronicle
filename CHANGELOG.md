# Cambios

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
