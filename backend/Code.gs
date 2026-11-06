/**
 * Stock da Igreja — Catedral da Esperança (CME Sobral de Monte Agraço)
 * Backend em Google Apps Script. Os dados ficam num Google Sheets.
 *
 * Propriedades do script (Definições do projeto → Propriedades do script):
 *   SHEET_ID            ID da folha de cálculo (o setup() cria e preenche sozinho)
 *   GOOGLE_CLIENT_ID    ID de cliente OAuth (tipo "Aplicação Web") usado no login
 *   MASTER_EMAIL        email do Master principal (é sempre Master, não se pode remover)
 *   ANTHROPIC_API_KEY   (opcional) chave da API da Claude para ler faturas
 *   ANTHROPIC_MODEL     (opcional) modelo a usar; por defeito claude-sonnet-5-5
 *   FATURAS_FOLDER_ID   (opcional) pasta do Drive onde guardar as faturas carregadas
 *   APP_URL             (opcional) endereço da app (GitHub Pages); vai nos emails de aviso
 */

// ---------------------------------------------------------------------------
// Estrutura das folhas
// ---------------------------------------------------------------------------
const TABS = {
  Artigos: ['id', 'nome', 'local', 'unidade', 'minimo', 'quantidade', 'ativo', 'criadoEm', 'criadoPor'],
  Movimentos: ['id', 'data', 'tipo', 'artigoId', 'artigoNome', 'quantidade', 'stockDepois', 'motivo', 'nota', 'email', 'origem'],
  Faturas: ['id', 'criadaEm', 'criadaPor', 'fornecedor', 'numero', 'dataFatura', 'estado', 'linhas', 'ficheiroUrl', 'decididaPor', 'decididaEm'],
  Recomendacoes: ['id', 'criadaEm', 'criadaPor', 'origem', 'artigoId', 'titulo', 'detalhe', 'estado', 'feitaPor', 'feitaEm'],
  Pedidos: ['id', 'criadoEm', 'tipo', 'artigo', 'nivel', 'texto', 'porque', 'link', 'estado', 'decididoPor', 'decididoEm'],
  Utilizadores: ['email', 'cargo', 'ativo', 'criadoEm', 'criadoPor'],
  Eventos: ['id', 'nome', 'data', 'local', 'notas', 'itens', 'avisoDias', 'avisoPara', 'aviso1Em', 'aviso2Em', 'ultimoAviso', 'consumoEm', 'consumoPor', 'estado', 'criadoEm', 'criadoPor']
};

const CARGOS = { MASTER: 'MASTER', OPERADOR: 'OPERADOR' };
const MOTIVOS_BAIXA = ['Consumo', 'Estragado ou fora de validade', 'Oferta / doação', 'Correção de contagem'];
const MAX_PEDIDOS_10MIN = 40;

// ---------------------------------------------------------------------------
// Entrada HTTP
// ---------------------------------------------------------------------------
function doGet() {
  return json_({ ok: true, app: 'stock-catedral' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, erro: 'Pedido inválido.', codigo: 400 });
  }
  const action = String(req.action || '');
  const payload = req.payload || {};
  try {
    if (Object.prototype.hasOwnProperty.call(PUBLIC_ACTIONS, action)) {
      return json_({ ok: true, data: PUBLIC_ACTIONS[action](payload) });
    }
    const handler = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
    if (!handler) throw erro_('Ação desconhecida.', 400);
    const user = autenticar_(req.idToken);
    if (handler.role === CARGOS.MASTER && user.cargo !== CARGOS.MASTER) {
      throw erro_('Só o Master pode fazer isto.', 403);
    }
    return json_({ ok: true, data: handler.fn(payload, user) });
  } catch (err) {
    if (!err.userMessage) console.error(action, err && err.stack ? err.stack : err);
    return json_({
      ok: false,
      erro: err.userMessage || 'Ocorreu um erro inesperado. Tenta outra vez.',
      codigo: err.code || 500
    });
  }
}

// Ações sem login (página pública de pedidos)
const PUBLIC_ACTIONS = {
  artigosPublicos: artigosPublicos_,
  criarPedido: criarPedido_
};

// Ações com login. role MASTER = só Master; sem role = Master e Operador.
const ACTIONS = {
  me: { fn: (p, u) => ({ email: u.email, cargo: u.cargo, motivosBaixa: MOTIVOS_BAIXA }) },

  listarArtigos: { fn: listarArtigos_ },
  registarMovimento: { fn: registarMovimento_ },
  listarMovimentos: { fn: listarMovimentos_ },
  listarRecomendacoes: { fn: listarRecomendacoes_ },
  marcarRecomendacao: { fn: marcarRecomendacao_ },
  listarEventos: { fn: listarEventos_ },

  guardarArtigo: { fn: guardarArtigo_, role: CARGOS.MASTER },
  guardarEvento: { fn: guardarEvento_, role: CARGOS.MASTER },
  apagarEvento: { fn: apagarEvento_, role: CARGOS.MASTER },
  registarConsumoEvento: { fn: registarConsumoEvento_, role: CARGOS.MASTER },
  enviarAvisoEvento: { fn: enviarAvisoAgora_, role: CARGOS.MASTER },
  criarRecomendacao: { fn: criarRecomendacao_, role: CARGOS.MASTER },
  arquivarRecomendacao: { fn: arquivarRecomendacao_, role: CARGOS.MASTER },
  listarPedidos: { fn: listarPedidos_, role: CARGOS.MASTER },
  decidirPedido: { fn: decidirPedido_, role: CARGOS.MASTER },
  listarUtilizadores: { fn: listarUtilizadores_, role: CARGOS.MASTER },
  guardarUtilizador: { fn: guardarUtilizador_, role: CARGOS.MASTER },
  removerUtilizador: { fn: removerUtilizador_, role: CARGOS.MASTER },
  lerFatura: { fn: lerFatura_, role: CARGOS.MASTER },
  criarFaturaManual: { fn: criarFaturaManual_, role: CARGOS.MASTER },
  importarFatura: { fn: importarFatura_, role: CARGOS.MASTER },
  listarFaturas: { fn: listarFaturas_, role: CARGOS.MASTER },
  confirmarFatura: { fn: confirmarFatura_, role: CARGOS.MASTER },
  descartarFatura: { fn: descartarFatura_, role: CARGOS.MASTER }
};

