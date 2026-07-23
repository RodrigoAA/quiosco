// Editor de Quiosco (versión web): estado en localStorage, extracción en el navegador

const STORE_KEY = 'quiosco-magazine';
const DEFAULT_MAGAZINE = {
  settings: {
    title: 'Mi Revista',
    subtitle: 'Selección de lecturas',
    issue: 'Nº 1',
    date: '',
    accent: '#b3402a',
    font: 'clasica',
    columns: '2',
    finish: 'caballete',
    coverImage: ''
  },
  articles: []
};

let mag = null;
let saveTimer = null;

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const SETTING_FIELDS = ['title', 'subtitle', 'issue', 'date', 'accent', 'font', 'columns', 'align', 'finish', 'backstyle', 'coverImage'];

function loadMag() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORE_KEY));
    if (stored && stored.settings && Array.isArray(stored.articles)) return stored;
  } catch { /* corrupto: se parte de cero */ }
  return structuredClone(DEFAULT_MAGAZINE);
}

function status(msg, isError = false) {
  const el = $('#status');
  el.textContent = msg;
  el.classList.toggle('error', isError);
}

/* ---------- Guardado ---------- */

function scheduleSave() {
  status('Guardando…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 700);
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(mag));
    status('Guardado ✓ (en este navegador)');
    reloadPreview();
  } catch (e) {
    status('Error al guardar: ' + e.message, true);
  }
}

function reloadPreview() {
  const frame = $('#preview');
  let scrollY = 0;
  try { scrollY = frame.contentWindow.scrollY || 0; } catch { /* aún no cargado */ }
  frame.addEventListener('load', () => {
    setTimeout(() => { try { frame.contentWindow.scrollTo(0, scrollY); } catch { } }, 1200);
  }, { once: true });
  frame.contentWindow.location.reload();
}

/* ---------- Ajustes de la revista ---------- */

function bindSettings() {
  if (mag.settings.font === 'serif' || !mag.settings.font) mag.settings.font = 'clasica';
  if (mag.settings.font === 'sans') mag.settings.font = 'moderna';
  if (!mag.settings.columns) mag.settings.columns = '2';
  if (!mag.settings.finish) mag.settings.finish = 'caballete';
  if (!mag.settings.backstyle) mag.settings.backstyle = 'raya';
  if (!mag.settings.align) mag.settings.align = 'justificado';

  for (const f of SETTING_FIELDS) {
    const input = $('#s-' + f);
    input.value = mag.settings[f] ?? '';
    input.addEventListener('input', () => {
      mag.settings[f] = input.value;
      scheduleSave();
    });
  }
}

/* ---------- Lista de artículos ---------- */

function articleItem(a) {
  const included = a.included !== false;
  return `<li class="art ${included ? '' : 'off'}" data-id="${esc(a.id)}">
    <div class="art-row">
      <input type="checkbox" data-action="include" title="Incluir en la revista" ${included ? 'checked' : ''}>
      <div class="art-info">
        <span class="art-title">${esc(a.title)}</span>
        <span class="art-meta">${esc([a.siteName, a.minutes ? a.minutes + ' min' : ''].filter(Boolean).join(' · '))}</span>
      </div>
      <div class="art-btns">
        <button data-action="up" title="Subir">↑</button>
        <button data-action="down" title="Bajar">↓</button>
        <button data-action="edit" title="Editar">✎</button>
        <button data-action="del" class="danger" title="Eliminar">✕</button>
      </div>
    </div>
    <div class="art-edit hidden">
      <label>Título <input data-field="title" value="${esc(a.title)}"></label>
      <label>Autor <input data-field="byline" value="${esc(a.byline || '')}"></label>
      <label>Columnas de este artículo
        <select data-field="cols">
          <option value="" ${!a.cols ? 'selected' : ''}>Como la revista</option>
          <option value="2" ${a.cols === '2' ? 'selected' : ''}>2</option>
          <option value="3" ${a.cols === '3' ? 'selected' : ''}>3</option>
          <option value="4" ${a.cols === '4' ? 'selected' : ''}>4</option>
        </select>
      </label>
      <label>Entradilla <textarea data-field="excerpt" rows="3">${esc(a.excerpt || '')}</textarea></label>
      <label>Imagen destacada (URL) <input data-field="leadImage" value="${esc(a.leadImage || '')}"></label>
      <a href="${esc(a.url)}" target="_blank">Ver original ↗</a>
    </div>
  </li>`;
}

