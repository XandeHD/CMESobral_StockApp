// Comunicação com o Apps Script + utilitários partilhados.
(function () {
  const CFG = window.APP_CONFIG || {};

  async function chamar(action, payload, idToken) {
    if (!CFG.API_URL || CFG.API_URL.indexOf('COLAR_AQUI') === 0) {
      throw Object.assign(new Error('A app ainda não está configurada (config.js).'), { code: 500 });
    }
    let res;
    try {
      // text/plain evita o "preflight" CORS, que o Apps Script não suporta.
      res = await fetch(CFG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: action, payload: payload || {}, idToken: idToken || undefined })
      });
    } catch (e) {
      throw Object.assign(new Error('Sem ligação. Verifica a internet e tenta outra vez.'), { code: 0 });
    }
    let data;
    try { data = await res.json(); } catch (e) {
      throw Object.assign(new Error('Resposta inesperada do servidor.'), { code: res.status });
    }
    if (!data.ok) throw Object.assign(new Error(data.erro || 'Erro.'), { code: data.codigo });
    return data.data;
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function quando(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const agora = new Date();
    const hm = d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    const mesmoDia = (a, b) => a.toDateString() === b.toDateString();
    if (mesmoDia(d, agora)) return 'hoje ' + hm;
    const ontem = new Date(agora); ontem.setDate(agora.getDate() - 1);
    if (mesmoDia(d, ontem)) return 'ontem ' + hm;
    return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' }) + ' ' + hm;
  }

  function fmt(n) {
    return Number(n).toLocaleString('pt-PT', { maximumFractionDigits: 3 });
  }

  let toastTimer = null;
  function toast(msg, tipo) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'toast visivel' + (tipo === 'erro' ? ' erro' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 3500);
  }

  window.App = { chamar: chamar, esc: esc, quando: quando, fmt: fmt, toast: toast, CFG: CFG };
})();
