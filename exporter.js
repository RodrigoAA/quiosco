// Utilidades de navegador headless (Edge/Chrome vía CDP):
// - exportPDF: espera a que Paged.js termine y genera el PDF de la revista
// - fetchPageHTML: descarga una página como lo haría una persona, para sitios
//   que rechazan peticiones de servidores (429/403, challenges de Vercel, etc.)

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const BROWSER_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];

async function findBrowser() {
  for (const p of BROWSER_PATHS) {
    try { await fs.access(p); return p; } catch { /* siguiente */ }
  }
  throw new Error('No se encontró Edge ni Chrome instalado');
}

// Arranca el navegador, abre una pestaña con sesión CDP y ejecuta fn({ send });
// limpia proceso y perfil temporal pase lo que pase.
async function withBrowserPage(fn) {
  const bin = await findBrowser();
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'quiosco-cdp-'));
  const proc = spawn(bin, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'
  ]);

  try {
    // El puerto elegido sale por stderr: "DevTools listening on ws://127.0.0.1:PUERTO/..."
    const wsBrowser = await new Promise((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error('El navegador no arrancó a tiempo')), 20000);
      proc.stderr.on('data', d => {
        buf += d;
        const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (m) { clearTimeout(timer); resolve(m[1]); }
      });
      proc.on('exit', () => { clearTimeout(timer); reject(new Error('El navegador se cerró inesperadamente')); });
    });
    const port = new URL(wsBrowser).port;

    const target = await (await fetch(`http://127.0.0.1:${port}/json/new`, {
      method: 'PUT'
    })).json();

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error('No se pudo conectar al navegador headless'));
    });

    let seq = 0;
    const pending = new Map();
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    // Si el navegador corta la conexión, que no quede ninguna llamada colgada
    ws.onclose = () => {
      for (const cb of pending.values()) cb({ error: { message: 'el navegador cerró la conexión' } });
      pending.clear();
    };
    const send = (method, params = {}, timeoutMs = 60000) => new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Sin respuesta del navegador a ${method}`));
      }, timeoutMs);
      pending.set(id, m => {
        clearTimeout(timer);
        m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result);
      });
      ws.send(JSON.stringify({ id, method, params }));
    });

    const result = await fn({ send });
    ws.close();
    return result;
  } finally {
    proc.kill();
    fs.rm(profile, { recursive: true, force: true }).catch(() => { });
  }
}

export function exportPDF(url, outFile) {
  return withBrowserPage(async ({ send }) => {
    await send('Page.navigate', { url });

    // Esperar a que Paged.js acabe y a que carguen las imágenes
    // (si alguna imagen se atasca, seguimos igualmente pasado un margen)
    const deadline = Date.now() + 180000;
    let doneAt = 0;
    for (;;) {
      const { result } = await send('Runtime.evaluate', {
        expression: `JSON.stringify({
          href: location.href,
          status: window.__pagedStatus ? window.__pagedStatus.done : null,
          imgsPending: Array.from(document.images).filter(i => !i.complete).length
        })`,
        returnByValue: true
      });
      const st = JSON.parse(result.value);
      if (st.status === 'error') throw new Error('Paged.js falló al maquetar la revista');
      if (st.status === true) {
        if (!doneAt) doneAt = Date.now();
        if (st.imgsPending === 0 || Date.now() - doneAt > 60000) break;
      }
      if (Date.now() > deadline) {
        throw new Error(`La maquetación no terminó a tiempo (página: ${st.href}, estado: ${st.status}, imágenes pendientes: ${st.imgsPending})`);
      }
      await new Promise(r => setTimeout(r, 500));
    }
    await new Promise(r => setTimeout(r, 800));

    // El PDF se pide como stream y se lee por trozos: entero en un solo
    // mensaje revienta el WebSocket con documentos grandes (visto con 50 págs).
    const pdf = await send('Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: true,
      transferMode: 'ReturnAsStream'
    }, 120000);
    const chunks = [];
    for (;;) {
      const c = await send('IO.read', { handle: pdf.stream, size: 1 << 20 });
      chunks.push(Buffer.from(c.data, c.base64Encoded ? 'base64' : 'utf8'));
      if (c.eof) break;
    }
    await send('IO.close', { handle: pdf.stream });
    await fs.writeFile(outFile, Buffer.concat(chunks));
  });
}

// Páginas de espera de los sistemas anti-bots más comunes
const CHALLENGE_TITLES = /security checkpoint|just a moment|attention required|un momento|verifying you|are you a robot/i;

export function fetchPageHTML(url) {
  return withBrowserPage(async ({ send }) => {
    const evalJs = async expression =>
      (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value;

    await send('Page.navigate', { url });

    // Espera a que cargue Y a que el challenge (si lo hay) se resuelva solo
    const deadline = Date.now() + 40000;
    for (;;) {
      const st = JSON.parse(await evalJs(`JSON.stringify({
        ready: document.readyState,
        title: document.title,
        len: document.body ? document.body.innerText.length : 0
      })`));
      if (st.ready === 'complete' && !CHALLENGE_TITLES.test(st.title) && st.len > 0) break;
      if (Date.now() > deadline) break; // devolvemos lo que haya llegado
      await new Promise(r => setTimeout(r, 500));
    }
    await new Promise(r => setTimeout(r, 500));

    return {
      html: await evalJs('document.documentElement.outerHTML'),
      url: await evalJs('location.href')
    };
  });
}
