# Colocar no ar — checklist

Ordem: **Supabase → Edge Functions → site → smoke test**. Marque cada item. Nada aqui é automático em produção: as migrations são aplicadas por você, conferindo cada uma.

## 0. Antes de começar
- [ ] 2FA (app autenticador ou passkey, não SMS) nas contas do **GitHub** e do **Supabase**. Guarde os códigos de recuperação fora do computador.
- [ ] `npm run verificar` passando no seu computador (seção 6 do README).
- [ ] Prazo de guarda contábil e canal do encarregado definidos ([`lgpd.md`](lgpd.md), seções 1 e 2).

> **Decisão de 21/10/2026:** o sistema só recebe dados reais da Associação Exemplo quando estiver 100% pronto. Tudo que depende de dado real (e-mail da Associação Exemplo, usuário do presidente, convites) ou que só faz sentido no uso real foi juntado na seção **7. Lançamento**, no fim deste arquivo. Até lá, o projeto Supabase fica sem nenhum usuário.

> **Situação em 21/10/2026:** projeto `erp-associacoes` criado na organização Associação Exemplo (plano Free, São Paulo); itens marcados com [x] já feitos. Endereço da API: `https://SEU-PROJETO.supabase.co`. A chave publicável fica em *Settings → API Keys* (não é segredo, mas não vai para o repositório).

## 1. Projeto Supabase
- [x] Criar o projeto na região **South America (São Paulo)**, com *Automatically expose new tables* **desmarcado** e *Enable automatic RLS* marcado. A senha do banco foi gerada pelo próprio Supabase e não ficou anotada: se um dia precisar dela (CLI, `db push`), crie uma nova em *Settings → Database → Reset database password* e guarde no gerenciador de senhas.
- [x] **Integrations → Data API → Settings:** conferido em 21/10/2026. Expostos: `public` e `graphql_public` (padrão do Supabase, sem nenhum grant nosso); `private` **não** exposto; *Automatically expose new tables* desligado; 0 tabelas e 0 funções expostas automaticamente. As migrations fazem todos os `grant` explícitos.
- [x] Aplicar as migrations **em ordem**: `supabase link --project-ref <ref>`, depois `supabase db push`. Alternativa (a usada): colar cada arquivo de `supabase/migrations/` no SQL Editor, de 0001 a 0011. Faça backup antes, se já houver dados. O SQL Editor pode abrir dois avisos, ambos esperados:
  - na **0007**, "creates tables without enabling Row Level Security": escolha **Run without RLS** (as tabelas ficam no schema `private`, que a API não expõe, e sem nenhum privilégio para `anon`/`authenticated`);
  - na **0009**, "destructive operations": escolha **Run query** (os `delete` estão dentro da função de retenção; nada é apagado ao criar a função).
  - Como as migrations entraram pelo SQL Editor, a CLI não sabe que já foram aplicadas. Antes do primeiro `supabase db push`, marque-as: `supabase migration repair --status applied 0001 0002 0003 0004 0005 0006 0007 0008 0009 0010 0011`.
- [x] **Advisors** (Database → Advisors → Security e Performance): Security sem nenhum aviso. Performance: "Auth RLS Initialization Plan" nas políticas `exige_2fa` é falso positivo (a chamada já está em `(select …)`); "Unused Index" é normal com o banco vazio.
- [x] Teste com a chave publicável, **sem login**: `select` em qualquer tabela e chamada de qualquer RPC precisam falhar (o smoke test da seção 5 faz isso). Feito: 401 `42501` em tudo.

## 2. Auth
- [x] **Authentication → Sign In / Providers → Email:** *Allow new users to sign up* **desligado** (só entra quem foi convidado). O convite pelo sistema continua funcionando, porque usa a API de administrador.
- [x] **Multi-Factor:** TOTP ligado.
- [x] **URL Configuration** (21/10/2026): *Site URL* = endereço do site (ex.: `https://seu-projeto.pages.dev/`). Em *Redirect URLs*, coloque **só** esse endereço com `**` no fim.
- [x] **Sessions:** *Access token expiry* = 3600 s (conferido em 21/10/2026). A sessão da tela fecha após 30 min parado. As opções de sessão do usuário (tempo máximo, inatividade) só existem no plano Pro.
- [x] **Password:** mínimo de 10 caracteres (igual ao que a tela pede); a checagem de senhas vazadas só existe no plano Pro.
- [ ] **Email Templates** → adiado para a seção 7. Desde 03/06/2026, projeto novo do plano Free **só edita os templates com SMTP próprio**. (O link precisa levar o `token_hash`, não o token na URL):
  - *Invite user:* trocar o link por `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite`
  - *Reset password:* trocar o link por `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery`
