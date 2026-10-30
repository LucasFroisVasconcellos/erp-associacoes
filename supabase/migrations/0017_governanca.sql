-- 0017 · Governança e secretaria, no módulo "documentos".
-- Documentos institucionais e certidões com validade (aviso antes de vencer), mandatos da
-- diretoria e do conselho fiscal, reuniões e assembleias com presença, quórum, votações e ata.
-- Ata aprovada não muda mais (nem pelo dono do banco pelo app).

create function private.tipos_documento_institucional() returns text[] language sql immutable set search_path = '' as $$
  select array['estatuto','regimento','ata_registrada','cnpj','procuracao','certidao_federal','certidao_estadual','certidao_municipal',
               'certidao_fgts','certidao_trabalhista','alvara','outro']
$$;

create table public.documentos_institucionais (
  id uuid primary key,
  tipo text not null check (tipo = any (private.tipos_documento_institucional())),
  titulo text not null check (private.texto_ok(titulo, 2, 160)),
  emitido_em date,
  validade date,
  observacao text check (private.texto_opcional_ok(observacao, 300)),
  arquivo_caminho text unique,
  arquivo_mime text,
  arquivo_tamanho int check (arquivo_tamanho between 1 and 10485760),
  arquivo_sha256 text check (arquivo_sha256 ~ '^[0-9a-f]{64}$'),
  arquivado_em timestamptz,
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now()
);
create index documentos_institucionais_validade_idx on public.documentos_institucionais (validade) where validade is not null and arquivado_em is null;
create index documentos_institucionais_criado_por_idx on public.documentos_institucionais (criado_por);

create table public.mandatos (
  id uuid primary key,
  nome text not null check (private.texto_ok(nome, 2, 120)),
  membro_id uuid references public.membros (id),
  cargo text not null check (private.texto_ok(cargo, 2, 60)),
  orgao text not null check (orgao in ('diretoria', 'conselho_fiscal', 'outro')),
  inicio date not null,
  fim date not null,
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now(),
  check (fim > inicio and fim <= inicio + 3700)
);
create index mandatos_fim_idx on public.mandatos (fim);
create index mandatos_membro_idx on public.mandatos (membro_id) where membro_id is not null;
create index mandatos_criado_por_idx on public.mandatos (criado_por);

create table public.reunioes (
  id uuid primary key,
  tipo text not null check (tipo in ('diretoria', 'assembleia_ordinaria', 'assembleia_extraordinaria', 'conselho_fiscal')),
  titulo text not null check (private.texto_ok(titulo, 2, 160)),
  data timestamptz not null,
  local text check (private.texto_opcional_ok(local, 160)),
  pauta text not null check (char_length(btrim(pauta)) between 2 and 4000 and pauta !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]'),
  quorum_minimo int check (quorum_minimo between 1 and 1000),
  situacao text not null default 'convocada' check (situacao in ('convocada', 'realizada', 'cancelada')),
  ata text check (char_length(ata) <= 20000 and ata !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]'),
  ata_aprovada_em date,
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (ata_aprovada_em is null or (ata is not null and situacao = 'realizada'))
);
create index reunioes_data_idx on public.reunioes (data);
create index reunioes_criado_por_idx on public.reunioes (criado_por);

create table public.reuniao_presencas (
  reuniao_id uuid not null references public.reunioes (id),
  nome text not null check (private.texto_ok(nome, 2, 120)),
  membro_id uuid references public.membros (id),
  primary key (reuniao_id, nome)
);
create index reuniao_presencas_membro_idx on public.reuniao_presencas (membro_id) where membro_id is not null;

create table public.deliberacoes (
  id uuid primary key,
  reuniao_id uuid not null references public.reunioes (id),
  ordem int not null check (ordem between 1 and 200),
  texto text not null check (private.texto_ok(texto, 2, 1000)),
  votos_favor int not null default 0 check (votos_favor between 0 and 10000),
  votos_contra int not null default 0 check (votos_contra between 0 and 10000),
  abstencoes int not null default 0 check (abstencoes between 0 and 10000),
  resultado text not null check (resultado in ('aprovada', 'rejeitada', 'retirada')),
  unique (reuniao_id, ordem)
);

