chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    switch (request.action) {
      case 'extractSubCategories':
        await extractSubCategories();
        break;
      case 'extractProducts':
        await extractProducts();
        break;
      case 'extractFiles':
        await extractFiles();
        break;
    }
  })();
  return true;
});

// Flag para evitar reentrância na extração de produtos
let extractingProducts = false;

async function waitForElement(selector, timeout = 20000) {
  const interval = 200;
  for (let i = 0; i < timeout / interval; i++) {
    const element = document.querySelector(selector);
    if (element) return element;
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  return null;
}

async function extractSubCategories() {
  const subCategories = [];
  // Aguarda pelo menos um item de subcategoria aparecer na página
  await waitForElement('.element-nav-list-item a');


  // Obtém o prefixo da categoria atual a partir da URL
  let categoriaPrefix = '';
  try {
    const path = window.location.pathname;
    // Exemplo: /pt-br/controle-de-acesso
    const match = path.match(/^(\/pt-br\/[a-zA-Z0-9-]+)/);
    if (match) categoriaPrefix = match[1];
  } catch (e) {}

  // Função para coletar subcategorias visíveis
  function collectVisibleSubCategories() {
    const elements = document.querySelectorAll('.element-nav-list-item a');
    elements.forEach(element => {
      let href = element.getAttribute('href');
      const labelElement = element.querySelector('span.header__label');
      const label = labelElement ? labelElement.textContent.trim() : '';

      // Normaliza URL absoluta para relativa se estiver no mesmo domínio
      try {
        if (href) {
          const urlObj = new URL(href, window.location.origin);
          // Remove query e hash para normalizar
          urlObj.search = '';
          urlObj.hash = '';
          if (urlObj.origin === window.location.origin) {
            href = urlObj.pathname;
          } else {
            href = urlObj.toString();
          }
        }
      } catch (e) {}

      // Ignora links especiais que não são subcategorias de produto
      const ignoredHrefs = [
        '/pt-br/onde-encontrar/comprar/',
        '/pt-br/contato/suporte-tecnico/'
      ];
      if (href && ignoredHrefs.includes(href)) {
        console.log(`[EXTRAÇÃO] Ignorando link especial: label="${label}", href="${href}"`);
        return;
      }

      // Filtra apenas subcategorias do prefixo da categoria
      // Verificação relaxada para incluir URLs que podem não seguir estritamente o prefixo pai
      if (
        href && label &&
        (href.startsWith(categoriaPrefix + '/') || href.startsWith('/pt-br/')) &&
        !subCategories.some(s => s.href === href)
      ) {
        subCategories.push({ href, label });
        console.log(`[EXTRAÇÃO] Subcategoria: label=\"${label}\", href=\"${href}\"`);
      }
    });
  }

  // Percorre todas as páginas do carrossel usando os slick-dots
  const slickDots = document.querySelectorAll('.slick-dots button');
  let lastLabels = [];
  for (let i = 0; i < slickDots.length; i++) {
    slickDots[i].click();
    // Aguarda até que o DOM realmente mude (ou timeout)
    let tentativas = 0;
    while (tentativas < 20) { // até 2 segundos
      await new Promise(resolve => setTimeout(resolve, 120));
      const currentLabels = Array.from(document.querySelectorAll('.element-nav-list-item a span.header__label')).map(e => e.textContent.trim());
      if (JSON.stringify(currentLabels) !== JSON.stringify(lastLabels)) {
        lastLabels = currentLabels;
        break;
      }
      tentativas++;
    }
    collectVisibleSubCategories();
  }

  // Garante que, se não houver slick-dots, tenta avançar com a seta ou coleta ao menos a página inicial
  if (slickDots.length === 0) {
    collectVisibleSubCategories();
    const nextBtn = document.querySelector('.slick-next');
    if (nextBtn) {
      let noChangeCount = 0;
      let lastCount = subCategories.length;
      for (let i = 0; i < 15; i++) {
        nextBtn.click();
        await new Promise(resolve => setTimeout(resolve, 300));
        collectVisibleSubCategories();
        if (subCategories.length === lastCount) {
          noChangeCount++;
          if (noChangeCount >= 3) break; // para se não houver mudanças por várias tentativas
        } else {
          noChangeCount = 0;
          lastCount = subCategories.length;
        }
      }
    }
  }

  console.log(`[EXTRAÇÃO] Total de subcategorias extraídas: ${subCategories.length}`);

  // Não gera arquivo aqui. O background gerará subcategorias.txt na mesma ordem recebida.

  chrome.runtime.sendMessage({ action: 'subCategoriesExtracted', subCategories: subCategories });
}

async function extractProducts() {
  if (extractingProducts) {
    console.log('[EXTRAÇÃO] extractProducts já em execução, ignorando nova chamada.');
    return;
  }

  extractingProducts = true;
  try {
    const products = [];

    // Garante ao menos um produto na página atual
    const productCard = await waitForElement('div.card.element-card.product a');
    if (!productCard) {
      chrome.runtime.sendMessage({ action: 'productsExtracted', products: [] });
      return;
    }

    // Coleta produtos da página atual (mais genérico para várias subcategorias)
    function collectProductsFromCurrentPage() {
      const productsOnPage = new Set();

      // 1) Cards padrão conhecidos
      document.querySelectorAll('div.card.element-card.product a').forEach(a => {
        let href = a.getAttribute('href');
        if (href && !/\/comprar\/|\/suporte-tecnico\//.test(href)) {
          href = normalizeProductHref(href);
          productsOnPage.add(href);
        }
      });

      // 2) Fallback: qualquer link que pareça apontar para produto
      document.querySelectorAll('a[href*="/produto/"], a[href*="/produtos/"]').forEach(a => {
        let href = a.getAttribute('href');
        if (href && !/\/comprar\/|\/suporte-tecnico\//.test(href)) {
          href = normalizeProductHref(href);
          productsOnPage.add(href);
        }
      });

      productsOnPage.forEach(href => {
        if (!products.includes(href)) {
          products.push(href);
        }
      });
    }

    // Descobre páginas disponíveis (1, 2, 3, ...) na paginação, de forma mais abrangente
    function getPageButtons() {
      const candidates = Array.from(
        document.querySelectorAll(
          'span.text.text--300, a.text.text--300, button.text.text--300, .pagination a, .pagination button'
        )
      );

      const pageButtons = candidates.filter(el => {
        const txt = el.textContent.trim();
        return /^\d+$/.test(txt);
      });

      return pageButtons;
    }

    // Percorre todas as páginas (1, 2, 3, ...) em ordem
    async function walkAllPages() {
      let pageButtons = getPageButtons();

      if (pageButtons.length === 0) {
        // Não há paginação numérica, coleta só a página atual
        collectProductsFromCurrentPage();
        return;
      }

      // Páginas em ordem numérica única
      const pages = Array.from(
        new Set(
          pageButtons
            .map(btn => parseInt(btn.textContent.trim(), 10))
            .filter(n => !isNaN(n))
        )
      ).sort((a, b) => a - b);

      for (const pageNumber of pages) {
        // Recoleta os botões a cada iteração (DOM muda após clique)
        pageButtons = getPageButtons();
        const btn = pageButtons.find(
          el => parseInt(el.textContent.trim(), 10) === pageNumber
        );
        if (!btn) {
          console.log(`[EXTRAÇÃO] Botão da página ${pageNumber} não encontrado, pulando.`);
          continue;
        }

        // Assinatura da lista de produtos antes do clique
        const prevSignature = Array.from(
          document.querySelectorAll('a[href*="/produto/"], a[href*="/produtos/"]')
        )
          .map(a => a.getAttribute('href'))
          .join('|');

        btn.click();

        // Espera até o DOM mudar (ou timeout ~2s)
        let changed = false;
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 100));
          const currentSignature = Array.from(
            document.querySelectorAll('a[href*="/produto/"], a[href*="/produtos/"]')
          )
            .map(a => a.getAttribute('href'))
            .join('|');
          if (currentSignature !== prevSignature) {
            changed = true;
            break;
          }
        }
        if (!changed) {
          console.log(`[EXTRAÇÃO] Página ${pageNumber} pode não ter alterado o DOM, mas seguindo mesmo assim.`);
        }

        collectProductsFromCurrentPage();
      }
    }

    await walkAllPages();
    console.log(`[EXTRAÇÃO] Total de produtos extraídos: ${products.length}`);
    chrome.runtime.sendMessage({ action: 'productsExtracted', products: products });
  } finally {
    extractingProducts = false;
  }
}

