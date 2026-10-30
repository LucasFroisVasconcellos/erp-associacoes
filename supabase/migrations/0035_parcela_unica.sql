-- 0035: parcela única anual da mensalidade (regra da ata da associação).
-- "a partir de 2024, aqueles que optarem por realizar o pagamento em parcela única, efetivada até
--  o mês de fevereiro de cada ano, terão desconto relativo ao abatimento de duas mensalidades, ou
--  seja, a parcela única equivalerá a 10% do salário mínimo vigente".
-- Regras (o servidor decide):
--  * só categorias em % do salário mínimo oferecem parcela única (percentual da parcela única);
--  * valor = salário mínimo que vale para o fim de fevereiro do ano (regra dos 45 dias, 0032) × %;
--  * pago de 1º de dezembro do ano anterior até o fim de fevereiro do ano, nunca no futuro;
--  * só se nenhuma mensalidade do ano já estiver paga (fail closed: evita cobrar duas vezes);
--  * lança a entrada no Dinheiro e dispensa as mensalidades do ano já geradas, com o motivo;
--  * o gerador de mensalidades pula quem pagou a parcela única do ano.

alter table public.categorias_socio
  add column percentual_parcela_unica numeric(5, 2) check (percentual_parcela_unica is null or percentual_parcela_unica between 0.01 and 1200),
  add constraint parcela_unica_so_em_percentual check (percentual_parcela_unica is null or percentual_salario_minimo is not null);

create table public.parcelas_unicas (
  id uuid primary key,
  pessoa_id uuid not null references public.pessoas (id),
  ano int not null check (ano between 2024 and 2100),
  valor numeric(14, 2) not null check (valor > 0 and valor <= 100000),
  pago_em date not null,
  lancamento_id uuid not null unique references public.lancamentos (id),
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now(),
  unique (pessoa_id, ano)
);
create index parcelas_unicas_criado_por_idx on public.parcelas_unicas (criado_por);
select private.proteger_tabela('public.parcelas_unicas');
create policy ler on public.parcelas_unicas for select to authenticated using ((select private.pode('pessoas', 'ver')) or (select private.pode('financeiro', 'ver')));
create trigger parcelas_unicas_auditar after insert or update or delete on public.parcelas_unicas for each row execute function private.trg_auditar();
create trigger parcelas_unicas_sem_apagar before delete on public.parcelas_unicas for each row execute function private.trg_sem_apagar();

-- último dia de fevereiro do ano (prazo da parcela única)
create function private.fim_fevereiro(p_ano int) returns date
language sql immutable set search_path = '' as $$ select (make_date(p_ano, 3, 1) - 1) $$;

-- valor da parcela única da categoria para o ano; null = categoria sem parcela única ou sem salário mínimo
create function private.valor_parcela_unica(p_categoria uuid, p_ano int) returns numeric
language sql stable set search_path = '' as $$
  select round(private.salario_minimo_para(private.fim_fevereiro(p_ano)) * c.percentual_parcela_unica / 100, 2)
  from public.categorias_socio c where c.id = p_categoria and c.percentual_parcela_unica is not null
$$;

