# LGPD — Sistema de Gestão Integrada da Associação Exemplo

> Orientação técnica baseada na Lei 13.709/2018 e nas Resoluções CD/ANPD 2/2022, 15/2024, 18/2024 e 19/2024.
> **Não é parecer jurídico.** As decisões marcadas com ⚖️ devem ser confirmadas com um advogado e com o contador da Associação Exemplo antes de colocar o sistema em uso.

Escopo deste documento: Fases 1 a 5 (financeiro, acessos, documentos, organização, verbas e projetos, **pessoas e atletas, saúde, patrimônio, governança e filiações**, conciliação, captação e viagens). Os dados de atletas, inclusive de saúde e de menores, entram na Fase 4 (seções 2 e 9).

---

## 1. Quem é quem

| Papel | Quem |
|---|---|
| Controladora | Associação Exemplo (pessoa jurídica de direito privado, sem fins lucrativos) |
| Operadores | Supabase (banco, autenticação, arquivos e funções), Cloudflare (entrega o site e, com o CAPTCHA ligado, analisa sinais do navegador no login; vê IP e endereço acessado) e GitHub (guarda só o código; sem dados pessoais) |
| Encarregado ou canal de contato | Canal da Associação Exemplo: contato@exemplo.org · (11) 90000-0000 (publicado na tela Privacidade). Nome do encarregado, se houver, ainda a definir ⚖️ |
| Porte | Provável agente de pequeno porte (Res. 2/2022 inclui entidades sem fins lucrativos), **desde que o tratamento não seja de alto risco** ⚖️ |

Agente de pequeno porte pode dispensar o encarregado, mas precisa manter um canal de comunicação com os titulares e com a ANPD, e os prazos ficam em dobro. Isso deixa de valer se o tratamento for de alto risco. Alto risco exige ao menos um critério geral (larga escala ou efeito significativo nos direitos) **e** um específico (dados sensíveis, de crianças, adolescentes ou idosos, decisões automatizadas etc.). A Fase 1 provavelmente não se enquadra. **As fases com dados de atletas (saúde, deficiência, menores) podem se enquadrar** ⚖️.

## 2. Inventário de dados pessoais (Fase 1)