async function extractFiles() {
  // Tenta clicar na aba "Arquivos para download", se existir
  const downloadTab = document.querySelector(
    'li.block-tab__header__item[data-ga-action="tab-item-arquivos-para-download"], ' +
    'button[data-ga-action="tab-item-arquivos-para-download"], ' +
    'a[data-ga-action="tab-item-arquivos-para-download"]'
  );

  if (downloadTab) {
    downloadTab.click();
    // espera o conteúdo da aba carregar
    await new Promise(resolve => setTimeout(resolve, 1500));
  } else {
    console.log("Content script: Aba 'Arquivos para download' não encontrada, procurando arquivos na página inteira.");
  }

  const files = [];
  const anchors = document.querySelectorAll('a[href]');

  anchors.forEach(a => {
    const href = a.getAttribute('href');
    if (!href) return;

    // Considera links que parecem ser arquivos (extensões comuns)
    if (/\.(pdf|zip|rar|docx?|xlsx?|pptx?|csv|xml|bin|exe|msi|img|iso|txt|tar|gz|7z)$/i.test(href)) {
      try {
        const absoluteUrl = new URL(href, window.location.origin).href;
        if (!files.includes(absoluteUrl)) {
          files.push(absoluteUrl);
        }
      } catch (e) {
        // ignora URLs inválidas
      }
    }
  });

  console.log(`Content script: Encontrado(s) ${files.length} arquivo(s) na página do produto.`);

  // Normaliza o caminho do produto a partir da URL atual
  let productPath = '';
  try {
    const urlObj = new URL(window.location.href);
    urlObj.search = '';
    urlObj.hash = '';
    productPath = urlObj.pathname;
  } catch (e) {
    productPath = window.location.pathname || '';
  }

  chrome.runtime.sendMessage({ action: 'filesExtracted', files: files, productPath });
}

// Normaliza URLs de produto para um pathname consistente (sem query/hash)
function normalizeProductHref(href) {
  try {
    const urlObj = new URL(href, window.location.origin);
    urlObj.search = '';
    urlObj.hash = '';
    return urlObj.pathname;
  } catch (e) {
    return href;
  }
}