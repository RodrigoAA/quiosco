// Compone la revista a partir de /api/magazine y la pagina en A4 con Paged.js

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function hostFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Evita repetir la imagen destacada si ya aparece al principio del contenido
function contentStartsWithImage(html) {
  const head = html.slice(0, 600).replace(/\s+/g, ' ');
  return /^(\s*<(figure|p|div)[^>]*>)*\s*<img/i.test(head) || /<img[^>]*>/i.test(head.slice(0, 300));
}

function coverHTML(s, arts) {
  const img = s.coverImage || arts.map(a => a.leadImage).find(Boolean) || '';
  const date = s.date || new Date().toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  return `<section class="cover ${img ? '' : 'no-image'}">
    <header>
      <h1 class="mag-name">${esc(s.title)}</h1>
      <p class="issue-line">
        <span>${esc(s.issue)}</span>
        ${s.subtitle ? `<span>${esc(s.subtitle)}</span>` : ''}
        <span>${esc(date)}</span>
      </p>
    </header>
    ${img ? `<div class="cover-image"><img src="${esc(img)}" alt=""></div>` : ''}
    <ul class="cover-headlines">
      ${arts.slice(0, 4).map(a => `<li>
        <span class="ch-kicker">${esc(a.siteName || hostFromUrl(a.url))}</span>${esc(a.title)}
      </li>`).join('')}
    </ul>
  </section>`;
}

function backcoverHTML(s, arts, backstyle) {
  const date = s.date || new Date().toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  const sources = [...new Set(arts.map(a => a.siteName || hostFromUrl(a.url)).filter(Boolean))];
  return `<section class="backcover${backstyle === 'area' ? ' area' : ''}">
    <p class="bc-ghost">${esc(s.issue || '')}</p>
    <div class="bc-rule"></div>
    <p class="bc-name">${esc(s.title)}</p>
    <p class="bc-issue">${esc([s.issue, date].filter(Boolean).join(' · '))}</p>
    <p class="bc-colophon">${esc(s.subtitle || 'Selección personal de lecturas')}.
    Fuentes de este número: ${sources.map(esc).join(' · ')}.</p>
  </section>`;
}

function tocHTML(arts) {
  return `<section class="toc">
    <h2>Índice</h2>
    <ol>
      ${arts.map((a, i) => `<li class="toc-entry">
        <div class="toc-line">
          <span class="toc-title">${esc(a.title)}</span>
          <span class="toc-dots"></span>
          <a class="toc-page" href="#art-${i}"></a>
        </div>
        <div class="toc-meta">${esc([a.siteName || hostFromUrl(a.url), a.byline, a.minutes ? `${a.minutes} min` : '']
          .filter(Boolean).join(' · '))}</div>
      </li>`).join('')}
    </ol>
  </section>`;
}

function articleHTML(a, i, globalCols) {
  const metaLine = [a.byline ? `Por ${a.byline}` : '', formatDate(a.publishedTime), a.minutes ? `${a.minutes} min de lectura` : '']
    .filter(Boolean).join('  ·  ');
  const lead = a.leadImage && !contentStartsWithImage(a.content)
    ? `<figure class="lead"><img src="${esc(a.leadImage)}" alt=""></figure>` : '';
  const cols = Math.min(4, Math.max(1, parseInt(a.cols, 10) || globalCols));
  const alignCls = a.align === 'izquierda' || a.align === 'justificado' ? ` align-${a.align}` : '';
  return `<section class="article cols-${cols}${alignCls}" id="art-${i}" data-art="${i}"${a.lang ? ` lang="${esc(a.lang)}"` : ''}>
    <header class="article-header">
      <p class="kicker">${esc(a.siteName || hostFromUrl(a.url))}</p>
      <h1 class="article-title">${esc(a.title)}</h1>
      ${a.excerpt ? `<p class="standfirst">${esc(a.excerpt)}</p>` : ''}
      ${metaLine ? `<p class="byline">${esc(metaLine)}</p>` : ''}
      ${lead}
    </header>
    <div class="article-body">${a.content}</div>
  </section>`;
}

