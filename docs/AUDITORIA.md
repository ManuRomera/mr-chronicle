# Auditoría de MR · Chronicle v0.2.0

Fecha: 03-10-2026. Alcance: módulo (`module/`, `workers/`, `templates/`, `styles/`), postproducción (`herramientas/post`), instaladores y túnel, CI y documentación (~4.200 líneas; instaladores y workflow `comprobar` revisados por encima).
Comprobado: `npm test` 23/23, `node --check` limpio en todos los `.mjs`/`.js`.
No medido (requiere partida real o equipo concreto): memoria y tirones en 4 h de grabación, coste de `biblioteca()` con muchos archivos, instaladores en Windows/Linux, V14.

Leyenda: **P1** puede perder o corromper una grabación o bloquear una sesión · **P2** degrada la experiencia o la fiabilidad · **P3** mejora.

## Veredicto

La arquitectura es sólida y los caminos críticos de datos (OPFS por trozos, anclas, alineación por muestras, entrega verificada) están bien resueltos y probados. No he encontrado un fallo que corrompa audio en el camino normal. Lo que queda son **riesgos de borde no probados con personas** y **huecos de usabilidad**. Mientras no haya una partida real de 3–4 h con el grupo, mantener WIP.

## P1 — Pérdida de datos o bloqueo

| # | Hallazgo | Dónde | Arreglo propuesto |
|---|---|---|---|
| 1 | **Cola del escritor sin límite**: si el disco (OPFS) va más lento que la captura, o `AudioEncoder` (Opus) se atasca, los bloques se acumulan en RAM del Worker hasta que la pestaña muere y se pierde lo no volcado. Sin control de `encodeQueueSize`. | `workers/escritor-worker.js` (`encolar`, Opus) | Contar bytes en cola; si pasa de un tope (p. ej. 64 MB) avisar a la interfaz y descartar antes la pista Foundry que la voz. Vigilar `encodeQueueSize`. |
| 2 | **Hueco en pistas Ogg (Foundry) solo se avisa**: a partir del hueco la pista queda desplazada. | `mr-chronicle-post.mjs` ~237 | Decodificar por trozos y colocar cada uno por su gránulo, o rellenar con silencio por duración de trozo. |
| 3 | **Temporales dentro de la carpeta de salida y limpieza solo en `exit`**: Ctrl‑C, cierre de terminal o `kill` no la disparan y quedan decenas de GB. Además el pico de disco es ~4× el audio de cada voz (raw + alineado + bruto + limpio): 6 voces × 4 h ≈ 30 GB. | `mr-chronicle-post.mjs` 93‑94, 229‑360 | Capturar `SIGINT`/`SIGTERM`; borrar `.tmp-*` antiguos al empezar; procesar voz a voz en vez de por fases; avisar del espacio necesario antes de empezar. |
| 4 | **Mismo usuario en dos pestañas/dispositivos**: el Web Lock evita doble grabación en el mismo navegador, pero ambas emiten estado y el máster ve estados contradictorios. | `sesion.mjs` (`alRecibir`, `miEstado`) | Incluir un id de pestaña en el estado y mostrar solo el de quien tiene el lock. |
| 5 | **Cierre sin confirmar**: si la pestaña muere antes de confirmar el cierre del WAV, la cabecera queda sin tamaño. La postproducción lo tolera (lee tras 44 bytes), otros reproductores no, y nada se lo dice al usuario. | `grabadora.mjs`, `escritor-worker.js` | Mostrar «cierre sin confirmar» en la biblioteca y cubrirlo con un test. |

## P2 — Fiabilidad y eficiencia

6. **`biblioteca()` se ejecuta en cada render completo** y recorre OPFS; durante la entrega el coste crece con el número de archivos (~250 por sesión larga). Cachear por sesión y recalcular solo al cambiar. (`panel.mjs`)
7. **`anadirLinea` (anclas, marcadores) lee el tamaño y reescribe con `keepExistingData`** cada 30 s: coste creciente y riesgo de línea rota (la lectura NDJSON lo tolera). Mejor un `FileSystemSyncAccessHandle` en el Worker. (`opfs.mjs`)
8. **Worklet**: el bucle JS por muestra convierte a Int16 cada bloque; suficiente para una pista, medir antes de tocar. (`captura-worklet.js`)
9. **`tamanoEnServidor`** descarga los textos enteros para comprobar tamaño (por la compresión de Foundry) y lo repite en cada reintento. Guardar el tamaño ya verificado. (`entrega.mjs`)
10. **Inventario con CRC de cada archivo en memoria**: bien por archivo (≤ 60 s), pero comprobar que `zip.mjs` escribe en flujo y no acumula toda la sesión.
11. **Postproducción secuencial**: DeepFilterNet y Whisper van voz a voz. Paralelizar DeepFilterNet y limitar Whisper a 1–2 simultáneos según núcleos.
12. **`config.vad`**: el propio código dice que no sirve (junta toda la voz). Documentarlo como «no usar» o quitarlo.
13. **`ESTADO_CADUCA_MS`** (`sesion.mjs:22`) está declarada y sin usar; la caducidad se calcula en otro sitio. Unificar.
14. **Código muerto**: `sesionesLocales` (`opfs.mjs:76`) no se usa. Borrar.
15. **Consentimiento**: el participante no puede ver después qué aceptó (solo está en el manifiesto). Mostrarlo en la biblioteca.
16. **Spoofing de estados por socket**: `alRecibir` valida sesión y usuario del emisor, no hay firma. Impacto bajo (solo interfaz) en una mesa de confianza; documentarlo.

