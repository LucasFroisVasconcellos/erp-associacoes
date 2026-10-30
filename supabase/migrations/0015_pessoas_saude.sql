-- 0015 · Pessoas (associados e atletas), mensalidades com Pix e área de saúde.
-- Regras de LGPD (docs/lgpd.md § 9), aplicadas no banco:
--  * coleta mínima: nada de RG/CPF de atleta aqui; data de nascimento só para saber se é menor;
--  * menor de idade: responsável legal obrigatório; consentimento dado pelo responsável;
--  * saúde (deficiência, classificação funcional, laudos) em tabelas separadas, com o módulo
--    "saude", que nenhum cargo recebe por padrão (só quem um administrador liberar);
--  * sem consentimento ou base legal registrada, o banco RECUSA gravar dado de saúde (fail closed);
--  * revogar o consentimento apaga os dados de saúde e põe os arquivos na fila de remoção;
--  * a auditoria das tabelas de saúde registra só QUAIS campos mudaram, nunca o conteúdo;
--  * arquivos em buckets privados próprios, lidos só por URL assinada de 60 s.

create function private.trg_auditar_sensivel() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_novo jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_velho jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_campos jsonb;
begin
  select coalesce(jsonb_agg(k order by k), '[]') into v_campos
  from (select k from jsonb_object_keys(coalesce(v_novo, v_velho)) k
        where (v_novo -> k) is distinct from (v_velho -> k)) x;
  perform private.registrar(case tg_op when 'INSERT' then 'inserir' when 'UPDATE' then 'alterar' else 'remover' end,
    tg_table_name, coalesce(v_novo, v_velho) ->> 'pessoa_id', null, jsonb_build_object('campos', v_campos));
  return null;
end $$;

create table public.configuracoes (
  chave text primary key check (chave in ('pix')),
  valor jsonb not null,
  atualizado_por uuid not null references public.membros (id),
  atualizado_em timestamptz not null default now()
);
create index configuracoes_atualizado_por_idx on public.configuracoes (atualizado_por);
select private.proteger_tabela('public.configuracoes');
create trigger configuracoes_auditar after insert or update or delete on public.configuracoes for each row execute function private.trg_auditar();
-- a chave Pix não é segredo (vai para quem paga); qualquer membro ativo lê
create policy ler on public.configuracoes for select to authenticated using ((select private.membro_atual()) is not null);

