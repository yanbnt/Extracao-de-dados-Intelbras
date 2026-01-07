// State machine for 3-tab architecture with locking
let state = {
  mainCategoryTabId: null,
  subcategoryTabId: null,
  currentProductTabId: null, // Track the current product tab
  mainCategoryUrl: null,
  mainCategory: null,
  subCategories: [],
  currentSubCategoryIndex: 0,
  currentSubCategoryLabel: '', // Store the current subcategory label
  products: [],
  currentProductIndex: 0,
  allProductsForSubcategory: [],
  downloadedFiles: 0,
  downloadedUrls: null,
  productsProcessed: null,
  processedProductsIndex: null,
  productReprocessAttempts: 0,
  subcategorySummary: null,
  isFinished: false,
  subCategoriesTextDownloaded: false,

  // Flags to prevent re-injection on URL hash changes
  mainCategoryTabLoaded: false,
  subcategoryTabLoaded: false,
  productTabLoaded: false,

  // Flags to prevent race conditions
  isProcessingSubCategory: false,
  isProcessingProduct: false,
  // Watchdog timers and retry counters
  subcategoryTimerId: null,
  productTimerId: null,
  filesTimerId: null,
  subcategoryRetries: 0,
  productRetries: 0,
  filesRetries: 0,
};

// Watchdog configuration
const WATCHDOG_TIMEOUT = 40000; // 40s para páginas em segundo plano (menos reenvios)
const MAX_RETRIES = 1; // tenta apenas uma vez por estágio antes de avançar
const MAX_PRODUCT_REPROCESS_ROUNDS = 0; // não faz rodadas extras de reprocesso por subcategoria

// --- LISTENERS ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (state.isFinished) {
    try { sendResponse && sendResponse({ status: 'Process finished.' }); } catch (e) {}
    return;
  }

  switch (request.action) {
    case 'startDownload':
      startDownload(request.url);
      try { sendResponse && sendResponse({ status: 'Download process started.' }); } catch (e) {}
      break;
    case 'subCategoriesExtracted':
      handleSubCategories(request.subCategories);
      try { sendResponse && sendResponse({ status: 'Sub-categories processed.' }); } catch (e) {}
      break;
    case 'productsExtracted':
      handleProducts(request.products);
      try { sendResponse && sendResponse({ status: 'Products processed.' }); } catch (e) {}
      break;
    case 'filesExtracted':
      handleFiles(request.files, sender.tab.id, request.productPath);
      try { sendResponse && sendResponse({ status: 'Files processed.' }); } catch (e) {}
      break;
    default:
      try { sendResponse && sendResponse({ status: 'Unknown action.' }); } catch (e) {}
  }
  return true; // This indicates that sendResponse will be called asynchronously
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (state.isFinished || changeInfo.status !== 'complete') return;

  if (tabId === state.mainCategoryTabId && !state.mainCategoryTabLoaded) {
    state.mainCategoryTabLoaded = true;
    injectScriptAndSendMessage(tabId, 'extractSubCategories');
    // Inicia watchdog para extração de subcategorias
    startWatchdog('subcategories', tabId, 'extractSubCategories');
  } else if (tabId === state.subcategoryTabId && !state.subcategoryTabLoaded) {
    state.subcategoryTabLoaded = true;
    injectScriptAndSendMessage(tabId, 'extractProducts');
    // Inicia watchdog para extração de produtos
    startWatchdog('products', tabId, 'extractProducts');
  } else if (tabId === state.currentProductTabId && !state.productTabLoaded) {
    state.productTabLoaded = true;
    injectScriptAndSendMessage(tabId, 'extractFiles');
    // Inicia watchdog para extração de arquivos
    startWatchdog('files', tabId, 'extractFiles');
  }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (state.isFinished) return;
  if (tabId === state.mainCategoryTabId || tabId === state.subcategoryTabId) {
    finishDownload("Processo abortado porque a aba foi fechada.");
  }
  if (tabId === state.currentProductTabId) {
    // If a product tab is closed manually, unlock the processing to avoid getting stuck
    console.log(`Product tab ${tabId} closed, unlocking product processing.`);
    state.isProcessingProduct = false;
    state.currentProductTabId = null;
  }
});

// --- HELPER ---