| Dado | Onde fica | Finalidade | Base legal (art. 7º / 11) ⚖️ | Quem acessa | Retenção |
|---|---|---|---|---|---|
| Nome, e-mail e cargo de quem usa o sistema | `public.membros`, Supabase Auth | Controle de acesso e responsabilidade por cada ação | V (relação associativa, estatuto) e IX (segurança, prevenção a fraude) | Administradores (acessos) e a própria pessoa | Enquanto for membro; depois, **bloqueio** (conta desativada), com guarda junto dos registros contábeis |
| Senha (hash), segredo do 2FA e IP de login | Supabase Auth (fora das tabelas do sistema) | Autenticação | IX | Ninguém da Associação Exemplo lê; só o Supabase | Até a conta ser removida |
| Convite (nome, e-mail, cargo) | `public.convites` | Chamar uma nova pessoa da diretoria | V | Administradores | **Apagado 90 dias depois de expirar ou de ser cancelado, se nunca foi aceito** (rotina `private.aplicar_retencao`) |
| Notificações | `public.notificacoes` | Avisar a pessoa sobre mudanças de acesso | V | A própria pessoa | **Apagadas 180 dias depois de lidas** |
| Fornecedores e pagadores pessoa física (nome, CPF) | `public.contrapartes` | Escrituração e prestação de contas | II (obrigação legal e regulatória) | Quem tem permissão no financeiro | Guarda contábil e fiscal ⚖️ |
| Texto livre (descrição, motivo, campos extras) | `public.lancamentos`, `public.reembolsos` | Explicar cada movimentação | II | Financeiro, conforme a permissão | Guarda contábil e fiscal ⚖️ |
| Comprovantes (notas, recibos, cupons — podem conter CPF, endereço e, num recibo de farmácia ou clínica, **dado de saúde**) | Storage privado `comprovantes` | Comprovar a despesa | II; para dado sensível, art. 11, II, "a" | Quem pode ver o lançamento (URL assinada de 60 s) | Guarda contábil e fiscal ⚖️ |
| Arquivos do contador (balancetes, folha) | Storage privado `contador` | Prestação de contas | II | Quem tem permissão "contador" | Guarda contábil e fiscal ⚖️ |
| Trilha de auditoria (quem fez o quê, com cópia do antes e do depois) | `public.auditoria` (imutável) | Prova e segurança | II e VI (exercício regular de direitos) | Administradores | Mesma guarda dos registros contábeis; a remoção após o prazo será uma rotina controlada (pendente, seção 8) |
| Contador de limite de uso (operação + id da pessoa) | `private.limites` | Evitar abuso | IX | Ninguém pelo app | Apagado 1 dia depois |
| Rascunhos sem internet (pode haver foto de comprovante) | IndexedDB do aparelho | Não perder o lançamento sem sinal | V | A própria pessoa, naquele aparelho | Apagados quando o lançamento é enviado ou quando a pessoa clica em **Sair** |
| **Fase 2.** Eventos da agenda (título, local, observações, participantes) | `public.eventos`, `public.evento_participantes` | Organizar a diretoria | V | Quem tem `agenda/ver` | Ficam (histórico de atividades e prestação de contas); cancelados não somem |
| **Fase 2.** Tarefas, checklist e comentários (texto livre, responsável) | `public.tarefas`, `tarefa_itens`, `tarefa_comentarios` | Organizar a diretoria | V | Quem tem `tarefas/ver` (alcance "próprios" vê só as suas) | **Concluídas ou canceladas: apagadas 5 anos depois** |
| **Fase 2.** Avisos e quem leu | `public.avisos`, `public.aviso_leituras` | Comunicação interna com confirmação | V | Avisos: `avisos/ver`; quem leu: autor e administradores | **Apagados 2 anos depois de arquivados ou vencidos** |
| **Fase 2.** Fila de e-mails (id da pessoa, assunto, texto do lembrete) | `private.fila_emails` (não exposta) | Lembretes e resumo semanal | V | Ninguém pelo app; só a função de envio | **Enviados: apagados em 30 dias; não enviados: em 7 dias** |
| **Fase 2.** Preferências de e-mail | `public.preferencias_email` | Respeitar quem não quer receber | V | A própria pessoa | Enquanto for membro |
| **Fase 3.** Origens de verba (nome; contato institucional) | `public.origens_verba` | Controlar de onde vêm os recursos | V e II (prestação de contas) | `verbas/ver` | Guarda contábil e fiscal ⚖️ (ou o prazo da regra da verba, até 10 anos para termo de fomento) |
| **Fase 3.** Verbas, parcelas, documentos, rubricas e justificativas | `public.verbas`, `verba_parcelas`, `verba_documentos`, `projeto_rubricas`, `lancamento_rubricas`, `lancamento_justificativas` | Prestação de contas de recursos | II | Verbas/projetos, conforme a permissão | Prazo de guarda da verba (`guarda_anos`) |
| **Fase 3.** Relatórios de prestação (PDF/CSV) | Aparelho de quem gera | Enviar ao concedente | II | Quem gera | Fora do sistema: guardar com os documentos do projeto; CPF de pessoa física sai mascarado |
| **Fase 4.** Cadastro de atletas e associados: nome, vínculo, categoria, situação, nascimento, telefone, e-mail, observação | `public.pessoas` | Gestão associativa, mensalidades, inscrição em competições | V (relação associativa, estatuto) ⚖️ | `pessoas/ver` | Enquanto ativo; **desligado: contatos e nascimento apagados 5 anos depois** (rotina); o nome fica com as mensalidades |
| **Fase 4.** Responsável legal de menor (nome, contato, parentesco) | `public.pessoas` | Autorizações e contato (art. 14) | V e art. 14 | `pessoas/ver` | Igual ao cadastro |
| **Fase 4.** Mensalidades (valor, vencimento, situação, identificador Pix) | `public.mensalidades` | Cobrança e prestação de contas | V e II | `pessoas/ver` e quem vê o financeiro | Guarda contábil ⚖️ |
| **Fase 4.** Documentos do atleta (registro na federação, autorização de imagem, termo de equipamento) e arquivos | `public.documentos_pessoa`, Storage `pessoas` | Exigências de federação e da Associação Exemplo | V; imagem: I (consentimento) | `pessoas/ver` (URL assinada de 60 s) | Arquivo trocado vai para a fila de remoção; demais ⚖️ com o cadastro |
| **Fase 4.** Autorizações (finalidade, base legal, quem autorizou e quando, revogação) | `public.consentimentos` | Provar a base legal (art. 8º, §2º) | II | Imagem: `pessoas/ver`; **saúde: só `saude/ver`** | Enquanto houver o tratamento e depois, pela guarda da auditoria (prova) |
| **Fase 4. Dado sensível:** deficiência, classe funcional, observações de saúde | `public.pessoa_saude` | Classificação funcional e segurança no treino | art. 11, I (consentimento específico) ou II, "a"/"d" (exigência da entidade esportiva) ⚖️ | **Só quem tem o módulo `saude`** (ninguém por padrão) | **Apagado ao revogar o consentimento; desligado: apagado 1 ano depois** |
| **Fase 4. Dado sensível:** laudos, atestados e classificação (arquivos) | `public.documentos_saude`, Storage `saude` | Idem | Idem ⚖️ | Só `saude/ver` (URL assinada de 60 s) | Idem; arquivos removidos pela função `limpar-arquivos` |
| **Fase 4.** Presença em treinos e jogos | `public.evento_presencas` | Acompanhar a equipe; comprovar atividades de projetos | V e II (prestação de contas) | Quem vê agenda **e** pessoas | Junto com o evento; na prestação de contas sai **só o número** de presentes |
| **Fase 4.** Empréstimos de bens (atleta, termo aceito por quem e quando) | `public.emprestimos` | Responsabilidade sobre o patrimônio | V e VI | `patrimonio/ver` | Junto com o bem ⚖️ |
| **Fase 4.** Mandatos, presença em reuniões e assembleias, atas | `public.mandatos`, `reuniao_presencas`, `reunioes` | Governança e registro em cartório | II (estatuto, Código Civil) | `documentos/ver` | Permanente (histórico institucional) ⚖️ |
| **Fase 4.** Chave Pix da Associação Exemplo | `public.configuracoes` | Gerar a cobrança | — (dado da pessoa jurídica) | Membros | Até ser trocada (troca auditada) |
| **Fase 4.** Auditoria de saúde | `public.auditoria` | Saber quem mexeu | IX | Administradores | **Guarda só o nome dos campos alterados, nunca o conteúdo** |
| **Fase 5.** Linhas do extrato bancário (data, valor, descrição — a descrição traz nomes de quem pagou ou recebeu) | `public.extrato_linhas` | Conferir o caixa com o banco | II (escrituração) | Financeiro com alcance "tudo" | Guarda contábil ⚖️; o arquivo do banco não é guardado (lido só no aparelho) |
| **Fase 5.** Funil de captação: nome da empresa ou apoiador, contato de trabalho, histórico de conversas | `public.oportunidades`, `oportunidade_interacoes` | Captação de recursos | IX (legítimo interesse) ⚖️ | `captacao/ver` | ⚖️ a definir (sugestão: 2 anos depois de "perdido") |
| **Fase 5.** Doador no recibo: nome e CPF/CNPJ | `public.recibos` | Recibo de doação (abatimento no IR e prestação de contas) | II | Tesouraria (financeiro "tudo") e `captacao/editar` | Guarda contábil e fiscal ⚖️ |
| **Fase 5.** Vendedores de rifa (nome, bilhetes, valor entregue) | `public.acao_vendedores` | Prestação de contas da ação | V e II | `captacao/ver` | Guarda contábil ⚖️ |
| **Fase 5.** Delegação da viagem (nome, função, quarto) | `public.viagem_delegacao` | Logística e prestação de contas | V e II | `viagens/ver` (escolher atleta exige `pessoas/ver`) | Junto com a viagem; acessibilidade só no total da viagem, nunca por pessoa |
| Sessão (token) | `sessionStorage` do navegador | Manter a pessoa conectada | V | O navegador | Fecha com a aba; logout após 30 min sem uso |

