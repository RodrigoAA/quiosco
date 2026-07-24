// Editor de Quiosco: estado, autoguardado y previsualización

let mag = null;
let saveTimer = null;

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const SETTING_FIELDS = ['title', 'subtitle', 'issue', 'date', 'accent', 'font', 'columns', 'align', 'paragraphs', 'finish', 'backstyle', 'coverImage', 'fillerImage', 'fillerMosaic', 'exportMode'];

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
  if (!mag.settings.align) mag.settings.align = 'justificado';
  if (!mag.settings.paragraphs) mag.settings.paragraphs = 'sangria';

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
      <span class="art-grip" title="Arrastra para reordenar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg></span>
      <input type="checkbox" data-action="include" title="Incluir en la revista" ${included ? 'checked' : ''}>
      <div class="art-info">
        <span class="art-title">${esc(a.title)}</span>
        <span class="art-meta">${esc([a.siteName, a.minutes ? a.minutes + ' min' : ''].filter(Boolean).join(' · '))}</span>
      </div>
      <div class="art-btns">
        <button data-action="edit" title="Editar">✎</button>
        <button data-action="del" class="danger" title="Eliminar">✕</button>
      </div>
    </div>
    <div class="art-edit hidden">
      <label>Título <input data-field="title" value="${esc(a.title)}"></label>
      <label>Autor <input data-field="byline" value="${esc(a.byline || '')}"></label>
      <div class="row2">
        <label>Columnas
          <select data-field="cols">
            <option value="" ${!a.cols ? 'selected' : ''}>Como la revista</option>
            <option value="1" ${a.cols === '1' ? 'selected' : ''}>1</option>
            <option value="2" ${a.cols === '2' ? 'selected' : ''}>2</option>
            <option value="3" ${a.cols === '3' ? 'selected' : ''}>3</option>
            <option value="4" ${a.cols === '4' ? 'selected' : ''}>4</option>
          </select>
        </label>
        <label>Alineación
          <select data-field="align">
            <option value="" ${!a.align ? 'selected' : ''}>Como la revista</option>
            <option value="justificado" ${a.align === 'justificado' ? 'selected' : ''}>Justificado</option>
            <option value="izquierda" ${a.align === 'izquierda' ? 'selected' : ''}>Izquierda</option>
          </select>
        </label>
      </div>
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

    if (action === 'edit') {
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

  // Reordenar arrastrando desde el asa (⠿). El <li> solo es arrastrable
  // mientras el gesto empiece en el asa, para no romper inputs y selección.
  let dragging = null;
  list.addEventListener('mousedown', ev => {
    const grip = ev.target.closest('.art-grip');
    if (grip) grip.closest('li.art').draggable = true;
  });
  list.addEventListener('dragstart', ev => {
    const li = ev.target.closest('li.art');
    if (!li || !li.draggable) { ev.preventDefault(); return; }
    dragging = li;
    li.classList.add('dragging');
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', li.dataset.id);
  });
  list.addEventListener('dragover', ev => {
    if (!dragging) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    const li = ev.target.closest('li.art');
    if (!li || li === dragging) return;
    const r = li.getBoundingClientRect();
    const before = ev.clientY < r.top + r.height / 2;
    list.insertBefore(dragging, before ? li : li.nextSibling);
  });
  list.addEventListener('drop', ev => ev.preventDefault());
  list.addEventListener('dragend', () => {
    if (!dragging) return;
    dragging.classList.remove('dragging');
    dragging.draggable = false;
    dragging = null;
    const order = [...list.querySelectorAll('li.art')].map(li => li.dataset.id);
    mag.articles.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
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

/* ---------- Suscripciones (RSS) ---------- */

async function addArticleByUrl(url) {
  const r = await fetch('/api/extract', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Error desconocido');
  mag.articles.push({ id: crypto.randomUUID(), included: true, ...data });
  renderArticles();
  scheduleSave();
  return data;
}

async function loadFeedsUI() {
  try {
    const d = await (await fetch('/api/feeds')).json();
    $('#feedChips').innerHTML = d.feeds.map(f =>
      `<span class="chip" data-url="${esc(f.url)}">${esc(f.title)}<button class="chip-x" type="button" title="Dejar de seguir">×</button></span>`
    ).join('');
  } catch { /* servidor no disponible */ }
}

async function loadNews() {
  const list = $('#newsList');
  list.innerHTML = '<li class="tip" style="margin: 6px 0">Buscando novedades…</li>';
  try {
    const d = await (await fetch('/api/news')).json();
    if (!d.items.length) {
      list.innerHTML = '<li class="tip" style="margin: 6px 0">Nada nuevo por aquí. Sigue algún feed arriba.</li>';
      return;
    }
    list.innerHTML = d.items.map(it => {
      let origin = '';
      try { origin = new URL(it.link).origin; } catch { /* enlace raro */ }
      return `<li class="news-item" data-url="${esc(it.link)}">
      <div class="news-info">
        <span class="news-src">${origin
          ? `<a href="${esc(origin)}" target="_blank" rel="noopener" title="Abrir la publicación">${esc(it.source)}</a>`
          : esc(it.source)}${it.date ? ' · ' + new Date(it.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : ''}</span>
        <span class="news-title"><a href="${esc(it.link)}" target="_blank" rel="noopener" title="Leer en la web">${esc(it.title)}</a></span>
      </div>
      ${it.added
        ? '<span class="news-added" title="Ya está en la revista">✓</span>'
        : '<button class="btn news-add" type="button" title="Añadir al número actual">＋</button>'}
      <button class="news-dismiss" type="button" title="Descartar (no volverá a aparecer)">×</button>
    </li>`;
    }).join('');
  } catch {
    list.innerHTML = '';
  }
}

function bindFeeds() {
  $('#feedForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const errEl = $('#feedError');
    errEl.classList.add('hidden');
    const value = $('#feedUrl').value.trim();
    if (!value) return;
    const btn = $('#feedForm button');
    btn.disabled = true;
    try {
      const r = await fetch('/api/feeds', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: value })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Error');
      $('#feedUrl').value = '';
      await loadFeedsUI();
      loadNews();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  });

  $('#feedChips').addEventListener('click', async ev => {
    const x = ev.target.closest('.chip-x');
    if (!x) return;
    await fetch('/api/feeds/remove', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: x.closest('.chip').dataset.url })
    });
    await loadFeedsUI();
    loadNews();
  });

  $('#newsList').addEventListener('click', async ev => {
    const dis = ev.target.closest('.news-dismiss');
    if (dis) {
      const li = dis.closest('.news-item');
      li.remove();
      fetch('/api/news/dismiss', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: li.dataset.url })
      }).catch(() => { });
      return;
    }
    const btn = ev.target.closest('.news-add');
    if (!btn) return;
    const li = btn.closest('.news-item');
    btn.disabled = true;
    btn.textContent = '…';
    try {
      const art = await addArticleByUrl(li.dataset.url);
      btn.outerHTML = '<span class="news-added" title="Ya está en la revista">✓</span>';
      status(`«${art.title}» añadido ✓`);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '＋';
      status('Error al añadir: ' + e.message, true);
    }
  });

  $('#newsRefresh').addEventListener('click', loadNews);

  // Importar todas las suscripciones de Substack (JSON pegado)
  $('#ssImportToggle').addEventListener('click', ev => {
    ev.preventDefault();
    $('#ssImport').classList.toggle('hidden');
  });
  $('#ssImportBtn').addEventListener('click', async () => {
    const json = $('#ssJson').value.trim();
    if (!json) return;
    const btn = $('#ssImportBtn');
    btn.disabled = true;
    btn.textContent = 'Importando…';
    try {
      const r = await fetch('/api/feeds/import-substack', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ json })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Error');
      status(`${data.added} fuente(s) importadas`
        + (data.skipped ? `, ${data.skipped} ya seguidas` : '')
        + (data.failed.length ? ` · sin feed: ${data.failed.join(', ')}` : ''));
      $('#ssJson').value = '';
      $('#ssImport').classList.add('hidden');
      await loadFeedsUI();
      loadNews();
    } catch (e) {
      status('Importación: ' + e.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Importar';
    }
  });

  loadFeedsUI();
  loadNews();
}

