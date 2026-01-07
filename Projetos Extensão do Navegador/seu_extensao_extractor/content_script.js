// Ouve mensagens enviadas pelo popup.js para iniciar a extração
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "START_EXTRACTION") {
        const csv = extractTableData();

        if (csv) {
            chrome.runtime.sendMessage({ action: "DATA_READY", data: csv });
            sendResponse({ status: "DONE" });
            return true;
        } else {
            sendResponse({ status: "NO_TABLE" });
        }
    }
});

function extractTableData() {
    // *** SELETOR CRÍTICO: FOCO NO CONTAINER PRINCIPAL DA GRADE ***
    // Tenta ser o mais específico possível com base na estrutura Bitrix24
    // O '.main-grid-container' geralmente engloba toda a tabela
    const tableContainer = document.querySelector('.main-grid-container');

    if (!tableContainer) {
        console.error("Contêiner da tabela (.main-grid-container) não encontrado.");
        return null; // Retorna nulo se o contêiner principal não for encontrado
    }

    let csvContent = '';

    // 1. Extrair o Cabeçalho (Header)
    // Seleciona os títulos visíveis (os THs)
    const headerCells = tableContainer.querySelectorAll('.main-grid-head-cell-inner .main-grid-head-title');

    if (headerCells.length > 0) {
        const headers = Array.from(headerCells)
            .map(h => h.innerText.trim().replace(/"/g, '""'));
        csvContent += headers.join(';') + '\n';
        console.log("Cabeçalho CSV gerado:", headers.join(';')); // DEBUG
    } else {
        // Cabeçalho de fallback (para segurança)
        csvContent += 'Nome;Prazo;Responsável;Criado por;Grupo;Serviço\n';
        console.warn("Cabeçalho padrão usado."); // DEBUG
    }

    // 2. Extrair os Dados (Data Rows)
    // Pelo código abaixo:
    // Usamos as duas classes que identificam o corpo da linha
    const dataRows = tableContainer.querySelectorAll('tr.main-grid-row.main-grid-row-body');

    console.log("Número de linhas de dados encontradas:", dataRows.length); // DEBUG
    // Ação 2: Se a primeira falhar, tente um seletor genérico para itens de grade, excluindo o cabeçalho.
    if (dataRows.length === 0) {
        console.warn("Tentativa 1 falhou. Tentando seletor mais amplo.");
        // Procura por TRs que tenham a classe 'main-grid-row' em toda a tabela, excluindo o cabeçalho (thead)
        const allRows = tableContainer.querySelectorAll('tbody tr.main-grid-row');
        if (allRows.length > 0) {
            dataRows = allRows;
        }
    }

    console.log("Número de linhas de dados encontradas:", dataRows.length); // DEBUG

    if (dataRows.length === 0) {
        console.warn("Nenhuma linha de dados encontrada com o seletor '.main-grid-body tr.main-grid-row'.");
        return csvContent; // Retorna apenas o cabeçalho se não houver linhas de dados
    }

    dataRows.forEach((row, rowIndex) => {
        // Seleciona todas as células de dados (TDs)
        const cells = row.querySelectorAll('td.main-grid-cell'); 
        
        // CORREÇÃO: Vamos pular as 2 primeiras colunas de controle: Checkbox e Ação.
        // O Nome da Tarefa é a 3ª coluna (índice 2).
        const usefulCells = Array.from(cells).slice(2);
        
        const rowData = usefulCells.map(cell => {
            let text = cell.innerText.trim().replace(/\s+/g, ' ');

            // Tratamento CSV (Escape de valores)
            if (text.includes(';') || text.includes('"') || text.includes('\n')) {
                text = text.replace(/"/g, '""');
                text = `"${text}"`;
            }
            return text;
        }).join(';');

        csvContent += rowData + '\n';
        console.log(`Linha ${rowIndex + 1} CSV:`, rowData); // DEBUG
    });

    console.log("Dados extraídos com sucesso. Enviando para download.");
    return csvContent;
}