// Añade artículos a la revista desde la terminal (requiere el servidor arrancado).
// Uso:  node add.mjs <url> [<url> ...]

const base = process.env.QUIOSCO_URL || 'http://localhost:4321';
const urls = process.argv.slice(2);

if (!urls.length) {
  console.error('Uso: node add.mjs <url> [<url> ...]');
  process.exit(1);
}

const mag = await (await fetch(`${base}/api/magazine`)).json();

for (const url of urls) {
  process.stdout.write(`Extrayendo ${url} … `);
  const r = await fetch(`${base}/api/extract`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url })
  });
  const data = await r.json();
  if (!r.ok) {
    console.log(`ERROR: ${data.error}`);
    continue;
  }
  mag.articles.push({ id: crypto.randomUUID(), included: true, ...data });
  console.log(`OK — «${data.title}» (${data.minutes} min)`);
}

const put = await fetch(`${base}/api/magazine`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(mag)
});
console.log(put.ok ? `Guardado. La revista tiene ${mag.articles.length} artículos.` : 'ERROR al guardar');