do $$ declare t text; begin
  foreach t in array array['documentos_institucionais','mandatos','reunioes','reuniao_presencas','deliberacoes'] loop
    perform private.proteger_tabela(format('public.%I', t)::regclass);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.trg_auditar()', t || '_auditar', t);
    execute format('create policy ler on public.%I for select to authenticated using ((select private.pode(''documentos'', ''ver'')))', t);
  end loop;
  foreach t in array array['documentos_institucionais','mandatos','reunioes'] loop
    execute format('create trigger %I before delete on public.%I for each row execute function private.trg_sem_apagar()', t || '_sem_apagar', t);
  end loop;
end $$;

-- Ata aprovada: reunião, presenças e deliberações ficam congeladas.
create function private.trg_ata_congelada() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  -- to_jsonb: a mesma função serve a tabelas com colunas diferentes (e OLD/NEW nulos)
  v_linha jsonb := to_jsonb(coalesce(new, old));
  v_reuniao uuid := (v_linha ->> case when tg_table_name = 'reunioes' then 'id' else 'reuniao_id' end)::uuid;
  v_aprovando boolean := tg_table_name = 'reunioes' and tg_op = 'UPDATE' and (to_jsonb(old) ->> 'ata_aprovada_em') is null;
begin
  if not v_aprovando and exists (select 1 from public.reunioes r where r.id = v_reuniao and r.ata_aprovada_em is not null) then
    raise exception 'Ata aprovada não pode ser alterada' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger reunioes_congelada before update on public.reunioes for each row execute function private.trg_ata_congelada();
create trigger reuniao_presencas_congelada before insert or update or delete on public.reuniao_presencas for each row execute function private.trg_ata_congelada();
create trigger deliberacoes_congelada before insert or update or delete on public.deliberacoes for each row execute function private.trg_ata_congelada();

