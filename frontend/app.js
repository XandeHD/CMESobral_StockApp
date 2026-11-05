// App da equipa: login Google, stock, movimentos, faturas, compras, equipa e histórico.
(function () {
  const { esc, quando, fmt, toast, CFG } = window.App;
  const $ = (id) => document.getElementById(id);
  const TOKEN_KEY = 'stock_id_token';

  const estado = {
    token: null,
    me: null,
    artigos: [],
    movTipo: 'ENTRADA',
    movArtigoId: '',
    histFiltro: '',
    histEmail: '',
    faturaAberta: null
  };

  // -------------------------------------------------------------------------
  // Ícones (traço simples)
  // -------------------------------------------------------------------------
  const svg = (d, s) => '<svg width="' + (s || 22) + '" height="' + (s || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const IC = {
    stock: svg('<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>'),
    mov: svg('<path d="M7 4v16"/><path d="M3 8l4-4 4 4"/><path d="M17 20V4"/><path d="M13 16l4 4 4-4"/>'),
    fatura: svg('<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/><path d="M9 13h8M9 17h6"/>'),
    compras: svg('<path d="M10 6h10M10 12h10M10 18h10"/><path d="M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/>'),
    equipa: svg('<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6"/><path d="M16 4a4 4 0 010 8M22 21c0-3-2-5-4-5.5"/>'),
    pessoa: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>', 16),
    lupa: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', 18),
    camara: svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>', 20),
    voltar: svg('<path d="M15 5l-7 7 7 7"/>')
  };

  // -------------------------------------------------------------------------
  // Sessão
  // -------------------------------------------------------------------------
  function expiraEm(token) {
    try {
      const p = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return Number(p.exp) * 1000;
    } catch (e) { return 0; }
  }

  function guardarToken(t) {
    estado.token = t;
    try { sessionStorage.setItem(TOKEN_KEY, t); } catch (e) { /* sem armazenamento: fica só em memória */ }
  }

  function limparSessao() {
    estado.token = null;
    estado.me = null;
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignorar */ }
  }

  async function api(action, payload) {
    try {
      return await App.chamar(action, payload, estado.token);
    } catch (err) {
      if (err.code === 401) {
        limparSessao();
        mostrarLogin('A sessão expirou. Entra outra vez.');
      } else if (err.code === 403 && action === 'me') {
        limparSessao();
        mostrarLogin(err.message);
      }
      throw err;
    }
  }

  function mostrarLogin(msg) {
    $('ecra-app').hidden = true;
    $('ecra-login').hidden = false;
    const caixa = $('erro-login');
    caixa.hidden = !msg;
    caixa.textContent = msg || '';
    iniciarGoogle();
  }

  let googleIniciado = false;
  function iniciarGoogle() {
    if (!window.google || !google.accounts || !google.accounts.id) {
      setTimeout(iniciarGoogle, 300);
      return;
    }
    if (!CFG.GOOGLE_CLIENT_ID || CFG.GOOGLE_CLIENT_ID.indexOf('COLAR_AQUI') === 0) {
      $('erro-login').hidden = false;
      $('erro-login').textContent = 'Falta configurar o GOOGLE_CLIENT_ID no config.js.';
      return;
    }
    if (!googleIniciado) {
      google.accounts.id.initialize({
        client_id: CFG.GOOGLE_CLIENT_ID,
        callback: (r) => entrar(r.credential),
        auto_select: true,
        use_fedcm_for_prompt: true
      });
      googleIniciado = true;
    }
    google.accounts.id.renderButton($('botao-google'), {
      theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', locale: 'pt-PT', width: 300
    });
    google.accounts.id.prompt();
  }

  async function entrar(token) {
    guardarToken(token);
    try {
      estado.me = await api('me');
      $('ecra-login').hidden = true;
      $('ecra-app').hidden = false;
      await carregarArtigos();
      rotear();
    } catch (err) {
      if (err.code !== 401 && err.code !== 403) mostrarLogin(err.message);
    }
  }

  function sair() {
    limparSessao();
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    mostrarLogin('');
  }

  const isMaster = () => estado.me && estado.me.cargo === 'MASTER';

  // -------------------------------------------------------------------------
  // Estrutura (topo + navegação)
  // -------------------------------------------------------------------------
  function topo(titulo, extra, voltar) {
    const cargo = isMaster() ? '<span class="chip-cargo">Master</span>' : '<span class="chip-cargo operador">Operador</span>';
    $('topo').innerHTML =
      '<div class="topo-linha"><p class="marca">CATEDRAL ●●○ DA ESPERANÇA</p>' +
      '<div style="display:flex;align-items:center;gap:6px">' + cargo + '<button class="btn-sair" type="button" data-acao="sair">Sair</button></div></div>' +
      '<div style="display:flex;align-items:center;gap:6px">' +
      (voltar ? '<a href="' + voltar + '" aria-label="Voltar" style="display:flex;width:44px;height:44px;align-items:center;justify-content:center;margin-left:-10px;color:#fff">' + IC.voltar + '</a>' : '') +
      '<h1>' + esc(titulo) + '</h1></div>' + (extra || '');
  }

  function nav(atual) {
    const itens = [
      ['stock', 'Stock', IC.stock, true],
      ['movimento', 'Movimentos', IC.mov, true],
      ['faturas', 'Faturas', IC.fatura, isMaster()],
      ['compras', 'Compras', IC.compras, true],
      ['equipa', 'Equipa', IC.equipa, isMaster()]
    ];
    $('nav').innerHTML = itens.filter((i) => i[3]).map((i) =>
      '<a href="#/' + i[0] + '"' + (i[0] === atual ? ' aria-current="page"' : '') + '>' + i[2] + esc(i[1]) + '</a>'
    ).join('');
  }

  function conteudo(html) {
    $('conteudo').innerHTML = html;
  }

  const carregando = () => conteudo('<p class="carregar">A carregar…</p>');

  // -------------------------------------------------------------------------
  // Router
  // -------------------------------------------------------------------------
  const ROTAS = {
    stock: ecraStock,
    movimento: ecraMovimento,
    historico: ecraHistorico,
    faturas: ecraFaturas,
    compras: ecraCompras,
    equipa: ecraEquipa
  };
  const SO_MASTER = { faturas: true, equipa: true };

  function rotear() {
    if (!estado.me) return;
    const partes = (location.hash || '#/stock').replace(/^#\//, '').split('?');
    let rota = partes[0];
    const params = new URLSearchParams(partes[1] || '');
    if (!ROTAS[rota] || (SO_MASTER[rota] && !isMaster())) rota = 'stock';
    nav(rota === 'historico' ? 'movimento' : rota);
    ROTAS[rota](params);
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', rotear);

  async function carregarArtigos() {
    estado.artigos = await api('listarArtigos');
  }

  // -------------------------------------------------------------------------
  // STOCK
  // -------------------------------------------------------------------------
  let filtroStock = 'TODOS';
  let pesquisaStock = '';

  async function ecraStock() {
    topo('Stock',
      '<label class="pesquisa">' + IC.lupa + '<input type="search" id="pesquisa" placeholder="Procurar artigo" aria-label="Procurar artigo" value="' + esc(pesquisaStock) + '"></label>');
    carregando();
    try { await carregarArtigos(); } catch (e) { conteudo('<p class="vazio">' + esc(e.message) + '</p>'); return; }
    desenharStock();
    $('pesquisa').addEventListener('input', (e) => { pesquisaStock = e.target.value; desenharStock(); });
  }

  function desenharStock() {
    const locais = Array.from(new Set(estado.artigos.map((a) => a.local).filter(Boolean))).sort();
    const filtros = [['TODOS', 'Todos'], ['BAIXO', 'Abaixo do mínimo']].concat(locais.map((l) => ['L:' + l, l]));
    const termo = pesquisaStock.trim().toLowerCase();
    const lista = estado.artigos.filter((a) => {
      if (termo && a.nome.toLowerCase().indexOf(termo) < 0) return false;
      if (filtroStock === 'BAIXO') return a.baixo;
      if (filtroStock.indexOf('L:') === 0) return a.local === filtroStock.slice(2);
      return true;
    });

    let html = '<div class="filtros" role="group" aria-label="Filtros">' +
      filtros.map((f) => '<button type="button" data-acao="filtro-stock" data-valor="' + esc(f[0]) + '" aria-pressed="' + (f[0] === filtroStock) + '">' + esc(f[1]) + '</button>').join('') +
      '</div>';

    if (isMaster()) html += '<button class="btn secundario pequeno" type="button" data-acao="novo-artigo">+ Novo artigo</button>';

    if (!estado.artigos.length) {
      html += '<p class="vazio">Ainda não há artigos.' + (isMaster() ? ' Cria o primeiro com "+ Novo artigo".' : ' Pede ao Master para os criar.') + '</p>';
    } else if (!lista.length) {
      html += '<p class="vazio">Nenhum artigo com este filtro.</p>';
    } else {
      html += lista.map((a) =>
        '<button type="button" class="cartao item" data-acao="abrir-artigo" data-id="' + esc(a.id) + '" style="border:0;text-align:left;width:100%">' +
        '<span class="item-texto"><span class="item-titulo">' + esc(a.nome) + '</span>' +
        '<span class="item-sub">' + esc(a.local || 'Sem local') + ' · mín. ' + fmt(a.minimo) + ' ' + esc(a.unidade) + '</span></span>' +
        '<span style="display:flex;flex-direction:column;align-items:flex-end;gap:4px"><span class="item-num">' + fmt(a.quantidade) + ' ' + esc(a.unidade) + '</span>' +
        (a.baixo ? '<span class="badge baixo">Baixo</span>' : '') + '</span></button>'
      ).join('');
    }
    html += '<div class="acoes" style="position:sticky;bottom:76px;padding-top:6px">' +
      '<a class="btn" href="#/movimento?tipo=ENTRADA">+ Entrada</a><a class="btn secundario" href="#/movimento?tipo=BAIXA">− Baixa</a></div>';
    conteudo(html);
  }

  function dialogoArtigo(a) {
    const novo = !a;
    a = a || { nome: '', local: '', unidade: 'un', minimo: 0, quantidade: 0 };
    abrirDialogo(
      '<h2>' + (novo ? 'Novo artigo' : 'Editar artigo') + '</h2>' +
      '<form id="form-artigo">' +
      '<label class="campo">Nome<input name="nome" required maxlength="80" value="' + esc(a.nome) + '"></label>' +
      '<div class="linha-campos"><label class="campo">Local<input name="local" maxlength="40" placeholder="Cozinha" value="' + esc(a.local) + '"></label>' +
      '<label class="campo">Unidade<input name="unidade" maxlength="15" value="' + esc(a.unidade) + '"></label></div>' +
      '<div class="linha-campos"><label class="campo">Mínimo<input name="minimo" type="number" min="0" step="any" inputmode="decimal" value="' + esc(a.minimo) + '"></label>' +
      '<label class="campo">' + (novo ? 'Quantidade inicial' : 'Contagem atual') + '<input name="quantidade" type="number" min="0" step="any" inputmode="decimal" value="' + esc(a.quantidade) + '"></label></div>' +
      (novo ? '' : '<p class="item-sub" style="margin:0">Se mudares a contagem, fica registado um movimento de correção em teu nome.</p>') +
      '<div class="acoes"><button class="btn fantasma" type="button" data-acao="fechar">Cancelar</button><button class="btn" type="submit">Guardar</button></div>' +
      (novo ? '' : '<button class="btn-texto" type="button" data-acao="desativar-artigo" data-id="' + esc(a.id) + '">Desativar artigo</button>') +
      '</form>'
    );
    $('form-artigo').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const payload = { nome: f.get('nome'), local: f.get('local'), unidade: f.get('unidade'), minimo: f.get('minimo'), quantidade: f.get('quantidade') };
      if (!novo) payload.id = a.id;
      try {
        await api('guardarArtigo', payload);
        fecharDialogo();
        toast('Artigo guardado.');
        ecraStock();
      } catch (err) { toast(err.message, 'erro'); }
    });
  }

  // -------------------------------------------------------------------------
  // MOVIMENTO (entrada / baixa)
  // -------------------------------------------------------------------------
  async function ecraMovimento(params) {
    if (params.get('tipo') === 'BAIXA' || params.get('tipo') === 'ENTRADA') estado.movTipo = params.get('tipo');
    if (params.get('artigo')) estado.movArtigoId = params.get('artigo');
    topo('Movimento',
      '<div class="segmento" role="group" aria-label="Tipo de movimento" id="seg-tipo">' +
      '<button type="button" data-tipo="ENTRADA" aria-pressed="' + (estado.movTipo === 'ENTRADA') + '">Entrada</button>' +
      '<button type="button" data-tipo="BAIXA" aria-pressed="' + (estado.movTipo === 'BAIXA') + '">Baixa</button></div>');
    $('seg-tipo').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tipo]');
      if (!b) return;
      estado.movTipo = b.dataset.tipo;
      $('seg-tipo').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $('bloco-motivo').hidden = estado.movTipo !== 'BAIXA';
      $('btn-registar').textContent = estado.movTipo === 'BAIXA' ? 'Registar baixa' : 'Registar entrada';
    });

    if (!estado.artigos.length) {
      conteudo('<p class="vazio">Ainda não há artigos no stock.</p>');
      return;
    }
    const opcoes = estado.artigos.map((a) =>
      '<option value="' + esc(a.id) + '"' + (a.id === estado.movArtigoId ? ' selected' : '') + '>' + esc(a.nome) + ' (' + fmt(a.quantidade) + ' ' + esc(a.unidade) + ')</option>').join('');
    const motivos = (estado.me.motivosBaixa || []).map((m) => '<option>' + esc(m) + '</option>').join('');

    conteudo(
      '<form id="form-mov" style="display:flex;flex-direction:column;gap:16px">' +
      '<label class="campo">Artigo<select name="artigoId" id="mov-artigo">' + opcoes + '</select></label>' +
      '<div class="campo"><span id="lbl-qtd">Quantidade</span><div class="stepper">' +
      '<button type="button" data-acao="qtd" data-delta="-1" aria-label="Diminuir">−</button>' +
      '<input name="quantidade" id="mov-qtd" type="number" min="0" step="any" inputmode="decimal" value="1" aria-labelledby="lbl-qtd">' +
      '<button type="button" data-acao="qtd" data-delta="1" aria-label="Aumentar">+</button></div></div>' +
      '<label class="campo" id="bloco-motivo"' + (estado.movTipo === 'BAIXA' ? '' : ' hidden') + '>Motivo da baixa<select name="motivo">' + motivos + '</select></label>' +
      '<label class="campo">Nota (opcional)<input name="nota" maxlength="200" placeholder="Ex.: Culto de celebração"></label>' +
      '<div class="autor-aviso">' + IC.pessoa + '<span>Fica registado em nome de <strong>' + esc(estado.me.email) + '</strong></span></div>' +
      '<button class="btn bloco" type="submit" id="btn-registar">' + (estado.movTipo === 'BAIXA' ? 'Registar baixa' : 'Registar entrada') + '</button>' +
      '</form>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px"><h2 class="secao">Últimos movimentos</h2>' +
      '<a href="#/historico" style="font-size:13px;font-weight:600">Ver histórico</a></div>' +
      '<div id="recentes"><p class="carregar">A carregar…</p></div>'
    );

    $('mov-artigo').addEventListener('change', (e) => { estado.movArtigoId = e.target.value; });
    $('form-mov').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const btn = $('btn-registar');
      btn.disabled = true;
      try {
        const m = await api('registarMovimento', {
          tipo: estado.movTipo, artigoId: f.get('artigoId'), quantidade: f.get('quantidade'),
          motivo: estado.movTipo === 'BAIXA' ? f.get('motivo') : '', nota: f.get('nota')
        });
        toast((m.tipo === 'BAIXA' ? 'Baixa' : 'Entrada') + ' registada: ' + m.artigoNome + ' (agora ' + fmt(m.stockDepois) + ')');
        estado.movArtigoId = f.get('artigoId');
        await carregarArtigos();
        ecraMovimento(new URLSearchParams());
      } catch (err) {
        toast(err.message, 'erro');
        btn.disabled = false;
      }
    });
    carregarRecentes();
  }

  async function carregarRecentes() {
    try {
      const movs = await api('listarMovimentos', { limite: 5 });
      const alvo = $('recentes');
      if (!alvo) return;
      alvo.innerHTML = movs.length ? movs.map(linhaMovimento).join('') : '<p class="vazio">Sem movimentos ainda.</p>';
    } catch (e) {
      if ($('recentes')) $('recentes').innerHTML = '<p class="vazio">' + esc(e.message) + '</p>';
    }
  }

  function linhaMovimento(m) {
    const sinal = m.tipo === 'BAIXA' ? '−' : '+';
    return '<div class="cartao item" style="margin-bottom:10px;align-items:flex-start">' +
      '<div class="item-texto"><span class="item-titulo" style="font-size:14px">' + (m.tipo === 'BAIXA' ? 'Baixa' : 'Entrada') + ' · ' + esc(m.artigoNome) + '</span>' +
      '<span class="item-sub">' + esc(m.motivo) + (m.nota ? ' · ' + esc(m.nota) : '') + '</span>' +
      '<span class="item-autor">' + IC.pessoa + esc(m.email) + '</span></div>' +
      '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px"><span class="item-num" style="font-size:16px">' + sinal + fmt(m.quantidade) + '</span>' +
      '<span class="item-sub" style="white-space:nowrap">' + esc(quando(m.data)) + '</span></div></div>';
  }

  // -------------------------------------------------------------------------
  // HISTÓRICO
  // -------------------------------------------------------------------------
  let ultimoHistorico = [];

  async function ecraHistorico() {
    topo('Histórico', '<p>Cada entrada e baixa fica com quem a fez e quando. Ninguém pode apagar nem editar.</p>', '#/movimento');
    const filtros = [['', 'Todos'], ['ENTRADA', 'Entradas'], ['BAIXA', 'Baixas']];
    let pessoas = '';
    if (isMaster()) {
      try {
        const us = await api('listarUtilizadores');
        pessoas = '<label class="campo">Pessoa<select id="hist-email"><option value="">Todas as pessoas</option>' +
          us.map((u) => '<option value="' + esc(u.email) + '"' + (u.email === estado.histEmail ? ' selected' : '') + '>' + esc(u.email) + '</option>').join('') +
          '</select></label>';
      } catch (e) { /* sem filtro de pessoa */ }
    }
    conteudo(
      '<div class="filtros" role="group" aria-label="Tipo">' +
      filtros.map((f) => '<button type="button" data-acao="filtro-hist" data-valor="' + f[0] + '" aria-pressed="' + (f[0] === estado.histFiltro) + '">' + f[1] + '</button>').join('') +
      '</div>' + pessoas +
      '<div id="hist-lista"><p class="carregar">A carregar…</p></div>' +
      (isMaster() ? '<button class="btn secundario bloco" type="button" data-acao="exportar-hist">Exportar para Excel (CSV)</button>' : '')
    );
    if ($('hist-email')) $('hist-email').addEventListener('change', (e) => { estado.histEmail = e.target.value; carregarHistorico(); });
    carregarHistorico();
  }

  async function carregarHistorico() {
    try {
      ultimoHistorico = await api('listarMovimentos', { limite: 50, tipo: estado.histFiltro, email: estado.histEmail });
      $('hist-lista').innerHTML = ultimoHistorico.length ? ultimoHistorico.map(linhaMovimento).join('') : '<p class="vazio">Sem movimentos.</p>';
      if (!isMaster()) $('hist-lista').insertAdjacentHTML('beforeend', '<p class="item-sub" style="text-align:center">Mostra os últimos 10. O histórico completo é visto pelo Master.</p>');
    } catch (e) {
      $('hist-lista').innerHTML = '<p class="vazio">' + esc(e.message) + '</p>';
    }
  }

  function exportarCSV() {
    const cab = ['Data', 'Tipo', 'Artigo', 'Quantidade', 'Stock depois', 'Motivo', 'Nota', 'Quem', 'Origem'];
    const csvCel = (v) => {
      let s = String(v === undefined || v === null ? '' : v);
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const linhas = ultimoHistorico.map((m) => [new Date(m.data).toLocaleString('pt-PT'), m.tipo, m.artigoNome, m.quantidade, m.stockDepois, m.motivo, m.nota, m.email, m.origem]);
    const csv = '﻿' + [cab].concat(linhas).map((l) => l.map(csvCel).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'historico-stock-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // -------------------------------------------------------------------------
  // FATURAS (só Master)
  // -------------------------------------------------------------------------
  async function ecraFaturas() {
    topo('Faturas',
      '<label class="upload">' + IC.camara + '<span id="upload-texto">Fotografar ou carregar fatura</span>' +
      '<input type="file" id="ficheiro-fatura" accept="application/pdf,image/jpeg,image/png,image/webp"></label>');
    $('ficheiro-fatura').addEventListener('change', carregarFatura);
    if (estado.faturaAberta) { desenharRevisao(); return; }
    carregando();
    try {
      const pend = await api('listarFaturas', { estado: 'PENDENTE' });
      const recentes = await api('listarFaturas', { estado: 'TODAS' });
      const tratadas = recentes.filter((f) => f.estado !== 'PENDENTE').slice(0, 10);
      let html = '<div class="cartao" style="display:flex;flex-direction:column;gap:10px">' +
        '<strong style="font-size:14px">Ler fatura com a Claude (sem API)</strong>' +
        '<span class="item-sub">1. Copia a lista de artigos e envia-a à Claude com a foto da fatura. 2. Cola aqui o bloco que a Claude devolver.</span>' +
        '<div class="acoes"><button class="btn secundario pequeno" type="button" data-acao="copiar-artigos">Copiar artigos</button>' +
        '<button class="btn pequeno" type="button" data-acao="colar-claude">Colar lista</button></div></div>';
      html += '<button class="btn secundario pequeno" type="button" data-acao="fatura-manual">+ Criar fatura à mão</button>';
      html += '<h2 class="secao">Por rever</h2>';
      html += pend.length ? pend.map(cartaoFatura).join('') : '<p class="vazio">Nenhuma fatura por rever.</p>';
      if (tratadas.length) html += '<h2 class="secao">Tratadas recentemente</h2>' + tratadas.map(cartaoFatura).join('');
      conteudo(html);
      ecraFaturas._pendentes = pend;
    } catch (e) { conteudo('<p class="vazio">' + esc(e.message) + '</p>'); }
  }

  function cartaoFatura(f) {
    const estados = { PENDENTE: ['Por rever', ''], CONFIRMADA: ['Confirmada', 'escuro'], DESCARTADA: ['Descartada', 'baixo'] };
    const est = estados[f.estado] || [f.estado, ''];
    const corpo = '<span class="item-texto"><span class="item-titulo">' + esc(f.numero || 'Sem número') + '</span>' +
      '<span class="item-sub">' + esc(f.fornecedor || 'Fornecedor desconhecido') + (f.dataFatura ? ' · ' + esc(f.dataFatura) : '') + ' · ' + f.linhas.length + ' linhas</span>' +
      (f.decididaPor ? '<span class="item-autor">' + IC.pessoa + esc(f.decididaPor) + '</span>' : '') + '</span>' +
      '<span class="badge ' + est[1] + '">' + est[0] + '</span>';
    if (f.estado === 'PENDENTE') {
      return '<button type="button" class="cartao item" data-acao="abrir-fatura" data-id="' + esc(f.id) + '" style="border:0;text-align:left;width:100%">' + corpo + '</button>';
    }
    return '<div class="cartao item">' + corpo + '</div>';
  }

  async function carregarFatura(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const texto = $('upload-texto');
    texto.textContent = 'A ler a fatura…';
    try {
      const prep = await prepararFicheiro(file);
      const f = await api('lerFatura', prep);
      abrirRevisao(f);
      toast('Fatura lida. Revê cada linha.');
    } catch (err) {
      toast(err.message, 'erro');
    } finally {
      if ($('upload-texto')) $('upload-texto').textContent = 'Fotografar ou carregar fatura';
    }
  }

  /** PDFs vão como estão; fotos são reduzidas para ~2000 px em JPEG para não pesarem. */
  function prepararFicheiro(file) {
    return new Promise((resolve, reject) => {
      if (file.type === 'application/pdf') {
        if (file.size > 10 * 1024 * 1024) { reject(new Error('PDF demasiado grande (máx. 10 MB).')); return; }
        const r = new FileReader();
        r.onload = () => resolve({ mimeType: 'application/pdf', base64: String(r.result).split(',')[1], nomeFicheiro: file.name });
        r.onerror = () => reject(new Error('Não foi possível ler o ficheiro.'));
        r.readAsDataURL(file);
        return;
      }
      if (!/^image\//.test(file.type)) { reject(new Error('Usa um PDF ou uma fotografia.')); return; }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const max = 2000;
        const esc2 = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * esc2);
        c.height = Math.round(img.height * esc2);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve({ mimeType: 'image/jpeg', base64: c.toDataURL('image/jpeg', 0.85).split(',')[1], nomeFicheiro: file.name.replace(/\.\w+$/, '') + '.jpg' });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Esta imagem não pode ser aberta. Tenta JPG ou PNG.')); };
      img.src = url;
    });
  }

  function abrirRevisao(f) {
    estado.faturaAberta = {
      id: f.id, numero: f.numero, fornecedor: f.fornecedor, dataFatura: f.dataFatura,
      linhas: f.linhas.map((l) => Object.assign({ decisao: 'PENDENTE', novoNome: l.descricao }, l, { artigoId: l.artigoId || '' }))
    };
    desenharRevisao();
  }

  function desenharRevisao() {
    const f = estado.faturaAberta;
    const opcoesArtigo = (sel) => '<option value="">— Escolher artigo —</option>' +
      estado.artigos.map((a) => '<option value="' + esc(a.id) + '"' + (a.id === sel ? ' selected' : '') + '>' + esc(a.nome) + '</option>').join('') +
      '<option value="__novo"' + (sel === '__novo' ? ' selected' : '') + '>+ Artigo novo</option>';

    const linhas = f.linhas.map((l, i) => {
      let rodape;
      if (l.decisao === 'PENDENTE') {
        rodape = '<div class="acoes"><button class="btn pequeno" type="button" data-acao="linha" data-i="' + i + '" data-d="ACEITE">Aceitar</button>' +
          '<button class="btn fantasma pequeno" type="button" data-acao="linha" data-i="' + i + '" data-d="DESCARTADA">Descartar</button></div>';
      } else {
        const ok = l.decisao === 'ACEITE';
        rodape = '<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px">' +
          '<span style="font-weight:600;color:' + (ok ? 'var(--verde)' : 'var(--alerta)') + '">' + (ok ? '✓ Aceite · entra no stock' : 'Descartada') + '</span>' +
          '<button class="btn-texto" type="button" data-acao="linha" data-i="' + i + '" data-d="PENDENTE">Desfazer</button></div>';
      }
      return '<div class="cartao" style="display:flex;flex-direction:column;gap:10px">' +
        '<span class="item-titulo" style="font-size:14px">' + esc(l.descricao) + '</span>' +
        '<div class="linha-campos">' +
        '<label class="campo">Artigo de stock<select data-campo="artigoId" data-i="' + i + '">' + opcoesArtigo(l.artigoId) + '</select></label>' +
        '<label class="campo">Quantidade<input data-campo="quantidade" data-i="' + i + '" type="number" min="0" step="any" inputmode="decimal" value="' + esc(l.quantidade) + '"></label></div>' +
        (l.artigoId === '__novo' ? '<label class="campo">Nome do artigo novo<input data-campo="novoNome" data-i="' + i + '" maxlength="80" value="' + esc(l.novoNome) + '"></label>' : '') +
        rodape + '</div>';
    }).join('');

    const aceites = f.linhas.filter((l) => l.decisao === 'ACEITE').length;
    conteudo(
      '<div class="cartao" style="display:flex;flex-direction:column;gap:4px">' +
      '<span class="item-titulo">' + esc(f.numero || 'Fatura sem número') + '</span>' +
      '<span class="item-sub">' + esc(f.fornecedor || 'Fornecedor desconhecido') + (f.dataFatura ? ' · ' + esc(f.dataFatura) : '') + ' · ' + f.linhas.length + ' linhas</span></div>' +
      '<h2 class="secao">Rever linhas</h2>' + (linhas || '<p class="vazio">Sem linhas. Adiciona à mão.</p>') +
      '<button class="btn secundario pequeno" type="button" data-acao="linha-nova">+ Adicionar linha</button>' +
      '<div class="autor-aviso">' + IC.pessoa + '<span>As entradas ficam em nome de <strong>' + esc(estado.me.email) + '</strong></span></div>' +
      '<button class="btn escuro bloco" type="button" data-acao="confirmar-fatura">Confirmar fatura (' + aceites + ' aceites)</button>' +
      '<div class="acoes"><button class="btn fantasma pequeno" type="button" data-acao="fechar-fatura">Voltar</button>' +
      '<button class="btn fantasma pequeno" type="button" data-acao="descartar-fatura">Descartar fatura</button></div>'
    );
  }

  function campoRevisao(el) {
    const l = estado.faturaAberta.linhas[Number(el.dataset.i)];
    if (!l) return;
    l[el.dataset.campo] = el.value;
    if (el.dataset.campo === 'artigoId') desenharRevisao();
  }

  async function confirmarFatura() {
    const f = estado.faturaAberta;
    const pendentes = f.linhas.filter((l) => l.decisao === 'PENDENTE').length;
    if (pendentes) { toast('Ainda há ' + pendentes + ' linha(s) por decidir.', 'erro'); return; }
    const linhas = f.linhas.map((l) => {
      const out = { id: l.id, descricao: l.descricao, quantidade: l.quantidade, unidade: l.unidade, decisao: l.decisao };
      if (l.decisao === 'ACEITE') {
        if (l.artigoId === '__novo') out.novoArtigo = { nome: l.novoNome || l.descricao, unidade: l.unidade || 'un', minimo: 0 };
        else out.artigoId = l.artigoId;
      }
      return out;
    });
    try {
      const r = await api('confirmarFatura', { id: f.id, linhas: linhas });
      estado.faturaAberta = null;
      await carregarArtigos();
      toast('Fatura confirmada: ' + r.aceites + ' entradas no stock.');
      ecraFaturas();
    } catch (err) { toast(err.message, 'erro'); }
  }

  function dialogoFaturaManual() {
    abrirDialogo(
      '<h2>Fatura à mão</h2><form id="form-fm">' +
      '<label class="campo">Fornecedor<input name="fornecedor" maxlength="80"></label>' +
      '<div class="linha-campos"><label class="campo">Número<input name="numero" maxlength="40"></label>' +
      '<label class="campo">Data<input name="dataFatura" type="date"></label></div>' +
      '<div class="acoes"><button class="btn fantasma" type="button" data-acao="fechar">Cancelar</button><button class="btn" type="submit">Criar</button></div></form>'
    );
    $('form-fm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const f = await api('criarFaturaManual', { fornecedor: fd.get('fornecedor'), numero: fd.get('numero'), dataFatura: fd.get('dataFatura') });
        fecharDialogo();
        abrirRevisao(f);
        adicionarLinhaManual();
      } catch (err) { toast(err.message, 'erro'); }
    });
  }

  function dialogoColarClaude() {
    abrirDialogo(
      '<h2>Colar lista da Claude</h2><form id="form-colar">' +
      '<label class="campo">Bloco devolvido pela Claude<textarea name="texto" rows="8" required placeholder="{ &quot;fornecedor&quot;: …, &quot;linhas&quot;: [ … ] }" style="font-family:monospace;font-size:13px"></textarea></label>' +
      '<div class="acoes"><button class="btn fantasma" type="button" data-acao="fechar">Cancelar</button><button class="btn" type="submit">Importar</button></div></form>'
    );
    $('form-colar').addEventListener('submit', async (e) => {
      e.preventDefault();
      const bruto = String(new FormData(e.target).get('texto') || '');
      const ini = bruto.indexOf('{');
      const fim = bruto.lastIndexOf('}');
      let dados;
      try { dados = JSON.parse(bruto.slice(ini, fim + 1)); } catch (err) {
        toast('Não reconheci a lista. Cola o bloco completo que a Claude devolveu.', 'erro');
        return;
      }
      try {
        const f = await api('importarFatura', dados);
        fecharDialogo();
        abrirRevisao(f);
        toast('Lista importada. Revê cada linha.');
      } catch (err) { toast(err.message, 'erro'); }
    });
  }

  async function copiarArtigos() {
    const texto = 'Artigos do stock da igreja:\n' + estado.artigos.map((a) => '- ' + a.nome + ' (' + a.unidade + ')').join('\n');
    try { await navigator.clipboard.writeText(texto); toast('Lista de artigos copiada.'); }
    catch (err) { window.prompt('Copia a lista:', texto); }
  }

  function adicionarLinhaManual() {
    const f = estado.faturaAberta;
    const desc = window.prompt('Descrição da linha (ex.: Copos 200 ml)');
    if (!desc || !desc.trim()) return;
    f.linhas.push({ id: 'L' + (f.linhas.length + 1) + 'M' + Date.now().toString(36), descricao: desc.trim().slice(0, 120), quantidade: 1, unidade: '', artigoId: '', novoNome: desc.trim().slice(0, 80), decisao: 'PENDENTE' });
    desenharRevisao();
  }

  // -------------------------------------------------------------------------
  // COMPRAS (recomendações + pedidos + QR)
  // -------------------------------------------------------------------------
  async function ecraCompras() {
    topo('Compras',
      '<div class="qr-cartao"><div class="qr-caixa" id="qr-compras" role="img" aria-label="QR code da lista de compras"></div>' +
      '<div style="display:flex;flex-direction:column;gap:4px"><strong style="font-size:14px">QR da lista de compras</strong>' +
      '<span class="item-sub">Quem ler o QR (e tiver acesso) abre esta lista e vai marcando o que já comprou.</span></div></div>');
    desenharQR($('qr-compras'), urlApp('#/compras'), 96);
    carregando();
    try {
      const [recs, pedidos] = await Promise.all([
        api('listarRecomendacoes'),
        isMaster() ? api('listarPedidos', { estado: 'PENDENTE' }) : Promise.resolve([])
      ]);
      let html = '';
      if (isMaster()) {
        html += '<button class="btn secundario pequeno" type="button" data-acao="nova-rec">+ Nova recomendação</button>';
        if (pedidos.length) {
          html += '<h2 class="secao">Pedidos por aprovar (' + pedidos.length + ')</h2>' + pedidos.map(cartaoPedido).join('');
        }
      }
      const feitas = recs.filter((r) => r.feita).length;
      html += '<div style="display:flex;justify-content:space-between;align-items:center"><h2 class="secao">Recomendações</h2>' +
        '<span style="font-size:12px;font-weight:600;color:var(--verde)">' + feitas + ' de ' + recs.length + ' feitas</span></div>';
      html += recs.length ? recs.map(cartaoRec).join('') : '<p class="vazio">Nada para comprar. Tudo em ordem!</p>';
      conteudo(html);
    } catch (e) { conteudo('<p class="vazio">' + esc(e.message) + '</p>'); }
  }

  function cartaoRec(r) {
    const origens = { AUTO: 'Automático', MANUAL: 'Master', PEDIDO: 'Pedido aprovado' };
    return '<div class="cartao">' +
      '<label class="rec' + (r.feita ? ' feita' : '') + '"><input type="checkbox" data-acao="marcar-rec" data-id="' + esc(r.id) + '"' + (r.feita ? ' checked' : '') + '>' +
      '<span class="item-texto"><span class="item-titulo" style="font-size:14px">' + esc(r.titulo) + '</span>' +
      '<span class="item-sub">' + esc(r.detalhe || origens[r.origem] || '') + '</span>' +
      (r.feita ? '<span class="item-autor">' + IC.pessoa + 'Feito por ' + esc(r.feitaPor) + ' · ' + esc(quando(r.feitaEm)) + '</span>' : '') +
      '</span></label>' +
      (isMaster() && r.origem !== 'AUTO' ? '<div style="text-align:right"><button class="btn-texto" type="button" data-acao="arquivar-rec" data-id="' + esc(r.id) + '">Arquivar</button></div>' : '') +
      '</div>';
  }

  function cartaoPedido(p) {
    const niveis = { ACABOU: 'Acabou', A_ACABAR: 'Está a acabar', URGENTE: 'Urgente' };
    const titulo = p.tipo === 'FALTA' ? 'Falta: ' + p.artigo : 'Sugestão: ' + p.texto;
    let sub = p.tipo === 'FALTA' ? (niveis[p.nivel] || '') + (p.texto ? ' · ' + p.texto : '') : (p.porque || '');
    const link = p.link ? '<a href="' + esc(p.link) + '" target="_blank" rel="noopener noreferrer nofollow" class="item-sub">Ver link</a>' : '';
    return '<div class="cartao" style="display:flex;flex-direction:column;gap:10px">' +
      '<div class="item-texto"><span class="item-titulo" style="font-size:14px">' + esc(titulo) + '</span>' +
      '<span class="item-sub">' + esc(sub) + (sub ? ' · ' : '') + 'anónimo · ' + esc(quando(p.criadoEm)) + '</span>' + link + '</div>' +
      '<div class="acoes"><button class="btn pequeno" type="button" data-acao="decidir-pedido" data-id="' + esc(p.id) + '" data-d="APROVAR">Aprovar</button>' +
      '<button class="btn fantasma pequeno" type="button" data-acao="decidir-pedido" data-id="' + esc(p.id) + '" data-d="DESCARTAR">Descartar</button></div></div>';
  }

  function dialogoNovaRec() {
    abrirDialogo(
      '<h2>Nova recomendação</h2><form id="form-rec">' +
      '<label class="campo">O que comprar ou fazer<input name="titulo" required maxlength="120" placeholder="Ex.: Trocar pilhas dos microfones"></label>' +
      '<label class="campo">Detalhe (opcional)<input name="detalhe" maxlength="300" placeholder="Ex.: Antes de domingo"></label>' +
      '<div class="acoes"><button class="btn fantasma" type="button" data-acao="fechar">Cancelar</button><button class="btn" type="submit">Criar</button></div></form>'
    );
    $('form-rec').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api('criarRecomendacao', { titulo: fd.get('titulo'), detalhe: fd.get('detalhe') });
        fecharDialogo();
        toast('Recomendação criada.');
        ecraCompras();
      } catch (err) { toast(err.message, 'erro'); }
    });
  }

  // -------------------------------------------------------------------------
  // EQUIPA (só Master) + QR da página de pedidos
  // -------------------------------------------------------------------------
  async function ecraEquipa() {
    topo('Equipa', '<p>Só o Master vê este ecrã. Operadores só registam entradas e baixas.</p>');
    carregando();
    try {
      const us = await api('listarUtilizadores');
      const linkPedidos = urlApp('', 'pedido.html');
      conteudo(
        '<form id="form-user" class="cartao" style="display:flex;flex-direction:column;gap:10px">' +
        '<strong>Adicionar pessoa</strong>' +
        '<label class="campo">Email Google<input name="email" type="email" required placeholder="nome@gmail.com" autocomplete="off"></label>' +
        '<label class="campo">Cargo<select name="cargo"><option value="OPERADOR">Operador · só stock</option><option value="MASTER">Master · tudo</option></select></label>' +
        '<button class="btn" type="submit">Dar acesso</button></form>' +
        '<h2 class="secao">Com acesso</h2>' +
        us.map((u) =>
          '<div class="cartao item"><span class="item-texto"><span class="item-titulo" style="font-size:14px">' + esc(u.email) + '</span>' +
          (u.principal ? '<span class="item-sub">Master principal</span>' : '') + '</span>' +
          '<span class="badge' + (u.cargo === 'MASTER' ? ' escuro' : '') + '">' + (u.cargo === 'MASTER' ? 'Master' : 'Operador') + '</span>' +
          (u.principal ? '' : '<button class="btn-texto" type="button" data-acao="remover-user" data-email="' + esc(u.email) + '" aria-label="Remover ' + esc(u.email) + '">Remover</button>') +
          '</div>').join('') +
        '<h2 class="secao">QR da página de pedidos (anónima)</h2>' +
        '<div class="cartao" style="display:flex;flex-direction:column;gap:12px;align-items:center;text-align:center">' +
        '<div class="qr-grande" id="qr-pedidos" role="img" aria-label="QR code da página de pedidos"></div>' +
        '<span class="item-sub" style="word-break:break-all">' + esc(linkPedidos) + '</span>' +
        '<div class="acoes" style="width:100%"><button class="btn secundario pequeno" type="button" data-acao="baixar-qr">Descarregar QR</button>' +
        '<button class="btn secundario pequeno" type="button" data-acao="copiar-link" data-link="' + esc(linkPedidos) + '">Copiar link</button></div>' +
        '<span class="item-sub">Este QR não muda. Imprime e afixa na cozinha.</span></div>'
      );
      desenharQR($('qr-pedidos'), linkPedidos, 600);
      $('form-user').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await api('guardarUtilizador', { email: fd.get('email'), cargo: fd.get('cargo') });
          toast('Acesso dado.');
          ecraEquipa();
        } catch (err) { toast(err.message, 'erro'); }
      });
    } catch (e) { conteudo('<p class="vazio">' + esc(e.message) + '</p>'); }
  }

  // -------------------------------------------------------------------------
  // QR
  // -------------------------------------------------------------------------
  function urlApp(hash, ficheiro) {
    const base = location.origin + location.pathname.replace(/[^/]*$/, '');
    return base + (ficheiro || '') + (hash || '');
  }

  function desenharQR(el, texto, tamanho) {
    if (!el) return;
    el.innerHTML = '';
    if (typeof window.qrcode !== 'function') { el.textContent = 'QR indisponível'; return; }
    const qr = window.qrcode(0, 'M');
    qr.addData(texto);
    qr.make();
    const n = qr.getModuleCount();
    const margem = 4;
    const celula = Math.max(1, Math.floor(tamanho / (n + margem * 2)));
    const lado = celula * (n + margem * 2);
    const c = document.createElement('canvas');
    c.width = lado;
    c.height = lado;
    const g = c.getContext('2d');
    g.fillStyle = '#FFFFFF';
    g.fillRect(0, 0, lado, lado);
    g.fillStyle = '#10403B';
    for (let r = 0; r < n; r++) {
      for (let k = 0; k < n; k++) {
        if (qr.isDark(r, k)) g.fillRect((k + margem) * celula, (r + margem) * celula, celula, celula);
      }
    }
    el.appendChild(c);
  }

  function baixarQR() {
    const canvas = document.querySelector('#qr-pedidos canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'qr-pedidos-catedral.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // -------------------------------------------------------------------------
  // Diálogo
  // -------------------------------------------------------------------------
  function abrirDialogo(html) {
    const d = $('dialogo');
    d.innerHTML = html;
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    const primeiro = d.querySelector('input, select, textarea');
    if (primeiro) primeiro.focus();
  }

  function fecharDialogo() {
    const d = $('dialogo');
    if (typeof d.close === 'function') d.close(); else d.removeAttribute('open');
    d.innerHTML = '';
  }

  // -------------------------------------------------------------------------
  // Eventos (delegados)
  // -------------------------------------------------------------------------
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-acao]');
    if (!el || el.tagName === 'INPUT') return;
    const acao = el.dataset.acao;
    try {
      switch (acao) {
        case 'sair': sair(); break;
        case 'fechar': fecharDialogo(); break;
        case 'filtro-stock': filtroStock = el.dataset.valor; desenharStock(); break;
        case 'novo-artigo': dialogoArtigo(null); break;
        case 'abrir-artigo': {
          const a = estado.artigos.find((x) => x.id === el.dataset.id);
          if (isMaster()) dialogoArtigo(a);
          else location.hash = '#/movimento?tipo=BAIXA&artigo=' + encodeURIComponent(el.dataset.id);
          break;
        }
        case 'desativar-artigo':
          if (!confirm('Desativar este artigo? O histórico mantém-se.')) break;
          await api('guardarArtigo', Object.assign({}, estado.artigos.find((x) => x.id === el.dataset.id), { ativo: false, quantidade: '' }));
          fecharDialogo(); toast('Artigo desativado.'); ecraStock();
          break;
        case 'qtd': {
          const inp = $('mov-qtd');
          const v = Math.max(0, (Number(inp.value) || 0) + Number(el.dataset.delta));
          inp.value = String(v);
          break;
        }
        case 'filtro-hist':
          estado.histFiltro = el.dataset.valor;
          document.querySelectorAll('[data-acao="filtro-hist"]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
          carregarHistorico();
          break;
        case 'exportar-hist': exportarCSV(); break;
        case 'fatura-manual': dialogoFaturaManual(); break;
        case 'colar-claude': dialogoColarClaude(); break;
        case 'copiar-artigos': await copiarArtigos(); break;
        case 'abrir-fatura': {
          const f = (ecraFaturas._pendentes || []).find((x) => x.id === el.dataset.id);
          if (f) abrirRevisao(f);
          break;
        }
        case 'linha': {
          const l = estado.faturaAberta.linhas[Number(el.dataset.i)];
          if (el.dataset.d === 'ACEITE' && !l.artigoId) { toast('Escolhe o artigo de stock (ou "+ Artigo novo").', 'erro'); break; }
          if (el.dataset.d === 'ACEITE' && !(Number(l.quantidade) > 0)) { toast('Indica a quantidade.', 'erro'); break; }
          l.decisao = el.dataset.d;
          desenharRevisao();
          break;
        }
        case 'linha-nova': adicionarLinhaManual(); break;
        case 'confirmar-fatura': await confirmarFatura(); break;
        case 'fechar-fatura': estado.faturaAberta = null; ecraFaturas(); break;
        case 'descartar-fatura':
          if (!confirm('Descartar esta fatura? Nada entra no stock.')) break;
          await api('descartarFatura', { id: estado.faturaAberta.id });
          estado.faturaAberta = null; toast('Fatura descartada.'); ecraFaturas();
          break;
        case 'nova-rec': dialogoNovaRec(); break;
        case 'arquivar-rec':
          await api('arquivarRecomendacao', { id: el.dataset.id }); toast('Arquivada.'); ecraCompras();
          break;
        case 'decidir-pedido':
          el.disabled = true;
          await api('decidirPedido', { id: el.dataset.id, decisao: el.dataset.d });
          toast(el.dataset.d === 'APROVAR' ? 'Aprovado: passou para a lista de compras.' : 'Pedido descartado.');
          ecraCompras();
          break;
        case 'remover-user':
          if (!confirm('Remover o acesso de ' + el.dataset.email + '? O histórico dele mantém-se.')) break;
          await api('removerUtilizador', { email: el.dataset.email }); toast('Acesso removido.'); ecraEquipa();
          break;
        case 'baixar-qr': baixarQR(); break;
        case 'copiar-link':
          try { await navigator.clipboard.writeText(el.dataset.link); toast('Link copiado.'); }
          catch (err) { window.prompt('Copia o link:', el.dataset.link); }
          break;
        default: break;
      }
    } catch (err) {
      toast(err.message, 'erro');
      if (el.disabled) el.disabled = false;
    }
  });

  document.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.campo && estado.faturaAberta) { campoRevisao(el); return; }
    if (el.dataset && el.dataset.acao === 'marcar-rec') {
      el.disabled = true;
      try {
        await api('marcarRecomendacao', { id: el.dataset.id, feita: el.checked });
        ecraCompras();
      } catch (err) {
        el.checked = !el.checked;
        el.disabled = false;
        toast(err.message, 'erro');
      }
    }
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.campo && el.dataset.campo !== 'artigoId' && estado.faturaAberta) {
      const l = estado.faturaAberta.linhas[Number(el.dataset.i)];
      if (l) l[el.dataset.campo] = el.value;
    }
  });

  // -------------------------------------------------------------------------
  // Arranque
  // -------------------------------------------------------------------------
  let guardado = null;
  try { guardado = sessionStorage.getItem(TOKEN_KEY); } catch (e) { guardado = null; }
  if (guardado && expiraEm(guardado) > Date.now() + 60000) entrar(guardado);
  else mostrarLogin('');
})();
