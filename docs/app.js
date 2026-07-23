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

const SETTING_FIELDS = ['title', 'subtitle', 'issue', 'date', 'accent', 'font', 'columns', 'finish', 'coverImage'];

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
  const frame = $('#preview');
  const zoom = $('#zoom');
  const applyZoom = () => { frame.style.zoom = Number(zoom.value) / 100; };
  zoom.addEventListener('change', applyZoom);
  applyZoom();
  $('#refresh').addEventListener('click', reloadPreview);
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
  status('Listo');
}

init();