-- categoria: aceita também o percentual da parcela única
create or replace function private.salvar_categoria_socio(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_categoria_socio', 'pessoas', 'editar'); v_id uuid; v_nome text; v_pct numeric; v_valor numeric; v_pu numeric;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','nome','valor_mensalidade','percentual_salario_minimo','percentual_parcela_unica','dia_vencimento','ativa']), false) then return private.erro('invalido'); end if;
  v_id := private.j_uuid(p -> 'id');      if v_id is null then return private.erro('invalido', 'id'); end if;
  v_nome := private.j_texto(p -> 'nome'); if not private.texto_ok(v_nome, 2, 60) then return private.erro('invalido', 'nome'); end if;
  if not private.vazio(p -> 'percentual_salario_minimo') then
    v_pct := private.j_valor(p -> 'percentual_salario_minimo');
    if v_pct is null or v_pct not between 0.01 and 100 then return private.erro('invalido', 'percentual_salario_minimo'); end if;
    if not private.vazio(p -> 'valor_mensalidade') and private.j_valor(p -> 'valor_mensalidade') is distinct from 0 then
      return private.erro('invalido', 'valor_mensalidade');
    end if;
    v_valor := 0;
  else
    v_valor := private.j_valor(p -> 'valor_mensalidade');
    if v_valor is null or v_valor > 100000 then return private.erro('invalido', 'valor_mensalidade'); end if;
  end if;
  if not private.vazio(p -> 'percentual_parcela_unica') then
    v_pu := private.j_valor(p -> 'percentual_parcela_unica');
    -- só em categoria por porcentagem, e mais barata que 12 mensalidades (é desconto, nunca acréscimo)
    if v_pct is null or v_pu is null or v_pu < 0.01 or v_pu > v_pct * 12 then return private.erro('invalido', 'percentual_parcela_unica'); end if;
  end if;
  if coalesce(private.j_inteiro(p -> 'dia_vencimento'), 0) not between 1 and 28 then return private.erro('invalido', 'dia_vencimento'); end if;
  if not private.vazio(p -> 'ativa') and private.j_bool(p -> 'ativa') is null then return private.erro('invalido', 'ativa'); end if;
  if exists (select 1 from public.categorias_socio where lower(nome) = lower(v_nome) and id <> v_id) then return private.erro('duplicado', 'nome'); end if;
  insert into public.categorias_socio (id, nome, valor_mensalidade, percentual_salario_minimo, percentual_parcela_unica, dia_vencimento, ativa, criado_por)
  values (v_id, v_nome, v_valor, v_pct, v_pu, private.j_inteiro(p -> 'dia_vencimento'), coalesce(private.j_bool(p -> 'ativa'), true), auth.uid())
  on conflict (id) do update set nome = excluded.nome, valor_mensalidade = excluded.valor_mensalidade,
    percentual_salario_minimo = excluded.percentual_salario_minimo, percentual_parcela_unica = excluded.percentual_parcela_unica,
    dia_vencimento = excluded.dia_vencimento, ativa = excluded.ativa;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Recebe a parcela única: lança a entrada e dispensa as mensalidades do ano (idempotente pelo id).
