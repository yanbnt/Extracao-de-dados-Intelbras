// Atualiza a interface com base no que está no armazenamento
function updateView() {
  chrome.storage.local.get(["tableHtml", "searchResultsHtml"], (data) => {
    const container = document.getElementById('resultsContainer');
    const footer = document.querySelector('.footer-controls');

    // Prioriza a exibição da tabela de produtos
    if (data.tableHtml) {
      container.innerHTML = data.tableHtml;
      footer.classList.add('active');
      addTableEventListeners();
    } 
    // Se não houver tabela, exibe os resultados da busca web
    else if (data.searchResultsHtml) {
      container.innerHTML = data.searchResultsHtml;
      footer.classList.remove('active');
    } 
    // Estado padrão
    else {
      container.innerHTML = "<p>Aguardando busca...</p>";
      footer.classList.remove('active');
    }
  });
}

// Adiciona eventos de clique às linhas da tabela
function addTableEventListeners() {
    const container = document.getElementById('resultsContainer');
    container.querySelectorAll('tr[ondblclick]').forEach(row => {
        row.addEventListener('click', () => {
            container.querySelectorAll('tr.selected').forEach(selectedRow => {
                selectedRow.classList.remove('selected');
            });
            row.classList.add('selected');
            const code = row.cells[0].innerText.trim();
            const productName = row.cells[1].innerText.trim();
            console.log(`Row clicked, code selected: ${code}`);
            chrome.storage.local.set({ selectedCode: code, productName: productName });
        });
    });
}

// Botão 1: Iniciar a busca inicial
document.getElementById('startButton').addEventListener('click', () => {
  const productName = document.getElementById('productName').value;
  if (productName) {
    document.getElementById('resultsContainer').innerHTML = "<p>Buscando produtos...</p>";
    chrome.storage.local.remove(["tableHtml", "searchResultsHtml", "selectedCode"]);
    chrome.runtime.sendMessage({ action: "start", productName: productName });
  } else {
    alert('Por favor, insira um nome de produto.');
  }
});

// Botão 2: Buscar documento com o item e categoria selecionados
document.getElementById('findManualButton').addEventListener('click', () => {
    const selectedCategory = document.getElementById('categorySelect').value;
    chrome.storage.local.get("selectedCode", (data) => {
        if (!data.selectedCode) {
            alert("Por favor, clique em uma linha da tabela para selecionar um item.");
            return;
        }
        if (!selectedCategory) {
            alert("Por favor, selecione uma categoria de documento.");
            return;
        }
        document.getElementById('resultsContainer').innerHTML = `<p>Buscando documento da categoria '${selectedCategory}'...</p>`;
        chrome.runtime.sendMessage({ 
            action: "findManual", 
            code: data.selectedCode,
            category: selectedCategory 
        });
    });
});

// Botão Limpar
document.getElementById('clearButton').addEventListener('click', () => {
    chrome.storage.local.remove(["tableHtml", "searchResultsHtml", "selectedCode", "productName", "step", "selectedCategory", "isAutomating"], () => {
        console.log("Cleared results and state.");
        updateView();
    });
});

// Listener para mensagens do background script (para auto-atualização)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "resultsReady") {
    console.log("Popup: resultsReady message received, refreshing view.");
    updateView();
  }
  return true; // Mantém o canal de mensagem aberto para respostas assíncronas
});

// Exibe a view correta ao abrir o popup
document.addEventListener('DOMContentLoaded', updateView);