-- Chave Pix: e-mail, telefone (+55…), CPF, CNPJ ou chave aleatória. Nome e cidade no padrão do BR Code
-- (sem acento, até 25 e 15 caracteres).
create function private.chave_pix_valida(p text) returns boolean
language sql immutable set search_path = '' as $$
  select p is not null and (
       private.email_valido(p) or p ~ '^\+55[0-9]{10,11}$' or p ~ '^[0-9]{11}$' or p ~ '^[0-9]{14}$'
    or p ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
$$;

create function private.salvar_config_pix(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_config_pix', 'financeiro', 'administrar'); v_chave text;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['chave','nome','cidade']), false) then return private.erro('invalido'); end if;
  v_chave := lower(private.j_texto(p -> 'chave'));
  if v_chave ~ '^\+' then v_chave := upper(v_chave); end if;
  if not private.chave_pix_valida(v_chave) then return private.erro('invalido', 'chave'); end if;
  if coalesce(private.j_texto(p -> 'nome'), '') !~ '^[A-Za-z0-9 .-]{3,25}$' then return private.erro('invalido', 'nome'); end if;
  if coalesce(private.j_texto(p -> 'cidade'), '') !~ '^[A-Za-z .-]{2,15}$' then return private.erro('invalido', 'cidade'); end if;
  insert into public.configuracoes (chave, valor, atualizado_por)
  values ('pix', jsonb_build_object('chave', v_chave, 'nome', upper(private.j_texto(p -> 'nome')), 'cidade', upper(private.j_texto(p -> 'cidade'))), auth.uid())
  on conflict (chave) do update set valor = excluded.valor, atualizado_por = excluded.atualizado_por, atualizado_em = now();
  return jsonb_build_object('ok', true);
end $$;

create table public.categorias_socio (
  id uuid primary key,
  nome text not null check (private.texto_ok(nome, 2, 60)),
  valor_mensalidade numeric(14, 2) not null check (valor_mensalidade between 0 and 100000),
  dia_vencimento int not null check (dia_vencimento between 1 and 28),
  ativa boolean not null default true,
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now()
);
create unique index categorias_socio_nome_unico on public.categorias_socio (lower(nome));
create index categorias_socio_criado_por_idx on public.categorias_socio (criado_por);

create table public.pessoas (
  id uuid primary key,
  nome text not null check (private.texto_ok(nome, 2, 120)),
  atleta boolean not null default false,
  associado boolean not null default false,
  categoria_id uuid references public.categorias_socio (id),
  situacao text not null default 'ativo' check (situacao in ('ativo', 'inativo', 'desligado')),
  data_nascimento date check (data_nascimento >= date '1900-01-01'),
  email text check (email is null or (email = lower(email) and private.email_valido(email))),
  telefone text check (telefone ~ '^\+?[0-9]{10,13}$'),
  responsavel_nome text check (private.texto_opcional_ok(responsavel_nome, 120)),
  responsavel_contato text check (private.texto_opcional_ok(responsavel_contato, 120)),
  responsavel_parentesco text check (private.texto_opcional_ok(responsavel_parentesco, 40)),
  observacao text check (char_length(observacao) <= 500 and observacao !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]'),
  desligado_em date,
  -- área do atleta (futuro): um cadastro poderá ganhar login próprio, vendo só os próprios dados
  membro_id uuid unique references public.membros (id),
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (atleta or associado),
  check ((situacao = 'desligado') = (desligado_em is not null))
);
create index pessoas_nome_idx on public.pessoas (lower(nome));
create index pessoas_categoria_idx on public.pessoas (categoria_id) where categoria_id is not null;
create index pessoas_criado_por_idx on public.pessoas (criado_por);

create function private.menor_de_idade(p date) returns boolean
language sql stable set search_path = '' as $$
  select p is not null and p > (private.hoje() - interval '18 years')::date
$$;

create table public.mensalidades (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references public.pessoas (id),
  competencia date not null check (extract(day from competencia) = 1),
  valor numeric(14, 2) not null check (valor > 0 and valor <= 100000),
  vencimento date not null,
  situacao text not null default 'aberta' check (situacao in ('aberta', 'paga', 'dispensada', 'cancelada')),
  -- identificador da cobrança no Pix (até 25 letras e números, aleatório)
  txid text not null unique default ('ERPX' || upper(substr(md5(gen_random_uuid()::text), 1, 21)))
    check (txid ~ '^[A-Za-z0-9]{1,25}$'),
  lancamento_id uuid unique references public.lancamentos (id),
  pago_em date,
  motivo text check (private.texto_opcional_ok(motivo, 300)),
  atualizado_por uuid references public.membros (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (pessoa_id, competencia),
  check ((situacao = 'paga') = (pago_em is not null))
);
create index mensalidades_abertas_idx on public.mensalidades (vencimento) where situacao = 'aberta';
create index mensalidades_atualizado_por_idx on public.mensalidades (atualizado_por) where atualizado_por is not null;

create function private.tipos_documento_pessoa() returns text[] language sql immutable set search_path = '' as $$
  select array['registro_federacao','autorizacao_imagem','termo_equipamento','outro']
$$;
create table public.documentos_pessoa (
  id uuid primary key,
  pessoa_id uuid not null references public.pessoas (id),
  tipo text not null check (tipo = any (private.tipos_documento_pessoa())),
  descricao text check (private.texto_opcional_ok(descricao, 200)),
  validade date,
  entregue_em date,
  arquivo_caminho text unique,
  arquivo_mime text,
  arquivo_tamanho int check (arquivo_tamanho between 1 and 10485760),
  arquivo_sha256 text check (arquivo_sha256 ~ '^[0-9a-f]{64}$'),
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now(),
  arquivado_em timestamptz
);
create index documentos_pessoa_pessoa_idx on public.documentos_pessoa (pessoa_id);
create index documentos_pessoa_validade_idx on public.documentos_pessoa (validade) where validade is not null and arquivado_em is null;
create index documentos_pessoa_criado_por_idx on public.documentos_pessoa (criado_por);

create table public.consentimentos (
  id uuid primary key,
  pessoa_id uuid not null references public.pessoas (id),
  finalidade text not null check (finalidade in ('saude', 'imagem')),
  base_legal text not null check (base_legal in ('consentimento', 'exigencia_esportiva')),
  concedido_por text not null check (concedido_por in ('titular', 'responsavel')),
  nome_concedente text not null check (private.texto_ok(nome_concedente, 2, 120)),
  concedido_em date not null,
  revogado_em timestamptz,
  revogado_por uuid references public.membros (id),
  registrado_por uuid not null references public.membros (id),
  registrado_em timestamptz not null default now()
);
create unique index consentimentos_um_ativo on public.consentimentos (pessoa_id, finalidade) where revogado_em is null;
create index consentimentos_registrado_por_idx on public.consentimentos (registrado_por);
create index consentimentos_revogado_por_idx on public.consentimentos (revogado_por) where revogado_por is not null;

create table public.pessoa_saude (
  pessoa_id uuid primary key references public.pessoas (id),
  deficiencia text check (char_length(deficiencia) <= 300 and deficiencia !~ '[[:cntrl:]]'),
  classe_funcional text check (classe_funcional ~ '^[0-9A-Za-z .,/-]{0,20}$'),
  observacoes text check (char_length(observacoes) <= 1000 and observacoes !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]'),
  atualizado_por uuid not null references public.membros (id),
  atualizado_em timestamptz not null default now()
);
create index pessoa_saude_atualizado_por_idx on public.pessoa_saude (atualizado_por);

create table public.documentos_saude (
  id uuid primary key,
  pessoa_id uuid not null references public.pessoas (id),
  tipo text not null check (tipo in ('atestado_medico', 'laudo', 'classificacao_funcional', 'outro')),
  emitido_em date,
  validade date,
  arquivo_caminho text unique,
  arquivo_mime text,
  arquivo_tamanho int check (arquivo_tamanho between 1 and 10485760),
  arquivo_sha256 text check (arquivo_sha256 ~ '^[0-9a-f]{64}$'),
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now()
);
create index documentos_saude_pessoa_idx on public.documentos_saude (pessoa_id);
create index documentos_saude_criado_por_idx on public.documentos_saude (criado_por);

-- Fila de arquivos a remover do Storage (o SQL não apaga o arquivo físico; quem apaga é a
-- Edge Function "limpar-arquivos", pela API do Storage).
create table private.arquivos_remover (
  bucket text not null,
  caminho text not null,
  motivo text not null,
  criado_em timestamptz not null default now(),
  primary key (bucket, caminho)
);
revoke all on private.arquivos_remover from public, anon, authenticated, service_role;

do $$ declare t text; begin
  foreach t in array array['categorias_socio','pessoas','mensalidades','documentos_pessoa','consentimentos','pessoa_saude','documentos_saude'] loop
    perform private.proteger_tabela(format('public.%I', t)::regclass);
  end loop;
  foreach t in array array['categorias_socio','pessoas','mensalidades','documentos_pessoa','consentimentos'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.trg_auditar()', t || '_auditar', t);
  end loop;
  foreach t in array array['pessoa_saude','documentos_saude'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.trg_auditar_sensivel()', t || '_auditar', t);
  end loop;
  -- pessoas, mensalidades e consentimentos não se apagam (desligar, cancelar, revogar)
  foreach t in array array['categorias_socio','pessoas','mensalidades','consentimentos','documentos_pessoa'] loop
    execute format('create trigger %I before delete on public.%I for each row execute function private.trg_sem_apagar()', t || '_sem_apagar', t);
  end loop;
end $$;

create policy ler on public.categorias_socio for select to authenticated using ((select private.pode('pessoas', 'ver')) or (select private.pode('financeiro', 'ver')));
create policy ler on public.pessoas for select to authenticated using ((select private.pode('pessoas', 'ver')));
create policy ler on public.mensalidades for select to authenticated using ((select private.pode('pessoas', 'ver')) or (select private.pode('financeiro', 'ver')));
create policy ler on public.documentos_pessoa for select to authenticated using ((select private.pode('pessoas', 'ver')));
-- autorização de saúde só aparece para quem vê a área de saúde (a existência dela já diz algo sobre saúde)
create policy ler on public.consentimentos for select to authenticated
  using ((finalidade <> 'saude' and (select private.pode('pessoas', 'ver'))) or (select private.pode('saude', 'ver')));
create policy ler on public.pessoa_saude for select to authenticated using ((select private.pode('saude', 'ver')));
create policy ler on public.documentos_saude for select to authenticated using ((select private.pode('saude', 'ver')));

create function private.salvar_categoria_socio(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_categoria_socio', 'pessoas', 'editar'); v_id uuid; v_nome text;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','nome','valor_mensalidade','dia_vencimento','ativa']), false) then return private.erro('invalido'); end if;
  v_id := private.j_uuid(p -> 'id');      if v_id is null then return private.erro('invalido', 'id'); end if;
  v_nome := private.j_texto(p -> 'nome'); if not private.texto_ok(v_nome, 2, 60) then return private.erro('invalido', 'nome'); end if;
  if private.j_valor(p -> 'valor_mensalidade') is null or private.j_valor(p -> 'valor_mensalidade') > 100000 then return private.erro('invalido', 'valor_mensalidade'); end if;
  if coalesce(private.j_inteiro(p -> 'dia_vencimento'), 0) not between 1 and 28 then return private.erro('invalido', 'dia_vencimento'); end if;
  if not private.vazio(p -> 'ativa') and private.j_bool(p -> 'ativa') is null then return private.erro('invalido', 'ativa'); end if;
  if exists (select 1 from public.categorias_socio where lower(nome) = lower(v_nome) and id <> v_id) then return private.erro('duplicado', 'nome'); end if;
  insert into public.categorias_socio (id, nome, valor_mensalidade, dia_vencimento, ativa, criado_por)
  values (v_id, v_nome, private.j_valor(p -> 'valor_mensalidade'), private.j_inteiro(p -> 'dia_vencimento'), coalesce(private.j_bool(p -> 'ativa'), true), auth.uid())
  on conflict (id) do update set nome = excluded.nome, valor_mensalidade = excluded.valor_mensalidade, dia_vencimento = excluded.dia_vencimento, ativa = excluded.ativa;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create function private.salvar_pessoa(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('salvar_pessoa', 'pessoas', 'criar');
  v_id uuid; x public.pessoas; v_nasc date; v_email text; v_tel text; v_sit text; v_cat uuid; v_inserido uuid;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','nome','atleta','associado','categoria_id','situacao','data_nascimento','email','telefone',
       'responsavel_nome','responsavel_contato','responsavel_parentesco','observacao']), false) then
    return private.erro('invalido');
  end if;
  v_id := private.j_uuid(p -> 'id'); if v_id is null then return private.erro('invalido', 'id'); end if;
  if not private.texto_ok(private.j_texto(p -> 'nome'), 2, 120) then return private.erro('invalido', 'nome'); end if;
  if private.j_bool(p -> 'atleta') is null then return private.erro('invalido', 'atleta'); end if;
  if private.j_bool(p -> 'associado') is null then return private.erro('invalido', 'associado'); end if;
  if not (private.j_bool(p -> 'atleta') or private.j_bool(p -> 'associado')) then return private.erro('invalido', 'atleta'); end if;
  if not private.vazio(p -> 'categoria_id') then
    v_cat := private.j_uuid(p -> 'categoria_id');
    if v_cat is null or not exists (select 1 from public.categorias_socio where id = v_cat) then return private.erro('invalido', 'categoria_id'); end if;
  end if;
  v_sit := coalesce(private.j_texto(p -> 'situacao'), 'ativo');
  if v_sit not in ('ativo', 'inativo', 'desligado') then return private.erro('invalido', 'situacao'); end if;
  if not private.vazio(p -> 'data_nascimento') then
    v_nasc := private.j_data(p -> 'data_nascimento');
    if v_nasc is null or v_nasc < date '1900-01-01' or v_nasc > private.hoje() then return private.erro('invalido', 'data_nascimento'); end if;
  end if;
  if not private.vazio(p -> 'email') then
    v_email := lower(private.j_texto(p -> 'email'));
    if not private.email_valido(v_email) then return private.erro('invalido', 'email'); end if;
  end if;
  if not private.vazio(p -> 'telefone') then
    v_tel := regexp_replace(coalesce(private.j_texto(p -> 'telefone'), ''), '[ ()-]', '', 'g');
    if v_tel !~ '^\+?[0-9]{10,13}$' then return private.erro('invalido', 'telefone'); end if;
  end if;
  if not private.vazio(p -> 'responsavel_nome') and not private.texto_ok(private.j_texto(p -> 'responsavel_nome'), 2, 120) then return private.erro('invalido', 'responsavel_nome'); end if;
  if not private.vazio(p -> 'responsavel_contato') and not private.texto_ok(private.j_texto(p -> 'responsavel_contato'), 2, 120) then return private.erro('invalido', 'responsavel_contato'); end if;
  if not private.vazio(p -> 'responsavel_parentesco') and not private.texto_ok(private.j_texto(p -> 'responsavel_parentesco'), 2, 40) then return private.erro('invalido', 'responsavel_parentesco'); end if;
  if not private.vazio(p -> 'observacao') and (jsonb_typeof(p -> 'observacao') <> 'string' or not private.texto_longo_ok(p ->> 'observacao', 500)) then return private.erro('invalido', 'observacao'); end if;
  -- menor de idade: responsável legal é obrigatório
  if private.menor_de_idade(v_nasc) and (private.vazio(p -> 'responsavel_nome') or private.vazio(p -> 'responsavel_contato')) then
    return private.erro('responsavel_obrigatorio', 'responsavel_nome');
  end if;

  select * into x from public.pessoas where id = v_id for update;
  if x.id is null then
    insert into public.pessoas (id, nome, atleta, associado, categoria_id, situacao, data_nascimento, email, telefone, responsavel_nome,
                                responsavel_contato, responsavel_parentesco, observacao, desligado_em, criado_por)
    values (v_id, private.j_texto(p -> 'nome'), private.j_bool(p -> 'atleta'), private.j_bool(p -> 'associado'), v_cat, v_sit, v_nasc, v_email, v_tel,
            nullif(private.j_texto(p -> 'responsavel_nome'), ''), nullif(private.j_texto(p -> 'responsavel_contato'), ''),
            nullif(private.j_texto(p -> 'responsavel_parentesco'), ''), nullif(btrim(coalesce(p ->> 'observacao', '')), ''),
            case when v_sit = 'desligado' then private.hoje() end, auth.uid())
    on conflict (id) do nothing returning id into v_inserido;
    if v_inserido is null then return private.erro('conflito', 'id'); end if;
    return jsonb_build_object('ok', true, 'id', v_id, 'repetido', false);
  end if;
  if not private.pode('pessoas', 'editar') then return private.negar('salvar_pessoa'); end if;
  update public.pessoas set nome = private.j_texto(p -> 'nome'), atleta = private.j_bool(p -> 'atleta'), associado = private.j_bool(p -> 'associado'),
    categoria_id = v_cat, situacao = v_sit, data_nascimento = v_nasc, email = v_email, telefone = v_tel,
    responsavel_nome = nullif(private.j_texto(p -> 'responsavel_nome'), ''), responsavel_contato = nullif(private.j_texto(p -> 'responsavel_contato'), ''),
    responsavel_parentesco = nullif(private.j_texto(p -> 'responsavel_parentesco'), ''), observacao = nullif(btrim(coalesce(p ->> 'observacao', '')), ''),
    desligado_em = case when v_sit = 'desligado' then coalesce(x.desligado_em, private.hoje()) end, atualizado_em = now()
  where id = v_id;
  -- desligou: mensalidades futuras em aberto são canceladas
  if v_sit = 'desligado' and x.situacao <> 'desligado' then
    update public.mensalidades set situacao = 'cancelada', motivo = 'Pessoa desligada', atualizado_por = auth.uid(), atualizado_em = now()
     where pessoa_id = v_id and situacao = 'aberta' and competencia > date_trunc('month', private.hoje())::date;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'repetido', true);
