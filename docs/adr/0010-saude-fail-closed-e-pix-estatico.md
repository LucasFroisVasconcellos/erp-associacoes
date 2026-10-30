# ADR 0010 — Saúde fechada por padrão e mensalidade por Pix estático

**Situação:** aceita · **Data:** 2026-10-22

## Contexto
A Fase 4 traz dados de atletas: deficiência, classificação funcional e laudos (dado sensível, art. 11 da LGPD), muitas vezes de menores de idade (art. 14). Também traz a cobrança de mensalidades. Riscos: um diretor qualquer lendo laudos, dado de saúde gravado sem base legal ou guardado depois de revogada a autorização, e uma integração de pagamento que coloque credencial bancária no sistema.

## Decisão
- **Saúde é um módulo próprio (`saude`) fora de todos os perfis padrão**, inclusive o do presidente. O administrador libera só para quem cuida.
- **Fail closed:** sem autorização ativa registrada (consentimento ou exigência esportiva), o banco recusa gravar saúde. Menor: só o responsável autoriza.
- **Revogar apaga** (quando a base é o consentimento): dados e arquivos de saúde, com os arquivos numa fila (`private.arquivos_remover`) que a função `limpar-arquivos` esvazia, autenticada por uma chave secreta nomeada (`limpeza`).
- Saúde não sai da área própria: nem agenda, avisos, e-mails, Início ou prestação de contas; a auditoria guarda só o nome dos campos alterados. A própria autorização de saúde é invisível para quem não tem o módulo.
- **Mensalidade por Pix estático (BR Code) gerado no aparelho**, com identificador aleatório por cobrança. A tesouraria dá baixa ligando a entrada real do Dinheiro (uma entrada paga uma mensalidade só).

## Alternativas
- **Saúde dentro do cadastro, protegida só pela tela:** a tela não é controle de acesso (ADR 0002).
- **Criptografia por coluna (pgsodium/Vault):** a chave ficaria no mesmo banco; o ganho real sobre a criptografia em disco do Supabase é pequeno para este porte. Reavaliar no RIPD ⚖️.
- **API Pix do banco ou Stripe com baixa automática:** exige certificado mTLS ou chave restrita e webhooks; fica para quando o volume justificar (`docs/pagamentos-fase4.md`).

## Consequências
- Testado: módulo, fail closed, revogação que apaga, invisibilidade da autorização, menor, auditoria sem conteúdo, mutação dos controles (`tests/db/pessoas-saude.test.ts`, `fase4-fuzz.test.ts`); BR Code conferido com o exemplo do manual do Banco Central e QR lido de volta (`src/lib/pix.test.ts`, `qr.test.ts`).
- A baixa da mensalidade é manual (risco aceito em `seguranca.md`).
- Pagamento real e a remoção real no Storage ficam no smoke test do lançamento (`deploy.md` §7d).
