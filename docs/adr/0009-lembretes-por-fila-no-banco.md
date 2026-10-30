# ADR 0009 — Lembretes e resumo semanal por fila no banco

**Situação:** aceita · **Data:** 2026-10-22

## Contexto
A Fase 2 manda e-mails de lembrete de tarefa e um resumo semanal. Riscos: e-mail duplicado (rotina rodando duas vezes ou duas instâncias ao mesmo tempo), e-mail para quem saiu da diretoria, endereço ou dado pessoal parando em log, e uma chave de servidor exposta.

## Decisão
- **O banco decide o quê e para quem.** `private.preparar_emails()` (rotina diária) coloca na fila `private.fila_emails`, com chave única por lembrete (`lembrete:<tarefa>:<prazo>:<antes|dia>`) e por resumo (`resumo:<membro>:<segunda>`): rodar de novo não duplica.
- **A Edge Function só envia.** `enviar-emails` pega um lote com `FOR UPDATE SKIP LOCKED` (duas execuções nunca pegam o mesmo e-mail), envia em **texto puro** e marca o resultado. Ela é chamada só pela rotina agendada, com uma **chave secreta nomeada** (`emails`), que pode ser trocada sem mexer nas outras.
- A fila guarda o **id do membro**, não o e-mail: o endereço é lido do cadastro na hora do envio, só se a pessoa ainda estiver ativa.
- Conteúdo mínimo: título, data e o link do sistema. Nada de valores nem dados de outras pessoas.
- Erros gravados só como **código** (`EAUTH`, `EENVELOPE`…), nunca a mensagem do servidor (que pode trazer o endereço).
- SMTP na **porta 465 (SSL)**: as Edge Functions bloqueiam as portas 25 e 587.
- Cada pessoa pode desligar lembretes e resumo em Ajustes.

## Alternativas
- **Enviar direto do pg_cron:** o Postgres do Supabase não fala SMTP.
- **Serviço de e-mail transacional (Resend, Brevo):** exige domínio próprio verificado, que a Associação Exemplo ainda não tem. Com domínio, troca-se só a função `enviar`.

## Consequências
- Testado: idempotência, concorrência real (3 execuções simultâneas), preferências, membro desativado, injeção de cabeçalho no assunto, limpeza em 30 dias (`tests/db/emails.test.ts`, `supabase/functions/_shared/emails.test.ts`).
- O runtime Deno e o envio SMTP real não são testados aqui: ficam no smoke test do lançamento.
