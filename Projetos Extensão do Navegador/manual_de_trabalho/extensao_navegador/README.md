# Extensão de Automação Intelbras (RMA MAKE)

Esta é uma extensão para o Google Chrome projetada para automatizar o processo de busca por documentos técnicos (manuais, firmwares, etc.) no portal de assistência da Intelbras.

## Funcionalidades

- **Busca Automatizada:** Automatiza o fluxo de múltiplos cliques para encontrar códigos de produtos.
- **Seleção de Categoria:** Permite ao usuário escolher dinamicamente qual tipo de documento deseja encontrar (Manual de Trabalho, Firmware, etc.).
- **Interface Integrada:** Exibe a lista de produtos encontrados diretamente na janela da extensão para seleção.
- **Tratamento de Erros:**
  - Detecta se a sessão do usuário no site da Intelbras expirou e o informa.
  - Caso um documento não seja encontrado ou o link esteja expirado, realiza uma busca alternativa no Google.
- **Gerenciamento de Abas:** Fecha abas de busca intermediárias automaticamente para manter a navegação limpa.
- **Controle de Estado:** Mantém o resultado da última busca salvo até que o usuário decida limpar ou iniciar uma nova busca.

---

## Como Instalar

Como esta é uma extensão de desenvolvimento, ela precisa ser carregada manualmente no Google Chrome.

1.  Abra o Google Chrome e navegue para `chrome://extensions`.
2.  No canto superior direito da página, ative o **"Modo de programador"** (Developer mode).
3.  Novos botões irão aparecer. Clique em **"Carregar sem compactação"** (Load unpacked).
4.  Na janela de seleção de arquivos, navegue até a pasta onde este projeto está salvo e selecione a pasta `extensao_navegador`.
5.  Clique em "Selecionar pasta".
6.  A extensão "Minha Extensão" (ou "RMA MAKE Automation") aparecerá na sua lista de extensões e seu ícone será adicionado à barra de ferramentas do navegador.

---

## Como Usar (Passo a Passo)

**Pré-requisito:** Antes de usar, certifique-se de que você já está logado no [portal de assistência da Intelbras](http://assist.intelbras.com.br/).

1.  **Iniciar a Busca de Produto:**
    - Clique no ícone da extensão na barra de ferramentas.
    - Na janela que abrir, digite o nome de um produto (ex: `NVD 3316`) no campo de texto.
    - Clique no botão **"1. Iniciar Busca de Produtos"**.
    - A extensão irá navegar, abrir uma aba de busca, preencher o nome, extrair a tabela de resultados e fechar a aba de busca automaticamente.

2.  **Selecionar o Documento:**
    - Clique novamente no ícone da extensão. A janela agora deve exibir a tabela com os produtos encontrados.
    - No campo **"Categoria"**, selecione o tipo de documento que você deseja (ex: `Firmware`, `Esquema Elétrico`).
    - Na tabela, **clique na linha** correspondente ao produto exato que você quer. A linha ficará verde.
    - Clique no botão **"2. Buscar Documento"**.

3.  **Resultado:**
    - **Se o documento for encontrado:** A extensão navegará até a página final e clicará no link "Visualizar", abrindo o documento em uma nova aba.
    - **Se o documento não for encontrado (ou o link expirar):** A aba de erro será fechada e uma nova aba com os resultados de uma busca no Google será aberta.
    - **Se sua sessão expirar:** A aba de login será fechada e uma busca no Google será aberta.

4.  **Limpar:** A qualquer momento, você pode clicar no botão **"Limpar"** na janela da extensão para apagar os resultados atuais e começar uma nova busca.

---

## Estrutura dos Arquivos

-   `manifest.json`: Arquivo de configuração principal da extensão. Define permissões, scripts e metadados.
-   `popup.html`: A estrutura HTML da janela que abre quando se clica no ícone da extensão.
-   `popup.css`: Contém todos os estilos visuais para a interface do `popup.html`.
-   `popup.js`: Controla a interatividade do popup (cliques de botão, seleção de categoria, exibição de dados).
-   `background.js`: O "cérebro" da extensão. Orquestra todo o fluxo, gerencia o estado da automação, controla as abas e a comunicação entre os scripts.
-   `content.js`: O "trabalhador". É injetado nas páginas da Intelbras para realizar as ações diretas: preencher campos, clicar em botões e extrair informações.
