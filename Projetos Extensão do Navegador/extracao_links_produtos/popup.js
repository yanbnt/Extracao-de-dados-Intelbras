const startBtn = document.getElementById('startBtn');
const statusEl = document.getElementById('status');

startBtn.addEventListener('click', () => {
  startBtn.disabled = true;
  statusEl.textContent = 'Iniciando extração...';

  chrome.runtime.sendMessage({ type: 'start-crawl' }, response => {
    if (chrome.runtime.lastError) {
      statusEl.textContent = 'Erro ao iniciar: ' + chrome.runtime.lastError.message;
      startBtn.disabled = false;
      return;
    }

    if (response && response.ok) {
      statusEl.textContent = 'Extração em andamento. Aguarde o download do arquivo.';
    } else {
      statusEl.textContent = 'Não foi possível iniciar a extração.';
      startBtn.disabled = false;
    }
  });
});
