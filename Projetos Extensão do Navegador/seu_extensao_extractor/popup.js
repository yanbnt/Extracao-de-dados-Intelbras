document.addEventListener('DOMContentLoaded', () => {
    const extractButton = document.getElementById('extractButton');
    const statusText = document.getElementById('status');

    extractButton.addEventListener('click', () => {
        statusText.textContent = 'Injetando script e extraindo...';

        // 1. Encontra a aba ativa
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length === 0) {
                statusText.textContent = 'Erro: Nenhuma aba ativa encontrada.';
                return;
            }

            const activeTabId = tabs[0].id;

            // 2. Executa a função 'extractTableData' do content_script.js diretamente na aba
            // A função deve ser passada como string de código ou referência de arquivo.
            // Usaremos a opção 'files' para injetar o content_script.js
            chrome.scripting.executeScript({
                target: { tabId: activeTabId },
                files: ['content_script.js']
            })
                .then(() => {
                    // Após o script ter sido injetado, execute a função principal de extração
                    // e capture o resultado retornado.
                    return chrome.scripting.executeScript({
                        target: { tabId: activeTabId },
                        function: runExtractionAndGetCSV
                    });
                })
                .then(injectionResults => {
                    // O resultado vem como um array (um item por frame)
                    const csvContent = injectionResults[0].result;

                    if (csvContent && csvContent.startsWith("Nome")) { // Verifica se recebeu dados válidos
                        downloadCSV(csvContent, 'bitrix_modelos_tarefa.csv');
                        statusText.textContent = 'Extração concluída! Download iniciado.';
                    } else if (csvContent === "NO_TABLE") {
                        statusText.textContent = 'Erro: Tabela de dados Bitrix não encontrada.';
                    } else {
                        statusText.textContent = 'Erro: Extração falhou ou retornou dados vazios.';
                    }
                })
                .catch(error => {
                    statusText.textContent = 'Erro fatal na injeção/execução. Veja o console.';
                    console.error("Erro fatal na injeção ou execução:", error);
                });
        });
    });
});

// A função abaixo é usada pelo chrome.scripting.executeScript para iniciar a extração no content script.
// O nome dela será referenciado no popup.js, mas o corpo deve estar no content_script.js
// O Chrome API pode ter dificuldade em referenciar funções de scripts injetados. 
// Vamos garantir que a execução seja feita por uma única injeção que retorna o valor.
// Vamos manter a abordagem de injeção simples e enviar uma mensagem após a injeção ter terminado.

// MANTENDO A ABORDAGEM SIMPLES E CORRIGINDO O ERRO DE COMUNICAÇÃO (Opção 2 do popup.js)
// O código final de popup.js deve usar a abordagem de envio de mensagem APÓS a injeção
// ter sido BEM SUCEDIDA. O código anterior estava correto em intenção, mas falhou na execução assíncrona.
// Vamos restaurar a lógica de comunicação e focar apenas no seletor do content_script.

// REESTRUTURANDO O POPUP.JS PARA A ABORDAGEM ANTERIOR (Mais simples para iniciantes):
document.addEventListener('DOMContentLoaded', () => {
    const extractButton = document.getElementById('extractButton');
    const statusText = document.getElementById('status');

    extractButton.addEventListener('click', () => {
        statusText.textContent = 'Injetando script e extraindo...';

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTabId = tabs[0]?.id;
            if (!activeTabId) {
                statusText.textContent = 'Erro: Nenhuma aba ativa encontrada.';
                return;
            }

            // 1. Injeta o content_script.js manualmente.
            chrome.scripting.executeScript({
                target: { tabId: activeTabId },
                files: ['content_script.js']
            })
                .then(() => {
                    // 2. Se a injeção for SUCESSO, envia a mensagem de extração.
                    return new Promise((resolve, reject) => {
                        chrome.tabs.sendMessage(activeTabId, { action: "START_EXTRACTION" }, (response) => {
                            if (chrome.runtime.lastError) {
                                reject(new Error(chrome.runtime.lastError.message));
                                return;
                            }
                            resolve(response);
                        });
                    });
                })
                .then(response => {
                    // 3. Processa a resposta do content script
                    if (response && response.status === "DONE") {
                        statusText.textContent = 'Extração concluída! Aguardando download...';
                    } else if (response && response.status === "NO_TABLE") {
                        statusText.textContent = 'Erro: Tabela não encontrada na página. Verifique o seletor.';
                    } else {
                        statusText.textContent = 'Erro desconhecido na extração.';
                    }
                })
                .catch(error => {
                    statusText.textContent = 'Erro de injeção ou comunicação: ' + error.message;
                    console.error("Erro no processo:", error);
                });
        });
    });

    // Este listener recebe o CSV gerado pelo content_script.js e aciona o download
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "DATA_READY") {
            downloadCSV(request.data, 'bitrix_modelos_tarefa.csv');
            sendResponse({ status: "DOWNLOAD_STARTED" });
        }
    });

    function downloadCSV(csv, filename) {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        chrome.downloads.download({
            url: url,
            filename: filename,
            saveAs: true
        });
    }


    function downloadCSV(csv, filename) {
        // Sequência BOM UTF-8 (necessária para Excel entender acentos)
        const bom = '\ufeff';

        // Cria o Blob, adicionando o BOM no início do conteúdo CSV
        const blob = new Blob([bom, csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        chrome.downloads.download({
            url: url,
            filename: filename,
            saveAs: true
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error("Erro no download:", chrome.runtime.lastError);
            }
        });
    }
});