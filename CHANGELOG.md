# Cambios

## 0.1.0

Primera versión.

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
