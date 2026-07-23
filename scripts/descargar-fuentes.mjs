// Descarga las tipografías (subset latin, woff2) desde google-webfonts-helper.
// Se ejecuta una vez: node scripts/descargar-fuentes.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'public', 'fonts');

const FONTS = [
  { id: 'playfair-display', variants: ['700', '800'] },
  { id: 'lora', variants: ['regular', 'italic', '700'] },
  { id: 'cormorant-garamond', variants: ['700'] },
  { id: 'eb-garamond', variants: ['regular', 'italic', '700'] },
  { id: 'newsreader', variants: ['regular', 'italic', '700'] },
  { id: 'archivo', variants: ['700', '800'] },
  { id: 'inter', variants: ['regular', '700', '800'] },
  { id: 'fraunces', variants: ['700', '800'] },
  { id: 'source-serif-4', variants: ['regular', 'italic', '700'] },
  { id: 'spectral', variants: ['700', '800'] },
  { id: 'crimson-pro', variants: ['regular', 'italic', '700'] },
  { id: 'space-grotesk', variants: ['500', '700'] },
  { id: 'work-sans', variants: ['regular', 'italic', '700'] },
  { id: 'libre-franklin', variants: ['700', '800'] },
  { id: 'merriweather', variants: ['regular', 'italic', '700'] },
  { id: 'oswald', variants: ['600', '700'] },
  { id: 'bitter', variants: ['regular', 'italic', '700'] }
];

await fs.mkdir(OUT, { recursive: true });

for (const font of FONTS) {
  const meta = await (await fetch(`https://gwfh.mranftl.com/api/fonts/${font.id}?subsets=latin`)).json();
  for (const wanted of font.variants) {
    const v = meta.variants.find(x => x.id === wanted);
    if (!v || !v.woff2) { console.error(`FALTA ${font.id} ${wanted}`); continue; }
    const buf = Buffer.from(await (await fetch(v.woff2)).arrayBuffer());
    const file = path.join(OUT, `${font.id}-${wanted}.woff2`);
    await fs.writeFile(file, buf);
    console.log(`${font.id}-${wanted}.woff2  ${Math.round(buf.length / 1024)} KB`);
  }
}
console.log('Hecho.');
