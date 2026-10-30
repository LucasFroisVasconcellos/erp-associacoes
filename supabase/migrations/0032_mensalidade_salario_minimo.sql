-- 0032: mensalidade como porcentagem do salário mínimo (regra da ata da associação).
-- A ata fixou a mensalidade em 1% do salário mínimo vigente (parcela única anual: 10%).
-- 1) Tabela de salários mínimos por data de vigência (histórico: reajuste não mexe no passado).
-- 2) Categoria de sócio cobra um valor fixo OU uma porcentagem do salário mínimo.
-- 3) Ao gerar, o servidor calcula o valor. Pelo estatuto, entre a majoração e a primeira
--    cobrança há no mínimo 45 dias — então vale o salário mínimo vigente 45 dias antes do vencimento.
--    Sem salário mínimo cadastrado para a data, nada é gerado (fail closed).

create table public.salarios_minimos (
  vigente_desde date primary key check (vigente_desde >= date '2000-01-01'),
  valor numeric(14, 2) not null check (valor between 100 and 100000),
  atualizado_por uuid references public.membros (id), -- nulo: valor oficial que veio com o sistema
  atualizado_em timestamptz not null default now()
);
create index salarios_minimos_atualizado_por_idx on public.salarios_minimos (atualizado_por) where atualizado_por is not null;
select private.proteger_tabela('public.salarios_minimos');
create policy ler on public.salarios_minimos for select to authenticated using ((select private.pode('pessoas', 'ver')) or (select private.pode('financeiro', 'ver')));
create trigger salarios_minimos_auditar after insert or update or delete on public.salarios_minimos for each row execute function private.trg_auditar();

-- valores oficiais (decretos federais): R$ 1.518 em 2025 e R$ 1.621 em 2026
insert into public.salarios_minimos (vigente_desde, valor) values ('2025-01-01', 1518.00), ('2026-01-01', 1621.00);

-- O salário mínimo que vale para uma cobrança com esse vencimento (regra dos 45 dias).
create function private.salario_minimo_para(p_vencimento date) returns numeric
language sql stable set search_path = '' as $$
  select s.valor from public.salarios_minimos s
  where s.vigente_desde <= p_vencimento - 45
  order by s.vigente_desde desc limit 1
$$;

create function private.salvar_salario_minimo(p_vigente_desde date, p_valor text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_salario_minimo', 'pessoas', 'editar'); v_valor numeric;
begin
  if v_erro is not null then return v_erro; end if;
  if p_vigente_desde is null or p_vigente_desde < date '2000-01-01' or p_vigente_desde > private.hoje() + 366 then
    return private.erro('invalido', 'vigente_desde');
  end if;
  v_valor := private.j_valor(to_jsonb(p_valor));
  if v_valor is null or v_valor not between 100 and 100000 then return private.erro('invalido', 'salario_minimo'); end if;
  insert into public.salarios_minimos (vigente_desde, valor, atualizado_por) values (p_vigente_desde, v_valor, auth.uid())
  on conflict (vigente_desde) do update set valor = excluded.valor, atualizado_por = excluded.atualizado_por, atualizado_em = now()
    where salarios_minimos.valor is distinct from excluded.valor;
  return jsonb_build_object('ok', true);
end $$;

-- nulo: valor fixo (valor_mensalidade); preenchido: porcentagem do salário mínimo
alter table public.categorias_socio
  add column percentual_salario_minimo numeric(5, 2) check (percentual_salario_minimo is null or percentual_salario_minimo between 0.01 and 100);

create or replace function private.salvar_categoria_socio(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_categoria_socio', 'pessoas', 'editar'); v_id uuid; v_nome text; v_pct numeric; v_valor numeric;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','nome','valor_mensalidade','percentual_salario_minimo','dia_vencimento','ativa']), false) then return private.erro('invalido'); end if;
  v_id := private.j_uuid(p -> 'id');      if v_id is null then return private.erro('invalido', 'id'); end if;
  v_nome := private.j_texto(p -> 'nome'); if not private.texto_ok(v_nome, 2, 60) then return private.erro('invalido', 'nome'); end if;
  if not private.vazio(p -> 'percentual_salario_minimo') then
    v_pct := private.j_valor(p -> 'percentual_salario_minimo');
    if v_pct is null or v_pct not between 0.01 and 100 then return private.erro('invalido', 'percentual_salario_minimo'); end if;
    -- em porcentagem, o valor fixo não é usado (fica zero para não confundir)
    if not private.vazio(p -> 'valor_mensalidade') and private.j_valor(p -> 'valor_mensalidade') is distinct from 0 then
      return private.erro('invalido', 'valor_mensalidade');
    end if;
    v_valor := 0;
  else
    v_valor := private.j_valor(p -> 'valor_mensalidade');
    if v_valor is null or v_valor > 100000 then return private.erro('invalido', 'valor_mensalidade'); end if;
  end if;
  if coalesce(private.j_inteiro(p -> 'dia_vencimento'), 0) not between 1 and 28 then return private.erro('invalido', 'dia_vencimento'); end if;
  if not private.vazio(p -> 'ativa') and private.j_bool(p -> 'ativa') is null then return private.erro('invalido', 'ativa'); end if;
  if exists (select 1 from public.categorias_socio where lower(nome) = lower(v_nome) and id <> v_id) then return private.erro('duplicado', 'nome'); end if;
  insert into public.categorias_socio (id, nome, valor_mensalidade, percentual_salario_minimo, dia_vencimento, ativa, criado_por)
  values (v_id, v_nome, v_valor, v_pct, private.j_inteiro(p -> 'dia_vencimento'), coalesce(private.j_bool(p -> 'ativa'), true), auth.uid())
  on conflict (id) do update set nome = excluded.nome, valor_mensalidade = excluded.valor_mensalidade,
    percentual_salario_minimo = excluded.percentual_salario_minimo, dia_vencimento = excluded.dia_vencimento, ativa = excluded.ativa;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function private.gerar_mensalidades(p_competencia date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('gerar_mensalidades', 'pessoas', 'editar'); v_n int;
begin
  if v_erro is not null then return v_erro; end if;
  if p_competencia is null or extract(day from p_competencia) <> 1
     or p_competencia not between (date_trunc('month', private.hoje()) - interval '12 months')::date and (date_trunc('month', private.hoje()) + interval '2 months')::date then
    return private.erro('invalido', 'competencia');
  end if;
  -- tudo ou nada: se alguma categoria em porcentagem não tem salário mínimo para a data, não gera nenhuma
  if exists (
    select 1 from public.pessoas x join public.categorias_socio c on c.id = x.categoria_id
    where x.associado and x.situacao = 'ativo' and c.ativa and c.percentual_salario_minimo is not null
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
  ) v
  where v.valor > 0
  on conflict (pessoa_id, competencia) do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'criadas', v_n);
end $$;

insert into private.limites_operacao (operacao, maximo_por_hora) values ('salvar_salario_minimo', 30);

create function public.salvar_salario_minimo(p_vigente_desde date, p_valor text) returns jsonb
  language sql security invoker set search_path = '' as $$ select private.salvar_salario_minimo(p_vigente_desde, p_valor) $$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
revoke all on function private.salario_minimo_para(date) from authenticated, service_role, anon;
grant execute on function public.salvar_salario_minimo(date, text) to authenticated;
grant execute on function private.salvar_salario_minimo(date, text) to authenticated;
grant execute on function public.transparencia_publica() to anon;
grant execute on function private.transparencia_publica() to anon;
