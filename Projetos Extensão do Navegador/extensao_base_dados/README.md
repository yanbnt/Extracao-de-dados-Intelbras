# Extensão: Intelbras Downloader

Extensão para navegadores baseados em Chromium (Chrome, Edge, Brave etc.) que automatiza a navegação no site da Intelbras e faz o download em massa de arquivos de documentação (principalmente PDFs) de uma categoria de produtos.

## O que ela faz

- Abre a URL de uma **categoria de produtos** da Intelbras (ex.: CFTV, redes, controle de acesso).
- Descobre e percorre automaticamente todas as **subcategorias** e **páginas de produtos**.
- Em cada produto, identifica arquivos de documentação (ex.: manuais em PDF) e faz o download.
- Organiza os arquivos em pastas, usando o nome da categoria e da subcategoria.

## Como instalar

1. Abra o navegador (Chrome, Edge ou outro baseado em Chromium).
2. Acesse `chrome://extensions/` (ou `edge://extensions/`).
3. Ative o **Modo do desenvolvedor** (Developer mode).
4. Clique em **Carregar sem compactação** (Load unpacked).
5. Selecione a pasta deste projeto:
   - `extensao_base_dados`

A extensão "Intelbras Downloader" aparecerá na lista de extensões e o ícone ficará disponível na barra.

## Como usar

1. No navegador, acesse uma página de **categoria de produtos** da Intelbras, por exemplo:
   - `https://www.intelbras.com/pt-br/cftv`
   - `https://www.intelbras.com/pt-br/controle-de-acesso`
2. Clique no ícone da extensão "Intelbras Downloader".
3. No popup, cole ou confirme a URL da categoria no campo de texto.
4. Clique em **Baixar Arquivos**.
5. A extensão vai:
   - Abrir abas em segundo plano para cada subcategoria;
   - Percorrer todas as páginas de produtos;
   - Acessar a página de cada produto e localizar arquivos para download;
   - Baixar os arquivos automaticamente para a pasta padrão de downloads do navegador, organizando por pastas.

Durante o processo, a mensagem no popup indica o status da automação (iniciando, processando, finalizado ou erro).

## Requisitos e limitações

- Funciona apenas em URLs que começam com `https://www.intelbras.com/pt-br/`.
- Se o layout, seletores ou estrutura do site da Intelbras mudarem, pode ser necessário ajustar o código em `content.js` e `background.js`.
- Alguns downloads podem ser bloqueados por políticas do navegador ou pelo próprio site.

## Estrutura principal

- `manifest.json`: Configuração da extensão (permissões, scripts, ícone, etc.).
- `popup.html` / `popup.js` / `popup.css`: Interface usada para iniciar o processo de download.
- `background.js`: Máquina de estados que controla abas, fluxo de subcategorias, produtos e downloads.
- `content.js`: Script injetado nas páginas da Intelbras para extrair subcategorias, produtos e links de arquivos.