**Prazo de guarda contábil e fiscal ⚖️:** o prazo tributário costuma ser de 5 anos a contar do exercício seguinte (CTN, art. 173), mas convênios, leis de incentivo ao esporte e editais podem exigir mais. Defina o prazo com o contador e registre-o aqui.

**Contas bancárias** (`public.contas_bancarias`) são da associação (pessoa jurídica) e, em regra, não são dado pessoal. Se algum dia for cadastrada uma conta de pessoa física (ex.: caixinha na conta de um diretor), ela passa a ser dado pessoal financeiro.

**Regra das Fases 2 e 4:** agenda, tarefas, comentários, avisos e observações do cadastro não são lugar para dado de saúde, laudo ou documento de atleta. As telas lembram isso. Saúde só na área própria (seção 9).

### O que o sistema não coleta na Fase 1
Não há dados de atletas, de saúde ou de deficiência, de menores de idade, biometria nem localização. As fotos de comprovantes são regravadas em JPEG no aparelho **sem os metadados EXIF** (que podem trazer GPS), antes de sair do celular.

## 3. Coleta mínima — regras para quem usa o sistema
1. **Nunca escreva dado de saúde, deficiência ou classificação funcional de atleta** nos campos de descrição ou motivo. Use termos genéricos ("material esportivo", "reembolso de transporte").
2. Comprovante de farmácia ou clínica: anexe só o necessário para a prestação de contas.
3. CPF de fornecedor só quando a nota ou o recibo exigir.
4. Não use o sistema para guardar documentos pessoais (RG, laudos, atestados) — eles terão módulo próprio, com regras próprias (seção 9).
5. **Importações (planilhas antigas, extratos, balancete):** o arquivo é lido no aparelho e não é enviado; vão ao servidor só data, valor, descrição e categoria. Antes de importar uma planilha antiga, **apague colunas com CPF, telefone ou dado de saúde** e revise descrições com nome de atleta. A foto do comprovante é lida no próprio celular (não vai a serviço de terceiros).
6. **Análises (Fase 6):** mensalidades em atraso aparecem só como números e faixas, sem nomes; para lembrar alguém, use a tela de Pessoas, sempre com um lembrete gentil. O modelo de "quem tende a atrasar" do Dossiê ficou de fora de propósito (poucos dados e risco de expor pessoas).
7. **Transparência (Fase 7):** antes de publicar, confira os **nomes das categorias** na prévia: eles vão ao ar. Doações de pessoas físicas aparecem só no total da categoria, nunca com nome. A política de privacidade (rascunho 0.4) passou a citar a página pública.