end $$;

-- Gera as mensalidades de uma competência para associados ativos com categoria paga. Idempotente.
create function private.gerar_mensalidades(p_competencia date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('gerar_mensalidades', 'pessoas', 'editar'); v_n int;
begin
  if v_erro is not null then return v_erro; end if;
  if p_competencia is null or extract(day from p_competencia) <> 1
     or p_competencia not between (date_trunc('month', private.hoje()) - interval '12 months')::date and (date_trunc('month', private.hoje()) + interval '2 months')::date then
    return private.erro('invalido', 'competencia');
  end if;
  insert into public.mensalidades (pessoa_id, competencia, valor, vencimento, atualizado_por)
  select x.id, p_competencia, c.valor_mensalidade, make_date(extract(year from p_competencia)::int, extract(month from p_competencia)::int, c.dia_vencimento), auth.uid()
  from public.pessoas x join public.categorias_socio c on c.id = x.categoria_id
  where x.associado and x.situacao = 'ativo' and c.ativa and c.valor_mensalidade > 0
  on conflict (pessoa_id, competencia) do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'criadas', v_n);
end $$;

-- Baixa: liga a mensalidade à entrada já lançada no Dinheiro (o Pix cai na conta; a tesouraria lança).
create function private.registrar_pagamento_mensalidade(p_id uuid, p_lancamento uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('registrar_pagamento_mensalidade', 'financeiro', 'editar'); m public.mensalidades; l public.lancamentos;
begin
  if v_erro is not null then return v_erro; end if;
  select * into m from public.mensalidades where id = p_id for update;
  if m.id is null then return private.erro('nao_encontrado'); end if;
  if m.situacao = 'paga' then return private.erro('ja_paga'); end if;
  if m.situacao = 'cancelada' then return private.erro('invalido', 'situacao'); end if;
  select * into l from public.lancamentos where id = p_lancamento;
  if l.id is null or l.tipo <> 'entrada' or l.situacao <> 'realizada' or l.estorno_de is not null
     or exists (select 1 from public.lancamentos e where e.estorno_de = l.id)
     or not private.ve_registro('financeiro', l.criado_por) then
    return private.erro('invalido', 'lancamento_id');
  end if;
  if exists (select 1 from public.mensalidades o where o.lancamento_id = l.id and o.id <> m.id)
     or exists (select 1 from public.verba_parcelas v where v.lancamento_id = l.id) then
    return private.erro('conflito', 'lancamento_id');
  end if;
  update public.mensalidades set situacao = 'paga', pago_em = l.data, lancamento_id = l.id, atualizado_por = auth.uid(), atualizado_em = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Dispensar (isenção), cancelar ou reabrir. Paga só volta a aberta por quem edita o financeiro.
create function private.mudar_mensalidade(p_id uuid, p_situacao text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('mudar_mensalidade', 'pessoas', 'editar'); m public.mensalidades;
begin
  if v_erro is not null then return v_erro; end if;
  if coalesce(p_situacao, '') not in ('aberta', 'dispensada', 'cancelada') then return private.erro('invalido', 'situacao'); end if;
  if p_situacao <> 'aberta' and not private.texto_ok(p_motivo, 3, 300) then return private.erro('invalido', 'motivo'); end if;
  select * into m from public.mensalidades where id = p_id for update;
  if m.id is null then return private.erro('nao_encontrado'); end if;
  if m.situacao = p_situacao then return jsonb_build_object('ok', true, 'repetido', true); end if;
  if m.situacao = 'paga' and not private.pode('financeiro', 'editar') then return private.negar('mudar_mensalidade'); end if;
  update public.mensalidades set situacao = p_situacao, pago_em = null, lancamento_id = null,
    motivo = case when p_situacao = 'aberta' then null else btrim(p_motivo) end, atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create function private.salvar_documento_pessoa(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_documento_pessoa', 'pessoas', 'editar'); v_id uuid; d public.documentos_pessoa; v_pessoa uuid;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','pessoa_id','tipo','descricao','validade','entregue_em','arquivar']), false) then return private.erro('invalido'); end if;
  v_id := private.j_uuid(p -> 'id'); if v_id is null then return private.erro('invalido', 'id'); end if;
  v_pessoa := private.j_uuid(p -> 'pessoa_id');
  if v_pessoa is null or not exists (select 1 from public.pessoas where id = v_pessoa) then return private.erro('invalido', 'pessoa_id'); end if;
  if not (coalesce(private.j_texto(p -> 'tipo'), '') = any (private.tipos_documento_pessoa())) then return private.erro('invalido', 'tipo'); end if;
  if not private.vazio(p -> 'descricao') and not private.texto_ok(private.j_texto(p -> 'descricao'), 2, 200) then return private.erro('invalido', 'descricao'); end if;
  if not private.vazio(p -> 'validade') and (private.j_data(p -> 'validade') is null or private.j_data(p -> 'validade') > private.hoje() + 3700) then return private.erro('invalido', 'validade'); end if;
  if not private.vazio(p -> 'entregue_em') and (private.j_data(p -> 'entregue_em') is null or private.j_data(p -> 'entregue_em') > private.hoje()) then return private.erro('invalido', 'entregue_em'); end if;
  if not private.vazio(p -> 'arquivar') and private.j_bool(p -> 'arquivar') is null then return private.erro('invalido', 'arquivar'); end if;
  select * into d from public.documentos_pessoa where id = v_id for update;
  if d.id is not null and d.pessoa_id <> v_pessoa then return private.erro('conflito', 'id'); end if;
  insert into public.documentos_pessoa (id, pessoa_id, tipo, descricao, validade, entregue_em, criado_por)
  values (v_id, v_pessoa, p ->> 'tipo', nullif(private.j_texto(p -> 'descricao'), ''), private.j_data(p -> 'validade'), private.j_data(p -> 'entregue_em'), auth.uid())
  on conflict (id) do update set tipo = excluded.tipo, descricao = excluded.descricao, validade = excluded.validade, entregue_em = excluded.entregue_em,
    arquivado_em = case when coalesce(private.j_bool(p -> 'arquivar'), false) then coalesce(public.documentos_pessoa.arquivado_em, now()) else null end;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create function private.consentimento_ativo(p_pessoa uuid, p_finalidade text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.consentimentos c where c.pessoa_id = p_pessoa and c.finalidade = p_finalidade and c.revogado_em is null)