function renderArticles() {
  $('#articleList').innerHTML = mag.articles.map(articleItem).join('');
}

function findArticle(node) {
  const li = node.closest('li.art');
  const idx = mag.articles.findIndex(a => a.id === li.dataset.id);
  return { li, idx };
}

function bindArticleList() {
  const list = $('#articleList');

  list.addEventListener('click', ev => {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const { li, idx } = findArticle(btn);
    if (idx < 0) return;
    const action = btn.dataset.action;

    if (action === 'up' || action === 'down') {
      const j = action === 'up' ? idx - 1 : idx + 1;
      if (j < 0 || j >= mag.articles.length) return;
      [mag.articles[idx], mag.articles[j]] = [mag.articles[j], mag.articles[idx]];
      renderArticles();
      scheduleSave();
    } else if (action === 'edit') {
      li.querySelector('.art-edit').classList.toggle('hidden');
    } else if (action === 'del') {
      if (!confirm(`¿Eliminar «${mag.articles[idx].title}» de la revista?`)) return;
      mag.articles.splice(idx, 1);
      renderArticles();
      scheduleSave();
    }
  });

  list.addEventListener('change', ev => {
    if (ev.target.dataset.action !== 'include') return;
    const { li, idx } = findArticle(ev.target);
    if (idx < 0) return;
    mag.articles[idx].included = ev.target.checked;
    li.classList.toggle('off', !ev.target.checked);
    scheduleSave();
  });

  list.addEventListener('input', ev => {
    const field = ev.target.dataset.field;
    if (!field) return;
    const { li, idx } = findArticle(ev.target);
    if (idx < 0) return;
    mag.articles[idx][field] = ev.target.value;
    if (field === 'title') li.querySelector('.art-title').textContent = ev.target.value;
    scheduleSave();
  });
}

/* ---------- Añadir artículo ---------- */

function bindAddForm() {
  const form = $('#addForm');
  const urlInput = $('#addUrl');
  const btn = $('#addBtn');
  const errEl = $('#addError');

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    errEl.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Extrayendo…';
    try {
      const data = await window.extractFromUrl(urlInput.value.trim());
      mag.articles.push({ id: crypto.randomUUID(), included: true, ...data });
      renderArticles();
      urlInput.value = '';
      scheduleSave();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Añadir';
    }
  });
}

/* ---------- Previsualización ---------- */

function bindPreviewTools() {
  applyZoom();
}

/* ---------- Quitar imágenes con clic (en la previsualización) ---------- */

// Borra un FRAGMENTO de texto (parte de un párrafo) del contenido fuente:
// localiza el fragmento por texto normalizado y lo elimina con un Range.
function deletePartFromDoc(doc, it) {
  const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const target = norm(it.part || '');
  if (target.length < 3) return false;

  const blocks = [...doc.body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figcaption')]
    .filter(el => norm(el.textContent).includes(target));
  if (!blocks.length) return false;
  blocks.sort((a, b) => a.textContent.length - b.textContent.length);
  const block = blocks[0];

  // Mapa: texto normalizado → (nodo de texto, offset)
  const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let normStr = '';
  const map = [];
  let prevSpace = true;
  let node;
  while ((node = walker.nextNode())) {
    const t = node.nodeValue;
    for (let i = 0; i < t.length; i++) {
      if (/\s/.test(t[i])) {
        if (!prevSpace) {
          normStr += ' ';
          map.push({ node, offset: i });
          prevSpace = true;
        }
      } else {
        normStr += t[i].toLowerCase();
        map.push({ node, offset: i });
        prevSpace = false;
      }
    }
  }
  const idx = normStr.indexOf(target);
  if (idx < 0) return false;
  const startPos = map[idx];
  const endPos = map[idx + target.length - 1];
  const range = doc.createRange();
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset + 1);
  range.deleteContents();
  if (!block.textContent.trim()) block.remove();
  return true;
}

