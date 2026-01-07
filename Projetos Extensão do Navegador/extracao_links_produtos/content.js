function collectProductLinks() {
  // Seletores comuns para cards/listas de produtos
  const selectors = [
    '.product-item a',
    '.product__link',
    '.product a',
    'a.product-item__link',
    '.products-list a',
    '.products-grid a'
  ];

  const links = new Set();

  function addHref(el) {
    if (!el) return;
    const href = el.getAttribute('href');
    if (!href || href.startsWith('javascript:')) return;

    try {
      const url = new URL(href, window.location.href).href;
      // Adiciona qualquer URL absoluta encontrada pelos seletores de produtos
      links.add(url);
    } catch (e) {
      // ignora URLs inválidas
    }
  }

  selectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(el => {
      // Se for um card onde o link está em um <a> interno, tenta encontrar
      if (el.tagName === 'A') {
        addHref(el);
      } else {
        const anchor = el.querySelector('a');
        if (anchor) addHref(anchor);
      }
    });
  });

  // Fallback: qualquer <a> na página, caso os seletores acima não encontrem nada
  if (!links.size) {
    document.querySelectorAll('a[href]').forEach(a => {
      addHref(a);
    });
  }

  return Array.from(links);
}
function getCurrentPageFromDom() {
  const currentSpan = document.querySelector('#paginate-container nav.paginate li.current span');
  if (!currentSpan) {
    return 1;
  }

  const text = (currentSpan.textContent || '').trim();
  const num = parseInt(text, 10);
  if (Number.isNaN(num) || num <= 0) {
    return 1;
  }
  return num;
}

function clickNextPageInPagination(previousPage) {
  const nav = document.querySelector('#paginate-container nav.paginate');
  if (!nav) {
    return false;
  }

  const items = Array.from(nav.querySelectorAll('ul > li'));
  if (!items.length) {
    return false;
  }

  let currentIndex = items.findIndex(li => li.classList.contains('current'));

  if (currentIndex === -1) {
    currentIndex = items.findIndex(li => {
      const text = (li.textContent || '').trim();
      const num = parseInt(text, 10);
      return !Number.isNaN(num) && num === previousPage;
    });
  }

  if (currentIndex === -1) {
    return false;
  }

  const nextLi = items[currentIndex + 1];
  if (!nextLi) {
    return false; // não há próxima página numérica
  }

  const clickable = nextLi.querySelector('a, span');
  if (!clickable) {
    return false;
  }

  clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  return true;
}

function waitForPageChange(previousPage, timeoutMs = 10000) {
  return new Promise(resolve => {
    const startTime = Date.now();

    function pageChanged() {
      const current = getCurrentPageFromDom();
      return current !== previousPage;
    }

    function checkAndMaybeResolve() {
      if (pageChanged()) {
        cleanup();
        resolve(true);
      } else if (Date.now() - startTime >= timeoutMs) {
        cleanup();
        resolve(false);
      }
    }

    const target = document.querySelector('#paginate-container') || document.body;
    let observer = null;

    if (target) {
      observer = new MutationObserver(() => {
        checkAndMaybeResolve();
      });
      observer.observe(target, { childList: true, subtree: true });
    }

    const intervalId = window.setInterval(checkAndMaybeResolve, 500);

    function cleanup() {
      if (observer) {
        observer.disconnect();
      }
      window.clearInterval(intervalId);
    }

    // checagem inicial
    checkAndMaybeResolve();
  });
}

async function crawlAllPagesFromDom() {
  const allLinks = new Set();
  let safetyCounter = 0;

  while (true) {
    safetyCounter += 1;
    if (safetyCounter > 50) {
      break; // proteção contra loop infinito em caso de mudança no site
    }

    const links = collectProductLinks();
    links.forEach(link => allLinks.add(link));

    const previousPage = getCurrentPageFromDom();
    const clicked = clickNextPageInPagination(previousPage);
    if (!clicked) {
      break; // não há próxima página para clicar
    }

    const changed = await waitForPageChange(previousPage);
    if (!changed) {
      break; // provavelmente última página ou falha na navegação
    }
  }

  chrome.runtime.sendMessage({
    type: 'crawl-finished',
    names: Array.from(allLinks)
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'crawl-all') {
    crawlAllPagesFromDom();
  }
});
