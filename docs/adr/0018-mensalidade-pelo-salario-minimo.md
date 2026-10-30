# ADR 0018 — Mensalidade pelo salário mínimo (ata e estatuto)

**Situação:** aceita · **Data:** 2026-10-28 · **Decisão:** diretoria, com base no estatuto da associação

## Contexto
A ata da associação define a mensalidade em **1% do salário mínimo vigente**; quem paga em **parcela única até fevereiro** paga **10%** do salário mínimo (desconto de duas mensalidades). O estatuto exige **pelo menos 45 dias** entre a criação ou o aumento da mensalidade e a primeira cobrança. Antes, a categoria de sócio só tinha valor fixo, e todo reajuste do mínimo exigia editar o valor à mão.

## Decisão
- Migration **0032**: tabela `salarios_minimos` (valor por data de vigência, com histórico) e coluna `percentual_salario_minimo` na categoria de sócio. A categoria cobra **um valor fixo ou uma porcentagem**, nunca os dois.
- O **servidor** calcula o valor ao gerar (`round(mínimo × % / 100, 2)`). Vale o mínimo vigente **45 dias antes do vencimento**: com o reajuste em 1º de janeiro e vencimento no dia 10, a cobrança de fevereiro ainda usa o mínimo anterior e a de março, o novo.
- Sem salário mínimo cadastrado para a data, **nada** é gerado (fail closed, tudo ou nada).
- Mensalidade já gerada guarda o valor; reajuste do mínimo não muda o passado.
- Vêm cadastrados os valores oficiais de 2025 (R$ 1.518) e 2026 (R$ 1.621). O reajuste seguinte é cadastrado em Pessoas › Mensalidades › Configurar a mensalidade › Salário mínimo.

## Fora desta entrega
- ~~Parcela única anual~~ — feita na **0035**: tabela `parcelas_unicas`, `receber_parcela_unica` (dez–fev, nenhuma mensalidade do ano paga, valor pelo mínimo do fim de fevereiro, dispensa as mensalidades do ano e o gerador pula a pessoa).
- Aumento do **percentual** de uma categoria: a tela avisa que vale para as mensalidades geradas daqui para a frente; a regra dos 45 dias é responsabilidade de quem gera (o estatuto exige aprovação em Assembleia).

## Outras leituras do estatuto aplicadas
- **Modalidade sem federação estadual**: o campo "Registro na federação" da ficha passou a aceitar a inscrição na confederação nacional (se houver) — mesma coluna `registro_federacao`, sem migration.
- O estatuto e a ata trazem CPF, RG e endereço dos fundadores: **nada disso entra no sistema nem no repositório** (LGPD, minimização).

## Atualização automática (0036)
O salário mínimo passa a vir sozinho da série oficial do Banco Central (SGS 1619), buscada todo dia pelo pg_net/pg_cron. O banco confere formato, faixa, que não diminui e que não sobe mais de 25%, e nunca sobrescreve um valor cadastrado à mão; o cadastro manual fica como reserva.