let imgEditOn = false;
const undoStack = [];

function pushUndo(article) {
  undoStack.push({ id: article.id, content: article.content, leadImage: article.leadImage });
  if (undoStack.length > 30) undoStack.shift();
  $('#undoBtn').classList.remove('hidden');
}

let focusOn = false;
let zoomLevel = 65;
let zoomBeforeFocus = 65;

function syncPreviewState() {
  try {
    $('#preview').contentWindow.postMessage({
      quiosco: 'view',
      imgEdit: imgEditOn,
      focus: focusOn,
      zoom: zoomLevel / 100
    }, '*');
  } catch { /* iframe aún cargando */ }
}

function applyZoom() {
  $('#preview').style.zoom = zoomLevel / 100;
  $('#zoomVal').textContent = `${zoomLevel} %`;
  syncPreviewState();
}

function changeZoom(delta) {
  zoomLevel = Math.min(150, Math.max(40, zoomLevel + delta));
  applyZoom();
}

/* Navegación de páginas: el iframe informa (pages/page-current), el topbar manda (goto) */
function bindTopNav() {
  const input = $('#pageInput');
  const goTo = () => {
    try {
      $('#preview').contentWindow.postMessage({ quiosco: 'goto', page: parseInt(input.value, 10) || 1 }, '*');
    } catch { /* iframe cargando */ }
  };
  input.addEventListener('change', goTo);
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      goTo();
      input.blur();
    }
  });
  $('#zoomOut').addEventListener('click', () => changeZoom(-10));
  $('#zoomIn').addEventListener('click', () => changeZoom(10));

  window.addEventListener('message', ev => {
    const d = ev.data;
    if (!d) return;
    if (d.quiosco === 'pages') {
      $('#pageTotal').textContent = `de ${d.total}`;
      input.max = d.total;
      if (parseInt(input.value, 10) > d.total) input.value = 1;
      $('#navBox').classList.remove('hidden');
      if (d.note) status(d.note);
    }
    if (d.quiosco === 'page-current' && document.activeElement !== input) {
      input.value = d.current;
    }
  });
}

