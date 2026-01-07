# Extensão "Encontrar PDFs na Página"

Extensão simples para navegadores baseados em Chromium (Chrome, Edge, Brave etc.) que varre a página atual e encontra links de download de arquivos **PDF**, listando-os em um popup.

## Como funciona

- Um **content script** (`contentScript.js`) é injetado em todas as páginas.
- Ele procura por elementos `<a>` cujo `href` termina em `.pdf` (levando em conta querystring e fragmento) e monta uma lista com **texto do link** e **URL absoluta**.
- Ao clicar no ícone da extensão, o **popup** (`popup.html` + `popup.js`) envia uma mensagem para a aba ativa pedindo os PDFs encontrados.
- Os links são exibidos em uma lista clicável; cada item abre o PDF em uma nova aba.

## Instalando no Chrome (ou Edge)

1. Abra o navegador (Chrome, Edge ou outro baseado em Chromium).
2. Acesse `chrome://extensions/` (no Edge, `edge://extensions/`).
3. Ative o **Modo do desenvolvedor** (Developer mode) no canto superior direito.
4. Clique em **Carregar sem compactação** (Load unpacked).
5. Selecione a pasta do projeto:
   - `c:\Users\Laboratorio Vilar\Desktop\Projetos Extensão do Navegador\extracao_estrategia_acelerada`

A extensão deverá aparecer na lista e o ícone ficará disponível na barra de extensões.

## Testando

1. Acesse qualquer página que tenha links para arquivos PDF (por exemplo, páginas de artigos científicos, boletos, relatórios públicos etc.).
2. Clique no ícone da extensão (pode ser necessário fixá-lo na barra, clicando no ícone de quebra-cabeça e depois no alfinete).
3. O popup será aberto e mostrará:
   - Uma mensagem de status (procurando PDFs, quantos foram encontrados ou se nenhum foi achado).
   - Uma lista de links para todos os PDFs localizados na página.

## Observações e possíveis melhorias

- Atualmente a detecção é baseada principalmente na extensão `.pdf` no `href`. Em casos mais avançados (downloads gerados por JavaScript ou endpoints sem extensão), seria preciso integrar heurísticas adicionais (por exemplo, checar cabeçalhos via background service worker ou usar APIs específicas do site).
- É possível adaptar facilmente o código para **destacar visualmente** os links de PDF dentro da própria página (por exemplo, adicionando um contorno colorido nos `<a>` encontrados).
- Também é possível exportar a lista de links para CSV ou copiar tudo para a área de transferência dentro do popup.

Se quiser, posso te ajudar a adaptar essa base para outros tipos de arquivo (por exemplo, `.docx`, `.xlsx`, `.zip`) ou para fazer download automático.
