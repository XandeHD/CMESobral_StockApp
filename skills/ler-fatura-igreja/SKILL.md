---
name: ler-fatura-igreja
description: Lê uma fatura de compras da igreja (foto ou PDF) e devolve a lista de linhas em JSON para colar na app de Stock da Catedral da Esperança. Usar quando o utilizador envia uma fatura/talão para o stock da igreja.
---

# Ler fatura para a app de Stock da igreja

O objetivo é transformar uma fatura ou talão (foto ou PDF) num bloco JSON que o Master cola na app (Faturas → "Colar lista"). A app depois mostra cada linha para **Aceitar** ou **Descartar**, por isso não é preciso decidir nada aqui: só ler com cuidado.

## Passos

1. Lê a fatura toda (todas as páginas). Se a imagem estiver ilegível ou cortada, diz o que falta e pede outra foto em vez de adivinhar.
2. Se o utilizador colou a lista de artigos do stock (começa por "Artigos do stock da igreja:"), usa-a para preencher o campo `artigo` de cada linha **só quando for claramente o mesmo produto**. Escreve o nome exatamente como está na lista (sem a unidade entre parênteses). Se não tiveres a certeza, deixa `artigo` vazio: o Master escolhe na app.
3. Para cada linha de produto:
   - `descricao`: o texto da fatura, legível (podes expandir abreviaturas óbvias, ex.: "PLAST" → "plástico").
   - `quantidade`: em **unidades de consumo**, não em embalagens de venda quando a fatura o deixa claro. Ex.: 4 packs de 6 garrafas → 24; 2 caixas de 100 copos → 200. Se não der para saber o conteúdo da embalagem, usa a quantidade faturada e indica a unidade da embalagem (`pac`, `cx`).
   - `unidade`: `un`, `kg`, `L`, `pac`, `cx` ou `rolos`.
4. Ignora: portes, taxas, sacos de compras, descontos, IVA, totais, vales e linhas de pagamento.
5. Cabeçalho: `fornecedor` (nome da loja), `numero` (nº da fatura/talão), `data` em `AAAA-MM-DD`. Se algum não existir, usa string vazia.

## Formato da resposta (obrigatório)

Responde com UM bloco de código `json`, exatamente com esta forma, e nada dentro do bloco além do JSON:

```json
{
  "fornecedor": "Continente",
  "numero": "FS 0123/45678",
  "data": "2026-11-04",
  "linhas": [
    { "descricao": "Copos plástico 200 ml", "quantidade": 200, "unidade": "un", "artigo": "Copos descartáveis" },
    { "descricao": "Café em grão 1 kg", "quantidade": 3, "unidade": "kg", "artigo": "" }
  ]
}
```

Regras do bloco:
- Números com ponto decimal (`1.5`), nunca vírgula, e sem aspas.
- Sem comentários nem vírgulas a mais.
- Uma linha por produto; se o mesmo produto aparece duas vezes, soma as quantidades.

Depois do bloco, escreve no máximo 3 linhas curtas fora dele **só se houver dúvidas** (ex.: "Linha 3 pouco legível, confirma a quantidade"). Termina com: "Copia o bloco e cola em Faturas → Colar lista."
