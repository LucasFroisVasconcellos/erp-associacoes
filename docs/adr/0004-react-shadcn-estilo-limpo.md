# ADR 0004 — React + shadcn/ui com estilo limpo de aplicativo

**Situação:** aceita (substitui a escolha de Preact da especificação de 2026-10-20) · **Data:** 2026-10-20

## Contexto
A primeira especificação previa Preact, pelo tamanho. A diretoria pediu uma interface com cara de aplicativo de celular: listas agrupadas, botões grandes, transições suaves e uso confortável com uma mão.

## Decisão
React 19, Tailwind v4 e shadcn/ui (base Radix), gerado por um registro local. O estilo `cn-*` é convertido por um mapa próprio (`design/estilo.css`): alvos de toque de 44 px, botões em cápsula, grupos arredondados, controle segmentado, folha que sobe de baixo no celular e título grande que encolhe ao rolar. Animações com `motion`, respeitando `prefers-reduced-motion`.

## Alternativas
- **Preact:** bundle menor, mas sem shadcn/Radix prontos e acessíveis.
- **Biblioteca de componentes "estilo celular" pronta:** pouco usada; a regra do projeto pede bibliotecas conhecidas.

## Consequências
- Bundle de ~1 MB (as telas passaram a carregar sob demanda).
- Radix, sonner e input-otp injetam `<style>`: a CSP precisa de `style-src 'unsafe-inline'` (risco aceito).
- Para regenerar os componentes: `scripts/ui-regenerar.sh`.