- [ ] **SMTP próprio** → adiado para a seção 7 (Gmail exclusivo da Associação Exemplo; detalhes lá).

## 3. Primeiro administrador
1. Em **Authentication → Users → Add user**, crie o usuário do(a) presidente com e-mail e uma senha temporária.
2. No **SQL Editor**, rode (troque os dados):
   ```sql
   select private.bootstrap_admin('presidente@exemplo.org', 'Nome da Pessoa', 'presidente');
   ```
   A função só funciona enquanto não existe nenhum membro. Depois do primeiro, ela recusa.
3. Entre no site, cadastre o 2FA e troque a senha. Convide o vice: o sistema exige **pelo menos 2 administradores**.

## 4. Site no Cloudflare Pages, Edge Functions e retenção
O endereço do site é `https://seu-projeto.pages.dev` (no ar desde 21/10/2026). Use esse endereço exato nos passos 2 e 4.

- [ ] Criar conta no **Cloudflare** e ligar o 2FA (app autenticador). A conta já existe; falta conferir o 2FA em *My Profile → Authentication*.
- [x] **Workers & Pages → Create → Pages → Connect to Git**, escolher o GitHub e autorizar **só o repositório `erp-associacoes`** (não "All repositories").
- [x] Configuração da build:
  - *Production branch:* `producao` (não `main`: quem atualiza a `producao` é o workflow **Liberar para produção**, só depois que o CI da `main` passa)
  - *Framework preset:* None
  - *Build command:* `npm install -g npm@11.21.0 --ignore-scripts && npm ci && npm test && npm run build && npm run verificar-build`
  - *Build output directory:* `dist`
- [x] **Environment variables (Production):** `NODE_VERSION` = `24`, `SKIP_DEPENDENCY_INSTALL` = `1` (sem ela o Cloudflare roda `npm clean-install` com o npm antigo da imagem, antes do nosso comando, e a build para com `EBADENGINE`), `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. A chave publicável **não é segredo**, mas nunca coloque ali a `sb_secret_…` nem a service role. A própria build recusa.
- [x] **Settings → Builds → Branch control:** *Preview deployments* = **None**, para nenhuma outra branch virar site público.
- [ ] `supabase secrets set APP_ORIGIN=https://seu-projeto.pages.dev` (URL completa do site, sem barra no fim; o CORS usa só a origem).
- [ ] `supabase functions deploy convidar` e `supabase functions deploy enviar-arquivo`. A verificação de JWT fica **ligada**, que é o padrão.
- [x] Retenção diária (Database → Extensions → ligar `pg_cron`, ou `create extension if not exists pg_cron with schema pg_catalog;`; depois, no SQL Editor):
  ```sql
  select cron.schedule('erp-retencao', '17 6 * * *', $$select private.aplicar_retencao()$$);
  ```
- [ ] **GitHub:** repositório **privado**; *Push protection* ligado nas configurações da sua conta. No plano gratuito, a `main` de repositório privado não pode ser protegida (risco aceito, ADR 0008), mas o site só muda quando o CI passa.
- [ ] Primeira vez: depois do primeiro CI verde, confira em **Actions** que o workflow **Liberar para produção** rodou e criou a branch `producao`. Se ela ainda não existir quando você criar o projeto no Cloudflare, crie à mão: `git push origin main:producao`.
- **Nunca dê push direto na `producao`.** Todo envio vai para a `main`; o resto é automático.

