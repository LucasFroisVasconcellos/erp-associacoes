-- 0023 · Importação em massa e contabilidade do contador.
--  - plano de contas do contador e ligação de cada categoria a uma conta contábil;
--  - importação de lançamentos antigos (planilha) em lote, tudo ou nada, sem duplicar;
--  - linhas do extrato sem lançamento viram lançamentos já conciliados;
--  - balancete do contador guardado por mês e comparado com o que a diretoria lançou.
-- O aparelho lê os arquivos e manda só os dados; o servidor valida tudo de novo.

create table public.plano_contas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^[0-9]{1,4}(\.[0-9]{1,6}){0,6}$'),
  nome text not null check (private.texto_ok(nome, 2, 120)),
  natureza text not null check (natureza in ('ativo', 'passivo', 'patrimonio', 'receita', 'despesa', 'outra')),
  ativa boolean not null default true,
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now()
);
create index plano_contas_criado_por_idx on public.plano_contas (criado_por);
select private.proteger_tabela('public.plano_contas');
create trigger plano_contas_auditar after insert or update or delete on public.plano_contas for each row execute function private.trg_auditar();
create trigger plano_contas_sem_apagar before delete on public.plano_contas for each row execute function private.trg_sem_apagar();
create policy ler on public.plano_contas for select to authenticated using ((select private.pode('financeiro', 'ver')));

alter table public.categorias add column conta_contabil_id uuid references public.plano_contas (id);
create index categorias_conta_contabil_idx on public.categorias (conta_contabil_id) where conta_contabil_id is not null;

-- Cada arquivo importado vira um lote: dá para saber de onde veio cada lançamento.
create table public.importacoes (
  id uuid primary key,
  tipo text not null check (tipo in ('lancamentos', 'plano_contas', 'balancete', 'extrato')),
  arquivo text not null check (private.texto_ok(arquivo, 1, 160)),
  linhas int not null check (linhas between 0 and 5000),
  competencia date check (competencia is null or extract(day from competencia) = 1),
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now()
);
create index importacoes_criado_por_idx on public.importacoes (criado_por);
create index importacoes_balancete_idx on public.importacoes (competencia, criado_em desc) where tipo = 'balancete';
select private.proteger_tabela('public.importacoes');
create trigger importacoes_auditar after insert or update or delete on public.importacoes for each row execute function private.trg_auditar();
create trigger importacoes_sem_apagar before delete on public.importacoes for each row execute function private.trg_sem_apagar();
create policy ler on public.importacoes for select to authenticated
  using ((select private.pode('financeiro', 'ver')) and (select private.alcance('financeiro', 'ver')) = 'tudo');

alter table public.lancamentos add column importacao_id uuid references public.importacoes (id);
create index lancamentos_importacao_idx on public.lancamentos (importacao_id) where importacao_id is not null;

create table public.balancete_linhas (
  id uuid primary key default gen_random_uuid(),
  importacao_id uuid not null references public.importacoes (id),
  codigo text not null check (codigo ~ '^[0-9]{1,4}(\.[0-9]{1,6}){0,6}$'),
  nome text not null check (private.texto_ok(nome, 1, 160)),
  saldo_anterior numeric(14, 2),
  debito numeric(14, 2) not null default 0 check (debito >= 0),
  credito numeric(14, 2) not null default 0 check (credito >= 0),
  saldo_atual numeric(14, 2),
  unique (importacao_id, codigo)
);
select private.proteger_tabela('public.balancete_linhas');
create trigger balancete_linhas_sem_apagar before delete on public.balancete_linhas for each row execute function private.trg_sem_apagar();
create policy ler on public.balancete_linhas for select to authenticated
  using ((select private.pode('financeiro', 'ver')) and (select private.alcance('financeiro', 'ver')) = 'tudo');

