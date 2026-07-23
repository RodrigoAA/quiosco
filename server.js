import express from 'express';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { exportPDF } from './exporter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'magazine.json');
const PORT = process.env.PORT || 4321;

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor', express.static(path.join(__dirname, 'node_modules', 'pagedjs', 'dist')));
app.use('/exports', express.static(path.join(__dirname, 'exports')));
// Copia de desarrollo de la versión web estática (la que vive en GitHub Pages)
app.use('/web', express.static(path.join(__dirname, 'docs')));

const DEFAULT_MAGAZINE = {
  settings: {
    title: 'Mi Revista',
    subtitle: 'Selección de lecturas',
    issue: 'Nº 1',
    date: '',
    accent: '#b3402a',
    font: 'clasica',
    columns: '2',
    align: 'justificado',
    paragraphs: 'sangria',
    finish: 'caballete',
    backstyle: 'raya',
    coverImage: ''
  },
  articles: []
};

/* ---------- Números (issues): un JSON por revista en data/issues/ ---------- */

const ISSUES_DIR = path.join(DATA_DIR, 'issues');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

// Crea el estado la primera vez, migrando el data/magazine.json antiguo
// (que se conserva intacto como copia) a issues/issue-1.json.
async function ensureState() {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  } catch {
    await fs.mkdir(ISSUES_DIR, { recursive: true });
    let mag = null;
    try { mag = JSON.parse(await fs.readFile(DATA_FILE, 'utf8')); } catch { /* no había */ }
    if (!mag) mag = structuredClone(DEFAULT_MAGAZINE);
    await fs.writeFile(path.join(ISSUES_DIR, 'issue-1.json'), JSON.stringify(mag, null, 2), 'utf8');
    const state = { currentId: 'issue-1' };
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    return state;
  }
}