create function private.salvar_documento_institucional(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_documento_institucional', 'documentos', 'criar'); v_id uuid; d public.documentos_institucionais;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','tipo','titulo','emitido_em','validade','observacao','arquivar']), false) then return private.erro('invalido'); end if;
  v_id := private.j_uuid(p -> 'id'); if v_id is null then return private.erro('invalido', 'id'); end if;
  if not (coalesce(private.j_texto(p -> 'tipo'), '') = any (private.tipos_documento_institucional())) then return private.erro('invalido', 'tipo'); end if;
  if not private.texto_ok(private.j_texto(p -> 'titulo'), 2, 160) then return private.erro('invalido', 'titulo'); end if;
  if not private.vazio(p -> 'emitido_em') and (private.j_data(p -> 'emitido_em') is null or private.j_data(p -> 'emitido_em') > private.hoje()) then return private.erro('invalido', 'emitido_em'); end if;
  if not private.vazio(p -> 'validade') and (private.j_data(p -> 'validade') is null or private.j_data(p -> 'validade') > private.hoje() + 3700) then return private.erro('invalido', 'validade'); end if;
  if not private.vazio(p -> 'observacao') and not private.texto_ok(private.j_texto(p -> 'observacao'), 2, 300) then return private.erro('invalido', 'observacao'); end if;
  if not private.vazio(p -> 'arquivar') and private.j_bool(p -> 'arquivar') is null then return private.erro('invalido', 'arquivar'); end if;
  select * into d from public.documentos_institucionais where id = v_id for update;
  if d.id is not null and not private.pode('documentos', 'editar') then return private.negar('salvar_documento_institucional'); end if;
  insert into public.documentos_institucionais (id, tipo, titulo, emitido_em, validade, observacao, criado_por)
  values (v_id, p ->> 'tipo', private.j_texto(p -> 'titulo'), private.j_data(p -> 'emitido_em'), private.j_data(p -> 'validade'), nullif(private.j_texto(p -> 'observacao'), ''), auth.uid())
  on conflict (id) do update set tipo = excluded.tipo, titulo = excluded.titulo, emitido_em = excluded.emitido_em, validade = excluded.validade, observacao = excluded.observacao,
    arquivado_em = case when coalesce(private.j_bool(p -> 'arquivar'), false) then coalesce(public.documentos_institucionais.arquivado_em, now()) else null end;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create function private.salvar_mandato(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_mandato', 'documentos', 'editar'); v_id uuid; v_ini date; v_fim date; v_membro uuid;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','nome','membro_id','cargo','orgao','inicio','fim']), false) then return private.erro('invalido'); end if;
  v_id := private.j_uuid(p -> 'id'); if v_id is null then return private.erro('invalido', 'id'); end if;
  if not private.texto_ok(private.j_texto(p -> 'nome'), 2, 120) then return private.erro('invalido', 'nome'); end if;
  if not private.vazio(p -> 'membro_id') then
    v_membro := private.j_uuid(p -> 'membro_id');
    if v_membro is null or not exists (select 1 from public.membros where id = v_membro) then return private.erro('invalido', 'membro_id'); end if;
  end if;
  if not private.texto_ok(private.j_texto(p -> 'cargo'), 2, 60) then return private.erro('invalido', 'cargo'); end if;
  if coalesce(private.j_texto(p -> 'orgao'), '') not in ('diretoria', 'conselho_fiscal', 'outro') then return private.erro('invalido', 'orgao'); end if;
  v_ini := private.j_data(p -> 'inicio'); v_fim := private.j_data(p -> 'fim');
  if v_ini is null or v_ini < date '2000-01-01' then return private.erro('invalido', 'inicio'); end if;
  if v_fim is null or v_fim <= v_ini or v_fim > v_ini + 3700 then return private.erro('invalido', 'fim'); end if;
  insert into public.mandatos (id, nome, membro_id, cargo, orgao, inicio, fim, criado_por)
  values (v_id, private.j_texto(p -> 'nome'), v_membro, private.j_texto(p -> 'cargo'), p ->> 'orgao', v_ini, v_fim, auth.uid())
  on conflict (id) do update set nome = excluded.nome, membro_id = excluded.membro_id, cargo = excluded.cargo, orgao = excluded.orgao, inicio = excluded.inicio, fim = excluded.fim;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create function private.salvar_reuniao(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_reuniao', 'documentos', 'criar'); v_id uuid; r public.reunioes; v_data timestamptz;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','tipo','titulo','data','local','pauta','quorum_minimo','situacao']), false) then return private.erro('invalido'); end if;
  v_id := private.j_uuid(p -> 'id'); if v_id is null then return private.erro('invalido', 'id'); end if;
  if coalesce(private.j_texto(p -> 'tipo'), '') not in ('diretoria', 'assembleia_ordinaria', 'assembleia_extraordinaria', 'conselho_fiscal') then return private.erro('invalido', 'tipo'); end if;
  if not private.texto_ok(private.j_texto(p -> 'titulo'), 2, 160) then return private.erro('invalido', 'titulo'); end if;
  v_data := private.j_instante(p -> 'data');
  if v_data is null or private.data_local(v_data) not between private.hoje() - 3700 and private.hoje() + 730 then return private.erro('invalido', 'data'); end if;
  if not private.vazio(p -> 'local') and not private.texto_ok(private.j_texto(p -> 'local'), 2, 160) then return private.erro('invalido', 'local'); end if;
  if jsonb_typeof(p -> 'pauta') is distinct from 'string' or char_length(btrim(p ->> 'pauta')) not between 2 and 4000 or not private.texto_longo_ok(p ->> 'pauta', 4000) then
    return private.erro('invalido', 'pauta');
  end if;
  if not private.vazio(p -> 'quorum_minimo') and coalesce(private.j_inteiro(p -> 'quorum_minimo'), 0) not between 1 and 1000 then return private.erro('invalido', 'quorum_minimo'); end if;
  if coalesce(private.j_texto(p -> 'situacao'), 'convocada') not in ('convocada', 'realizada', 'cancelada') then return private.erro('invalido', 'situacao'); end if;
  select * into r from public.reunioes where id = v_id for update;
  if r.id is not null then
    if not private.pode('documentos', 'editar') then return private.negar('salvar_reuniao'); end if;
    if r.ata_aprovada_em is not null then return private.erro('ata_aprovada'); end if;
  end if;
  insert into public.reunioes (id, tipo, titulo, data, local, pauta, quorum_minimo, situacao, criado_por)
  values (v_id, p ->> 'tipo', private.j_texto(p -> 'titulo'), v_data, nullif(private.j_texto(p -> 'local'), ''), btrim(p ->> 'pauta'),
          private.j_inteiro(p -> 'quorum_minimo'), coalesce(private.j_texto(p -> 'situacao'), 'convocada'), auth.uid())
  on conflict (id) do update set tipo = excluded.tipo, titulo = excluded.titulo, data = excluded.data, local = excluded.local, pauta = excluded.pauta,
    quorum_minimo = excluded.quorum_minimo, situacao = excluded.situacao, atualizado_em = now();
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Lista de presença: substitui a lista inteira. p = [{ nome, membro_id? }]
create function private.salvar_presencas(p_reuniao uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_presencas', 'documentos', 'editar'); r public.reunioes; v_n int;
begin
  if v_erro is not null then return v_erro; end if;
  select * into r from public.reunioes where id = p_reuniao for update;
  if r.id is null then return private.erro('nao_encontrado'); end if;
  if r.ata_aprovada_em is not null then return private.erro('ata_aprovada'); end if;
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) > 1000
     or exists (select 1 from jsonb_array_elements(p) e where not private.so_chaves(e, array['nome','membro_id'])
                  or not private.texto_ok(private.j_texto(e -> 'nome'), 2, 120)
                  or (not private.vazio(e -> 'membro_id') and not exists (select 1 from public.membros m where m.id = private.j_uuid(e -> 'membro_id'))))
     or (select count(distinct lower(private.j_texto(e -> 'nome'))) from jsonb_array_elements(p) e) <> jsonb_array_length(p) then
    return private.erro('invalido', 'presencas');
  end if;
  delete from public.reuniao_presencas where reuniao_id = p_reuniao;
  insert into public.reuniao_presencas (reuniao_id, nome, membro_id)
  select p_reuniao, private.j_texto(e -> 'nome'), private.j_uuid(e -> 'membro_id') from jsonb_array_elements(p) e;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'presentes', v_n, 'quorum_atingido', r.quorum_minimo is null or v_n >= r.quorum_minimo);
