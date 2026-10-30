-- 0026 · Orçamento anual por categoria (previsto × realizado) e baixa de mensalidade em um passo.

create table public.orcamentos (
  ano int not null check (ano between 2020 and 2100),
  categoria_id uuid not null references public.categorias (id),
  valor numeric(14, 2) not null check (valor between 0 and 100000000),
  atualizado_por uuid not null references public.membros (id),
  atualizado_em timestamptz not null default now(),
  primary key (ano, categoria_id)
);
create index orcamentos_categoria_idx on public.orcamentos (categoria_id);
create index orcamentos_atualizado_por_idx on public.orcamentos (atualizado_por);
select private.proteger_tabela('public.orcamentos');
create trigger orcamentos_auditar after insert or update or delete on public.orcamentos for each row execute function private.trg_auditar();
create trigger orcamentos_sem_apagar before delete on public.orcamentos for each row execute function private.trg_sem_apagar();
create policy ler on public.orcamentos for select to authenticated using ((select private.pode('financeiro', 'ver')));

-- Grava o orçamento do ano (lista de categorias e valores). Zero = sem orçamento. Tudo ou nada.
create function private.salvar_orcamento(p_ano int, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_orcamento', 'financeiro', 'administrar'); v_ano_atual int := extract(year from private.hoje())::int;
begin
  if v_erro is not null then return v_erro; end if;
  if p_ano is null or p_ano not between v_ano_atual - 1 and v_ano_atual + 1 then return private.erro('invalido', 'ano'); end if;
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) not between 1 and 300 then return private.erro('invalido', 'linhas'); end if;
  if exists (select 1 from jsonb_array_elements(p) x
              where jsonb_typeof(x) <> 'object' or not private.so_chaves(x, array['categoria_id','valor'])
                 or private.j_uuid(x -> 'categoria_id') is null or not exists (select 1 from public.categorias c where c.id = private.j_uuid(x -> 'categoria_id'))
                 or (x ->> 'valor' <> '0' and private.j_valor(x -> 'valor') is null)) then
    return private.erro('invalido', 'linhas');
  end if;
  if (select count(distinct x ->> 'categoria_id') from jsonb_array_elements(p) x) <> jsonb_array_length(p) then return private.erro('invalido', 'categoria_id'); end if;
  insert into public.orcamentos (ano, categoria_id, valor, atualizado_por)
  select p_ano, private.j_uuid(x -> 'categoria_id'), coalesce(private.j_valor(x -> 'valor'), 0), auth.uid() from jsonb_array_elements(p) x
  on conflict (ano, categoria_id) do update set valor = excluded.valor, atualizado_por = excluded.atualizado_por, atualizado_em = now()
    where orcamentos.valor is distinct from excluded.valor;
  return jsonb_build_object('ok', true);
end $$;

-- Previsto × realizado do ano, por categoria e por mês (realizado) + o que ainda está previsto (a pagar/receber).
create function private.orcamento_ano(p_ano int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('orcamento_ano', 'financeiro', 'ver'); v_ini date; v_fim date;
begin
  if v_erro is not null then return v_erro; end if;
  if private.alcance('financeiro', 'ver') <> 'tudo' then return private.negar('orcamento_ano'); end if;
  if p_ano is null or p_ano not between 2020 and 2100 then return private.erro('invalido', 'ano'); end if;
  v_ini := make_date(p_ano, 1, 1); v_fim := make_date(p_ano, 12, 31);
  return jsonb_build_object('ok', true, 'ano', p_ano, 'hoje', private.hoje(),
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'tipo', c.tipo,
        'previsto', coalesce(o.valor, 0)::text,
        'realizado', coalesce(r.total, 0)::text,
        'por_mes', coalesce(r.meses, '[]'::jsonb),
        'a_realizar', coalesce((select sum(l.valor) from public.lancamentos l where l.categoria_id = c.id and l.situacao = 'prevista' and l.data between v_ini and v_fim), 0)::text)
        order by c.tipo desc, coalesce(o.valor, 0) desc, c.nome)
      from public.categorias c
      left join public.orcamentos o on o.categoria_id = c.id and o.ano = p_ano
      left join lateral (
        select sum(t) total, jsonb_agg(jsonb_build_object('mes', m, 'valor', t::text) order by m) meses from (
          select extract(month from l.data)::int m, sum(l.valor) t from public.lancamentos l
           where l.categoria_id = c.id and l.situacao = 'realizada' and l.data between v_ini and v_fim
             and l.estorno_de is null and not exists (select 1 from public.lancamentos e where e.estorno_de = l.id)
           group by 1) x) r on true
     where c.ativa or o.valor > 0 or r.total is not null), '[]'));
