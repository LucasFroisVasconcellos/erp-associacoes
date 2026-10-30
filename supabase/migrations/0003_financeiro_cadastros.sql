-- 0003 · Cadastros do financeiro: contas bancárias (sem limite), categorias, tipos de gasto
-- (descrição guiada), fornecedores/pagadores, centros de custo e projetos.
-- Nada vem pré-cadastrado; modelos de tipos de gasto só entram se a diretoria pedir.

create function private.vazio(j jsonb) returns boolean
language sql immutable set search_path = '' as $$ select j is null or jsonb_typeof(j) = 'null' $$;

create function private.j_texto(j jsonb) returns text
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(j) = 'string' then btrim(j #>> '{}') end
$$;

create function private.j_uuid(j jsonb) returns uuid
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(j) = 'string'
               and (j #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then (j #>> '{}')::uuid end
$$;

-- Dinheiro sempre como texto "1234.56" (nunca número em ponto flutuante).
create function private.j_valor(j jsonb, p_permite_negativo boolean default false) returns numeric
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(j) = 'string'
               and (j #>> '{}') ~ case when p_permite_negativo then '^-?[0-9]{1,8}(\.[0-9]{1,2})?$'
                                       else '^[0-9]{1,8}(\.[0-9]{1,2})?$' end
              then (j #>> '{}')::numeric(14, 2) end
$$;

create function private.j_data(j jsonb) returns date
language plpgsql immutable set search_path = '' as $$
declare s text := case when jsonb_typeof(j) = 'string' then j #>> '{}' end;
begin
  if s is null or s !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null; end if;
  return to_date(s, 'YYYY-MM-DD');
exception when others then return null;
end $$;

create function private.j_bool(j jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(j) = 'boolean' then (j #>> '{}')::boolean end
$$;

create function private.j_inteiro(j jsonb) returns int
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(j) = 'number' and (j #>> '{}') ~ '^-?[0-9]{1,6}$' then (j #>> '{}')::int end
$$;

create table public.contas_bancarias (
  id uuid primary key,
  nome text not null check (private.texto_ok(nome, 2, 80)),
  banco text check (private.texto_opcional_ok(banco, 80)),
  agencia text check (agencia ~ '^[0-9-]{1,10}$'),
  numero text check (numero ~ '^[0-9xX-]{1,20}$'),
  tipo text not null check (tipo in ('movimento', 'projeto', 'aplicacao', 'caixinha')),
  projeto_id uuid,
  saldo_inicial numeric(14, 2) not null default 0 check (saldo_inicial between -10000000 and 10000000),
  data_saldo_inicial date not null check (data_saldo_inicial >= date '2020-01-01'),
  ativa boolean not null default true,
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.categorias (
  id uuid primary key,
  nome text not null check (private.texto_ok(nome, 2, 60)),
  tipo text not null check (tipo in ('entrada', 'saida')),
  ativa boolean not null default true,
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now()
);
create unique index categorias_nome_tipo_unico on public.categorias (lower(nome), tipo);

create table public.tipos_gasto (
  id uuid primary key,
  nome text not null check (private.texto_ok(nome, 2, 60)),
  campos jsonb not null default '[]',
  ativo boolean not null default true,
  modelo text unique,               -- preenchido só para os modelos opcionais importados
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now()
);
create unique index tipos_gasto_nome_unico on public.tipos_gasto (lower(nome));

create table public.contrapartes (
  id uuid primary key,
  nome text not null check (private.texto_ok(nome, 2, 120)),
  tipo text not null check (tipo in ('fornecedor', 'pagador', 'ambos')),
  documento text check (documento ~ '^([0-9]{11}|[0-9]{14})$'),
  ativa boolean not null default true,
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now()
);

create table public.centros_custo (
  id uuid primary key,
  nome text not null check (private.texto_ok(nome, 2, 60)),
  ativo boolean not null default true,
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now()
);
create unique index centros_custo_nome_unico on public.centros_custo (lower(nome));

-- Projetos: só o essencial nesta fase.
create table public.projetos (
  id uuid primary key,
  nome text not null check (private.texto_ok(nome, 2, 120)),
  ativo boolean not null default true,
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now()
);
alter table public.contas_bancarias
  add constraint contas_bancarias_projeto_fk foreign key (projeto_id) references public.projetos (id);

create index contas_bancarias_criado_por_idx on public.contas_bancarias (criado_por);
create index contas_bancarias_projeto_idx on public.contas_bancarias (projeto_id) where projeto_id is not null;
create index categorias_criado_por_idx on public.categorias (criado_por);
create index tipos_gasto_criado_por_idx on public.tipos_gasto (criado_por);
create index contrapartes_criado_por_idx on public.contrapartes (criado_por);
create index centros_custo_criado_por_idx on public.centros_custo (criado_por);
create index projetos_criado_por_idx on public.projetos (criado_por);

do $$ declare t text; begin
  foreach t in array array['contas_bancarias','categorias','tipos_gasto','contrapartes','centros_custo','projetos'] loop
    perform private.proteger_tabela(format('public.%I', t)::regclass);
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function private.trg_auditar()', t || '_auditar', t);
    if t <> 'projetos' then
      execute format('create policy ler on public.%I for select to authenticated
                      using ((select private.pode(''financeiro'', ''ver'')))', t);
    end if;
  end loop;
end $$;
create policy ler on public.projetos for select to authenticated
  using ((select private.pode('projetos', 'ver')) or (select private.pode('financeiro', 'ver')));

-- Campos da descrição guiada: [{chave, rotulo, tipo, obrigatorio}], até 15, chaves únicas.
create function private.campos_validos(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 15
     and not exists (
       select 1 from jsonb_array_elements(p) e
       where not private.so_chaves(e, array['chave','rotulo','tipo','obrigatorio'])
          or coalesce(private.j_texto(e -> 'chave'), '') !~ '^[a-z][a-z0-9_]{0,29}$'
          or not private.texto_ok(private.j_texto(e -> 'rotulo'), 1, 60)
          or coalesce(private.j_texto(e -> 'tipo'), '') not in ('texto', 'numero', 'inteiro', 'data')
          or private.j_bool(e -> 'obrigatorio') is null)
     and (select count(distinct e ->> 'chave') = count(*) from jsonb_array_elements(p) e)
$$;

-- Insere ou atualiza pelo id; quem cria fica registrado; registra auditoria via gatilho.
create function private.salvar_conta(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('salvar_conta', 'financeiro', 'administrar');
  v_id uuid; v_nome text; v_tipo text; v_saldo numeric; v_data date; v_ativa boolean; v_proj uuid;
  v_atual public.contas_bancarias;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','nome','banco','agencia','numero','tipo','projeto_id','saldo_inicial','data_saldo_inicial','ativa']), false) then
    return private.erro('invalido');
  end if;
  v_id := private.j_uuid(p -> 'id');               if v_id is null then return private.erro('invalido', 'id'); end if;
  v_nome := private.j_texto(p -> 'nome');          if not private.texto_ok(v_nome, 2, 80) then return private.erro('invalido', 'nome'); end if;
  v_tipo := private.j_texto(p -> 'tipo');
  if coalesce(v_tipo, '') not in ('movimento', 'projeto', 'aplicacao', 'caixinha') then return private.erro('invalido', 'tipo'); end if;
  v_saldo := private.j_valor(p -> 'saldo_inicial', true);
  if v_saldo is null then return private.erro('invalido', 'saldo_inicial'); end if;
  v_data := private.j_data(p -> 'data_saldo_inicial');
  if v_data is null or v_data < date '2020-01-01' or v_data > private.hoje() then return private.erro('invalido', 'data_saldo_inicial'); end if;
  if not private.vazio(p -> 'banco') and not private.texto_ok(private.j_texto(p -> 'banco'), 1, 80) then return private.erro('invalido', 'banco'); end if;
  if not private.vazio(p -> 'agencia') and coalesce(private.j_texto(p -> 'agencia'), '') !~ '^[0-9-]{1,10}$' then return private.erro('invalido', 'agencia'); end if;
  if not private.vazio(p -> 'numero') and coalesce(private.j_texto(p -> 'numero'), '') !~ '^[0-9xX-]{1,20}$' then return private.erro('invalido', 'numero'); end if;
  v_ativa := coalesce(private.j_bool(p -> 'ativa'), true);
  if not private.vazio(p -> 'projeto_id') then
    v_proj := private.j_uuid(p -> 'projeto_id');
    if v_proj is null or not exists (select 1 from public.projetos where id = v_proj) then return private.erro('invalido', 'projeto_id'); end if;
  end if;

  select * into v_atual from public.contas_bancarias where id = v_id for update;
  if v_atual.id is null then
    insert into public.contas_bancarias (id, nome, banco, agencia, numero, tipo, projeto_id, saldo_inicial, data_saldo_inicial, ativa, criado_por)
    values (v_id, v_nome, private.j_texto(p -> 'banco'), private.j_texto(p -> 'agencia'), private.j_texto(p -> 'numero'),
            v_tipo, v_proj, v_saldo, v_data, v_ativa, auth.uid());
  else
    -- saldo inicial e data não mudam depois que a conta tem movimento realizado
    if (v_atual.saldo_inicial <> v_saldo or v_atual.data_saldo_inicial <> v_data)
       and exists (select 1 from public.lancamentos l where l.conta_id = v_id and l.situacao = 'realizada') then
      return private.erro('conta_em_uso', 'saldo_inicial');
    end if;
    update public.contas_bancarias
       set nome = v_nome, banco = private.j_texto(p -> 'banco'), agencia = private.j_texto(p -> 'agencia'),
           numero = private.j_texto(p -> 'numero'), tipo = v_tipo, projeto_id = v_proj,
           saldo_inicial = v_saldo, data_saldo_inicial = v_data, ativa = v_ativa, atualizado_em = now()
     where id = v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create function private.salvar_categoria(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('salvar_categoria', 'financeiro', 'administrar');
  v_id uuid; v_nome text; v_tipo text;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','nome','tipo','ativa']), false) then return private.erro('invalido'); end if;
  v_id := private.j_uuid(p -> 'id');      if v_id is null then return private.erro('invalido', 'id'); end if;
  v_nome := private.j_texto(p -> 'nome'); if not private.texto_ok(v_nome, 2, 60) then return private.erro('invalido', 'nome'); end if;
  v_tipo := private.j_texto(p -> 'tipo'); if coalesce(v_tipo, '') not in ('entrada', 'saida') then return private.erro('invalido', 'tipo'); end if;
  if exists (select 1 from public.categorias where lower(nome) = lower(v_nome) and tipo = v_tipo and id <> v_id) then
    return private.erro('duplicado', 'nome');
  end if;
  insert into public.categorias (id, nome, tipo, ativa, criado_por)
  values (v_id, v_nome, v_tipo, coalesce(private.j_bool(p -> 'ativa'), true), auth.uid())
  on conflict (id) do update set nome = excluded.nome, tipo = excluded.tipo, ativa = excluded.ativa;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create function private.salvar_tipo_gasto(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('salvar_tipo_gasto', 'financeiro', 'administrar');
  v_id uuid; v_nome text; v_campos jsonb := coalesce(p -> 'campos', '[]'::jsonb);
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','nome','campos','ativo']), false) then return private.erro('invalido'); end if;
  v_id := private.j_uuid(p -> 'id');      if v_id is null then return private.erro('invalido', 'id'); end if;
  v_nome := private.j_texto(p -> 'nome'); if not private.texto_ok(v_nome, 2, 60) then return private.erro('invalido', 'nome'); end if;
  if not coalesce(private.campos_validos(v_campos), false) then return private.erro('invalido', 'campos'); end if;
  if exists (select 1 from public.tipos_gasto where lower(nome) = lower(v_nome) and id <> v_id) then return private.erro('duplicado', 'nome'); end if;
  insert into public.tipos_gasto (id, nome, campos, ativo, criado_por)
  values (v_id, v_nome, v_campos, coalesce(private.j_bool(p -> 'ativo'), true), auth.uid())
  on conflict (id) do update set nome = excluded.nome, campos = excluded.campos, ativo = excluded.ativo;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Modelos opcionais: só entram quando a diretoria pede; não duplicam.
create function private.importar_modelos_tipos_gasto() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('importar_modelos_tipos_gasto', 'financeiro', 'administrar'); v_n int;
begin
  if v_erro is not null then return v_erro; end if;
  insert into public.tipos_gasto (id, nome, campos, modelo, criado_por)
  select gen_random_uuid(), m.nome, m.campos::jsonb, m.modelo, auth.uid()
  from (values
    ('combustivel', 'Combustível', '[{"chave":"litros","rotulo":"Litros","tipo":"numero","obrigatorio":true},{"chave":"posto","rotulo":"Posto","tipo":"texto","obrigatorio":false},{"chave":"veiculo","rotulo":"Veículo","tipo":"texto","obrigatorio":false},{"chave":"km","rotulo":"Quilometragem","tipo":"inteiro","obrigatorio":false},{"chave":"viagem","rotulo":"Viagem ou evento","tipo":"texto","obrigatorio":false}]'),
    ('alimentacao', 'Alimentação', '[{"chave":"local","rotulo":"Local","tipo":"texto","obrigatorio":false},{"chave":"pessoas","rotulo":"Número de pessoas","tipo":"inteiro","obrigatorio":true},{"chave":"motivo","rotulo":"Motivo","tipo":"texto","obrigatorio":false},{"chave":"evento","rotulo":"Evento","tipo":"texto","obrigatorio":false}]'),
    ('pedagio', 'Pedágio', '[{"chave":"praca","rotulo":"Praça de pedágio","tipo":"texto","obrigatorio":false},{"chave":"viagem","rotulo":"Viagem ou evento","tipo":"texto","obrigatorio":false}]'),
    ('hospedagem', 'Hospedagem', '[{"chave":"hotel","rotulo":"Hotel","tipo":"texto","obrigatorio":false},{"chave":"diarias","rotulo":"Diárias","tipo":"inteiro","obrigatorio":true},{"chave":"pessoas","rotulo":"Número de pessoas","tipo":"inteiro","obrigatorio":false}]'),
    ('transporte', 'Transporte', '[{"chave":"trajeto","rotulo":"Trajeto","tipo":"texto","obrigatorio":false},{"chave":"meio","rotulo":"Meio (ônibus, van, aplicativo)","tipo":"texto","obrigatorio":false}]')
  ) as m(modelo, nome, campos)
  where not exists (select 1 from public.tipos_gasto t where t.modelo = m.modelo or lower(t.nome) = lower(m.nome))
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'importados', v_n);
end $$;

create function private.salvar_contraparte(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('salvar_contraparte', 'financeiro', 'criar');
  v_id uuid; v_nome text; v_tipo text; v_doc text;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','nome','tipo','documento','ativa']), false) then return private.erro('invalido'); end if;
  v_id := private.j_uuid(p -> 'id');      if v_id is null then return private.erro('invalido', 'id'); end if;
  v_nome := private.j_texto(p -> 'nome'); if not private.texto_ok(v_nome, 2, 120) then return private.erro('invalido', 'nome'); end if;
  v_tipo := private.j_texto(p -> 'tipo'); if coalesce(v_tipo, '') not in ('fornecedor', 'pagador', 'ambos') then return private.erro('invalido', 'tipo'); end if;
  if not private.vazio(p -> 'documento') then
    v_doc := private.j_texto(p -> 'documento');
    if coalesce(v_doc, '') !~ '^([0-9]{11}|[0-9]{14})$' then return private.erro('invalido', 'documento'); end if;
  end if;
  -- quem só tem "criar" não altera cadastro de outra pessoa
  if exists (select 1 from public.contrapartes c where c.id = v_id and c.criado_por <> auth.uid())
     and not private.pode('financeiro', 'editar') then
    return private.negar('salvar_contraparte');
  end if;
  insert into public.contrapartes (id, nome, tipo, documento, ativa, criado_por)
  values (v_id, v_nome, v_tipo, v_doc, coalesce(private.j_bool(p -> 'ativa'), true), auth.uid())
  on conflict (id) do update set nome = excluded.nome, tipo = excluded.tipo, documento = excluded.documento, ativa = excluded.ativa;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create function private.salvar_centro_custo(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_centro_custo', 'financeiro', 'administrar'); v_id uuid; v_nome text;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','nome','ativo']), false) then return private.erro('invalido'); end if;
  v_id := private.j_uuid(p -> 'id');      if v_id is null then return private.erro('invalido', 'id'); end if;
  v_nome := private.j_texto(p -> 'nome'); if not private.texto_ok(v_nome, 2, 60) then return private.erro('invalido', 'nome'); end if;
  if exists (select 1 from public.centros_custo where lower(nome) = lower(v_nome) and id <> v_id) then return private.erro('duplicado', 'nome'); end if;
  insert into public.centros_custo (id, nome, ativo, criado_por) values (v_id, v_nome, coalesce(private.j_bool(p -> 'ativo'), true), auth.uid())
  on conflict (id) do update set nome = excluded.nome, ativo = excluded.ativo;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create function private.salvar_projeto(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_projeto', 'projetos', 'criar'); v_id uuid; v_nome text;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','nome','ativo']), false) then return private.erro('invalido'); end if;
  v_id := private.j_uuid(p -> 'id');      if v_id is null then return private.erro('invalido', 'id'); end if;
  v_nome := private.j_texto(p -> 'nome'); if not private.texto_ok(v_nome, 2, 120) then return private.erro('invalido', 'nome'); end if;
  insert into public.projetos (id, nome, ativo, criado_por) values (v_id, v_nome, coalesce(private.j_bool(p -> 'ativo'), true), auth.uid())
  on conflict (id) do update set nome = excluded.nome, ativo = excluded.ativo;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
