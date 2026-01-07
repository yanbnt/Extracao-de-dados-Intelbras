const PRODUTO_PADRAO = 'Produto';

// --- Monitoramento e tentativa de correção de downloads que falham ---

// Número máximo de novas tentativas automáticas para um mesmo arquivo
const MAX_TENTATIVAS_REDOWNLOAD = 2;

// Mapa simples em memória para acompanhar os downloads iniciados pela extensão.
// Chaveada pelo ID do download original retornado pelo chrome.downloads.download.
// Como o background é um service worker, esse mapa é melhor-esforço (pode ser
// limpo se o worker for descarregado), mas é suficiente para acompanhar
// downloads ativos.
const mapaDownloadsPorId = new Map();

function registrarDownloadIniciado(downloadId, dados) {
  if (typeof downloadId !== 'number') return;
  if (!dados || !dados.url || !dados.filename) return;

  mapaDownloadsPorId.set(downloadId, {
    url: dados.url,
    filename: dados.filename,
    produto: dados.produto || PRODUTO_PADRAO,
    codigoReferencia: dados.codigoReferencia || null,
    tentativas: 0,
  });
}

// Alguns links da Intelbras expõem URLs "intermediárias" no domínio
// principal (www.intelbras.com/pt-br/algum-arquivo.pdf) que não são
// arquivos reais, apenas páginas HTML de redirecionamento. Esses
// links costumam gerar erros de download (404 ou "nenhum arquivo").
// Esta função identifica esse padrão para que possamos ignorá-lo.
function ehUrlIntermediariaIntelbras(url) {
  if (!url) return false;

  try {
    const u = new URL(url);
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

// Limpa apenas o cache do domínio de uma URL específica, para tentar
// corrigir problemas intermitentes de 404 / arquivo não encontrado que
// estão relacionados a conteúdo em cache.
function limparCacheParaUrl(url, callback) {
  try {
    if (!chrome.browsingData || !chrome.browsingData.remove) {
      if (typeof callback === 'function') callback();
      return;
    }

    let origem;
    try {
      const u = new URL(url);
      origem = `${u.protocol}//${u.hostname}`;
    } catch (e) {
      if (typeof callback === 'function') callback();
      return;
    }

    const removalOptions = {
      origins: [origem],
      since: 0,
    };

    const dataToRemove = {
      cache: true,
    };

    chrome.browsingData.remove(removalOptions, dataToRemove, () => {
      if (typeof callback === 'function') callback();
    });
  } catch (e) {
    if (typeof callback === 'function') callback();
  }
}

// Alguns erros de download são potencialmente recuperáveis (rede instável,
// servidor temporariamente indisponível, conteúdo em cache corrompido, etc.).
function erroDeDownloadRecuperavel(codigoErro) {
  if (!codigoErro) return false;
  const recuperaveis = new Set([
    'NETWORK_FAILED',
    'SERVER_FAILED',
    'TEMPORARY_PROBLEM',
    'FILE_FAILED',
    'SERVER_BAD_CONTENT',
  ]);
  return recuperaveis.has(codigoErro);
}

// Observa mudanças nos downloads iniciados pela extensão. Quando um deles é
// interrompido com um erro potencialmente recuperável, a extensão tenta
// automaticamente limpar o cache do domínio e refazer o download algumas vezes.
if (chrome && chrome.downloads && chrome.downloads.onChanged) {
  chrome.downloads.onChanged.addListener((delta) => {
    if (!delta || typeof delta.id !== 'number') return;

    const id = delta.id;

    if (!delta.state || delta.state.current !== 'interrupted') {
      return;
    }

    const codigoErro = delta.error && delta.error.current ? delta.error.current : '';
    if (!erroDeDownloadRecuperavel(codigoErro)) {
      return;
    }

    const infoOriginal = mapaDownloadsPorId.get(id);
    if (!infoOriginal || !infoOriginal.url || !infoOriginal.filename) {
      // Download que não foi iniciado por esta extensão, ou sem dados
      // suficientes para tentar recomeçar.
      return;
    }

    const tentativasAtuais = typeof infoOriginal.tentativas === 'number' ? infoOriginal.tentativas : 0;
    if (tentativasAtuais >= MAX_TENTATIVAS_REDOWNLOAD) {
      // Avisa o popup (se estiver aberto) que desistimos deste arquivo.
      try {
        chrome.runtime.sendMessage({
          tipo: 'DOWNLOAD_FALHOU_DEFINITIVAMENTE',
          url: infoOriginal.url,
          filename: infoOriginal.filename,
          produto: infoOriginal.produto || PRODUTO_PADRAO,
          codigoReferencia: infoOriginal.codigoReferencia || null,
          erro: codigoErro || 'erro_desconhecido',
        }, () => {
          const err = chrome.runtime.lastError;
          if (err && err.message && !/Receiving end does not exist/i.test(err.message)) {
            console.warn('Erro ao notificar popup sobre falha definitiva de download:', err.message);
          }
        });
      } catch (e) {
        // Se não houver popup ouvindo, apenas ignora.
      }

      return;
    }

    const novasTentativas = tentativasAtuais + 1;
    infoOriginal.tentativas = novasTentativas;
    mapaDownloadsPorId.set(id, infoOriginal);

    // Primeiro limpa o cache do domínio, depois tenta baixar de novo com
    // a mesma URL e o mesmo caminho relativo de arquivo usado originalmente.
    limparCacheParaUrl(infoOriginal.url, () => {
      chrome.downloads.download(
        {
          url: infoOriginal.url,
          filename: infoOriginal.filename,
          conflictAction: 'overwrite',
        },
        (novoId) => {
          const err = chrome.runtime.lastError;
          if (err) {
            console.warn('Falha ao tentar reiniciar download após erro:', err.message);
            return;
          }

          if (typeof novoId === 'number') {
            mapaDownloadsPorId.set(novoId, { ...infoOriginal, tentativas: novasTentativas });
          }
        },
      );
    });
  });
}

// --- Utilitários de parsing do __PRELOADED_STATE__ (versão background) ---

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
    const normalizado = jsonStr.replace(/\\x([0-9A-Fa-f]{2})/g, '\\u00$1');
    const obj = JSON.parse(normalizado);
    if (obj && typeof obj === 'object') {
      return obj;
    }
  } catch (e) {
    // deixa retornar null
  }

  return null;
}

