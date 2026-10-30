-- 0024 · previsão de caixa, cenários e análises.
-- Uma leitura só, agregada, para quem vê o financeiro inteiro. Os cálculos (previsão, cenários,
-- concentração das receitas, gastos fora do padrão, duplicidades) rodam no aparelho, sobre estes
-- dados, em funções puras testadas (src/lib/analises.ts). Nada aqui grava; nenhum dado de saúde.
-- Pessoas aparecem só em números agregados; tarefas por diretor só para quem vê as tarefas.

create function private.dados_analise() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('dados_analise', 'financeiro', 'ver');
  v_hoje date := private.hoje();
  v_ini date := (date_trunc('month', private.hoje()) - interval '12 months')::date;
begin
  if v_erro is not null then return v_erro; end if;
  if private.alcance('financeiro', 'ver') <> 'tudo' then return private.negar('dados_analise'); end if;
  return jsonb_build_object('ok', true, 'hoje', v_hoje, 'inicio', v_ini,
    'saldo', (select coalesce(sum(saldo), 0)::text from private.saldos_contas()),
    -- contas a pagar e a receber (vencidas e dos próximos 12 meses)
    'previstas', coalesce((select jsonb_agg(jsonb_build_object('data', l.data, 'tipo', l.tipo, 'valor', l.valor::text, 'categoria', c.nome) order by l.data)
        from public.lancamentos l join public.categorias c on c.id = l.categoria_id
       where l.situacao = 'prevista' and l.data <= v_hoje + 366), '[]'),
    'recorrencias', coalesce((select jsonb_agg(jsonb_build_object('tipo', r.tipo, 'valor', r.valor::text, 'dia', r.dia, 'inicio', r.inicio, 'fim', r.fim, 'descricao', r.descricao))
        from public.recorrencias r where r.ativa and (r.fim is null or r.fim >= v_hoje)), '[]'),
    -- parcelas de verbas ainda não recebidas, com a situação da verba (o peso fica na tela)
    'parcelas', coalesce((select jsonb_agg(jsonb_build_object('data', p.data_prevista, 'valor', p.valor::text, 'situacao', v.situacao, 'verba', v.titulo) order by p.data_prevista)
        from public.verba_parcelas p join public.verbas v on v.id = p.verba_id
       where p.recebido_em is null and not (v.situacao = any (private.situacoes_verba_finais())) and p.data_prevista <= v_hoje + 366), '[]'),
    -- mensalidades: só números (nenhum nome)
    'mensalidades', jsonb_build_object(
      'abertas_futuras', coalesce((select jsonb_agg(jsonb_build_object('data', m.vencimento, 'valor', m.valor::text)) from public.mensalidades m
                                    where m.situacao = 'aberta' and m.vencimento >= v_hoje and m.vencimento <= v_hoje + 366), '[]'),
      'pagas_12m', (select count(*) from public.mensalidades where situacao = 'paga' and vencimento between v_ini and v_hoje),
      'vencidas_abertas', coalesce((select jsonb_agg(jsonb_build_object('dias', v_hoje - m.vencimento, 'valor', m.valor::text)) from public.mensalidades m
                                     where m.situacao = 'aberta' and m.vencimento < v_hoje), '[]')),
    -- realizados dos últimos 12 meses (para análises); descrição curta, sem dados de quem lançou
    'realizados', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'data', l.data, 'tipo', l.tipo, 'valor', l.valor::text, 'categoria', c.nome,
          'fonte', coalesce(cp.nome, c.nome), 'contraparte_id', l.contraparte_id, 'descricao', left(l.descricao, 80),
          'comprovante', exists (select 1 from public.comprovantes x where x.lancamento_id = l.id) or l.sem_comprovante_motivo is not null,
          'atraso_dias', greatest(0, (l.criado_em at time zone 'America/Sao_Paulo')::date - l.data)) order by l.data)
        from (select * from public.lancamentos l where l.situacao = 'realizada' and l.estorno_de is null and l.data between v_ini and v_hoje
                 and not exists (select 1 from public.lancamentos e where e.estorno_de = l.id) order by l.data desc limit 6000) l
        join public.categorias c on c.id = l.categoria_id left join public.contrapartes cp on cp.id = l.contraparte_id), '[]'),
    'captacao', coalesce((select jsonb_object_agg(etapa, jsonb_build_object('n', n, 'valor', total::text))
        from (select etapa, count(*) n, coalesce(sum(valor_estimado), 0) total from public.oportunidades group by etapa) x), '{}'),
    'verbas', coalesce((select jsonb_agg(jsonb_build_object('situacao', v.situacao, 'pedido', coalesce(v.valor_pedido, 0)::text, 'aprovado', coalesce(v.valor_aprovado, 0)::text,
          'recebido', coalesce((select sum(p.valor_recebido) from public.verba_parcelas p where p.verba_id = v.id), 0)::text))
        from public.verbas v), '[]'),
    'atletas_ativos', (select count(*) from public.pessoas where atleta and situacao = 'ativo'),
    'treinos', jsonb_build_object(
      'n', (select count(distinct ep.evento_id) from public.evento_presencas ep join public.eventos e on e.id = ep.evento_id where e.inicio >= v_ini),
      'presencas', (select count(*) from public.evento_presencas ep join public.eventos e on e.id = ep.evento_id where ep.presente and e.inicio >= v_ini)),
    'viagens', coalesce((select jsonb_agg(jsonb_build_object('titulo', v.titulo, 'km', v.distancia_km,
          'atletas', (select count(*) from public.viagem_delegacao d where d.viagem_id = v.id and d.funcao = 'atleta'),
          'custo', coalesce((select sum(case vl.papel when 'devolucao' then -l.valor else l.valor end) from public.viagem_lancamentos vl
                              join public.lancamentos l on l.id = vl.lancamento_id where vl.viagem_id = v.id and l.situacao = 'realizada'), 0)::text))
        from public.viagens v where v.situacao = 'encerrada' and v.retorno >= v_ini), '[]'),
    'tarefas', case when private.pode('tarefas', 'ver') then coalesce((select jsonb_agg(to_jsonb(x) order by x.nome) from (
        select m.nome,
          count(*) filter (where t.situacao in ('a_fazer', 'fazendo')) abertas,
          count(*) filter (where t.situacao in ('a_fazer', 'fazendo') and t.prazo < v_hoje) atrasadas,
          count(*) filter (where t.situacao = 'feito' and t.concluida_em >= v_hoje - 90 and (t.prazo is null or (t.concluida_em at time zone 'America/Sao_Paulo')::date <= t.prazo)) feitas_no_prazo,
          count(*) filter (where t.situacao = 'feito' and t.concluida_em >= v_hoje - 90 and (t.concluida_em at time zone 'America/Sao_Paulo')::date > t.prazo) feitas_atrasadas
        from public.tarefas t join public.membros m on m.id = t.responsavel group by m.id, m.nome) x), '[]') end);
end $$;

insert into private.limites_operacao (operacao, maximo_por_hora) values ('dados_analise', 120);

create function public.dados_analise() returns jsonb language sql security invoker set search_path = '' as $$ select private.dados_analise() $$;
revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
grant execute on function public.dados_analise() to authenticated;
grant execute on function private.dados_analise() to authenticated;