async function setState(state) {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function issueFile(id) {
  return path.join(ISSUES_DIR, path.basename(String(id)) + '.json');
}

async function listIssues() {
  const state = await ensureState();
  const files = (await fs.readdir(ISSUES_DIR)).filter(f => f.endsWith('.json'));
  const issues = [];
  for (const f of files) {
    try {
      const id = f.slice(0, -5);
      const stat = await fs.stat(path.join(ISSUES_DIR, f));
      const m = JSON.parse(await fs.readFile(path.join(ISSUES_DIR, f), 'utf8'));
      issues.push({
        id,
        title: m.settings?.title || '',
        issue: m.settings?.issue || '',
        count: Array.isArray(m.articles) ? m.articles.length : 0,
        updatedAt: stat.mtimeMs,
        current: id === state.currentId
      });
    } catch { /* fichero corrupto: se omite del listado */ }
  }
  const num = id => parseInt(id.replace(/\D+/g, ''), 10) || 0;
  issues.sort((a, b) => num(a.id) - num(b.id));
  return issues;
}

async function loadMagazine() {
  const state = await ensureState();
  try {
    return JSON.parse(await fs.readFile(issueFile(state.currentId), 'utf8'));
  } catch {
    return structuredClone(DEFAULT_MAGAZINE);
  }
}

async function saveMagazine(mag) {
  const state = await ensureState();
  try {
    await fs.copyFile(issueFile(state.currentId), path.join(DATA_DIR, 'magazine.backup.json'));
  } catch { /* primera vez: no hay nada que respaldar */ }
  await fs.writeFile(issueFile(state.currentId), JSON.stringify(mag, null, 2), 'utf8');
}

app.get('/api/magazine', async (_req, res) => {
  res.json(await loadMagazine());
});

app.get('/api/issues', async (_req, res) => {
  res.json(await listIssues());
});

// Nuevo número: hereda el diseño del actual, empieza sin artículos
app.post('/api/issues', async (_req, res) => {
  const issues = await listIssues();
  const current = await loadMagazine();
  const nextN = issues.reduce((max, i) => Math.max(max, parseInt(i.id.replace(/\D+/g, ''), 10) || 0), 0) + 1;
  const id = `issue-${nextN}`;
  const mag = {
    settings: { ...current.settings, issue: `Nº ${nextN}`, date: '' },
    articles: []
  };
  await fs.writeFile(issueFile(id), JSON.stringify(mag, null, 2), 'utf8');
  await setState({ currentId: id });
  res.json({ ok: true, id });
});

app.post('/api/issues/select', async (req, res) => {
  const { id } = req.body || {};
  try {
    await fs.access(issueFile(id));
  } catch {
    return res.status(404).json({ error: 'Ese número no existe' });
  }
  await setState({ currentId: path.basename(String(id)) });
  res.json({ ok: true });
});

app.delete('/api/issues/:id', async (req, res) => {
  const id = path.basename(req.params.id);
  const issues = await listIssues();
  if (issues.length < 2) return res.status(400).json({ error: 'No se puede eliminar el único número' });
  if (!issues.some(i => i.id === id)) return res.status(404).json({ error: 'Ese número no existe' });
  await fs.rm(issueFile(id));
  const state = await ensureState();
  if (state.currentId === id) {
    const remaining = issues.filter(i => i.id !== id);
    await setState({ currentId: remaining[remaining.length - 1].id });
  }
  res.json({ ok: true });
});

app.put('/api/magazine', async (req, res) => {
  const mag = req.body;
  if (!mag || typeof mag !== 'object' || !mag.settings || !Array.isArray(mag.articles)) {
    return res.status(400).json({ error: 'Formato de revista no válido' });
  }
  await saveMagazine(mag);
  res.json({ ok: true });
});

// Extrae un artículo de cualquier URL soportada (blog/Substack o post/hilo de X)
async function extractAny(url) {
  if (!url || !/^https?:\/\//i.test(url)) {
    throw Object.assign(new Error('URL no válida (debe empezar por http:// o https://)'), { status: 400 });
  }
  // Posts e hilos de X van por otra vía: x.com no sirve HTML a servidores
  const statusId = parseXStatus(url);
  if (statusId) return extractXThread(statusId, url);

  let r;
  try {
    r = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
      headers: {
        'user-agent': UA,
        'accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'accept-language': 'es,en;q=0.8'
      }
    });
  } catch (e) {
    const msg = e.name === 'TimeoutError' ? 'El sitio tardó demasiado en responder' : e.message;
    throw Object.assign(new Error(msg), { status: 502 });
  }
  if (!r.ok) throw Object.assign(new Error(`El sitio respondió con error ${r.status}`), { status: 502 });
  const article = extractArticle(await r.text(), r.url || url);
  if (!article) throw Object.assign(new Error('No se pudo extraer el artículo de esa página'), { status: 422 });
  return article;
}

