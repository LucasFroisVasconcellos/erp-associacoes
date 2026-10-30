# Segurança — modelo de ameaças, riscos aceitos, incidente e evidências

Sistema de Gestão Integrada da Associação Exemplo, Fases 1 a 3. Segue o *Guia Mestre de Segurança para Aplicações* (set/2026), os complementos KipperDev e os de out/2026 (OWASP Top 10 2025).

> **Isto não é uma declaração de que o sistema é "seguro".** É o registro do que foi defendido, como foi testado, o que ficou de fora e por quê.

## 1. Premissas (afetam a prioridade dos riscos)
1. Quem usa é a diretoria da Associação Exemplo: poucas pessoas (menos de 30), todas convidadas. **Não existe cadastro público.**
2. O site é estático (Cloudflare Pages, com cabeçalhos de segurança; código no GitHub, repositório privado). Toda decisão fica no **Supabase**: Postgres com RLS, Auth, Storage e duas Edge Functions.
3. O projeto Supabase fica na região São Paulo, com cadastro público desligado e templates de e-mail configurados ([`deploy.md`](deploy.md)).
4. Dados mais valiosos: movimentação financeira, comprovantes e a trilha de auditoria. Na Fase 1 não há dado de saúde de atletas.
5. Ameaças realistas: alguém de fora tentando entrar (senha vazada, phishing), um membro tentando ver ou mudar o que não pode (IDOR, escalada), um membro desonesto tentando apagar rastros, e abuso que gere custo (uploads, chamadas em massa).

Se alguma dessas premissas mudar (ex.: abrir o sistema para associados ou atletas), refaça as seções 4 e 5.

## 2. Componentes e limites de confiança

```
 Navegador (React, Cloudflare Pages)      Supabase (sa-east-1)
 ┌──────────────────────────┐   HTTPS    ┌───────────────────────────────────────┐
 │ chave publicável apenas  │──────────▶ │ Auth (senha + TOTP, PKCE)             │
 │ sessão em sessionStorage │            │ PostgREST → RPCs públicas (INVOKER)   │
 │ rascunhos no IndexedDB   │            │      └▶ private.* (DEFINER, search_path='') │
 └──────────────────────────┘            │ RLS + política RESTRICTIVE aal2       │
            │ HTTPS + JWT do usuário     │ Storage privado (comprovantes, contador)│
            └──────────────────────────▶ │ Edge Functions: convidar, enviar-arquivo│
                                         │   (service role só no servidor)       │
                                         └───────────────────────────────────────┘
```

| Limite | Protocolo e autenticação | Validação | Limite de uso |
|---|---|---|---|
| Navegador → Auth | HTTPS, PKCE, senha + TOTP | Supabase Auth | Limites nativos do Auth |
| Navegador → RPCs e tabelas | HTTPS, JWT (`aal2` obrigatório) | Cada RPC valida o JSON campo a campo, tipo e tamanho; recusa campos extras; o banco tem CHECKs | `private.limites` por pessoa e operação |
| Navegador → Edge Functions | HTTPS, JWT do usuário, CORS restrito a `APP_ORIGIN` | Campos permitidos, tamanho (10 MB), `content-length` obrigatório, tipo real pelos bytes | Mesmo limite, aplicado pelo banco |
| Edge Function → Banco e Storage | Service role (segredo só na função) | A autorização é pedida ao banco **como o usuário** antes de gravar | — |
| Repositório e CI → produção | Não há deploy automático do banco; migrations aplicadas à mão | CI roda testes, build e varredura de segredos | — |

## 3. Ativos
- **Integridade financeira:** lançamentos, saldos e meses fechados.
- **Trilha de auditoria:** imutável, é a prova.
- **Comprovantes e arquivos do contador:** podem ter CPF, endereço e dado de saúde.
- **Contas e permissões:** quem é administrador.
- **Segredos:** service role e senha do banco (somente no Supabase, nunca no repositório ou no site).

## 4. Entradas
- Telas de login, recuperação de senha e link do e-mail (`#/entrar/link`, que lê `token_hash` e limpa a URL).
- 31 RPCs públicas chamáveis por usuário logado e 2 só pela service role (`registrar_comprovante`, `registrar_arquivo_contador`). Todas são `SECURITY INVOKER` e chamam `private.*`.
- Leitura direta (SELECT) das 17 tabelas de `public`, sempre com RLS. Escrita direta: **nenhuma** (só por RPC).
- Edge Functions `convidar` (JSON) e `enviar-arquivo` (multipart).
- Parsers no navegador: QR Code da NFC-e, código de barras de boleto, XML de NF-e e imagem do comprovante.

## 5. Ameaças priorizadas (STRIDE)

