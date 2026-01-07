let pdfsAtuais = [];
const PRODUTO_PADRAO = 'Produto';
let textoBaseBaixarSelecionados = 'Baixar selecionados';
let filtroAtual = '';
let origemAtualDosArquivos = '';
let filtroTipo = 'todos';
let intervaloProgresso = null;
let listaProcessadaJaRenderizada = false;
let acumulandoResultadoLista = false;
let bufferResultadoLista = [];

function salvarLista() {
  // Não persiste mais a lista completa em chrome.storage.local
  // para evitar estourar o limite de bytes (kQuotaBytes).
}

function salvarResultadoListaEmSessao() {
  try {
    if (!pdfsAtuais || !pdfsAtuais.length) return;
    if (!chrome || !chrome.storage || !chrome.storage.session) return;

    const compact = pdfsAtuais.map((item) => ({
      u: item.url,
      p: item.produto || PRODUTO_PADRAO,
      c: item.codigoReferencia || null,
      o: item.origem || '',
      n: item.nomeArquivo || '',
      x: item.texto || '',
      t: item.tipo || determinarTipo(item),
    }));

    chrome.storage.session.set({ ultimoResultadoListaCompact: compact }, () => {
      const err = chrome.runtime && chrome.runtime.lastError;
      if (err && err.message) {
        console.warn('Erro ao salvar resultado em chrome.storage.session:', err.message);
      }
    });
  } catch (e) {
    // Se não conseguir salvar em sessão, apenas segue com a lista em memória.
  }
}

function atualizarStatus(texto) {
  const elStatus = document.getElementById('status');
  if (elStatus) elStatus.textContent = texto;
}

function atualizarInfoJson(texto) {
  const elInfo = document.getElementById('info-json');
  if (elInfo) elInfo.textContent = texto || '';
}

function atualizarListaSemArquivos(detalhes) {
  const wrap = document.getElementById('sem-arquivos-wrap');
  const textarea = document.getElementById('lista-sem-arquivos');
  if (!wrap || !textarea) return;

  const itens = Array.isArray(detalhes) ? detalhes : [];

  if (!itens.length) {
    wrap.style.display = 'none';
    textarea.value = '';
    return;
  }

  const linhas = itens.map((item, idx) => {
    if (!item) return '';
    const codigoRefBruto = item.codigoReferencia || null;
    const codigoRefNumerico = codigoRefBruto ? String(codigoRefBruto).replace(/\D+/g, '') : '';
    const codigo = codigoRefNumerico || 'SEM_CODIGO';
    const produto = (item.produto || '').trim() || 'Produto';
    const url = item.url || '';
    return `${idx + 1}. [${codigo}] ${produto} -> ${url}`;
  }).filter(Boolean);

  textarea.value = linhas.join('\n');
  wrap.style.display = 'block';
}

function atualizarListaCodigosDuplicados(linhas) {
  const wrap = document.getElementById('duplicados-wrap');
  const textarea = document.getElementById('lista-duplicados');
  if (!wrap || !textarea) return;

  const itens = Array.isArray(linhas) ? linhas : [];

  if (!itens.length || (itens.length === 1 && itens[0] === 'NENHUM_CODIGO_DUPLICADO')) {
    wrap.style.display = 'none';
    textarea.value = '';
    return;
  }

  textarea.value = itens.join('\n');
  wrap.style.display = 'block';
}

function calcularDuplicadosAPartirDeArquivos(lista) {
  const itens = Array.isArray(lista) ? lista : [];
  if (!itens.length) return [];

  const mapaCodigoParaProdutos = new Map();

  itens.forEach((item) => {
    if (!item) return;
    const codigoBruto = item.codigoReferencia || null;
    const codigoNumerico = codigoBruto ? String(codigoBruto).replace(/\D+/g, '') : '';
    if (!codigoNumerico) return;

    const produto = gerarNomePastaProduto(item.produto || PRODUTO_PADRAO);
    const chaveProduto = produto || PRODUTO_PADRAO;

    if (!mapaCodigoParaProdutos.has(codigoNumerico)) {
      mapaCodigoParaProdutos.set(codigoNumerico, new Map());
    }

    const mapaProdutos = mapaCodigoParaProdutos.get(codigoNumerico);
    if (!mapaProdutos.has(chaveProduto)) {
      mapaProdutos.set(chaveProduto, item.url || '');
    }
  });

  const linhas = [];

  mapaCodigoParaProdutos.forEach((mapaProdutos, codigo) => {
    if (!mapaProdutos || mapaProdutos.size < 2) return;

    mapaProdutos.forEach((url, produto) => {
      linhas.push(`${codigo};${produto};${url}`);
    });
  });

  if (!linhas.length) return [];
  return linhas;
}