function injectScriptAndSendMessage(tabId, action, attempt = 0) {
  // Envia mensagem ao content script já injetado pelo manifest; se não estiver pronto, reintenta algumas vezes
  chrome.tabs.sendMessage(tabId, { action }, () => {
    if (chrome.runtime.lastError) {
      if (attempt < 5) {
        setTimeout(() => injectScriptAndSendMessage(tabId, action, attempt + 1), 300);
      } else {
        console.warn(`Falha ao enviar mensagem '${action}' para a aba ${tabId} após ${attempt} tentativas: ${chrome.runtime.lastError.message}`);
      }
    }
  });
}

function startWatchdog(stage, tabId, action) {
  clearWatchdog(stage);
  const timerId = setTimeout(() => {
    // Timeout atingido: reenvia ação e controla tentativas
    const retriesKey = stage === 'subcategories' ? 'subcategoryRetries' : stage === 'products' ? 'productRetries' : 'filesRetries';
    if (state[retriesKey] >= MAX_RETRIES) {
      console.warn(`[WATCHDOG] Máximo de tentativas (${MAX_RETRIES}) atingido para ${stage}. Avançando ou finalizando.`);
      if (stage === 'subcategories') {
        // Não conseguiu extrair subcategorias: finalizar com mensagem
        finishDownload('Falha ao extrair subcategorias (timeout).');
      } else if (stage === 'products') {
        // Pula para próxima subcategoria
        advanceToNextSubCategory();
      } else if (stage === 'files') {
        // Avança para próximo produto
        state.currentProductIndex++;
        state.isProcessingProduct = false;
        setTimeout(() => processNextProduct(), 500);
      }
      return;
    }
    state[retriesKey]++;
    console.log(`[WATCHDOG] Tentativa ${state[retriesKey]} para '${stage}' na aba ${tabId}. Reenviando ação '${action}'.`);
    injectScriptAndSendMessage(tabId, action);
    // Reinicia o watchdog
    startWatchdog(stage, tabId, action);
  }, WATCHDOG_TIMEOUT);

  if (stage === 'subcategories') state.subcategoryTimerId = timerId;
  else if (stage === 'products') state.productTimerId = timerId;
  else if (stage === 'files') state.filesTimerId = timerId;
}

function clearWatchdog(stage) {
  if (stage === 'subcategories' && state.subcategoryTimerId) {
    clearTimeout(state.subcategoryTimerId);
    state.subcategoryTimerId = null;
    state.subcategoryRetries = 0;
  } else if (stage === 'products' && state.productTimerId) {
    clearTimeout(state.productTimerId);
    state.productTimerId = null;
    state.productRetries = 0;
  } else if (stage === 'files' && state.filesTimerId) {
    clearTimeout(state.filesTimerId);
    state.filesTimerId = null;
    state.filesRetries = 0;
  }
}

// --- STAGE 1: Get Sub-categories ---

function startDownload(url) {
  state = {
    mainCategoryTabId: null, subcategoryTabId: null, currentProductTabId: null, mainCategoryUrl: url, 
    mainCategory: url.split('/').filter(Boolean).pop(), subCategories: [], currentSubCategoryIndex: 0, 
    currentSubCategoryLabel: '', products: [], currentProductIndex: 0, allProductsForSubcategory: [], downloadedFiles: 0, downloadedUrls: new Set(), productsProcessed: new Map(), processedProductsIndex: new Set(), productReprocessAttempts: 0, subcategorySummary: null, isFinished: false,
    mainCategoryTabLoaded: false, subcategoryTabLoaded: false, productTabLoaded: false,
    isProcessingSubCategory: false, isProcessingProduct: false,
    subCategoriesTextDownloaded: false,
    subcategoryTimerId: null,
    productTimerId: null,
    filesTimerId: null,
    subcategoryRetries: 0,
    productRetries: 0,
    filesRetries: 0,
  };
  chrome.tabs.create({ url, active: false }, (tab) => { state.mainCategoryTabId = tab.id; });
}

