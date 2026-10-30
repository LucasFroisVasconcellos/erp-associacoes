# ADR 0008 — Site no Cloudflare Pages, com cabeçalhos de segurança

**Situação:** aceita · **Data:** 2026-10-21 · **Substitui em parte:** ADR 0001 (só a hospedagem do site)

## Contexto
O plano gratuito do GitHub não publica no Pages a partir de repositório **privado** e não protege branches em repositório privado (documentação "About GitHub's plans"). A regra do projeto é repositório privado. O GitHub Pages também não permite cabeçalhos HTTP, o que deixava três riscos aceitos: clickjacking só por JS, HSTS fora do nosso controle e CSP só por `<meta>`.

## Decisão
- Código no GitHub, repositório **privado**, plano gratuito.
- Site no **Cloudflare Pages** (gratuito), ligado ao repositório, publicando a branch **`producao`**. Ela só avança pelo workflow `liberar-producao.yml`, depois que o CI da `main` passa (só fast-forward, sem token do Cloudflare no GitHub).
- A build gera o arquivo `_headers` (`scripts/cabecalhos.mjs`) com CSP (inclusive `frame-ancestors 'none'`), HSTS de 2 anos, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` (só a câmera, para o leitor de QR), COOP e CORP. A mesma CSP continua em `<meta>` como segunda camada.
- O verificador da build reprova se faltar qualquer um desses cabeçalhos ou se ficarem fracos (`tests/unit/verificar-build.test.ts`).
- O comando de build do Cloudflare roda os testes de unidade e o verificador. Os testes do banco continuam no CI do GitHub.

## Alternativas
- **GitHub Pro (~US$ 4/mês):** manteria o Pages e a proteção da `main`, mas continuaria sem cabeçalhos HTTP.
- **Repositório público:** grátis, mas contraria a regra do projeto.
- **Deploy pelo GitHub Actions com token do Cloudflare (wrangler):** também publicaria só com o CI verde, mas exige um segredo a mais no GitHub e um pacote grande a mais. Preferimos avançar uma branch.

## Consequências
- Saem dos riscos aceitos: clickjacking só por JS e HSTS e cabeçalhos fora do nosso controle.
- Entra um risco aceito: a `main` não fica protegida (plano gratuito). A compensação: o site só muda com o CI verde (branch `producao`), e há um único desenvolvedor.
- O Cloudflare passa a ser operador (vê IP e endereço acessado nos logs de borda), e isso foi registrado em `docs/lgpd.md`.
- O frame-busting em JS (`src/main.tsx`) continua como terceira camada.
