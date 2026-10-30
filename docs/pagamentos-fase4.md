# Pagamentos (mensalidades e doações) — plano para a Fase 4

> **Status (22/10/2026):** a Fase 4 usa a **primeira opção** da tabela abaixo: Pix com QR estático gerado no próprio aparelho (`src/lib/pix.ts`), identificador aleatório por mensalidade e baixa manual pela tesouraria ligada à entrada do Dinheiro. Nenhum provedor está integrado. As regras do Stripe abaixo continuam valendo se um dia a Associação Exemplo quiser baixa automática (e para as doações da Fase 5).

## Opções para receber por Pix

| Opção | Prós | Contras |
|---|---|---|
| **Pix com QR estático do banco da Associação Exemplo**, conciliado à mão no módulo Dinheiro | Custo zero; já funciona hoje | Sem baixa automática; conferência manual |
| **API Pix do próprio banco** (cobrança com QR dinâmico + webhook do banco) | Taxa baixa; dinheiro direto na conta | Cada banco tem sua API e exige certificado mTLS |
| **Stripe** (Checkout com Pix e cartão; Billing para recorrência) | Webhooks padronizados, recorrência, recibos, sandbox para testar | Taxa por transação; conferir disponibilidade de Pix e as regras para entidades sem fins lucrativos na conta brasileira |

Decisão: **adiada para a Fase 4**, comparando a taxa do banco da Associação Exemplo com a do Stripe para o volume real de mensalidades.

## Regras se a escolha for Stripe
1. **Checkout Sessions** para pagamentos e **Billing** para mensalidade recorrente. Nunca a API de Charges, nem o Card Element.
2. **Não passar `payment_method_types`**: os meios (Pix, cartão, boleto) ficam configurados no Dashboard (pagamentos dinâmicos).
3. **Chave restrita (`rk_…`)**, só na Edge Function, com as permissões mínimas. Nunca no site, nunca no Git.
4. **Webhooks são obrigatórios.** A baixa da mensalidade acontece no webhook, nunca na página de "obrigado":
   - `checkout.session.completed` e `checkout.session.async_payment_succeeded`: dar baixa só se `payment_status` não for `unpaid` (Pix e boleto confirmam depois);
   - `checkout.session.async_payment_failed`: marcar como não paga;
   - verificar a **assinatura** com o corpo bruto da requisição e recusar eventos antigos (replay);
   - **idempotência**: gravar o `event.id` numa tabela com chave única; o mesmo evento duas vezes não dá baixa duas vezes.
5. **O valor vem do servidor**: a Edge Function lê a mensalidade do banco e cria a sessão. O navegador nunca envia o preço.
6. A baixa cria um **lançamento de entrada** pelo mesmo caminho do módulo Dinheiro (RPC, auditoria, trava de mês fechado). O webhook chama uma função `private.*` que só a service role executa.
7. Testes em **sandbox** separada (uma para desenvolvimento e outra para o CI), cobrindo: evento repetido, assinatura inválida, evento fora de ordem, Pix que expira e valor adulterado.
8. Antes de ligar: *Go Live Checklist* do Stripe e revisão de LGPD (os dados do pagador são dados pessoais financeiros; o Stripe vira operador e há transferência internacional).
9. Não ligar `automatic_tax`: uma associação sem fins lucrativos, recebendo mensalidade no Brasil, não usa o Stripe Tax. Confirmar com o contador.
