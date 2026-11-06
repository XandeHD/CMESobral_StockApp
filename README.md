# Stock da Igreja — Catedral da Esperança (CME Sobral de Monte Agraço)

App gratuita para gerir o stock da igreja: entradas, baixas (sempre com o email de quem fez), faturas lidas automaticamente, lista de compras com checkbox, pedidos anónimos por QR e gestão da equipa.

## Como está montada

| Parte | Onde fica | Custo |
|---|---|---|
| Dados | Google Sheets (separadores Artigos, Movimentos, Faturas, Recomendacoes, Pedidos, Utilizadores) | Grátis |
| Servidor | Google Apps Script (`backend/Code.gs`) | Grátis |
| Páginas | GitHub Pages (`frontend/`) | Grátis |
| Leitura de faturas | Skill no Claude (copiar/colar) ou API da Claude (opcional) | Skill: incluída na subscrição · API: cêntimos por fatura |

- **`index.html`**: app da equipa. Entra-se com conta Google; só entram emails autorizados.
- **`pedido.html`**: página pública e anónima de pedidos (é para aqui que aponta o QR da cozinha).

### Cargos
- **Master**: tudo (stock, artigos, faturas, compras, pedidos, equipa, histórico completo). O email em `MASTER_EMAIL` é sempre Master e não pode ser removido.
- **Operador**: só regista entradas e baixas e marca compras feitas. Vê os últimos 10 movimentos.

### Responsabilidade
- O email de cada movimento vem do login Google **verificado no servidor**; não pode ser escrito nem alterado no telemóvel.
- Movimentos nunca são apagados nem editados. Um erro corrige-se com um movimento contrário (também registado).
- Mudar a contagem na ficha de um artigo gera um movimento "Correção de contagem" em nome de quem mudou.
- Pedidos anónimos não mexem no stock: só depois de um Master aprovar (fica o email de quem aprovou).

---

## Instalação (uma vez, ~30 minutos)

Faz tudo com a **conta Google que vai ser dona dos dados** (de preferência uma conta da igreja).

### 1. Apps Script
1. Abre <https://script.google.com> → **Novo projeto**. Dá-lhe o nome "Stock Igreja".
2. Apaga o conteúdo de `Código.gs` e cola o conteúdo de `backend/Code.gs`.
3. **Definições do projeto** (roda dentada) → ativa *Mostrar o ficheiro de manifesto "appsscript.json"*. Volta ao editor, abre `appsscript.json` e substitui pelo conteúdo de `backend/appsscript.json`.
4. Na barra de cima escolhe a função `setup` e carrega em **Executar**. Aceita as permissões. Nos registos aparece o link da folha de cálculo criada.

### 2. ID de cliente para o login Google (grátis)
1. Abre <https://console.cloud.google.com> → cria um projeto (ex.: "stock-igreja").
2. **APIs e serviços → Ecrã de consentimento OAuth**: tipo *Externo*, nome "Stock Igreja", o teu email. Publica a app (estado *Em produção*). Só usa o âmbito básico de email, por isso não precisa de verificação.
3. **APIs e serviços → Credenciais → Criar credenciais → ID de cliente OAuth** → tipo **Aplicação Web**.
4. Em **Origens JavaScript autorizadas** adiciona o endereço do GitHub Pages (passo 4), por exemplo `https://O-TEU-UTILIZADOR.github.io`.
5. Copia o **ID de cliente** (termina em `.apps.googleusercontent.com`).

### 3. Propriedades do script
No Apps Script: **Definições do projeto → Propriedades do script → Adicionar**:

| Propriedade | Valor |
|---|---|
| `GOOGLE_CLIENT_ID` | o ID do passo 2 |
| `MASTER_EMAIL` | o email do Master principal |
| `ANTHROPIC_API_KEY` | (opcional) chave da API da Claude, de <https://console.anthropic.com> |
| `ANTHROPIC_MODEL` | (opcional) por defeito `claude-sonnet-5-5` |
| `FATURAS_FOLDER_ID` | (opcional) ID de uma pasta do Drive para guardar cópia das faturas |
| `APP_URL` | (opcional) endereço da app, usado no link dos emails de aviso |

`SHEET_ID` já foi preenchido pelo `setup`.

> A chave da API fica só aqui, no servidor. Nunca a ponhas no `config.js` nem a envies por chat.

### 4. Publicar o servidor
1. **Implementar → Nova implementação** → tipo **Aplicação Web**.
2. *Executar como*: **Eu**. *Quem tem acesso*: **Qualquer pessoa**.
3. Copia o **URL da aplicação Web** (termina em `/exec`).

> **Importante para o QR não mudar:** nas atualizações seguintes usa **Implementar → Gerir implementações → ✏️ → Versão: Nova versão**. Nunca "Nova implementação", senão o URL muda.