// Fallback: tenta extrair o fieldProductCrmId diretamente do HTML bruto,
// caso o __PRELOADED_STATE__ não possa ser parseado corretamente.
function obterCodigoReferenciaDeHtmlBruto(html) {
  if (!html || typeof html !== 'string') return null;

  try {
    const candidatos = [
      // JSON inline padrão: "fieldProductCrmId":"485690 ETX"
      /fieldProductCrmId\"?\s*[:=]\s*\"?([^\"\n\r<>{}]+)/i,
      // Variação snake_case: "field_product_crm_id":"485690 ETX"
      /field[_-]?product[_-]?crm[_-]?id\"?\s*[:=]\s*\"?([^\"\n\r<>{}]+)/i,
      // Atributos HTML ou data-attributes contendo o nome do campo e o número
      /fieldProductCrmId[^0-9]{0,80}([0-9]{3,})/i,
      /field[_-]?product[_-]?crm[_-]?id[^0-9]{0,80}([0-9]{3,})/i,
      // Fallback bem amplo: qualquer coisa com "crm" perto de um número grande
      /crm[^0-9]{0,80}([0-9]{3,})/i,
    ];

    for (const regex of candidatos) {
      const m = html.match(regex);
      if (m && m[1]) {
        const apenasDigitos = String(m[1]).replace(/\D/g, '');
        if (apenasDigitos) return apenasDigitos;
      }
    }

    return null;
  } catch (e) {
    return null;
  }
}

