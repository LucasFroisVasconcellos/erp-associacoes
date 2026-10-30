-- 0004 · Livro caixa: lançamentos (entradas/saídas, previstas/realizadas), estorno,
-- reembolsos, recorrências e a trava de mês fechado.
-- Regras: nada se apaga (estorno cria o inverso); mês fechado não aceita mudança;
-- valores e datas validados no servidor; criação idempotente pelo id do cliente.

create table public.fechamentos (
  competencia date primary key check (extract(day from competencia) = 1),
  fechado_por uuid not null references public.membros (id),
  fechado_em timestamptz not null default now(),
  confirmacoes jsonb not null default '{}',
  resumo jsonb not null default '{}'
);
create index fechamentos_fechado_por_idx on public.fechamentos (fechado_por);

-- volatile de propósito: dentro de gatilhos, cada chamada enxerga o fechamento mais recente
create function private.mes_fechado(d date) returns boolean
language sql volatile security definer set search_path = '' as $$
  select exists (select 1 from public.fechamentos f where f.competencia = date_trunc('month', d)::date)
$$;

create table public.recorrencias (
  id uuid primary key,
  tipo text not null check (tipo in ('entrada', 'saida')),
  descricao text not null check (private.texto_ok(descricao, 2, 200)),
  valor numeric(14, 2) not null check (valor > 0 and valor <= 10000000),
  categoria_id uuid not null references public.categorias (id),
  conta_id uuid references public.contas_bancarias (id),
  contraparte_id uuid references public.contrapartes (id),
  forma_pagamento text,
  dia int not null check (dia between 1 and 28),
  inicio date not null,
  fim date check (fim is null or fim >= inicio),
  ativa boolean not null default true,
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now()
);

create function private.formas_pagamento() returns text[] language sql immutable set search_path = '' as $$
  select array['pix','dinheiro','cartao_debito','cartao_credito','boleto','transferencia','debito_automatico','outro']
$$;

create table public.lancamentos (
  id uuid primary key,
  tipo text not null check (tipo in ('entrada', 'saida')),
  situacao text not null check (situacao in ('prevista', 'realizada', 'cancelada')),
  valor numeric(14, 2) not null check (valor > 0 and valor <= 10000000),
  data date not null,
  vencimento date,
  data_documento date,
  descricao text not null check (private.texto_ok(descricao, 2, 200)),
  categoria_id uuid not null references public.categorias (id),
  conta_id uuid references public.contas_bancarias (id),
  forma_pagamento text check (forma_pagamento is null or forma_pagamento = any (private.formas_pagamento())),
  contraparte_id uuid references public.contrapartes (id),
  centro_custo_id uuid references public.centros_custo (id),
  projeto_id uuid references public.projetos (id),
  tipo_gasto_id uuid references public.tipos_gasto (id),
  detalhes jsonb not null default '{}',
  recorrencia_id uuid references public.recorrencias (id),
  estorno_de uuid unique references public.lancamentos (id),
  motivo text check (private.texto_opcional_ok(motivo, 300)),
  sem_comprovante_motivo text check (private.texto_opcional_ok(sem_comprovante_motivo, 300)),
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  realizado_por uuid references public.membros (id),
  realizado_em timestamptz,
  check (situacao <> 'realizada' or conta_id is not null)
);
create index lancamentos_data_idx on public.lancamentos (data desc);
create index lancamentos_previstas_idx on public.lancamentos (data) where situacao = 'prevista';
create index lancamentos_criado_por_idx on public.lancamentos (criado_por, data desc);
create index lancamentos_categoria_idx on public.lancamentos (categoria_id);
create index lancamentos_conta_idx on public.lancamentos (conta_id, situacao);
create index lancamentos_contraparte_idx on public.lancamentos (contraparte_id) where contraparte_id is not null;
create index lancamentos_centro_idx on public.lancamentos (centro_custo_id) where centro_custo_id is not null;
create index lancamentos_projeto_idx on public.lancamentos (projeto_id) where projeto_id is not null;
create index lancamentos_tipo_gasto_idx on public.lancamentos (tipo_gasto_id) where tipo_gasto_id is not null;
create index lancamentos_realizado_por_idx on public.lancamentos (realizado_por) where realizado_por is not null;
create unique index lancamentos_recorrencia_unica on public.lancamentos (recorrencia_id, vencimento)
  where recorrencia_id is not null;