## P2 — Usabilidad

17. **Estado «esperando clic»** (`game.audio.unlock` pendiente) invisible para el máster: cree que graba y no hay pistas Foundry. Mostrarlo en su panel.
18. **Selector de micro** sin nombres hasta conceder permiso. Pedir permiso al abrir el panel o explicarlo.
19. **El jugador debe pulsar Guardar** tras marcar casillas; marcar y no guardar no hace nada. Guardar al marcar o avisar.
20. **«Retirar mi consentimiento»** es un enlace pequeño, sin confirmación e irreversible en esa sesión. Pedir confirmación.
21. **Cerrar la ventana con grabación sin copia** no avisa. Añadir `beforeunload` mientras haya grabación sin guardar.
22. **Plantilla duplicada**: el bloque de canales está dos veces en `panel.hbs` (28‑32 y 46‑50). Extraer a un parcial.
23. **Errores con jerga** («OPFS», «Web Lock», «ancla»): traducir a acciones («cierra la otra pestaña de Foundry»).

## P2 — Accesibilidad

24. Sin `aria-*`/`role` en las plantillas: el medidor (`.mrc-nivel`), el progreso (`.mrc-progreso`) y los avisos no se anuncian. Añadir `role="meter"`/`progressbar` con valores y `role="status"`/`alert`.
25. El CSS no define `:focus-visible` ni `prefers-reduced-motion` (el punto de grabación parpadea). Revisar contraste de `.mrc-nota` y del ámbar.
26. Parte del estado se apoya en el color (rojo/ámbar/verde); acompañar siempre con texto o icono.

## P2 — Postproducción

27. **`regresion`** con pocas anclas buenas da una deriva ruidosa (el tope de 1000 ppm solo cubre el extremo). Exigir ≥ 4 anclas para fiarse de la deriva; si no, nominal + aviso.
28. **Tramos solapados de una misma pista** se mezclan con `amix normalize=0`: pueden saturar. Improbable; documentar o limitar.
29. **Ecos**: `marcarEcos` solo mira pares a ≤ 2 s, con ≥ 70 % de similitud y ≥ 3 palabras; «vale», «sí» nunca se marcan. Documentarlo.
30. **Sin normalización de volumen**: ofrecer `--normalizar` (EBU R128 con `loudnorm` en dos pasadas) para el podcast.
31. **`corregir()`** crea una RegExp por corrección y segmento: precompilar.
32. **OpusHead en offset fijo 37**: vale para lo que genera `ogg.js`; un `.ogg` ajeno fallaría. Validar la firma.

## P2 — Instaladores, CI y release

33. **Instaladores sin hashes** (H24): versiones fijadas, pero sin verificar SHA‑256. Añadir hash por plataforma.
34. **Windows y Linux sin probar en sistemas reales** (solo PowerShell portátil en Mac).
35. **Imágenes del README** excluidas del zip del módulo: enlaces rotos al leerlo instalado. Inocuo; usar URLs absolutas si molesta.
36. **`publicar.yml`** cae a «Versión X.» si `CHANGELOG.md` no tiene la versión. Hacerlo fallar.
37. **Carpeta única repo = módulo instalado**: actualizar desde el manifiesto borra `.git`. Separar desarrollo de `Data/modules` (carpeta de trabajo + enlace simbólico).
38. **V14**: `verified` solo 13.351. Probar `game.audio.*.gainNode`, `FilePicker` y ApplicationV2 cuando V14 sea estable.

## P3 — Mejoras