// Quita del contenido las imágenes rotas o que no responden: Paged.js espera
// a todas las imágenes para medir, y una sola imagen colgada bloquea la maqueta.
async function pruneBrokenImages(root, timeoutMs = 15000) {
  const imgs = [...root.querySelectorAll('img')];
  let removed = 0;
  await Promise.all(imgs.map(img => new Promise(resolve => {
    const probe = new Image();
    let timer = null;
    const done = ok => {
      clearTimeout(timer);
      if (!ok) {
        removed++;
        const fig = img.closest('figure');
        (fig || img).remove();
      }
      resolve();
    };
    timer = setTimeout(() => done(false), timeoutMs);
    probe.onload = () => done(true);
    probe.onerror = () => done(false);
    probe.src = img.src;
  })));
  return removed;
}

// Modo «quitar imágenes»: lo activa el editor (iframe padre) por postMessage.
// Al pulsar una imagen de un artículo, se pide confirmación y se avisa al
// padre, que es quien edita y guarda el contenido.
// Navegación de páginas: «N de M» con salto y scroll-spy. La toolbar flotante
// la usa en vista completa; en el editor la maneja el topbar (por mensajes).
let pageGoTo = null;

function initPageNav(total, note) {
  const nav = document.getElementById('tb-nav');
  const input = document.getElementById('tb-page');
  document.getElementById('tb-total').textContent = `de ${total}`;
  input.max = total;
  input.value = 1;
  nav.classList.remove('hidden');

  const pages = [...document.querySelectorAll('.pagedjs_page')];
  const goTo = n => {
    const p = pages[Math.min(total, Math.max(1, n)) - 1];
    if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  pageGoTo = goTo;
  if (window.parent !== window) {
    window.parent.postMessage({ quiosco: 'pages', total, note: note || '' }, '*');
  }
  input.addEventListener('change', () => goTo(parseInt(input.value, 10) || 1));
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      goTo(parseInt(input.value, 10) || 1);
      input.blur();
    }
  });

  let ticking = false;
  let lastSent = 1;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const mark = window.scrollY + window.innerHeight / 3;
      let current = 1;
      for (let i = 0; i < pages.length; i++) {
        if (pages[i].offsetTop <= mark) current = i + 1;
        else break;
      }
      if (document.activeElement !== input) input.value = current;
      if (current !== lastSent && window.parent !== window) {
        lastSent = current;
        window.parent.postMessage({ quiosco: 'page-current', current }, '*');
      }
    });
  }, { passive: true });
}

