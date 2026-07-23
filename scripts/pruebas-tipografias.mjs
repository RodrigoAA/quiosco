// Genera un PDF de UNA página por cada tipografía, para pruebas de impresión.
// La página elegida es la primera del artículo indicado (por fragmento del
// título), que puede caer en un número distinto según la fuente.
//
//   node scripts/pruebas-tipografias.mjs "In Praise of the Gods"
//
// Requiere el servidor en marcha (npm start). Salida: Pruebas tipografias/

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const TITLE = process.argv[2] || 'In Praise of the Gods';
const OUT_DIR = path.join(import.meta.dirname, '..', 'Pruebas tipografias');
const FONTS = ['clasica', 'editorial', 'elegante', 'glossy', 'libro', 'prensa', 'diario', 'cartel', 'moderna', 'suiza'];

const BROWSER_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];
let bin = null;
for (const p of BROWSER_PATHS) {
  try { await fs.access(p); bin = p; break; } catch { /* siguiente */ }
}
if (!bin) throw new Error('No se encontró Edge ni Chrome');

await fs.mkdir(OUT_DIR, { recursive: true });
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'quiosco-tipos-'));
const proc = spawn(bin, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'
]);

try {
  const wsBrowser = await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('El navegador no arrancó a tiempo')), 20000);
    proc.stderr.on('data', d => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
  });
  const port = new URL(wsBrowser).port;
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('Sin conexión CDP')); });

  let seq = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  ws.onclose = () => {
    for (const cb of pending.values()) cb({ error: { message: 'el navegador cerró la conexión' } });
    pending.clear();
  };
  const send = (method, params = {}, timeoutMs = 120000) => new Promise((resolve, reject) => {
    const id = ++seq;
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`Sin respuesta a ${method}`)); }, timeoutMs);
    pending.set(id, m => {
      clearTimeout(t);
      m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async expression =>
    (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value;

  for (let i = 0; i < FONTS.length; i++) {
    const font = FONTS[i];
    process.stdout.write(`${font.padEnd(10)} maquetando… `);
    await send('Page.navigate', { url: `http://localhost:4321/print.html?font=${font}` });

    const deadline = Date.now() + 180000;
    let doneAt = 0;
    for (;;) {
      const st = JSON.parse(await evalJs(`JSON.stringify({
        status: window.__pagedStatus ? window.__pagedStatus.done : null,
        imgsPending: Array.from(document.images).filter(im => !im.complete).length
      })`));
      if (st.status === 'error') throw new Error(`Paged.js falló con la fuente ${font}`);
      if (st.status === true) {
        if (!doneAt) doneAt = Date.now();
        if (st.imgsPending === 0 || Date.now() - doneAt > 60000) break;
      }
      if (Date.now() > deadline) throw new Error(`Timeout maquetando con ${font}`);
      await new Promise(r => setTimeout(r, 500));
    }
    await new Promise(r => setTimeout(r, 500));

    const pageNum = await evalJs(`(() => {
      const h = [...document.querySelectorAll('h1.article-title')]
        .find(x => x.textContent.toLowerCase().includes(${JSON.stringify(TITLE.toLowerCase())}));
      const page = h && h.closest('.pagedjs_page');
      return page ? Number(page.dataset.pageNumber) : 0;
    })()`);
    if (!pageNum) throw new Error(`No encontré «${TITLE}» maquetado con ${font}`);

    const pdf = await send('Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: true,
      pageRanges: String(pageNum),
      transferMode: 'ReturnAsStream'
    });
    const chunks = [];
    for (;;) {
      const c = await send('IO.read', { handle: pdf.stream, size: 1 << 20 });
      chunks.push(Buffer.from(c.data, c.base64Encoded ? 'base64' : 'utf8'));
      if (c.eof) break;
    }
    await send('IO.close', { handle: pdf.stream });

    const file = path.join(OUT_DIR, `${String(i + 1).padStart(2, '0')}-${font}.pdf`);
    await fs.writeFile(file, Buffer.concat(chunks));
    console.log(`pág. ${pageNum} → ${path.basename(file)}`);
  }
  ws.close();
  console.log(`\nListo: ${FONTS.length} PDFs en ${OUT_DIR}`);
} finally {
  proc.kill();
  fs.rm(profile, { recursive: true, force: true }).catch(() => { });
}