end $$;

create function private.salvar_deliberacao(p_reuniao uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_deliberacao', 'documentos', 'editar'); r public.reunioes; v_id uuid; v_pres int; v_votos int;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','ordem','texto','votos_favor','votos_contra','abstencoes','resultado']), false) then return private.erro('invalido'); end if;
  select * into r from public.reunioes where id = p_reuniao for update;
  if r.id is null then return private.erro('nao_encontrado'); end if;
  if r.ata_aprovada_em is not null then return private.erro('ata_aprovada'); end if;
  v_id := private.j_uuid(p -> 'id'); if v_id is null then return private.erro('invalido', 'id'); end if;
  if exists (select 1 from public.deliberacoes where id = v_id and reuniao_id <> p_reuniao) then return private.erro('conflito', 'id'); end if;
  if coalesce(private.j_inteiro(p -> 'ordem'), 0) not between 1 and 200 then return private.erro('invalido', 'ordem'); end if;
  if not private.texto_ok(private.j_texto(p -> 'texto'), 2, 1000) then return private.erro('invalido', 'texto'); end if;
  if coalesce(private.j_inteiro(p -> 'votos_favor'), -1) not between 0 and 10000 or coalesce(private.j_inteiro(p -> 'votos_contra'), -1) not between 0 and 10000
     or coalesce(private.j_inteiro(p -> 'abstencoes'), -1) not between 0 and 10000 then
    return private.erro('invalido', 'votos');
  end if;
  if coalesce(private.j_texto(p -> 'resultado'), '') not in ('aprovada', 'rejeitada', 'retirada') then return private.erro('invalido', 'resultado'); end if;
  -- não pode haver mais votos que presentes (quando a lista existe)
  select count(*) into v_pres from public.reuniao_presencas where reuniao_id = p_reuniao;
  v_votos := private.j_inteiro(p -> 'votos_favor') + private.j_inteiro(p -> 'votos_contra') + private.j_inteiro(p -> 'abstencoes');
  if v_pres > 0 and v_votos > v_pres then return private.erro('invalido', 'votos'); end if;
  if exists (select 1 from public.deliberacoes where reuniao_id = p_reuniao and ordem = private.j_inteiro(p -> 'ordem') and id <> v_id) then return private.erro('duplicado', 'ordem'); end if;
  insert into public.deliberacoes (id, reuniao_id, ordem, texto, votos_favor, votos_contra, abstencoes, resultado)
  values (v_id, p_reuniao, private.j_inteiro(p -> 'ordem'), private.j_texto(p -> 'texto'), private.j_inteiro(p -> 'votos_favor'),
          private.j_inteiro(p -> 'votos_contra'), private.j_inteiro(p -> 'abstencoes'), p ->> 'resultado')
  on conflict (id) do update set ordem = excluded.ordem, texto = excluded.texto, votos_favor = excluded.votos_favor,
    votos_contra = excluded.votos_contra, abstencoes = excluded.abstencoes, resultado = excluded.resultado;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Ata: rascunho editável; "aprovar" congela tudo (data da aprovação na reunião seguinte, por exemplo).