create index recorrencias_categoria_idx on public.recorrencias (categoria_id);
create index recorrencias_conta_idx on public.recorrencias (conta_id) where conta_id is not null;
create index recorrencias_contraparte_idx on public.recorrencias (contraparte_id) where contraparte_id is not null;
create index recorrencias_criado_por_idx on public.recorrencias (criado_por);

create table public.reembolsos (
  lancamento_id uuid primary key references public.lancamentos (id),
  solicitante uuid not null references public.membros (id),
  situacao text not null default 'solicitado' check (situacao in ('solicitado', 'pago', 'negado')),
  decidido_por uuid references public.membros (id),
  decidido_em timestamptz,
  motivo text check (private.texto_opcional_ok(motivo, 300)),
  criado_em timestamptz not null default now()
);
create index reembolsos_solicitante_idx on public.reembolsos (solicitante);
create index reembolsos_decidido_por_idx on public.reembolsos (decidido_por) where decidido_por is not null;
create index reembolsos_abertos_idx on public.reembolsos (criado_em) where situacao = 'solicitado';

-- Trava: nada se apaga; lançamento realizado em mês fechado não muda; não se lança em mês fechado.
create function private.trg_trava_lancamento() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Lançamento não se apaga: use o estorno' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.situacao = 'realizada' and private.mes_fechado(old.data) then
    raise exception 'Lançamento de mês fechado não pode ser alterado' using errcode = '42501';
  end if;
  if new.situacao = 'realizada' and private.mes_fechado(new.data) then
    raise exception 'Não é possível lançar em mês fechado' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger lancamentos_trava before insert or update or delete on public.lancamentos
  for each row execute function private.trg_trava_lancamento();
create trigger fechamentos_sem_apagar before update or delete on public.fechamentos
  for each row execute function private.bloquear_auditoria();

do $$ declare t text; begin
  foreach t in array array['fechamentos','recorrencias','lancamentos','reembolsos'] loop
    perform private.proteger_tabela(format('public.%I', t)::regclass);
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function private.trg_auditar()', t || '_auditar', t);
  end loop;
end $$;

create policy ler on public.lancamentos for select to authenticated
  using ((select private.pode('financeiro', 'ver'))
         and ((select private.alcance('financeiro', 'ver')) = 'tudo' or criado_por = (select auth.uid())));
create policy ler on public.reembolsos for select to authenticated
  using ((select private.pode('financeiro', 'ver'))
         and ((select private.alcance('financeiro', 'ver')) = 'tudo' or solicitante = (select auth.uid())));
create policy ler on public.recorrencias for select to authenticated
  using ((select private.pode('financeiro', 'ver')) and (select private.alcance('financeiro', 'ver')) = 'tudo');
create policy ler on public.fechamentos for select to authenticated
  using ((select private.pode('financeiro', 'ver')));

