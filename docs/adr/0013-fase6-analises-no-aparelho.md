# ADR 0013 — Fase 6: uma leitura agregada no servidor, cálculos no aparelho

**Situação:** aceita · **Data:** 2026-10-27

## Contexto
O Dossiê (cap. 8) pede previsão de caixa, simulador "e se", concentração das receitas, gastos fora do padrão, duplicidades, Benford, custos, inadimplência, carga por diretor e relatórios automáticos. São muitos cálculos sobre poucos dados (uma associação: centenas a poucos milhares de lançamentos por ano).

## Decisão
- **Uma RPC só (`dados_analise`, migration 0024)**, só leitura, para quem vê o financeiro inteiro (`alcance = tudo`), com limite de uso. Devolve dados **agregados**: mensalidades só como números (sem nomes), descrições cortadas em 80 caracteres, nada de quem lançou, nada de saúde. Tarefas por diretor só para quem tem `tarefas/ver`.
- **Cálculos em funções puras** (`src/lib/analises.ts`), em centavos inteiros, testadas com exemplos e propriedades (fast-check). Cenários "e se" existem só na tela: nada é gravado.
- Métodos robustos e simples: z robusto (mediana e MAD, limiar 3,5, mínimo 6 casos), HHI para concentração (alto ≥ 0,25), MAD de Nigrini para Benford (só com 300+ valores), peso por situação da verba na previsão e taxa de pagamento das mensalidades dos últimos 12 meses.
- **Gráficos com recharts direto** (sem o `ChartContainer` do shadcn, que injeta `<style>` por HTML e é bloqueado pelo Trusted Types). Cores validadas para daltonismo em claro e escuro (`--serie-entrada` × `--serie-saida`). Relatório mensal em PDF com jsPDF (já usado).

## Consequências
- Alertas são **sinais para conferência, nunca acusações**; o texto da tela diz isso.
- O modelo de "quem tende a atrasar" (8.6) ficou de fora de propósito: com poucos dados ele seria pouco confiável e poderia expor pessoas. Fica a taxa e as faixas de atraso, sem nomes.
- Se um dia o volume crescer muito (dezenas de milhares de lançamentos), mover agregações para SQL.
