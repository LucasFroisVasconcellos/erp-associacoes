# ADR 0020 — Cargos do estatuto: Representante dos Atletas e Conselho Fiscal

**Situação:** aceita · **Data:** 2026-10-28 · **Base:** estatuto da associação

## Decisão
- Migration **0038** acrescenta `representante_atletas` e `conselho_fiscal`.
- **Representante dos Atletas**: modelo padrão igual ao do diretor.
- **Conselho Fiscal**: só **ver e exportar** o que fiscaliza (Dinheiro, contador, relatórios, verbas, projetos) e **ver** patrimônio, documentos, viagens, captação, filiações, avisos e agenda. Nunca cria, edita ou aprova; não administra Acessos (não pode ocupar cargo de direção); não vê Pessoas nem Saúde (minimização, LGPD).
- O modelo de cada cargo pode ser ajustado em Acessos (o padrão de fábrica agora abre para edição).
