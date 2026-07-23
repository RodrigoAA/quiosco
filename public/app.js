// Editor de Quiosco: estado, autoguardado y previsualización

let mag = null;
let saveTimer = null;

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const SETTING_FIELDS = ['title', 'subtitle', 'issue', 'date', 'accent', 'font', 'columns', 'finish', 'backstyle', 'coverImage'];

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
  if (!mag.settings.backstyle) mag.settings.backstyle = 'raya';

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
  const applyZoom = () => {
    frame.style.zoom = Number(zoom.value) / 100;
    syncPreviewState();
  };
  zoom.addEventListener('change', applyZoom);
  applyZoom();
  $('#refresh').addEventListener('click', reloadPreview);
}

/* ---------- Quitar imágenes con clic (en la previsualización) ---------- */

let imgEditOn = false;

function syncPreviewState() {
  try {
    $('#preview').contentWindow.postMessage({
      quiosco: 'view',
      imgEdit: imgEditOn,
      zoom: Number($('#zoom').value) / 100
    }, '*');
  } catch { /* iframe aún cargando */ }
}

function initImageRemoval() {
  const btn = $('#imgEditBtn');
  btn.addEventListener('click', () => {
    imgEditOn = !imgEditOn;
    btn.classList.toggle('active', imgEditOn);
    $('#imgEditHint').classList.toggle('hidden', !imgEditOn);
    syncPreviewState();
  });

  // El estado sobrevive a las recargas del iframe (cada guardado lo recarga)
  $('#preview').addEventListener('load', () => setTimeout(syncPreviewState, 500));

  window.addEventListener('message', ev => {
    const d = ev.data;
    if (!d || (d.quiosco !== 'remove-image' && d.quiosco !== 'remove-text')) return;
    const included = mag.articles.filter(a => a.included !== false);
    const article = included[d.art];
    if (!article) return;

    if (d.quiosco === 'remove-image') {
      if (d.isLead) {
        article.leadImage = '';
      } else {
        const doc = new DOMParser().parseFromString(article.content, 'text/html');
        const img = [...doc.images].find(i => i.getAttribute('src') === d.src);
        if (img) {
          // En galerías (un figure con varias imágenes) se quita solo la pulsada
          const fig = img.closest('figure');
          if (fig && fig.querySelectorAll('img').length === 1) fig.remove();
          else (img.closest('picture') || img).remove();
          article.content = doc.body.innerHTML;
        } else if (article.leadImage === d.src) {
          article.leadImage = '';
        } else {
          status('No se encontró esa imagen en el artículo', true);
          return;
        }
      }
      status(`Imagen quitada de «${article.title}» ✓`);
      scheduleSave();
      return;
    }

    // remove-text: quita los bloques cuyo texto coincida (el más pequeño que encaje)
    if (!Array.isArray(d.texts) || !d.texts.length) return;
    const doc = new DOMParser().parseFromString(article.content, 'text/html');
    const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
    let removed = 0;
    for (const t of d.texts) {
      const target = norm(t);
      if (target.length < 3) continue;
      const matches = [...doc.body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table, figcaption')]
        .filter(el => norm(el.textContent).includes(target));
      if (!matches.length) continue;
      matches.sort((a, b) => a.textContent.length - b.textContent.length);
      matches[0].remove();
      removed++;
    }
    doc.body.querySelectorAll('ul, ol').forEach(l => { if (!l.querySelector('li')) l.remove(); });
    if (removed) {
      article.content = doc.body.innerHTML;
      status(`${removed} bloque(s) de texto quitados de «${article.title}» ✓`);
      scheduleSave();
    } else {
      status('No se encontró ese texto en el artículo', true);
    }
  });
}

/* ---------- Paleta de la portada ---------- */

function setAccent(hex) {
  mag.settings.accent = hex;
  $('#s-accent').value = hex;
  scheduleSave();
}

// Carga la imagen apta para canvas: directa si el CDN da CORS; si no, proxy propio
function loadCoverBitmap(url) {
  const tryLoad = src => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
  return tryLoad(url).catch(() => tryLoad('/api/img?url=' + encodeURIComponent(url)));
}

// Colores dominantes: reduce a 64×64, cuantiza y puntúa por frecuencia y saturación
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

/* ---------- Números (issues) ---------- */

async function initIssues() {
  const issues = await (await fetch('/api/issues')).json();
  const sel = $('#issueSelect');
  sel.innerHTML = issues.map(i =>
    `<option value="${esc(i.id)}" ${i.current ? 'selected' : ''}>${esc([i.issue, i.title].filter(Boolean).join(' — '))} (${i.count})</option>`
  ).join('');

  sel.addEventListener('change', async () => {
    await fetch('/api/issues/select', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: sel.value })
    });
    location.reload();
  });

  $('#newIssue').addEventListener('click', async () => {
    const r = await fetch('/api/issues', { method: 'POST' });
    if (r.ok) location.reload();
    else status('Error al crear el número', true);
  });

  $('#delIssue').addEventListener('click', async () => {
    if (issues.length < 2) {
      status('No se puede eliminar el único número', true);
      return;
    }
    const current = issues.find(i => i.current);
    if (!confirm(`¿Eliminar «${[current.issue, current.title].filter(Boolean).join(' — ')}» y sus ${current.count} artículos? No se puede deshacer.`)) return;
    const r = await fetch(`/api/issues/${encodeURIComponent(current.id)}`, { method: 'DELETE' });
    if (r.ok) location.reload();
    else status('Error al eliminar: ' + ((await r.json()).error || ''), true);
  });
}

/* ---------- Bookmarklet ---------- */

function initBookmarklet() {
  // location.origin se fija ahora; location.href se evalúa en la página del artículo
  $('#bookmarklet').href =
    `javascript:void(window.open('${location.origin}/add?url='+encodeURIComponent(location.href),'quiosco','width=440,height=300'))`;
  $('#bookmarklet').addEventListener('click', ev => {
    ev.preventDefault();
    status('Arrástralo a la barra de marcadores (no hace nada aquí)', false);
  });
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
      status(`PDF listo (${data.kb} KB) — descargado; copia maestra en quiosco\\exports`);
      const link = $('#exportLink');
      link.href = data.url;
      link.download = data.name;
      link.textContent = 'Volver a descargar';
      link.classList.remove('hidden');
      link.click(); // descarga automática al terminar
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
  initBookmarklet();
  initImageRemoval();
  await initIssues();
  initPalette();
  status('Listo');
}

init();