end $$;

-- Mensalidade recebida agora: cria a entrada no Dinheiro e dá baixa, numa ação só (idempotente pelo id).
create function private.receber_mensalidade(p_id uuid, p_lancamento uuid, p_conta uuid, p_data date, p_forma text, p_categoria uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('receber_mensalidade', 'financeiro', 'editar'); m public.mensalidades; v_m jsonb;
begin
  if v_erro is not null then return v_erro; end if;
  if not private.pode('financeiro', 'criar') then return private.negar('receber_mensalidade'); end if;
  if p_lancamento is null then return private.erro('invalido', 'id'); end if;
  select * into m from public.mensalidades where id = p_id for update;
  if m.id is null then return private.erro('nao_encontrado'); end if;
  if m.lancamento_id = p_lancamento then return jsonb_build_object('ok', true, 'repetido', true); end if;
  if m.situacao = 'paga' then return private.erro('ja_paga'); end if;
  if m.situacao <> 'aberta' then return private.erro('invalido', 'situacao'); end if;
  if exists (select 1 from public.lancamentos where id = p_lancamento) then return private.erro('conflito', 'id'); end if;
  -- descrição sem o nome da pessoa: a ligação com a mensalidade já diz de quem é
  v_m := jsonb_build_object('tipo', 'entrada', 'situacao', 'realizada', 'valor', m.valor::text, 'data', to_char(p_data, 'YYYY-MM-DD'),
    'descricao', 'Mensalidade ' || to_char(m.competencia, 'MM/YYYY'), 'categoria_id', p_categoria, 'conta_id', p_conta, 'forma_pagamento', p_forma);
  v_erro := private.validar_lancamento(v_m);
  if v_erro is not null then return v_erro; end if;
  if private.mes_fechado(p_data) then return private.erro('mes_fechado', 'data'); end if;
  insert into public.lancamentos (id, tipo, situacao, valor, data, descricao, categoria_id, conta_id, forma_pagamento, detalhes, criado_por, realizado_por, realizado_em)
  values (p_lancamento, 'entrada', 'realizada', m.valor, p_data, v_m ->> 'descricao', p_categoria, p_conta, p_forma, '{}', auth.uid(), auth.uid(), now());
  update public.mensalidades set situacao = 'paga', pago_em = p_data, lancamento_id = p_lancamento, atualizado_por = auth.uid(), atualizado_em = now() where id = m.id;
  return jsonb_build_object('ok', true, 'lancamento_id', p_lancamento);
end $$;

insert into private.limites_operacao (operacao, maximo_por_hora) values ('salvar_orcamento', 60), ('orcamento_ano', 300), ('receber_mensalidade', 500);

create function public.salvar_orcamento(p_ano int, p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_orcamento(p_ano, p) $$;
create function public.orcamento_ano(p_ano int) returns jsonb language sql security invoker set search_path = '' as $$ select private.orcamento_ano(p_ano) $$;
create function public.receber_mensalidade(p_id uuid, p_lancamento uuid, p_conta uuid, p_data date, p_forma text, p_categoria uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.receber_mensalidade(p_id, p_lancamento, p_conta, p_data, p_forma, p_categoria) $$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
do $$
declare f text;
begin
  foreach f in array array['salvar_orcamento(int,jsonb)','orcamento_ano(int)','receber_mensalidade(uuid,uuid,uuid,date,text,uuid)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('grant execute on function private.%s to authenticated', f);
  end loop;
end $$;
grant execute on function public.transparencia_publica() to anon;
grant execute on function private.transparencia_publica() to anon;