// ---------------------------------------------------------------------------
// Autenticação: o browser envia o ID token do Google; aqui é verificado.
// O email vem SEMPRE do token verificado, nunca do que o browser diz.
// ---------------------------------------------------------------------------
function autenticar_(idToken) {
  if (!idToken || typeof idToken !== 'string') throw erro_('Sessão em falta. Entra outra vez.', 401);
  const cache = CacheService.getScriptCache();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken);
  const key = 'tok_' + Utilities.base64EncodeWebSafe(digest).slice(0, 43);
  let email = cache.get(key);

  if (!email) {
    const res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) throw erro_('Sessão inválida ou expirada. Entra outra vez.', 401);
    const info = JSON.parse(res.getContentText());
    const agora = Math.floor(Date.now() / 1000);
    const issOk = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
    const verificado = info.email_verified === true || info.email_verified === 'true';
    if (!issOk || info.aud !== cfg_('GOOGLE_CLIENT_ID', true) || !verificado || Number(info.exp) <= agora) {
      throw erro_('Sessão inválida ou expirada. Entra outra vez.', 401);
    }
    email = String(info.email).toLowerCase();
    const ttl = Math.max(60, Math.min(3600, Number(info.exp) - agora - 30));
    cache.put(key, email, ttl);
  }

  const cargo = cargoDe_(email);
  if (!cargo) throw erro_('Este email não tem acesso. Pede ao Master para te adicionar.', 403);
  return { email: email, cargo: cargo };
}

function cargoDe_(email) {
  const master = (cfg_('MASTER_EMAIL', true) || '').toLowerCase();
  if (email === master) return CARGOS.MASTER;
  const u = ler_('Utilizadores').find((r) => String(r.email).toLowerCase() === email && bool_(r.ativo));
  return u ? u.cargo : null;
}

// ---------------------------------------------------------------------------
// Artigos e movimentos
// ---------------------------------------------------------------------------
function listarArtigos_() {
  return ler_('Artigos')
    .filter((a) => bool_(a.ativo))
    .map(artigoOut_)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
}

function artigoOut_(a) {
  const quantidade = num_(a.quantidade);
  const minimo = num_(a.minimo);
  return {
    id: a.id, nome: String(a.nome), local: String(a.local || ''), unidade: String(a.unidade || 'un'),
    minimo: minimo, quantidade: quantidade, baixo: quantidade < minimo
  };
}

function guardarArtigo_(p, user) {
  const nome = texto_(p.nome, 80, true, 'O nome do artigo');
  const dados = {
    nome: nome,
    local: texto_(p.local, 40),
    unidade: texto_(p.unidade, 15) || 'un',
    minimo: numPositivo_(p.minimo, 'O mínimo', true)
  };
  return comLock_(() => {
    if (p.id) {
      const atual = ler_('Artigos').find((a) => a.id === p.id);
      if (!atual) throw erro_('Artigo não encontrado.', 404);
      if (p.ativo === false) dados.ativo = false;
      atualizar_('Artigos', 'id', p.id, dados);
      // Um ajuste direto de quantidade fica sempre registado como movimento.
      if (p.quantidade !== undefined && p.quantidade !== null && p.quantidade !== '') {
        const nova = numPositivo_(p.quantidade, 'A quantidade', true);
        const diff = nova - num_(atual.quantidade);
        if (diff !== 0) {
          aplicarMovimento_(p.id, diff > 0 ? 'ENTRADA' : 'BAIXA', Math.abs(diff),
            'Correção de contagem', 'Ajuste feito na ficha do artigo', user.email, 'ajuste');
        }
      }
      const qtdFinal = (p.quantidade !== undefined && p.quantidade !== null && p.quantidade !== '')
        ? numPositivo_(p.quantidade, 'A quantidade', true) : atual.quantidade;
      return artigoOut_(Object.assign({}, atual, dados, { quantidade: qtdFinal }));
    }
    const existe = ler_('Artigos').find((a) => bool_(a.ativo) && norm_(a.nome) === norm_(nome));
    if (existe) throw erro_('Já existe um artigo com esse nome.', 409);
    const novo = Object.assign({ id: id_('A'), quantidade: 0, ativo: true, criadoEm: new Date(), criadoPor: user.email }, dados);
    acrescentar_('Artigos', novo);
    const inicial = num_(p.quantidade);
    if (inicial > 0) aplicarMovimento_(novo.id, 'ENTRADA', inicial, 'Stock inicial', '', user.email, 'ajuste');
    return artigoOut_(Object.assign({}, novo, { quantidade: inicial > 0 ? inicial : 0 }));
  });
}

function registarMovimento_(p, user) {
  const tipo = p.tipo === 'BAIXA' ? 'BAIXA' : p.tipo === 'ENTRADA' ? 'ENTRADA' : null;
  if (!tipo) throw erro_('Escolhe entrada ou baixa.', 400);
  const qtd = numPositivo_(p.quantidade, 'A quantidade');
  if (qtd <= 0) throw erro_('A quantidade tem de ser maior que zero.', 400);
  const motivo = tipo === 'BAIXA' ? texto_(p.motivo, 60, true, 'O motivo da baixa') : (texto_(p.motivo, 60) || 'Entrada manual');
  const nota = texto_(p.nota, 200);
  return comLock_(() => aplicarMovimento_(String(p.artigoId || ''), tipo, qtd, motivo, nota, user.email, 'manual'));
}

/** Tem de ser chamado dentro de comLock_. Atualiza o stock e regista o movimento com o autor. */
function aplicarMovimento_(artigoId, tipo, qtd, motivo, nota, email, origem) {
  const artigo = ler_('Artigos').find((a) => a.id === artigoId && bool_(a.ativo));
  if (!artigo) throw erro_('Artigo não encontrado.', 404);
  const antes = num_(artigo.quantidade);
  const depois = arred_(tipo === 'ENTRADA' ? antes + qtd : antes - qtd);
  if (depois < 0) throw erro_('Stock insuficiente: só há ' + antes + ' ' + (artigo.unidade || 'un') + ' de ' + artigo.nome + '.', 409);
  atualizar_('Artigos', 'id', artigoId, { quantidade: depois });
  const mov = {
    id: id_('M'), data: new Date(), tipo: tipo, artigoId: artigoId, artigoNome: artigo.nome,
    quantidade: qtd, stockDepois: depois, motivo: motivo, nota: nota, email: email, origem: origem
  };
  acrescentar_('Movimentos', mov);
  return movimentoOut_(mov);
}

function listarMovimentos_(p, user) {
  let lim = Math.min(Math.max(parseInt(p.limite, 10) || 50, 1), 500);
  if (user.cargo !== CARGOS.MASTER) lim = Math.min(lim, 10);
  const filtrado = !!(p.tipo || p.email || p.artigoId);
  // Lê só as últimas linhas: 50 no máximo (100 se houver filtros, para ainda sobrar resultado).
  let rows = lerUltimas_('Movimentos', filtrado ? 100 : Math.min(lim, 50));
  if (p.tipo === 'ENTRADA' || p.tipo === 'BAIXA') rows = rows.filter((m) => m.tipo === p.tipo);
  if (p.email) rows = rows.filter((m) => String(m.email).toLowerCase() === String(p.email).toLowerCase());
  if (p.artigoId) rows = rows.filter((m) => m.artigoId === p.artigoId);
  return rows.reverse().slice(0, lim).map(movimentoOut_);
}