-- Detalhes da descrição guiada conferidos contra os campos do tipo de gasto.
create function private.detalhes_validos(p_campos jsonb, d jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(d) = 'object'
     and not exists (select 1 from jsonb_object_keys(d) k
                     where not exists (select 1 from jsonb_array_elements(p_campos) c where c ->> 'chave' = k))
     and not exists (
       select 1 from jsonb_array_elements(p_campos) c
       where (private.j_bool(c -> 'obrigatorio') and (private.vazio(d -> (c ->> 'chave')) or d ->> (c ->> 'chave') = ''))
          or (not private.vazio(d -> (c ->> 'chave')) and not case c ->> 'tipo'
                when 'texto' then jsonb_typeof(d -> (c ->> 'chave')) = 'string' and private.texto_opcional_ok(d ->> (c ->> 'chave'), 200)
                when 'numero' then (d ->> (c ->> 'chave')) ~ '^[0-9]{1,9}([.][0-9]{1,3})?$'
                when 'inteiro' then (d ->> (c ->> 'chave')) ~ '^[0-9]{1,9}$'
                when 'data' then private.j_data(d -> (c ->> 'chave')) is not null
                else false end))
$$;

-- Valida um lançamento completo (já mesclado). Devolve o erro, ou null se está válido.
-- m: tipo, situacao, valor (texto), data (texto), descricao, categoria_id, conta_id, forma_pagamento,
--    contraparte_id, centro_custo_id, projeto_id, tipo_gasto_id, detalhes, data_documento
create function private.validar_lancamento(m jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tipo text := private.j_texto(m -> 'tipo');
  v_sit text := private.j_texto(m -> 'situacao');
  v_valor numeric := private.j_valor(m -> 'valor');
  v_data date := private.j_data(m -> 'data');
  v_cat public.categorias; v_conta public.contas_bancarias; v_tg public.tipos_gasto; v_uuid uuid;
begin
  if coalesce(v_tipo, '') not in ('entrada', 'saida') then return private.erro('invalido', 'tipo'); end if;
  if coalesce(v_sit, '') not in ('prevista', 'realizada') then return private.erro('invalido', 'situacao'); end if;
  if v_valor is null or v_valor <= 0 or v_valor > 10000000 then return private.erro('invalido', 'valor'); end if;
  if v_data is null then return private.erro('invalido', 'data'); end if;
  if v_sit = 'realizada' and (v_data > private.hoje() or v_data < date '2020-01-01') then return private.erro('invalido', 'data'); end if;
  if v_sit = 'prevista' and (v_data < private.hoje() - 400 or v_data > private.hoje() + 730) then return private.erro('invalido', 'data'); end if;
  if not private.texto_ok(private.j_texto(m -> 'descricao'), 2, 200) then return private.erro('invalido', 'descricao'); end if;

  select * into v_cat from public.categorias where id = private.j_uuid(m -> 'categoria_id');
  if v_cat.id is null or not v_cat.ativa or v_cat.tipo <> v_tipo then return private.erro('invalido', 'categoria_id'); end if;

  if not private.vazio(m -> 'conta_id') then
    select * into v_conta from public.contas_bancarias where id = private.j_uuid(m -> 'conta_id');
    if v_conta.id is null or not v_conta.ativa then return private.erro('invalido', 'conta_id'); end if;
    if v_sit = 'realizada' and v_data < v_conta.data_saldo_inicial then return private.erro('invalido', 'data'); end if;
  elsif v_sit = 'realizada' then
    return private.erro('invalido', 'conta_id');
  end if;

  if not private.vazio(m -> 'forma_pagamento')
     and not (coalesce(private.j_texto(m -> 'forma_pagamento'), '') = any (private.formas_pagamento())) then
    return private.erro('invalido', 'forma_pagamento');
  end if;
  if not private.vazio(m -> 'contraparte_id') then
    v_uuid := private.j_uuid(m -> 'contraparte_id');
    if v_uuid is null or not exists (select 1 from public.contrapartes where id = v_uuid and ativa) then return private.erro('invalido', 'contraparte_id'); end if;
  end if;
  if not private.vazio(m -> 'centro_custo_id') then
    v_uuid := private.j_uuid(m -> 'centro_custo_id');
    if v_uuid is null or not exists (select 1 from public.centros_custo where id = v_uuid and ativo) then return private.erro('invalido', 'centro_custo_id'); end if;
  end if;
  if not private.vazio(m -> 'projeto_id') then
    v_uuid := private.j_uuid(m -> 'projeto_id');
    if v_uuid is null or not exists (select 1 from public.projetos where id = v_uuid and ativo) then return private.erro('invalido', 'projeto_id'); end if;
  end if;
  if not private.vazio(m -> 'data_documento') then
    if private.j_data(m -> 'data_documento') is null or private.j_data(m -> 'data_documento') > private.hoje() then
      return private.erro('invalido', 'data_documento');
    end if;
  end if;

  if not private.vazio(m -> 'tipo_gasto_id') then
    select * into v_tg from public.tipos_gasto where id = private.j_uuid(m -> 'tipo_gasto_id');
    if v_tg.id is null or not v_tg.ativo then return private.erro('invalido', 'tipo_gasto_id'); end if;
    if not private.detalhes_validos(v_tg.campos, coalesce(m -> 'detalhes', '{}'::jsonb)) then return private.erro('invalido', 'detalhes'); end if;
  elsif not private.vazio(m -> 'detalhes') and m -> 'detalhes' <> '{}'::jsonb then
    return private.erro('invalido', 'detalhes');
  end if;
  return null;
end $$;

create function private.criar_lancamento(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('criar_lancamento', 'financeiro', 'criar');
  v_id uuid; v_dono uuid; v_reembolso boolean; v_m jsonb; v_inserido uuid;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','tipo','situacao','valor','data','descricao','categoria_id','conta_id',
       'forma_pagamento','contraparte_id','centro_custo_id','projeto_id','tipo_gasto_id','detalhes','reembolso','data_documento']), false) then
    return private.erro('invalido');
  end if;
  v_id := private.j_uuid(p -> 'id');
  if v_id is null then return private.erro('invalido', 'id'); end if;

  -- idempotência: o mesmo id enviado de novo (clique duplo, nova tentativa) não duplica
  select criado_por into v_dono from public.lancamentos where id = v_id;
  if v_dono is not null then
    if v_dono = auth.uid() then return jsonb_build_object('ok', true, 'id', v_id, 'repetido', true); end if;
    return private.erro('conflito', 'id');
  end if;

  v_reembolso := coalesce(private.j_bool(p -> 'reembolso'), false);
  if not private.vazio(p -> 'reembolso') and private.j_bool(p -> 'reembolso') is null then return private.erro('invalido', 'reembolso'); end if;
  v_m := p - 'id' - 'reembolso';
  if v_reembolso then
    if private.j_texto(p -> 'tipo') <> 'saida' then return private.erro('invalido', 'reembolso'); end if;
    -- quem pagou do bolso: a saída fica prevista até o tesoureiro decidir; a data é a do gasto
    v_m := jsonb_set(v_m, '{situacao}', '"prevista"');
    if private.j_data(p -> 'data') is null or private.j_data(p -> 'data') > private.hoje() then return private.erro('invalido', 'data'); end if;
    v_m := jsonb_set(v_m, '{data_documento}', p -> 'data');
    v_m := v_m - 'conta_id';
  end if;
  v_erro := private.validar_lancamento(v_m);
  if v_erro is not null then return v_erro; end if;
  if private.j_texto(v_m -> 'situacao') = 'realizada' and private.mes_fechado(private.j_data(v_m -> 'data')) then
    return private.erro('mes_fechado', 'data');
  end if;

  insert into public.lancamentos (id, tipo, situacao, valor, data, vencimento, data_documento, descricao, categoria_id, conta_id,
    forma_pagamento, contraparte_id, centro_custo_id, projeto_id, tipo_gasto_id, detalhes, criado_por, realizado_por, realizado_em)
  values (v_id, v_m ->> 'tipo', v_m ->> 'situacao', private.j_valor(v_m -> 'valor'), private.j_data(v_m -> 'data'),
    case when v_m ->> 'situacao' = 'prevista' then private.j_data(v_m -> 'data') end,
    private.j_data(v_m -> 'data_documento'), private.j_texto(v_m -> 'descricao'), private.j_uuid(v_m -> 'categoria_id'),
    private.j_uuid(v_m -> 'conta_id'), private.j_texto(v_m -> 'forma_pagamento'), private.j_uuid(v_m -> 'contraparte_id'),
    private.j_uuid(v_m -> 'centro_custo_id'), private.j_uuid(v_m -> 'projeto_id'), private.j_uuid(v_m -> 'tipo_gasto_id'),
    coalesce(nullif(v_m -> 'detalhes', 'null'::jsonb), '{}'::jsonb), auth.uid(),
    case when v_m ->> 'situacao' = 'realizada' then auth.uid() end,
    case when v_m ->> 'situacao' = 'realizada' then now() end)
  on conflict (id) do nothing
  returning id into v_inserido;

  if v_inserido is null then
    -- outra requisição com o mesmo id venceu a corrida
    select criado_por into v_dono from public.lancamentos where id = v_id;
    if v_dono = auth.uid() then return jsonb_build_object('ok', true, 'id', v_id, 'repetido', true); end if;
    return private.erro('conflito', 'id');
  end if;
  if v_reembolso then
    insert into public.reembolsos (lancamento_id, solicitante) values (v_id, auth.uid());
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'repetido', false);
end $$;