function initImageEditMode() {
  if (window.parent === window) return; // solo tiene sentido embebido en el editor
  document.body.classList.add('embedded');

  // Recorte por lotes: se marcan imágenes (clic) y bloques de texto (selección);
  // todo se aplica de golpe al apagar el modo ✂
  let marks = [];
  const sendTrimCount = () => {
    window.parent.postMessage({ quiosco: 'trim-count', n: marks.length }, '*');
  };
  const clearMarkEl = el => {
    if (el.tagName === 'MARK') el.replaceWith(...el.childNodes);
    else el.classList.remove('trim-marked');
  };
  const unmark = el => {
    marks = marks.filter(m => m.el !== el);
    clearMarkEl(el);
    sendTrimCount();
  };
  const clearAllMarks = () => {
    marks.forEach(m => clearMarkEl(m.el));
    marks = [];
    sendTrimCount();
  };
  const applyMarks = () => {
    if (!marks.length) return;
    window.parent.postMessage({
      quiosco: 'apply-trims',
      items: marks.map(({ el, ...rest }) => rest)
    }, '*');
    clearAllMarks();
  };

  // Zoom −/+: el zoom lo aplica el editor (padre); desde aquí solo se pide
  document.getElementById('tb-zoom').classList.remove('hidden');
  document.getElementById('tb-zoomout').addEventListener('click', () =>
    window.parent.postMessage({ quiosco: 'zoom-delta', delta: -10 }, '*'));
  document.getElementById('tb-zoomin').addEventListener('click', () =>
    window.parent.postMessage({ quiosco: 'zoom-delta', delta: 10 }, '*'));

  window.addEventListener('message', ev => {
    if (ev.data && ev.data.quiosco === 'goto' && pageGoTo) {
      pageGoTo(Number(ev.data.page) || 1);
    }
    if (ev.data && ev.data.quiosco === 'clear-trims') clearAllMarks();
    if (ev.data && ev.data.quiosco === 'apply-now') applyMarks();
    if (ev.data && ev.data.quiosco === 'view') {
      const wasEditing = document.body.classList.contains('img-edit');
      document.body.classList.toggle('img-edit', !!ev.data.imgEdit);
      if (!wasEditing && ev.data.imgEdit) {
        try { window.getSelection().removeAllRanges(); } catch { /* sin selección */ }
      }
      if (wasEditing && !ev.data.imgEdit) clearAllMarks();
      document.body.classList.toggle('focusfull', !!ev.data.focus);
      // La toolbar mini no debe encogerse con el zoom de la previsualización
      const z = Number(ev.data.zoom);
      document.getElementById('toolbar').style.zoom = z > 0 ? String(1 / z) : '';
      document.getElementById('tb-zoomval').textContent = z > 0 ? `${Math.round(z * 100)} %` : '';
    }
  });

  // Esc con el foco dentro del iframe: salir de la vista completa
  window.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') window.parent.postMessage({ quiosco: 'exit-focus' }, '*');
  });

  document.getElementById('pages').addEventListener('click', ev => {
    if (!document.body.classList.contains('img-edit')) return;
    // Repulsar algo marcado lo desmarca (imagen o bloque de texto)
    const marked = ev.target.closest('.trim-marked');
    if (marked) {
      ev.preventDefault();
      unmark(marked);
      return;
    }
    const img = ev.target.closest('img');
    if (!img) return;
    const article = img.closest('.article');
    if (!article) return; // portada y contraportada se editan en Ajustes
    ev.preventDefault();
    const artIndex = parseInt(article.dataset.art ?? (article.id || '').replace('art-', ''), 10);
    if (isNaN(artIndex)) return;
    const src = img.getAttribute('src') || '';
    // nth: hay artículos con la misma imagen repetida — se marca ESA copia
    const twins = [...document.querySelectorAll(`.article[data-art="${artIndex}"] img`)]
      .filter(i => (i.getAttribute('src') || '') === src && !i.closest('figure.lead'));
    marks.push({
      type: 'img',
      art: artIndex,
      src,
      isLead: !!img.closest('figure.lead'),
      nth: Math.max(0, twins.indexOf(img)),
      el: img
    });
    img.classList.add('trim-marked');
    sendTrimCount();
  });

  // Selección de texto → quitar los bloques (párrafos, títulos…) tocados.
  // Guardias: solo actúa si ESTE gesto creó la selección (nunca selecciones
  // heredadas) y nunca cuando el gesto acaba sobre una imagen (eso es quitar-imagen).
  const BLOCK_SEL = '.pagedjs_page .article :is(p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table, figcaption)';
  let selAtMouseDown = '';
  document.addEventListener('mousedown', () => {
    if (!document.body.classList.contains('img-edit')) return;
    selAtMouseDown = String(window.getSelection() || '');
  });
  document.addEventListener('mouseup', ev => {
    if (!document.body.classList.contains('img-edit')) return;
    if (ev.target && ev.target.closest && ev.target.closest('img')) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const selText = String(sel);
    if (selText.replace(/\s+/g, ' ').trim().length < 3 || selText === selAtMouseDown) return;
    const range = sel.getRangeAt(0);
    const startEl = range.startContainer.nodeType === 1
      ? range.startContainer : range.startContainer.parentElement;
    const startArticle = startEl && startEl.closest('.article');
    if (!startArticle) return;
    const artIndex = parseInt(startArticle.dataset.art ?? '', 10);
    if (isNaN(artIndex)) return;

    // Texto seleccionado REALMENTE dentro de cada bloque (evita el efecto
    // frontera: una selección que «roza» el párrafo siguiente no lo incluye)
    const selLenIn = el => {
      try {
        const r = range.cloneRange();
        const rb = document.createRange();
        rb.selectNodeContents(el);
        if (r.compareBoundaryPoints(Range.START_TO_START, rb) < 0) r.setStart(rb.startContainer, rb.startOffset);
        if (r.compareBoundaryPoints(Range.END_TO_END, rb) > 0) r.setEnd(rb.endContainer, rb.endOffset);
        if (r.collapsed) return 0;
        return r.toString().replace(/\s+/g, '').length;
      } catch { return 0; }
    };
    const candidates = [...document.querySelectorAll(BLOCK_SEL)].filter(el => {
      try {
        return el.closest('.article')?.dataset.art === String(artIndex)
          && el.textContent.trim().length > 0
          && selLenIn(el) >= 3;
      } catch { return false; }
    });
    // Solo bloques de nivel superior (si cae un blockquote entero, no sus <p> internos)
    const blocks = candidates.filter(el => !candidates.some(o => o !== el && o.contains(el)));
    if (!blocks.length) return;

    // Por cada bloque: si la selección lo cubre solo en parte, se marca el
    // fragmento; si lo cubre (casi) entero, se marca el bloque completo.
    // Los sub-rangos se calculan ANTES de mutar el DOM.
    const jobs = blocks.map(b => {
      const rb = document.createRange();
      rb.selectNodeContents(b);
      const r = range.cloneRange();
      if (r.compareBoundaryPoints(Range.START_TO_START, rb) < 0) r.setStart(rb.startContainer, rb.startOffset);
      if (r.compareBoundaryPoints(Range.END_TO_END, rb) > 0) r.setEnd(rb.endContainer, rb.endOffset);
      return { b, r };
    });
    jobs.forEach(({ b, r }) => {
      if (marks.some(m => m.el === b) || b.closest('.trim-marked')) return;
      const selNorm = r.toString().replace(/\s+/g, ' ').trim();
      const blockNorm = b.textContent.replace(/\s+/g, ' ').trim();
      if (selNorm.length >= 3 && selNorm.length < blockNorm.length - 2) {
        try {
          const markEl = document.createElement('mark');
          markEl.className = 'trim-marked';
          markEl.appendChild(r.extractContents());
          r.insertNode(markEl);
          marks.push({
            type: 'textpart',
            art: artIndex,
            part: markEl.textContent.replace(/\s+/g, ' ').trim().slice(0, 400),
            el: markEl
          });
          return;
        } catch { /* si el rango no se puede envolver, cae a bloque entero */ }
      }
      marks.push({
        type: 'text',
        art: artIndex,
        text: blockNorm.slice(0, 400),
        el: b
      });
      b.classList.add('trim-marked');
    });
    sel.removeAllRanges();
    sendTrimCount();
  });
}

