# Registros de decisão de arquitetura (ADRs)

Cada arquivo registra **uma** decisão: o contexto, o que foi decidido, as alternativas e as consequências. Uma decisão não é editada depois de aceita; se mudar, crie um ADR novo que substitui o antigo.

| # | Decisão | Situação |
|---|---|---|
| [0001](0001-site-estatico-github-pages-e-supabase.md) | Site estático no GitHub Pages + Supabase | Substituída em parte pela 0008 |
| [0002](0002-autorizacao-no-banco.md) | Toda autorização no banco (RLS + RPCs) | Aceita |
| [0003](0003-2fa-obrigatorio.md) | 2FA obrigatório para todos | Aceita |
| [0004](0004-react-shadcn-estilo-limpo.md) | React + shadcn/ui com estilo do HIG da Apple | Aceita (substitui a escolha de Preact da especificação original) |
| [0005](0005-uploads-por-edge-function.md) | Uploads só por Edge Function, autorizados como o usuário | Aceita |
| [0006](0006-dinheiro-imutavel-depois-de-fechado.md) | Estorno em vez de exclusão; mês fechado imutável | Aceita |
| [0007](0007-testes-de-banco-com-postgres-real.md) | Testes do banco com Postgres real, fuzzing e mutação | Aceita |
| [0008](0008-cloudflare-pages.md) | Site no Cloudflare Pages, com cabeçalhos de segurança | Aceita |
| [0009](0009-lembretes-por-fila-no-banco.md) | Lembretes e resumo semanal por fila no banco | Aceita |
| [0010](0010-saude-fail-closed-e-pix-estatico.md) | Saúde fechada por padrão e mensalidade por Pix estático | Aceita |
| [0011](0011-formulario-declarativo-e-leitura-generica.md) | Formulário declarativo e leitura genérica (menos código) | Aceita |
| [0012](0012-correcoes-e-importacoes.md) | Correções e importações da contabilidade | Aceita |
| [0013](0013-fase6-analises-no-aparelho.md) | Previsão e análises calculadas no aparelho | Aceita |
| [0014](0014-transparencia-por-fotografia.md) | Transparência por fotografia publicada | Aceita |
| [0015](0015-ajuda-tutorial-busca.md) | Ajuda ⓘ, tutorial, busca única e começo limpo | Aceita |
| [0016](0016-pedido-de-acesso-e-ficha-do-atleta.md) | Pedido de acesso público, foto 3x4 e ficha do atleta, projeto próprio | Aceita |
| [0017](0017-manter-conectado-e-sem-reconfirmar-codigo.md) | Manter conectado por 30 dias e código só no login | Aceita (risco aceito pela diretoria) |
| [0018](0018-mensalidade-pelo-salario-minimo.md) | Mensalidade em % do salário mínimo (ata e estatuto, regra dos 45 dias) | Aceita |
| [0019](0019-cargo-dev-acesso-total.md) | Cargo "dev" administrador com acesso total (inclui Saúde) | Aceita (risco aceito pela diretoria) |
| [0020](0020-cargos-do-estatuto.md) | Cargos do estatuto: Representante dos Atletas e Conselho Fiscal (só consulta) | Aceita |
