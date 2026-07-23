// Compone la revista desde localStorage y la pagina en A4 con Paged.js (versión web)

const STORE_KEY = 'quiosco-magazine';

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function loadMag() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORE_KEY));
    if (stored && stored.settings && Array.isArray(stored.articles)) return stored;
  } catch { /* corrupto */ }
  return { settings: { title: 'Mi Revista', issue: 'Nº 1', accent: '#b3402a' }, articles: [] };
}

function hostFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

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
    <h2>Sumario</h2>
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
  const cols = Math.min(4, Math.max(2, parseInt(a.cols, 10) || globalCols));
  return `<section class="article cols-${cols}" id="art-${i}" data-art="${i}"${a.lang ? ` lang="${esc(a.lang)}"` : ''}>
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

// Modo «quitar imágenes»: lo activa el editor (iframe padre) por postMessage
function initImageEditMode() {
  if (window.parent === window) return;
  document.body.classList.add('embedded');

  window.addEventListener('message', ev => {
    if (ev.data && ev.data.quiosco === 'img-edit') {
      document.body.classList.toggle('img-edit', !!ev.data.on);
    }
  });

  document.getElementById('pages').addEventListener('click', ev => {
    if (!document.body.classList.contains('img-edit')) return;
    const img = ev.target.closest('img');
    if (!img) return;
    const article = img.closest('.article');
    if (!article) return;
    ev.preventDefault();
    if (!confirm('¿Quitar esta imagen de la revista? (para recuperarla tendrías que volver a añadir el artículo)')) return;
    const artIndex = parseInt(article.dataset.art ?? (article.id || '').replace('art-', ''), 10);
    if (isNaN(artIndex)) return;
    window.parent.postMessage({
      quiosco: 'remove-image',
      art: artIndex,
      src: img.getAttribute('src') || '',
      isLead: !!img.closest('figure.lead')
    }, '*');
  });

  // Selección de texto → quitar los bloques (párrafos, títulos…) tocados
  const BLOCK_SEL = '.pagedjs_page .article :is(p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table, figcaption)';
  document.addEventListener('mouseup', () => {
    if (!document.body.classList.contains('img-edit')) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const startEl = range.startContainer.nodeType === 1
      ? range.startContainer : range.startContainer.parentElement;
    const startArticle = startEl && startEl.closest('.article');
    if (!startArticle) return;
    const artIndex = parseInt(startArticle.dataset.art ?? '', 10);
    if (isNaN(artIndex)) return;

    const candidates = [...document.querySelectorAll(BLOCK_SEL)].filter(el => {
      try {
        return range.intersectsNode(el)
          && el.closest('.article')?.dataset.art === String(artIndex)
          && el.textContent.trim().length > 0;
      } catch { return false; }
    });
    const blocks = candidates.filter(el => !candidates.some(o => o !== el && o.contains(el)));
    if (!blocks.length) return;

    const preview = blocks[0].textContent.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!confirm(`¿Quitar ${blocks.length} bloque(s) de texto que empiezan por «${preview}…»?`)) {
      sel.removeAllRanges();
      return;
    }
    window.parent.postMessage({
      quiosco: 'remove-text',
      art: artIndex,
      texts: blocks.map(b => b.textContent.replace(/\s+/g, ' ').trim().slice(0, 400))
    }, '*');
    sel.removeAllRanges();
  });
}

async function main() {
  const status = document.getElementById('tb-status');
  const printBtn = document.getElementById('tb-print');
  printBtn.addEventListener('click', () => window.print());
  initImageEditMode();

  const mag = loadMag();
  const s = mag.settings;
  const arts = mag.articles.filter(a => a.included !== false);

  document.title = `${s.title} — ${s.issue || ''}`;
  document.documentElement.style.setProperty('--accent', s.accent || '#b3402a');

  const qp = new URLSearchParams(location.search);
  const FONT_ALIASES = { serif: 'clasica', sans: 'moderna' };
  let font = qp.get('font') || s.font || 'clasica';
  font = FONT_ALIASES[font] || font;
  if (font !== 'clasica') document.documentElement.dataset.font = font;
  const globalCols = Math.min(4, Math.max(2, parseInt(qp.get('cols') || s.columns, 10) || 2));
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

  const FONT_FAMILIES = {
    editorial: ['700 1em "Playfair Display"', '800 1em "Playfair Display"', '1em Lora', 'italic 1em Lora', '700 1em Lora'],
    elegante: ['700 1em "Cormorant Garamond"', '1em "EB Garamond"', 'italic 1em "EB Garamond"', '700 1em "EB Garamond"'],
    prensa: ['700 1em Archivo', '800 1em Archivo', '1em Newsreader', 'italic 1em Newsreader', '700 1em Newsreader'],
    moderna: ['1em Inter', '700 1em Inter', '800 1em Inter']
  };
  if (FONT_FAMILIES[font]) {
    status.textContent = 'Cargando tipografías…';
    await Promise.allSettled(FONT_FAMILIES[font].map(f => document.fonts.load(f)));
  }

  status.textContent = 'Comprobando imágenes…';
  const removedImgs = await pruneBrokenImages(content);
  if (removedImgs) console.warn(`Se quitaron ${removedImgs} imágenes rotas o que no respondían`);
  status.textContent = 'Maquetando…';

  // Marcar primer y último párrafo de cada artículo (capitular y remate)
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
    const { Previewer } = await import('./vendor/paged.esm.js');
    let result = await new Previewer().preview(content, ['magazine.css'], pagesEl);

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
        result = await new Previewer().preview(content2, ['magazine.css'], pagesEl);
      }
    }

    status.textContent = `${result.total} páginas` +
      (saddle ? ' (múltiplo de 4 ✓)' : '') +
      (removedImgs ? ` · ${removedImgs} imagen(es) rota(s) omitida(s)` : '');
    printBtn.disabled = false;
    window.__pagedStatus = { done: true, pages: result.total };
  } catch (e) {
    status.textContent = 'Error al maquetar';
    window.__pagedStatus = { done: 'error' };
    console.error(e);
  }
}

main();