// Sanitização reforçada para nomes de arquivos/pastas (Windows)
function sanitize(name) {
  if (!name) return '';
  // Remove caracteres inválidos
  let sanitized = name.replace(/[<>:"/\\|?*]/g, '_');
  // Remove pontos/espacos finais
  sanitized = sanitized.replace(/[. ]+$/, '');
  // Substitui outros caracteres não alfanuméricos
  sanitized = sanitized.replace(/[^a-zA-Z0-9_.-]/g, '_');
  // Remove underscores duplicados
  sanitized = sanitized.replace(/_+/g, '_');
  // Remove underscores do início/fim
  sanitized = sanitized.replace(/^_+|_+$/g, '');
  // Nomes reservados do Windows
  const reserved = ['CON','PRN','AUX','NUL','COM1','COM2','COM3','COM4','COM5','COM6','COM7','COM8','COM9','LPT1','LPT2','LPT3','LPT4','LPT5','LPT6','LPT7','LPT8','LPT9'];
  if (reserved.includes(sanitized.toUpperCase())) sanitized = '_' + sanitized;
  return sanitized;
}

function handleSubCategories(subCategories) {
  state.subCategories = subCategories;
  clearWatchdog('subcategories');
  if (subCategories.length > 0) {
    const safeMainCategory = sanitize(state.mainCategory);
    // Gera subcategorias.txt preservando exatamente a mesma ordem recebida
    if (!state.subCategoriesTextDownloaded) {
      try {
        const txt = subCategories.map(s => `${s.label} -> ${s.href}`).join('\r\n');
        const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(txt);
        chrome.downloads.download({ url: dataUrl, filename: `${safeMainCategory}/subcategorias.txt`, conflictAction: 'overwrite' }, (downloadId) => {
          if (chrome.runtime.lastError) {
            console.error(`[DOWNLOAD] Erro ao baixar subcategorias.txt: ${chrome.runtime.lastError.message}`);
          } else {
            console.log(`[DOWNLOAD] subcategorias.txt gerado (id ${downloadId}).`);
            state.subCategoriesTextDownloaded = true;
          }
        });
      } catch (e) {
        console.error('[DOWNLOAD] Falha ao gerar subcategorias.txt:', e);
      }
    }
    console.log(`[DEBUG] Scheduling next subcategory from handleSubCategories (initial setup). Current index: ${state.currentSubCategoryIndex}`);
    setTimeout(() => processNextSubCategory(), 1500);
  } else {
    finishDownload('Nenhuma subcategoria encontrada.');
  }
}

// --- STAGE 2: Get Products ---

function processNextSubCategory() {
  console.log(`[DEBUG] Entering processNextSubCategory. Index: ${state.currentSubCategoryIndex}, isProcessingSubCategory: ${state.isProcessingSubCategory}`);
  if (state.isProcessingSubCategory) {
    console.log('Já processando subcategoria, aguardando...');
    return;
  }
  if (state.currentSubCategoryIndex >= state.subCategories.length) {
    console.log('Todas as subcategorias processadas.');
    finishDownload();
    return;
  }
  state.isProcessingSubCategory = true;
  const subCategory = state.subCategories[state.currentSubCategoryIndex];
  state.currentSubCategoryLabel = subCategory.label; // Store the label for later use
  const subCategoryUrl = `https://www.intelbras.com${subCategory.href}/allproducts`;
  state.subcategoryTabLoaded = false;
  // Reset retries do estágio de produtos antes de mudar de subcategoria
  state.productRetries = 0;

  console.log(`Processando subcategoria [${state.currentSubCategoryIndex + 1}/${state.subCategories.length}]: ${subCategory.label} (${subCategoryUrl})`);

  if (state.subcategoryTabId) {
    chrome.tabs.update(state.subcategoryTabId, { url: subCategoryUrl, active: false }, (tab) => {
      if (chrome.runtime.lastError) {
        console.warn(`Tab update failed: ${chrome.runtime.lastError.message}, criando nova aba.`);
        chrome.tabs.create({ url: subCategoryUrl, active: false }, (newTab) => { state.subcategoryTabId = newTab.id; });
      }
    });
  } else {
    chrome.tabs.create({ url: subCategoryUrl, active: false }, (tab) => { state.subcategoryTabId = tab.id; });
  }
}

function advanceToNextSubCategory() {
  console.log(`[DEBUG] Incrementing subCategoryIndex from ${state.currentSubCategoryIndex} and advancing.`);
  state.currentSubCategoryIndex++;
  state.isProcessingProduct = false; // Ensure product processing is unlocked
  state.isProcessingSubCategory = false; // Ensure subcategory processing is unlocked before starting the next
  clearWatchdog('products');
  clearWatchdog('files');
  console.log(`[DEBUG] Scheduling next subcategory. Current index after increment: ${state.currentSubCategoryIndex}`);
  setTimeout(() => processNextSubCategory(), 2000); // Use a consistent delay
}

function handleProducts(products) {
  state.products = products;
  // Guarda a lista completa de produtos da subcategoria, independente de rodadas de reprocesso
  state.allProductsForSubcategory = Array.isArray(products) ? [...products] : [];
  state.currentProductIndex = 0;
  // Reinicia o mapa de produtos processados para esta subcategoria
  state.productsProcessed = new Map();
  // Conjunto de produtos já encontrados em execuções anteriores (retomada)
  if (!state.processedProductsIndex) {
    state.processedProductsIndex = new Set();
  }
  state.productReprocessAttempts = 0;
  // Zera o resumo; os valores finais serão recalculados em generateSubcategorySummaryFile
  state.subcategorySummary = {
    totalProducts: products.length,
    productsWithFiles: 0,
    productsWithoutFiles: [],
  };
  state.isProcessingSubCategory = false; // Unlock
  clearWatchdog('products');

  if (products.length > 0) {
    console.log(`Subcategoria "${state.currentSubCategoryLabel}" possui ${products.length} produtos. Iniciando processamento dos produtos.`);
    // Cria de imediato as pastas e um TXT inicial para TODOS os produtos encontrados,
    // garantindo correspondência 1:1 entre produtos e pastas.
    try {
      const safeMainCategory = sanitize(state.mainCategory);
      const safeSubCategoryName = sanitize(state.currentSubCategoryLabel);
      products.forEach((productPath) => {
        try {
          const parts = (productPath || '').split('/').filter(Boolean);
          const safeProductName = sanitize(parts[parts.length - 1] || 'produto_desconhecido');
          if (!safeProductName) return;

          const logFilename = `${safeMainCategory}/${safeSubCategoryName}/${safeProductName}/arquivos_${safeProductName}.txt`;
          const content = 'Pasta criada automaticamente para este produto. Arquivos serão listados aqui se encontrados.';
          const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(content);
          chrome.downloads.download({ url: dataUrl, filename: logFilename, conflictAction: 'overwrite' }, (downloadId) => {
            if (chrome.runtime.lastError) {
              console.error(`[DOWNLOAD] Erro ao criar pasta/arquivo inicial para produto (${logFilename}): ${chrome.runtime.lastError.message}`);
            } else {
              console.log(`[DOWNLOAD] Pasta/arquivo inicial de produto criada: ${logFilename} (id ${downloadId}).`);
            }
          });
        } catch (e) {
          console.error('[INIT PRODUCTS] Falha ao criar pasta inicial para produto:', e);
        }
      });
    } catch (e) {
      console.error('[INIT PRODUCTS] Erro geral ao criar pastas iniciais de produtos:', e);
    }
    // Pula imediatamente produtos já processados em execuções anteriores, se houver índice
    skipAlreadyProcessedProducts();
    processNextProduct();
  } else {
    console.log(`Subcategoria "${state.currentSubCategoryLabel}" não possui produtos. Avançando para a próxima.`);
    advanceToNextSubCategory();
  }
}

// Pula, no início da subcategoria, os produtos que já possuem pasta/gabarito
function skipAlreadyProcessedProducts() {
  try {
    if (!state.products || state.products.length === 0) return;
    if (!state.processedProductsIndex || state.processedProductsIndex.size === 0) return;

    let skipped = 0;
    while (state.currentProductIndex < state.products.length) {
      const productPath = state.products[state.currentProductIndex];
      if (state.processedProductsIndex.has(productPath)) {
        skipped++;
        state.currentProductIndex++;
      } else {
        break;
      }
    }
    if (skipped > 0) {
      console.log(`[RESUME] Pulando ${skipped} produto(s) já processado(s) anteriormente na subcategoria "${state.currentSubCategoryLabel}".`);
    }
  } catch (e) {
    console.error('[RESUME] Falha ao pular produtos já processados:', e);
  }
}

// --- STAGE 3: Get Files ---

function processNextProduct() {
  console.log(`[DEBUG] Entering processNextProduct. isProcessingProduct: ${state.isProcessingProduct}, currentProductIndex: ${state.currentProductIndex}`);
  if (state.isProcessingProduct) {
    console.log('Já processando produto, aguardando...');
    return;
  }
  if (state.currentProductIndex >= state.products.length) {
    console.log(`Todos os produtos da subcategoria "${state.currentSubCategoryLabel}" tiveram a etapa de download tentada. Gerando resumo e avançando.`);
    // Gera resumo final da subcategoria quando todos foram percorridos (com ou sem arquivos)
    generateSubcategorySummaryFile();
    advanceToNextSubCategory();
    return;
  }
      console.log(`[DEBUG] Setting isProcessingProduct = true. Current index: ${state.currentProductIndex}`);
      state.isProcessingProduct = true;  const productUrl = `https://www.intelbras.com${state.products[state.currentProductIndex]}`;

  console.log(`Processando produto [${state.currentProductIndex + 1}/${state.products.length}] da subcategoria "${state.currentSubCategoryLabel}": ${productUrl}`);

  state.productTabLoaded = false;
  chrome.tabs.create({ url: productUrl, active: false }, (tab) => {
    if (!tab) {
      console.error('Falha ao criar aba do produto');
      state.isProcessingProduct = false;
      setTimeout(() => processNextProduct(), 1000);
      return;
    }
    state.currentProductTabId = tab.id;
    // Reset retries do estágio de arquivos ao abrir nova aba de produto
    state.filesRetries = 0;
  });
}

function handleFiles(files, productTabId, explicitProductPath) {
  const safeMainCategory = sanitize(state.mainCategory);
  const safeSubCategoryName = sanitize(state.currentSubCategoryLabel);
  clearWatchdog('files');

  if (files.length === 0) {
    console.log(`Produto [${state.currentProductIndex + 1}] da subcategoria "${state.currentSubCategoryLabel}" não possui arquivos para download.`);
  }

  // Usa o caminho explícito enviado pelo content script sempre que possível,
  // evitando depender de índices que podem sair de sincronia.
  const productPath = explicitProductPath || state.products[state.currentProductIndex] || state.products[state.currentProductIndex - 1];
  let safeProductName = '';
  try {
    if (productPath) {
      const parts = productPath.split('/').filter(Boolean);
      safeProductName = sanitize(parts[parts.length - 1] || 'produto_desconhecido');
    } else {
      safeProductName = 'produto_desconhecido';
    }
  } catch (e) {
    safeProductName = 'produto_desconhecido';
  }

  const productLogLines = [];

  for (const file of files) {
    let safeFileName = sanitize(file.split('/').pop());
    // Se o nome for vazio ou inválido, pula
    if (!safeFileName || !safeMainCategory || !safeSubCategoryName) {
      console.error(`Download ignorado por filename inválido: ${safeMainCategory}/${safeSubCategoryName}/${safeFileName}`);
      continue;
    }
    // Evita nomes reservados e nomes vazios
    if (["", ".", ".."].includes(safeFileName)) {
      console.error(`Download ignorado por filename inválido: ${safeFileName}`);
      continue;
    }

    const filename = `${safeMainCategory}/${safeSubCategoryName}/${safeProductName}/${safeFileName}`;
    console.log(`Download: URL: ${file} | Destino: ${filename}`);
    productLogLines.push(`${safeFileName} -> ${file}`);

    // Evita baixar novamente URLs já baixados, mas ainda registra no gabarito
    if (state.downloadedUrls && state.downloadedUrls.has(file)) {
      console.log(`Ignorando download duplicado (mesmo URL) de: ${file}`);
    } else {
      try {
        chrome.downloads.download({ url: file, filename }, (downloadId) => {
          if (chrome.runtime.lastError) {
            console.error(`Download failed for "${filename}": ${chrome.runtime.lastError.message}`);
          } else {
            state.downloadedFiles++;
            if (state.downloadedUrls) {
              state.downloadedUrls.add(file);
            }
          }
        });
      } catch (e) {
        console.error('Erro ao iniciar download:', e);
      }
    }
  }

  // Gera/atualiza o gabarito de arquivos por produto
  if (safeMainCategory && safeSubCategoryName && safeProductName) {
    try {
      const logContent = productLogLines.length > 0
        ? productLogLines.join('\r\n')
        : 'Nenhum arquivo novo para este produto (apenas URLs já baixadas em outros produtos).';
      const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(logContent);
      const logFilename = `${safeMainCategory}/${safeSubCategoryName}/${safeProductName}/arquivos_${safeProductName}.txt`;
      chrome.downloads.download({ url: dataUrl, filename: logFilename, conflictAction: 'overwrite' }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error(`[DOWNLOAD] Erro ao gerar gabarito de produto (${logFilename}): ${chrome.runtime.lastError.message}`);
        } else {
          console.log(`[DOWNLOAD] Gabarito de produto gerado/atualizado: ${logFilename} (id ${downloadId}).`);
          // Marca o produto como processado com sucesso
          if (state.productsProcessed && productPath) {
            state.productsProcessed.set(productPath, true);
          }
          // Atualiza índice de retomada para próximas execuções
          if (state.processedProductsIndex && productPath) {
            state.processedProductsIndex.add(productPath);
          }
          // Atualiza resumo da subcategoria
          if (state.subcategorySummary && productPath) {
            if (productLogLines.length > 0) {
              state.subcategorySummary.productsWithFiles++;
            } else {
              state.subcategorySummary.productsWithoutFiles.push(productPath);
            }
          }
        }
      });
    } catch (e) {
      console.error('[DOWNLOAD] Falha ao gerar gabarito de produto:', e);
    }
  }

  if (productTabId) {
    try { chrome.tabs.remove(productTabId); } catch (e) { console.log(`Failed to remove tab ${productTabId}: ${e.message}`); }
  }
  state.currentProductTabId = null;
  state.currentProductIndex++;
  state.isProcessingProduct = false; // Unlock

  setTimeout(() => processNextProduct(), 500);
}

