# ADR 0015 — Ajuda ⓘ por tela, tutorial de boas-vindas, busca única e começo limpo

**Situação:** aceita · **Data:** 2026-10-27

## Contexto
O Dossiê (cap. 9) pede tutorial no primeiro acesso, busca única e "um botão para cada ação comum". A diretoria pediu uma ajuda elegante (a "bolinha com ?") e lembrou que os dados fictícios somem no lançamento.

## Decisão
- **Ajuda ⓘ** ao lado do título de toda página (`Pagina`), com conteúdo central em `src/lib/ajuda.ts` achado pela rota: para que serve, 2–3 passos numerados e uma dica. Nenhuma tela precisou mudar para ganhar ajuda.
- **Tutorial** de 6 cartões no primeiro acesso, com pular e rever em Ajustes. "Já visto" fica no navegador da pessoa (conveniência local, sem dado pessoal); navegadores automatizados não recebem o tour (o teste do tour desliga essa marca).
- **Busca única** (`busca_global`, migration 0027) em SQL `security invoker`: roda com a RLS de quem busca, então ninguém acha o que não poderia ver; curingas do LIKE escapados; área de saúde fora.
- **Primeiros passos** no Início para quem administra, enquanto o sistema real estiver vazio: contas, categorias, plano de contas, diretoria, dados da Associação Exemplo e Pix, pessoas. Some sozinho quando tudo estiver feito.
- **Atalhos** no Início: Saiu dinheiro, Entrou dinheiro, Nova tarefa, Novo evento.

## Consequências
- Textos de ajuda ficam num arquivo só: revisar com a diretoria antes do lançamento.
- A busca não tem limite de uso por pessoa (é leitura sob RLS, com no máximo 48 resultados); se ficar lenta com muitos dados, adicionar índices trigram.