function movimentoOut_(m) {
  return {
    id: m.id, data: iso_(m.data), tipo: m.tipo, artigoId: m.artigoId, artigoNome: String(m.artigoNome),
    quantidade: num_(m.quantidade), stockDepois: num_(m.stockDepois), motivo: String(m.motivo || ''),
    nota: String(m.nota || ''), email: String(m.email), origem: String(m.origem || '')
  };
}

// ---------------------------------------------------------------------------
// Recomendações (lista de compras com checkbox)
// ---------------------------------------------------------------------------
function listarRecomendacoes_() {
  comLock_(sincronizarAuto_);
  const limite = Date.now() - 30 * 24 * 3600 * 1000;
  return ler_('Recomendacoes')
    .filter((r) => r.estado === 'ABERTA' || (r.estado === 'FEITA' && new Date(r.feitaEm).getTime() > limite))
    .map((r) => ({
      id: r.id, origem: r.origem, titulo: String(r.titulo), detalhe: String(r.detalhe || ''),
      feita: r.estado === 'FEITA', feitaPor: String(r.feitaPor || ''), feitaEm: iso_(r.feitaEm),
      criadaPor: String(r.criadaPor || ''), criadaEm: iso_(r.criadaEm)
    }))
    .sort((a, b) => (a.feita === b.feita ? (a.criadaEm < b.criadaEm ? 1 : -1) : a.feita ? 1 : -1));
}

/** Cria recomendações automáticas para artigos abaixo do mínimo e fecha as que já não se aplicam. */
function sincronizarAuto_() {
  const artigos = ler_('Artigos').filter((a) => bool_(a.ativo));
  const recs = ler_('Recomendacoes');
  artigos.forEach((a) => {
    const qtd = num_(a.quantidade);
    const min = num_(a.minimo);
    const aberta = recs.find((r) => r.origem === 'AUTO' && r.artigoId === a.id && r.estado === 'ABERTA');
    if (qtd < min && !aberta) {
      acrescentar_('Recomendacoes', {
        id: id_('R'), criadaEm: new Date(), criadaPor: 'automático', origem: 'AUTO', artigoId: a.id,
        titulo: 'Comprar ' + a.nome,
        detalhe: 'Stock ' + qtd + ' ' + (a.unidade || 'un') + ' · mínimo ' + min,
        estado: 'ABERTA', feitaPor: '', feitaEm: ''
      });
    } else if (qtd >= min && aberta) {
      atualizar_('Recomendacoes', 'id', aberta.id, { estado: 'RESOLVIDA', feitaPor: 'automático (stock reposto)', feitaEm: new Date() });
    }
  });
  sincronizarEventos_();
}

function marcarRecomendacao_(p, user) {
  return comLock_(() => {
    const r = ler_('Recomendacoes').find((x) => x.id === p.id);
    if (!r || (r.estado !== 'ABERTA' && r.estado !== 'FEITA')) throw erro_('Recomendação não encontrada.', 404);
    const feita = p.feita === true;
    atualizar_('Recomendacoes', 'id', p.id, feita
      ? { estado: 'FEITA', feitaPor: user.email, feitaEm: new Date() }
      : { estado: 'ABERTA', feitaPor: '', feitaEm: '' });
    return { id: p.id, feita: feita, feitaPor: feita ? user.email : '' };
  });
}

function criarRecomendacao_(p, user) {
  const rec = {
    id: id_('R'), criadaEm: new Date(), criadaPor: user.email, origem: 'MANUAL', artigoId: '',
    titulo: texto_(p.titulo, 120, true, 'O título'), detalhe: texto_(p.detalhe, 300),
    estado: 'ABERTA', feitaPor: '', feitaEm: ''
  };
  comLock_(() => acrescentar_('Recomendacoes', rec));
  return { id: rec.id };
}

function arquivarRecomendacao_(p) {
  comLock_(() => atualizar_('Recomendacoes', 'id', String(p.id || ''), { estado: 'ARQUIVADA' }));
  return { id: p.id };
}

// ---------------------------------------------------------------------------
// Pedidos anónimos (página pública) e aprovação pelo Master
// ---------------------------------------------------------------------------
function artigosPublicos_() {
  return ler_('Artigos').filter((a) => bool_(a.ativo)).map((a) => String(a.nome)).sort((a, b) => a.localeCompare(b, 'pt'));
}

function criarPedido_(p) {
  // Campo escondido: só robôs o preenchem. Responde "ok" sem gravar nada.
  if (p.website) return { ok: true };

  const cache = CacheService.getScriptCache();
  const contagem = Number(cache.get('pedidos_10min') || 0);
  if (contagem >= MAX_PEDIDOS_10MIN) throw erro_('Muitos pedidos neste momento. Tenta daqui a uns minutos.', 429);

  const tipo = p.tipo === 'IDEIA' ? 'IDEIA' : 'FALTA';
  const pedido = {
    id: id_('P'), criadoEm: new Date(), tipo: tipo,
    artigo: tipo === 'FALTA' ? texto_(p.artigo, 80, true, 'O artigo') : '',
    nivel: tipo === 'FALTA' ? (['ACABOU', 'A_ACABAR', 'URGENTE'].indexOf(p.nivel) >= 0 ? p.nivel : 'ACABOU') : '',
    texto: tipo === 'IDEIA' ? texto_(p.texto, 120, true, 'A sugestão') : texto_(p.texto, 200),
    porque: texto_(p.porque, 400),
    link: linkSeguro_(p.link),
    estado: 'PENDENTE', decididoPor: '', decididoEm: ''
  };
  comLock_(() => acrescentar_('Pedidos', pedido));
  cache.put('pedidos_10min', String(contagem + 1), 600);
  return { ok: true };
}

function listarPedidos_(p) {
  const estado = p.estado || 'PENDENTE';
  return ler_('Pedidos')
    .filter((r) => estado === 'TODOS' || r.estado === estado)
    .reverse()
    .slice(0, 200)
    .map((r) => ({
      id: r.id, criadoEm: iso_(r.criadoEm), tipo: r.tipo, artigo: String(r.artigo || ''), nivel: String(r.nivel || ''),
      texto: String(r.texto || ''), porque: String(r.porque || ''), link: String(r.link || ''),
      estado: r.estado, decididoPor: String(r.decididoPor || '')
    }));
}

function decidirPedido_(p, user) {
  const aprovar = p.decisao === 'APROVAR';
  return comLock_(() => {
    const ped = ler_('Pedidos').find((r) => r.id === p.id);
    if (!ped) throw erro_('Pedido não encontrado.', 404);
    if (ped.estado !== 'PENDENTE') throw erro_('Este pedido já foi decidido.', 409);
    atualizar_('Pedidos', 'id', ped.id, { estado: aprovar ? 'APROVADO' : 'DESCARTADO', decididoPor: user.email, decididoEm: new Date() });
    if (aprovar) {
      const niveis = { ACABOU: 'acabou', A_ACABAR: 'está a acabar', URGENTE: 'urgente' };
      const titulo = ped.tipo === 'FALTA' ? 'Repor ' + ped.artigo : 'Comprar ' + ped.texto;
      const detalhe = ped.tipo === 'FALTA'
        ? 'Pedido da equipa (' + (niveis[ped.nivel] || 'acabou') + ')' + (ped.texto ? ' · ' + ped.texto : '')
        : 'Sugestão' + (ped.porque ? ' · ' + ped.porque : '') + (ped.link ? ' · ' + ped.link : '');
      acrescentar_('Recomendacoes', {
        id: id_('R'), criadaEm: new Date(), criadaPor: user.email, origem: 'PEDIDO', artigoId: '',
        titulo: texto_(titulo, 120), detalhe: texto_(detalhe, 300), estado: 'ABERTA', feitaPor: '', feitaEm: ''
      });
    }
    return { id: ped.id, estado: aprovar ? 'APROVADO' : 'DESCARTADO' };
  });
}

