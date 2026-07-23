// Sincroniza los recursos COMPARTIDOS de la app local a la versión web (docs/).
// Se ejecuta tras tocar la maqueta, las fuentes o los estilos del editor:
//   npm run sync-web
//
// OJO: app.js, print.js e index.html NO se sincronizan — la versión web tiene
// su propia capa de datos (localStorage + proxies CORS) y hay que editar
// ambas copias en paralelo.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const jobs = [
  ['public/magazine.css', 'docs/magazine.css'],
  ['public/fonts.css', 'docs/fonts.css'],
  ['public/ui.css', 'docs/ui.css'],
  ['public/fonts', 'docs/fonts'],
  ['node_modules/pagedjs/dist/paged.esm.js', 'docs/vendor/paged.esm.js'],
  ['node_modules/@mozilla/readability/Readability.js', 'docs/vendor/Readability.js']
];

for (const [from, to] of jobs) {
  const src = path.join(root, from);
  const dst = path.join(root, to);
  await fs.cp(src, dst, { recursive: true, force: true });
  console.log(`${from} → ${to}`);
}
console.log('Sincronizado.');