function coletarLinksAPartirDoEstado(estado, baseUrl) {
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

    // Normaliza a URL em relação à página de origem, quando possível.
    try {
      if (baseUrl) {
        url = new URL(fileEntity.url, baseUrl).href;
      }
    } catch (e) {
      // Se não conseguir normalizar, mantém como veio.
    }

    // Ignora URLs intermediárias conhecidas que não são arquivos reais.
    if (ehUrlIntermediariaIntelbras(url)) continue;

    let nomeArquivo = '';
    try {
      const u = new URL(url);
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
        if (baseUrl) {
          url = new URL(media.url, baseUrl).href;
        }
      } catch (e) {
        // mantém URL original em caso de erro
      }

      let nomeArquivoImg = '';
      try {
        const u = new URL(url);
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
      if (baseUrl) {
        url = new URL(imgWrapper.url, baseUrl).href;
      }
    } catch (e) {
      // mantém URL original em caso de erro
    }
    let nomeArquivoImg = '';
    try {
      const u = new URL(url);
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

  return itens;
}

function obterCodigoReferenciaProduto(estado) {
  try {
    let crm =
      estado &&
      estado.pages &&
      estado.pages.page &&
      estado.pages.page.main_data &&
      estado.pages.page.main_data.fieldProductCrmId;

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

function obterNomeProdutoAPartirDaUrl(url) {
  try {
    const u = new URL(url);
    const partes = u.pathname.split('/').filter(Boolean);
    if (partes.length === 0) return PRODUTO_PADRAO;
    return partes[partes.length - 1] || PRODUTO_PADRAO;
  } catch (e) {
    return PRODUTO_PADRAO;
  }
}

function ehImagemNoBackground(item) {
  if (!item) return false;
  const origem = item.origem || '';
  const nome = item.nomeArquivo || '';
  const url = item.url || '';
  const alvo = (nome || url).toLowerCase();

  if (
    origem === 'preloaded_state_imagem' ||
    origem === 'preloaded_state_imagem_uso' ||
    origem === 'preloaded_state_imagem_generica'
  ) {
    return true;
  }

  return /\.(png|jpe?g|webp|gif|svg)(\?|#|$)/i.test(alvo);
}

// Extrai links de PDFs diretamente do HTML da página (href/src com .pdf)
function coletarLinksPDFDeHtml(html, baseUrl) {
  if (!html) return [];

  const itens = [];

  function adicionarUrl(urlBruta) {
    if (!urlBruta) return;

    let urlAbsoluta = urlBruta;
    try {
      urlAbsoluta = new URL(urlBruta, baseUrl).href;
    } catch (e) {
      // se não conseguir normalizar, usa como está
    }

    // Evita baixar URLs intermediárias conhecidas que não apontam
    // diretamente para o arquivo (por exemplo, páginas HTML em
    // www.intelbras.com/pt-br/algum-arquivo.pdf).
    if (ehUrlIntermediariaIntelbras(urlAbsoluta)) return;

    let nomeArquivo = '';
    try {
      const u = new URL(urlAbsoluta, baseUrl);
      const partes = u.pathname.split('/').filter(Boolean);
      if (partes.length > 0) {
        nomeArquivo = decodeURIComponent(partes[partes.length - 1]);
      }
    } catch (e) {
      nomeArquivo = '';
    }

    const texto = nomeArquivo || 'Arquivo';

    itens.push({
      url: urlAbsoluta,
      texto,
      nomeArquivo,
      // Mantém a origem "html_pdf_link" apenas para PDFs; para
      // outros tipos comuns de arquivo (zip, docx, xlsx etc.) usa
      // uma origem distinta para não forçar o tratamento como PDF.
      origem: /\.pdf(\?|#|$)/i.test(urlAbsoluta) ? 'html_pdf_link' : 'html_arquivo_link',
    });
  }

  // Conjunto de extensões de arquivos que nos interessam.
  const extensoesArquivos = '(pdf|png|jpe?g|webp|gif|svg|zip|rar|7z|tar|gz|bz2|xz|docx?|xlsx?|pptx?|csv|rpm|msi|exe)';

  // 1) href="...arquivo" ou src="...arquivo" com extensões conhecidas
  const regexAtributos = new RegExp(`(href|src)\\s*=\\s*(["'])([^"']+\\.${extensoesArquivos}[^"']*)\\2`, 'gi');
  let match;
  while ((match = regexAtributos.exec(html)) !== null) {
    adicionarUrl(match[3] || '');
  }

  // 1b) href=/...arquivo ou src=/...arquivo (sem aspas)
  const regexAtributosSemAspas = new RegExp(`(href|src)\\s*=\\s*([^"'\\s>]+\\.${extensoesArquivos}[^\\s>"']*)`, 'gi');
  while ((match = regexAtributosSemAspas.exec(html)) !== null) {
    adicionarUrl(match[2] || '');
  }

  // 2) Qualquer string entre aspas contendo as extensões de arquivo (ex.: em JSON inline)
  const regexStrings = new RegExp(`["']([^"']+\\.${extensoesArquivos}[^"']*)["']`, 'gi');
  while ((match = regexStrings.exec(html)) !== null) {
    adicionarUrl(match[1] || '');
  }

  // 3) URLs absolutas http(s) com extensões de arquivo fora de aspas
  const regexAbsolutas = new RegExp(`https?:\/\/[^\\s"'<>]+\\.${extensoesArquivos}[^\\s"'<>]*`, 'gi');
  while ((match = regexAbsolutas.exec(html)) !== null) {
    adicionarUrl(match[0] || '');
  }

  return itens;
}

async function processarListaDePaginas(urls) {
  if (!urls || !urls.length) {
    chrome.storage.local.set({ statusTexto: 'Nenhum link válido informado.' });
    return;
  }

  let indiceAtual = 0;
  const total = urls.length;
  const coletados = [];
  let paginasComArquivos = 0;
  let paginasSemArquivos = 0;
  let paginasErro = 0;
  const paginasSemArquivosDetalhes = [];
  const paginasErroDetalhes = [];

  try {
    chrome.storage.local.set({
      statusTexto: `Iniciando processamento de ${total} página(s)...`,
      progressoAtual: 0,
      progressoTotal: total,
      processamentoEmAndamento: true,
    }, () => {
      // Ignora chrome.runtime.lastError (quota, etc.).
    });
  } catch (e) {
    // Ignora erros síncronos improváveis.
  }

  while (indiceAtual < total) {
    const url = urls[indiceAtual];
    // Para não estourar o limite de gravações do chrome.storage,
    // atualiza o status apenas em algumas iterações.
    if (indiceAtual === 0 || indiceAtual === total - 1 || indiceAtual % 5 === 0) {
      try {
        chrome.storage.local.set({
          statusTexto: `Consultando página ${indiceAtual + 1} de ${total}...`,
          progressoAtual: indiceAtual,
          progressoTotal: total,
          processamentoEmAndamento: true,
        }, () => {
          // Ignora chrome.runtime.lastError (quota, etc.).
        });
      } catch (e) {
        // Ignora erros síncronos.
      }
    }

    try {
      const resp = await fetch(url, { credentials: 'include' });
      if (resp.ok) {
        const html = await resp.text();
        const estado = extrairPreloadedStateDeTexto(html);
        const itensHtml = coletarLinksPDFDeHtml(html, url) || [];

        let itensEstadoFiltrados = [];
        if (estado) {
          const todosItens = coletarLinksAPartirDoEstado(estado, url) || [];
          itensEstadoFiltrados = todosItens.filter((item) => {
            if (!item) return false;
            const origem = item.origem || '';
            const urlItem = (item.url || '').toLowerCase();

            // Mantém documentos e imagens principais (mas ignora imagens genéricas demais)
            if (
              origem === 'preloaded_state_download' ||
              origem === 'preloaded_state_imagem' ||
              origem === 'preloaded_state_imagem_uso'
            ) {
              return true;
            }

            if (/\.pdf(\?|#|$)/i.test(urlItem)) return true;
            if (/\.(png|jpe?g|webp|gif|svg)(\?|#|$)/i.test(urlItem)) return true;

            return false;
          });
        }

        if (itensEstadoFiltrados.length || itensHtml.length) {
          let codigoRef = estado ? obterCodigoReferenciaProduto(estado) : null;
          if (!codigoRef) {
            codigoRef = obterCodigoReferenciaDeHtmlBruto(html);
          }
          const nomeProduto = obterNomeProdutoAPartirDaUrl(url) || PRODUTO_PADRAO;

          const itensPagina = [];

          // Mantém todos os itens vindos do estado (JSON)
          for (const item of itensEstadoFiltrados) {
            if (!item || !item.url) continue;
            itensPagina.push({
              ...item,
              produto: nomeProduto,
              codigoReferencia: codigoRef || null,
            });
          }

          // E também todos os PDFs/arquivos vindos do HTML,
          // mesmo que a URL já exista no JSON.
          for (const item of itensHtml) {
            if (!item || !item.url) continue;
            itensPagina.push({
              ...item,
              produto: nomeProduto,
              codigoReferencia: codigoRef || null,
            });
          }

          coletados.push(...itensPagina);
          paginasComArquivos += 1;
        } else {
          // Página acessível, mas sem nenhum arquivo identificado
          paginasSemArquivos += 1;
          let codigoRef = estado ? obterCodigoReferenciaProduto(estado) : null;
          if (!codigoRef) {
            codigoRef = obterCodigoReferenciaDeHtmlBruto(html);
          }
          const nomeProduto = obterNomeProdutoAPartirDaUrl(url) || PRODUTO_PADRAO;
          paginasSemArquivosDetalhes.push({
            url,
            produto: nomeProduto,
            codigoReferencia: codigoRef || null,
          });
        }
      } else {
        // Resposta HTTP não-ok (404, 500, 403, 401, etc.)
        paginasErro += 1;
        paginasErroDetalhes.push({ url, status: resp.status, statusText: resp.statusText });
      }
    } catch (e) {
      // Erro de rede ou fetch: conta como página com erro e segue
      paginasErro += 1;
      paginasErroDetalhes.push({ url, erro: String(e && e.message ? e.message : e) });
    }

    indiceAtual += 1;

    // Pequeno atraso entre uma página e outra para evitar sobrecarga
    // no servidor e dar tempo para qualquer conteúdo assíncrono ser
    // servido corretamente.
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  // Para reduzir a quantidade total, mantemos todos os documentos
  // (PDFs/arquivos) mas limitamos as IMAGENS a, no máximo, 5 por
  // combinação produto+código de referência.
  const coletadosFiltrados = [];
  const contagemFotosPorProduto = new Map();

  for (const item of coletados) {
    if (!item) continue;

    const produto = (item.produto || PRODUTO_PADRAO).trim();
    const codigoRefBruto = item.codigoReferencia || null;
    const codigoRefNumerico = codigoRefBruto ? String(codigoRefBruto).replace(/\D+/g, '') : '';
    const chaveProduto = `${produto}::${codigoRefNumerico || 'SEM_CODIGO'}`;

    const imagem = ehImagemNoBackground(item);
    if (!imagem) {
      coletadosFiltrados.push(item);
      continue;
    }

    const atual = contagemFotosPorProduto.get(chaveProduto) || 0;
    if (atual < 5) {
      coletadosFiltrados.push(item);
      contagemFotosPorProduto.set(chaveProduto, atual + 1);
    }
    // Caso contrário, ignora imagens extras desse produto.
  }

  const msgFinal = coletadosFiltrados.length
    ? `Processo concluído. Encontrados ${coletadosFiltrados.length} arquivo(s) em ${total} página(s) (${paginasComArquivos} com arquivos, ${paginasSemArquivos} sem arquivos, ${paginasErro} com erro). Imagens limitadas a 5 por produto.`
    : `Nenhum arquivo encontrado nas ${total} página(s) informadas (${paginasSemArquivos} sem arquivos, ${paginasErro} com erro).`;

  try {
    chrome.storage.local.set({
      // Não salvamos mais a lista completa de arquivos aqui para
      // evitar estourar o limite de bytes do chrome.storage.local.
      statusTexto: msgFinal,
      processamentoEmAndamento: false,
      progressoAtual: total,
      progressoTotal: total,
      paginasSemArquivosDetalhes,
      paginasErroDetalhes,
      totalArquivosColetados: coletadosFiltrados.length,
    }, () => {
      // Apenas lê runtime.lastError para evitar o aviso
      // "Unchecked runtime.lastError" em caso de falha.
      const err = chrome.runtime.lastError;
      if (err) {
        console.warn('Erro ao salvar status final no storage:', err.message);
      }
    });
  } catch (e) {
    // Mesmo que a escrita falhe por um erro síncrono improvável,
    // o processamento já terminou.
  }

  // Envia o resultado completo (incluindo a lista de arquivos) para
  // qualquer popup aberto em lotes menores, para não correr o risco
  // de estourar o limite de tamanho de mensagem do Chrome.
  try {
    const TAM_LOTE = 2000;

    // Primeiro, avisa o popup para limpar qualquer resultado anterior.
    chrome.runtime.sendMessage(
      { tipo: 'LIMPAR_RESULTADO_PROCESSAMENTO_PAGINAS' },
      () => {
        const err = chrome.runtime.lastError;
        if (err && err.message && !/Receiving end does not exist/i.test(err.message)) {
          console.warn('Erro ao notificar popup (limpar resultado anterior):', err.message);
        }
      },
    );

    for (let i = 0; i < coletadosFiltrados.length; i += TAM_LOTE) {
      const lote = coletadosFiltrados.slice(i, i + TAM_LOTE);
      const ehUltimo = i + TAM_LOTE >= coletadosFiltrados.length;

      chrome.runtime.sendMessage(
        {
          tipo: 'RESULTADO_PROCESSAMENTO_PAGINAS_PARCIAL',
          coletados: lote,
          final: ehUltimo,
          msgFinal: ehUltimo ? msgFinal : undefined,
          paginasSemArquivosDetalhes: ehUltimo ? paginasSemArquivosDetalhes : undefined,
          paginasErroDetalhes: ehUltimo ? paginasErroDetalhes : undefined,
        },
        () => {
          const err = chrome.runtime.lastError;
          if (err && err.message && !/Receiving end does not exist/i.test(err.message)) {
            console.warn('Erro ao notificar popup com resultado parcial das páginas:', err.message);
          }
        },
      );
    }
  } catch (e) {
    // Se a notificação falhar, o processamento já foi concluído mesmo assim.
  }
}

chrome.runtime.onMessage.addListener((mensagem, _sender, sendResponse) => {
  if (mensagem && mensagem.tipo === 'PROCESSAR_LISTA_PAGINAS') {
    const urls = Array.isArray(mensagem.urls) ? mensagem.urls : [];
    processarListaDePaginas(urls);
    if (typeof sendResponse === 'function') {
      sendResponse({ ok: true });
    }
    return true;
  }

  if (mensagem && mensagem.tipo === 'REGISTRAR_DOWNLOAD_INICIADO') {
    if (typeof mensagem.downloadId === 'number' && mensagem.url && mensagem.filename) {
      registrarDownloadIniciado(mensagem.downloadId, {
        url: mensagem.url,
        filename: mensagem.filename,
        produto: mensagem.produto || PRODUTO_PADRAO,
        codigoReferencia: mensagem.codigoReferencia || null,
      });
      if (typeof sendResponse === 'function') {
        sendResponse({ ok: true });
      }
      return true;
    }
  }

  return false;
});