function initImageRemoval() {
  const btn = $('#imgEditBtn');
  btn.addEventListener('click', () => {
    imgEditOn = !imgEditOn;
    btn.classList.toggle('active', imgEditOn);
    syncPreviewState();
  });

  $('#trimCancelBtn').addEventListener('click', () => {
    try {
      $('#preview').contentWindow.postMessage({ quiosco: 'clear-trims' }, '*');
    } catch { /* iframe cargando */ }
  });

  $('#preview').addEventListener('load', () => setTimeout(syncPreviewState, 500));

  window.addEventListener('message', ev => {
    const d = ev.data;
    if (!d) return;

    if (d.quiosco === 'trim-count') {
      status(d.n ? `${d.n} recorte(s) marcados — pulsa ✂ otra vez para aplicarlos` : '');
      $('#trimCancelBtn').classList.toggle('hidden', !d.n);
      return;
    }
    if (d.quiosco !== 'apply-trims' || !Array.isArray(d.items) || !d.items.length) return;

    const included = mag.articles.filter(a => a.included !== false);
    const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const groups = new Map();
    for (const it of d.items) {
      const article = included[it.art];
      if (!article) continue;
      if (!groups.has(article)) groups.set(article, []);
      groups.get(article).push(it);
    }

    let applied = 0;
    for (const [article, items] of groups) {
      pushUndo(article);
      let appliedHere = 0;
      const doc = new DOMParser().parseFromString(article.content, 'text/html');
      for (const it of items) {
        if (it.type === 'img') {
          if (it.isLead) {
            article.leadImage = '';
            appliedHere++;
            continue;
          }
          // Con imágenes duplicadas se borra exactamente la copia marcada (nth)
          const twins = [...doc.images].filter(i => i.getAttribute('src') === it.src);
          const img = twins[it.nth] || twins[0];
          if (!img) {
            if (article.leadImage === it.src) {
              article.leadImage = '';
              appliedHere++;
            }
            continue;
          }
          const fig = img.closest('figure');
          if (fig && fig.querySelectorAll('img').length === 1) fig.remove();
          else (img.closest('picture') || img).remove();
          appliedHere++;
        } else if (it.type === 'textpart') {
          if (deletePartFromDoc(doc, it)) appliedHere++;
        } else if (it.type === 'text') {
          const target = norm(it.text || '');
          if (target.length < 3) continue;
          const matches = [...doc.body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table, figcaption')]
            .filter(el => norm(el.textContent).includes(target));
          if (!matches.length) continue;
          matches.sort((a, b) => a.textContent.length - b.textContent.length);
          matches[0].remove();
          appliedHere++;
        }
      }
      if (appliedHere) {
        doc.body.querySelectorAll('ul, ol').forEach(l => { if (!l.querySelector('li')) l.remove(); });
        article.content = doc.body.innerHTML;
        applied += appliedHere;
      } else {
        undoStack.pop();
        if (!undoStack.length) $('#undoBtn').classList.add('hidden');
      }
    }

    if (applied) {
      status(`${applied} recorte(s) aplicados ✓ — ↩ Deshacer si hace falta`);
      scheduleSave();
    } else {
      status('No se pudo aplicar ningún recorte', true);
    }
  });

  $('#undoBtn').addEventListener('click', () => {
    const snap = undoStack.pop();
    if (!snap) return;
    const article = mag.articles.find(a => a.id === snap.id);
    if (article) {
      article.content = snap.content;
      article.leadImage = snap.leadImage;
      status(`Recorte deshecho en «${article.title}» ✓`);
      scheduleSave();
    }
    if (!undoStack.length) $('#undoBtn').classList.add('hidden');
  });
}

/* ---------- Paleta de la portada ---------- */

function setAccent(hex) {
  mag.settings.accent = hex;
  $('#s-accent').value = hex;
  scheduleSave();
}

// En la versión web no hay servidor propio: directa o vía proxy CORS público
function loadCoverBitmap(url) {
  const tryLoad = src => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
  return tryLoad(url).catch(() =>
    tryLoad('https://api.allorigins.win/raw?url=' + encodeURIComponent(url)));
}

function extractPalette(img, n = 5) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;

  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const key = `${data[i] >> 4}_${data[i + 1] >> 4}_${data[i + 2] >> 4}`;
    const e = buckets.get(key) || { r: 0, g: 0, b: 0, count: 0 };
    e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2]; e.count++;
    buckets.set(key, e);
  }

  const candidates = [...buckets.values()].map(e => {
    const r = e.r / e.count, g = e.g / e.count, b = e.b / e.count;
    const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
    const l = (max + min) / 2;
    const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
    return { r, g, b, count: e.count, sat, l };
  })
    .filter(x => x.l > 0.12 && x.l < 0.75)
    .map(x => ({ ...x, score: x.count * (0.15 + x.sat) }))
    .sort((a, b) => b.score - a.score);

  const picked = [];
  for (const x of candidates) {
    if (picked.every(p => Math.hypot(p.r - x.r, p.g - x.g, p.b - x.b) > 48)) picked.push(x);
    if (picked.length >= n) break;
  }
  const hex = v => Math.round(v).toString(16).padStart(2, '0');
  return picked.map(x => `#${hex(x.r)}${hex(x.g)}${hex(x.b)}`);
}

