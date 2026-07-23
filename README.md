# Quiosco — maquetador de revistas A4

Convierte artículos de **Substack, blogs y X** en una **revista A4 imprimible**:
portada, sumario con números de página, artículos en columnas con capitular,
contraportada con colofón y folio en el pie. Editas en el navegador y sacas un
PDF listo para la imprenta.

- **App local** (esta carpeta): la versión completa, con exportación de PDF fiable.
- **Versión web**: <https://rodrigoaa.github.io/quiosco/> — 100 % estática
  (GitHub Pages), guarda en el navegador y extrae vía proxies públicos.
  Para el PDF de imprenta, usa siempre la local.

## Arrancar

Doble clic en **`start.cmd`** (instala dependencias la primera vez y abre el
navegador), o desde la terminal:

```
npm install   # solo la primera vez
npm start     # abre http://localhost:4321
```

## Cómo se usa

1. **Añadir artículos**: pega una URL y pulsa Añadir. El servidor descarga la
   página y extrae el artículo limpio con Readability (sin widgets de
   suscripción, botones ni embeds). También puedes añadir en lote desde la
   terminal: `node add.mjs <url1> <url2>…`
2. **Números**: cada revista vive en su propio número (`data/issues/issue-N.json`).
   El selector cambia entre números; ＋ crea el siguiente (hereda el diseño,
   empieza vacío); 🗑 elimina el actual.
3. **Diseño** (por revista): color de acento (con paleta extraída de la imagen
   de portada y cuentagotas 🎨), 5 tipografías empaquetadas, columnas 1–4,
   alineación, párrafos (sangría clásica o espaciado web), contraportada
   (raya o página completa de color) y acabado.
4. **Por artículo** (✎): título, autor, entradilla, imagen destacada, columnas
   y alineación propias.
5. **✂ Recortar** (en la previsualización): entra al modo y marca lo que sobra —
   clic en una imagen (en galerías, solo esa copia), selección de texto
   (fragmentos de párrafo o párrafos enteros, resaltados en rojo). **✓ Aplicar**
   ejecuta todo de golpe; **✕** cancela; **↩** deshace lotes aplicados.
6. **⛶ Vista completa**: solo la revista y la toolbar flotante (Esc para volver).
7. **⬇ Descargar PDF**: genera la revista con Edge headless en el servidor
   (espera a la maqueta y a las imágenes, transferencia por streaming) y la
   descarga; copia maestra en `exports/`. **🖨 Imprimir PDF** abre el diálogo
   del navegador, solo para impresora física (escala 100 %, márgenes «Ninguno»,
   «Gráficos de fondo» activado).

### Añadir con un clic: extensión de navegador

En `extension/` hay una extensión Chrome/Edge (icono Q morado): un clic estando
en cualquier artículo lo añade al número actual, con ✓/✗ sobre el icono.
Instalación: `chrome://extensions` → «Modo de desarrollador» → «Cargar
descomprimida» → carpeta `quiosco/extension`. Requiere Quiosco arrancado.

### Añadir desde el móvil

Los artículos se suelen descubrir en el móvil (app de X, newsletters en
Gmail). Dos vías:

- **Bot de Telegram (recomendada)**: en Telegram habla con **@BotFather** →
  `/newbot` → copia el token en el panel «Desde el móvil» del editor →
  mándale un primer mensaje al bot para vincularlo. Desde entonces,
  **Compartir → Telegram → tu bot** desde cualquier app añade el artículo al
  número actual, y el bot responde ✓/✗. Telegram hace de cola: puedes
  compartir con el PC apagado y se importa todo al arrancar Quiosco. El bot
  queda vinculado al primer chat que le escriba (el resto se ignora); el
  token vive en `data/telegram.json`, fuera del repo.
- **Misma WiFi**: abre `http://<ip-del-pc>:4321/movil` en el móvil (la URL
  exacta sale al arrancar el servidor y en el panel) y pega la URL.

### Posts e hilos de X

Pega cualquier URL `x.com/…/status/…`. Como X no sirve HTML a servidores, se
usan la **API de FxTwitter** (texto completo, fotos, autor, cadena de
respuestas — se sube hasta el primer post del hilo) y **ThreadReaderApp** (si
el hilo está desenrollado allí, se recupera entero). Para un hilo que no esté
en ThreadReaderApp, pega el **último** post. No soportado: «Articles» premium,
cuentas privadas, posts borrados.

## Imprimir en papel

Pedido tipo para la copistería/imprenta: **«revista A4 grapada a caballete, a
color, doble cara, autocubierta»**. El PDF ya sale con las páginas en múltiplo
de 4 (blancas automáticas antes de la contraportada), así que no hay que pedir
nada especial. Nada llega al borde del papel salvo la contraportada en modo
«área» (sin sangre: puede quedar un filo blanco según la máquina). Consejo:
imprime una copia de prueba antes de encargar la tirada.

## Arquitectura

```
server.js            Express: sirve el editor, extrae artículos
                     (Readability + jsdom, FxTwitter/ThreadReaderApp para X),
                     gestiona números (data/issues/ + data/state.json),
                     /add?url= (extensión) y /api/export-pdf
exporter.js          PDF con Edge/Chrome headless vía CDP: espera a Paged.js
                     y a las imágenes; Page.printToPDF en streaming
public/index.html    Editor (header · top bar · sidebar · visor)
public/app.js        Estado del editor, autoguardado, recortes, paleta, zoom/nav
public/print.html/.js  Vista de impresión: compone la revista y la pagina
                     en A4 con Paged.js (doble pasada para múltiplo de 4)
public/magazine.css  LA MAQUETA de la revista (edítala para cambiar el diseño)
public/fonts*        Tipografías woff2 empaquetadas (subset latin)
extension/           Extensión Chrome MV3 «A Quiosco»
docs/                Versión web estática (GitHub Pages)
data/                Tus revistas (fuera del repo)
exports/             PDFs generados (fuera del repo)
```

El editor y la vista de impresión se hablan por `postMessage`:
`view` (modo/zoom) · `pages`/`page-current`/`goto` (navegación) ·
`trim-count`/`apply-now`/`apply-trims`/`clear-trims` (recortes).

### Notas de desarrollo

- **`docs/` duplica `app.js`/`print.js`/`index.html`** con otra capa de datos
  (localStorage, proxies CORS, sin exportador): los cambios de lógica se
  aplican en las dos copias. Los recursos compartidos (maqueta, fuentes,
  estilos, vendor) se sincronizan con `npm run sync-web`.
- Lecciones de Paged.js: nada debe desbordar la caja de página (genera hojas
  en blanco al imprimir); para pintar hasta el borde, fondo en
  `.pagedjs_<nombre>_page`; las reglas `p + p` bajo selectores de atributo en
  `html` se pierden (usar clases en la sección); los párrafos partidos llevan
  `data-split-from/to`.
- `?font=…&cols=…&align=…&paragraphs=…&back=…&finish=…` en `print.html`
  permiten probar diseño sin guardar.
- No editar ajustes vía `curl` desde la terminal de Windows: corrompe UTF-8.

## Límites conocidos

- Artículos de pago: solo se extrae la parte pública.
- Vídeos, audios y embeds interactivos se eliminan (es papel).
- Las imágenes se cargan de la web original: hace falta conexión al exportar,
  y las rotas o colgadas se omiten (se avisa en la barra).
- La versión web depende de proxies CORS públicos (r.jina.ai y alternativas)
  que pueden fallar según el día.