// ---------------------------------------------------------------------------
// Utilizadores
// ---------------------------------------------------------------------------
function listarUtilizadores_() {
  const master = (cfg_('MASTER_EMAIL', true) || '').toLowerCase();
  const lista = [{ email: master, cargo: CARGOS.MASTER, principal: true }];
  ler_('Utilizadores').filter((u) => bool_(u.ativo) && String(u.email).toLowerCase() !== master)
    .forEach((u) => lista.push({ email: String(u.email), cargo: u.cargo, principal: false }));
  return lista;
}

function guardarUtilizador_(p, user) {
  const email = String(p.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw erro_('Email inválido.', 400);
  if (email === (cfg_('MASTER_EMAIL', true) || '').toLowerCase()) throw erro_('Este é o Master principal; não pode ser alterado aqui.', 400);
  const cargo = p.cargo === CARGOS.MASTER ? CARGOS.MASTER : CARGOS.OPERADOR;
  comLock_(() => {
    const existe = ler_('Utilizadores').find((u) => String(u.email).toLowerCase() === email);
    if (existe) atualizar_('Utilizadores', 'email', existe.email, { cargo: cargo, ativo: true });
    else acrescentar_('Utilizadores', { email: email, cargo: cargo, ativo: true, criadoEm: new Date(), criadoPor: user.email });
  });
  return { email: email, cargo: cargo };
}

function removerUtilizador_(p) {
  const email = String(p.email || '').trim().toLowerCase();
  if (email === (cfg_('MASTER_EMAIL', true) || '').toLowerCase()) throw erro_('O Master principal não pode ser removido.', 400);
  comLock_(() => {
    const existe = ler_('Utilizadores').find((u) => String(u.email).toLowerCase() === email);
    if (!existe) throw erro_('Utilizador não encontrado.', 404);
    // Fica desativado (não apagado) para o histórico continuar a fazer sentido.
    atualizar_('Utilizadores', 'email', existe.email, { ativo: false });
  });
  return { email: email };
}

// ---------------------------------------------------------------------------
// Faturas
// ---------------------------------------------------------------------------
const TIPOS_FICHEIRO = { 'application/pdf': 'document', 'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image' };

function lerFatura_(p, user) {
  const chave = cfg_('ANTHROPIC_API_KEY', true);
  if (!chave) throw erro_('A leitura automática está desligada (falta a chave da API). Cria a fatura à mão.', 400);
  const mime = String(p.mimeType || '');
  const tipoBloco = TIPOS_FICHEIRO[mime];
  if (!tipoBloco) throw erro_('Formato não suportado. Usa PDF, JPG, PNG ou WEBP.', 400);
  const dados = String(p.base64 || '');
  if (!dados || dados.length > 14000000) throw erro_('Ficheiro vazio ou demasiado grande (máx. ~10 MB).', 400);

  const extraido = chamarClaude_(chave, tipoBloco, mime, dados);

  let ficheiroUrl = '';
  const pasta = cfg_('FATURAS_FOLDER_ID', true);
  if (pasta) {
    const blob = Utilities.newBlob(Utilities.base64Decode(dados), mime, texto_(p.nomeFicheiro, 80) || 'fatura');
    ficheiroUrl = DriveApp.getFolderById(pasta).createFile(blob).getUrl();
  }
  return criarFaturaPendente_(extraido, user, ficheiroUrl);
}

/**
 * Importa a lista gerada pela Skill "ler-fatura-igreja" no Claude (sem API).
 * p = { fornecedor, numero, data, linhas: [{ descricao, quantidade, unidade, artigo }] }
 */
function importarFatura_(p, user) {
  if (!p || !Array.isArray(p.linhas) || !p.linhas.length) throw erro_('A lista não tem linhas. Confirma que colaste o bloco todo.', 400);
  return criarFaturaPendente_(p, user, '');
}

/** Cria a fatura PENDENTE e sugere o artigo de stock de cada linha (o Master confirma depois). */
function criarFaturaPendente_(extraido, user, ficheiroUrl) {
  const artigos = ler_('Artigos').filter((a) => bool_(a.ativo));
  const linhas = (extraido.linhas || []).slice(0, 80).map((l, i) => {
    // Se a Skill indicou o nome exato de um artigo de stock, usa-o; senão tenta adivinhar pela descrição.
    const pedido = norm_(l.artigo || '');
    const sug = (pedido && artigos.find((a) => norm_(a.nome) === pedido)) || sugerirArtigo_(String(l.descricao || ''), artigos);
    return {
      id: 'L' + (i + 1), descricao: texto_(l.descricao, 120) || '(sem descrição)',
      quantidade: arred_(Math.max(0, Number(String(l.quantidade).replace(',', '.')) || 0)), unidade: texto_(l.unidade, 15),
      artigoId: sug ? sug.id : '', artigoNome: sug ? String(sug.nome) : '', estado: 'PENDENTE'
    };
  });
  const fatura = {
    id: id_('F'), criadaEm: new Date(), criadaPor: user.email,
    fornecedor: texto_(extraido.fornecedor, 80), numero: texto_(extraido.numero, 40), dataFatura: texto_(extraido.data, 20),
    estado: 'PENDENTE', linhas: JSON.stringify(linhas), ficheiroUrl: ficheiroUrl || '', decididaPor: '', decididaEm: ''
  };
  comLock_(() => acrescentar_('Faturas', fatura));
  return faturaOut_(fatura);
}

function chamarClaude_(chave, tipoBloco, mime, base64) {
  const ferramenta = {
    name: 'registar_fatura',
    description: 'Regista os dados lidos de uma fatura de compra.',
    input_schema: {
      type: 'object',
      properties: {
        fornecedor: { type: 'string', description: 'Nome do fornecedor/loja' },
        numero: { type: 'string', description: 'Número da fatura' },
        data: { type: 'string', description: 'Data da fatura no formato AAAA-MM-DD' },
        linhas: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              descricao: { type: 'string', description: 'Descrição do artigo como aparece na fatura' },
              quantidade: { type: 'number', description: 'Quantidade total em unidades de consumo (ex.: 4 packs de 6 = 24)' },
              unidade: { type: 'string', description: 'Unidade (un, kg, L, pac, cx)' }
            },
            required: ['descricao', 'quantidade']
          }
        }
      },
      required: ['linhas']
    }
  };
  const corpo = {
    model: cfg_('ANTHROPIC_MODEL', true) || 'claude-sonnet-5-5',
    max_tokens: 4000,
    tools: [ferramenta],
    tool_choice: { type: 'tool', name: 'registar_fatura' },
    messages: [{
      role: 'user',
      content: [
        { type: tipoBloco, source: { type: 'base64', media_type: mime, data: base64 } },
        { type: 'text', text: 'Lê esta fatura de compras de uma igreja e regista o fornecedor, número, data e cada linha de artigo. Ignora portes, taxas e totais. Responde só através da ferramenta.' }
      ]
    }]
  };
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify(corpo),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    console.error('Claude API', res.getResponseCode(), res.getContentText().slice(0, 500));
    throw erro_('Não foi possível ler a fatura agora. Tenta outra vez ou cria-a à mão.', 502);
  }
  const resposta = JSON.parse(res.getContentText());
  const bloco = (resposta.content || []).find((b) => b.type === 'tool_use');
  if (!bloco || !bloco.input) throw erro_('A fatura não foi reconhecida. Cria-a à mão.', 422);
  return bloco.input;
}