async function initPalette() {
  const dropBtn = $('#eyedropper');
  if ('EyeDropper' in window) {
    dropBtn.addEventListener('click', async () => {
      try {
        const r = await new EyeDropper().open();
        setAccent(r.sRGBHex);
      } catch { /* cancelado con Esc */ }
    });
  } else {
    dropBtn.classList.add('hidden');
  }

  const coverUrl = mag.settings.coverImage || mag.articles.map(a => a.leadImage).find(Boolean);
  if (coverUrl) {
    try {
      const img = await loadCoverBitmap(coverUrl);
      const palette = extractPalette(img);
      $('#swatches').innerHTML = palette.map(h =>
        `<button class="swatch" type="button" style="background:${h}" title="${h}" data-hex="${h}"></button>`).join('');
      $('#swatches').addEventListener('click', ev => {
        const b = ev.target.closest('.swatch');
        if (b) setAccent(b.dataset.hex);
      });
    } catch { /* imagen inaccesible: queda solo el cuentagotas */ }
  }
  $('#paletteRow').classList.remove('hidden');
}

/* ---------- Vista completa (misma pestaña, sin panel lateral) ---------- */

function setFocusMode(on) {
  focusOn = on;
  document.body.classList.toggle('focus', on);
  if (on) {
    zoomBeforeFocus = zoomLevel;
    zoomLevel = 100;
  } else {
    zoomLevel = zoomBeforeFocus;
  }
  applyZoom();
}

function bindFocusMode() {
  $('#focusBtn').addEventListener('click', () => setFocusMode(true));
  $('#focusExit').addEventListener('click', () => setFocusMode(false));
  window.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && focusOn) setFocusMode(false);
  });
  // Mensajes desde el iframe: salir de vista completa y zoom −/+
  window.addEventListener('message', ev => {
    const d = ev.data;
    if (!d) return;
    if (d.quiosco === 'exit-focus' && focusOn) setFocusMode(false);
    if (d.quiosco === 'zoom-delta') changeZoom(Number(d.delta) || 0);
  });
}

/* ---------- Imprimir la previsualización ---------- */

function bindPrint() {
  $('#printBtn').addEventListener('click', () => {
    const w = $('#preview').contentWindow;
    if (!w || !w.__pagedStatus || w.__pagedStatus.done !== true) {
      status('Espera a que la previsualización termine de maquetar', true);
      return;
    }
    w.focus();
    w.print();
  });
}

/* ---------- Importar / exportar JSON ---------- */

function bindJsonTools() {
  $('#exportJson').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(mag, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'magazine.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const fileInput = $('#importFile');
  $('#importJson').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !data.settings || !Array.isArray(data.articles)) {
        throw new Error('El fichero no tiene el formato de una revista de Quiosco');
      }
      if (!confirm(`Importar «${data.settings.title || 'sin título'}» con ${data.articles.length} artículos ` +
        'reemplazará la revista actual de este navegador. ¿Seguir?')) return;
      mag = data;
      bindArticlesAfterImport();
      scheduleSave();
    } catch (e) {
      status('Error al importar: ' + e.message, true);
    } finally {
      fileInput.value = '';
    }
  });
}

function bindArticlesAfterImport() {
  for (const f of SETTING_FIELDS) $('#s-' + f).value = mag.settings[f] ?? '';
  renderArticles();
}

/* ---------- Arranque ---------- */

function init() {
  mag = loadMag();
  bindSettings();
  renderArticles();
  bindArticleList();
  bindAddForm();
  bindPreviewTools();
  bindJsonTools();
  bindPrint();
  bindFocusMode();
  bindTopNav();
  initImageRemoval();
  initPalette();
}

init();