## 4b. CAPTCHA (Cloudflare Turnstile)
O código já está pronto; falta só criar as chaves. **Faça na ordem**, senão o login trava:
- [ ] Cloudflare → **Turnstile → Add widget**: nome `Associação Exemplo login`, *Hostnames* `seu-projeto.pages.dev` (e `localhost` só se for testar no seu computador), *Widget mode* **Managed**. Anote a **Site Key** (pública) e a **Secret Key** (secreta).
- [ ] Cloudflare Pages → *Environment variables (Production)*: `VITE_TURNSTILE_SITEKEY` = a **Site Key**. Faça um novo deploy. Por enquanto o Supabase ainda ignora o token.
- [ ] **Confira antes de seguir:** o desafio aparece e se resolve no login e na recuperação de senha. No console do navegador (F12) não pode aparecer erro com `TrustedHTML`, `TrustedScript` ou `Content Security Policy`. Se aparecer, **não ligue no Supabase**: apague a variável, faça o deploy e me chame (o Trusted Types precisa de um ajuste para o Turnstile).
- [ ] Supabase → **Authentication → Bot and Abuse Protection**: ligar o CAPTCHA, provedor **Turnstile**, colar a **Secret Key**. A partir daqui, login e recuperação de senha sem token são recusados pelo servidor.
- [ ] Nunca troque as duas chaves de lugar. A build recusa a chave secreta em `VITE_TURNSTILE_SITEKEY`.
- **Para desligar** numa emergência: primeiro desligue no Supabase, depois apague a variável e faça o deploy.

## 5. Smoke test em produção (obrigatório)
Marque PASS ou FAIL e guarde a data. É isso que fecha os itens BLOCKED_ENVIRONMENT de [`seguranca.md`](seguranca.md).

| # | Teste | Esperado | Resultado |
|---|---|---|---|
| 1 | Abrir o site sem login e tentar qualquer tela interna | Vai para a tela de entrada | |
| 2 | No console do navegador, sem login: `fetch(URL + '/rest/v1/lancamentos', {headers:{apikey: KEY}})` | 401 ou lista vazia; nunca dados | |
| 3 | Entrar sem 2FA | Pede para cadastrar o 2FA; nada aparece antes | |
| 4 | Convidar uma pessoa de teste | O e-mail chega; o link abre `#/entrar/link` e some da barra de endereço | |
| 5 | Recuperar senha | O e-mail chega; pede o 2FA antes de trocar a senha | |
| 6 | Diretor sem permissão tenta abrir Acessos | "Sem permissão" | |
| 7 | Anexar uma foto, um PDF e um arquivo `.html` renomeado para `.pdf` | Os dois primeiros entram; o terceiro é recusado | |
| 8 | Fechar o mês e tentar editar um lançamento dele | Recusado com "mês fechado" | |
| 9 | Logs das Edge Functions e da API | Só `requestId` e nome do erro; nenhum e-mail, nome ou CPF | |
| 10 | Ficar 30 min parado | A sessão é encerrada | |
| 11 | `select private.aplicar_retencao();` no SQL Editor | Devolve as contagens; aparece "Limpeza de dados vencidos" na auditoria | |
| 12 | DevTools → Sources | Sem source maps; nenhuma chave além da publicável | |
| 13 | DevTools → Network → clique no documento → *Response Headers* | Aparecem `content-security-policy` (com `frame-ancestors 'none'`), `strict-transport-security`, `x-frame-options: DENY`, `permissions-policy` | |
| 14 | Em outro site, uma página com `<iframe src="https://seu-projeto.pages.dev">` | O navegador recusa mostrar | |
| 15 | Login com o CAPTCHA ligado | O desafio aparece; o botão Entrar só libera depois dele; o login funciona | |
| 16 | Pelo console, sem passar pelo site: `fetch(URL + '/auth/v1/token?grant_type=password', {method:'POST', headers:{apikey: KEY, 'content-type':'application/json'}, body: JSON.stringify({email:'x@x.test', password:'x'})})` | Recusado por falta de CAPTCHA | |

## 6. Depois de cada mudança
- Migration nova = arquivo novo numerado (nunca edite uma já aplicada). Teste antes num projeto de **staging** (outro projeto Supabase, com dados fictícios), depois em produção, com backup.
- Antes de publicar: `npm run verificar` e as linhas 1, 3, 6 e 9 do smoke test.
- **Desfazer:** no Cloudflare, *Deployments* → versão anterior → **Rollback to this deployment**. Depois corrija na `main`; o próximo CI verde publica a correção. No banco, escreva uma migration nova que reverte a anterior; restaure o backup só em último caso.

## 7. Lançamento (quando o sistema estiver 100% pronto)
Tudo que depende de dado real da Associação Exemplo, numa lista só, **nesta ordem**:

