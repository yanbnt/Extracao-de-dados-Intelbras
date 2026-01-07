(async () => {
  const data = await chrome.storage.local.get(["isAutomating", "productName", "step", "selectedCode", "selectedCategory"]);
  // "Interruptor Mestre": Só executa se a automação estiver ativa.
  if (!data.isAutomating) {
    console.log("Automation not active. Content script exiting.");
    return;
  }

  const { step, productName, selectedCode, selectedCategory } = data;
  console.log("Content script loaded for step:", step);

  try {
    // Passo 3-9: Fluxo de busca do produto e navegação
    if (window.location.href.includes("pesq_docTecnica.php") && step === "openQueryPage") {
      const searchIcon = document.querySelector('img[title="Clique aqui para consultar os códigos dos Modelos"]');
      if (searchIcon) { await chrome.storage.local.set({ step: "fillModelSearch" }); searchIcon.click(); } 
      else { throw new Error("Ícone de busca de modelo não encontrado."); }
    }
    else if (window.location.href.includes("consultaModelo.php") && step === "fillModelSearch") {
      const inputField = document.querySelector('input[name="descPeca"]');
      const searchButton = document.querySelector('input[title="Clique aqui para consultar"]');
      if (inputField && searchButton) {
        inputField.value = productName;
        await chrome.storage.local.set({ step: "extractCode" });
        searchButton.click();
      } else { throw new Error("Formulário de busca de modelo não encontrado."); }
    }
    else if (window.location.href.includes("consultaModelo.php") && step === "extractCode") {
      const resultsTable = document.querySelector('table.listaASSIST2');
      if (resultsTable) { 
        await chrome.runtime.sendMessage({ action: "processTable", tableHtml: resultsTable.outerHTML });
      } 
      else { throw new Error("Nenhum resultado encontrado para o produto."); }
    }
    else if (window.location.href.includes("pesq_docTecnica.php") && step === "pasteCode") {
      const codeInput = document.querySelector('input#descrTecnica_id');
      const searchButton = document.querySelector('input[type="submit"][value="Buscar"]');
      if (codeInput && searchButton && selectedCode) {
        codeInput.value = selectedCode;
        codeInput.blur();
        await chrome.storage.local.set({ step: "findManualLink" });
        setTimeout(() => searchButton.click(), 500);
      } else { throw new Error("Campos para busca de manual não encontrados ou código não selecionado."); }
    }
    
    // Passo 10 & 11: Lógica de duas fases para clicar e verificar o link
    else if (step === "findManualLink") {
      if (!selectedCategory) throw new Error("Categoria não foi selecionada na extensão.");
      
      console.log(`Fase 1: Procurando pelo link da categoria '${selectedCategory}'.`);
      const normalizeText = (str) => str.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "");
      const allCells = document.querySelectorAll('td');
      let manualLink = null;
      const searchText = normalizeText(selectedCategory);

      for (const cell of allCells) {
        if (normalizeText(cell.textContent).includes(searchText)) {
          const parentRow = cell.closest('tr');
          if (parentRow) {
            const viewLink = Array.from(parentRow.querySelectorAll('a')).find(a => normalizeText(a.textContent) === "visualizar");
            if (viewLink) {
              manualLink = viewLink;
              break;
            }
          }
        }
      }

      if (manualLink) {
        console.log("Link encontrado. Alterando o passo para 'verifyingLink' e clicando.");
        // Define o próximo passo ANTES de clicar para evitar loop se a página apenas recarregar.
        await chrome.storage.local.set({ step: "verifyingLink" });
        manualLink.click();
      } else {
        throw new Error(`Documento da categoria '${selectedCategory}' não encontrado na lista.`);
      }
    }
    // Passo 11: Verifica a página de destino (softexpert ou a própria assist)
    else if (step === "verifyingLink") {
      // Cenário 1: A navegação falhou e a página de busca foi recarregada.
      if (window.location.href.includes("pesq_docTecnica.php")) {
        throw new Error("Falha ao navegar para a página do documento (a página de busca foi recarregada).");
      }
      // Cenário 2: A navegação foi para a página do documento em softexpert.
      else if (window.location.href.includes("intelbras.softexpert.com")) {
        console.log("Fase 2: Verificando a página de destino por erros...");
        const error = await new Promise((resolve) => {
            let attempts = 0;
            const interval = setInterval(() => {
                const expiredMsgDiv = document.querySelector('div#msgdiv');
                if (expiredMsgDiv && expiredMsgDiv.textContent.includes("expirou")) {
                    clearInterval(interval);
                    resolve(new Error("O link do documento expirou."));
                }
                
                attempts++;
                if (attempts > 10) { // Timeout de 5 segundos
                    clearInterval(interval);
                    resolve(null); // Se não encontrou erro, a página é válida.
                }
            }, 500);
        });

        if (error) {
          throw error; // Lança para o bloco catch tratar.
        } else {
          console.log("Nenhum erro encontrado. Documento válido. Automação concluída.");
          await chrome.storage.local.set({ isAutomating: false, step: "done" });
        }
      }
    }

  } catch (error) {
    console.error("Error during automation step:", step, error);

    // Condição de fallback: se o doc não for encontrado, o link expirar, ou a navegação falhar.
    if ((step === "findManualLink" || step === "verifyingLink") && (error.message.includes("não encontrado") || error.message.includes("expirou") || error.message.includes("Falha ao navegar"))) {
        await chrome.runtime.sendMessage({
            action: "errorPageFound",
            productName: productName,
            category: selectedCategory,
            error: error.message
        });
    } else {
        alert(`A automação falhou no passo '${step}': ${error.message}`);
    }
    // Desativa a automação em qualquer caso de falha.
    await chrome.storage.local.set({ isAutomating: false, step: "error" });
  }
})();