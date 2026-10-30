# ADR 0016 — Pedido de acesso público, foto 3x4 e ficha do atleta, projeto próprio

**Situação:** aceita · **Data:** 2026-10-28

## Contexto
A diretoria pediu: (1) um jeito de quem é da Associação Exemplo pedir acesso sem esperar alguém lembrar de convidar; (2) foto 3x4 opcional e mais informações de cada atleta; (3) criar projeto sem passar por uma verba; (4) marcar permissões em lote.

## Decisão
- **Pedir acesso** é um formulário público com CAPTCHA (Turnstile), só com nome e e-mail. O token é validado **no servidor** pela Edge Function `pedir-acesso` (sucesso, hostname de `APP_ORIGIN` e action `pedir_acesso`); provedor fora do ar = nega. Só a service role grava (`registrar_pedido_acesso`), com limite de 3 por hora por IP (guardado como HMAC, chave derivada do segredo do Turnstile) e no máximo 50 pendentes. A resposta é sempre igual (não revela se o e-mail existe) e **nenhum e-mail sai daqui** (não vira relé de spam). Liberar = fazer o convite normal (cargo e permissões escolhidos pelo administrador, 2FA recente) e só então marcar o pedido como aprovado (`decidir_pedido_acesso` confere que o convite existe). Sem chave do CAPTCHA configurada, o formulário fica fechado.
- **Foto 3x4** usa o envio de arquivos existente (área `foto_pessoa`, bucket privado `pessoas`), só com **autorização de imagem ativa** conferida ao autorizar e ao registrar; só imagem (PDF recusado); recorte 3:4 e regravação no aparelho (some o EXIF/GPS). Sai sozinha ao revogar a autorização ou ao desligar a pessoa (gatilhos + fila de remoção). Leitura por link assinado de 60 s só para quem vê Pessoas e só da foto atual.
- **Ficha do atleta** com lista fixa de campos (apelido, camisa, posição, uniforme, registro na federação, desde quando, contato de emergência). **Nada de saúde**: classe funcional e deficiência continuam na área de saúde (fechada por padrão).
- **Projeto próprio** (`criar_projeto`): mesmas validações do projeto vindo de verba, regras padrão.
- **Permissões em lote** só na tela: "Todas" por módulo e perfis prontos; **saúde nunca é marcada em lote**. Quem decide continua sendo o banco ao salvar.

## Alternativas descartadas
- Cadastro aberto com conta criada na hora: qualquer um ganharia login antes de alguém conferir. Rejeitado (fail closed).
- Avisar por e-mail quem pediu: abriria um envio de e-mail a endereço qualquer por formulário público.
- Ficha em JSON livre: aceitaria qualquer coisa, inclusive dado de saúde.

## Consequências
- No lançamento: secret `TURNSTILE_SECRET_KEY` na função, deploy com `--no-verify-jwt` e o hostname do sistema cadastrado no widget do Turnstile.
- O primeiro administrador continua sendo criado no lançamento (SQL Editor, `bootstrap_admin`); sem ele ninguém consegue liberar pedidos.