create function private.lancamento_json(l public.lancamentos) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('tipo', l.tipo, 'situacao', l.situacao, 'valor', l.valor::text, 'data', to_char(l.data, 'YYYY-MM-DD'),
    'descricao', l.descricao, 'categoria_id', l.categoria_id, 'conta_id', l.conta_id, 'forma_pagamento', l.forma_pagamento,
    'contraparte_id', l.contraparte_id, 'centro_custo_id', l.centro_custo_id, 'projeto_id', l.projeto_id,
    'tipo_gasto_id', l.tipo_gasto_id, 'detalhes', l.detalhes, 'data_documento', to_char(l.data_documento, 'YYYY-MM-DD'))
$$;

create function private.editar_lancamento(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('editar_lancamento', 'financeiro', 'ver');
  l public.lancamentos; v_m jsonb;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['valor','data','descricao','categoria_id','conta_id','forma_pagamento',
       'contraparte_id','centro_custo_id','projeto_id','tipo_gasto_id','detalhes','data_documento']), false) then
    return private.erro('invalido');
  end if;
  select * into l from public.lancamentos where id = p_id for update;
  if l.id is null then return private.erro('nao_encontrado'); end if;
  if not (private.pode('financeiro', 'editar')
          or (l.criado_por = auth.uid() and private.pode('financeiro', 'criar'))) then
    return private.negar('editar_lancamento');
  end if;
  if l.situacao = 'cancelada' or l.estorno_de is not null
     or exists (select 1 from public.lancamentos e where e.estorno_de = l.id) then
    return private.erro('invalido', 'situacao');
  end if;
  if exists (select 1 from public.reembolsos r where r.lancamento_id = l.id and r.situacao <> 'solicitado') then
    return private.erro('invalido', 'situacao');
  end if;
  if l.situacao = 'realizada' and private.mes_fechado(l.data) then return private.erro('mes_fechado'); end if;

  v_m := private.lancamento_json(l) || p;
  v_erro := private.validar_lancamento(v_m);
  if v_erro is not null then return v_erro; end if;
  if l.situacao = 'realizada' and private.mes_fechado(private.j_data(v_m -> 'data')) then return private.erro('mes_fechado', 'data'); end if;

  update public.lancamentos set
    valor = private.j_valor(v_m -> 'valor'), data = private.j_data(v_m -> 'data'),
    vencimento = case when situacao = 'prevista' then private.j_data(v_m -> 'data') else vencimento end,
    descricao = private.j_texto(v_m -> 'descricao'), categoria_id = private.j_uuid(v_m -> 'categoria_id'),
    conta_id = private.j_uuid(v_m -> 'conta_id'), forma_pagamento = private.j_texto(v_m -> 'forma_pagamento'),
    contraparte_id = private.j_uuid(v_m -> 'contraparte_id'), centro_custo_id = private.j_uuid(v_m -> 'centro_custo_id'),
    projeto_id = private.j_uuid(v_m -> 'projeto_id'), tipo_gasto_id = private.j_uuid(v_m -> 'tipo_gasto_id'),
    detalhes = coalesce(nullif(v_m -> 'detalhes', 'null'::jsonb), '{}'::jsonb),
    data_documento = private.j_data(v_m -> 'data_documento'), atualizado_em = now()
  where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