## 4. Segurança (art. 46) — o que já existe
- HTTPS em todo o caminho; banco e arquivos do Supabase cifrados em repouso.
- Login com senha e **2FA obrigatório para todos** (TOTP, `aal2` exigido pelo banco em toda tabela).
- Permissões por pessoa, por módulo e por ação, decididas **no banco** (RLS e funções), nunca na tela.
- Arquivos em buckets privados, entregues por URL assinada de 60 segundos.
- Trilha de auditoria imutável; limite de uso por pessoa e por operação.
- Erros devolvem só um código e um `requestId`; os logs das funções não registram e-mail, nome, CPF nem conteúdo de arquivo.
- Logout após 30 minutos sem uso; a troca de senha encerra as outras sessões.
- Evidências e riscos aceitos: [`docs/seguranca.md`](seguranca.md).

## 5. Direitos do titular (art. 18) e como atender

| Pedido | Como fazer no sistema | Prazo |
|---|---|---|
| Confirmar se há dados / acesso simplificado | Administrador abre **Acessos → pessoa**; a própria pessoa vê seus dados em **Mais → Ajustes** | Imediato |
| Declaração completa | **Acessos → Auditoria → Exportar**, escolhendo a pessoa (sai o que ela fez e o que fizeram sobre ela). Para os dados de cadastro e os lançamentos, use também a consulta abaixo no SQL Editor | Até 15 dias (30 para pequeno porte) |
| Correção | **Acessos → pessoa → Editar** (fica registrado na auditoria) | Assim que verificado |
| Eliminação | **Desativar** a pessoa. Os registros contábeis ficam **bloqueados**, não apagados, por obrigação legal; responda informando o motivo e o prazo | Até 15 dias |
| Portabilidade | Exportação CSV | Até 15 dias |
| Informação sobre compartilhamento | Responder: operadores Supabase e Cloudflare (seção 7); o contador da Associação Exemplo | Até 15 dias |

