function startCrawlOnActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0];
    if (!tab || !tab.id) {
      return;
    }

    const tabId = tab.id;

    chrome.tabs.sendMessage(tabId, { type: 'crawl-all' }, () => {
      // Se o content script ainda não estiver pronto, a chamada pode falhar silenciosamente.
      void chrome.runtime.lastError;
    });
  });
}

function downloadProductsFile(names) {
  const uniqueNames = Array.from(new Set(names));
  const content = uniqueNames.join('\n');
  const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(content);

  chrome.downloads.download({
    url: dataUrl,
    filename: 'links_produtos_intelbras.txt',
    saveAs: true
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'start-crawl') {
    startCrawlOnActiveTab();
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'crawl-finished' && Array.isArray(message.names)) {
    downloadProductsFile(message.names);
  }
});