create function private.estornar_lancamento(p_id uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('estornar_lancamento', 'financeiro', 'editar'); l public.lancamentos; v_novo uuid := gen_random_uuid();
begin
  if v_erro is not null then return v_erro; end if;
  if not private.texto_ok(p_motivo, 3, 300) then return private.erro('invalido', 'motivo'); end if;
  select * into l from public.lancamentos where id = p_id for update;  -- serializa estornos simultâneos
  if l.id is null then return private.erro('nao_encontrado'); end if;
  if l.estorno_de is not null or l.situacao <> 'realizada' then return private.erro('invalido', 'situacao'); end if;
  if exists (select 1 from public.lancamentos e where e.estorno_de = l.id) then return private.erro('ja_estornado'); end if;
  if private.mes_fechado(private.hoje()) then return private.erro('mes_fechado'); end if;
  insert into public.lancamentos (id, tipo, situacao, valor, data, descricao, categoria_id, conta_id, forma_pagamento,
    contraparte_id, centro_custo_id, projeto_id, estorno_de, motivo, criado_por, realizado_por, realizado_em)
  values (v_novo, case l.tipo when 'entrada' then 'saida' else 'entrada' end, 'realizada', l.valor, private.hoje(),
    left('Estorno: ' || l.descricao, 200), l.categoria_id, l.conta_id, l.forma_pagamento, l.contraparte_id,
    l.centro_custo_id, l.projeto_id, l.id, btrim(p_motivo), auth.uid(), auth.uid(), now());
  return jsonb_build_object('ok', true, 'estorno_id', v_novo);
end $$;

create function private.realizar_lancamento(p_id uuid, p_data date, p_conta_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('realizar_lancamento', 'financeiro', 'aprovar'); l public.lancamentos; c public.contas_bancarias;
begin
  if v_erro is not null then return v_erro; end if;
  select * into l from public.lancamentos where id = p_id for update;
  if l.id is null then return private.erro('nao_encontrado'); end if;
  if l.situacao <> 'prevista' then return private.erro('invalido', 'situacao'); end if;
  if exists (select 1 from public.reembolsos r where r.lancamento_id = l.id) then return private.erro('use_reembolso'); end if;
  select * into c from public.contas_bancarias where id = p_conta_id;
  if c.id is null or not c.ativa then return private.erro('invalido', 'conta_id'); end if;
  if p_data is null or p_data > private.hoje() or p_data < c.data_saldo_inicial then return private.erro('invalido', 'data'); end if;
  if private.mes_fechado(p_data) then return private.erro('mes_fechado', 'data'); end if;
  update public.lancamentos set situacao = 'realizada', vencimento = coalesce(vencimento, data), data = p_data,
    conta_id = p_conta_id, realizado_por = auth.uid(), realizado_em = now(), atualizado_em = now()
  where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create function private.cancelar_lancamento(p_id uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('cancelar_lancamento', 'financeiro', 'ver'); l public.lancamentos;
begin
  if v_erro is not null then return v_erro; end if;
  if not private.texto_ok(p_motivo, 3, 300) then return private.erro('invalido', 'motivo'); end if;
  select * into l from public.lancamentos where id = p_id for update;
  if l.id is null then return private.erro('nao_encontrado'); end if;
  if not (private.pode('financeiro', 'editar') or (l.criado_por = auth.uid() and private.pode('financeiro', 'criar'))) then
    return private.negar('cancelar_lancamento');
  end if;
  if l.situacao <> 'prevista' then return private.erro('invalido', 'situacao'); end if;
  if exists (select 1 from public.reembolsos r where r.lancamento_id = l.id) then return private.erro('use_reembolso'); end if;
  update public.lancamentos set situacao = 'cancelada', motivo = btrim(p_motivo), atualizado_em = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create function private.justificar_sem_comprovante(p_id uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('justificar_sem_comprovante', 'financeiro', 'aprovar'); l public.lancamentos;
begin
  if v_erro is not null then return v_erro; end if;
  if not private.texto_ok(p_motivo, 3, 300) then return private.erro('invalido', 'motivo'); end if;
  select * into l from public.lancamentos where id = p_id for update;
  if l.id is null then return private.erro('nao_encontrado'); end if;
  if l.tipo <> 'saida' or l.situacao <> 'realizada' then return private.erro('invalido', 'situacao'); end if;
  if private.mes_fechado(l.data) then return private.erro('mes_fechado'); end if;
  update public.lancamentos set sem_comprovante_motivo = btrim(p_motivo), atualizado_em = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create function private.decidir_reembolso(p_id uuid, p_aprovar boolean, p_conta_id uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('decidir_reembolso', 'financeiro', 'aprovar'); r public.reembolsos; c public.contas_bancarias;
begin
  if v_erro is not null then return v_erro; end if;
  if p_aprovar is null then return private.erro('invalido', 'aprovar'); end if;
  select * into r from public.reembolsos where lancamento_id = p_id for update;
  if r.lancamento_id is null then return private.erro('nao_encontrado'); end if;
  if r.situacao <> 'solicitado' then return private.erro('invalido', 'situacao'); end if;
  if r.solicitante = auth.uid() then return private.negar('decidir_reembolso', 'proprio_reembolso'); end if;
  if p_aprovar then
    select * into c from public.contas_bancarias where id = p_conta_id;
    if c.id is null or not c.ativa then return private.erro('invalido', 'conta_id'); end if;
    if private.mes_fechado(private.hoje()) then return private.erro('mes_fechado'); end if;
    update public.lancamentos set situacao = 'realizada', vencimento = coalesce(vencimento, data), data = private.hoje(),
      conta_id = p_conta_id, realizado_por = auth.uid(), realizado_em = now(), atualizado_em = now()
    where id = p_id;
    update public.reembolsos set situacao = 'pago', decidido_por = auth.uid(), decidido_em = now(), motivo = nullif(btrim(p_motivo), '')
    where lancamento_id = p_id;
  else
    if not private.texto_ok(p_motivo, 3, 300) then return private.erro('invalido', 'motivo'); end if;
    update public.lancamentos set situacao = 'cancelada', motivo = btrim(p_motivo), atualizado_em = now() where id = p_id;
    update public.reembolsos set situacao = 'negado', decidido_por = auth.uid(), decidido_em = now(), motivo = btrim(p_motivo)
    where lancamento_id = p_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create function private.salvar_recorrencia(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('salvar_recorrencia', 'financeiro', 'administrar');
  v_id uuid; v_dia int; v_inicio date; v_fim date; v_m jsonb;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','tipo','descricao','valor','categoria_id','conta_id','contraparte_id',
       'forma_pagamento','dia','inicio','fim','ativa']), false) then
    return private.erro('invalido');
  end if;
  v_id := private.j_uuid(p -> 'id');            if v_id is null then return private.erro('invalido', 'id'); end if;
  v_dia := private.j_inteiro(p -> 'dia');       if v_dia is null or v_dia not between 1 and 28 then return private.erro('invalido', 'dia'); end if;
  v_inicio := private.j_data(p -> 'inicio');    if v_inicio is null then return private.erro('invalido', 'inicio'); end if;
  if not private.vazio(p -> 'fim') then
    v_fim := private.j_data(p -> 'fim');
    if v_fim is null or v_fim < v_inicio then return private.erro('invalido', 'fim'); end if;
  end if;
  -- reaproveita a validação de lançamento (como se fosse uma prevista hoje)
  v_m := jsonb_build_object('tipo', p -> 'tipo', 'situacao', 'prevista', 'valor', p -> 'valor',
           'data', to_char(private.hoje(), 'YYYY-MM-DD'), 'descricao', p -> 'descricao', 'categoria_id', p -> 'categoria_id',
           'conta_id', p -> 'conta_id', 'contraparte_id', p -> 'contraparte_id', 'forma_pagamento', p -> 'forma_pagamento');
  v_erro := private.validar_lancamento(v_m);
  if v_erro is not null then return v_erro; end if;
  insert into public.recorrencias (id, tipo, descricao, valor, categoria_id, conta_id, contraparte_id, forma_pagamento, dia, inicio, fim, ativa, criado_por)
  values (v_id, p ->> 'tipo', private.j_texto(p -> 'descricao'), private.j_valor(p -> 'valor'), private.j_uuid(p -> 'categoria_id'),
          private.j_uuid(p -> 'conta_id'), private.j_uuid(p -> 'contraparte_id'), private.j_texto(p -> 'forma_pagamento'),
          v_dia, v_inicio, v_fim, coalesce(private.j_bool(p -> 'ativa'), true), auth.uid())
  on conflict (id) do update set tipo = excluded.tipo, descricao = excluded.descricao, valor = excluded.valor,
    categoria_id = excluded.categoria_id, conta_id = excluded.conta_id, contraparte_id = excluded.contraparte_id,
    forma_pagamento = excluded.forma_pagamento, dia = excluded.dia, inicio = excluded.inicio, fim = excluded.fim, ativa = excluded.ativa;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Gera as previstas futuras das recorrências (idempotente: índice único por recorrência + vencimento).
create function private.gerar_previstos(p_ate date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('gerar_previstos', 'financeiro', 'ver'); v_ate date; v_n int;
begin
  if v_erro is not null then return v_erro; end if;
  v_ate := least(coalesce(p_ate, private.hoje() + 60), private.hoje() + 120);
  insert into public.lancamentos (id, tipo, situacao, valor, data, vencimento, descricao, categoria_id, conta_id,
                                  contraparte_id, forma_pagamento, recorrencia_id, criado_por)
  select gen_random_uuid(), r.tipo, 'prevista', r.valor, v.venc, v.venc, r.descricao, r.categoria_id, r.conta_id,
         r.contraparte_id, r.forma_pagamento, r.id, r.criado_por
  from public.recorrencias r
  cross join lateral (
    select make_date(extract(year from m)::int, extract(month from m)::int, r.dia) as venc
    from generate_series(date_trunc('month', greatest(r.inicio, private.hoje())), date_trunc('month', v_ate), interval '1 month') m
  ) v
  where r.ativa and v.venc >= greatest(r.inicio, private.hoje()) and v.venc <= v_ate and (r.fim is null or v.venc <= r.fim)
  on conflict (recorrencia_id, vencimento) where recorrencia_id is not null do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'criados', v_n);
end $$;
