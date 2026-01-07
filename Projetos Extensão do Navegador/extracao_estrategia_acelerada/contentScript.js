// Extrai o objeto __PRELOADED_STATE__ de um texto de script bruto
function extrairPreloadedStateDeTexto(conteudo) {
  const marcador = '__PRELOADED_STATE__';
  const idx = conteudo.indexOf(marcador);
  if (idx === -1) return null;

  const igual = conteudo.indexOf('=', idx);
  if (igual === -1) return null;

  const inicioObjeto = conteudo.indexOf('{', igual);
  if (inicioObjeto === -1) return null;

  let nivel = 0;
  let fimObjeto = -1;

  for (let i = inicioObjeto; i < conteudo.length; i++) {
    const ch = conteudo[i];
    if (ch === '{') {
      nivel++;
    } else if (ch === '}') {
      nivel--;
      if (nivel === 0) {
        fimObjeto = i + 1;
        break;
      }
    }
  }

  if (fimObjeto === -1) return null;

  const jsonStr = conteudo.slice(inicioObjeto, fimObjeto);
  try {
    // O conteúdo é quase JSON, mas contém sequências \xNN que
    // não são válidas em JSON. Convertendo \xNN -> \u00NN,
    // o restante da estrutura passa a ser parseável por JSON.parse.
    const normalizado = jsonStr.replace(/\\x([0-9A-Fa-f]{2})/g, '\\u00$1');
    const obj = JSON.parse(normalizado);
    if (obj && typeof obj === 'object') {
      return obj;
    }
  } catch (e) {
    // Se falhar, retorna null e deixamos o chamador tentar outra fonte
  }

  return null;
}

