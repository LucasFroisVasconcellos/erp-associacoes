# ADR 0003 — 2FA obrigatório para todos

**Situação:** aceita · **Data:** 2026-10-20

## Contexto
O sistema mexe com o dinheiro da associação. Senha vazada ou phishing é a ameaça mais provável (`docs/seguranca.md`, A1).

## Decisão
TOTP (app autenticador) obrigatório para todo membro, sem exceção. O banco exige `aal2` em toda leitura (política RESTRICTIVE) e em toda RPC. Tudo do módulo Acessos (convidar, mudar cargo e permissões, desativar) exige TOTP **recente** (`private.totp_recente`). A recuperação de senha pede o 2FA antes de aceitar a senha nova. Trocar a senha encerra as outras sessões.

## Alternativas
- **2FA só para administradores:** um tesoureiro com senha vazada já causaria dano.
- **SMS:** vulnerável a troca de chip; o Guia Mestre pede app ou passkey.

## Consequências
Quem perder o celular precisa de um administrador para refazer o acesso. Isso deve ser documentado no manual de uso.