/** Associa uma linha da fatura ao artigo de stock mais parecido (por palavras em comum). */
function sugerirArtigo_(descricao, artigos) {
  const palavras = (s) => norm_(s).split(' ').filter((w) => w.length > 2);
  const alvo = palavras(descricao);
  if (!alvo.length) return null;
  let melhor = null;
  let melhorScore = 0;
  artigos.forEach((a) => {
    const pa = palavras(a.nome);
    if (!pa.length) return;
    const comuns = pa.filter((w) => alvo.some((t) => t.indexOf(w) === 0 || w.indexOf(t) === 0)).length;
    const score = comuns / pa.length;
    if (score > melhorScore) { melhorScore = score; melhor = a; }
  });
  return melhorScore >= 0.5 ? melhor : null;
}

function criarFaturaManual_(p, user) {
  const fatura = {
    id: id_('F'), criadaEm: new Date(), criadaPor: user.email,
    fornecedor: texto_(p.fornecedor, 80), numero: texto_(p.numero, 40), dataFatura: texto_(p.dataFatura, 20),
    estado: 'PENDENTE', linhas: '[]', ficheiroUrl: '', decididaPor: '', decididaEm: ''
  };
  comLock_(() => acrescentar_('Faturas', fatura));
  return faturaOut_(fatura);
}

function listarFaturas_(p) {
  const estado = p.estado || 'PENDENTE';
  return ler_('Faturas').filter((f) => estado === 'TODAS' || f.estado === estado).reverse().slice(0, 50).map(faturaOut_);
}

function faturaOut_(f) {
  let linhas = [];
  try { linhas = JSON.parse(f.linhas || '[]'); } catch (e) { linhas = []; }
  return {
    id: f.id, criadaEm: iso_(f.criadaEm), criadaPor: String(f.criadaPor), fornecedor: String(f.fornecedor || ''),
    numero: String(f.numero || ''), dataFatura: String(f.dataFatura || ''), estado: f.estado, linhas: linhas,
    ficheiroUrl: String(f.ficheiroUrl || ''), decididaPor: String(f.decididaPor || '')
  };
}

/**
 * p.linhas: [{ id, descricao, quantidade, decisao: 'ACEITE'|'DESCARTADA', artigoId, novoArtigo: {nome, local, unidade, minimo} }]
 * As linhas aceites entram no stock como ENTRADA, em nome de quem confirmou.
 */
function confirmarFatura_(p, user) {
  return comLock_(() => {
    const f = ler_('Faturas').find((x) => x.id === p.id);
    if (!f) throw erro_('Fatura não encontrada.', 404);
    if (f.estado !== 'PENDENTE') throw erro_('Esta fatura já foi tratada.', 409);
    const entrada = Array.isArray(p.linhas) ? p.linhas.slice(0, 100) : [];
    const ref = 'Fatura ' + (f.numero || f.id) + (f.fornecedor ? ' · ' + f.fornecedor : '');
    const resultado = entrada.map((l, i) => {
      const linha = {
        id: String(l.id || 'L' + (i + 1)), descricao: texto_(l.descricao, 120),
        quantidade: numPositivo_(l.quantidade, 'A quantidade', true), unidade: texto_(l.unidade, 15),
        artigoId: '', artigoNome: '', estado: l.decisao === 'ACEITE' ? 'ACEITE' : 'DESCARTADA'
      };
      if (linha.estado === 'ACEITE') {
        if (linha.quantidade <= 0) throw erro_('A linha "' + linha.descricao + '" não tem quantidade.', 400);
        let artigoId = String(l.artigoId || '');
        if (!artigoId && l.novoArtigo) {
          const nome = texto_(l.novoArtigo.nome, 80, true, 'O nome do artigo novo');
          const igual = ler_('Artigos').find((a) => bool_(a.ativo) && norm_(a.nome) === norm_(nome));
          if (igual) artigoId = igual.id;
          else {
            artigoId = id_('A');
            acrescentar_('Artigos', {
              id: artigoId, nome: nome, local: texto_(l.novoArtigo.local, 40), unidade: texto_(l.novoArtigo.unidade, 15) || 'un',
              minimo: numPositivo_(l.novoArtigo.minimo, 'O mínimo', true), quantidade: 0, ativo: true,
              criadoEm: new Date(), criadoPor: user.email
            });
          }
        }
        if (!artigoId) throw erro_('Escolhe o artigo de stock para "' + linha.descricao + '".', 400);
        const mov = aplicarMovimento_(artigoId, 'ENTRADA', linha.quantidade, 'Fatura aceite', ref, user.email, 'fatura:' + f.id);
        linha.artigoId = artigoId;
        linha.artigoNome = mov.artigoNome;
      }
      return linha;
    });
    atualizar_('Faturas', 'id', f.id, { estado: 'CONFIRMADA', linhas: JSON.stringify(resultado), decididaPor: user.email, decididaEm: new Date() });
    return { id: f.id, aceites: resultado.filter((l) => l.estado === 'ACEITE').length };
  });
}

function descartarFatura_(p, user) {
  return comLock_(() => {
    const f = ler_('Faturas').find((x) => x.id === p.id);
    if (!f) throw erro_('Fatura não encontrada.', 404);
    if (f.estado !== 'PENDENTE') throw erro_('Esta fatura já foi tratada.', 409);
    atualizar_('Faturas', 'id', f.id, { estado: 'DESCARTADA', decididaPor: user.email, decididaEm: new Date() });
    return { id: f.id };
  });
}

