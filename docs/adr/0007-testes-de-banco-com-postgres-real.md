# ADR 0007 — Testes do banco com Postgres real, fuzzing e mutação

**Situação:** aceita · **Data:** 2026-10-20

## Contexto
Toda a segurança está no banco (ADR 0002). Mock de banco não prova nada sobre RLS.

## Decisão
Os testes usam um Postgres 16 real, **fora da pasta do projeto**, com um stub mínimo do Supabase (`auth.uid()`, `auth.jwt()`, papéis e storage). Cada arquivo de teste recebe um banco descartável, copiado de um modelo com todas as migrations. Além dos testes de comportamento:
- **fuzzing** (fast-check) das RPCs com entradas aleatórias e claims adulteradas;
- **teste de mutação**: cada controle de segurança é desligado e o teste precisa perceber;
- **lista fechada de privilégios**.

## Consequências
- No CI, o Postgres roda como serviço do job (sem dados reais).
- Comportamentos específicos do Supabase real (e-mails, pg_cron, limites do Auth) ficam para o smoke test de `docs/deploy.md`.