async function main() {
  const status = document.getElementById('tb-status');
  const printBtn = document.getElementById('tb-print');
  printBtn.addEventListener('click', () => window.print());
  initImageEditMode();

  // Exportación fiable desde el servidor (no depende del diálogo del navegador)
  const dlBtn = document.getElementById('tb-download');
  dlBtn.addEventListener('click', async () => {
    dlBtn.disabled = true;
    dlBtn.textContent = 'Generando…';
    try {
      const r = await fetch('/api/export-pdf', { method: 'POST' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Error desconocido');
      const a = document.createElement('a');
      a.href = data.url;
      a.download = data.name;
      a.click(); // descarga automática al terminar
      status.textContent = `PDF descargado (${data.kb} KB)`;
    } catch (e) {
      status.textContent = 'Error al exportar: ' + e.message;
    } finally {
      dlBtn.disabled = false;
      dlBtn.textContent = 'Descargar PDF';
    }
  });

  const mag = await (await fetch('/api/magazine')).json();
  const s = mag.settings;
  const arts = mag.articles.filter(a => a.included !== false);

  document.title = `${s.title} — ${s.issue}`;
  document.documentElement.style.setProperty('--accent', s.accent || '#b3402a');

  // Tipografía y columnas (con ?font=…&cols=… en la URL para probar sin guardar)
  const qp = new URLSearchParams(location.search);
  const FONT_ALIASES = { serif: 'clasica', sans: 'moderna' };
  let font = qp.get('font') || s.font || 'clasica';
  font = FONT_ALIASES[font] || font;
  if (font !== 'clasica') document.documentElement.dataset.font = font;
  const align = qp.get('align') || s.align || 'justificado';
  if (align === 'izquierda') document.documentElement.dataset.align = 'izquierda';
  const paragraphs = qp.get('paragraphs') || s.paragraphs || 'sangria';
  const globalCols = Math.min(4, Math.max(1, parseInt(qp.get('cols') || s.columns, 10) || 2));
  // Acabado «caballete»: contraportada al final y total de páginas múltiplo de 4
  const saddle = (qp.get('finish') || s.finish || 'caballete') === 'caballete';
  const backstyle = qp.get('back') || s.backstyle || 'raya';

  if (!arts.length) {
    document.getElementById('pages').innerHTML =
      '<div id="empty">La revista está vacía.<br>Añade artículos desde el editor y volverán a aparecer aquí.</div>';
    status.textContent = 'Sin artículos';
    window.__pagedStatus = { done: 'error' };
    return;
  }

  const content = document.createElement('div');
  content.innerHTML = coverHTML(s, arts) + tocHTML(arts)
    + arts.map((a, i) => articleHTML(a, i, globalCols)).join('')
    + (saddle ? backcoverHTML(s, arts, backstyle) : '');
  if (paragraphs === 'espaciado') {
    content.querySelectorAll('.article').forEach(el => el.classList.add('parr-esp'));
  }

  // Las fuentes deben estar cargadas ANTES de que Paged.js mida el texto
  const FONT_FAMILIES = {
    editorial: ['700 1em "Playfair Display"', '800 1em "Playfair Display"', '1em Lora', 'italic 1em Lora', '700 1em Lora'],
    elegante: ['700 1em "Cormorant Garamond"', '1em "EB Garamond"', 'italic 1em "EB Garamond"', '700 1em "EB Garamond"'],
    prensa: ['700 1em Archivo', '800 1em Archivo', '1em Newsreader', 'italic 1em Newsreader', '700 1em Newsreader'],
    moderna: ['1em Inter', '700 1em Inter', '800 1em Inter'],
    glossy: ['700 1em Fraunces', '800 1em Fraunces', '1em "Source Serif 4"', 'italic 1em "Source Serif 4"', '700 1em "Source Serif 4"'],
    libro: ['700 1em Spectral', '800 1em Spectral', '1em "Crimson Pro"', 'italic 1em "Crimson Pro"', '700 1em "Crimson Pro"'],
    suiza: ['500 1em "Space Grotesk"', '700 1em "Space Grotesk"', '1em "Work Sans"', 'italic 1em "Work Sans"', '700 1em "Work Sans"'],
    diario: ['700 1em "Libre Franklin"', '800 1em "Libre Franklin"', '1em Merriweather', 'italic 1em Merriweather', '700 1em Merriweather'],
    cartel: ['600 1em Oswald', '700 1em Oswald', '1em Bitter', 'italic 1em Bitter', '700 1em Bitter']
  };
  if (FONT_FAMILIES[font]) {
    status.textContent = 'Cargando tipografías…';
    await Promise.allSettled(FONT_FAMILIES[font].map(f => document.fonts.load(f)));
  }

  status.textContent = 'Comprobando imágenes…';
  const removedImgs = await pruneBrokenImages(content);
  if (removedImgs) console.warn(`Se quitaron ${removedImgs} imágenes rotas o que no respondían`);
  status.textContent = 'Maquetando…';

  // Marcar primer y último párrafo de cada artículo (capitular y remate).
  // A cualquier profundidad: Readability envuelve el contenido en divs.
  content.querySelectorAll('.article-body').forEach(body => {
    const ps = [...body.querySelectorAll('p')]
      .filter(p => p.textContent.trim().length > 0 && !p.closest('blockquote, figure, figcaption'));
    if (ps.length) {
      ps[0].classList.add('opener');
      ps[ps.length - 1].classList.add('closer');
    }
  });

  // Paged.js consume los nodos al maquetar: se guarda el HTML ya limpio
  // para poder reconstruir el contenido en la segunda pasada.
  const cleanedHTML = content.innerHTML;
  const pagesEl = document.getElementById('pages');

  try {
    const { Previewer } = await import('/vendor/paged.esm.js');
    let result = await new Previewer().preview(content, ['/magazine.css'], pagesEl);

    // Segunda pasada: blancas antes de la contraportada hasta múltiplo de 4
    if (saddle) {
      const needed = (4 - (result.total % 4)) % 4;
      if (needed > 0) {
        status.textContent = 'Cuadrando pliegos…';
        pagesEl.innerHTML = '';
        const content2 = document.createElement('div');
        content2.innerHTML = cleanedHTML.replace(
          '<section class="backcover',
          '<section class="filler-page"></section>'.repeat(needed) + '<section class="backcover'
        );
        result = await new Previewer().preview(content2, ['/magazine.css'], pagesEl);
      }
    }

    status.textContent = removedImgs ? `${removedImgs} img rota(s) fuera` : '';
    status.title = `${result.total} páginas` + (saddle ? ' · múltiplo de 4 ✓' : '');
    initPageNav(result.total, removedImgs ? `${removedImgs} imagen(es) rota(s) omitida(s)` : '');
    printBtn.disabled = false;
    window.__pagedStatus = { done: true, pages: result.total };
  } catch (e) {
    status.textContent = 'Error al maquetar';
    window.__pagedStatus = { done: 'error' };
    console.error(e);
  }
}

main();