// ---------------------------------------------------------------------------
// Instalação: correr UMA vez a partir do editor (▶ setup)
// ---------------------------------------------------------------------------
function setup() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SHEET_ID');
  let ss;
  if (id) ss = SpreadsheetApp.openById(id);
  else {
    ss = SpreadsheetApp.create('Stock Igreja — Catedral da Esperança');
    props.setProperty('SHEET_ID', ss.getId());
  }
  Object.keys(TABS).forEach((nome) => folha_(nome, ss));
  const vazia = ss.getSheetByName('Sheet1') || ss.getSheetByName('Folha1');
  if (vazia && ss.getSheets().length > 1) ss.deleteSheet(vazia);
  console.log('Folha pronta: ' + ss.getUrl());
  ['GOOGLE_CLIENT_ID', 'MASTER_EMAIL'].forEach((k) => {
    if (!props.getProperty(k)) console.warn('Falta definir a propriedade ' + k + ' (Definições do projeto → Propriedades do script).');
  });
}

// ---------------------------------------------------------------------------
// Acesso às folhas
// ---------------------------------------------------------------------------
let SS_CACHE_ = null;
const DADOS_CACHE_ = {};

function ss_() {
  if (!SS_CACHE_) SS_CACHE_ = SpreadsheetApp.openById(cfg_('SHEET_ID'));
  return SS_CACHE_;
}

function folha_(nome, ss) {
  const livro = ss || ss_();
  let sh = livro.getSheetByName(nome);
  if (!sh) {
    sh = livro.insertSheet(nome);
    sh.getRange(1, 1, 1, TABS[nome].length).setValues([TABS[nome]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function ler_(nome) {
  if (DADOS_CACHE_[nome]) return DADOS_CACHE_[nome].map((r) => Object.assign({}, r));
  const sh = folha_(nome);
  const cols = TABS[nome];
  const n = sh.getLastRow() - 1;
  const linhas = n > 0 ? sh.getRange(2, 1, n, cols.length).getValues() : [];
  const objs = linhas.filter((l) => l[0] !== '').map((l) => {
    const o = {};
    cols.forEach((c, i) => { o[c] = l[i]; });
    return o;
  });
  DADOS_CACHE_[nome] = objs;
  return objs.map((r) => Object.assign({}, r));
}

/** Lê só as últimas n linhas (mais leve que ler o separador todo). Ordem cronológica. */
function lerUltimas_(nome, n) {
  const sh = folha_(nome);
  const cols = TABS[nome];
  const total = sh.getLastRow() - 1;
  if (total <= 0) return [];
  const qtd = Math.min(total, n);
  const linhas = sh.getRange(total - qtd + 2, 1, qtd, cols.length).getValues();
  return linhas.filter((l) => l[0] !== '').map((l) => {
    const o = {};
    cols.forEach((c, i) => { o[c] = l[i]; });
    return o;
  });
}

function acrescentar_(nome, obj) {
  const cols = TABS[nome];
  folha_(nome).appendRow(cols.map((c) => celula_(obj[c])));
  delete DADOS_CACHE_[nome];
}

function atualizar_(nome, chave, valor, patch) {
  const sh = folha_(nome);
  const cols = TABS[nome];
  const idx = cols.indexOf(chave);
  const n = sh.getLastRow() - 1;
  if (n <= 0) throw erro_('Registo não encontrado.', 404);
  const chaves = sh.getRange(2, idx + 1, n, 1).getValues();
  const alvo = String(valor).toLowerCase();
  const pos = chaves.findIndex((r) => String(r[0]).toLowerCase() === alvo);
  if (pos < 0) throw erro_('Registo não encontrado.', 404);
  const linha = pos + 2;
  const intervalo = sh.getRange(linha, 1, 1, cols.length);
  const valores = intervalo.getValues();
  Object.keys(patch).forEach((c) => {
    const col = cols.indexOf(c);
    if (col >= 0) valores[0][col] = celula_(patch[c]);
  });
  intervalo.setValues(valores);
  delete DADOS_CACHE_[nome];
}

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------
function comLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw erro_('O sistema está ocupado. Tenta outra vez.', 503);
  try { return fn(); } finally { lock.releaseLock(); }
}

function cfg_(k, opcional) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v && !opcional) throw new Error('Propriedade em falta: ' + k);
  return v;
}

function erro_(msg, code) {
  const e = new Error(msg);
  e.userMessage = msg;
  e.code = code || 400;
  return e;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function id_(prefixo) {
  return prefixo + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase();
}

/** Texto limpo e limitado. Evita fórmulas: texto vindo de fora nunca é interpretado pelo Sheets. */
function texto_(v, max, obrigatorio, nomeCampo) {
  const s = String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max || 200);
  if (obrigatorio && !s) throw erro_((nomeCampo || 'Este campo') + ' é obrigatório.', 400);
  return s;
}

function celula_(v) {
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) return "'" + v;
  return v;
}

function linkSeguro_(v) {
  const s = texto_(v, 300);
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : '';
}

function numPositivo_(v, nome, permitirZero) {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(String(v).replace(',', '.'));
  if (!isFinite(n) || n < 0 || (!permitirZero && n === 0)) throw erro_((nome || 'O valor') + ' tem de ser um número positivo.', 400);
  if (n > 1000000) throw erro_((nome || 'O valor') + ' é demasiado grande.', 400);
  return arred_(n);
}