1. **SMTP com o Gmail da Associação Exemplo** (conta usada só pelo sistema, com 2FA por app autenticador). No Google: *Conta → Segurança → Senhas de app* → criar uma para "Supabase". No Supabase: *Authentication → Emails → Set up SMTP*: host `smtp.gmail.com`, porta `465`, usuário = o e-mail, senha = a senha de app (você digita; ela nunca vai para o repositório nem para o chat), remetente = o mesmo e-mail, nome "Associação Exemplo Gestão". Motivo do Gmail: a Associação Exemplo não tem domínio próprio, e os provedores profissionais (Resend etc.) exigem domínio verificado. Com domínio próprio, trocar por um deles.
2. **Templates de e-mail** (só funcionam depois do item 1): os dois links da seção 2.
3. **Edge Functions:** `APP_ORIGIN` e deploy das duas (seção 4).
4. **CAPTCHA (Turnstile)** na ordem da seção 4b. Risco ainda aberto: o widget real sob Trusted Types nunca foi testado (BLOCKED_ENVIRONMENT). Se travar, siga o próprio aviso da 4b.
5. **Primeiro administrador** (seção 3) e convite do 2º administrador.
6. **Smoke test completo** (seção 5) e atualização das evidências em [`seguranca.md`](seguranca.md).
7. **2FA no Cloudflare** e o restante da seção 0.
8. **Backup externo da auditoria** e decisão sobre a pausa do plano Free (7 dias sem uso).
9. **Uso em paralelo com as planilhas por 1 mês** (Dossiê §13) antes de abandoná-las.

### 7b. Fase 2 (Agenda, Tarefas e Avisos) no lançamento
Faça **antes** de avançar a `producao` para um commit que tenha as telas da Fase 2 (sem as migrations, essas telas dão erro).
1. **Backup** (o banco ainda está vazio: anote a data e siga).
2. SQL Editor: aplicar `0012_organizacao.sql` e depois `0013_emails_organizacao.sql`, cada uma inteira. Conferir o Security Advisor (nenhum aviso novo).
3. Rotina diária (gera as tarefas recorrentes e monta a fila de e-mails), 06h07 de Brasília:
   ```sql
   select cron.schedule('erp-organizacao', '7 9 * * *', $$select private.rotina_organizacao()$$);
   ```
4. Envio dos e-mails (depois do SMTP do item 1 da lista acima):
   - Supabase → *Settings → API Keys* → criar uma **secret key** chamada `emails`. Copie e guarde no gerenciador de senhas.
   - Guardar essa chave no cofre do banco (você digita a chave):
     ```sql
     select vault.create_secret('COLE_A_CHAVE_AQUI', 'chave_emails');
     ```
   - Segredos da função: `supabase secrets set SMTP_HOST=smtp.gmail.com SMTP_USUARIO=<e-mail> SMTP_REMETENTE=<e-mail> SMTP_SENHA=<senha de app>` (o `APP_ORIGIN` já existe).
   - `supabase functions deploy enviar-emails --no-verify-jwt` (quem autentica é a chave `emails`, não o login).
   - Ligar a extensão `pg_net` e agendar o envio, 10 minutos depois da rotina:
     ```sql
     select cron.schedule('erp-emails', '17 9 * * *', $$
       select net.http_post(
         url := 'https://SEU-PROJETO.supabase.co/functions/v1/enviar-emails',
         headers := jsonb_build_object('apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'chave_emails')))
     $$);
     ```
5. Smoke test da Fase 2: criar evento e tarefa com prazo amanhã; rodar `select private.rotina_organizacao();`; conferir que o lembrete chegou **uma vez**; desligar o lembrete em Ajustes e conferir que o próximo não chega; abrir os logs da função e conferir que não aparece nenhum e-mail.
6. Avançar a `producao` (fast-forward, testes passando).

### 7f. Correções e importações (0023) no lançamento
1. **Backup**. SQL Editor: aplicar `0023_importacoes_contabil.sql` inteira. Conferir o Security Advisor.
2. **Cabeçalhos:** conferir que a build publicada tem a pasta `/ocr/` e a regra `/ocr/*` no `_headers` (o `verificar-build` já exige a CSP das páginas).
3. **Smoke test:** importar o plano de contas do contador; ligar as categorias; importar uma planilha antiga pequena duas vezes (a segunda não pode duplicar); importar um extrato em PDF e lançar uma linha sem par; importar o balancete de um mês e conferir a comparação; tirar a foto de um cupom real e conferir o preenchimento.
4. ⚖️ **Conferir com o contador** a natureza de cada grupo do plano de contas (ativo, passivo, receita, despesa).

