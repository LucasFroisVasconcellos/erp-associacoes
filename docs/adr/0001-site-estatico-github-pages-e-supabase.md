# ADR 0001 — Site estático no GitHub Pages + Supabase

**Situação:** substituída em parte pelo [ADR 0008](0008-cloudflare-pages.md) (hospedagem do site) · **Data:** 2026-10-20

## Contexto
A Associação Exemplo é uma associação pequena, sem equipe de TI e com orçamento perto de zero. O Dossiê pede hospedagem no GitHub Pages. O sistema precisa de login, banco relacional, arquivos e regras de acesso fortes.

## Decisão
Frontend estático (Vite + React) no GitHub Pages, com `HashRouter`, porque o Pages não reescreve rotas. Backend inteiro no Supabase: Postgres, Auth, Storage e Edge Functions, na região São Paulo.

## Alternativas
- **Servidor próprio (Node/BFF):** permitiria cookies HttpOnly e cabeçalhos de segurança, mas tem custo e manutenção que a Associação Exemplo não consegue sustentar hoje.
- **Firebase:** sem SQL relacional nem RLS em SQL; os relatórios contábeis ficariam mais difíceis.
- **Cloudflare Pages:** permite cabeçalhos HTTP. É o caminho natural se o clickjacking ou a CSP sem `unsafe-inline` virarem prioridade.

## Consequências
- Sem cabeçalhos HTTP próprios: a CSP vai por `<meta>`, o clickjacking é tratado com JS e a sessão fica em `sessionStorage` (riscos aceitos em `docs/seguranca.md` § 7).
- O site não tem segredo nenhum; a chave publicável é a única no bundle, e a build recusa qualquer outra.