function limparDadosNavegadorAPartirDaLista(lista) {
  try {
    if (!chrome || !chrome.browsingData || !chrome.browsingData.remove) {
      return;
    }

    const itens = Array.isArray(lista) ? lista : pdfsAtuais;
    if (!itens || !itens.length) return;

    const origensSet = new Set();

    itens.forEach((item) => {
      if (!item || !item.url) return;
      try {
        const u = new URL(item.url);
        const origem = `${u.protocol}//${u.hostname}`;
        origensSet.add(origem);
      } catch (e) {
        // ignora URLs inválidas
      }
    });

    const origins = Array.from(origensSet);
    if (!origins.length) return;

    const removalOptions = {
      origins,
      since: 0,
    };

    const dataToRemove = {
      // "Imagens e arquivos em cache"
      cache: true,
      // Cookies do site
      cookies: true,
      // localStorage do site
      localStorage: true,
      // Não removemos mais histórico, IndexedDB, webSQL ou serviceWorkers,
      // conforme solicitado.
    };

    chrome.browsingData.remove(removalOptions, dataToRemove, () => {
      // Status discreto para o usuário saber que os dados foram limpos
      atualizarStatus('Dados do navegador limpos para os domínios dos produtos.');
    });
  } catch (e) {
    // Se algo falhar, não quebra o fluxo de limpar lista
  }
}

function atualizarInfoProdutos(lista) {
  const el = document.getElementById('info-produtos');
  if (!el) return;

  const itens = Array.isArray(lista) ? lista : pdfsAtuais;

  if (!itens || !itens.length) {
    el.textContent = 'Produtos na lista: 0';
    return;
  }

  const codigosUnicos = new Set();
  const produtosSemCodigo = new Set();
  const produtosUnicos = new Set();

  itens.forEach((item) => {
    if (!item) return;

    const nomeBruto = item.produto || PRODUTO_PADRAO;
    const nomeNormalizado = gerarNomePastaProduto(nomeBruto);
    const codigoRefBruto = item.codigoReferencia || null;
    const codigoRefNumerico = codigoRefBruto ? String(codigoRefBruto).replace(/\D+/g, '') : '';

    if (codigoRefNumerico) {
      codigosUnicos.add(codigoRefNumerico);
    } else {
      produtosSemCodigo.add(nomeNormalizado);
    }

    produtosUnicos.add(nomeNormalizado);
  });

  const totalProdutos = produtosUnicos.size;
  const comCodigo = codigosUnicos.size;
  const semCodigo = produtosSemCodigo.size;

  if (semCodigo > 0) {
    el.textContent = `Produtos na lista: ${totalProdutos}  |  códigos distintos: ${comCodigo}  |  produtos sem código: ${semCodigo}`;
  } else {
    el.textContent = `Produtos na lista: ${totalProdutos}  |  códigos distintos: ${comCodigo}`;
  }
}

function atualizarProgresso(progressoAtual, progressoTotal, emAndamento) {
  const wrap = document.getElementById('progresso-wrap');
  const barra = document.getElementById('progresso-barra');
  const label = document.getElementById('progresso-label');
  if (!wrap || !barra || !label) return;

  if (!emAndamento || !progressoTotal || progressoTotal <= 0) {
    wrap.style.display = 'none';
    barra.style.width = '0%';
    label.textContent = '';
    return;
  }

  const atual = Math.max(0, Math.min(progressoAtual || 0, progressoTotal));
  const perc = Math.max(0, Math.min(100, Math.round((atual / progressoTotal) * 100)));

  wrap.style.display = 'block';
  barra.style.width = `${perc}%`;
  label.textContent = `Processando ${atual} de ${progressoTotal} página(s) (${perc}%)`;
}