### 7g. Fase 6 (Previsão e análises, 0024) no lançamento
1. **Backup**. SQL Editor: aplicar `0024_analises.sql` inteira. Conferir o Security Advisor.
2. **Smoke test:** abrir *Dinheiro → Previsão e análises* com a tesouraria (deve abrir) e com um diretor de alcance "próprios" (deve dizer que é só para quem vê todo o financeiro); simular um cenário e conferir que nada foi gravado; baixar o relatório do mês em PDF.
3. ⚖️ **Decisão:** conferir com a diretoria os pesos por situação da verba (ideia 0%, pedido 20%, em análise 40%, aprovada 80%, formalizada 95%) — estão em `src/lib/analises.ts` (`PESO_VERBA`).

### 7i. Orçamento, mensalidade em um passo e busca (0026, 0027) no lançamento
1. **Backup**. SQL Editor: aplicar `0026_orcamento_mensalidade.sql` e depois `0027_busca.sql`. Conferir o Security Advisor (a busca é `security invoker`: usa a RLS de quem busca).
2. **Smoke test:** definir o orçamento do ano; dar baixa numa mensalidade de teste com "Recebi agora" (deve criar a entrada no Dinheiro); buscar um lançamento com um diretor de alcance "próprios" e conferir que ele só acha os dele.
3. **Começo limpo:** o banco real não tem nenhum dado fictício (as migrations não trazem dados; a demonstração só existe na build `demo`, e o `verificar-build` reprova a produção se achar código dela). Siga os **Primeiros passos** do Início.

### 7k. Manter conectado e modelos de permissão (0031) no lançamento
1. **Backup**. SQL Editor: aplicar `0031_conectado_e_modelos.sql` depois da 0030.
2. **Smoke test:** entrar marcando "Manter conectado", fechar o navegador e abrir de novo (deve entrar direto). Tocar em Sair e abrir de novo (deve pedir login). Em Acessos, criar um modelo "Comissão técnica" e convidar alguém com ele.

### 7u. PDF de 50 MB no banco (0040) e apagar acesso (0041) (28/10/2026)
- **0040:** a 0037 subiu o limite dos buckets, mas o registro no banco (`registrar_documento`, `registrar_comprovante` e as restrições das tabelas) seguia em 10 MB: o estatuto de 20 MB subia e era recusado ("Alguma informação não está válida"). Agora a regra única é `private.tamanho_arquivo_ok`: PDF até 50 MB, o resto até 10 MB.
- **0041:** `apagar_membro` apaga, numa transação só, o membro **e o login** (`auth.users`: sessões e 2FA saem em cascata). Só administrador, nunca o próprio acesso, mantém o mínimo de administradores. Quem já registrou algo responde `tem_historico`: aí é desligar o acesso. Conferido em produção que o papel `postgres` pode apagar em `auth.users`.
- Aplicar no SQL Editor, em ordem: `0040_pdf_50mb_no_banco.sql`, `0041_apagar_membro.sql`.
- **Smoke test:** enviar um PDF de mais de 10 MB em Documentos; em Acessos, abrir uma pessoa de teste e tocar em "Apagar acesso".

### 7t. Link do e-mail sem modelo personalizado (28/10/2026)
- No plano gratuito, o Supabase só deixa editar os modelos de e-mail com SMTP próprio. Sem isso, o convite e a recuperação usam o **link padrão**, que volta ao site com a sessão no fragmento (`#access_token=…&type=invite`).
- O site agora aceita os dois formatos: `src/lib/capturar-link-email.ts` lê o fragmento **antes** do roteador, guarda só em memória, apaga do endereço e abre "Crie sua senha"; a sessão é conferida pelo servidor (`setSession`). Link vencido mostra "Link inválido". Teste de navegador em `cadastros_e2e.py`.
- Quando houver SMTP próprio, os modelos da seção 2 (com `token_hash`) continuam funcionando e são preferíveis (e-mail em português).

### 7s. Apagar categoria sem uso (0039)
1. SQL Editor: aplicar `0039_apagar_categoria_socio.sql`. Categoria usada por alguém continua só desativável.