| # | Ameaça (caminho de abuso) | STRIDE | Prob. | Impacto | Prioridade | Defesas existentes (evidência) | Recomendado |
|---|---|---|---|---|---|---|---|
| A1 | Senha de um diretor vaza (phishing ou reuso) e o atacante entra | S | Média | Alto | **Alta** | 2FA TOTP obrigatório para todos, exigido pelo banco (política RESTRICTIVE aal2 em toda tabela + checagem em cada RPC); TOTP recente para mudanças de acesso (`mutacao.test.ts`) | Passkeys quando o Supabase permitir; alerta de login de local novo |
| A2 | Membro lê ou altera recurso de outro (IDOR/BOLA), ex.: reembolso alheio | I, T | Média | Alto | **Alta** | Permissão por módulo, ação e alcance ("tudo" ou "próprios") no banco; o dono vem de `auth.uid()`, nunca do cliente (`acessos.test.ts`, `financeiro.test.ts`, `fuzz.test.ts`) | Manter os testes de IDOR para cada tabela nova |
| A3 | Membro se dá permissão de administrador (mass assignment ou escalada) | E | Baixa | Alto | Média | Só administrador muda permissões; não pode mudar as próprias; mínimo de 2 administradores; campos extras recusados (`mutacao.test.ts`, `convite.test.ts`) | — |
| A4 | Membro desonesto apaga ou edita lançamento depois de fechar o mês, para esconder desvio | T, R | Baixa | Alto | Média | Gatilho de mês fechado independente do papel (migration 0008); estorno em vez de exclusão; auditoria imutável inclusive para o dono do banco via app (`mutacao.test.ts`) | Exportar a auditoria todo mês (Acessos → Auditoria → Exportar, CSV) e guardar fora do Supabase (o `postgres` no SQL Editor ainda pode desligar gatilhos) |
| A5 | Upload malicioso (HTML/SVG com script, arquivo enorme, nome com `../`) | T, D | Média | Médio | Média | Tipo real pelos bytes (PDF, JPEG, PNG, WebP, XML); 10 MB; `content-length` obrigatório; nome aleatório; bucket privado; URL assinada de 60 s (`envio.test.ts`, `arquivos.test.ts`) | Antivírus no Storage se os arquivos forem abertos fora do sistema |
| A6 | XSS pelo texto de uma descrição ou do XML da NF-e | T, I | Baixa | Alto | Média | React escapa todo texto; sem `dangerouslySetInnerHTML` no código do app; CSP `script-src 'self'`; Trusted Types com lista fechada (`trusted-types.test.ts`) | Remover `style-src 'unsafe-inline'` quando Radix, sonner e input-otp permitirem |
| A7 | Exportação CSV abre fórmula no Excel do contador (CSV injection) | T | Baixa | Médio | Baixa | Células iniciadas por `= + - @` tab/CR são neutralizadas (`src/lib/csv.test.ts`) | — |
| A8 | Abuso que gere custo (milhares de chamadas ou uploads) | D | Baixa | Médio | Baixa | Limite por hora por pessoa e operação, no banco (`limites.test.ts`); timeout de 20 s no cliente | Spend cap no Supabase |
| A9 | Chave secreta vazada no site ou no GitHub | I, E | Baixa | Crítico | **Alta** | Build recusa `sb_secret_` e JWT de service role na config (`config.test.ts`); verificador da build procura segredos e source maps (`verificar-build.test.ts`); secretlint no CI; `.gitignore` desde o 1º commit | Push protection e secret scanning ativados no GitHub ([`deploy.md`](deploy.md)) |
| A10 | Clickjacking (site carregado dentro de outro para induzir cliques) | T | Baixa | Médio | Baixa | `frame-ancestors 'none'` e `X-Frame-Options: DENY` no `_headers`, mais frame-busting em JS; verificador da build exige os dois cabeçalhos (`verificar-build.test.ts`) | — |
| A11 | Força bruta ou bots no login | S, D | Média | Médio | Média | Limites nativos do Supabase Auth; 2FA; mensagem que não revela se a conta existe; **CAPTCHA (Turnstile) no login e na recuperação**, validado pelo Supabase Auth no servidor, token de uso único (`config.test.ts`, `trusted-types.test.ts`, teste de fluxo no navegador) | Ligar as chaves ([`deploy.md`](deploy.md) § 4b) |
| A12 | Resposta antiga sobrescreve dados depois de trocar de conta ou sair (corrida) | I | Baixa | Médio | Baixa | Contador de geração descarta respostas obsoletas; cache limpo ao trocar de usuário (`src/lib/app.test.ts`) | — |
| A13 | Duplo clique cria lançamento duplicado | T | Média | Baixo | Baixa | Id gerado no cliente e insert idempotente; teste de concorrência real (`financeiro.test.ts`, `fuzz.test.ts`) | — |
| A15 | Membro com alcance "próprios" lê tarefa, checklist ou comentário alheio (IDOR) | I | Média | Médio | Média | RLS por `private.ve_tarefa` em tarefas, itens e comentários; RPCs respondem `nao_encontrado` para o que não se vê (`organizacao.test.ts`, mutação em `organizacao-fuzz.test.ts`) | Manter o teste para cada tabela nova |
| A16 | Membro apaga tarefa, evento, comentário ou aviso para esconder algo | T, R | Baixa | Médio | Baixa | Gatilho "sem apagar" mesmo para o dono do banco; cancelar/arquivar em vez de apagar; auditoria por gatilho; comentário não se edita (`organizacao.test.ts`, mutação) | — |
| A17 | E-mail duplicado ou para quem saiu; injeção de cabeçalho no assunto; endereço vazando no log | T, I | Média | Baixo | Baixa | Fila com chave única e `SKIP LOCKED`; endereço lido só na hora e só de membro ativo; assunto sem quebra de linha (banco e função); erro gravado só como código (`emails.test.ts`, `_shared/emails.test.ts`) | — |
| A18 | Alguém chama a função de envio de e-mails de fora | S, D | Baixa | Médio | Baixa | Só aceita a chave secreta nomeada `emails` (comparação segura da `@supabase/server`); `pegar_emails`/`marcar_email` só para a service role; a fila não é exposta (`privilegios.test.ts`) | Trocar a chave se suspeitar |
| A19 | Membro classifica gasto na rubrica de outro projeto, ou some com uma pendência sem justificar | T, R | Média | Alto | **Alta** | Rubrica precisa ser do projeto do lançamento (achado e corrigido em 22/10: comparação com nulo deixava passar); justificativa só para regra realmente pendente, imutável e auditada (`verbas-projetos.test.ts`, mutação) | — |
| A20 | Regras de uma verba enfraquecidas com chave inventada (ex.: `{"liberar_tudo": true}`) | T, E | Baixa | Médio | Baixa | `private.regras_validas` com chaves e tipos fechados, também como CHECK nas tabelas (`verbas-projetos.test.ts`, mutação) | — |
| A21 | Relatório de prestação de contas vaza CPF de fornecedor pessoa física ou é gerado por quem não vê o financeiro | I | Média | Médio | Média | CPF mascarado no PDF/CSV; geração exige `projetos/exportar` + financeiro completo e fica na auditoria; CSV neutraliza fórmulas (`prestacao.test.ts`, mutação) | — |
| A22 | Diretor sem a área de saúde lê laudo, deficiência ou a existência de autorização de saúde de um atleta (dado sensível) | I | Média | Alto | **Alta** | Módulo `saude` fora de todos os perfis padrão; RLS nas tabelas e no bucket `saude`; autorização de saúde invisível sem o módulo; saúde nunca vai para agenda, avisos, e-mails nem Início; auditoria registra só o nome dos campos alterados (`pessoas-saude.test.ts`, mutação) | Revisar quem tem o módulo a cada mudança de diretoria |
| A23 | Dado de saúde gravado sem base legal, ou mantido depois de revogada a autorização | I, R | Média | Alto | **Alta** | Sem autorização ativa o banco recusa (fail closed); revogar apaga dados e coloca os arquivos na fila de remoção; menor só com autorização do responsável (`pessoas-saude.test.ts`, mutação) | ⚖️ confirmar com advogado as bases legais e o RIPD |
| A24 | Chave Pix trocada para desviar mensalidades | T, S | Baixa | Alto | Média | Só `financeiro/administrar`; troca auditada; validação do formato; o código Pix é gerado da chave guardada no banco, não de texto do cliente | Conferir a chave no lançamento (`deploy.md` §7d); avisar a diretoria em toda troca |
| A25 | Ata, presença ou votação alterada depois de aprovada | T, R | Baixa | Alto | Média | Gatilho bloqueia reunião, presenças e deliberações (inclusive pelo dono do banco pelo app); votos ≤ presentes (`patrimonio-governanca-filiacoes.test.ts`, mutação) | Guardar o PDF da ata aprovada fora do sistema |
| A26 | Arquivo antigo de documento ou de saúde fica no Storage depois de trocado ou apagado | I | Média | Médio | Média | Fila `private.arquivos_remover` alimentada pelo banco; `limpar-arquivos` (chave secreta `limpeza`) só remove nos buckets e caminhos permitidos (`limpeza.test.ts`) | Agendar a função no lançamento (`deploy.md` §7d) |
| A27 | Extrato de banco adulterado ou malicioso (OFX com script, CSV com fórmula, arquivo gigante) | T, D | Baixa | Médio | Baixa | Arquivo lido só no aparelho; só data, valor, descrição e id vão ao servidor, que valida tudo de novo (tipos, caracteres de controle, limite de 2.000 linhas, chaves fechadas); reimportar não duplica (`extrato.test.ts`, `fase5.test.ts`, fuzzing) | — |
| A28 | Conciliação forçada para esconder um desvio (linha do banco casada com lançamento de outro valor) ou mês fechado com extrato pendente | T, R | Baixa | Alto | Média | Mesma conta, valor e sentido exigidos; um lançamento só serve a uma linha; deixar de fora exige motivo e fica auditado; linha pendente impede o fechamento (`fase5.test.ts`, mutação) | — |
| A29 | Recibo de doação falso ou duplicado (número repetido, valor maior que a entrada, CPF inventado) | T, R | Média | Alto | **Alta** | Só a tesouraria emite; número por ano em sequência sem buraco, na mesma transação (testado com 5 emissões simultâneas); em dinheiro só com entrada real do mesmo valor, uma vez; CPF/CNPJ com dígito verificador; recibo não se apaga, cancela com motivo (`fase5.test.ts`, mutação) | Guardar a 2ª via assinada |
| A30 | Adiantamento de viagem sem prestação de contas | T, R | Média | Médio | Média | Viagem só encerra com o acerto feito (o que sobrou volta como devolução); alerta no Início; mexer na viagem de outra pessoa só com `viagens/editar` (`fase5.test.ts`, mutação) | — |
| A31 | Nome de área herdado do objeto (`constructor`, `__proto__`) no envio de arquivo | T | Baixa | Baixo | Baixa | Área por `Map` com lista fechada; recusado antes de chamar o banco (achado e corrigido em 22/10, `envio.test.ts`) | — |
| A14 | Pacote npm comprometido (ataques de 2026) | E | Média | Alto | **Alta** | `min-release-age=7`, `ignore-scripts=true`, versões exatas, `npm ci` com lockfile, `npm audit` = 0, actions do CI fixadas por SHA | Revisar o diff do lockfile em toda atualização |