### 5. Publicar as páginas (GitHub Pages)
1. Cria um repositório no GitHub (ex.: `stock-igreja`) e envia o conteúdo da pasta `frontend/`.
2. Edita `config.js` e cola o `API_URL` (passo 4) e o `GOOGLE_CLIENT_ID` (passo 2).
3. No repositório: **Settings → Pages → Deploy from a branch → main / root**.
4. A app fica em `https://O-TEU-UTILIZADOR.github.io/stock-igreja/` e a página de pedidos em `.../pedido.html`.

### 6. Primeiros passos na app
1. Entra com o email do Master.
2. **Stock → + Novo artigo** para cada artigo (nome, local, unidade, mínimo, quantidade inicial).
3. **Equipa → Adicionar pessoa** para cada operador (email Google + cargo).
4. **Equipa → QR da página de pedidos → Descarregar QR**, imprime e afixa na cozinha.

---

## Uso no dia a dia
- **Entrada/Baixa**: Movimentos → escolher artigo, quantidade, motivo (nas baixas) → Registar.
- **Fatura com a Skill (grátis, sem API)**: Faturas → **Copiar artigos** → no Claude, envia a foto/PDF da fatura + cola a lista de artigos (a Skill `ler-fatura-igreja` devolve um bloco JSON) → copia o bloco → Faturas → **Colar lista** → rever cada linha (Aceitar / Descartar) → Confirmar. A Skill está em `skills/ler-fatura-igreja/SKILL.md`.
- **Fatura com a API (opcional)**: Faturas → Fotografar ou carregar → rever → Confirmar. Só funciona com `ANTHROPIC_API_KEY`. Sem nenhuma das duas, usa "+ Criar fatura à mão".
- **Compras**: lista automática dos artigos abaixo do mínimo + recomendações do Master + pedidos aprovados. Quem compra marca a checkbox (fica o email e a hora).
- **Pedidos anónimos**: chegam a Compras → "Pedidos por aprovar".
- **Histórico**: Movimentos → Ver histórico. O Master filtra por pessoa e exporta para Excel.

## Agenda de eventos (novo)
- **Agenda** (para todos verem, só o Master cria): marca eventos com data, hora, local e notas, e junta os **artigos e quantidades** de que cada evento precisa.
- Cada evento mostra o que **falta** (necessário − stock atual). O que falta entra sozinho na lista de **Compras** ("Para um evento") e sai quando o stock for reposto.
- **Aviso por email**: 1, 3 ou 7 dias antes, para toda a equipa ou só Masters. O email lista os artigos, o stock e o que falta. Na véspera, se ainda faltar algo, segue um segundo aviso. O botão **Enviar aviso agora** envia na hora.
- **Registar consumo do evento**: depois do evento, o Master indica o que foi realmente usado e fica registado como baixa em nome dele (uma só vez por evento).
- As **Faturas** estão escondidas por agora (`FATURAS_ATIVAS = false` no `frontend/app.js`); o código mantém-se.

### Ativar os emails (uma vez)
1. Cola o novo `backend/Code.gs` e o `backend/appsscript.json` no Apps Script (o manifesto ganhou as permissões de email e de agendamento).
2. Escolhe a função **`instalarAvisos`** e carrega em **Executar**. Aceita as permissões. Isto agenda o envio diário (por volta das 8h).
3. **Implementar → Gerir implementações → ✏️ → Versão: Nova versão** (o URL não muda).
4. (Opcional) Propriedade do script `APP_URL` com o endereço da app, para o email ter o link.

> O Gmail grátis permite cerca de 100 emails por dia a partir de scripts, mais do que suficiente para esta equipa.

## Proteções da página pública
- Só cria pedidos; não mostra stock nem histórico (apenas os nomes dos artigos para sugestão).
- Campo escondido anti-robôs e limite de 40 pedidos por 10 minutos.
- Texto vindo de fora é limpo e nunca é interpretado como fórmula na folha.

## Problemas comuns
| Sintoma | Causa provável |
|---|---|
| Botão do Google não aparece | Origem do GitHub Pages não está nas *Origens JavaScript autorizadas* |
| "Sessão inválida" | `GOOGLE_CLIENT_ID` diferente no `config.js` e nas Propriedades do script |
| "Este email não tem acesso" | Falta adicionar o email em Equipa (ou no `MASTER_EMAIL`) |
| QR/links deixaram de funcionar | Foi criada uma *Nova implementação* em vez de *Nova versão* |
| Leitura de faturas desligada | Falta `ANTHROPIC_API_KEY` |

## Estrutura
```
backend/Code.gs          servidor (Apps Script)
backend/appsscript.json  manifesto (permissões e acesso)
frontend/index.html      app da equipa
frontend/pedido.html     página pública de pedidos
frontend/app.js          lógica da app da equipa
frontend/pedido.js       lógica da página de pedidos
frontend/api.js          ligação ao servidor
frontend/config.js       URL do servidor e ID de cliente (preencher)
frontend/style.css       estilo com as cores da marca
frontend/vendor/qrcode.js gerador de QR (MIT, Kazuhiko Arase)
```