-- Abre o lote; se o mesmo id já existe (envio repetido), devolve false sem erro.
create function private.abrir_lote(p_lote uuid, p_tipo text, p_arquivo text, p_linhas int, p_competencia date default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  insert into public.importacoes (id, tipo, arquivo, linhas, competencia, criado_por)
  values (p_lote, p_tipo, btrim(p_arquivo), p_linhas, p_competencia, auth.uid())
  on conflict (id) do nothing returning id into v;
  return v is not null;
end $$;

create function private.importar_plano_contas(p_lote uuid, p_arquivo text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('importar_plano_contas', 'financeiro', 'administrar'); v_novas int; v_total int;
begin
  if v_erro is not null then return v_erro; end if;
  if p_lote is null or not private.texto_ok(p_arquivo, 1, 160) then return private.erro('invalido', 'arquivo'); end if;
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) not between 1 and 2000 then return private.erro('invalido', 'linhas'); end if;
  if exists (select 1 from jsonb_array_elements(p) x
              where jsonb_typeof(x) <> 'object' or not private.so_chaves(x, array['codigo','nome','natureza'])
                 or coalesce(private.j_texto(x -> 'codigo'), '') !~ '^[0-9]{1,4}(\.[0-9]{1,6}){0,6}$'
                 or not private.texto_ok(private.j_texto(x -> 'nome'), 2, 120)
                 or coalesce(private.j_texto(x -> 'natureza'), '') not in ('ativo','passivo','patrimonio','receita','despesa','outra')) then
    return private.erro('invalido', 'linhas');
  end if;
  if (select count(distinct x ->> 'codigo') from jsonb_array_elements(p) x) <> jsonb_array_length(p) then return private.erro('invalido', 'codigo'); end if;
  v_total := jsonb_array_length(p);
  if not private.abrir_lote(p_lote, 'plano_contas', p_arquivo, v_total) then return jsonb_build_object('ok', true, 'repetido', true); end if;
  with ins as (
    insert into public.plano_contas (codigo, nome, natureza, criado_por)
    select x ->> 'codigo', btrim(x ->> 'nome'), x ->> 'natureza', auth.uid() from jsonb_array_elements(p) x
    on conflict (codigo) do update set nome = excluded.nome, natureza = excluded.natureza, ativa = true
      where (plano_contas.nome, plano_contas.natureza, plano_contas.ativa) is distinct from (excluded.nome, excluded.natureza, true)
    returning (xmax = 0) nova
  ) select count(*) filter (where nova) into v_novas from ins;
  return jsonb_build_object('ok', true, 'novas', v_novas, 'total', v_total);
end $$;

create function private.vincular_categoria_conta(p_categoria uuid, p_conta uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('vincular_categoria_conta', 'financeiro', 'administrar'); c public.categorias; pc public.plano_contas;
begin
  if v_erro is not null then return v_erro; end if;
  select * into c from public.categorias where id = p_categoria for update;
  if c.id is null then return private.erro('nao_encontrado'); end if;
  if p_conta is not null then
    select * into pc from public.plano_contas where id = p_conta;
    -- entrada só em conta de receita; saída só em despesa ("outra" serve para os dois)
    if pc.id is null or not pc.ativa or pc.natureza not in (case c.tipo when 'entrada' then 'receita' else 'despesa' end, 'outra') then
      return private.erro('invalido', 'conta_contabil_id');
    end if;
  end if;
  update public.categorias set conta_contabil_id = p_conta where id = c.id;
  return jsonb_build_object('ok', true);
end $$;

-- Tudo ou nada: valida todas as linhas antes de gravar. O id de cada linha vem do aparelho,
-- calculado a partir do conteúdo da linha: importar o mesmo arquivo de novo não duplica.
create function private.importar_lancamentos(p_lote uuid, p_arquivo text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('importar_lancamentos', 'financeiro', 'administrar');
  x jsonb; n int := 0; v_m jsonb; v_e jsonb; v_problemas jsonb := '[]'; v_novas int := 0; v_id uuid;
begin
  if v_erro is not null then return v_erro; end if;
  if not private.pode('financeiro', 'criar') then return private.negar('importar_lancamentos'); end if;
  if p_lote is null or not private.texto_ok(p_arquivo, 1, 160) then return private.erro('invalido', 'arquivo'); end if;
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) not between 1 and 1000 then return private.erro('invalido', 'linhas'); end if;
  if (select count(distinct y ->> 'id') from jsonb_array_elements(p) y) <> jsonb_array_length(p) then return private.erro('invalido', 'id'); end if;
  for x in select * from jsonb_array_elements(p) loop
    n := n + 1;
    if jsonb_typeof(x) <> 'object' or not coalesce(private.so_chaves(x, array['id','tipo','valor','data','descricao','categoria_id','conta_id','forma_pagamento']), false)
       or private.j_uuid(x -> 'id') is null then
      v_e := private.erro('invalido');
    else
      v_m := (x - 'id') || '{"situacao": "realizada"}';
      v_e := private.validar_lancamento(v_m);
      if v_e is null and private.mes_fechado(private.j_data(v_m -> 'data')) then v_e := private.erro('mes_fechado', 'data'); end if;
    end if;
    if v_e is not null then
      v_problemas := v_problemas || jsonb_build_object('linha', n, 'erro', v_e ->> 'erro', 'campo', v_e ->> 'campo');
      exit when jsonb_array_length(v_problemas) >= 50;
    end if;
  end loop;
  if jsonb_array_length(v_problemas) > 0 then
    return jsonb_build_object('ok', false, 'erro', 'linhas_invalidas', 'problemas', v_problemas);
  end if;
  if not private.abrir_lote(p_lote, 'lancamentos', p_arquivo, jsonb_array_length(p)) then
    return jsonb_build_object('ok', true, 'repetido', true);
  end if;
  for x in select * from jsonb_array_elements(p) loop
    insert into public.lancamentos (id, tipo, situacao, valor, data, descricao, categoria_id, conta_id, forma_pagamento,
      detalhes, criado_por, realizado_por, realizado_em, importacao_id)
    values (private.j_uuid(x -> 'id'), x ->> 'tipo', 'realizada', private.j_valor(x -> 'valor'), private.j_data(x -> 'data'),
      private.j_texto(x -> 'descricao'), private.j_uuid(x -> 'categoria_id'), private.j_uuid(x -> 'conta_id'),
      private.j_texto(x -> 'forma_pagamento'), '{}', auth.uid(), auth.uid(), now(), p_lote)
    on conflict (id) do nothing returning id into v_id;
    if v_id is not null then v_novas := v_novas + 1; end if;
    v_id := null;
  end loop;
  return jsonb_build_object('ok', true, 'novas', v_novas, 'repetidas', jsonb_array_length(p) - v_novas);
end $$;

create function private.lancamento_do_extrato(e public.extrato_linhas, x jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('tipo', case when e.valor > 0 then 'entrada' else 'saida' end, 'situacao', 'realizada',
    'valor', abs(e.valor)::text, 'data', to_char(e.data, 'YYYY-MM-DD'),
    'descricao', coalesce(nullif(btrim(x ->> 'descricao'), ''), e.descricao), 'categoria_id', x -> 'categoria_id', 'conta_id', e.conta_id)
$$;

-- Linhas do extrato sem par viram lançamentos realizados, já conciliados. Tudo ou nada.
create function private.lancar_do_extrato(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('lancar_do_extrato', 'financeiro', 'editar');
  x jsonb; e public.extrato_linhas; v_m jsonb; v_e jsonb; v_n int := 0;
begin
  if v_erro is not null then return v_erro; end if;
  if not private.pode('financeiro', 'criar') or private.alcance('financeiro', 'ver') <> 'tudo' then return private.negar('lancar_do_extrato'); end if;
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) not between 1 and 500 then return private.erro('invalido', 'linhas'); end if;
  if (select count(distinct y ->> 'linha') from jsonb_array_elements(p) y) <> jsonb_array_length(p)
     or (select count(distinct y ->> 'id') from jsonb_array_elements(p) y) <> jsonb_array_length(p) then return private.erro('invalido', 'linhas'); end if;
  -- trava as linhas sempre na mesma ordem (evita deadlock entre duas pessoas)
  perform 1 from public.extrato_linhas where id in (select private.j_uuid(y -> 'linha') from jsonb_array_elements(p) y) order by id for update;
  -- 1ª volta: valida tudo, sem gravar nada (tudo ou nada)
  for x in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(x) <> 'object' or not coalesce(private.so_chaves(x, array['linha','id','categoria_id','descricao']), false)
       or private.j_uuid(x -> 'id') is null or private.j_uuid(x -> 'linha') is null
       or (not private.vazio(x -> 'descricao') and not private.texto_ok(private.j_texto(x -> 'descricao'), 2, 200)) then
      return private.erro('invalido', 'linhas');
    end if;
    select * into e from public.extrato_linhas where id = private.j_uuid(x -> 'linha');
    if e.id is null then return private.erro('nao_encontrado'); end if;
    if e.lancamento_id = private.j_uuid(x -> 'id') then continue; end if; -- já feito (envio repetido)
    if e.lancamento_id is not null or e.ignorada_motivo is not null then return private.erro('ja_conciliada'); end if;
    if exists (select 1 from public.lancamentos where id = private.j_uuid(x -> 'id')) then return private.erro('conflito', 'id'); end if;
    v_e := private.validar_lancamento(private.lancamento_do_extrato(e, x));
    if v_e is null and private.mes_fechado(e.data) then v_e := private.erro('mes_fechado', 'data'); end if;
    if v_e is not null then return v_e || jsonb_build_object('linha', e.id); end if;
  end loop;
  -- 2ª volta: grava e concilia
  for x in select * from jsonb_array_elements(p) loop
    select * into e from public.extrato_linhas where id = private.j_uuid(x -> 'linha');
    if e.lancamento_id is not null then continue; end if;
    v_m := private.lancamento_do_extrato(e, x);
    insert into public.lancamentos (id, tipo, situacao, valor, data, descricao, categoria_id, conta_id, detalhes, criado_por, realizado_por, realizado_em)
    values (private.j_uuid(x -> 'id'), v_m ->> 'tipo', 'realizada', abs(e.valor), e.data, v_m ->> 'descricao', private.j_uuid(x -> 'categoria_id'),
      e.conta_id, '{}', auth.uid(), auth.uid(), now());
    update public.extrato_linhas set lancamento_id = private.j_uuid(x -> 'id'), conciliado_por = auth.uid(), conciliado_em = now() where id = e.id;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'criados', v_n);
end $$;

create function private.importar_balancete(p_lote uuid, p_arquivo text, p_competencia date, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('importar_balancete', 'financeiro', 'editar');
begin
  if v_erro is not null then return v_erro; end if;
  if p_lote is null or not private.texto_ok(p_arquivo, 1, 160) then return private.erro('invalido', 'arquivo'); end if;
  if p_competencia is null or extract(day from p_competencia) <> 1 or p_competencia > private.hoje() or p_competencia < date '2015-01-01' then
    return private.erro('invalido', 'competencia');
  end if;
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) not between 1 and 3000 then return private.erro('invalido', 'linhas'); end if;
  if exists (select 1 from jsonb_array_elements(p) x
              where jsonb_typeof(x) <> 'object' or not private.so_chaves(x, array['codigo','nome','saldo_anterior','debito','credito','saldo_atual'])
                 or coalesce(private.j_texto(x -> 'codigo'), '') !~ '^[0-9]{1,4}(\.[0-9]{1,6}){0,6}$'
                 or not private.texto_ok(private.j_texto(x -> 'nome'), 1, 160)
                 or (not private.vazio(x -> 'saldo_anterior') and private.j_valor(x -> 'saldo_anterior', true) is null)
                 or (not private.vazio(x -> 'saldo_atual') and private.j_valor(x -> 'saldo_atual', true) is null)
                 or (not private.vazio(x -> 'debito') and private.j_valor(x -> 'debito') is null)
                 or (not private.vazio(x -> 'credito') and private.j_valor(x -> 'credito') is null)) then
    return private.erro('invalido', 'linhas');
  end if;
  if (select count(distinct x ->> 'codigo') from jsonb_array_elements(p) x) <> jsonb_array_length(p) then return private.erro('invalido', 'codigo'); end if;
  if not private.abrir_lote(p_lote, 'balancete', p_arquivo, jsonb_array_length(p), p_competencia) then
    return jsonb_build_object('ok', true, 'repetido', true);
  end if;
  insert into public.balancete_linhas (importacao_id, codigo, nome, saldo_anterior, debito, credito, saldo_atual)
  select p_lote, x ->> 'codigo', btrim(x ->> 'nome'), private.j_valor(x -> 'saldo_anterior', true),
         coalesce(private.j_valor(x -> 'debito'), 0), coalesce(private.j_valor(x -> 'credito'), 0), private.j_valor(x -> 'saldo_atual', true)
  from jsonb_array_elements(p) x;
  return jsonb_build_object('ok', true, 'linhas', jsonb_array_length(p));
end $$;

-- Compara o mês: o que o contador fechou (movimento das contas de receita e despesa no
-- balancete mais recente do mês) x o que a diretoria lançou nas categorias ligadas a cada conta.
create function private.comparar_balancete(p_competencia date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('comparar_balancete', 'financeiro', 'ver'); v_lote public.importacoes; v_fim date;
begin
  if v_erro is not null then return v_erro; end if;
  if private.alcance('financeiro', 'ver') <> 'tudo' then return private.negar('comparar_balancete'); end if;
  if p_competencia is null or extract(day from p_competencia) <> 1 then return private.erro('invalido', 'competencia'); end if;
  v_fim := (p_competencia + interval '1 month' - interval '1 day')::date;
  select * into v_lote from public.importacoes where tipo = 'balancete' and competencia = p_competencia order by criado_em desc limit 1;
  return jsonb_build_object('ok', true, 'competencia', p_competencia,
    'balancete', case when v_lote.id is not null then jsonb_build_object('arquivo', v_lote.arquivo, 'importado_em', v_lote.criado_em) end,
    'contas', coalesce((
      select jsonb_agg(jsonb_build_object('codigo', pc.codigo, 'nome', pc.nome, 'natureza', pc.natureza,
               'sistema', s.total::text, 'contador', b.mov::text, 'diferenca', (coalesce(s.total, 0) - coalesce(b.mov, 0))::text) order by pc.codigo)
        from public.plano_contas pc
        left join lateral (select sum(l.valor) total from public.lancamentos l join public.categorias c on c.id = l.categoria_id
                            where c.conta_contabil_id = pc.id and l.situacao = 'realizada' and l.data between p_competencia and v_fim) s on true
        left join lateral (select case pc.natureza when 'receita' then bl.credito - bl.debito else bl.debito - bl.credito end mov
                             from public.balancete_linhas bl where bl.importacao_id = v_lote.id and bl.codigo = pc.codigo) b on true
       where pc.natureza in ('receita', 'despesa') and (s.total is not null or b.mov is not null)), '[]'),
    'categorias_sem_conta', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'tipo', c.tipo) order by c.nome)
        from public.categorias c where c.ativa and c.conta_contabil_id is null), '[]'));