## 6. Matriz de acesso (servidor)
Gerada do banco de teste (`has_function_privilege` / `has_table_privilege`) e travada por `tests/db/privilegios.test.ts`.

| Superfície | Sem sessão (anon) | Logado sem 2FA (aal1) | Logado com 2FA, sem permissão | Com permissão | Service role |
|---|---|---|---|---|---|
| SELECT nas 66 tabelas (até a Fase 5) | negado (sem grant) | 0 linhas (RESTRICTIVE aal2) | só o que o alcance permite | permitido pela RLS | — |
| INSERT/UPDATE/DELETE direto | negado | negado (sem grant) | negado | negado (só por RPC) | — |
| 124 RPCs do app (até a Fase 5) | negado (sem execute) | `precisa_2fa` (exceto `aceitar_convite`, que só vincula o convite ao próprio e-mail) | `sem_permissao` | executa, com auditoria | — |
| `registrar_comprovante`, `registrar_arquivo_contador`, `registrar_documento` (Fase 4) | negado | negado | negado | negado | executa (chamada pela Edge Function depois de autorizar como o usuário) |
| `pegar_emails`, `marcar_email` (Fase 2) | negado | negado | negado | negado | executa (só a função `enviar-emails`) |
| `private.fila_emails` | negado | negado | negado | negado | negado (só pelas funções acima) |
| `private.*` que implementam as RPCs e as checagens da RLS (134 funções, até a Fase 5) | negado | a própria função recusa (`precisa_2fa`) | a própria função recusa | executa | — |
| Demais `private.*` (`aplicar_retencao`, `bootstrap_admin`, `registrar`, gatilhos, limites) | negado | negado | negado | negado | negado |
| Buckets `comprovantes` e `contador` | negado | negado | negado | leitura por URL assinada | gravação |
| Buckets `pessoas`, `saude`, `institucional` (Fase 4) e `captacao` (Fase 5) | negado | negado | negado | leitura por URL assinada só de arquivo ligado a documento visível (`saude`: só com o módulo saúde) | gravação; remoção só pela função `limpar-arquivos` |
| `pegar_arquivos_remover`, `confirmar_remocao` (Fase 4) | negado | negado | negado | negado | executa (só a função `limpar-arquivos`) |
| Edge Functions | 401 | recusa do banco | recusa do banco | executa | — |