// Alguns links da Intelbras expõem URLs "intermediárias" no domínio
// principal (www.intelbras.com/pt-br/algum-arquivo.pdf) que não são
// arquivos reais, apenas páginas HTML de redirecionamento. Esses
// links costumam gerar erros de download (404 ou "nenhum arquivo").
// Esta função identifica esse padrão para que possamos ignorá-lo.
function ehUrlIntermediariaIntelbras(url) {
  if (!url) return false;

  try {
    const u = new URL(url, window.location.href);
    const host = (u.hostname || '').toLowerCase();
    const path = (u.pathname || '').toLowerCase();

    const terminaComPdf = /\.pdf(\?|#|$)/i.test(path);
    const ehDominioPrincipalIntelbras = host === 'www.intelbras.com';
    const contemSitesDefaultFiles = path.includes('/sites/default/files/');

    // PDFs servidos diretamente do domínio principal, fora de
    // /sites/default/files/, costumam ser apenas páginas HTML de
    // download e não o arquivo de fato.
    if (terminaComPdf && ehDominioPrincipalIntelbras && !contemSitesDefaultFiles) {
      return true;
    }

    return false;
  } catch (e) {
    return false;
  }
}

// Procura o __PRELOADED_STATE__ em scripts inline da página
function tentarObterPreloadedStateInline() {
  const scripts = document.querySelectorAll('head script, body script');

  for (const script of scripts) {
    const conteudo = script.textContent || '';
    if (!conteudo) continue;

    const obj = extrairPreloadedStateDeTexto(conteudo);
    if (obj) return obj;
  }

  return null;
}

// Cache simples para evitar buscar o estado várias vezes
let cachePreloadedState = null;
let preloadedStateCarregado = false;

// Tenta obter o __PRELOADED_STATE__ tanto de scripts inline quanto de
// arquivos JS externos. Isso imita o que você faz buscando
// "window.__PRELOADED_STATE__" no DevTools.
function obterPreloadedState(callback) {
  if (preloadedStateCarregado) {
    callback(cachePreloadedState);
    return;
  }

  preloadedStateCarregado = true;

  // 1) Primeiro tenta em scripts inline
  const inline = tentarObterPreloadedStateInline();
  if (inline) {
    cachePreloadedState = inline;
    callback(cachePreloadedState);
    return;
  }

  // 2) Se não achou em inline, tenta buscar nos arquivos JS externos
  const scriptsExternos = Array.from(document.querySelectorAll('script[src]'));

  if (!scriptsExternos.length) {
    cachePreloadedState = null;
    callback(null);
    return;
  }

  let indice = 0;

  function tentarProximo() {
    if (indice >= scriptsExternos.length) {
      cachePreloadedState = null;
      callback(null);
      return;
    }

    const script = scriptsExternos[indice];
    indice += 1;

    const src = script.src;
    if (!src) {
      tentarProximo();
      return;
    }

    // Evita URLs muito estranhas (dados, etc.)
    if (/^data:/i.test(src)) {
      tentarProximo();
      return;
    }

    fetch(src, { credentials: 'include' })
      .then((resp) => {
        if (!resp.ok) {
          tentarProximo();
          return null;
        }
        return resp.text();
      })
      .then((texto) => {
        if (!texto) {
          tentarProximo();
          return;
        }

        const obj = extrairPreloadedStateDeTexto(texto);
        if (obj) {
          cachePreloadedState = obj;
          callback(cachePreloadedState);
        } else {
          tentarProximo();
        }
      })
      .catch(() => {
        tentarProximo();
      });
  }

  tentarProximo();
}

function coletarLinksAPartirDoEstado(estado) {
  if (!estado || !estado.pages || !estado.pages.page || !estado.pages.page.main_data) {
    return [];
  }

  const main = estado.pages.page.main_data;
  const downloads = Array.isArray(main.fieldProductDownloads) ? main.fieldProductDownloads : [];
  const itens = [];

  for (const entrada of downloads) {
    const entity = entrada && entrada.entity;
    if (!entity) continue;

    const fileEntity =
      entity.fieldProductDownloadFile &&
      entity.fieldProductDownloadFile.entity &&
      entity.fieldProductDownloadFile.entity.fieldMediaFile &&
      entity.fieldProductDownloadFile.entity.fieldMediaFile.entity;

    if (!fileEntity || !fileEntity.url) continue;

    let url = fileEntity.url;

    try {
      url = new URL(fileEntity.url, window.location.href).href;
    } catch (e) {
      // mantemos a URL original em caso de erro
    }

    // Ignora URLs intermediárias conhecidas que não são arquivos reais.
    if (ehUrlIntermediariaIntelbras(url)) continue;

    let nomeArquivo = '';
    try {
      const u = new URL(url, window.location.href);
      const partes = u.pathname.split('/').filter(Boolean);
      if (partes.length > 0) {
        nomeArquivo = decodeURIComponent(partes[partes.length - 1]);
      }
    } catch (e) {
      nomeArquivo = fileEntity.filename || '';
    }

    const titulo = entity.title || fileEntity.filename || nomeArquivo || 'Arquivo';

    itens.push({
      url,
      texto: titulo,
      nomeArquivo,
      origem: 'preloaded_state_download',
    });
  }

  // Imagens principais do produto (cores, capa, galeria)
  const detalhes = Array.isArray(main.fieldProductDetailsByColor) ? main.fieldProductDetailsByColor : [];
  for (const det of detalhes) {
    const ent = det && det.entity;
    if (!ent) continue;

    const imagensPossiveis = [];

    if (ent.fieldProdDetailsBcolorImage && ent.fieldProdDetailsBcolorImage.entity) {
      imagensPossiveis.push(ent.fieldProdDetailsBcolorImage.entity.fieldMediaImage);
    }

    if (ent.fieldProdDetailsBcolorCover && ent.fieldProdDetailsBcolorCover.entity) {
      imagensPossiveis.push(ent.fieldProdDetailsBcolorCover.entity.fieldMediaImage);
    }

    if (Array.isArray(ent.fieldProdDetailsBcolGallery)) {
      for (const g of ent.fieldProdDetailsBcolGallery) {
        if (g && g.entity) {
          imagensPossiveis.push(g.entity.fieldMediaImage);
        }
      }
    }

    for (const media of imagensPossiveis) {
      if (!media || !media.url) continue;
      let url = media.url;

      try {
        url = new URL(media.url, window.location.href).href;
      } catch (e) {
        // mantém URL original em caso de erro
      }

      let nomeArquivoImg = '';
      try {
        const u = new URL(url, window.location.href);
        const partes = u.pathname.split('/').filter(Boolean);
        if (partes.length > 0) {
          nomeArquivoImg = decodeURIComponent(partes[partes.length - 1]);
        }
      } catch (e) {
        nomeArquivoImg = '';
      }

      const textoImg = media.alt || main.title || nomeArquivoImg || 'Imagem do produto';

      itens.push({
        url,
        texto: textoImg,
        nomeArquivo: nomeArquivoImg,
        origem: 'preloaded_state_imagem',
      });
    }
  }

  // Imagens de "Onde usar" (fieldProductWheretouse)
  const wheres = Array.isArray(main.fieldProductWheretouse) ? main.fieldProductWheretouse : [];
  for (const w of wheres) {
    const ent = w && w.entity;
    if (!ent || !ent.fieldProductWheretousePlace || !ent.fieldProductWheretousePlace.entity) continue;

    const place = ent.fieldProductWheretousePlace.entity;
    const imgWrapper =
      place.fieldWheretouseImage &&
      place.fieldWheretouseImage.entity &&
      place.fieldWheretouseImage.entity.fieldMediaImage;

    if (!imgWrapper || !imgWrapper.url) continue;

    let url = imgWrapper.url;

    try {
      url = new URL(imgWrapper.url, window.location.href).href;
    } catch (e) {
      // mantém URL original em caso de erro
    }
    let nomeArquivoImg = '';
    try {
      const u = new URL(url, window.location.href);
      const partes = u.pathname.split('/').filter(Boolean);
      if (partes.length > 0) {
        nomeArquivoImg = decodeURIComponent(partes[partes.length - 1]);
      }
    } catch (e) {
      nomeArquivoImg = '';
    }

    const textoImg = imgWrapper.alt || place.name || nomeArquivoImg || 'Imagem de uso';

    itens.push({
      url,
      texto: textoImg,
      nomeArquivo: nomeArquivoImg,
      origem: 'preloaded_state_imagem_uso',
    });
  }

  // Coletor genérico de quaisquer imagens no objeto main (caso a estrutura mude)
  function coletarImagensGenericas(no) {
    if (!no || typeof no !== 'object') return;

    if (Array.isArray(no)) {
      no.forEach(coletarImagensGenericas);
      return;
    }

    // Se tiver uma URL de imagem diretamente neste nó
    if (typeof no.url === 'string' && /\.(png|jpe?g|webp|gif|svg)(\?|#|$)/i.test(no.url)) {
      const url = no.url;

      let nomeArquivoImg = '';
      try {
        const u = new URL(url, window.location.href);
        const partes = u.pathname.split('/').filter(Boolean);
        if (partes.length > 0) {
          nomeArquivoImg = decodeURIComponent(partes[partes.length - 1]);
        }
      } catch (e) {
        nomeArquivoImg = '';
      }

      const textoImg = no.alt || no.title || no.name || nomeArquivoImg || 'Imagem';

      itens.push({
        url,
        texto: textoImg,
        nomeArquivo: nomeArquivoImg,
        origem: 'preloaded_state_imagem_generica',
      });
    }

    for (const chave of Object.keys(no)) {
      coletarImagensGenericas(no[chave]);
    }
  }

  // Em vez de limitar apenas a main_data, percorremos todo o estado,
  // pois algumas páginas podem guardar imagens em outras chaves.
  coletarImagensGenericas(estado);

  // Retorna todos os itens encontrados, mesmo que haja URLs repetidas,
  // preservando o mesmo volume de arquivos que o comportamento original.
  return itens;
}

// Varre o DOM em busca de links de arquivos visíveis na página (além do JSON)
function coletarLinksPDFDoDOM() {
  const itens = [];

  function adicionar(urlBruta, texto, origem) {
    if (!urlBruta) return;
    let urlAbsoluta = urlBruta;
    try {
      urlAbsoluta = new URL(urlBruta, window.location.href).href;
    } catch (e) {
      // se não conseguir resolver, usa como veio
    }

    // Evita baixar URLs intermediárias conhecidas que não apontam
    // diretamente para o arquivo (por exemplo, páginas HTML em
    // www.intelbras.com/pt-br/algum-arquivo.pdf).
    if (ehUrlIntermediariaIntelbras(urlAbsoluta)) return;

    let nomeArquivo = '';
    try {
      const u = new URL(urlAbsoluta, window.location.href);
      const partes = u.pathname.split('/').filter(Boolean);
      if (partes.length > 0) {
        nomeArquivo = decodeURIComponent(partes[partes.length - 1]);
      }
    } catch (e) {
      nomeArquivo = '';
    }

    const textoFinal = (texto || '').trim() || nomeArquivo || 'Arquivo';

    itens.push({
      url: urlAbsoluta,
      texto: textoFinal,
      nomeArquivo,
      origem: origem || 'dom_pdf_link',
    });
  }

  // Links diretos <a href="..."> com extensões de arquivos conhecidas
  const anchors = document.querySelectorAll('a[href]');
  anchors.forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (!href) return;
    const alvo = href.toLowerCase();

    // PDF, imagens e outros tipos de arquivo (zip, docx, xlsx, etc.)
    if (!/\.(pdf|png|jpe?g|webp|gif|svg|zip|rar|7z|tar|gz|bz2|xz|docx?|xlsx?|pptx?|csv)(\?|#|$)/i.test(alvo)) {
      return;
    }

    const texto = (a.textContent || '').trim() || a.getAttribute('title') || '';

    let origem = 'dom_arquivo_link';
    if (/\.pdf(\?|#|$)/i.test(alvo)) {
      origem = 'dom_pdf_link';
    }

    adicionar(href, texto, origem);
  });

  // Possíveis PDFs embutidos em <iframe> ou <embed>
  const embeds = document.querySelectorAll('iframe[src], embed[src]');
  embeds.forEach((el) => {
    const src = el.getAttribute('src') || '';
    if (!src) return;
    const alvo = src.toLowerCase();
    if (!/\.pdf(\?|#|$)/i.test(alvo)) return;

    const texto = el.getAttribute('title') || '';
    adicionar(src, texto, 'dom_pdf_embed');
  });

  return itens;
}

// Varre a página em busca de links de arquivos, combinando JSON (__PRELOADED_STATE__) e DOM
function coletarLinksPDF(estado) {
  const doEstado = coletarLinksAPartirDoEstado(estado) || [];
  const doDom = coletarLinksPDFDoDOM() || [];

  // NÃO faz deduplicação aqui: retorna tudo que veio do JSON
  // e todos os arquivos encontrados no DOM, preservando o
  // comportamento antigo de volume de links (pode haver URLs
  // repetidas aparecendo mais de uma vez).
  return doEstado.concat(doDom);
}

function obterNomeProduto() {
  const titulo = (document.title || '').trim();
  if (titulo) return titulo;

  try {
    return window.location.hostname || 'Produto';
  } catch (e) {
    return 'Produto';
  }
}

function obterCodigoReferenciaProduto(estado) {
  if (!estado) {
    estado = tentarObterPreloadedStateInline();
  }
  try {
    // 1) Caminho "clássico" se existir
    let crm =
      estado &&
      estado.pages &&
      estado.pages.page &&
      estado.pages.page.main_data &&
      estado.pages.page.main_data.fieldProductCrmId;

    // 2) Se não achar, varre o objeto inteiro procurando qualquer campo chamado "fieldProductCrmId"
    if (!crm && estado && typeof estado === 'object') {
      const visitados = new Set();

      function buscarCrm(no) {
        if (!no || typeof no !== 'object') return null;
        if (visitados.has(no)) return null;
        visitados.add(no);

        if (Object.prototype.hasOwnProperty.call(no, 'fieldProductCrmId')) {
          return no.fieldProductCrmId;
        }

        if (Array.isArray(no)) {
          for (const item of no) {
            const r = buscarCrm(item);
            if (r) return r;
          }
        } else {
          for (const chave of Object.keys(no)) {
            const r = buscarCrm(no[chave]);
            if (r) return r;
          }
        }
        return null;
      }

      crm = buscarCrm(estado);
    }

    if (!crm) return null;
    const apenasDigitos = String(crm).replace(/\D/g, '');
    return apenasDigitos || null;
  } catch (e) {
    return null;
  }
}

// Responde mensagens vindas do popup
chrome.runtime.onMessage.addListener((mensagem, _sender, sendResponse) => {
  if (mensagem.tipo === 'OBTER_PDFS') {
    obterPreloadedState((estado) => {
      const pdfs = coletarLinksPDF(estado);
      const codigoReferencia = obterCodigoReferenciaProduto(estado);
      const produto = obterNomeProduto();

      sendResponse({
        pdfs,
        produto,
        jsonEncontrado: !!estado,
        codigoReferencia: codigoReferencia || null,
      });
    });
    // Indica que vamos responder de forma assíncrona
    return true;
  }
  return false;
});
