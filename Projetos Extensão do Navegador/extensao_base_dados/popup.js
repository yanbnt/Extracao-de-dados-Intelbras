document.addEventListener('DOMContentLoaded', () => {
  const downloadBtn = document.getElementById('downloadBtn');
  const urlInput = document.getElementById('urlInput');
  const message = document.getElementById('message');

  downloadBtn.addEventListener('click', () => {
    const url = urlInput.value;
    if (url && url.startsWith('https://www.intelbras.com/pt-br/')) {
      downloadBtn.disabled = true;
      message.textContent = 'Iniciando o download...';
      
      // Adiciona um indicador de loading
      const loadingIndicator = document.createElement('div');
      loadingIndicator.className = 'loader';
      downloadBtn.parentNode.insertBefore(loadingIndicator, downloadBtn.nextSibling);

      chrome.runtime.sendMessage({ action: 'startDownload', url: url }, (response) => {
        downloadBtn.disabled = false;
        loadingIndicator.remove();
        if (chrome.runtime.lastError) {
          message.textContent = `Erro: ${chrome.runtime.lastError.message}`;
        } else {
          message.textContent = response.status;
        }
      });
    } else {
      message.textContent = 'Por favor, insira uma URL válida da Intelbras.';
    }
  });
});