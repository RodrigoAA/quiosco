// Un clic en el icono: añade la URL de la pestaña activa al número actual de Quiosco.
// Feedback como insignia sobre el icono: ✓ añadido · ✗ error (¿Quiosco arrancado?)

chrome.action.onClicked.addListener(async tab => {
  const badge = (text, color) => {
    chrome.action.setBadgeText({ text, tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color, tabId: tab.id });
    setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab.id }).catch?.(() => { }), 4000);
  };

  if (!tab || !/^https?:/i.test(tab.url || '')) {
    badge('✗', '#c0392b');
    return;
  }
  try {
    const r = await fetch('http://localhost:4321/add?url=' + encodeURIComponent(tab.url), {
      signal: AbortSignal.timeout(60000)
    });
    badge(r.ok ? '✓' : '✗', r.ok ? '#2e7d32' : '#c0392b');
  } catch {
    badge('✗', '#c0392b');
  }
});