### 7r. Funções publicadas pelo painel (28/10/2026)
- `enviar-arquivo`, `convidar` e `pedir-acesso` foram publicadas pelo **editor do painel** (sem CLI), com o arquivo único gerado por `node scripts/empacotar-funcoes.mjs <pasta>`. Conferido: o conteúdo colado tem o mesmo SHA-256 do arquivo gerado, e as 3 respondem 204 ao preflight do site (subiram com `APP_ORIGIN` e `TURNSTILE_SECRET_KEY`).
- **"Verify JWT with legacy secret"** veio LIGADO nas 3. A `pedir-acesso` não tem login (manda a chave publicável), então **precisa ficar DESLIGADO** nela (equivale ao `--no-verify-jwt`; quem protege é a chave publicável + o CAPTCHA validado no servidor). Nas outras duas, a própria função confere o login (`auth: 'user'`); se o envio de arquivo ou o convite responder 401, desligue também nelas.
- Para atualizar uma função: gerar de novo, abrir a função no painel → **Code** → colar → **Deploy updates**.

### 7q. PDF até 50 MB e cargos do estatuto (0037, 0038)
1. SQL Editor: aplicar `0037_pdf_50mb.sql` e `0038_cargos_do_estatuto.sql`.
2. Republicar a função `enviar-arquivo` (aceita PDF até 50 MB).
3. **Smoke test:** enviar o estatuto (PDF de ~20 MB) em Documentos; convidar alguém como "Conselho Fiscal" e conferir que ele só consulta.

### 7p. Salário mínimo automático (0036)
1. SQL Editor: aplicar `0036_salario_minimo_automatico.sql`.
2. Ligar as extensões e agendar (uma vez):
   ```sql
   create extension if not exists pg_cron with schema pg_catalog;
   create extension if not exists pg_net;
   select cron.schedule('erp-salario-minimo-pedir', '13 10 * * *', $$select private.pedir_salario_minimo()$$);
   select cron.schedule('erp-salario-minimo-gravar', '23 10 * * *', $$select private.processar_salario_minimo()$$);
   ```
3. **Teste:** `select private.pedir_salario_minimo();` e, um minuto depois, `select private.processar_salario_minimo();` — deve voltar `criadas: 0` (os valores de 2025 e 2026 já estão cadastrados). A auditoria registra cada execução (`salario_minimo_automatico`).
4. Fonte: Banco Central, SGS 1619 (endereço fixo no banco). Valor que diminui, sobe mais de 25% ou bate de frente com um cadastrado à mão **não** é gravado (fica na auditoria).

### 7o. Parcela única anual (0035)
1. SQL Editor: aplicar `0035_parcela_unica.sql`.
2. Em *Pessoas › Mensalidades › Configurar a mensalidade*, abrir a categoria "Associado" e conferir **Parcela única no ano = 10%**.
3. De dezembro ao fim de fevereiro, na ficha da pessoa aparece **Parcela única AAAA** para a tesouraria receber.

### 7n. Sem e-mails de aviso (0034)
1. SQL Editor: aplicar `0034_sem_emails_de_aviso.sql`. A rotina diária deixa de montar lembretes e resumo semanal.
2. **Não** publicar a função `enviar-emails` nem cadastrar segredos de SMTP. O convite para criar a senha (Supabase Auth) continua normal.

### 7m. Cargo dev (0033) no lançamento
1. **Backup**. SQL Editor: aplicar `0033_cargo_dev.sql`.
2. **Trocar o cargo do desenvolvedor** (dado, à parte):
   ```sql
   update public.membros set cargo = 'dev' where email = 'voce@exemplo.org';
   select private.gravar_permissoes(id, private.permissoes_modelo('dev')) from public.membros where email = 'voce@exemplo.org';
   ```
3. **Smoke test:** Sair e entrar de novo; em Mais deve aparecer "Dev (acesso total)", e a área de Saúde de um atleta deve abrir.

### 7l. Mensalidade em % do salário mínimo (0032) no lançamento
1. **Backup**. SQL Editor: aplicar `0032_mensalidade_salario_minimo.sql` depois da 0031. Ela já cadastra os salários mínimos oficiais de 2025 e 2026.
2. **Smoke test:** em *Pessoas › Mensalidades › Configurar a mensalidade*, criar a categoria "Associado" com **1% do salário mínimo** (vence dia 10). A lista deve mostrar o valor da próxima cobrança (R$ 16,21 com o mínimo de R$ 1.621). Gerar as mensalidades do mês num associado de teste e conferir o valor.
3. **Todo janeiro:** quando sair o decreto do novo salário mínimo, cadastrar em *Pessoas › Mensalidades › Configurar a mensalidade › Salário mínimo › Novo reajuste*. Pela regra dos 45 dias (estatuto), o valor novo entra sozinho a partir da cobrança de março.

