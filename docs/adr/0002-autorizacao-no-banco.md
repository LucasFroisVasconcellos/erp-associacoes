# ADR 0002 — Toda autorização no banco (RLS + RPCs)

**Situação:** aceita · **Data:** 2026-10-20

## Contexto
O Guia Mestre de Segurança: "o cliente solicita, o servidor decide". Sem servidor próprio (ADR 0001), o único lugar confiável é o Postgres.

## Decisão
- RLS em todas as tabelas de `public`, com uma política RESTRICTIVE extra exigindo `aal2`.
- Nenhuma escrita direta: o cliente só chama RPCs `SECURITY INVOKER` em `public`, que delegam a funções `SECURITY DEFINER` em `private` com `search_path = ''`. Cada uma valida o JSON campo a campo (recusa campos extras), a sessão, o 2FA, a permissão (`private.pode`) e o limite de uso.
- O dono de cada registro vem sempre de `auth.uid()`.
- Grants explícitos, porque a partir de 30/10/2026 tabelas novas não ficam expostas sozinhas na Data API. Lista fechada travada por teste (`tests/db/privilegios.test.ts`).

## Alternativas
- **Políticas de RLS com escrita direta (INSERT/UPDATE):** validações complexas (mês fechado, estorno, mínimo de administradores) ficariam espalhadas e difíceis de testar.
- **Lógica nas Edge Functions:** mais código com service role, que ignora a RLS. Erro ali vira acesso total.

## Consequências
- Os testes do banco são a principal evidência de segurança (ADR 0007).
- Botões escondidos e guardas de rota na tela são só experiência, não controle.
