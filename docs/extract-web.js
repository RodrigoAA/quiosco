// Extracción de artículos EN el navegador (versión web de Quiosco).
// Sin servidor propio: descarga las páginas a través de proxies CORS públicos.
(() => {

  // Proxies CORS para descargar páginas ajenas desde el navegador.
  // r.jina.ai es el más fiable (devuelve el HTML crudo con X-Return-Format).
  const PROXIES = [
    { wrap: u => 'https://r.jina.ai/' + u, headers: { 'X-Return-Format': 'html' } },
    { wrap: u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) },
    { wrap: u => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u) },
    { wrap: u => 'https://corsproxy.io/?url=' + encodeURIComponent(u) }
  ];

  async function proxyFetchText(url) {
    let lastErr = null;
    for (const p of PROXIES) {
      try {
        const r = await fetch(p.wrap(url), {
          headers: p.headers || {},
          signal: AbortSignal.timeout(30000)
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const text = await r.text();
        if (text) return text;
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error('Ningún proxy CORS respondió' + (lastErr ? ` (${lastErr.message})` : '') +
      '. Prueba más tarde, o usa la app local e importa aquí su JSON.');
  }

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
  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function extractArticle(html, url) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const meta = sel => doc.querySelector(sel)?.getAttribute('content')?.trim() || '';

    const lang = (doc.documentElement.getAttribute('lang') || '').slice(0, 2);
    const leadImage = meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]');
    const ogSiteName = meta('meta[property="og:site_name"]');
    const published = meta('meta[property="article:published_time"]');

    const parsed = new Readability(doc, { keepClasses: false }).parse();
    if (!parsed || !parsed.content) return null;

    const cdoc = new DOMParser().parseFromString(`<body>${parsed.content}</body>`, 'text/html');

    for (const sel of STRIP_SELECTORS) {
      try { cdoc.querySelectorAll(sel).forEach(n => n.remove()); } catch { /* selector raro */ }
    }
    cdoc.querySelectorAll('a').forEach(a => {
      if (a.querySelector('img') && !a.textContent.trim()) a.replaceWith(...a.childNodes);
    });
    cdoc.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src');
      if (!src) return img.remove();
      try { img.setAttribute('src', new URL(src, url).href); } catch { /* se deja */ }
      img.removeAttribute('srcset');
      img.removeAttribute('sizes');
      img.removeAttribute('width');
      img.removeAttribute('height');
    });
    cdoc.querySelectorAll('a[href]').forEach(a => {
      try { a.setAttribute('href', new URL(a.getAttribute('href'), url).href); } catch { /* se deja */ }
    });
    const firstHeading = cdoc.body.querySelector('h1, h2');
    if (firstHeading && normalize(firstHeading.textContent) === normalize(parsed.title)) {
      firstHeading.remove();
    }
    cdoc.querySelectorAll('figure').forEach(f => {
      if (!f.querySelector('img, blockquote') && !f.textContent.trim()) f.remove();
    });

    const words = cdoc.body.textContent.split(/\s+/).filter(Boolean).length;

    let byline = (parsed.byline || meta('meta[name="author"]') || '').replace(/\s+/g, ' ').trim();
    const byMatch = byline.match(/\bby\s+(.+)$/i);
    if (byMatch) byline = byMatch[1];
    if (/^(posted|published|publicado|escrito)\b/i.test(byline)) byline = '';
    byline = byline.replace(/^(by|por)\s+/i, '').trim();

    let excerpt = (parsed.excerpt || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (/^[.…\s·—-]*$/.test(excerpt)) excerpt = '';
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
      byline, siteName, excerpt, leadImage,
      publishedTime: parsed.publishedTime || published || '',
      lang,
      minutes: Math.max(1, Math.round(words / 220)),
      words,
      content: cdoc.body.innerHTML
    };
  }

  /* ---------- Posts e hilos de X ---------- */

  const X_HOSTS = new Set([
    'x.com', 'www.x.com', 'twitter.com', 'www.twitter.com',
    'mobile.twitter.com', 'mobile.x.com', 'fxtwitter.com', 'vxtwitter.com', 'fixupx.com'
  ]);

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

  // La API de FxTwitter envía Access-Control-Allow-Origin: * — sin proxy
  async function fetchFxTweet(id) {
    try {
      const r = await fetch(`https://api.fxtwitter.com/i/status/${id}`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return null;
      const j = await r.json();
      return j && j.code === 200 && j.tweet ? j.tweet : null;
    } catch {
      return null;
    }
  }

  function deriveTitle(text, author) {
    // Si la primera línea es corta, es el título (las notas largas de X lo traen así)
    const firstLine = (text || '').split('\n')[0].replace(/https?:\/\/\S+/g, '').trim();
    if (firstLine.length >= 3 && firstLine.length <= 90 && firstLine.length < (text || '').trim().length) {
      return firstLine;
    }
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

  async function fetchThreadReader(rootId) {
    try {
      const html = await proxyFetchText(`https://threadreaderapp.com/thread/${rootId}.html`);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const tweets = [...doc.querySelectorAll('div[id^="tweet_"].content-tweet')];
      if (!tweets.length) return null;

      const out = [];
      for (const tw of tweets) {
        tw.querySelectorAll('.tw-permalink, .tweet-url, script, style').forEach(n => n.remove());
        tw.querySelectorAll('img').forEach(img => {
          const src = img.getAttribute('data-src') || img.getAttribute('src') || '';
          if (/emoji/i.test(img.className + ' ' + src)) {
            img.replaceWith(doc.createTextNode(img.getAttribute('alt') || ''));
          }
        });
        const figs = [];
        tw.querySelectorAll('.entity-image').forEach(span => {
          const img = span.querySelector('img');
          const src = img && (img.getAttribute('data-src') || img.getAttribute('src'));
          if (src && !src.endsWith('1px.png')) figs.push(`<figure><img src="${esc(src)}" alt=""></figure>`);
          span.remove();
        });
        // Los <br> separan párrafos (clave en notas largas de un solo post)
        tw.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
        const text = tw.textContent.replace(/[ \t]+/g, ' ').trim();
        for (const para of text.split(/\n+/).map(s => s.trim()).filter(Boolean)) {
          out.push(`<p>${esc(para)}</p>`);
        }
        out.push(...figs);
      }
      return { html: out.join(''), tweets: tweets.length };
    } catch {
      return null;
    }
  }

  async function extractXThread(id, originalUrl) {
    const first = await fetchFxTweet(id);
    if (!first) {
      throw new Error('No se pudo leer el post de X (¿cuenta privada, post borrado o API caída?)');
    }
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

    // ThreadReaderApp solo compensa si sabe MÁS que nosotros (hay hilo por
    // debajo); para posts únicos, FxTwitter conserva mejor los párrafos.
    const tra = await fetchThreadReader(root.id);
    let content;
    let source;
    if (tra && tra.tweets > chain.length) {
      content = tra.html;
      source = 'threadreader';
    } else {
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

  window.extractFromUrl = async url => {
    if (!/^https?:\/\//i.test(url)) throw new Error('URL no válida');
    const id = parseXStatus(url);
    if (id) return extractXThread(id, url);
    const art = extractArticle(await proxyFetchText(url), url);
    if (!art) throw new Error('No se pudo extraer el artículo de esa página');
    return art;
  };

})();
