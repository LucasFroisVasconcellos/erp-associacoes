# ADR 0005 — Uploads só por Edge Function, autorizados como o usuário

**Situação:** aceita · **Data:** 2026-10-20

## Contexto
Comprovantes e arquivos do contador precisam de checagem de tipo real, tamanho e permissão. O upload direto do navegador para o Storage confia no MIME informado pelo cliente.

## Decisão
O navegador envia o arquivo para a Edge Function `enviar-arquivo`. Ela exige `content-length`, limita a 10 MB, confere o tipo pelos bytes e pede autorização ao banco **com a sessão do usuário** (`autorizar_*`, que aplica RLS, 2FA e limite). Só então grava com a service role, com nome aleatório, num bucket privado, e registra (`registrar_*`, que só a service role executa). Se o registro falhar, o arquivo é removido. A leitura é por URL assinada de 60 s.

## Consequências
- A service role existe só dentro da função; a lógica é testada em Node (`envio.test.ts`). O runtime Deno não foi testado aqui (BLOCKED_ENVIRONMENT).
- Fotos são reduzidas no aparelho (1600 px, ~0,3 MB, sem EXIF) antes do envio.