39. Reanudar sin cuenta atrás de 5 s tras recargar la pestaña.
40. Indicador de grabación siempre visible (barra de Foundry), además del panel.
41. Prueba de integración real en CI (navegador sin cabeza con micro falso, dos usuarios); hoy solo hay dobles y la prueba en vivo es manual.
42. Registrar en el manifiesto muestras perdidas, reconexiones del micro y RTT para diagnosticar a posteriori.
43. Guía de una página para jugadores y otra para quien procesa; el MANUAL y el README son extensos.
44. Subida directa a Drive/MEGA: descartada (permisos y privacidad); la copia `.zip` lo cubre.

## Orden sugerido (v0.3.0)

1. #1 (límite de cola), #3 (temporales y espacio), #17, #20, #21 (bajo coste, alto valor).
2. #2 (huecos Ogg), #6 y #7 (rendimiento de OPFS).
3. Accesibilidad (#24–26) y limpieza (#13, #14, #22).
4. Hashes en instaladores y prueba real en Windows/Linux.
5. Partida real de 3–4 h con el grupo → anotar mediciones aquí → quitar WIP.

## Qué está bien (no tocar)

Alineación por muestras (probada con ffmpeg 6.1 y 9.0), corrección de reinicios del servidor, entrega verificada con inventario y CRC, consentimientos separados, Web Locks, plazo de arranque de pistas, copia `.zip` sin dependencias, avisos del informe de postproducción y las 23 pruebas.

---

## Estado tras la v0.3.0 (03-10-2026)

Probado: `npm test` 29/29 y, en un Foundry 13.351 de pruebas, el panel (parcial de canales, consentimiento que se guarda al marcarlo, aviso de espera de clic, entrega, sección de herramientas) con un micro simulado. Al probar apareció un fallo propio de la caché de la biblioteca (una lectura en vuelo podía guardar una lista vieja): corregido con un contador de versión y sin caché mientras se graba.

| # | Estado |
|---|---|
| 1 | **Hecho**: el escritor informa de su cola; aviso en pantalla a partir de 32 MB. No se descarta audio. |
| 2 | **Hecho**: huecos de Ogg detectados por número de secuencia y gránulo, rellenados con silencio (test con ffmpeg). |
| 3 | **Hecho**: señales, limpieza de temporales huérfanos, comprobación de espacio, `--temporal`, el original se borra al tener la versión limpia. Procesar voz a voz de principio a fin queda como mejora. |
| 4 | **Hecho** (test). |
| 5 | **Hecho**: «cierre sin confirmar» visible en la entrega y en la biblioteca. |
| 6 | **Hecho** (con contador de versión). |
| 7 | **No procede**: las anclas y marcadores ocupan unos 60 KB en 4 h; el coste es despreciable. |
| 8 | **Descartado** sin medir un problema real. |
| 9 | **No procede**: solo se descargan los textos que ya estaban en el servidor. |
| 10 | **Hecho**: el .zip ya escribía de uno en uno; ahora además reutiliza el CRC del inventario. |
| 11 | **Parcial**: DeepFilterNet en paralelo; Whisper sigue de uno en uno (ya usa todos los núcleos). |
| 12 | **Aceptado**: se documenta que `vad` no se recomienda. |
| 13, 14 | **Hecho**. |
| 15 | **Hecho**. |
| 16 | **Aceptado** (mesa de confianza). |
| 17–23 | **Hecho**. |
| 24–26 | **Hecho**. |
| 27 | **Hecho como aviso** (pocas anclas para la duración). |
| 28, 29 | **Aceptado y documentado**. |
| 30 | **Hecho**: `--normalizar`. |
| 31, 32 | **Hecho**. |
| 33 | **Hecho**: huellas SHA-256 en los instaladores de Mac, Linux y Windows y en los scripts del túnel; ffmpeg y Node se descargan de sus webs oficiales sin huella fija. |
| 34 | **Pendiente**: hace falta un Windows y un Linux reales. |
| 35 | **Aceptado**: el README solo se lee en GitHub. |
| 36 | **Hecho**. |
| 37 | **Pendiente**: ver el aviso del CLAUDE.md sobre actualizar desde el manifiesto en esta misma carpeta. |
| 38 | **Pendiente**: V14. |
| 39 | **No procede**: al recargar, la cuenta atrás no se repite (ya había empezado). |
| 40 | **Ya existía**: el indicador flotante. |
| 41 | **Pendiente**. |
| 42 | **Hecho** (`diagnostico.avisos` en el manifiesto). |
| 43 | **Pendiente**. |
| 44 | **Descartado**. |

Sigue pendiente lo que solo se resuelve con gente: una partida real de 3–4 h, Windows y Linux reales, V14.