$$;

create function private.registrar_consentimento(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('registrar_consentimento', 'pessoas', 'editar'); v_id uuid; v_pessoa public.pessoas; v_data date; v_inserido uuid;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','pessoa_id','finalidade','base_legal','concedido_por','nome_concedente','concedido_em']), false) then return private.erro('invalido'); end if;
  v_id := private.j_uuid(p -> 'id'); if v_id is null then return private.erro('invalido', 'id'); end if;
  select * into v_pessoa from public.pessoas where id = private.j_uuid(p -> 'pessoa_id');
  if v_pessoa.id is null then return private.erro('invalido', 'pessoa_id'); end if;
  if coalesce(private.j_texto(p -> 'finalidade'), '') not in ('saude', 'imagem') then return private.erro('invalido', 'finalidade'); end if;
  -- consentimento de saúde: só quem pode cuidar da área de saúde registra
  if p ->> 'finalidade' = 'saude' and not private.pode('saude', 'editar') then return private.negar('registrar_consentimento'); end if;
  if coalesce(private.j_texto(p -> 'base_legal'), '') not in ('consentimento', 'exigencia_esportiva') then return private.erro('invalido', 'base_legal'); end if;
  if coalesce(private.j_texto(p -> 'concedido_por'), '') not in ('titular', 'responsavel') then return private.erro('invalido', 'concedido_por'); end if;
  -- criança e adolescente: quem consente é o responsável (LGPD art. 14)
  if private.menor_de_idade(v_pessoa.data_nascimento) and p ->> 'concedido_por' <> 'responsavel' then return private.erro('invalido', 'concedido_por'); end if;
  if not private.texto_ok(private.j_texto(p -> 'nome_concedente'), 2, 120) then return private.erro('invalido', 'nome_concedente'); end if;
  v_data := private.j_data(p -> 'concedido_em');
  if v_data is null or v_data > private.hoje() or v_data < private.hoje() - 3700 then return private.erro('invalido', 'concedido_em'); end if;
  if private.consentimento_ativo(v_pessoa.id, p ->> 'finalidade') then return private.erro('ja_existe', 'finalidade'); end if;
  insert into public.consentimentos (id, pessoa_id, finalidade, base_legal, concedido_por, nome_concedente, concedido_em, registrado_por)
  values (v_id, v_pessoa.id, p ->> 'finalidade', p ->> 'base_legal', p ->> 'concedido_por', private.j_texto(p -> 'nome_concedente'), v_data, auth.uid())
  on conflict do nothing returning id into v_inserido;
  if v_inserido is null then return private.erro('conflito', 'id'); end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Apaga os dados de saúde de uma pessoa (e manda os arquivos para a fila de remoção).
create function private.apagar_saude(p_pessoa uuid, p_motivo text) returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  insert into private.arquivos_remover (bucket, caminho, motivo)
  select 'saude', arquivo_caminho, p_motivo from public.documentos_saude where pessoa_id = p_pessoa and arquivo_caminho is not null
  on conflict do nothing;
  delete from public.documentos_saude where pessoa_id = p_pessoa;
  get diagnostics v_n = row_count;
  delete from public.pessoa_saude where pessoa_id = p_pessoa;
  return v_n;
end $$;

-- Revogar é tão fácil quanto consentir. Saúde com base em consentimento: os dados são apagados.
create function private.revogar_consentimento(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('revogar_consentimento', 'pessoas', 'editar'); c public.consentimentos; v_apagados int := 0;
begin
  if v_erro is not null then return v_erro; end if;
  select * into c from public.consentimentos where id = p_id for update;
  if c.id is null then return private.erro('nao_encontrado'); end if;
  if c.finalidade = 'saude' and not private.pode('saude', 'editar') then return private.negar('revogar_consentimento'); end if;
  if c.revogado_em is not null then return jsonb_build_object('ok', true, 'repetido', true); end if;
  update public.consentimentos set revogado_em = now(), revogado_por = auth.uid() where id = p_id;
  if c.finalidade = 'saude' and c.base_legal = 'consentimento' then
    v_apagados := private.apagar_saude(c.pessoa_id, 'consentimento_revogado');
  end if;
  return jsonb_build_object('ok', true, 'dados_apagados', c.finalidade = 'saude' and c.base_legal = 'consentimento');
end $$;

create function private.salvar_saude(p_pessoa uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_saude', 'saude', 'editar');
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['deficiencia','classe_funcional','observacoes']), false) then return private.erro('invalido'); end if;
  if not exists (select 1 from public.pessoas where id = p_pessoa and atleta) then return private.erro('invalido', 'pessoa_id'); end if;
  -- fail closed: sem consentimento (ou base legal) registrado, não grava
  if not private.consentimento_ativo(p_pessoa, 'saude') then return private.erro('sem_consentimento'); end if;
  if not private.vazio(p -> 'deficiencia') and (jsonb_typeof(p -> 'deficiencia') <> 'string' or not private.texto_opcional_ok(p ->> 'deficiencia', 300)) then return private.erro('invalido', 'deficiencia'); end if;
  if not private.vazio(p -> 'classe_funcional') and coalesce(private.j_texto(p -> 'classe_funcional'), '') !~ '^[0-9A-Za-z .,/-]{1,20}$' then return private.erro('invalido', 'classe_funcional'); end if;
  if not private.vazio(p -> 'observacoes') and (jsonb_typeof(p -> 'observacoes') <> 'string' or not private.texto_longo_ok(p ->> 'observacoes', 1000)) then return private.erro('invalido', 'observacoes'); end if;
  insert into public.pessoa_saude (pessoa_id, deficiencia, classe_funcional, observacoes, atualizado_por)
  values (p_pessoa, nullif(btrim(coalesce(p ->> 'deficiencia', '')), ''), nullif(private.j_texto(p -> 'classe_funcional'), ''),
          nullif(btrim(coalesce(p ->> 'observacoes', '')), ''), auth.uid())
  on conflict (pessoa_id) do update set deficiencia = excluded.deficiencia, classe_funcional = excluded.classe_funcional,
    observacoes = excluded.observacoes, atualizado_por = excluded.atualizado_por, atualizado_em = now();
  return jsonb_build_object('ok', true);
end $$;

create function private.salvar_documento_saude(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_documento_saude', 'saude', 'editar'); v_id uuid; v_pessoa uuid; d public.documentos_saude;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','pessoa_id','tipo','emitido_em','validade','remover']), false) then return private.erro('invalido'); end if;
  v_id := private.j_uuid(p -> 'id'); if v_id is null then return private.erro('invalido', 'id'); end if;
  v_pessoa := private.j_uuid(p -> 'pessoa_id');
  if v_pessoa is null or not exists (select 1 from public.pessoas where id = v_pessoa) then return private.erro('invalido', 'pessoa_id'); end if;
  select * into d from public.documentos_saude where id = v_id for update;
  if d.id is not null and d.pessoa_id <> v_pessoa then return private.erro('conflito', 'id'); end if;
  if coalesce(private.j_bool(p -> 'remover'), false) then
    if d.id is null then return jsonb_build_object('ok', true, 'repetido', true); end if;
    if d.arquivo_caminho is not null then
      insert into private.arquivos_remover (bucket, caminho, motivo) values ('saude', d.arquivo_caminho, 'documento_removido') on conflict do nothing;
    end if;
    delete from public.documentos_saude where id = v_id;
    return jsonb_build_object('ok', true);
  end if;
  if not private.consentimento_ativo(v_pessoa, 'saude') then return private.erro('sem_consentimento'); end if;
  if coalesce(private.j_texto(p -> 'tipo'), '') not in ('atestado_medico', 'laudo', 'classificacao_funcional', 'outro') then return private.erro('invalido', 'tipo'); end if;
  if not private.vazio(p -> 'emitido_em') and (private.j_data(p -> 'emitido_em') is null or private.j_data(p -> 'emitido_em') > private.hoje()) then return private.erro('invalido', 'emitido_em'); end if;
  if not private.vazio(p -> 'validade') and (private.j_data(p -> 'validade') is null or private.j_data(p -> 'validade') > private.hoje() + 3700) then return private.erro('invalido', 'validade'); end if;
  insert into public.documentos_saude (id, pessoa_id, tipo, emitido_em, validade, criado_por)
  values (v_id, v_pessoa, p ->> 'tipo', private.j_data(p -> 'emitido_em'), private.j_data(p -> 'validade'), auth.uid())
  on conflict (id) do update set tipo = excluded.tipo, emitido_em = excluded.emitido_em, validade = excluded.validade;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('pessoas', 'pessoas', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('saude', 'saude', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy erp_pessoas_ler on storage.objects for select to authenticated
  using (bucket_id = 'pessoas' and (select private.pode('pessoas', 'ver'))
         and exists (select 1 from public.documentos_pessoa d where d.arquivo_caminho = storage.objects.name));
create policy erp_saude_ler on storage.objects for select to authenticated
  using (bucket_id = 'saude' and (select private.pode('saude', 'ver'))
         and exists (select 1 from public.documentos_saude d where d.arquivo_caminho = storage.objects.name));

-- Autoriza (como o usuário) o envio de um arquivo para um documento já cadastrado.
create function private.autorizar_documento(p_area text, p_documento uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb; v_pessoa uuid;
begin
  if p_area = 'pessoa' then
    v_erro := private.checar('autorizar_documento', 'pessoas', 'editar');
    if v_erro is not null then return v_erro; end if;
    if not exists (select 1 from public.documentos_pessoa where id = p_documento and arquivado_em is null) then return private.erro('nao_encontrado'); end if;
  elsif p_area = 'saude' then
    v_erro := private.checar('autorizar_documento', 'saude', 'editar');
    if v_erro is not null then return v_erro; end if;
    select pessoa_id into v_pessoa from public.documentos_saude where id = p_documento;
    if v_pessoa is null then return private.erro('nao_encontrado'); end if;
    if not private.consentimento_ativo(v_pessoa, 'saude') then return private.erro('sem_consentimento'); end if;
  else
    return private.erro('invalido', 'area');
  end if;
  return jsonb_build_object('ok', true, 'membro_id', auth.uid(), 'documento_id', p_documento);
end $$;

-- Registra o arquivo gravado (só a service role). Arquivo anterior do mesmo documento vai para a fila de remoção.
create function private.registrar_documento(p_usuario uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_area text; v_doc uuid; v_caminho text; v_sha text; v_bucket text; o storage.objects; v_antigo text; v_mime text; v_tam int;
begin
  if not exists (select 1 from public.membros where id = p_usuario and ativo) then return private.erro('invalido', 'usuario'); end if;
  perform set_config('app.ator', p_usuario::text, true);
  if not coalesce(private.so_chaves(p, array['area','documento_id','caminho','sha256']), false) then return private.erro('invalido'); end if;
  v_area := private.j_texto(p -> 'area');
  v_bucket := case v_area when 'pessoa' then 'pessoas' when 'saude' then 'saude' end;
  if v_bucket is null then return private.erro('invalido', 'area'); end if;
  v_doc := private.j_uuid(p -> 'documento_id'); if v_doc is null then return private.erro('invalido', 'documento_id'); end if;
  v_caminho := private.j_texto(p -> 'caminho');
  if coalesce(v_caminho, '') !~ ('^' || v_doc::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$') then
    return private.erro('invalido', 'caminho');
  end if;
  v_sha := private.j_texto(p -> 'sha256'); if coalesce(v_sha, '') !~ '^[0-9a-f]{64}$' then return private.erro('invalido', 'sha256'); end if;
  o := private.objeto_storage(v_bucket, v_caminho);
  if o.id is null then return private.erro('arquivo_inexistente'); end if;
  v_mime := coalesce(o.metadata ->> 'mimetype', '');
  v_tam := coalesce((o.metadata ->> 'size')::int, 0);
  if not (v_mime = any (array['image/jpeg','image/png','image/webp','application/pdf'])) then return private.erro('invalido', 'mime'); end if;
  if v_tam not between 1 and 10485760 then return private.erro('invalido', 'tamanho'); end if;
  if v_area = 'pessoa' then
    select arquivo_caminho into v_antigo from public.documentos_pessoa where id = v_doc for update;
    if not found then return private.erro('nao_encontrado'); end if;
    update public.documentos_pessoa set arquivo_caminho = v_caminho, arquivo_mime = v_mime, arquivo_tamanho = v_tam, arquivo_sha256 = v_sha,
      entregue_em = coalesce(entregue_em, private.hoje()) where id = v_doc;
  else
    select arquivo_caminho into v_antigo from public.documentos_saude where id = v_doc for update;
    if not found then return private.erro('nao_encontrado'); end if;
    if not private.consentimento_ativo((select pessoa_id from public.documentos_saude where id = v_doc), 'saude') then return private.erro('sem_consentimento'); end if;
    update public.documentos_saude set arquivo_caminho = v_caminho, arquivo_mime = v_mime, arquivo_tamanho = v_tam, arquivo_sha256 = v_sha where id = v_doc;
  end if;
  if v_antigo is not null and v_antigo <> v_caminho then
    insert into private.arquivos_remover (bucket, caminho, motivo) values (v_bucket, v_antigo, 'substituido') on conflict do nothing;
  end if;
  return jsonb_build_object('ok', true, 'id', v_doc);
end $$;

-- Fila de remoção (só a Edge Function "limpar-arquivos", com a service role).
create function private.pegar_arquivos_remover(p_lote int) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_lote is null or p_lote not between 1 and 100 then return private.erro('invalido', 'lote'); end if;
  return jsonb_build_object('ok', true, 'arquivos', coalesce((
    select jsonb_agg(jsonb_build_object('bucket', bucket, 'caminho', caminho)) from (
      select bucket, caminho from private.arquivos_remover order by criado_em limit p_lote) x), '[]'));
end $$;
create function private.confirmar_remocao(p_bucket text, p_caminho text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  delete from private.arquivos_remover where bucket = p_bucket and caminho = p_caminho;
  if not found then return private.erro('nao_encontrado'); end if;
  perform private.registrar('remover_arquivo', p_bucket, null, null, jsonb_build_object('motivo', 'fila_de_remocao'));
  return jsonb_build_object('ok', true);
end $$;

create function private.resumo_pessoas() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('resumo_pessoas', 'pessoas', 'ver'); v_hoje date := private.hoje();
begin
  if v_erro is not null then return v_erro; end if;
  return jsonb_build_object('ok', true,
    'ativos', (select count(*) from public.pessoas where situacao = 'ativo'),
    'atletas', (select count(*) from public.pessoas where situacao = 'ativo' and atleta),
    'associados', (select count(*) from public.pessoas where situacao = 'ativo' and associado),
    'menores_sem_responsavel', (select count(*) from public.pessoas where situacao <> 'desligado' and private.menor_de_idade(data_nascimento) and responsavel_nome is null),
    'mensalidades_atrasadas', (select count(*) from public.mensalidades where situacao = 'aberta' and vencimento < v_hoje),
    'valor_atrasado', (select coalesce(sum(valor), 0)::text from public.mensalidades where situacao = 'aberta' and vencimento < v_hoje),
    'documentos_vencendo', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'pessoa_id', d.pessoa_id, 'pessoa', x.nome, 'tipo', d.tipo, 'validade', d.validade) order by d.validade)
       from public.documentos_pessoa d join public.pessoas x on x.id = d.pessoa_id
       where d.arquivado_em is null and d.validade is not null and d.validade <= v_hoje + 30 and x.situacao <> 'desligado'), '[]'),
    -- validade de laudos e atestados só para quem vê a área de saúde
    'saude_vencendo', case when private.pode('saude', 'ver') then (select count(*) from public.documentos_saude d where d.validade is not null and d.validade <= v_hoje + 30) end);
end $$;

-- * saúde de pessoa desligada: apagada 1 ano depois do desligamento;
-- * contatos de pessoa desligada (e-mail, telefone, responsável, nascimento): apagados 5 anos depois;
--   nome e mensalidades ficam (registro contábil).
create or replace function private.aplicar_retencao(p_agora timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_convites int; v_notificacoes int; v_limites int; v_avisos int; v_tarefas int; v_saude int := 0; v_contatos int; r record;
begin
  delete from public.convites
   where usado_em is null
     and coalesce(cancelado_em, expira_em) < p_agora - interval '90 days';
  get diagnostics v_convites = row_count;
  delete from public.notificacoes where lida_em is not null and lida_em < p_agora - interval '180 days';
  get diagnostics v_notificacoes = row_count;
  delete from private.limites where janela < p_agora - interval '1 day';
  get diagnostics v_limites = row_count;

  perform set_config('app.retencao', 'on', true);
  with velhos as (
    select id from public.avisos where coalesce(arquivado_em, (expira_em + 1)::timestamptz, 'infinity') < p_agora - interval '2 years'
  ), l as (delete from public.aviso_leituras where aviso_id in (select id from velhos))
  delete from public.avisos where id in (select id from velhos);
  get diagnostics v_avisos = row_count;
  with velhas as (
    select id from public.tarefas where situacao in ('feito', 'cancelada') and atualizado_em < p_agora - interval '5 years'
  ), i as (delete from public.tarefa_itens where tarefa_id in (select id from velhas)),
     c as (delete from public.tarefa_comentarios where tarefa_id in (select id from velhas))
  delete from public.tarefas where id in (select id from velhas);
  get diagnostics v_tarefas = row_count;
  perform set_config('app.retencao', 'off', true);

  for r in select x.id from public.pessoas x
            where x.situacao = 'desligado' and x.desligado_em < (p_agora - interval '1 year')::date
              and (exists (select 1 from public.pessoa_saude s where s.pessoa_id = x.id)
                   or exists (select 1 from public.documentos_saude d where d.pessoa_id = x.id)) loop
    perform private.apagar_saude(r.id, 'retencao');
    v_saude := v_saude + 1;
  end loop;
  update public.pessoas set email = null, telefone = null, data_nascimento = null, responsavel_nome = null, responsavel_contato = null,
    responsavel_parentesco = null, observacao = null
   where situacao = 'desligado' and desligado_em < (p_agora - interval '5 years')::date
     and (email is not null or telefone is not null or data_nascimento is not null or responsavel_nome is not null or observacao is not null);
  get diagnostics v_contatos = row_count;

  perform private.registrar('retencao', null, null, null,
    jsonb_build_object('convites', v_convites, 'notificacoes', v_notificacoes, 'limites', v_limites, 'avisos', v_avisos, 'tarefas', v_tarefas,
                       'saude', v_saude, 'contatos', v_contatos));
  return jsonb_build_object('ok', true, 'convites', v_convites, 'notificacoes', v_notificacoes, 'limites', v_limites,
                            'avisos', v_avisos, 'tarefas', v_tarefas, 'saude', v_saude, 'contatos', v_contatos);
end $$;
revoke all on function private.aplicar_retencao(timestamptz) from public, anon, authenticated, service_role;

insert into private.limites_operacao (operacao, maximo_por_hora) values
  ('salvar_config_pix', 10), ('salvar_categoria_socio', 60), ('salvar_pessoa', 300), ('gerar_mensalidades', 30),
  ('registrar_pagamento_mensalidade', 300), ('mudar_mensalidade', 200), ('salvar_documento_pessoa', 300),
  ('registrar_consentimento', 100), ('revogar_consentimento', 60), ('salvar_saude', 200), ('salvar_documento_saude', 200),
  ('autorizar_documento', 60), ('resumo_pessoas', 300);

create function public.salvar_config_pix(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_config_pix(p) $$;
create function public.salvar_categoria_socio(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_categoria_socio(p) $$;
create function public.salvar_pessoa(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_pessoa(p) $$;
create function public.gerar_mensalidades(p_competencia date) returns jsonb language sql security invoker set search_path = '' as $$ select private.gerar_mensalidades(p_competencia) $$;
create function public.registrar_pagamento_mensalidade(p_id uuid, p_lancamento uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.registrar_pagamento_mensalidade(p_id, p_lancamento) $$;
create function public.mudar_mensalidade(p_id uuid, p_situacao text, p_motivo text) returns jsonb language sql security invoker set search_path = '' as $$ select private.mudar_mensalidade(p_id, p_situacao, p_motivo) $$;
create function public.salvar_documento_pessoa(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_documento_pessoa(p) $$;
create function public.registrar_consentimento(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.registrar_consentimento(p) $$;
create function public.revogar_consentimento(p_id uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.revogar_consentimento(p_id) $$;
create function public.salvar_saude(p_pessoa uuid, p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_saude(p_pessoa, p) $$;
create function public.salvar_documento_saude(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_documento_saude(p) $$;
create function public.autorizar_documento(p_area text, p_documento uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.autorizar_documento(p_area, p_documento) $$;
create function public.resumo_pessoas() returns jsonb language sql security invoker set search_path = '' as $$ select private.resumo_pessoas() $$;
create function public.registrar_documento(p_usuario uuid, p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.registrar_documento(p_usuario, p) $$;
create function public.pegar_arquivos_remover(p_lote int) returns jsonb language sql security invoker set search_path = '' as $$ select private.pegar_arquivos_remover(p_lote) $$;
create function public.confirmar_remocao(p_bucket text, p_caminho text) returns jsonb language sql security invoker set search_path = '' as $$ select private.confirmar_remocao(p_bucket, p_caminho) $$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
do $$
declare
  f text;
  usuario text[] := array['salvar_config_pix(jsonb)','salvar_categoria_socio(jsonb)','salvar_pessoa(jsonb)','gerar_mensalidades(date)',
    'registrar_pagamento_mensalidade(uuid,uuid)','mudar_mensalidade(uuid,text,text)','salvar_documento_pessoa(jsonb)',
    'registrar_consentimento(jsonb)','revogar_consentimento(uuid)','salvar_saude(uuid,jsonb)','salvar_documento_saude(jsonb)',
    'autorizar_documento(text,uuid)','resumo_pessoas()'];
  servidor text[] := array['registrar_documento(uuid,jsonb)','pegar_arquivos_remover(integer)','confirmar_remocao(text,text)'];
begin
  foreach f in array usuario loop
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('grant execute on function private.%s to authenticated', f);
  end loop;
  foreach f in array servidor loop
    execute format('revoke all on function public.%s from authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
    execute format('grant execute on function private.%s to service_role', f);
  end loop;
end $$;