app.post('/api/extract', async (req, res) => {
  try {
    res.json(await extractAny((req.body || {}).url));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Bookmarklet: añade la URL al número actual y muestra una mini-confirmación
app.get('/add', async (req, res) => {
  const page = (title, body, autoClose) => `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>${title}</title></head>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#f2f1ee;padding:26px;color:#23211e">
<h3 style="margin:0 0 8px">${title}</h3>
<p style="color:#666;font-size:14px;line-height:1.4;margin:0 0 14px">${body}</p>
<p style="font-size:13px"><a href="/" target="_blank" style="color:#b3402a">Abrir Quiosco</a>
&nbsp;·&nbsp; <a href="#" onclick="window.close();return false" style="color:#666">Cerrar</a></p>
${autoClose ? '<script>setTimeout(() => window.close(), 2500)</script>' : ''}
</body></html>`;

  try {
    const article = await extractAny(req.query.url);
    const mag = await loadMagazine();
    mag.articles.push({ id: crypto.randomUUID(), included: true, ...article });
    await saveMagazine(mag);
    res.send(page('Añadido ✓',
      `«${esc(article.title)}» — ${esc(mag.settings.issue || '')} (${mag.articles.length} artículos)`, true));
  } catch (e) {
    res.status(e.status || 500).send(page('No se pudo añadir', esc(e.message), false));
  }
});

// Elementos que no pintan nada en una revista impresa (widgets de suscripción,
// botones de compartir, players…). Readability quita la mayoría; esto es la escoba fina.
const STRIP_SELECTORS = [
  'script', 'style', 'noscript', 'form', 'button', 'input', 'select', 'textarea',
  'iframe', 'audio', 'video', 'source',
  '.subscription-widget-wrap', '.subscription-widget', '.subscribe-widget',
  '.subscribe-footer', '.subscribe-dialog', '[data-component-name*="Subscribe" i]',
  '.button-wrapper', '.paywall', '.paywall-jump', '.share-dialog',
  '[class*="share-button" i]', '.post-footer', '.publication-footer', '.footer-wrap',
  '.image-link-expand', '.poll-embed', '.digest-post-embed', '.install-substack-app'
];

const normalize = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

function extractArticle(html, url) {
  const virtualConsole = new VirtualConsole(); // silencia errores de CSS de jsdom
  const dom = new JSDOM(html, { url, virtualConsole });
  const doc = dom.window.document;
  const meta = sel => doc.querySelector(sel)?.getAttribute('content')?.trim() || '';

  const lang = (doc.documentElement.getAttribute('lang') || '').slice(0, 2);
  const leadImage = meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]');
  const ogSiteName = meta('meta[property="og:site_name"]');
  const published = meta('meta[property="article:published_time"]');

  const parsed = new Readability(doc, { keepClasses: false }).parse();
  if (!parsed || !parsed.content) return null;

  const cdom = new JSDOM(`<body>${parsed.content}</body>`, { url, virtualConsole });
  const cdoc = cdom.window.document;

  for (const sel of STRIP_SELECTORS) {
    try { cdoc.querySelectorAll(sel).forEach(n => n.remove()); } catch { /* selector no soportado */ }
  }

  // Desenvolver enlaces que solo contienen una imagen (típico de Substack)
  cdoc.querySelectorAll('a').forEach(a => {
    if (a.querySelector('img') && !a.textContent.trim()) a.replaceWith(...a.childNodes);
  });

  // URLs absolutas y limpieza de atributos de tamaño
  cdoc.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src');
    if (!src) return img.remove();
    try { img.setAttribute('src', new URL(src, url).href); } catch { /* src raro, se deja */ }
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    img.removeAttribute('width');
    img.removeAttribute('height');
  });
  cdoc.querySelectorAll('a[href]').forEach(a => {
    try { a.setAttribute('href', new URL(a.getAttribute('href'), url).href); } catch { /* href raro */ }
  });

  // Título repetido al principio del cuerpo
  const firstHeading = cdoc.body.querySelector('h1, h2');
  if (firstHeading && normalize(firstHeading.textContent) === normalize(parsed.title)) {
    firstHeading.remove();
  }

  // Figuras que se quedaron vacías tras la limpieza
  cdoc.querySelectorAll('figure').forEach(f => {
    if (!f.querySelector('img, blockquote') && !f.textContent.trim()) f.remove();
  });

  const words = cdoc.body.textContent.split(/\s+/).filter(Boolean).length;

  // Byline: "Posted on July 30, 2014 by Scott Alexander" → "Scott Alexander"
  let byline = (parsed.byline || meta('meta[name="author"]') || '').replace(/\s+/g, ' ').trim();
  const byMatch = byline.match(/\bby\s+(.+)$/i);
  if (byMatch) byline = byMatch[1];
  if (/^(posted|published|publicado|escrito)\b/i.test(byline)) byline = '';
  byline = byline.replace(/^(by|por)\s+/i, '').trim();

  // Entradillas vacías tipo "…" no aportan nada
  let excerpt = (parsed.excerpt || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (/^[.…\s·—-]*$/.test(excerpt)) excerpt = '';
  // …ni las que solo repiten el arranque del artículo (aunque el cuerpo
  // empiece con un rótulo tipo «La Reflexión» antes del texto duplicado)
  const squash = s => normalize(s).replace(/\s+/g, '');
  if (excerpt && squash(cdoc.body.textContent).slice(0, 600).includes(squash(excerpt).replace(/[.…]+$/, '').slice(0, 150))) {
    excerpt = '';
  }

  let siteName = parsed.siteName || ogSiteName;
  if (!siteName) {
    try { siteName = new URL(url).hostname.replace(/^www\./, ''); } catch { siteName = ''; }
  }

  return {
    url,
    title: (parsed.title || doc.title || 'Sin título').trim(),
    byline,
    siteName,
    excerpt,
    leadImage,
    publishedTime: parsed.publishedTime || published || '',
    lang,
    minutes: Math.max(1, Math.round(words / 220)),
    words,
    content: cdoc.body.innerHTML
  };
}

app.post('/api/export-pdf', async (_req, res) => {
  try {
    const mag = await loadMagazine();
    const safe = s => (s || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
    const name = `${safe(mag.settings.title) || 'Revista'} — ${safe(mag.settings.issue) || 'sin número'}.pdf`;
    const dir = path.join(__dirname, 'exports');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, name);

    await exportPDF(`http://localhost:${PORT}/print.html`, file);

    const size = (await fs.stat(file)).size;
    if (size < 1000) throw new Error('El PDF salió vacío; revisa la vista de impresión');
    res.json({ ok: true, name, url: '/exports/' + encodeURIComponent(name), path: file, kb: Math.round(size / 1024) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Proxy de imágenes: permite leer los píxeles en canvas (los CDN de los
// blogs no envían CORS, y sin esto el canvas queda «tainted»)
app.get('/api/img', async (req, res) => {
  const { url } = req.query;
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).end();
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return res.status(502).end();
    res.set('content-type', r.headers.get('content-type') || 'image/jpeg');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch {
    res.status(500).end();
  }
});

/* ================= Bandeja del móvil: bot de Telegram =================
   Compartes un enlace al bot desde el móvil (X, Gmail…) y Quiosco lo extrae
   y lo añade al número actual. Telegram hace de cola: si el PC está apagado,
   los mensajes esperan hasta el siguiente arranque. El token vive en
   data/telegram.json (fuera del repo). */

const TG_FILE = path.join(DATA_DIR, 'telegram.json');
let tgState = null;
let tgRunning = false;

async function tgApi(method, params = {}) {
  const r = await fetch(`https://api.telegram.org/bot${tgState.token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(65000)
  });
  return r.json();
}

async function saveTg() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(TG_FILE, JSON.stringify(tgState, null, 2), 'utf8');
}

function urlsInMessage(msg) {
  const out = new Set();
  const text = msg.text || msg.caption || '';
  for (const e of [...(msg.entities || []), ...(msg.caption_entities || [])]) {
    if (e.type === 'url') out.add(text.substr(e.offset, e.length));
    if (e.type === 'text_link' && e.url) out.add(e.url);
  }
  for (const m of text.matchAll(/https?:\/\/\S+/g)) {
    out.add(m[0].replace(/[)\],.]+$/, ''));
  }
  return [...out];
}

async function tgLoop() {
  if (tgRunning) return;
  tgRunning = true;
  console.log('Bandeja Telegram activa: esperando enlaces del móvil…');
  while (tgState && tgState.token) {
    try {
      const res = await tgApi('getUpdates', { timeout: 50, offset: tgState.offset || 0 });
      if (!res.ok) {
        await new Promise(r => setTimeout(r, 10000));
        continue;
      }
      for (const up of res.result) {
        tgState.offset = up.update_id + 1;
        const msg = up.message;
        if (!msg) continue;
        // El primer chat que escriba queda vinculado; el resto se ignora
        if (!tgState.chatId) tgState.chatId = msg.chat.id;
        if (msg.chat.id !== tgState.chatId) continue;

        const urls = urlsInMessage(msg);
        if (!urls.length) {
          await tgApi('sendMessage', { chat_id: msg.chat.id, text: 'No veo ninguna URL en ese mensaje 🤔' });
          continue;
        }
        for (const url of urls) {
          try {
            const article = await extractAny(url);
            const mag = await loadMagazine();
            mag.articles.push({ id: crypto.randomUUID(), included: true, ...article });
            await saveMagazine(mag);
            tgState.added = (tgState.added || 0) + 1;
            await tgApi('sendMessage', {
              chat_id: msg.chat.id,
              text: `✓ «${article.title}» añadido (${mag.settings.issue || 'revista'}, ${mag.articles.length} artículos)`
            });
          } catch (e) {
            await tgApi('sendMessage', { chat_id: msg.chat.id, text: `✗ No pude añadir ${url}\n${e.message}` });
          }
        }
      }
      if (res.result.length) await saveTg();
    } catch {
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  tgRunning = false;
}

app.get('/api/telegram', (_req, res) => {
  if (!tgState || !tgState.token) return res.json({ configured: false });
  res.json({
    configured: true,
    username: tgState.username || null,
    bound: !!tgState.chatId,
    added: tgState.added || 0
  });
});

app.post('/api/telegram', async (req, res) => {
  const { token } = req.body || {};
  if (!token || !/^\d+:[\w-]+$/.test(token)) {
    return res.status(400).json({ error: 'Eso no parece un token de BotFather (formato 123456:ABC…)' });
  }
  let check = null;
  try {
    check = await (await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(15000)
    })).json();
  } catch { /* sin red o Telegram caído */ }
  if (!check || !check.ok) return res.status(400).json({ error: 'Telegram rechaza ese token' });
  tgState = { token, username: check.result.username, offset: 0, added: 0 };
  await saveTg();
  tgLoop();
  res.json({ ok: true, username: check.result.username });
});

// Página mínima para añadir desde el móvil en la misma WiFi (sin bot)
app.get('/movil', (_req, res) => {
  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quiosco — añadir</title></head>
<body style="font-family:'Segoe UI',system-ui,sans-serif;background:#f4f2ee;margin:0;padding:28px 18px">
<h2 style="margin:0 0 4px">🗞️ Quiosco</h2>
<p style="color:#8b857b;font-size:14px;margin:0 0 18px">Pega la URL del artículo y se añadirá al número actual.</p>
<form action="/add" style="display:flex;flex-direction:column;gap:12px">
  <input name="url" type="url" required placeholder="https://…"
    style="padding:14px;font-size:16px;border:1px solid #d9d4ca;border-radius:10px">
  <button style="padding:14px;font-size:16px;font-weight:600;color:#fff;background:#b3402a;border:none;border-radius:10px">Añadir a la revista</button>
</form>
</body></html>`);
});

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list || []) {
      if (iface.family === 'IPv4' && !iface.internal) out.push(iface.address);
    }
  }
  return out;
}

app.get('/api/info', (_req, res) => {
  res.json({ lan: lanAddresses().map(ip => `http://${ip}:${PORT}/movil`) });
});

/* ================= Posts e hilos de X (Twitter) =================
   x.com es una SPA: el HTML llega vacío a un servidor. Usamos dos vías
   públicas: la API de FxTwitter (texto completo, fotos, autor, cadena de
   respuestas) y ThreadReaderApp (hilos ya desenrollados). */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const X_HOSTS = new Set([
  'x.com', 'www.x.com', 'twitter.com', 'www.twitter.com',
  'mobile.twitter.com', 'mobile.x.com', 'fxtwitter.com', 'vxtwitter.com', 'fixupx.com'
]);

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function parseXStatus(url) {
  try {
    const u = new URL(url);
    if (!X_HOSTS.has(u.hostname)) return null;
    const m = u.pathname.match(/\/status(?:es)?\/(\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function fetchFxTweet(id) {
  const r = await fetch(`https://api.fxtwitter.com/i/status/${id}`, {
    headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j && j.code === 200 && j.tweet ? j.tweet : null;
}

// Titular a partir de la primera frase del post
function deriveTitle(text, author) {
  const clean = (text || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) return `Publicado por ${author}`;
  const m = clean.match(/^.{10,90}?[.!?…](?=\s|$)/);
  if (m) return m[0].trim();
  return clean.length <= 90 ? clean : clean.slice(0, 90).replace(/\s+\S*$/, '') + '…';
}

function tweetBodyHTML(t) {
  const parts = (t.text || '')
    .split(/\n+/).map(s => s.trim()).filter(Boolean)
    .map(s => `<p>${esc(s)}</p>`);
  if (t.media && Array.isArray(t.media.photos)) {
    for (const p of t.media.photos) parts.push(`<figure><img src="${esc(p.url)}" alt=""></figure>`);
  }
  if (t.quote) {
    const q = t.quote;
    parts.push(`<blockquote><p>${esc(q.text)}</p><p>— ${esc(q.author?.name || '')} (@${esc(q.author?.screen_name || '')})</p></blockquote>`);
  }
  return parts.join('');
}

// Hilo desenrollado en ThreadReaderApp (solo existe si alguien lo pidió allí)
async function fetchThreadReader(rootId) {
  try {
    const r = await fetch(`https://threadreaderapp.com/thread/${rootId}.html`, {
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow'
    });
    if (!r.ok) return null;
    const virtualConsole = new VirtualConsole();
    const dom = new JSDOM(await r.text(), { virtualConsole });
    const tweets = [...dom.window.document.querySelectorAll('div[id^="tweet_"].content-tweet')];
    if (!tweets.length) return null;

    const out = [];
    for (const tw of tweets) {
      tw.querySelectorAll('.tw-permalink, .tweet-url, script, style').forEach(n => n.remove());
      // Emojis vienen como <img>: se sustituyen por su carácter (está en el alt)
      tw.querySelectorAll('img').forEach(img => {
        const src = img.getAttribute('data-src') || img.getAttribute('src') || '';
        if (/emoji/i.test(img.className + ' ' + src)) {
          img.replaceWith(dom.window.document.createTextNode(img.getAttribute('alt') || ''));
        }
      });
      const figs = [];
      tw.querySelectorAll('.entity-image').forEach(span => {
        const img = span.querySelector('img');
        const src = img && (img.getAttribute('data-src') || img.getAttribute('src'));
        if (src && !src.endsWith('1px.png')) figs.push(`<figure><img src="${esc(src)}" alt=""></figure>`);
        span.remove();
      });
      const text = tw.textContent.replace(/\s+/g, ' ').trim();
      if (text) out.push(`<p>${esc(text)}</p>`);
      out.push(...figs);
    }
    return out.join('');
  } catch {
    return null;
  }
}

async function extractXThread(id, originalUrl) {
  const first = await fetchFxTweet(id);
  if (!first) {
    throw new Error('No se pudo leer el post de X (¿cuenta privada, post borrado o la API de FxTwitter caída?)');
  }

  // Subir por la cadena de auto-respuestas hasta la raíz del hilo
  const chain = [first];
  let current = first;
  while (
    current.replying_to_status &&
    current.replying_to &&
    current.replying_to.toLowerCase() === first.author.screen_name.toLowerCase() &&
    chain.length < 50
  ) {
    const parent = await fetchFxTweet(current.replying_to_status);
    if (!parent || parent.author.screen_name.toLowerCase() !== first.author.screen_name.toLowerCase()) break;
    chain.unshift(parent);
    current = parent;
  }
  const root = chain[0];

  // Mejor fuente para hilos: ThreadReaderApp (incluye lo que va DESPUÉS del post pegado)
  let content = await fetchThreadReader(root.id);
  let source = 'threadreader';
  if (!content) {
    content = chain.map(tweetBodyHTML).join('\n');
    source = 'fxtwitter';
  }

  const plain = content.replace(/<[^>]+>/g, ' ');
  const words = plain.split(/\s+/).filter(Boolean).length;
  const isThread = source === 'threadreader' || chain.length > 1;

  return {
    url: originalUrl,
    title: deriveTitle(root.text, root.author.name),
    byline: root.author.name,
    siteName: `X · @${root.author.screen_name}${isThread ? ' (hilo)' : ''}`,
    excerpt: '',
    leadImage: '',
    publishedTime: root.created_timestamp ? new Date(root.created_timestamp * 1000).toISOString() : '',
    lang: root.lang || '',
    minutes: Math.max(1, Math.round(words / 220)),
    words,
    content
  };
}

app.listen(PORT, async () => {
  console.log(`Quiosco funcionando en http://localhost:${PORT}`);
  for (const ip of lanAddresses()) {
    console.log(`  · desde el móvil (misma WiFi): http://${ip}:${PORT}/movil`);
  }
  try {
    tgState = JSON.parse(await fs.readFile(TG_FILE, 'utf8'));
    if (tgState && tgState.token) tgLoop();
  } catch { /* sin bandeja Telegram configurada */ }
});
