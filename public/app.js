// Editor de Quiosco: estado, autoguardado y previsualización

let mag = null;
let saveTimer = null;

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const SETTING_FIELDS = ['title', 'subtitle', 'issue', 'date', 'accent', 'font', 'columns', 'finish', 'coverImage'];

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

async function save() {
  try {
    const r = await fetch('/api/magazine', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(mag)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    status('Guardado ✓');
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
    // Paged.js tarda un poco en repintar; restauramos el scroll después
    setTimeout(() => { try { frame.contentWindow.scrollTo(0, scrollY); } catch { } }, 1200);
  }, { once: true });
  frame.contentWindow.location.reload();
}

/* ---------- Ajustes de la revista ---------- */

function bindSettings() {
  // Migración de valores antiguos de tipografía
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
      const r = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: urlInput.value.trim() })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Error desconocido');
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

/* ---------- Exportar PDF ---------- */

function bindExport() {
  const btn = $('#exportBtn');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Generando PDF…';
    status('Generando PDF (puede tardar un poco si hay muchas imágenes)…');
    try {
      const r = await fetch('/api/export-pdf', { method: 'POST' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Error desconocido');
      status(`PDF listo (${data.kb} KB) — guardado en quiosco\\exports`);
      const link = $('#exportLink');
      link.href = data.url;
      link.download = data.name;
      link.textContent = 'Descargar PDF';
      link.classList.remove('hidden');
      // Abrir el Explorador con el archivo seleccionado (la vía que nunca falla)
      fetch('/api/show-export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: data.name })
      }).catch(() => { });
    } catch (e) {
      status('Error al exportar: ' + e.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Exportar PDF';
    }
  });
}

/* ---------- Arranque ---------- */

async function init() {
  mag = await (await fetch('/api/magazine')).json();
  bindSettings();
  renderArticles();
  bindArticleList();
  bindAddForm();
  bindPreviewTools();
  bindExport();
  status('Listo');
}

init();
