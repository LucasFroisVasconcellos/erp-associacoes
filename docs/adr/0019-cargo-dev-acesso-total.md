# ADR 0019 — Cargo "dev" com acesso total

**Situação:** aceita · **Data:** 2026-10-28 · **Decisão:** diretoria

## Contexto
Quem mantém o sistema precisa ver e testar todas as telas, inclusive Saúde. Até aqui nenhum cargo recebia Saúde automaticamente (minimização, LGPD).

## Decisão
- Migration **0033**: cargo `dev`, administrador (cuida de Acessos), cujo modelo padrão dá **todas as ações em todos os módulos, inclusive Saúde**.
- Um modelo cadastrado em Acessos para o cargo `dev` substitui o padrão (a diretoria pode reduzir depois sem migration).
- Nada muda no login: o `dev` também precisa da senha + código (aal2) e da sessão de no máximo 30 dias; tudo fica na auditoria.
- A troca do cargo do desenvolvedor é **dado**, feita à parte no SQL Editor (docs/deploy.md, 7m).

## Riscos aceitos (ACCEPTED_RISK)
- Uma conta com acesso a dados de saúde de todos os atletas. Mitigação: 2FA obrigatório, auditoria de leitura sensível, e a regra de usar o cargo só para quem realmente mantém o sistema.
- LGPD: o acesso a dados de saúde precisa de finalidade; a do `dev` é manutenção e suporte do sistema. Registrar na política de privacidade se mais alguém receber esse cargo.