create function private.receber_parcela_unica(p_id uuid, p_pessoa uuid, p_ano int, p_lancamento uuid,
  p_conta uuid, p_data date, p_forma text, p_categoria uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('receber_parcela_unica', 'financeiro', 'editar'); x public.pessoas; v_valor numeric; v_m jsonb; v_pu public.parcelas_unicas;
begin
  if v_erro is not null then return v_erro; end if;
  if not private.pode('financeiro', 'criar') then return private.negar('receber_parcela_unica'); end if;
  if p_id is null or p_lancamento is null then return private.erro('invalido', 'id'); end if;
  select * into v_pu from public.parcelas_unicas where id = p_id;
  if v_pu.id is not null then
    if v_pu.lancamento_id = p_lancamento and v_pu.pessoa_id = p_pessoa and v_pu.ano = p_ano then return jsonb_build_object('ok', true, 'repetido', true); end if;
    return private.erro('conflito', 'id');
  end if;
  if p_ano is null or p_ano not between 2024 and extract(year from private.hoje())::int + 1 then return private.erro('invalido', 'ano'); end if;
  if p_data is null or p_data > private.hoje() or p_data < make_date(p_ano - 1, 12, 1) or p_data > private.fim_fevereiro(p_ano) then
    return private.erro('invalido', 'data');
  end if;
  -- trava a pessoa: duas baixas simultâneas da mesma pessoa não passam juntas
  select * into x from public.pessoas where id = p_pessoa for update;
  if x.id is null then return private.erro('nao_encontrado'); end if;
  if not x.associado or x.situacao <> 'ativo' or x.categoria_id is null then return private.erro('invalido', 'pessoa_id'); end if;
  if exists (select 1 from public.parcelas_unicas where pessoa_id = p_pessoa and ano = p_ano) then return private.erro('ja_paga'); end if;
  if exists (select 1 from public.mensalidades where pessoa_id = p_pessoa and situacao = 'paga'
             and competencia between make_date(p_ano, 1, 1) and make_date(p_ano, 12, 1)) then
    return private.erro('ja_paga');
  end if;
  v_valor := private.valor_parcela_unica(x.categoria_id, p_ano);
  if v_valor is null then return private.erro('invalido', 'parcela_unica'); end if;
  if exists (select 1 from public.lancamentos where id = p_lancamento) then return private.erro('conflito', 'id'); end if;
  v_m := jsonb_build_object('tipo', 'entrada', 'situacao', 'realizada', 'valor', v_valor::text, 'data', to_char(p_data, 'YYYY-MM-DD'),
    'descricao', 'Mensalidade parcela única ' || p_ano, 'categoria_id', p_categoria, 'conta_id', p_conta, 'forma_pagamento', p_forma);
  v_erro := private.validar_lancamento(v_m);
  if v_erro is not null then return v_erro; end if;
  if private.mes_fechado(p_data) then return private.erro('mes_fechado', 'data'); end if;
  insert into public.lancamentos (id, tipo, situacao, valor, data, descricao, categoria_id, conta_id, forma_pagamento, detalhes, criado_por, realizado_por, realizado_em)
  values (p_lancamento, 'entrada', 'realizada', v_valor, p_data, v_m ->> 'descricao', p_categoria, p_conta, p_forma, '{}', auth.uid(), auth.uid(), now());
  insert into public.parcelas_unicas (id, pessoa_id, ano, valor, pago_em, lancamento_id, criado_por)
  values (p_id, p_pessoa, p_ano, v_valor, p_data, p_lancamento, auth.uid());
  update public.mensalidades set situacao = 'dispensada', motivo = 'Paga na parcela única de ' || p_ano, atualizado_por = auth.uid(), atualizado_em = now()
  where pessoa_id = p_pessoa and situacao = 'aberta' and competencia between make_date(p_ano, 1, 1) and make_date(p_ano, 12, 1);
  return jsonb_build_object('ok', true, 'valor', v_valor::text, 'lancamento_id', p_lancamento);
end $$;

-- gerador: igual ao da 0032, mas pula quem pagou a parcela única do ano
create or replace function private.gerar_mensalidades(p_competencia date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('gerar_mensalidades', 'pessoas', 'editar'); v_n int;
begin
  if v_erro is not null then return v_erro; end if;
  if p_competencia is null or extract(day from p_competencia) <> 1
     or p_competencia not between (date_trunc('month', private.hoje()) - interval '12 months')::date and (date_trunc('month', private.hoje()) + interval '2 months')::date then
    return private.erro('invalido', 'competencia');
  end if;
  if exists (
    select 1 from public.pessoas x join public.categorias_socio c on c.id = x.categoria_id
    where x.associado and x.situacao = 'ativo' and c.ativa and c.percentual_salario_minimo is not null
      and not exists (select 1 from public.parcelas_unicas u where u.pessoa_id = x.id and u.ano = extract(year from p_competencia)::int)
      and private.salario_minimo_para(make_date(extract(year from p_competencia)::int, extract(month from p_competencia)::int, c.dia_vencimento)) is null
  ) then
    return private.erro('invalido', 'salario_minimo');
  end if;
  insert into public.mensalidades (pessoa_id, competencia, valor, vencimento, atualizado_por)
  select v.id, p_competencia, v.valor, v.vencimento, auth.uid()
  from (
    select x.id, d.vencimento,
           case when c.percentual_salario_minimo is null then c.valor_mensalidade
                else round(private.salario_minimo_para(d.vencimento) * c.percentual_salario_minimo / 100, 2) end as valor
    from public.pessoas x
    join public.categorias_socio c on c.id = x.categoria_id
    cross join lateral (select make_date(extract(year from p_competencia)::int, extract(month from p_competencia)::int, c.dia_vencimento) as vencimento) d
    where x.associado and x.situacao = 'ativo' and c.ativa
      and not exists (select 1 from public.parcelas_unicas u where u.pessoa_id = x.id and u.ano = extract(year from p_competencia)::int)
  ) v
  where v.valor > 0
  on conflict (pessoa_id, competencia) do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'criadas', v_n);
end $$;

insert into private.limites_operacao (operacao, maximo_por_hora) values ('receber_parcela_unica', 200);

create function public.receber_parcela_unica(p_id uuid, p_pessoa uuid, p_ano int, p_lancamento uuid, p_conta uuid, p_data date, p_forma text, p_categoria uuid) returns jsonb
  language sql security invoker set search_path = '' as $$ select private.receber_parcela_unica(p_id, p_pessoa, p_ano, p_lancamento, p_conta, p_data, p_forma, p_categoria) $$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
revoke all on function private.fim_fevereiro(int), private.valor_parcela_unica(uuid, int) from authenticated, service_role, anon;
grant execute on function public.receber_parcela_unica(uuid, uuid, int, uuid, uuid, date, text, uuid) to authenticated;
grant execute on function private.receber_parcela_unica(uuid, uuid, int, uuid, uuid, date, text, uuid) to authenticated;
grant execute on function public.transparencia_publica() to anon;
grant execute on function private.transparencia_publica() to anon;
