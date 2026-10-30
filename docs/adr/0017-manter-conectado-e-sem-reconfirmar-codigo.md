# ADR 0017 — Manter conectado por 30 dias e código só no login

**Situação:** aceita · **Data:** 2026-10-28 · **Decisão:** diretoria

## Contexto
O sistema é usado na correria (ex.: numa viagem, tirar a foto de um comprovante). Entrar com senha e código toda vez e reconfirmar o código em ações sensíveis deixava o uso lento.

## Decisão
- Opção "Manter conectado neste aparelho por 30 dias" no login, **marcada por padrão** (pedido da diretoria em 28/10/2026; desmarcar em aparelho emprestado ou público). Marcada, a sessão fica no navegador do aparelho (localStorage) e não cai por inatividade. Desmarcada, continua como antes (some ao fechar a aba, cai após 30 minutos parado).
- O **banco** recusa sessão cuja última autenticação tem mais de 30 dias (`sessao_expirada`), inclusive na RLS: o prazo não depende do aparelho.
- Ações sensíveis (acessos, exportar auditoria, publicar transparência) **não pedem o código de novo**; o código continua obrigatório no login.
- "Sair" apaga a sessão guardada; "Sair de todos os aparelhos" revoga as sessões no servidor.

## Riscos aceitos (ACCEPTED_RISK)
- Exceção consciente à regra do Guia "token de sessão fora do localStorage": um script malicioso que rodasse no site poderia ler a sessão. Mitigação: CSP rígida + Trusted Types, nenhum HTML vindo de usuário, dependências em quarentena, prazo de 30 dias no servidor, saída global.
- Celular perdido destravado dá acesso até alguém usar "Sair de todos os aparelhos".
- O site não ser divulgado **não** é proteção (os endereços do Supabase e do Cloudflare são descobertos por varredura); por isso a segunda etapa no login foi mantida.

## Alternativa avaliada
- Tirar a segunda etapa do projeto final: não adotada nesta entrega. Com o "manter conectado", o código só é pedido uma vez a cada 30 dias por aparelho, o que já resolve o uso rápido.
