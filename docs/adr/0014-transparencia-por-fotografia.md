# ADR 0014 — Transparência por fotografia publicada

**Situação:** aceita · **Data:** 2026-10-27

## Contexto
A Fase 7 (Dossiê 7.12) abre a primeira parte do sistema ao público, sem login. Até aqui nenhuma função ou tabela era acessível ao papel `anon`.

## Decisão
- **Fotografia congelada:** ao publicar, o servidor monta um JSON só com agregados (totais por mês e por categoria/conta do contador, verbas de órgão público e parlamentar, projetos com valor aprovado, filiações e nome/CNPJ da entidade) e guarda em `transparencia_publicacoes`. Lançamentos posteriores não mudam o que está no ar.
- **Uma única função pública** (`transparencia_publica()`, sem parâmetros, no máximo 24 publicações). O `anon` ganhou `usage` no schema `private` só para ela; os privilégios padrão do schema já revogam execução de funções novas, e os testes (`advisors`, `privilegios`) exigem que essa seja a única.
- **Publicar** exige `financeiro/aprovar` **e 2FA recente** (ato da diretoria). **Retirar** exige motivo e não apaga (auditoria).
- **Nunca vai ao ar:** descrição de lançamento, nome de pessoa física (doadores, atletas, associados), mensalidades individuais, dados de saúde, quem publicou.
- A página pública usa o mesmo componente da prévia: o que a diretoria vê é exatamente o que o público verá.

## Consequências
- O cabeçalho `X-Robots-Tag: noindex` continua valendo para o site todo, inclusive a página pública: ela é para ser acessada pelo link (assembleia, patrocinadores, órgãos). Se a diretoria quiser aparecer no Google, mudar só para a rota pública (decisão registrada no deploy).
- Rate limit por pessoa não se aplica ao público (sem login); a proteção contra abuso fica na borda (Cloudflare) e no tamanho fixo da resposta.
- O nome de uma categoria vai ao ar: categorias precisam ter nomes genéricos (já é regra da LGPD do sistema).
