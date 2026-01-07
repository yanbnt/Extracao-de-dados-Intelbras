# Extensão: Bitrix24 Extrator CSV

Extensão para navegadores baseados em Chromium (Chrome, Edge, Brave etc.) que extrai os dados de tabelas (grids) do Bitrix24 e salva tudo em um arquivo **CSV** pronto para abrir no Excel.

## O que ela faz

- Injeta um script na página atual do Bitrix24.
- Localiza o contêiner principal da grade (`.main-grid-container`).
- Lê os títulos das colunas e as linhas de dados visíveis.
- Ignora colunas de controle (checkbox, ações) e mantém apenas as colunas úteis.
- Gera um arquivo `bitrix_modelos_tarefa.csv` com todas as linhas da tabela.

## Como instalar

1. Abra o navegador (Chrome, Edge ou outro baseado em Chromium).
2. Acesse `chrome://extensions/` (ou `edge://extensions/`).
3. Ative o **Modo do desenvolvedor** (Developer mode).
4. Clique em **Carregar sem compactação** (Load unpacked).
5. Selecione a pasta deste projeto:
   - `seu_extensao_extractor`

## Como usar

1. Entre na sua conta Bitrix24 e vá até uma tela com grade de dados (por exemplo, modelos de tarefa ou lista de tarefas).
2. Confirme que a listagem está no layout padrão (tabela/grade, não kanban).
3. Clique no ícone da extensão **"Extrator Bitrix24"**.
4. No popup, clique em **"Extrair e Baixar CSV"**.
5. A extensão irá:
   - Injetar o `content_script.js` na aba atual;
   - Ler cabeçalho e linhas da grade visível;
   - Montar um CSV em memória;
   - Iniciar o download do arquivo `bitrix_modelos_tarefa.csv` (com BOM UTF-8, compatível com Excel).

O status da operação é mostrado no texto do popup (aguardando, extraindo, concluído ou erro).

## Observações

- A extração depende fortemente da estrutura de CSS do Bitrix24 (`.main-grid-container`, `.main-grid-row`, `.main-grid-cell`). Mudanças no layout podem exigir ajuste no `content_script.js`.
- Apenas as linhas que estão carregadas na página entram no CSV. Se houver paginação ou carregamento infinito, talvez seja necessário rolar ou navegar pelas páginas e repetir a extração.

## Estrutura principal

- `manifest.json`: Configuração geral da extensão (permissões, content script, popup).
- `popup.html` / `popup.js`: Interface simples com botão para iniciar a extração e feedback de status.
- `content_script.js`: Código que acessa o DOM da grade do Bitrix24, coleta os dados e monta o CSV.
- Pasta `Paginas/`: Exemplos de arquivos CSV já gerados (útil como referência de saída).
