# Quiosco — maquetador de revistas A4

App local para convertir artículos de Substack o blogs en una revista A4
lista para imprimir: portada, sumario con números de página, artículos a dos
columnas con capitular y folio en el pie.

## Arrancar

Doble clic en **`start.cmd`** (instala dependencias la primera vez y abre el
navegador), o desde la terminal:

```
npm install   # solo la primera vez
npm start     # abre http://localhost:4321
```

## Uso

1. En el editor, pega la URL de un artículo y pulsa **Añadir**. El servidor
   descarga la página y extrae el texto limpio (sin widgets de suscripción,
   botones, etc.).
2. Ordena los artículos con ↑/↓, edítalos con ✎ (título, autor, entradilla,
   imagen), o desmárcalos para excluirlos sin borrarlos.
3. Ajusta título de la revista, número, fecha, color de acento y tipografía.
   Todo se guarda solo (en `data/magazine.json`, con copia en
   `magazine.backup.json`).
4. **Exportar PDF** (botón del editor, o «Descargar PDF» en la vista de
   impresión) genera el PDF en el servidor, lo guarda en `quiosco/exports/`
   y abre el Explorador con el archivo seleccionado. Es LA vía para obtener
   el PDF: no depende del diálogo de imprimir del navegador, que con
   revistas grandes falla (PDFs corruptos o de 0 bytes, sobre todo con el
   driver «Microsoft Print to PDF» o desde el navegador integrado de
   VS Code). Por dentro usa Edge/Chrome headless: espera a que la maqueta
   y las imágenes estén listas y transfiere el PDF por streaming.
5. **Imprimir…** (en la vista de impresión) abre el diálogo del navegador —
   solo para mandar a una impresora física, y mejor desde Edge/Chrome de
   verdad (no el navegador de VS Code): escala **100 %**, márgenes
   **Ninguno**, **«Gráficos de fondo» activado**.

También puedes añadir varios artículos de golpe desde la terminal (con el
servidor arrancado):

```
node add.mjs https://ejemplo.substack.com/p/articulo-1 https://otroblog.com/post
```

## Posts e hilos de X (Twitter)

También puedes pegar enlaces de `x.com` / `twitter.com` (URLs de tipo
`…/status/123456`). Como X no sirve HTML a servidores, se usan dos vías
públicas:

1. **FxTwitter** — texto completo del post (incluidos los largos), fotos,
   autor y fecha. Si el post es parte de un hilo propio, se sube por la
   cadena de respuestas hasta el primer post.
2. **ThreadReaderApp** — si el hilo está desenrollado allí, se recupera
   **entero** (incluye lo que viene después del post pegado).

En la práctica: pega cualquier post del hilo. Si ThreadReaderApp no lo
tiene, pega el **último** post del hilo para capturarlo completo. El titular
se genera con la primera frase (edítalo con ✎ si quieres otro).

No soportado: los "Articles" premium de X (no hay API pública), cuentas
privadas y posts borrados. Los vídeos se omiten (es papel).

## Límites conocidos

- Artículos **de pago** (paywall): solo se extrae la parte pública.
- Los vídeos, audios y embeds interactivos se eliminan (es papel).
- Las imágenes se cargan desde la web original: hace falta conexión al
  imprimir. Si un post desaparece de internet, guarda antes el PDF.

## Cómo funciona

- `server.js` — Express. Sirve el editor y expone `/api/extract` (descarga la
  URL y extrae el artículo con Readability, el motor del modo lectura de
  Firefox) y `/api/magazine` (carga/guarda `data/magazine.json`).
- `public/index.html` + `app.js` + `ui.css` — el editor.
- `public/print.html` + `print.js` — compone portada, sumario y artículos, y
  los pagina en A4 con **Paged.js**.
- `public/magazine.css` — la maqueta de la revista (cámbiala para retocar el
  diseño: columnas, tipografías, márgenes de `@page`, etc.).