Consulta complementar para a declaração completa (troque o e-mail; rode no SQL Editor, que usa o papel `postgres`):

```sql
with p as (select id from public.membros where email = lower('pessoa@exemplo.org'))
select 'cadastro' as origem, to_jsonb(m) as dados from public.membros m where m.id = (select id from p)
union all
select 'permissao', to_jsonb(x) from public.permissoes x where x.membro_id = (select id from p)
union all
select 'lancamento_criado', jsonb_build_object('id', l.id, 'data', l.data, 'valor', l.valor, 'descricao', l.descricao)
  from public.lancamentos l where l.criado_por = (select id from p)
union all
select 'reembolso', to_jsonb(r) from public.reembolsos r where r.solicitante = (select id from p)
union all
select 'auditoria', jsonb_build_object('em', a.em, 'acao', a.acao, 'tabela', a.tabela, 'registro', a.registro_id)
  from public.auditoria a where a.membro_id = (select id from p);
```

**Regras para atender:**
- **Verifique a identidade antes** de entregar ou apagar qualquer coisa: o pedido tem de vir do e-mail cadastrado e ser confirmado por outro canal (telefone ou pessoalmente).
- Registre cada pedido (data, tipo, situação, resposta) **sem copiar o dado pessoal no registro**.
- Modelo de resposta:

> Olá, [nome]. Recebemos em [data] seu pedido de [acesso / correção / eliminação] dos seus dados pessoais no sistema de gestão da Associação Exemplo. [Segue em anexo a cópia dos seus dados / A correção foi feita em [data] / Sua conta foi desativada em [data].] Os registros financeiros em que você aparece (lançamentos, comprovantes e auditoria) precisam ser guardados por [prazo] por obrigação legal (art. 16, I, da LGPD) e ficam bloqueados nesse período, sem uso para outra finalidade. Dúvidas: contato@exemplo.org. — Diretoria da Associação Exemplo