function num_(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function arred_(n) {
  return Math.round(n * 1000) / 1000;
}

function bool_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

function norm_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function iso_(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  return isNaN(dt.getTime()) ? '' : dt.toISOString();
}

// ---------------------------------------------------------------------------
// Agenda: eventos, artigos por evento e avisos por email
// ---------------------------------------------------------------------------
const AVISO_DIAS = [0, 1, 3, 7];

function itensEvento_(ev) {
  try {
    const v = JSON.parse(ev.itens || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}

/** Dias de calendário entre hoje e a data do evento (negativo = já passou), no fuso do script. */
function diasAte_(data, agora) {
  const tz = Session.getScriptTimeZone();
  const a = Utilities.formatDate(agora || new Date(), tz, 'yyyy-MM-dd');
  const b = Utilities.formatDate(new Date(data), tz, 'yyyy-MM-dd');
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

function eventoOut_(ev, artigos) {
  const porId = {};
  artigos.forEach((a) => { porId[a.id] = a; });
  const itens = itensEvento_(ev).map((i) => {
    const a = porId[i.artigoId];
    const q = num_(i.quantidade);
    const stock = a ? num_(a.quantidade) : 0;
    return {
      artigoId: i.artigoId, nome: a ? String(a.nome) : '(artigo removido)', unidade: a ? String(a.unidade || 'un') : 'un',
      quantidade: q, stock: stock, falta: arred_(Math.max(0, q - stock))
    };
  });
  return {
    id: ev.id, nome: String(ev.nome), data: iso_(ev.data), diasAte: diasAte_(ev.data),
    local: String(ev.local || ''), notas: String(ev.notas || ''), itens: itens,
    faltam: itens.filter((i) => i.falta > 0).length,
    avisoDias: num_(ev.avisoDias), avisoPara: ev.avisoPara === 'MASTERS' ? 'MASTERS' : 'EQUIPA',
    ultimoAviso: iso_(ev.ultimoAviso),
    consumoRegistado: !!ev.consumoEm, consumoEm: iso_(ev.consumoEm), consumoPor: String(ev.consumoPor || '')
  };
}

function listarEventos_() {
  const artigos = ler_('Artigos');
  const limite = Date.now() - 60 * 24 * 3600 * 1000;
  return ler_('Eventos')
    .filter((e) => e.estado === 'ATIVO' && new Date(e.data).getTime() > limite)
    .map((e) => eventoOut_(e, artigos))
    .sort((a, b) => (a.data < b.data ? -1 : 1));
}

function guardarEvento_(p, user) {
  const nome = texto_(p.nome, 80, true, 'O nome do evento');
  const data = new Date(p.data);
  if (!p.data || isNaN(data.getTime())) throw erro_('Indica a data e a hora do evento.', 400);
  const artigos = ler_('Artigos').filter((a) => bool_(a.ativo));
  const juntos = {};
  (Array.isArray(p.itens) ? p.itens : []).slice(0, 60).forEach((i) => {
    const id = String(i.artigoId || '');
    if (!id) return;
    if (!artigos.some((a) => a.id === id)) throw erro_('Um dos artigos já não existe.', 404);
    const q = numPositivo_(i.quantidade, 'A quantidade');
    if (q <= 0) throw erro_('A quantidade de cada artigo tem de ser maior que zero.', 400);
    juntos[id] = arred_((juntos[id] || 0) + q);
  });
  const itens = Object.keys(juntos).map((id) => ({ artigoId: id, quantidade: juntos[id] }));
  const avisoDias = AVISO_DIAS.indexOf(Number(p.avisoDias)) >= 0 ? Number(p.avisoDias) : 3;
  const dados = {
    nome: nome, data: data, local: texto_(p.local, 40), notas: texto_(p.notas, 300),
    itens: JSON.stringify(itens), avisoDias: avisoDias, avisoPara: p.avisoPara === 'MASTERS' ? 'MASTERS' : 'EQUIPA'
  };
  return comLock_(() => {
    let id = p.id;
    if (id) {
      const atual = ler_('Eventos').find((e) => e.id === id && e.estado === 'ATIVO');
      if (!atual) throw erro_('Evento não encontrado.', 404);
      if (atual.consumoEm) throw erro_('Este evento já tem o consumo registado e não pode ser alterado.', 409);
      if (new Date(atual.data).getTime() !== data.getTime() || num_(atual.avisoDias) !== avisoDias) {
        dados.aviso1Em = '';
        dados.aviso2Em = '';
      }
      atualizar_('Eventos', 'id', id, dados);
    } else {
      id = id_('E');
      acrescentar_('Eventos', Object.assign({
        id: id, aviso1Em: '', aviso2Em: '', ultimoAviso: '', consumoEm: '', consumoPor: '',
        estado: 'ATIVO', criadoEm: new Date(), criadoPor: user.email
      }, dados));
    }
    sincronizarEventos_();
    return eventoOut_(ler_('Eventos').find((e) => e.id === id), ler_('Artigos'));
  });
}

function apagarEvento_(p) {
  return comLock_(() => {
    const ev = ler_('Eventos').find((e) => e.id === p.id && e.estado === 'ATIVO');
    if (!ev) throw erro_('Evento não encontrado.', 404);
    atualizar_('Eventos', 'id', ev.id, { estado: 'CANCELADO' });
    sincronizarEventos_();
    return { id: ev.id };
  });
}

/** Baixa dos artigos realmente usados no evento. Cada baixa fica em nome de quem a registou. */
function registarConsumoEvento_(p, user) {
  return comLock_(() => {
    const ev = ler_('Eventos').find((e) => e.id === p.id && e.estado === 'ATIVO');
    if (!ev) throw erro_('Evento não encontrado.', 404);
    if (ev.consumoEm) throw erro_('O consumo deste evento já foi registado.', 409);
    const permitidos = {};
    itensEvento_(ev).forEach((i) => { permitidos[i.artigoId] = true; });
    const reais = {};
    (Array.isArray(p.consumos) ? p.consumos : []).forEach((c) => {
      const id = String(c.artigoId || '');
      const q = numPositivo_(c.quantidade, 'A quantidade', true);
      if (permitidos[id] && q > 0) reais[id] = arred_((reais[id] || 0) + q);
    });
    const artigos = ler_('Artigos');
    Object.keys(reais).forEach((id) => {
      const a = artigos.find((x) => x.id === id && bool_(x.ativo));
      if (!a) throw erro_('Artigo não encontrado.', 404);
      if (num_(a.quantidade) < reais[id]) {
        throw erro_('Stock insuficiente: só há ' + num_(a.quantidade) + ' ' + (a.unidade || 'un') + ' de ' + a.nome + '.', 409);
      }
    });
    const nota = ('Evento: ' + ev.nome).slice(0, 200);
    Object.keys(reais).forEach((id) => aplicarMovimento_(id, 'BAIXA', reais[id], 'Consumo', nota, user.email, 'evento'));
    atualizar_('Eventos', 'id', ev.id, { consumoEm: new Date(), consumoPor: user.email });
    sincronizarEventos_();
    return { baixas: Object.keys(reais).length };
  });
}

/** Mantém na lista de Compras o que falta para os próximos eventos (e fecha o que já não falta). */
function sincronizarEventos_() {
  const desde = Date.now() - 6 * 3600 * 1000;
  const artigos = ler_('Artigos');
  const porId = {};
  artigos.forEach((a) => { porId[a.id] = a; });
  const tz = Session.getScriptTimeZone();
  const precisas = {};
  ler_('Eventos')
    .filter((e) => e.estado === 'ATIVO' && !e.consumoEm && new Date(e.data).getTime() >= desde)
    .forEach((ev) => {
      itensEvento_(ev).forEach((i) => {
        const a = porId[i.artigoId];
        if (!a || !bool_(a.ativo)) return;
        const falta = arred_(num_(i.quantidade) - num_(a.quantidade));
        if (falta <= 0) return;
        const titulo = ('Comprar ' + a.nome + ' (' + ev.nome + ')').slice(0, 120);
        precisas[titulo] = {
          artigoId: a.id,
          detalhe: 'Faltam ' + falta + ' ' + (a.unidade || 'un') + ' · ' + Utilities.formatDate(new Date(ev.data), tz, 'dd/MM HH:mm')
        };
      });
    });
  const recs = ler_('Recomendacoes').filter((r) => r.origem === 'EVENTO' && (r.estado === 'ABERTA' || r.estado === 'FEITA'));
  Object.keys(precisas).forEach((titulo) => {
    if (recs.some((r) => r.titulo === titulo)) return;
    acrescentar_('Recomendacoes', {
      id: id_('R'), criadaEm: new Date(), criadaPor: 'automático', origem: 'EVENTO', artigoId: precisas[titulo].artigoId,
      titulo: titulo, detalhe: precisas[titulo].detalhe, estado: 'ABERTA', feitaPor: '', feitaEm: ''
    });
  });
  recs.filter((r) => r.estado === 'ABERTA' && !precisas[r.titulo]).forEach((r) => {
    atualizar_('Recomendacoes', 'id', r.id, { estado: 'RESOLVIDA', feitaPor: 'automático (evento)', feitaEm: new Date() });
  });
}

// ---------------------------------------------------------------------------
// Avisos por email
// ---------------------------------------------------------------------------
function htmlEsc_(s) {
  return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function destinatarios_(para) {
  return listarUtilizadores_()
    .filter((u) => para === 'MASTERS' ? u.cargo === CARGOS.MASTER : true)
    .map((u) => u.email)
    .filter((e) => /^[^\s@]+@[^\s@]+$/.test(e));
}

/** Envia o aviso de um evento. Devolve quantas pessoas receberam. */
function enviarAvisoEvento_(ev, artigos) {
  const out = eventoOut_(ev, artigos);
  const dests = destinatarios_(out.avisoPara);
  if (!dests.length) return 0;
  const tz = Session.getScriptTimeZone();
  const quandoTxt = Utilities.formatDate(new Date(ev.data), tz, "dd/MM/yyyy 'às' HH:mm");
  const assunto = (out.faltam ? '⚠ Faltam ' + out.faltam + ' artigo(s) para ' : 'Artigos para ') + out.nome + ' (' + Utilities.formatDate(new Date(ev.data), tz, 'dd/MM') + ')';
  const linhasTxt = out.itens.map((i) =>
    '- ' + i.nome + ': precisa de ' + i.quantidade + ' ' + i.unidade + ', em stock ' + i.stock + (i.falta > 0 ? '  → FALTAM ' + i.falta : '  ✓')).join('\n');
  const appUrl = cfg_('APP_URL', true);
  const corpo = out.nome + '\n' + quandoTxt + (out.local ? ' · ' + out.local : '') + '\n\n' +
    (out.itens.length ? linhasTxt : 'Sem artigos associados a este evento.') + '\n\n' +
    (out.faltam ? 'O que falta já está na lista de Compras.' : 'Tudo em stock para este evento.') + (appUrl ? '\n\n' + appUrl : '');
  const td = 'padding:6px 10px;border-bottom:1px solid #E1E8E7';
  const linhasHtml = out.itens.map((i) =>
    '<tr><td style="' + td + '">' + htmlEsc_(i.nome) + '</td>' +
    '<td style="' + td + ';text-align:right">' + i.quantidade + ' ' + htmlEsc_(i.unidade) + '</td>' +
    '<td style="' + td + ';text-align:right">' + i.stock + '</td>' +
    '<td style="' + td + ';text-align:right;font-weight:bold;color:' + (i.falta > 0 ? '#8A2A1C' : '#127369') + '">' + (i.falta > 0 ? 'Faltam ' + i.falta : 'OK') + '</td></tr>').join('');
  const th = 'padding:6px 10px;text-align:';
  const html = '<div style="font-family:Arial,sans-serif;color:#10403B;max-width:560px">' +
    '<h2 style="margin:0 0 4px">' + htmlEsc_(out.nome) + '</h2>' +
    '<p style="margin:0 0 16px;color:#4C5958">' + htmlEsc_(quandoTxt) + (out.local ? ' · ' + htmlEsc_(out.local) : '') + '</p>' +
    (out.itens.length
      ? '<table style="border-collapse:collapse;width:100%;font-size:14px"><tr style="background:#E0F5F2"><th style="' + th + 'left">Artigo</th><th style="' + th + 'right">Precisa</th><th style="' + th + 'right">Stock</th><th style="' + th + 'right">Estado</th></tr>' + linhasHtml + '</table>'
      : '<p>Sem artigos associados a este evento.</p>') +
    '<p style="margin:16px 0 0;font-weight:bold;color:' + (out.faltam ? '#8A2A1C' : '#127369') + '">' +
    (out.faltam ? 'O que falta já está na lista de Compras.' : 'Tudo em stock para este evento.') + '</p>' +
    (appUrl ? '<p><a href="' + htmlEsc_(appUrl) + '">Abrir a app</a></p>' : '') + '</div>';
  dests.forEach((to) => MailApp.sendEmail({ to: to, subject: assunto, body: corpo, htmlBody: html, name: 'Stock · Catedral da Esperança' }));
  return dests.length;
}

function enviarAvisoAgora_(p) {
  return comLock_(() => {
    const ev = ler_('Eventos').find((e) => e.id === p.id && e.estado === 'ATIVO');
    if (!ev) throw erro_('Evento não encontrado.', 404);
    const n = enviarAvisoEvento_(ev, ler_('Artigos'));
    if (!n) throw erro_('Não há ninguém para receber o aviso.', 400);
    const agora = new Date();
    atualizar_('Eventos', 'id', ev.id, { ultimoAviso: agora });
    return { enviados: n, ultimoAviso: agora.toISOString() };
  });
}

/** Corre todos os dias (ver instalarAvisos). 1.º aviso X dias antes; 2.º na véspera, só se ainda faltar algo. */
function avisosDiarios() {
  comLock_(() => {
    const agora = new Date();
    const tz = Session.getScriptTimeZone();
    const hoje = Utilities.formatDate(agora, tz, 'yyyyMMdd');
    const artigos = ler_('Artigos');
    ler_('Eventos').filter((e) => e.estado === 'ATIVO' && !e.consumoEm).forEach((ev) => {
      try {
        const aviso = num_(ev.avisoDias);
        const dias = diasAte_(ev.data, agora);
        if (!aviso || dias < 0) return;
        if (!ev.aviso1Em && dias <= aviso) {
          if (enviarAvisoEvento_(ev, artigos)) atualizar_('Eventos', 'id', ev.id, { aviso1Em: agora, ultimoAviso: agora });
        } else if (aviso > 1 && dias === 1 && !ev.aviso2Em && ev.aviso1Em &&
          Utilities.formatDate(new Date(ev.aviso1Em), tz, 'yyyyMMdd') < hoje &&
          eventoOut_(ev, artigos).faltam > 0) {
          if (enviarAvisoEvento_(ev, artigos)) atualizar_('Eventos', 'id', ev.id, { aviso2Em: agora, ultimoAviso: agora });
        }
      } catch (err) {
        console.error('avisosDiarios', ev.id, err && err.stack ? err.stack : err);
      }
    });
  });
}

/** Correr UMA vez no editor (▶ instalarAvisos): pede a permissão de email e agenda o envio diário às 8h. */
function instalarAvisos() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'avisosDiarios').forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('avisosDiarios').timeBased().everyDays(1).atHour(8).create();
  console.log('Avisos diários agendados (cerca das 8h). Emails que ainda podes enviar hoje: ' + MailApp.getRemainingDailyQuota());
}