/* ---------- Bandeja del móvil (bot de Telegram) ---------- */

async function bindTelegram() {
  const stEl = $('#tgStatus');
  const refresh = async () => {
    try {
      const s = await (await fetch('/api/telegram')).json();
      if (s.configured) {
        stEl.textContent = `Conectado a @${s.username} — comparte enlaces al bot desde X o Gmail`
          + ` (${s.added} añadidos)`
          + (s.bound ? '' : '. Escríbele un primer mensaje para vincularlo.');
        $('#tgForm').classList.add('hidden');
      } else {
        const info = await (await fetch('/api/info')).json().catch(() => null);
        const lan = info && info.lan && info.lan.length ? ` En la misma WiFi también: ${info.lan[0]}` : '';
        stEl.textContent = 'Crea un bot en Telegram (@BotFather → /newbot) y pega su token: '
          + 'podrás compartirle artículos desde el móvil.' + lan;
      }
    } catch { /* servidor no disponible */ }
  };

  $('#tgSave').addEventListener('click', async () => {
    const token = $('#tgToken').value.trim();
    if (!token) return;
    const r = await fetch('/api/telegram', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await r.json();
    if (!r.ok) {
      status('Telegram: ' + (data.error || 'error'), true);
      return;
    }
    status(`Bot @${data.username} conectado ✓ — mándale un primer mensaje desde tu Telegram`);
    $('#tgToken').value = '';
    refresh();
  });

  refresh();
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

// Estados del recorte: ✂ entra (en rojo, salir cancelando) · al marcar
// aparecen ✓ aplicar y ✕ cancelar · ↩ deshace lo ya aplicado
function setTrimMode(on) {
  imgEditOn = on;
  $('#imgEditBtn').classList.toggle('active', on);
  $('#trimCancelBtn').classList.toggle('hidden', !on);
  const info = $('#trimInfo');
  if (on) {
    info.textContent = 'marca imágenes o selecciona texto';
    info.classList.remove('hidden');
  } else {
    info.classList.add('hidden');
    $('#applyBtn').classList.add('hidden');
  }
  syncPreviewState();
}

function postToPreview(msg) {
  try {
    $('#preview').contentWindow.postMessage(msg, '*');
  } catch { /* iframe cargando */ }
}

function initImageRemoval() {
  $('#imgEditBtn').addEventListener('click', () => {
    if (!imgEditOn) {
      setTrimMode(true);
      return;
    }
    postToPreview({ quiosco: 'clear-trims' });
    setTrimMode(false);
  });

  $('#applyBtn').addEventListener('click', () => {
    postToPreview({ quiosco: 'apply-now' });
    setTrimMode(false);
  });

  $('#trimCancelBtn').addEventListener('click', () => {
    postToPreview({ quiosco: 'clear-trims' });
    setTrimMode(false);
  });

  // El estado sobrevive a las recargas del iframe (cada guardado lo recarga)
  $('#preview').addEventListener('load', () => setTimeout(syncPreviewState, 500));

  window.addEventListener('message', ev => {
    const d = ev.data;
    if (!d) return;

    if (d.quiosco === 'trim-count') {
      if (imgEditOn) {
        $('#trimInfo').textContent = d.n ? `${d.n} marcado(s)` : 'marca imágenes o selecciona texto';
      }
      $('#applyBtn').classList.toggle('hidden', !d.n || !imgEditOn);
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

let paletteReq = 0;
async function renderPalette() {
  const req = ++paletteReq;
  const coverUrl = mag.settings.coverImage || mag.articles.map(a => a.leadImage).find(Boolean);
  if (!coverUrl) {
    $('#swatches').innerHTML = '';
    return;
  }
  try {
    const img = await loadCoverBitmap(coverUrl);
    if (req !== paletteReq) return; // la portada volvió a cambiar mientras cargaba
    const palette = extractPalette(img);
    $('#swatches').innerHTML = palette.map(h =>
      `<button class="swatch" type="button" style="background:${h}" title="${h}" data-hex="${h}"></button>`).join('');
  } catch {
    if (req === paletteReq) $('#swatches').innerHTML = ''; // imagen inaccesible: queda solo el cuentagotas
  }
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

  $('#swatches').addEventListener('click', ev => {
    const b = ev.target.closest('.swatch');
    if (b) setAccent(b.dataset.hex);
  });

  // Al cambiar la imagen de portada, la paleta se recalcula sola
  let coverTimer = null;
  $('#s-coverImage').addEventListener('input', () => {
    clearTimeout(coverTimer);
    coverTimer = setTimeout(renderPalette, 600);
  });

  await renderPalette();
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

/* ---------- Exportar PDF ---------- */

function bindExport() {
  const btn = $('#exportBtn');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const dos = mag.settings.exportMode === 'dos';
    status(`Generando ${dos ? 'cubierta e interior' : 'PDF'} (puede tardar un poco si hay muchas imágenes)…`);
    try {
      const r = await fetch('/api/export-pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: dos ? 'dos' : 'uno' })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Error desconocido');
      for (const f of data.files || [data]) {
        const a = document.createElement('a');
        a.href = f.url;
        a.download = f.name;
        a.click(); // descarga automática al terminar
        await new Promise(res => setTimeout(res, 600)); // que el navegador no pise una descarga con otra
      }
      const total = (data.files || [data]).reduce((n, f) => n + f.kb, 0);
      status(`${(data.files || [data]).length > 1 ? 'PDFs descargados' : 'PDF descargado'} (${total} KB) — copia maestra en quiosco\\exports`);
    } catch (e) {
      status('Error al generar el PDF: ' + e.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  // Imprimir la previsualización (el iframe ya tiene la maqueta lista)
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

/* ---------- Paneles plegables con memoria ---------- */

function bindPanels() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem('quiosco-panels')) || {};
  } catch { /* primera vez */ }
  document.querySelectorAll('details.panel').forEach(p => {
    if (p.id && p.id in saved) p.open = saved[p.id];
    p.addEventListener('toggle', () => {
      saved[p.id] = p.open;
      localStorage.setItem('quiosco-panels', JSON.stringify(saved));
    });
  });
}

/* ---------- Arranque ---------- */

async function init() {
  mag = await (await fetch('/api/magazine')).json();
  bindPanels();
  bindSettings();
  renderArticles();
  bindArticleList();
  bindAddForm();
  bindPreviewTools();
  bindExport();
  bindFocusMode();
  bindTopNav();
  initImageRemoval();
  bindFeeds();
  bindTelegram();
  await initIssues();
  initPalette();
}

init();
