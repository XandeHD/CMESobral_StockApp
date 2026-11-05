// Página pública e anónima de pedidos.
(function () {
  const $ = (id) => document.getElementById(id);
  let tipo = 'FALTA';
  let nivel = 'ACABOU';

  function marcar(grupo, attr, valor) {
    grupo.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === valor)));
  }

  $('tipo').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tipo]');
    if (!b) return;
    tipo = b.dataset.tipo;
    marcar($('tipo'), 'tipo', tipo);
    $('bloco-falta').hidden = tipo !== 'FALTA';
    $('bloco-ideia').hidden = tipo !== 'IDEIA';
  });

  $('nivel').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-nivel]');
    if (!b) return;
    nivel = b.dataset.nivel;
    marcar($('nivel'), 'nivel', nivel);
  });

  // Sugestões de artigos (só nomes). Se falhar, a pessoa escreve à mão.
  App.chamar('artigosPublicos').then((nomes) => {
    $('lista-artigos').innerHTML = nomes.map((n) => '<option value="' + App.esc(n) + '"></option>').join('');
  }).catch(() => {});

  $('form-pedido').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = { tipo: tipo, website: $('website').value };
    if (tipo === 'FALTA') {
      payload.artigo = $('artigo').value.trim();
      payload.nivel = nivel;
      payload.texto = $('nota').value.trim();
      if (!payload.artigo) { App.toast('Diz-nos que artigo está a faltar.', 'erro'); $('artigo').focus(); return; }
    } else {
      payload.texto = $('texto').value.trim();
      payload.porque = $('porque').value.trim();
      payload.link = $('link').value.trim();
      if (!payload.texto) { App.toast('Escreve o que sugeres comprar.', 'erro'); $('texto').focus(); return; }
    }
    const btn = $('enviar');
    btn.disabled = true;
    btn.textContent = 'A enviar…';
    try {
      await App.chamar('criarPedido', payload);
      $('form-pedido').reset();
      $('formulario').hidden = true;
      $('obrigado').hidden = false;
      $('outro').focus();
    } catch (err) {
      App.toast(err.message, 'erro');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Enviar pedido';
    }
  });

  $('outro').addEventListener('click', () => {
    $('obrigado').hidden = true;
    $('formulario').hidden = false;
  });
})();
