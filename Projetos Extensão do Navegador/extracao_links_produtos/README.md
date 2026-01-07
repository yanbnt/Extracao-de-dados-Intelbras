# Extensão: Extração de nobreaks Intelbras

Esta extensão de navegador (Chrome/Edge, Manifest V3) navega pela listagem de nobreaks da Intelbras e gera um arquivo `.txt` com o nome de todos os produtos encontrados em todas as páginas.

## Como instalar

1. Abra o navegador (Chrome ou Edge baseado em Chromium).
2. Acesse `chrome://extensions/` (ou `edge://extensions/`).
3. Ative o **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação** e selecione a pasta deste projeto.

## Como usar

1. No navegador, abra a página:
   - `https://www.intelbras.com/pt-br/energia/nobreaks/allproducts`
2. Clique no ícone da extensão "Extrair produtos Intelbras".
3. No popup, clique em **Iniciar extração**.
4. A extensão irá:
   - Ler os nomes dos produtos da página atual;
   - Identificar o link de **próxima página**;
   - Navegar automaticamente até a última página;
   - Ao terminar, fará o download de um arquivo `produtos_intelbras_nobreaks.txt` com todos os nomes (um por linha).

Se a paginação do site mudar, talvez seja necessário ajustar os seletores no arquivo `content.js` (função `getNextPageUrl` e, se preciso, `collectProductNames`).

## Observações

- O arquivo `.txt` será salvo na pasta de downloads padrão do navegador.
- Os nomes são deduplicados antes de gerar o arquivo.