O schema `private` não é exposto pela Data API: as funções acima só são alcançadas pelas RPCs de `public` (que são `SECURITY INVOKER`, por isso o papel `authenticated` precisa de `execute` nelas) e pelas políticas de RLS.

Rotas da tela (`Portao`, `Requer`) só melhoram a experiência: **não são controle de acesso**. Desligar todas não dá acesso a nenhum dado (as sondas dos testes chamam o banco direto).

## 7. Riscos aceitos (decisões conscientes)

| Risco | Por que foi aceito | Compensação | Rever quando |
|---|---|---|---|
| CSP com `style-src 'unsafe-inline'` | Radix, sonner e input-otp injetam `<style>` | `script-src 'self'` e Trusted Types continuam bloqueando script; CSS sozinho não executa código | As bibliotecas aceitarem nonce |
| Sessão em `sessionStorage`, não em cookie HttpOnly; com "manter conectado", em `localStorage` por até 30 dias (decisão da diretoria, 28/10/2026 — ADR 0017) | Site estático: sem servidor próprio para emitir cookie; uso rápido no celular | CSP, Trusted Types, sem HTML vindo do usuário; o banco recusa sessão autenticada há mais de 30 dias; "Sair" e "Sair de todos os aparelhos" apagam/revogam; sem a opção, fecha com a aba e cai após 30 min; JWT curto | Mudar para hospedagem com servidor (BFF) |
| Branch `main` sem proteção no GitHub | O plano gratuito não protege branches de repositório privado (ADR 0008) | Único desenvolvedor; o site só é publicado depois do CI verde (branch `producao`, avançada só por fast-forward pelo workflow `liberar-producao.yml`); a build do Cloudflare ainda roda os testes de unidade e o verificador | GitHub Pro, ou mais pessoas mexendo no código |
| HSTS sem *preload* | O endereço `*.pages.dev` não é nosso | HSTS de 2 anos com `includeSubDomains` | Domínio próprio |
| Recuperação de senha mostra "enviamos o link" mesmo se o envio do e-mail falhar | O envio só acontece para conta cadastrada: mostrar a falha revelaria quem tem conta | Falhas de CAPTCHA, limite por IP e rede aparecem; a falha de envio fica no log do Supabase | Nunca (é a regra "não revelar se a conta existe") |
| `postgres` (SQL Editor) pode desligar gatilhos e alterar a auditoria | É o dono do banco; não é acessível pelo app | Contas do Supabase com 2FA; backup externo da auditoria | Sempre |
| Pix estático: a baixa da mensalidade é manual | Sem provedor nem credencial bancária no sistema (custo zero, menos superfície) | `txid` aleatório por mensalidade; baixa só pela tesouraria, ligada a uma entrada real do Dinheiro, uma entrada por mensalidade | Volume de mensalidades justificar API do banco ou Stripe (`pagamentos-fase4.md`) |
| A chave Pix pode ser trocada por quem administra o financeiro | É a tesouraria quem conhece a conta | Troca registrada na auditoria; a tela avisa para conferir no app do banco | Mais de um tesoureiro com acesso |

## 8. Plano de incidente
Vale para qualquer suspeita: senha vazada, chave exposta, dado vazado, lançamento estranho, site alterado.