create function private.salvar_ata(p_reuniao uuid, p_ata text, p_aprovada_em date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_ata', 'documentos', 'editar'); r public.reunioes;
begin
  if v_erro is not null then return v_erro; end if;
  select * into r from public.reunioes where id = p_reuniao for update;
  if r.id is null then return private.erro('nao_encontrado'); end if;
  if r.ata_aprovada_em is not null then return private.erro('ata_aprovada'); end if;
  if p_ata is null or char_length(btrim(p_ata)) not between 2 and 20000 or not private.texto_longo_ok(p_ata, 20000) then return private.erro('invalido', 'ata'); end if;
  if p_aprovada_em is not null and (p_aprovada_em > private.hoje() or p_aprovada_em < private.data_local(r.data)) then return private.erro('invalido', 'aprovada_em'); end if;
  if p_aprovada_em is not null and r.situacao <> 'realizada' then return private.erro('invalido', 'situacao'); end if;
  update public.reunioes set ata = btrim(p_ata), ata_aprovada_em = p_aprovada_em, atualizado_em = now() where id = p_reuniao;
  return jsonb_build_object('ok', true);
end $$;

-- Painel da governança: certidões e documentos vencendo, mandatos acabando, próximas reuniões.
create function private.painel_governanca() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('painel_governanca', 'documentos', 'ver'); v_hoje date := private.hoje();
begin
  if v_erro is not null then return v_erro; end if;
  return jsonb_build_object('ok', true,
    'vencendo', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'titulo', d.titulo, 'tipo', d.tipo, 'validade', d.validade) order by d.validade)
       from public.documentos_institucionais d where d.arquivado_em is null and d.validade is not null and d.validade <= v_hoje + 45), '[]'),
    'mandatos_acabando', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'nome', m.nome, 'cargo', m.cargo, 'fim', m.fim) order by m.fim)
       from public.mandatos m where m.fim between v_hoje and v_hoje + 120), '[]'),
    'proximas_reunioes', (select count(*) from public.reunioes r where r.situacao = 'convocada' and r.data >= now()),
    'atas_pendentes', (select count(*) from public.reunioes r where r.situacao = 'realizada' and r.ata_aprovada_em is null));
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('institucional', 'institucional', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
create policy erp_institucional_ler on storage.objects for select to authenticated
  using (bucket_id = 'institucional' and (select private.pode('documentos', 'ver'))
         and exists (select 1 from public.documentos_institucionais d where d.arquivo_caminho = storage.objects.name));

create or replace function private.autorizar_documento(p_area text, p_documento uuid) returns jsonb
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
  elsif p_area = 'institucional' then
    v_erro := private.checar('autorizar_documento', 'documentos', 'criar');
    if v_erro is not null then return v_erro; end if;
    if not exists (select 1 from public.documentos_institucionais where id = p_documento and arquivado_em is null) then return private.erro('nao_encontrado'); end if;
  else
    return private.erro('invalido', 'area');
  end if;
  return jsonb_build_object('ok', true, 'membro_id', auth.uid(), 'documento_id', p_documento);
end $$;

create or replace function private.registrar_documento(p_usuario uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_area text; v_doc uuid; v_caminho text; v_sha text; v_bucket text; o storage.objects; v_antigo text; v_mime text; v_tam int;
begin
  if not exists (select 1 from public.membros where id = p_usuario and ativo) then return private.erro('invalido', 'usuario'); end if;
  perform set_config('app.ator', p_usuario::text, true);
  if not coalesce(private.so_chaves(p, array['area','documento_id','caminho','sha256']), false) then return private.erro('invalido'); end if;
  v_area := private.j_texto(p -> 'area');
  v_bucket := case v_area when 'pessoa' then 'pessoas' when 'saude' then 'saude' when 'institucional' then 'institucional' end;
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
  elsif v_area = 'saude' then
    select arquivo_caminho into v_antigo from public.documentos_saude where id = v_doc for update;
    if not found then return private.erro('nao_encontrado'); end if;
    if not private.consentimento_ativo((select pessoa_id from public.documentos_saude where id = v_doc), 'saude') then return private.erro('sem_consentimento'); end if;
    update public.documentos_saude set arquivo_caminho = v_caminho, arquivo_mime = v_mime, arquivo_tamanho = v_tam, arquivo_sha256 = v_sha where id = v_doc;
  else
    select arquivo_caminho into v_antigo from public.documentos_institucionais where id = v_doc for update;
    if not found then return private.erro('nao_encontrado'); end if;
    update public.documentos_institucionais set arquivo_caminho = v_caminho, arquivo_mime = v_mime, arquivo_tamanho = v_tam, arquivo_sha256 = v_sha where id = v_doc;
  end if;
  if v_antigo is not null and v_antigo <> v_caminho then
    insert into private.arquivos_remover (bucket, caminho, motivo) values (v_bucket, v_antigo, 'substituido') on conflict do nothing;
  end if;
  return jsonb_build_object('ok', true, 'id', v_doc);
end $$;

insert into private.limites_operacao (operacao, maximo_por_hora) values
  ('salvar_documento_institucional', 200), ('salvar_mandato', 100), ('salvar_reuniao', 100), ('salvar_presencas', 200),
  ('salvar_deliberacao', 300), ('salvar_ata', 200), ('painel_governanca', 300);

create function public.salvar_documento_institucional(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_documento_institucional(p) $$;
create function public.salvar_mandato(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_mandato(p) $$;
create function public.salvar_reuniao(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_reuniao(p) $$;
create function public.salvar_presencas(p_reuniao uuid, p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_presencas(p_reuniao, p) $$;
create function public.salvar_deliberacao(p_reuniao uuid, p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_deliberacao(p_reuniao, p) $$;
create function public.salvar_ata(p_reuniao uuid, p_ata text, p_aprovada_em date) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_ata(p_reuniao, p_ata, p_aprovada_em) $$;
create function public.painel_governanca() returns jsonb language sql security invoker set search_path = '' as $$ select private.painel_governanca() $$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
do $$
declare f text;
begin
  foreach f in array array['salvar_documento_institucional(jsonb)','salvar_mandato(jsonb)','salvar_reuniao(jsonb)','salvar_presencas(uuid,jsonb)',
                           'salvar_deliberacao(uuid,jsonb)','salvar_ata(uuid,text,date)','painel_governanca()','autorizar_documento(text,uuid)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('grant execute on function private.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.registrar_documento(uuid, jsonb) from authenticated;
grant execute on function public.registrar_documento(uuid, jsonb), private.registrar_documento(uuid, jsonb) to service_role;