function renderizarPDFs(pdfs) {
  const lista = document.getElementById('lista-pdfs');
  lista.innerHTML = '';

  pdfsAtuais = Array.isArray(pdfs) ? pdfs.map((item) => ({
    ...item,
    tipo: item.tipo || determinarTipo(item),
  })) : [];
  salvarLista();

  if (!pdfsAtuais.length) {
    atualizarStatus('Nenhum arquivo encontrado.');
    atualizarInfoJson('');
    atualizarContagemSelecionados();
    return;
  }

  if (origemAtualDosArquivos === 'json') {
    atualizarStatus(`JSON interno (__PRELOADED_STATE__) encontrado. Encontrados ${pdfsAtuais.length} link(s) de arquivos.`);
  } else {
    atualizarStatus(`Encontrados ${pdfsAtuais.length} link(s) de arquivos.`);
  }

  pdfsAtuais.forEach((item, indice) => {
    const li = document.createElement('li');
    li.dataset.texto = (item.texto || item.nomeArquivo || item.url || '').toString();
    li.dataset.tipo = item.tipo || determinarTipo(item);
    li.dataset.visivel = '1';
    const linha = document.createElement('div');
    linha.className = 'linha-link';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'pdf-checkbox';
    checkbox.dataset.indice = String(indice);
    checkbox.checked = !!item.selecionado;
    checkbox.addEventListener('change', () => {
      const idx = parseInt(checkbox.dataset.indice || '-1', 10);
      if (!Number.isNaN(idx) && pdfsAtuais[idx]) {
        pdfsAtuais[idx].selecionado = checkbox.checked;
        salvarLista();
      }
      atualizarContagemSelecionados();
    });

    const link = document.createElement('a');
    link.href = item.url;
    link.target = '_blank';

    const spanTexto = document.createElement('span');
    spanTexto.className = 'texto-link';
    spanTexto.textContent = item.texto || 'Download PDF';

    const spanUrl = document.createElement('span');
    spanUrl.className = 'url-pequena';
    spanUrl.textContent = item.url;

    link.appendChild(spanTexto);
    link.appendChild(spanUrl);

    linha.appendChild(checkbox);
    linha.appendChild(link);
    li.appendChild(linha);
    lista.appendChild(li);
  });

  atualizarContagemSelecionados();
  aplicarFiltroPorNome();
  atualizarInfoProdutos(pdfsAtuais);

  const linhasDuplicados = calcularDuplicadosAPartirDeArquivos(pdfsAtuais);
  atualizarListaCodigosDuplicados(linhasDuplicados);

   // Mantém uma cópia compacta do resultado da lista em memória
   // da extensão (chrome.storage.session) para permitir reabrir
   // o popup sem perder os arquivos, sem usar o storage local.
  salvarResultadoListaEmSessao();

  listaProcessadaJaRenderizada = true;
}

function ehImagemNoPopup(item) {
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

  return /(\.png|\.jpe?g|\.webp|\.gif|\.svg)(\?|#|$)/i.test(alvo);
}

function limitarImagensPorProduto(lista) {
  if (!Array.isArray(lista) || !lista.length) return [];

  const resultado = [];
  const contagemFotosPorProduto = new Map();

  for (const item of lista) {
    if (!item) continue;

    const produto = (item.produto || PRODUTO_PADRAO).trim();
    const codigoRefBruto = item.codigoReferencia || null;
    const codigoRefNumerico = codigoRefBruto ? String(codigoRefBruto).replace(/\D+/g, '') : '';
    const chaveProduto = `${produto}::${codigoRefNumerico || 'SEM_CODIGO'}`;

    const imagem = ehImagemNoPopup(item);
    if (!imagem) {
      resultado.push(item);
      continue;
    }

    const atual = contagemFotosPorProduto.get(chaveProduto) || 0;
    if (atual < 5) {
      resultado.push(item);
      contagemFotosPorProduto.set(chaveProduto, atual + 1);
    }
    // Caso contrário, ignora imagens extras desse produto.
  }

  return resultado;
}

function solicitarPDFsNaAbaAtiva() {
  atualizarStatus('Procurando arquivos (JSON da página) na aba atual...');
  atualizarInfoJson('');

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const aba = tabs[0];
    if (!aba || !aba.id) {
      atualizarStatus('Não foi possível identificar a aba ativa.');
      return;
    }

    chrome.tabs.sendMessage(
      aba.id,
      { tipo: 'OBTER_PDFS' },
      (resposta) => {
        if (chrome.runtime.lastError) {
          atualizarStatus('A página não permitiu leitura ou ainda está carregando.');
          return;
        }

        const produto = (resposta && resposta.produto) || PRODUTO_PADRAO;
        const pdfsBrutos = resposta && resposta.pdfs ? resposta.pdfs : [];

        const jsonEncontrado = !!(resposta && resposta.jsonEncontrado);
        origemAtualDosArquivos = jsonEncontrado ? 'json' : 'desconhecida';

        if (jsonEncontrado) {
          const codigoRef = resposta && resposta.codigoReferencia;
          const detalheCrm = codigoRef ? ` (fieldProductCrmId = ${codigoRef})` : '';
          atualizarInfoJson(`JSON interno __PRELOADED_STATE__ encontrado${detalheCrm}.`);
        } else {
          atualizarInfoJson('ATENÇÃO: __PRELOADED_STATE__ não encontrado nesta página.');
        }

        if (!pdfsBrutos.length) {
          atualizarStatus('Nenhum arquivo foi encontrado no JSON interno da página.');
        }

        const codigoRef = resposta && resposta.codigoReferencia;
        const pdfsComProduto = pdfsBrutos.map((item) => ({
          ...item,
          produto,
          // Replica o código de referência em cada item para uso na hora do download
          codigoReferencia: codigoRef || null,
        }));
        const pdfsLimitados = limitarImagensPorProduto(pdfsComProduto);
        renderizarPDFs(pdfsLimitados);
      }
    );
  });
}

