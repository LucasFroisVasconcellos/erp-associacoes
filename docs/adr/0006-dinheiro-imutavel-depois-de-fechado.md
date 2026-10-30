# ADR 0006 — Estorno em vez de exclusão; mês fechado imutável

**Situação:** aceita · **Data:** 2026-10-20

## Contexto
A prestação de contas e o contador precisam de números que não mudam depois de entregues. Apagar um lançamento esconde erro e fraude.

## Decisão
Lançamentos realizados não são apagados: são **estornados** por um lançamento inverso ligado ao original (`estorno_de`). Depois do fechamento mensal (com checklist e confirmação), um gatilho recusa qualquer mudança naquele mês, independente do papel de quem tenta (migration 0008). A auditoria é imutável (gatilhos recusam UPDATE, DELETE e TRUNCATE).

## Consequências
- Correção de um mês fechado = estorno e novo lançamento no mês aberto.
- O papel `postgres` (SQL Editor) ainda pode desligar gatilhos: por isso a recomendação de backup externo da auditoria.
