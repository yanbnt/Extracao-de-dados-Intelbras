// Listener para mensagens da extensão
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "start") {
    console.log("Background: Setting isAutomating = true and starting.");
    chrome.storage.local.set({ 
      isAutomating: true, // Ativa o "interruptor mestre"
      productName: request.productName,
      step: "openQueryPage",
      tableHtml: null, 
      selectedCode: null,
      selectedCategory: null
    }, () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) chrome.tabs.update(tabs[0].id, { url: "https://assist.intelbras.com.br/bin/at/pesq_docTecnica.php" });
      });
    });
  }
  else if (request.action === "processTable") {
    console.log("Background: Received table. Closing product search tab.");
    // Fecha a aba de busca de produtos, pois ela não é mais necessária.
    if (sender.tab) {
      chrome.tabs.remove(sender.tab.id);
    }
    
    chrome.storage.local.set({
      tableHtml: request.tableHtml,
      step: "userSelection"
    }).then(() => {
        console.log("Background: Results saved. Notifying popup to refresh.");
        chrome.runtime.sendMessage({ action: "resultsReady" });
    });
  }
  else if (request.action === "findManual") {
    console.log("Background: Setting isAutomating = true and continuing.");
    chrome.storage.local.set({ 
        isAutomating: true, // Garante que a automação continue
        step: "pasteCode",
        selectedCategory: request.category
    }, () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) chrome.tabs.update(tabs[0].id, { url: "https://assist.intelbras.com.br/bin/at/pesq_docTecnica.php" });
        });
    });
  }
  else if (request.action === "errorPageFound") {
    console.log(`Background: Error page found (${request.error}). Starting fallback search.`);
    // A busca na web será aberta em uma nova aba, mantendo a aba original aberta.
    // Aciona a busca na web
    const query = `Intelbras ${request.productName} ${request.category}`;
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    chrome.tabs.create({ url: searchUrl });
  }
  return true;
});

// Listener para eventos de aba
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) {
    return;
  }

  chrome.storage.local.get(["isAutomating", "productName", "selectedCategory", "step"], (data) => {
    // Se a automação já encontrou um erro e está em processo de fallback, ignora eventos subsequentes para evitar loops.
    if (data.step === "error" && !data.isAutomating) {
      return;
    }

    // Prioridade 1: Detectar redirecionamento para login.
    if (tab.url.includes("login.microsoftonline.com")) {
      console.log("Microsoft login page detected. Setting state to error and starting fallback.");
      // Define o passo como "error" ANTES de executar ações assíncronas para prevenir re-entrada.
      chrome.storage.local.set({ isAutomating: false, step: "error" }, () => {
        // Apenas uma aba de busca deve ser criada.
        chrome.tabs.remove(tabId);
        const query = `Intelbras ${data.productName || ''} ${data.selectedCategory || ''}`;
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        chrome.tabs.create({ url: searchUrl });
      });
      return; // Impede a execução do resto do listener.
    }

    // Se a automação não estiver ativa, não faz mais nada.
    if (!data.isAutomating) {
      return;
    }

    // Prioridade 2: Injetar content script para automação normal.
    if (tab.url.includes('assist.intelbras.com.br') || tab.url.includes('intelbras.softexpert.com')) {
      if (data.step && data.step !== "userSelection" && data.step !== "done") {
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['content.js']
        });
      }
    }
  });
});