// Botão de atualizar
const botaoAtualizar = document.getElementById('atualizar');
if (botaoAtualizar) {
  botaoAtualizar.addEventListener('click', solicitarPDFsNaAbaAtiva);
}

function gerarNomePastaProduto(nomeProduto) {
  const bruto = (nomeProduto || PRODUTO_PADRAO).trim();
  const semCaracteresInvalidos = bruto.replace(/[<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim();
  return semCaracteresInvalidos || 'Produto';
}

function obterNomeArquivoAPartirDaUrl(url) {
  try {
    const u = new URL(url);
    const partes = u.pathname.split('/').filter(Boolean);
    if (partes.length === 0) return 'arquivo.pdf';
    return partes[partes.length - 1] || 'arquivo.pdf';
  } catch (e) {
    return 'arquivo.pdf';
  }
}

function baixarPDFs(itens) {
  if (!itens || itens.length === 0) {
    atualizarStatus('Nenhum arquivo selecionado para download.');
    return;
  }

  // Remove apenas duplicidades EVIDENTES dentro do mesmo produto/código,
  // considerando a combinação produto/código/URL. Assim evitamos múltiplos
  // downloads exatamente iguais sem correr o risco de eliminar arquivos
  // diferentes com o mesmo nome.
  const urlsJaBaixadasPorProduto = new Set();
  let downloadsEfetivos = 0;

  itens.forEach((item) => {
    const url = item.url;
    const produto = item.produto || PRODUTO_PADRAO;
    const pasta = gerarNomePastaProduto(produto);
    const nomeArquivoOriginal = obterNomeArquivoAPartirDaUrl(url);
    let nomeArquivo = nomeArquivoOriginal;

    // Se for PDF e tiver código de referência numérico, acrescenta
    // _codreferenciaXXXX ao nome do arquivo antes da extensão.
    const codigoRefBruto = item.codigoReferencia || null;
    const codigoRefNumerico = codigoRefBruto ? String(codigoRefBruto).replace(/\D+/g, '') : '';
    const ehPdf = /\.pdf(\?|#|$)/i.test((nomeArquivoOriginal || '').toLowerCase()) ||
      /\.pdf(\?|#|$)/i.test((url || '').toLowerCase());

    if (ehPdf && codigoRefNumerico) {
      const ponto = nomeArquivoOriginal.lastIndexOf('.');
      if (ponto > 0) {
        const base = nomeArquivoOriginal.slice(0, ponto);
        const ext = nomeArquivoOriginal.slice(ponto);
        nomeArquivo = `${base}_${codigoRefNumerico}${ext}`;
      } else {
        nomeArquivo = `${nomeArquivoOriginal}_${codigoRefNumerico}`;
      }
    }

    const ehImagem =
      item.origem === 'preloaded_state_imagem' ||
      item.origem === 'preloaded_state_imagem_uso' ||
      /\.(png|jpe?g|webp|gif|svg)(\?|#|$)/i.test(nomeArquivo);

    // Estrutura de pastas desejada: Produto -> Código -> arquivos
    const pastaCodigo = codigoRefNumerico || 'SEM_CODIGO';
    const caminho = ehImagem
      ? `${pasta}/${pastaCodigo}/imagens/${nomeArquivo}`
      : `${pasta}/${pastaCodigo}/${nomeArquivo}`;

    const chaveUrlProduto = `${pasta}/${pastaCodigo}:::${url}`;
    if (urlsJaBaixadasPorProduto.has(chaveUrlProduto)) {
      return;
    }
    urlsJaBaixadasPorProduto.add(chaveUrlProduto);
    try {
      chrome.downloads.download({ url, filename: caminho }, (downloadId) => {
        const err = chrome.runtime && chrome.runtime.lastError ? chrome.runtime.lastError : null;
        if (err) {
          // Em caso de erro ao iniciar o download, apenas atualiza o status genérico
          atualizarStatus('Não foi possível iniciar alguns downloads. Verifique as permissões.');
          return;
        }

        downloadsEfetivos += 1;

        // Informa o background sobre este download, para que ele possa
        // monitorar falhas e tentar corrigir automaticamente quando
        // possível.
        try {
          chrome.runtime.sendMessage(
            {
              tipo: 'REGISTRAR_DOWNLOAD_INICIADO',
              downloadId,
              url,
              filename: caminho,
              produto,
              codigoReferencia: codigoRefNumerico || null,
            },
            () => {
              const erroMsg = chrome.runtime && chrome.runtime.lastError ? chrome.runtime.lastError : null;
              if (erroMsg && erroMsg.message && !/Receiving end does not exist/i.test(erroMsg.message)) {
                console.warn('Erro ao registrar download iniciado no background:', erroMsg.message);
              }
            },
          );
        } catch (e) {
          // Se não conseguir notificar o background, o download ainda
          // acontecerá normalmente, apenas sem monitoramento extra.
        }
      });
    } catch (e) {
      // Em caso de erro inesperado ao chamar chrome.downloads.download
      atualizarStatus('Não foi possível iniciar alguns downloads. Verifique as permissões.');
    }
  });
  if (downloadsEfetivos > 0) {
    atualizarStatus(`Iniciando download de ${downloadsEfetivos} arquivo(s) (após remover arquivos 100% repetidos por produto).`);
  } else {
    atualizarStatus('Nenhum arquivo para baixar após remover arquivos 100% repetidos por produto.');
  }
}

function determinarTipo(item) {
  const origem = (item && item.origem) || '';
  const nome = (item && item.nomeArquivo) || '';
  const url = (item && item.url) || '';

  const alvo = (nome || url).toLowerCase();

  const ehImagemOrigem =
    origem === 'preloaded_state_imagem' ||
    origem === 'preloaded_state_imagem_uso' ||
    origem === 'preloaded_state_imagem_generica';

  const ehImagemExt = /\.(png|jpe?g|webp|gif|svg)(\?|#|$)/i.test(alvo);

  if (ehImagemOrigem || ehImagemExt) return 'imagem';

  const ehPdfExt = /\.pdf(\?|#|$)/i.test(alvo);
  if (ehPdfExt) return 'pdf';

  // Arquivos claramente não-PDF por extensão conhecida
  const ehNaoPdfConhecido = /\.(zip|rar|7z|tar|gz|bz2|xz|docx?|xlsx?|pptx?|csv|exe|msi)(\?|#|$)/i.test(alvo);

  // Alguns PDFs da Intelbras não trazem ".pdf" explícito na URL,
  // mas vêm como downloads de documento ou links HTML específicos
  // de PDF. Só tratamos como PDF nesses casos se a extensão não
  // indicar claramente outro tipo (ZIP, DOCX, etc.).
  if (!ehNaoPdfConhecido && (origem === 'preloaded_state_download' || origem === 'html_pdf_link')) {
    return 'pdf';
  }

  return 'outro';
}

function atualizarContagemSelecionados() {
  const botao = document.getElementById('baixar-selecionados');
  if (!botao) return;

  const label = botao.querySelector('.botao-label');
  if (!label) return;

  const selecionados = document.querySelectorAll('input.pdf-checkbox:checked').length;
  if (selecionados > 0) {
    label.textContent = `${textoBaseBaixarSelecionados} (${selecionados})`;
  } else {
    label.textContent = textoBaseBaixarSelecionados;
  }
}

function aplicarFiltroPorNome() {
  const campo = document.getElementById('filtro-nome');
  if (!campo) return;

  const valor = (campo.value || '').trim().toLowerCase();
  filtroAtual = valor;

  const itens = document.querySelectorAll('#lista-pdfs li');
  let visiveis = 0;

  itens.forEach((li) => {
    const texto = (li.dataset.texto || '').toLowerCase();
    const tipoLi = li.dataset.tipo || 'outro';
    const correspondeTexto = !valor || texto.includes(valor);
    const correspondeTipo =
      filtroTipo === 'todos' ||
      (filtroTipo === 'pdf' && tipoLi === 'pdf') ||
      (filtroTipo === 'imagem' && tipoLi === 'imagem') ||
      (filtroTipo === 'outros' && tipoLi === 'outro');

    const corresponde = correspondeTexto && correspondeTipo;
    li.style.display = corresponde ? '' : 'none';
    li.dataset.visivel = corresponde ? '1' : '0';
    if (corresponde) visiveis += 1;
  });

  if (!pdfsAtuais.length) return;

  if (valor) {
    atualizarStatus(`Filtrando por "${valor}"  mostrando ${visiveis} de ${pdfsAtuais.length} arquivo(s).`);
  } else {
    atualizarStatus(`Encontrados ${pdfsAtuais.length} link(s) de arquivos.`);
  }
}

// Botão "Baixar selecionados"
const botaoBaixarSelecionados = document.getElementById('baixar-selecionados');
if (botaoBaixarSelecionados) {
  const label = botaoBaixarSelecionados.querySelector('.botao-label');
  if (label) {
    textoBaseBaixarSelecionados = label.textContent || textoBaseBaixarSelecionados;
  }
  botaoBaixarSelecionados.addEventListener('click', () => {
    const checkboxes = document.querySelectorAll('input.pdf-checkbox:checked');
    const itens = Array.from(checkboxes)
      .map((cb) => {
        const indice = parseInt(cb.dataset.indice || '-1', 10);
        if (Number.isNaN(indice) || !pdfsAtuais[indice]) return null;
        return pdfsAtuais[indice];
      })
      .filter(Boolean);

    if (itens.length === 0) {
      atualizarStatus('Selecione pelo menos um arquivo para baixar.');
      return;
    }

    baixarPDFs(itens);
  });
}

// Botão "Baixar tudo"
const botaoBaixarTodos = document.getElementById('baixar-todos');
if (botaoBaixarTodos) {
  botaoBaixarTodos.addEventListener('click', () => {
    if (!pdfsAtuais || pdfsAtuais.length === 0) {
      atualizarStatus('Nenhum arquivo encontrado para baixar.');
      return;
    }

    // Respeita o filtro de tipo selecionado (todos / pdf / imagem / outros)
    let itens = pdfsAtuais.slice();
    if (filtroTipo === 'pdf') {
      itens = itens.filter((item) => (item.tipo || determinarTipo(item)) === 'pdf');
    } else if (filtroTipo === 'imagem') {
      itens = itens.filter((item) => (item.tipo || determinarTipo(item)) === 'imagem');
    } else if (filtroTipo === 'outros') {
      itens = itens.filter((item) => (item.tipo || determinarTipo(item)) === 'outro');
    }

    if (!itens.length) {
      atualizarStatus('Nenhum arquivo corresponde ao filtro atual para baixar.');
      return;
    }

    baixarPDFs(itens);
  });
}

// Botão "Processar lista de páginas"
const botaoBaixarListaFechar = document.getElementById('baixar-lista-fechar');
if (botaoBaixarListaFechar) {
  botaoBaixarListaFechar.addEventListener('click', () => {
    const textarea = document.getElementById('lista-links-manual');
    if (!textarea) return;

    const linhas = textarea.value
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (linhas.length === 0) {
      atualizarStatus('Cole pelo menos um link válido na lista.');
      return;
    }

    // Nova lista de páginas sendo processada: limpa flag de renderização
    // automática para que o popup seja atualizado ao final.
    listaProcessadaJaRenderizada = false;

    atualizarStatus('Iniciando processamento da lista de páginas para buscar arquivos...');
    atualizarProgresso(0, linhas.length, true);
    chrome.runtime.sendMessage(
      { tipo: 'PROCESSAR_LISTA_PAGINAS', urls: linhas },
      () => {
        // Toda a progressão de status/progresso é controlada pelo background.
      }
    );
  });
}

// Botão "Limpar lista"
const botaoLimparLista = document.getElementById('limpar-lista');
if (botaoLimparLista) {
  botaoLimparLista.addEventListener('click', () => {
    const listaAnterior = pdfsAtuais ? pdfsAtuais.slice() : [];

    // Limpa dados do navegador relacionados aos domínios dos arquivos
    limparDadosNavegadorAPartirDaLista(listaAnterior);

    const lista = document.getElementById('lista-pdfs');
    if (lista) {
      lista.innerHTML = '';
    }

    pdfsAtuais = [];
    atualizarStatus('Lista de arquivos limpa. Dados locais e de navegação dos produtos foram zerados.');
    atualizarInfoJson('');
    atualizarInfoProdutos([]);
    atualizarContagemSelecionados();

    // Zera áreas auxiliares (produtos sem arquivos / códigos duplicados)
    atualizarListaSemArquivos([]);
    atualizarListaCodigosDuplicados([]);
    atualizarProgresso(0, 0, false);

    // Reseta buffers/flags internos utilizados para acumular resultados
    listaProcessadaJaRenderizada = false;
    acumulandoResultadoLista = false;
    bufferResultadoLista = [];

    // Limpa completamente o storage local da extensão, apagando
    // status, progresso e qualquer dado residual gravado antes.
    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.clear(() => {
          const err = chrome.runtime && chrome.runtime.lastError;
          if (err && err.message) {
            console.warn('Erro ao limpar chrome.storage.local:', err.message);
          }
        });
      }
    } catch (e) {
      // Ignora falhas ao limpar o storage; a UI já foi zerada.
    }

    // Limpa também qualquer resultado em memória de sessão.
    try {
      if (chrome && chrome.storage && chrome.storage.session) {
        chrome.storage.session.clear(() => {
          const err = chrome.runtime && chrome.runtime.lastError;
          if (err && err.message) {
            console.warn('Erro ao limpar chrome.storage.session:', err.message);
          }
        });
      }
    } catch (e) {
      // Ignora falhas ao limpar o storage de sessão.
    }

    // Interrompe o polling de progresso (se estiver ativo).
    if (intervaloProgresso) {
      clearInterval(intervaloProgresso);
      intervaloProgresso = null;
    }
  });
}

// Botão "Remover selecionados"
const botaoRemoverSelecionados = document.getElementById('remover-selecionados');
if (botaoRemoverSelecionados) {
  botaoRemoverSelecionados.addEventListener('click', () => {
    if (!pdfsAtuais || pdfsAtuais.length === 0) {
      atualizarStatus('Nenhum arquivo na lista para remover.');
      return;
    }

    const antes = pdfsAtuais.length;
    const restantes = pdfsAtuais.filter((item) => !item.selecionado);
    const removidos = antes - restantes.length;

    if (removidos === 0) {
      atualizarStatus('Nenhum arquivo selecionado para remover.');
      return;
    }

  renderizarPDFs(restantes);
  atualizarStatus(`Removidos ${removidos} arquivo(s) da lista.`);
  });
}

// Campo de filtro por nome
const campoFiltroNome = document.getElementById('filtro-nome');
if (campoFiltroNome) {
  campoFiltroNome.addEventListener('input', aplicarFiltroPorNome);
}

// Filtro por tipo (todos / pdf / imagem)
const radiosTipo = document.querySelectorAll('input[name="tipo-arquivo"]');
if (radiosTipo && radiosTipo.length) {
  radiosTipo.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      filtroTipo = radio.value || 'todos';
      aplicarFiltroPorNome();
    });
  });
}

// Botão "Selecionar filtrados/todos"
const botaoSelecionarFiltrados = document.getElementById('selecionar-filtrados');
if (botaoSelecionarFiltrados) {
  botaoSelecionarFiltrados.addEventListener('click', () => {
    if (!pdfsAtuais || pdfsAtuais.length === 0) {
      atualizarStatus('Nenhum arquivo na lista para selecionar.');
      return;
    }

    const campo = document.getElementById('filtro-nome');
    const valor = (campo && campo.value ? campo.value : '').trim().toLowerCase();

    const checkboxes = Array.from(document.querySelectorAll('#lista-pdfs input.pdf-checkbox'));
    const alvo = checkboxes.filter((cb) => {
      const li = cb.closest('li');
      if (!li) return false;
      // Respeita SEMPRE o que está visível (tanto por texto quanto por tipo)
      return li.dataset.visivel !== '0';
    });

    if (alvo.length === 0) {
      atualizarStatus('Nenhum arquivo correspondente ao filtro para selecionar.');
      return;
    }

    const algumNaoSelecionado = alvo.some((cb) => !cb.checked);

    alvo.forEach((cb) => {
      cb.checked = algumNaoSelecionado;
      const indice = parseInt(cb.dataset.indice || '-1', 10);
      if (!Number.isNaN(indice) && pdfsAtuais[indice]) {
        pdfsAtuais[indice].selecionado = cb.checked;
      }
    });

    salvarLista();
    atualizarContagemSelecionados();
  });
}

// Ao abrir o popup, tenta carregar PDFs salvos; se não houver, busca na aba atual
try {
  if (chrome && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['statusTexto', 'progressoAtual', 'progressoTotal', 'processamentoEmAndamento', 'paginasSemArquivosDetalhes'], (dados) => {
      const statusTexto = (dados && dados.statusTexto) || '';
      const progressoAtual = dados && typeof dados.progressoAtual === 'number' ? dados.progressoAtual : 0;
      const progressoTotal = dados && typeof dados.progressoTotal === 'number' ? dados.progressoTotal : 0;
      const emAndamento = !!(dados && dados.processamentoEmAndamento);

      atualizarProgresso(progressoAtual, progressoTotal, emAndamento);

      const semArquivos = dados && Array.isArray(dados.paginasSemArquivosDetalhes)
        ? dados.paginasSemArquivosDetalhes
        : [];
      atualizarListaSemArquivos(semArquivos);

      if (statusTexto) {
        atualizarStatus(statusTexto);
      }

      // Se houver um resultado de lista salvo em memória de sessão,
      // recarrega-o; caso contrário, faz a busca normal na aba ativa.
      if (chrome && chrome.storage && chrome.storage.session) {
        chrome.storage.session.get(['ultimoResultadoListaCompact'], (sess) => {
          try {
            const compact = sess && Array.isArray(sess.ultimoResultadoListaCompact)
              ? sess.ultimoResultadoListaCompact
              : [];

            if (compact && compact.length) {
              const reidratado = compact.map((it) => ({
                url: it.u,
                produto: it.p || PRODUTO_PADRAO,
                codigoReferencia: it.c || null,
                origem: it.o || '',
                nomeArquivo: it.n || '',
                texto: it.x || '',
                tipo: it.t || 'outro',
              }));

              origemAtualDosArquivos = 'lista';
              renderizarPDFs(reidratado);
            } else {
              solicitarPDFsNaAbaAtiva();
            }
          } catch (e) {
            solicitarPDFsNaAbaAtiva();
          }
        });
      } else {
        // Para páginas individuais (como os produtos Intelbras), sempre refaz a busca
        // diretamente na aba ativa para garantir leitura do JSON atual.
        solicitarPDFsNaAbaAtiva();
      }
    });

    if (!intervaloProgresso) {
      intervaloProgresso = setInterval(() => {
        try {
          chrome.storage.local.get(['statusTexto', 'progressoAtual', 'progressoTotal', 'processamentoEmAndamento', 'paginasSemArquivosDetalhes'], (dados) => {
            if (!dados) return;
            const progressoAtual = typeof dados.progressoAtual === 'number' ? dados.progressoAtual : 0;
            const progressoTotal = typeof dados.progressoTotal === 'number' ? dados.progressoTotal : 0;
            const emAndamento = !!dados.processamentoEmAndamento;

            atualizarProgresso(progressoAtual, progressoTotal, emAndamento);

            if (typeof dados.statusTexto === 'string' && dados.statusTexto) {
              atualizarStatus(dados.statusTexto);
            }

            const semArquivos = dados && Array.isArray(dados.paginasSemArquivosDetalhes)
              ? dados.paginasSemArquivosDetalhes
              : [];
            atualizarListaSemArquivos(semArquivos);
          });
        } catch (e) {
          // ignora erros de leitura de storage durante o polling
        }
      }, 800);
    }
  } else {
    solicitarPDFsNaAbaAtiva();
  }
} catch (e) {
  solicitarPDFsNaAbaAtiva();
}

// Recebe do background o resultado completo da varredura da lista
// de páginas (incluindo todos os arquivos encontrados) sem usar
// chrome.storage.local para armazenar arrays grandes.
if (chrome && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((mensagem, _sender, _sendResponse) => {
    if (!mensagem || !mensagem.tipo) return;

    // Notificação do background quando um download falha
    // definitivamente mesmo após as tentativas automáticas de
    // correção (limpar cache + recomeçar o download).
    if (mensagem.tipo === 'DOWNLOAD_FALHOU_DEFINITIVAMENTE') {
      const nomeAmigavel = mensagem.filename || mensagem.url || 'arquivo';
      const erro = mensagem.erro || 'erro_desconhecido';
      atualizarStatus(`Alguns downloads falharam mesmo após nova tentativa: ${nomeAmigavel} (erro: ${erro}).`);
      return;
    }

    if (mensagem.tipo === 'LIMPAR_RESULTADO_PROCESSAMENTO_PAGINAS') {
      acumulandoResultadoLista = true;
      bufferResultadoLista = [];
      origemAtualDosArquivos = 'lista';

      const lista = document.getElementById('lista-pdfs');
      if (lista) lista.innerHTML = '';
      atualizarInfoProdutos([]);
      atualizarListaSemArquivos([]);
      atualizarListaCodigosDuplicados([]);
      return;
    }

    if (mensagem.tipo === 'RESULTADO_PROCESSAMENTO_PAGINAS_PARCIAL') {
      const pedaco = Array.isArray(mensagem.coletados) ? mensagem.coletados : [];
      if (!acumulandoResultadoLista) {
        acumulandoResultadoLista = true;
        bufferResultadoLista = [];
      }

      bufferResultadoLista = bufferResultadoLista.concat(pedaco);

      if (mensagem.final) {
        const semArquivos = Array.isArray(mensagem.paginasSemArquivosDetalhes)
          ? mensagem.paginasSemArquivosDetalhes
          : [];

        origemAtualDosArquivos = 'lista';
        atualizarListaSemArquivos(semArquivos);
        renderizarPDFs(bufferResultadoLista);

        const msgFinal = mensagem.msgFinal
          || `Processo concluído. Encontrados ${bufferResultadoLista.length} arquivo(s) na lista de páginas.`;
        atualizarStatus(msgFinal);

        acumulandoResultadoLista = false;
      }

      return;
    }

    // Compatibilidade com versões antigas: caso ainda venha uma
    // única mensagem com todos os arquivos.
    if (mensagem.tipo === 'RESULTADO_PROCESSAMENTO_PAGINAS') {
      const coletados = Array.isArray(mensagem.coletados) ? mensagem.coletados : [];
      const semArquivos = Array.isArray(mensagem.paginasSemArquivosDetalhes)
        ? mensagem.paginasSemArquivosDetalhes
        : [];

      origemAtualDosArquivos = 'lista';
      atualizarListaSemArquivos(semArquivos);
      renderizarPDFs(coletados);

      const msgFinal = mensagem.msgFinal || `Processo concluído. Encontrados ${coletados.length} arquivo(s) na lista de páginas.`;
      atualizarStatus(msgFinal);
    }
  });
}