### 7j. Projeto próprio, ficha do atleta e pedido de acesso (0028, 0029, 0030) no lançamento
1. **Backup**. SQL Editor: aplicar `0028_projeto_proprio.sql`, `0029_atleta_foto_ficha.sql` e `0030_pedidos_acesso.sql`, nessa ordem. Conferir o Security Advisor: `anon` continua só com `transparencia_publica`; `registrar_pedido_acesso` só para a service role.
2. **Turnstile:** no painel da Cloudflare, no mesmo widget do login, confirmar que o hostname do sistema está na lista. Copiar a **chave secreta** (você mesmo digita): `supabase secrets set TURNSTILE_SECRET_KEY=...` (e `APP_ORIGIN`, se ainda não estiver).
3. **Deploy:** `supabase functions deploy enviar-arquivo` (aceita a foto 3x4) e `supabase functions deploy pedir-acesso --no-verify-jwt` (público: quem confere é a chave publicável + o CAPTCHA).
4. **Smoke test:** numa janela anônima, *Entrar → Pedir acesso* com um e-mail seu de teste: deve dizer "Pedido recebido" e aparecer em *Acessos → Pedidos de acesso*. Liberar (vira convite) e recusar outro. Mandar 4 pedidos seguidos do mesmo aparelho: o 4º deve ser barrado. Num atleta de teste: registrar a autorização de imagem, enviar a foto, revogar a autorização (a foto some).
5. **Sem a chave secreta a função não sobe** e o formulário mostra erro: é o esperado (fail closed).

### 7h. Fase 7 (Transparência, 0025) no lançamento
1. **Backup**. SQL Editor: aplicar `0025_transparencia.sql` inteira. Conferir o Security Advisor: **a única** função executável por `anon` deve ser `transparencia_publica`.
2. **Teste com a chave pública, sem login** (no navegador anônimo): abrir `#/transparencia` (mostra "Nada publicado ainda"); confirmar que nenhuma outra tela abre sem login.
3. **Primeira publicação:** a tesouraria (com 2FA) gera a prévia do último trimestre fechado, confere **cada nome de categoria** (nada que identifique pessoa ou saúde) e publica. Conferir a página pública e o PDF; se algo estiver errado, retirar com motivo e publicar de novo.
4. ⚖️ **Decisões:** quais períodos publicar (sugestão: trimestral e anual, depois do fechamento do contador); se a página deve aparecer no Google (hoje `noindex`).

### 7c. Fase 3 (Verbas e Projetos) no lançamento
Junto com a 7b, **antes** de avançar a `producao`:
1. SQL Editor: aplicar `0014_verbas_projetos.sql` inteira (depois da 0013). Conferir o Security Advisor.
2. Smoke test: cadastrar uma verba de teste, formalizar, criar uma rubrica, lançar uma saída na conta do projeto, classificar, gerar o PDF da prestação e conferir que aparece "exportar" na auditoria. Depois cancelar a verba de teste (nada se apaga).
3. Mostrar o PDF da prestação ao contador no primeiro projeto real (evidência pendente em `seguranca.md`).

### 7d. Fase 4 (Pessoas, Patrimônio, Governança, Filiações e presença) no lançamento
Junto com a 7b e a 7c, **antes** de avançar a `producao`:
1. **Backup** (anote a data). SQL Editor: aplicar `0015_pessoas_saude.sql`, `0016_patrimonio.sql`, `0017_governanca.sql`, `0018_filiacoes.sql` e `0019_presenca_treinos.sql`, nesta ordem, cada uma inteira. Conferir o Security Advisor (nenhum aviso novo) e que os buckets `pessoas`, `saude` e `institucional` aparecem como **privados** em *Storage*.
2. **Envio de arquivos atualizado:** `supabase functions deploy enviar-arquivo` (a função ganhou o destino "documento"; JWT continua **ligado**).
3. **Remoção de arquivos (LGPD):**
   - Supabase → *Settings → API Keys* → criar uma **secret key** chamada `limpeza` e guardar no gerenciador de senhas.
   - Guardar no cofre do banco (você digita a chave): `select vault.create_secret('COLE_A_CHAVE_AQUI', 'chave_limpeza');`
   - `supabase functions deploy limpar-arquivos --no-verify-jwt` (quem autentica é a chave `limpeza`).
   - Agendar 20 minutos depois da retenção:
     ```sql
     select cron.schedule('erp-limpar-arquivos', '37 6 * * *', $$
       select net.http_post(
         url := 'https://SEU-PROJETO.supabase.co/functions/v1/limpar-arquivos',
         headers := jsonb_build_object('apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'chave_limpeza')))
     $$);
     ```