// Gera um arquivo de resumo para a subcategoria atual, com estatísticas de produtos
function generateSubcategorySummaryFile() {
  try {
    if (!state.subcategorySummary) return;
    const safeMainCategory = sanitize(state.mainCategory);
    const safeSubCategoryName = sanitize(state.currentSubCategoryLabel);
    if (!safeMainCategory || !safeSubCategoryName) return;
    const summary = state.subcategorySummary;

    // Recalcula contagens com base na lista COMPLETA de produtos da subcategoria
    // e no mapa productsProcessed (que é preenchido quando o TXT do produto é gerado)
    const allProducts = Array.isArray(state.allProductsForSubcategory)
      ? state.allProductsForSubcategory
      : Array.isArray(state.products)
        ? state.products
        : [];

    let productsWithFiles = 0;
    const productsWithoutFiles = [];

    if (allProducts.length > 0 && state.productsProcessed) {
      allProducts.forEach((productPath) => {
        const processed = state.productsProcessed.get(productPath);
        if (processed) {
          // Produto que teve TXT gerado (mesmo que só com URLs já baixadas)
          productsWithFiles++;
        } else {
          // Produto visto na subcategoria, mas que não chegou a gerar TXT
          productsWithoutFiles.push(productPath);
        }
      });
    }

    summary.totalProducts = allProducts.length;
    summary.productsWithFiles = productsWithFiles;
    summary.productsWithoutFiles = productsWithoutFiles;
    const lines = [];
    lines.push(`Categoria principal: ${state.mainCategory}`);
    lines.push(`Subcategoria: ${state.currentSubCategoryLabel}`);
    lines.push(`Total de produtos encontrados (páginas percorridas): ${summary.totalProducts}`);
    lines.push(`Produtos com TXT gerado (com ou sem arquivos novos): ${summary.productsWithFiles}`);
    const withoutCount = summary.productsWithoutFiles.length;
    lines.push(`Produtos sem TXT/sem arquivos após tentativas: ${withoutCount}`);
    if (withoutCount > 0) {
      lines.push('Lista de produtos sem arquivos:');
      summary.productsWithoutFiles.forEach((p, idx) => {
        lines.push(`${idx + 1}. https://www.intelbras.com${p}`);
      });
    }

    const content = lines.join('\r\n');
    const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(content);
    const summaryFilename = `${safeMainCategory}/${safeSubCategoryName}/resumo_${safeSubCategoryName}.txt`;
    chrome.downloads.download({ url: dataUrl, filename: summaryFilename, conflictAction: 'overwrite' }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error(`[DOWNLOAD] Erro ao gerar resumo da subcategoria (${summaryFilename}): ${chrome.runtime.lastError.message}`);
      } else {
        console.log(`[DOWNLOAD] Resumo da subcategoria gerado: ${summaryFilename} (id ${downloadId}).`);
      }
    });
  } catch (e) {
    console.error('[DOWNLOAD] Falha ao gerar resumo da subcategoria:', e);
  }
}

// --- FINISH ---

function finishDownload(message) {
  if (state.isFinished) return;
  state.isFinished = true;
  clearWatchdog('subcategories');
  clearWatchdog('products');
  clearWatchdog('files');
  const finalMessage = message || `${state.downloadedFiles} arquivos foram baixados com sucesso!`;
  chrome.notifications.create({ type: 'basic', iconUrl: 'images/Intelbras-logo-3-1.png', title: 'Processo Finalizado', message: finalMessage });
  // Não fecha a aba principal da categoria
  // if (state.mainCategoryTabId) chrome.tabs.remove(state.mainCategoryTabId).catch(e=>console.log(e));
  if (state.subcategoryTabId) chrome.tabs.remove(state.subcategoryTabId).catch(e=>console.log(e));
  if (state.currentProductTabId) chrome.tabs.remove(state.currentProductTabId).catch(e=>console.log(e));
}