## 6. Incidente de segurança (art. 48; Res. 15/2024)
O passo a passo técnico está em [`docs/seguranca.md` § Plano de incidente](seguranca.md#plano-de-incidente). Para a LGPD:
- **Comunique à ANPD e aos titulares em até 3 dias úteis** (6 se for pequeno porte) quando houver risco ou dano relevante. Na Fase 1, o critério mais provável é **dado financeiro** ou **dado de autenticação**. Envio complementar à ANPD em até 20 dias úteis.
- Aos titulares: linguagem simples, dizendo quais dados foram afetados, quais são os riscos, o que já foi feito, o que a pessoa pode fazer (ex.: trocar a senha, refazer o 2FA) e o canal de contato.
- **Registre todo incidente, comunicado ou não, por no mínimo 5 anos.**

## 7. Transferência internacional (art. 33; Res. 19/2024) ⚖️
- **Crie o projeto Supabase na região São Paulo (`sa-east-1`)**: assim banco e arquivos ficam no Brasil.
- Mesmo assim, o Supabase é uma empresa estrangeira e tem subprocessadores fora do país (ex.: envio de e-mail, logs). Verifique o DPA do Supabase e se ele adota cláusulas-padrão compatíveis com a Res. 19/2024. Registre a conclusão aqui.
- O Cloudflare Pages entrega os arquivos do site e registra IP e endereço acessado nos logs de borda (dado pessoal de navegação, empresa estrangeira: conferir o DPA do Cloudflare). O GitHub guarda só o código. O navegador de quem usa fala direto com o Supabase.

## 8. Retenção — como é aplicada
- `private.aplicar_retencao()` (migration 0009, ampliada na 0012 e na 0015) apaga convites vencidos (90 dias), notificações lidas (180 dias), contadores de limite (1 dia), avisos arquivados ou vencidos há 2 anos e tarefas concluídas ou canceladas há 5 anos. Na Fase 4: **saúde de pessoa desligada há mais de 1 ano** é apagada (arquivos na fila de remoção) e **contatos, nascimento e responsável de desligado há mais de 5 anos** são apagados ⚖️. A fila de e-mails se limpa sozinha (0013). Registra na auditoria **só as contagens**. Testada em `tests/db/retencao.test.ts`.
- Agendamento diário com `pg_cron`: veja [`docs/deploy.md`](deploy.md).
- **Pendente (registrado):**
  - remoção dos registros contábeis e da auditoria após o prazo legal — exige uma exceção controlada à imutabilidade, a ser desenhada com o contador quando o primeiro prazo vencer;
  - a auditoria guarda cópias de convites e cadastros (inclusive e-mails), que seguem a guarda da auditoria, não a de 90 dias.

## 9. Dados de atletas (Fase 4) — como foi feito
1. ✅ Tabelas **separadas** do financeiro; saúde em tabelas e bucket próprios, com o módulo `saude`, que **não está em nenhum perfil padrão** (nem do presidente): o administrador libera só para quem cuida (comissão técnica, classificador).
2. ✅ Sem autorização registrada o banco **recusa** gravar saúde (fail closed). A autorização guarda finalidade, base legal, quem autorizou (titular ou responsável) e a data. Menor de idade: só o responsável autoriza (art. 14).
3. ✅ Revogar uma autorização com base no consentimento **apaga** os dados e os arquivos de saúde (fila de remoção). Revogar é um toque, tão fácil quanto registrar.
4. ✅ Laudos em bucket privado (`saude`), URL assinada de 60 s, fotos regravadas no aparelho **sem EXIF/GPS**. A criptografia em repouso é a do Supabase (disco); não há cifra por coluna ⚖️ (avaliar no RIPD).
5. ✅ Saúde nunca aparece em agenda, avisos, e-mails, Início nem na prestação de contas; a auditoria registra só quais campos mudaram.
6. ⚖️ **Avaliar alto risco (Res. 2/2022):** há dado sensível e de adolescentes; se houver também larga escala ou efeito significativo, a Associação Exemplo perde as flexibilizações de pequeno porte e precisa de **encarregado** e de **RIPD** (relatório de impacto). Decisão da diretoria com advogado **antes** de cadastrar o primeiro dado de saúde real.
7. ⚖️ Confirmar qual base vale para cada documento: consentimento específico (art. 11, I) ou exigência da federação/confederação para competir (art. 11, II, "a" ou "d"). O sistema guarda a base escolhida.
8. ⏳ Política de privacidade e termo de consentimento por finalidade (sem caixa pré-marcada): revisar o texto em `src/telas/privacidade/texto.ts` com o advogado, incluindo atletas, responsáveis, saúde, imagem e Pix.

9. ✅ **Foto 3x4** (opcional): só com autorização de imagem; finalidade = identificar o atleta no cadastro. Revogou ou desligou: apagada. Sem EXIF/GPS.
10. ✅ **Ficha do atleta**: só dados esportivos e um contato de emergência (apagado no desligamento); nenhum dado de saúde.
11. ✅ **Pedido de acesso**: só nome e e-mail de quem pede; IP só como HMAC e só enquanto pendente; decididos somem em 90 dias, esquecidos em 60. Base legal: procedimentos preliminares a pedido do titular / legítimo interesse ⚖️ (confirmar com o advogado).

## 10. Checklist

| # | Item | Situação |
|---|---|---|
| 1 | Inventário com finalidade, base, local, acesso e retenção | ✅ seção 2 (bases e prazos ⚖️ a confirmar) |
| 2 | Dados sensíveis e de crianças tratados à parte | ✅ Fase 4: tabelas, bucket e módulo próprios; fail closed (seção 9); ⚖️ alto risco/RIPD a decidir |
| 3 | Coleta mínima | ✅ seção 3; EXIF removido das fotos |
| 4 | Consentimento | ✅ Fase 4: registro por finalidade, responsável para menor, revogação que apaga; ⚖️ texto do termo |
| 5 | Direitos do titular com verificação de identidade | ✅ seção 5 (procedimento manual) |
| 6 | Segurança (art. 46) | ✅ seção 4 e `seguranca.md` |
| 7 | Encarregado ou canal publicado | ✅ canal publicado (e-mail e telefone da Associação Exemplo, `Associação Exemplo` em `src/telas/privacidade/texto.ts`); nome do encarregado, se houver, ⏳ diretoria |
| 8 | Plano de incidente (3 dias úteis) | ✅ seção 6 e `seguranca.md` |
| 9 | Retenção por rotina | ✅ parcial (seção 8, inclui saúde e contatos de desligados); ⚖️ prazos a confirmar |
| 10 | Política de privacidade | ✅ rascunho em `docs/politica-privacidade.md` e na tela pública **Privacidade** (link na entrada e em Ajustes); ⏳ revisão de advogado e prazo de guarda |
| 11 | Testes negativos | ver abaixo |

### Testes negativos (evidência)
| Teste | Resultado | Onde |
|---|---|---|
| Uma pessoa nunca lê dados de outra sem permissão (IDOR, alcance "próprios") | PASS | `tests/db/acessos.test.ts`, `financeiro.test.ts`, `mutacao.test.ts` |
| Sem 2FA (`aal1`) nada é lido, mesmo com permissão | PASS | `tests/db/mutacao.test.ts` (teste por camadas) |
| Rotina de retenção apaga o vencido e não toca no que está no prazo | PASS | `tests/db/retencao.test.ts` |
| Registro da retenção sem e-mail nem nome | PASS | `tests/db/retencao.test.ts` |
| Cliente (anon, logado ou service role) não executa a retenção | PASS | `tests/db/retencao.test.ts` |
| Erros das funções sem dado pessoal nem detalhe interno | PASS | `supabase/functions/_shared/*.test.ts` |
| Fotos sem EXIF antes do envio | ACCEPTED_EVIDENCE_GAP | `src/lib/comprovante.ts` regrava a foto pelo canvas com `preserveExif: false`; não há teste automático porque os testes de unidade rodam em Node, sem canvas. Conferir no primeiro uso real com uma foto que tenha GPS |
| Exportação da auditoria por pessoa: só administrador com 2FA recente, registrada na trilha | PASS | `tests/db/exportar-auditoria.test.ts` |
| Rascunhos de uma pessoa invisíveis para outra conta no mesmo aparelho | PASS | `src/lib/comprovante.test.ts` |
| Pedido de titular sem verificação é recusado | ACCEPTED_EVIDENCE_GAP | Procedimento manual (seção 5); não há fluxo automatizado para testar |
| Saúde: sem módulo próprio não lê nem grava; sem autorização o banco recusa; autorização de saúde invisível a quem só vê o cadastro; revogar apaga | PASS | `tests/db/pessoas-saude.test.ts`, mutação em `fase4-fuzz.test.ts` |
| Menor de idade: cadastro exige responsável; só o responsável autoriza e aceita termo | PASS | `tests/db/pessoas-saude.test.ts`, `patrimonio-governanca-filiacoes.test.ts`, mutação |
| Saúde nunca vai para a agenda | PASS | `tests/db/patrimonio-governanca-filiacoes.test.ts` |
| Documentos de atletas sem EXIF/GPS | ACCEPTED_EVIDENCE_GAP | Mesmo caminho dos comprovantes (`prepararDocumento`, `preserveExif: false`); sem canvas no Node; conferir com foto que tenha GPS no primeiro uso real |
| Remoção real dos arquivos no Storage | BLOCKED_ENVIRONMENT | Lógica testada (`limpeza.test.ts`); conferir no lançamento (`deploy.md` §7d) |
| CPF do doador invisível para quem não vê o financeiro inteiro nem cuida da captação; extrato só para financeiro "tudo" | PASS | `tests/db/fase5.test.ts` |
| Delegação não aceita campo de saúde (ex.: `deficiencia`) | PASS | `tests/db/fase5.test.ts` |
| Logs reais do Supabase sem dado pessoal | BLOCKED_ENVIRONMENT | Sem projeto Supabase real neste ambiente; conferir no primeiro deploy (`deploy.md`) |