4. **Chave Pix da Associação Exemplo:** a tesouraria cadastra em *Pessoas › Mensalidades › Configurar a mensalidade → Chave Pix* (ela mesma digita; confira no app do banco). Teste de verdade: gere a cobrança de uma mensalidade de teste de **R$ 0,01**, pague pelo app de um banco, confira que o nome do recebedor e o valor aparecem certos e que o dinheiro caiu na conta da Associação Exemplo. Depois lance a entrada no Dinheiro, dê baixa e reabra (para não ficar registro falso).
5. **Área de saúde:** em *Acessos*, liberar o módulo **Saúde** só para quem cuida (comissão técnica). Conferir com outra conta da diretoria que a área **não aparece** na ficha do atleta.
6. **Decisões da diretoria antes de cadastrar o 1º atleta real** ⚖️ (`lgpd.md` §9): encarregado ou canal de privacidade (preencher `CONTATO_ENCARREGADO`), avaliação de alto risco e RIPD, base legal da saúde, prazos de retenção (1 ano saúde, 5 anos contatos), texto da política e do termo de consentimento revisado por advogado, texto do termo de empréstimo de material (versão `v1`).
7. **Smoke test da Fase 4:** cadastrar um atleta fictício menor (o sistema deve exigir o responsável); gerar mensalidades duas vezes (não duplica); anexar uma foto com GPS a um documento e conferir, baixando o arquivo, que a localização sumiu; registrar autorização de saúde, gravar e revogar (os dados somem e, no dia seguinte, o arquivo some do Storage); cadastrar um bem, emprestar e devolver; criar uma reunião, marcar presença, aprovar a ata e conferir que nada mais muda; marcar a presença de um treino; gerar o PDF da prestação de contas de um projeto com bem e treino ligados. Depois, desligar o atleta fictício.
8. Avançar a `producao` (fast-forward, testes passando).

### 7e. Fase 5 (Conciliação, Captação e Viagens) no lançamento
Junto com a 7b a 7d, **antes** de avançar a `producao`:
1. **Backup**. SQL Editor: aplicar `0020_conciliacao.sql`, `0021_captacao.sql` e `0022_viagens.sql`, nesta ordem, cada uma inteira. Conferir o Security Advisor e que o bucket `captacao` está **privado**.
2. **Funções:** `supabase functions deploy enviar-arquivo` e `supabase functions deploy limpar-arquivos --no-verify-jwt` de novo (ganharam a área "contrapartida" e o bucket `captacao`).
3. **Dados da Associação Exemplo no recibo:** a tesouraria cadastra em *Captação → Recibos → Dados da Associação Exemplo no recibo* (nome, CNPJ e endereço reais; o sistema confere o CNPJ).
4. **Smoke test da Fase 5:**
   - baixar o extrato do mês passado do banco da Associação Exemplo em OFX (e, se o banco não tiver OFX, em CSV), importar na Conciliação, importar de novo (nada pode duplicar), aceitar as sugestões e conferir que o checklist do fechamento passa a contar as linhas pendentes;
   - emitir um recibo de teste (doação em bens, R$ 1,00), baixar o PDF, conferir número, CNPJ e valor por extenso, e cancelar o recibo com o motivo "teste" (o número fica marcado como cancelado — é o esperado);
   - cadastrar uma viagem de teste, montar a delegação, ligar um lançamento como adiantamento, ver que "Encerrar" fica bloqueado até a devolução, e cancelar a viagem;
   - anexar a foto de uma contrapartida de teste e conferir que ela marca a entrega.
5. ⚖️ **Decisões:** prazo de guarda do funil de captação (sugestão: 2 anos depois de "perdido"); regra legal das rifas e sorteios conferida com o contador **antes da primeira rifa**; modelo do recibo de doação revisado pelo contador.
6. Avançar a `producao` (fast-forward, testes passando).