1. **Conter.** Desative no app a conta suspeita (Acessos → pessoa → Desativar). Se for grave, pause o projeto no Supabase ou tire o site do ar (Cloudflare → Workers & Pages → projeto → *Deployments*: volte para uma versão anterior ou apague o domínio do projeto).
2. **Revogar e rotacionar.** No Supabase, gere novas chaves (API keys) e uma nova senha do banco; atualize os secrets das Edge Functions; encerre todas as sessões (Auth → Users → Sign out). No GitHub e no Cloudflare, revogue tokens e confira quem tem acesso. Chave que vazou continua vazada: apagar o commit não resolve.
3. **Preservar evidências.** Exporte a auditoria e os logs do Supabase (Auth, API, Edge Functions) **antes** de qualquer correção. Não altere os registros.
4. **Avaliar o impacto.** Quais dados, de quem, em que período, se houve dado financeiro, de autenticação ou sensível.
5. **Comunicar.** Se houver risco ou dano relevante: ANPD e titulares em até **3 dias úteis** (6 para pequeno porte); complemento à ANPD em até 20 dias úteis. Modelo e critérios em [`lgpd.md` § 6](lgpd.md#6-incidente-de-segurança-art-48-res-152024).
6. **Corrigir com teste de regressão.** Reproduza com dados fictícios, escreva o teste que falha, faça a correção mínima, rode `npm run verificar` e só então publique.
7. **Registrar o aprendizado.** Relatório sem culpados: linha do tempo, causa, o que funcionou e o que mudou. Guarde **por no mínimo 5 anos**, mesmo que o incidente não tenha sido comunicado.

## 9. Evidências da entrega (Fase 1)

Situações: **PASS** (testado e passou), **BLOCKED_ENVIRONMENT** (não dá para testar aqui), **ACCEPTED_RISK** (decisão consciente, seção 7), **ACCEPTED_EVIDENCE_GAP** (sem teste automático; motivo registrado).

| Controle | Evidência | Situação |
|---|---|---|
| RLS ativo em todas as tabelas de `public`; sem grant para `anon` | `tests/db/advisors.test.ts` + matriz da seção 6 | PASS |
| Lista fechada de privilégios (funções e escrita direta) | `tests/db/privilegios.test.ts` | PASS |
| 2FA (`aal2`) exigido em duas camadas (RLS restritiva e RPC) | `tests/db/mutacao.test.ts` (uma camada desligada por vez) | PASS |
| IDOR e alcance "próprios" | `tests/db/acessos.test.ts`, `financeiro.test.ts` | PASS |
| Mês fechado imutável, estorno, auditoria imutável | `tests/db/financeiro.test.ts`, `mutacao.test.ts` | PASS |
| Teste de mutação: 10 controles desligados um a um, todos detectados | `tests/db/mutacao.test.ts` | PASS |
| Fuzzing das RPCs (fast-check), claims adulteradas e tipos errados | `tests/db/fuzz.test.ts` | PASS |
| Concorrência: duplo envio e idempotência | `tests/db/financeiro.test.ts`, `fuzz.test.ts` | PASS |
| Limite de uso por pessoa e operação | `tests/db/limites.test.ts` | PASS |
| Retenção LGPD | `tests/db/retencao.test.ts` | PASS |
| Uploads: tamanho, tipo real, campos, `content-length`, limpeza em falha | `supabase/functions/_shared/envio.test.ts` | PASS |
| Convite: só depois do banco autorizar; erro genérico com requestId | `supabase/functions/_shared/convite.test.ts` | PASS |
| Config recusa segredo no frontend | `src/lib/config.test.ts` | PASS |
| Build sem source map, sem modo demo, sem segredo, com CSP | `tests/unit/verificar-build.test.ts` + `npm run verificar-build` na build real | PASS |
| Trusted Types com lista fechada | `src/lib/trusted-types.test.ts` | PASS |
| Contraste WCAG nos tokens de cor | `tests/unit/contraste.test.ts` | PASS |
| Acessibilidade WCAG 2.2 AA (axe) em 17 telas × 4 contextos | Passeio Playwright + axe-core 4.14.0 | PASS (0 violações) |
| Sem erro de console nem de CSP; sem estouro horizontal | Passeio Playwright (celular claro, celular escuro, computador) | PASS |
| `npm audit` | 0 vulnerabilidades | PASS |
| Varredura de segredos no repositório | `npm run segredos` (secretlint) | PASS |
| Edge Functions rodando em Deno real | Lógica testada em Node; o runtime Deno não está disponível aqui | BLOCKED_ENVIRONMENT |
| Projeto Supabase real: migrations 0001–0011 aplicadas, Security Advisor sem nenhum aviso | Projeto `erp-associacoes` (São Paulo), 21/10/2026. O Performance Advisor mostra "Auth RLS Initialization Plan" nas políticas `exige_2fa`: falso positivo, a chamada já está dentro de `(select …)` e vira InitPlan (avaliada uma vez) | PASS |
| Sem login, com a chave publicável: tabelas, RPCs e cadastro | `fetch` direto na API em 21/10/2026: 4 tabelas e 3 RPCs com 401 `42501`; cadastro com 422 `signup_disabled`; Storage devolve lista vazia | PASS |
| Data API: schemas e exposição automática | Painel *Integrations → Data API*, 21/10/2026: expostos `public` e `graphql_public` (padrão); `private` não exposto; exposição automática de tabelas novas desligada | PASS |
| Retenção agendada no pg_cron | `cron.job` com `erp-retencao`, `17 6 * * *` (03h17 em Brasília), ativo | PASS |
| Auth real (e-mails de convite e senha, 2FA de ponta a ponta), Storage com arquivo, Edge Functions | Dependem do endereço do site (Cloudflare) e do primeiro administrador | BLOCKED_ENVIRONMENT — *smoke test* de [`deploy.md`](deploy.md) |
| CAPTCHA: chave secreta recusada no site, script só do Turnstile oficial, CSP só com o domínio dele, falha de CAPTCHA com mensagem própria | `src/lib/config.test.ts`, `src/lib/trusted-types.test.ts`, `tests/unit/verificar-build.test.ts` | PASS |
| CAPTCHA no navegador com CSP e Trusted Types reais: botão travado sem token, token chega ao Supabase, um token por tentativa, recuperação não diz "enviado" quando o CAPTCHA falha | `tests/e2e/captcha_e2e.py` (Playwright, Turnstile e Supabase imitados por interceptação de rede), rodado por `tests/e2e/rodar.sh` e pelo job `navegador` do CI | PASS |
| Widget real do Turnstile sob Trusted Types, e validação real no Supabase | O domínio do Cloudflare é bloqueado neste ambiente. Risco: se o `api.js` real usar `innerHTML`, o Trusted Types bloqueia e o login trava; por isso o `deploy.md` § 4b liga a chave pública ANTES de exigir no Supabase | BLOCKED_ENVIRONMENT — `deploy.md` § 4b e smoke test linhas 15 e 16 |
| Exportação da auditoria: só administrador com 2FA recente, período no fuso de São Paulo, filtro por pessoa, limite de uso, exportação registrada; 5 mutações detectadas | `tests/db/exportar-auditoria.test.ts`, `src/lib/auditoria.test.ts` | PASS |
| Cabeçalhos de segurança no `_headers` (CSP com `frame-ancestors`, HSTS ≥ 1 ano, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`) | `tests/unit/verificar-build.test.ts` + `npm run verificar-build` na build real | PASS |
| Cabeçalhos realmente entregues pelo Cloudflare | `https://seu-projeto.pages.dev`, 21/10/2026: CSP com `frame-ancestors 'none'` e Trusted Types, HSTS de 2 anos com subdomínios, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP; arquivo inexistente e source map dão 404; console sem erro na tela de entrada | PASS |
| Telas sob demanda recarregam uma vez se a versão mudou, sem laço | `src/lib/sob-demanda.test.ts` | PASS |
| Produção só avança para commit da `main` com CI verde, e nunca para trás | Simulação com repositório git local: commit novo avança, commit antigo é recusado | PASS |
| Workflow `liberar-producao.yml` rodando no GitHub | O repositório existe, mas o GitHub Actions está desativado na conta (chamado no suporte do GitHub) | BLOCKED_ENVIRONMENT — conferir na aba Actions quando o GitHub liberar |
| **Fase 2.** Agenda, tarefas e avisos: quem pode e quem não pode, 2FA, IDOR/alcance "próprios", transições de situação, nada se apaga, retenção | `tests/db/organizacao.test.ts` (29 testes) | PASS |
| **Fase 2.** Geradores idempotentes com concorrência real (recorrentes, modelo aplicado 2× ao mesmo tempo) | `tests/db/organizacao.test.ts` | PASS |
| **Fase 2.** Fuzzing das RPCs novas (930 entradas aleatórias) e mutação de 5 controles | `tests/db/organizacao-fuzz.test.ts` | PASS |
| **Fase 2.** Fila de e-mails: sem duplicar, sem envio duplo em paralelo, preferências, membro inativo, só service role | `tests/db/emails.test.ts` | PASS |
| **Fase 2.** Função de envio: texto puro, injeção de cabeçalho barrada, erro só como código, limite de lotes e de tempo | `supabase/functions/_shared/emails.test.ts` | PASS |
| **Fase 2.** Datas no fuso de Cidade Exemplo e arquivo .ics (escape e dobra de linha da RFC 5545) | `src/lib/agenda.test.ts` | PASS |
| **Fase 2.** Telas novas no navegador com os cabeçalhos reais: sem erro de console/CSP, sem estouro; axe WCAG 2.2 AA sem violações | `tests/e2e/rodar.sh` (agenda, tarefas, rotinas, avisos; claro, escuro, celular, computador), 22/10/2026 | PASS |
| **Fase 3.** Verbas e projetos: permissões, alcance "próprios", regras fechadas, formalização idempotente com concorrência real, recebimento só de entrada válida na conta certa, rubricas, pendências e justificativas, painel, prestação, agenda, nada se apaga | `tests/db/verbas-projetos.test.ts` (23 testes) | PASS |
| **Fase 3.** Fuzzing (730 entradas aleatórias) e mutação de 5 controles, inclusive a regressão do achado de 22/10 | `tests/db/verbas-projetos-fuzz.test.ts` | PASS |
| **Fase 4.** Pessoas e saúde: menor exige responsável, mensalidade sem duplicar (concorrência real), baixa só pela tesouraria e só com entrada válida, saúde só com módulo próprio e autorização (fail closed), revogar apaga, autorização de saúde invisível a quem só vê o cadastro, auditoria de saúde sem conteúdo, arquivos só via service role, retenção | `tests/db/pessoas-saude.test.ts` (16 testes) | PASS |
| **Fase 4.** Patrimônio (termo do menor aceito pelo responsável, um empréstimo aberto por bem com concorrência real, baixa), governança (ata congelada pelo app e direto no banco, quórum, votos ≤ presentes, upload institucional), filiações (contribuição só pela tesouraria e sem duplicar, documento ligado a certidão vencida = pendente, verba em risco), prazos na agenda (saúde nunca) | `tests/db/patrimonio-governanca-filiacoes.test.ts` (15 testes) | PASS |
| **Fase 4.** Presença em treinos: só atletas ativos, sem duplicar, só quem vê pessoas, evento futuro e cancelado recusados, frequência e prestação | `tests/db/presenca.test.ts` (4 testes) | PASS |
| **Fase 4.** Fuzzing (1.850 entradas aleatórias em 15 RPCs, com invariantes conferidas no banco) e mutação de 8 controles | `tests/db/fase4-fuzz.test.ts` | PASS |
| **Fase 4.** Lista fechada de funções e buckets (nenhuma função auxiliar exposta) | `tests/db/privilegios.test.ts`, `tests/db/arquivos.test.ts` | PASS |
| **Fase 4.** Pix: CRC16 confere com o exemplo do manual do Banco Central; qualquer alteração no código é detectada; só ASCII; o QR desenhado lê de volta o mesmo código | `src/lib/pix.test.ts`, `src/lib/qr.test.ts` | PASS |
| **Fase 4.** Envio de documento: área e bucket por lista fixa, tipo real, caminho sem `../`; limpeza só nos buckets permitidos | `supabase/functions/_shared/envio.test.ts`, `limpeza.test.ts` | PASS |
| **Fase 4.** Telas novas no navegador com os cabeçalhos reais: sem erro de console/CSP, sem estouro; axe WCAG 2.2 AA sem violações | `tests/e2e/rodar.sh` (pessoas, mensalidade com QR, ficha com saúde, patrimônio, governança, reunião, filiações; claro, escuro, celular, computador), 22/10/2026 | PASS |
| **Fase 5.** Conciliação, captação e viagens: permissões, alcance, reimportação sem duplicar, conciliação só com valor e conta certos, extrato pendente impede o fechamento, rifas (bilhetes e vendidos), recibos numerados sem buraco com concorrência real, CPF/CNPJ, viagens (delegação, acerto, encerramento), prazos na agenda | `tests/db/fase5.test.ts` (13 testes) | PASS |
| **Fase 5.** Fuzzing (cerca de 1.060 entradas aleatórias em 7 RPCs, com invariantes conferidas no banco) e mutação de 7 controles | `tests/db/fase5-fuzz.test.ts` | PASS |
| **Fase 5.** Leitor de extrato (OFX SGML/XML, Windows-1252, CSV de vários bancos) com testes por propriedade; valor por extenso; formulário declarativo | `src/lib/extrato.test.ts`, `recibo.test.ts`, `src/components/app/formulario.test.ts` | PASS |
| **Fase 5.** Telas novas no navegador com os cabeçalhos reais (conciliação, funil, rifa, recibos, contrapartidas, viagens): sem erro de console/CSP, sem estouro; axe WCAG 2.2 AA com **0 violações** (verificador corrigido, ver abaixo) | `tests/e2e/rodar.sh`, 22/10/2026 | PASS |
| **Correção de evidência (22/10).** O `rodar.sh` só reprovava o axe se a chave do resultado começasse com `axe`, mas o script gravava as violações por tela: **as linhas "axe sem violações" das Fases 1 a 4 não estavam provadas**. Ao corrigir, apareceram 3 problemas reais (contraste dos dias de outro mês na agenda, contraste do selo vermelho no modo escuro, botão dentro de linha clicável na Governança), já corrigidos. Hoje: 0 violações em todas as telas | `tests/e2e/acessibilidade.py` (saída `{"axe": …}`) | PASS (após a correção) |
| **Fase 4.** Pagamento Pix real no app de um banco | — | BLOCKED_ENVIRONMENT (sem chave real; testar no lançamento com R$ 0,01, `deploy.md` §7d) |
| **Fase 4.** Edge Functions no runtime Deno real (envio de documento e `limpar-arquivos`) | — | BLOCKED_ENVIRONMENT (testadas em Node com os mesmos módulos; conferir no lançamento) |
| **Fase 3.** Relatórios de prestação: CPF mascarado, fórmula neutralizada, nome de arquivo seguro | `src/lib/prestacao.test.ts` | PASS |
| **Fase 3.** Telas no navegador com os cabeçalhos reais (verbas, cadastros, detalhe, projetos, detalhe): sem erro, sem estouro, axe sem violações | `tests/e2e/rodar.sh`, 22/10/2026 | PASS |
| **Fase 3.** PDF de prestação aberto e conferido por um contador | Depende de dados reais | ACCEPTED_EVIDENCE_GAP — conferir no primeiro projeto real |
| **Fases 2 e 3.** Migrations 0012, 0013 e 0014 no Supabase real; envio SMTP real pela Edge Function em Deno | Ficam para o lançamento ([`deploy.md`](deploy.md) § 7) | BLOCKED_ENVIRONMENT |
| `style-src 'unsafe-inline'`, sessionStorage, `main` sem proteção, HSTS sem preload | Seção 7 | ACCEPTED_RISK |
| Remoção do EXIF das fotos | Depende de canvas no navegador | ACCEPTED_EVIDENCE_GAP |
| Rotas da tela | São só experiência; o controle real está no banco (matriz da seção 6) | Não aplicável como controle |

## 9b. Revisão independente (21/10/2026)
Um revisor que não acompanhou o desenvolvimento revisou os commits `8d54e05` e `e79acda`. Cada achado foi tratado:

| # | Achado | Severidade | O que foi feito | Teste |
|---|---|---|---|---|
| 1 | A recuperação de senha revelaria se a conta existe (limite de 1 e-mail por minuto, só para conta cadastrada) | Média (suspeita) | O limite por e-mail fica escondido, com a mesma resposta de sucesso | `config.test.ts` (recuperação não revela a conta) |
| 2 | Teste do CAPTCHA no navegador não estava no repositório; o Turnstile real sob Trusted Types não foi testado | Média | Testes de navegador versionados em `tests/e2e/` e no CI; ordem de ativação segura no `deploy.md` § 4b | `tests/e2e/rodar.sh`; widget real = BLOCKED_ENVIRONMENT |
| 3 | Exportação grande: tempo limite de 20 s e PDF de 20 mil linhas travando o celular | Média-baixa | Tempo limite de 60 s só para essa chamada; PDF até 2.000 registros, acima disso sai CSV | `auditoria.test.ts`, `tests/e2e/exportar_e2e.py` |
| 4 | Trusted Types aceitava parâmetro repetido na URL do Turnstile | Baixa | Parâmetros repetidos recusados | `trusted-types.test.ts` |
| 5 | A recuperação esconde falha de envio | Baixa | Mantido de propósito (risco aceito, seção 7) | `config.test.ts` |
| 6 | Lacunas: truncamento, fronteira de período, `<meta>` igual ao cabeçalho, curingas, `trusted-types default`, chave do CAPTCHA validada na build | Baixa | Tudo coberto; período corrigido para até 366 dias contados (migration 0011) | `exportar-auditoria.test.ts`, `verificar-build.test.ts` |
| 7 | Import tardio da compressão de foto sem a recarga segura; Cloudflare devolveria a página do sistema (status 200, cache de 1 ano) para arquivo inexistente | Baixa | Recarga única também ali, com erro "sem conexão" no lugar de "tipo não aceito"; `404.html` desliga o fallback de SPA | `verificar-build.test.ts` (exige `404.html`) |
| 8 | O filtro por pessoa deixava de fora convites e reembolsos sobre ela | Baixa | Inclui colunas de pessoa (solicitante, usado_por etc.) e o e-mail (migration 0011) | `exportar-auditoria.test.ts` |

## 9c. Correções e importações (27/10/2026)
- Arquivos (foto, planilha, PDF) lidos **no aparelho**; ao servidor vão só os dados, validados de novo (`so_chaves`, formatos, tipo da categoria, conta ativa, mês fechado, data do saldo inicial).
- `importar_lancamentos` e `lancar_do_extrato`: tudo ou nada, idempotentes, `financeiro/administrar` (lote) e `financeiro/editar`+`criar` com alcance total (extrato); limites de uso por hora.
- RLS: `plano_contas` (quem vê o financeiro), `importacoes` e `balancete_linhas` (só quem vê o financeiro inteiro); sem apagar; auditoria.
- OCR: `/ocr/*` com CSP própria; Trusted Types aceita só `/ocr/worker.min.js` do mesmo site (achado da auditoria: `blob:` do mesmo site passava — corrigido com teste de regressão).
- Evidências: `tests/db/importacoes.test.ts` (negativos, fuzz e 4 mutações), `src/lib/importar.test.ts`, `src/lib/ocr.test.ts`, `tests/e2e/ocr_e2e.py`, `tests/e2e/importar_e2e.py`.
- Lacuna registrada (ACCEPTED_EVIDENCE_GAP): o npm local (10.9) ignora `min-release-age`; as datas das versões novas foram conferidas à mão e as transitivas recentes foram fixadas por `overrides`.

## 9d. Fase 6 — Previsão e análises (27/10/2026)
- `dados_analise`: só leitura, `financeiro/ver` com alcance total, 2FA (política restritiva) e limite de 120/h; mensalidades só em números; sem autor dos lançamentos; tarefas por diretor só com `tarefas/ver`.
- Cálculos no aparelho, em funções puras; cenários não gravam nada.
- Gráficos sem injeção de HTML (o Trusted Types barrou o `ChartContainer` do shadcn no teste de navegador — trocado por recharts direto).
- Evidências: `tests/db/analises.test.ts` (inclui mutação da checagem de alcance), `src/lib/analises.test.ts` (propriedade: o fluxo soma exatamente o saldo final), `tests/e2e/analises_e2e.py`, axe nas 4 abas.

## 9e. Fase 7 — Transparência (27/10/2026)
- Primeira superfície pública: **uma** função para `anon`, sem parâmetros, só lê fotografias publicadas e agregadas. Nenhuma tabela aberta (`anon` recebe `permission denied` em todas).
- Publicar: `financeiro/aprovar` + 2FA recente; retirar com motivo, sem apagar; auditoria em tudo; limites de uso.
- Fotografia sem descrição de lançamento, sem pessoa física, sem saúde, sem autor.
- Evidências: `tests/db/transparencia.test.ts` (anon negado em tabelas e funções, fotografia congelada, retirar, fuzz, mutação do 2FA), `advisors`/`privilegios` (anon executa só `transparencia_publica`), `tests/e2e/transparencia_e2e.py` (sem login, publicar, retirar, PDF), axe na pública e na gestão.

## 9f. Orçamento, mensalidade em um passo e busca (27/10/2026)
- `salvar_orcamento`: `financeiro/administrar`, ano na janela atual ±1, tudo ou nada; `orcamento_ano`: alcance total; `receber_mensalidade`: `financeiro/editar` + `criar`, idempotente pelo id, valida como qualquer lançamento, descrição sem nome da pessoa.
- `busca_global`: `security invoker` (RLS de quem busca), termo 2–60 sem caracteres de controle, curingas escapados, sem saúde; `anon` sem acesso.
- Evidências: `tests/db/orcamento.test.ts` (negativos, fuzz, mutação do alcance), `tests/db/busca.test.ts` (alcance próprios, curingas, anon, sem 2FA), `tests/e2e/orcamento_e2e.py`, `tests/e2e/tutorial_e2e.py`.

## 9g. Pedido de acesso, foto e ficha do atleta, projeto próprio, permissões em lote (28/10/2026)
- `pedir-acesso` (Edge Function pública): método, tamanho (8 KB), campos permitidos, IP obrigatório, Turnstile validado no servidor com hostname e action conferidos, provedor fora do ar = 503 (nega); banco grava só pela service role, 3/h por IP (HMAC, chave derivada por HKDF), fila de no máximo 50, resposta igual para novo/repetido/membro, sem e-mail. `decidir_pedido_acesso`: administrador + 2FA recente; aprovar exige convite feito depois do pedido; `ip_hash` some na decisão e não é legível pelo cliente (grant por coluna).
- Foto 3x4: autorização de imagem conferida em `autorizar_documento` **e** em `registrar_documento`; só imagem; leitura só da foto atual (política no Storage); gatilhos tiram a foto ao revogar a autorização ou desligar.
- `salvar_ficha_atleta`: lista fixa de campos, tipos estritos (camisa só número 0–99), sem saúde; pessoa desligada recusada. `criar_projeto`: `projetos/criar`, mesmas validações de datas e valores; toque duplo não duplica; outro autor não reusa o id.
- Permissões em lote e perfis prontos são só na tela; o servidor valida ao salvar; saúde nunca entra em lote.
- Demonstração no claude.ai: aviso quando a moldura não libera câmera/arquivos e "cupom de exemplo"; o trecho não existe na build real (conferido no bundle).
- Evidências: `tests/db/pedidos-acesso.test.ts`, `tests/db/atleta-foto.test.ts`, `tests/db/projeto-proprio.test.ts` (negativos e fuzz), mutação "foto só com autorização de imagem" (`mutacao.test.ts`), `supabase/functions/_shared/pedido.test.ts` e `envio.test.ts`, `tests/e2e/cadastros_e2e.py`, `captcha_e2e.py` (token com action, sem sessão) e axe na tela de pedido.
- **Lacuna aceita (BLOCKED_ENVIRONMENT):** os `index.ts` das Edge Functions (Deno) não rodam aqui; a lógica testada é a de `_shared/`. A chamada real ao Turnstile só é testável no lançamento (passo 7j.4).

## 9h. Uso rápido no celular e modelos de permissão (28/10/2026)
- **Decisão da diretoria (ACCEPTED_RISK, ADR 0017):** "manter conectado neste aparelho por 30 dias" guarda a sessão no navegador (exceção consciente à regra "token fora do localStorage"); ações sensíveis não pedem de novo o código (`totp_recente()` sempre verdadeiro). A segunda etapa continua obrigatória no login (aal2 em todas as tabelas e funções).
- Servidor: `sessao_erro()` recusa (`sessao_expirada`) sessão cuja última autenticação tem mais de 30 dias ou não tem data conferível (fail closed) — vale para RPCs e para a RLS.
- `modelos_permissao`: só administrador lê e grava; permissões validadas como no convite; nome e cargo sem repetir; modelo com cargo substitui o padrão de fábrica (`permissoes_modelo_padrao`), apagar volta ao de fábrica. Quem já tem acesso não muda sozinho.
- Pedido de acesso reduzido a nome e e-mail (0030 ainda não aplicada em lugar nenhum: corrigida no próprio arquivo).
- Evidências: `acessos.test.ts` (30 dias, sem reconfirmação), `modelos-permissao.test.ts` (negativos, convite usando o modelo, fuzz), mutação "sessão com mais de 30 dias" (`mutacao.test.ts`), `manter-conectado.test.ts`, `cadastros_e2e.py`.

## 10. Pendências de segurança (em ordem)
1. Smoke test no projeto Supabase real ([`deploy.md`](deploy.md)), incluindo os logs sem dado pessoal.
2. Ligar o CAPTCHA: criar o widget no Cloudflare e colocar as chaves ([`deploy.md`](deploy.md) § 4b). O código já está pronto.
3. Rotina mensal: exportar a auditoria (CSV) e guardar fora do Supabase.