end $$;

insert into private.limites_operacao (operacao, maximo_por_hora) values
  ('importar_plano_contas', 20), ('vincular_categoria_conta', 300), ('importar_lancamentos', 30),
  ('lancar_do_extrato', 60), ('importar_balancete', 20), ('comparar_balancete', 120);

create function public.importar_plano_contas(p_lote uuid, p_arquivo text, p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.importar_plano_contas(p_lote, p_arquivo, p) $$;
create function public.vincular_categoria_conta(p_categoria uuid, p_conta uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.vincular_categoria_conta(p_categoria, p_conta) $$;
create function public.importar_lancamentos(p_lote uuid, p_arquivo text, p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.importar_lancamentos(p_lote, p_arquivo, p) $$;
create function public.lancar_do_extrato(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.lancar_do_extrato(p) $$;
create function public.importar_balancete(p_lote uuid, p_arquivo text, p_competencia date, p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.importar_balancete(p_lote, p_arquivo, p_competencia, p) $$;
create function public.comparar_balancete(p_competencia date) returns jsonb language sql security invoker set search_path = '' as $$ select private.comparar_balancete(p_competencia) $$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
do $$
declare f text;
begin
  foreach f in array array['importar_plano_contas(uuid,text,jsonb)','vincular_categoria_conta(uuid,uuid)','importar_lancamentos(uuid,text,jsonb)',
                           'lancar_do_extrato(jsonb)','importar_balancete(uuid,text,date,jsonb)','comparar_balancete(date)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('grant execute on function private.%s to authenticated', f);
  end loop;
end $$;
