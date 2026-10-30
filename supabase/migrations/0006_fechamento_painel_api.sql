-- 0006 · Conferência e fechamento mensal, painel inicial, dados para relatórios
-- e a API pública (invólucros SECURITY INVOKER) de todo o financeiro.

create function private.saldos_contas(p_ate date default null) returns table (id uuid, nome text, tipo text, saldo numeric)
language sql stable security definer set search_path = '' as $$
  select c.id, c.nome, c.tipo,
         c.saldo_inicial + coalesce(sum(case l.tipo when 'entrada' then l.valor else -l.valor end)
                                    filter (where l.situacao = 'realizada' and (p_ate is null or l.data <= p_ate)), 0)
  from public.contas_bancarias c
  left join public.lancamentos l on l.conta_id = c.id
  where c.ativa or exists (select 1 from public.lancamentos x where x.conta_id = c.id)
  group by c.id
  order by c.nome
$$;

-- Saídas realizadas sem comprovante e sem justificativa (estornos e estornadas não contam).
create function private.saidas_sem_comprovante(p_inicio date, p_fim date) returns setof public.lancamentos
language sql stable security definer set search_path = '' as $$
  select l.* from public.lancamentos l
  where l.tipo = 'saida' and l.situacao = 'realizada' and l.data between p_inicio and p_fim
    and l.estorno_de is null and l.sem_comprovante_motivo is null
    and not exists (select 1 from public.lancamentos e where e.estorno_de = l.id)
    and not exists (select 1 from public.comprovantes c where c.lancamento_id = l.id)
$$;

create function private.checklist_fechamento(p_competencia date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('checklist_fechamento', 'financeiro', 'ver');
  v_fim date; v_sem int; v_prev int; v_reemb int; v_fechado boolean; v_passado boolean;
begin
  if v_erro is not null then return v_erro; end if;
  if p_competencia is null or extract(day from p_competencia) <> 1 then return private.erro('invalido', 'competencia'); end if;
  v_fim := (p_competencia + interval '1 month' - interval '1 day')::date;
  select count(*) into v_sem from private.saidas_sem_comprovante(p_competencia, v_fim);
  select count(*) into v_prev from public.lancamentos
   where situacao = 'prevista' and data between p_competencia and least(v_fim, private.hoje() - 1);
  select count(*) into v_reemb from public.reembolsos r join public.lancamentos l on l.id = r.lancamento_id
   where r.situacao = 'solicitado' and l.data between p_competencia and v_fim;
  v_fechado := exists (select 1 from public.fechamentos where competencia = p_competencia);
  v_passado := p_competencia < date_trunc('month', private.hoje())::date;
  return jsonb_build_object('ok', true, 'competencia', p_competencia, 'ja_fechado', v_fechado, 'mes_encerrado', v_passado,
    'pode_fechar', not v_fechado and v_passado and v_sem = 0,
    'itens', jsonb_build_array(
      jsonb_build_object('chave', 'comprovantes', 'titulo', 'Toda saída tem comprovante ou justificativa', 'pendentes', v_sem, 'bloqueia', true),
      jsonb_build_object('chave', 'previstas_vencidas', 'titulo', 'Contas vencidas no mês foram pagas ou recebidas', 'pendentes', v_prev, 'bloqueia', false),
      jsonb_build_object('chave', 'reembolsos', 'titulo', 'Pedidos de reembolso do mês foram decididos', 'pendentes', v_reemb, 'bloqueia', false),
      jsonb_build_object('chave', 'extrato', 'titulo', 'Extrato do banco conferido com os lançamentos', 'pendentes', null, 'bloqueia', true, 'manual', true)));
end $$;

create function private.fechar_mes(p_competencia date, p_confirmacoes jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('fechar_mes', 'financeiro', 'aprovar');
  v_fim date; v_resumo jsonb; v_ok date;
begin
  if v_erro is not null then return v_erro; end if;
  if p_competencia is null or extract(day from p_competencia) <> 1
     or p_competencia >= date_trunc('month', private.hoje())::date then
    return private.erro('invalido', 'competencia');
  end if;
  if exists (select 1 from public.fechamentos where competencia = p_competencia) then return private.erro('ja_fechado'); end if;
  if not coalesce(private.so_chaves(p_confirmacoes, array['extrato_conferido','observacao']), false) then return private.erro('invalido', 'confirmacoes'); end if;
  if private.j_bool(p_confirmacoes -> 'extrato_conferido') is not true then return private.erro('invalido', 'extrato_conferido'); end if;
  if not private.vazio(p_confirmacoes -> 'observacao') and not private.texto_ok(private.j_texto(p_confirmacoes -> 'observacao'), 1, 500) then
    return private.erro('invalido', 'observacao');
  end if;
  -- bloqueia escritas concorrentes no livro caixa durante o fechamento (operação curta)
  lock table public.lancamentos in share row exclusive mode;
  v_fim := (p_competencia + interval '1 month' - interval '1 day')::date;
  if exists (select 1 from private.saidas_sem_comprovante(p_competencia, v_fim)) then return private.erro('pendencias'); end if;
  select jsonb_build_object(
    'entradas', coalesce(sum(valor) filter (where tipo = 'entrada'), 0)::text,
    'saidas', coalesce(sum(valor) filter (where tipo = 'saida'), 0)::text,
    'saldos', (select coalesce(jsonb_agg(jsonb_build_object('conta_id', s.id, 'nome', s.nome, 'saldo', s.saldo::text)), '[]'::jsonb)
               from private.saldos_contas(v_fim) s))
    into v_resumo
  from public.lancamentos where situacao = 'realizada' and data between p_competencia and v_fim;
  insert into public.fechamentos (competencia, fechado_por, confirmacoes, resumo)
  values (p_competencia, auth.uid(), p_confirmacoes, v_resumo)
  on conflict (competencia) do nothing
  returning competencia into v_ok;
  if v_ok is null then return private.erro('ja_fechado'); end if;
  return jsonb_build_object('ok', true, 'competencia', p_competencia, 'resumo', v_resumo);
end $$;

create function private.item_painel(l public.lancamentos) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', l.id, 'tipo', l.tipo, 'descricao', l.descricao, 'valor', l.valor::text,
    'data', to_char(l.data, 'YYYY-MM-DD'), 'vencida', l.data < private.hoje())
$$;

create function private.painel_inicial() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('painel_inicial', 'financeiro', 'ver');
  v_tudo boolean; v_eu uuid := auth.uid(); v_hoje date := private.hoje(); v_ini_mes date := date_trunc('month', private.hoje())::date;
  v_total numeric; v_proj numeric; v_contas jsonb := '[]'; v_mes_ant date := (date_trunc('month', private.hoje()) - interval '1 month')::date;
begin
  if v_erro is not null then return v_erro; end if;
  v_tudo := private.alcance('financeiro', 'ver') = 'tudo';
  if v_tudo then
    select sum(saldo), sum(saldo) filter (where tipo = 'projeto'),
           coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'tipo', tipo, 'saldo', saldo::text)), '[]')
      into v_total, v_proj, v_contas
    from private.saldos_contas();
  end if;
  return jsonb_build_object('ok', true,
    'hoje', to_char(v_hoje, 'YYYY-MM-DD'),
    'saldo_total', case when v_tudo then coalesce(v_total, 0)::text end,
    'saldo_projetos', case when v_tudo then coalesce(v_proj, 0)::text end,
    'saldo_livre', case when v_tudo then (coalesce(v_total, 0) - coalesce(v_proj, 0))::text end,
    'contas', v_contas,
    'a_pagar', coalesce((select jsonb_agg(private.item_painel(l) order by l.data) from (
        select * from public.lancamentos l where l.situacao = 'prevista' and l.tipo = 'saida' and l.data <= v_hoje + 15
          and (v_tudo or l.criado_por = v_eu) order by l.data limit 20) l), '[]'),
    'a_receber', coalesce((select jsonb_agg(private.item_painel(l) order by l.data) from (
        select * from public.lancamentos l where l.situacao = 'prevista' and l.tipo = 'entrada' and l.data <= v_hoje + 15
          and (v_tudo or l.criado_por = v_eu) order by l.data limit 20) l), '[]'),
    'mes', (select jsonb_build_object(
        'entradas', coalesce(sum(valor) filter (where tipo = 'entrada'), 0)::text,
        'saidas', coalesce(sum(valor) filter (where tipo = 'saida'), 0)::text)
      from public.lancamentos where situacao = 'realizada' and data >= v_ini_mes and (v_tudo or criado_por = v_eu)),
    'alertas', jsonb_build_object(
      'sem_comprovante', (select count(*) from private.saidas_sem_comprovante(date '2020-01-01', v_hoje) s
                          where (v_tudo or s.criado_por = v_eu) and not private.mes_fechado(s.data)),
      'vencidas', (select count(*) from public.lancamentos l where l.situacao = 'prevista' and l.data < v_hoje and (v_tudo or l.criado_por = v_eu)),
      'reembolsos_pendentes', (select count(*) from public.reembolsos r where r.situacao = 'solicitado' and (v_tudo or r.solicitante = v_eu)),
      'mes_anterior_aberto', extract(day from v_hoje) > 10 and not private.mes_fechado(v_mes_ant)
                             and exists (select 1 from public.lancamentos l where l.situacao = 'realizada'
                                         and l.data between v_mes_ant and v_ini_mes - 1)));
end $$;

create function private.dados_relatorio(p_inicio date, p_fim date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('dados_relatorio', 'financeiro', 'exportar'); v_tudo boolean;
begin
  if v_erro is not null then return v_erro; end if;
  if p_inicio is null or p_fim is null or p_inicio > p_fim or p_fim - p_inicio > 1830 then return private.erro('invalido', 'periodo'); end if;
  v_tudo := private.alcance('financeiro', 'ver') = 'tudo';
  perform private.registrar('exportar', 'lancamentos', null, null,
    jsonb_build_object('inicio', p_inicio, 'fim', p_fim));
  return jsonb_build_object('ok', true, 'inicio', p_inicio, 'fim', p_fim, 'gerado_em', now(),
    'lancamentos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'data', to_char(l.data, 'YYYY-MM-DD'), 'tipo', l.tipo, 'situacao', l.situacao, 'valor', l.valor::text,
        'descricao', l.descricao, 'categoria', c.nome, 'conta', cb.nome, 'forma_pagamento', l.forma_pagamento,
        'contraparte', cp.nome, 'centro_custo', cc.nome, 'projeto', pj.nome, 'estorno_de', l.estorno_de,
        'tem_comprovante', exists (select 1 from public.comprovantes x where x.lancamento_id = l.id),
        'sem_comprovante_motivo', l.sem_comprovante_motivo, 'criado_por', m.nome) order by l.data, l.criado_em)
      from public.lancamentos l
      join public.categorias c on c.id = l.categoria_id
      join public.membros m on m.id = l.criado_por
      left join public.contas_bancarias cb on cb.id = l.conta_id
      left join public.contrapartes cp on cp.id = l.contraparte_id
      left join public.centros_custo cc on cc.id = l.centro_custo_id
      left join public.projetos pj on pj.id = l.projeto_id
      where l.data between p_inicio and p_fim and l.situacao <> 'cancelada' and (v_tudo or l.criado_por = auth.uid())), '[]'),
    'saldos', case when v_tudo then (select coalesce(jsonb_agg(jsonb_build_object('conta', s.nome, 'tipo', s.tipo, 'saldo', s.saldo::text)), '[]')
                                     from private.saldos_contas(p_fim) s) else '[]'::jsonb end);
end $$;

create function public.salvar_conta(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_conta(p) $$;
create function public.salvar_categoria(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_categoria(p) $$;
create function public.salvar_tipo_gasto(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_tipo_gasto(p) $$;
create function public.importar_modelos_tipos_gasto() returns jsonb language sql security invoker set search_path = '' as $$ select private.importar_modelos_tipos_gasto() $$;
create function public.salvar_contraparte(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_contraparte(p) $$;
create function public.salvar_centro_custo(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_centro_custo(p) $$;
create function public.salvar_projeto(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_projeto(p) $$;
create function public.criar_lancamento(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.criar_lancamento(p) $$;
create function public.editar_lancamento(p_id uuid, p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.editar_lancamento(p_id, p) $$;
create function public.estornar_lancamento(p_id uuid, p_motivo text) returns jsonb language sql security invoker set search_path = '' as $$ select private.estornar_lancamento(p_id, p_motivo) $$;
create function public.realizar_lancamento(p_id uuid, p_data date, p_conta_id uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.realizar_lancamento(p_id, p_data, p_conta_id) $$;
create function public.cancelar_lancamento(p_id uuid, p_motivo text) returns jsonb language sql security invoker set search_path = '' as $$ select private.cancelar_lancamento(p_id, p_motivo) $$;
create function public.justificar_sem_comprovante(p_id uuid, p_motivo text) returns jsonb language sql security invoker set search_path = '' as $$ select private.justificar_sem_comprovante(p_id, p_motivo) $$;
create function public.decidir_reembolso(p_id uuid, p_aprovar boolean, p_conta_id uuid, p_motivo text) returns jsonb language sql security invoker set search_path = '' as $$ select private.decidir_reembolso(p_id, p_aprovar, p_conta_id, p_motivo) $$;
create function public.salvar_recorrencia(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_recorrencia(p) $$;
create function public.gerar_previstos(p_ate date) returns jsonb language sql security invoker set search_path = '' as $$ select private.gerar_previstos(p_ate) $$;
create function public.checklist_fechamento(p_competencia date) returns jsonb language sql security invoker set search_path = '' as $$ select private.checklist_fechamento(p_competencia) $$;
create function public.fechar_mes(p_competencia date, p_confirmacoes jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.fechar_mes(p_competencia, p_confirmacoes) $$;
create function public.painel_inicial() returns jsonb language sql security invoker set search_path = '' as $$ select private.painel_inicial() $$;
create function public.dados_relatorio(p_inicio date, p_fim date) returns jsonb language sql security invoker set search_path = '' as $$ select private.dados_relatorio(p_inicio, p_fim) $$;
create function public.verificar_duplicidade(p_sha256 text, p_chave text, p_codigo text) returns jsonb language sql security invoker set search_path = '' as $$ select private.verificar_duplicidade(p_sha256, p_chave, p_codigo) $$;
create function public.autorizar_comprovante(p_lancamento uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.autorizar_comprovante(p_lancamento) $$;
create function public.autorizar_arquivo_contador() returns jsonb language sql security invoker set search_path = '' as $$ select private.autorizar_arquivo_contador() $$;
-- Só a Edge Function (service_role) registra arquivos já gravados no storage.
create function public.registrar_comprovante(p_usuario uuid, p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.registrar_comprovante(p_usuario, p) $$;
create function public.registrar_arquivo_contador(p_usuario uuid, p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.registrar_arquivo_contador(p_usuario, p) $$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
do $$
declare
  f text;
  usuario text[] := array['salvar_conta(jsonb)','salvar_categoria(jsonb)','salvar_tipo_gasto(jsonb)','importar_modelos_tipos_gasto()',
    'salvar_contraparte(jsonb)','salvar_centro_custo(jsonb)','salvar_projeto(jsonb)','criar_lancamento(jsonb)',
    'editar_lancamento(uuid,jsonb)','estornar_lancamento(uuid,text)','realizar_lancamento(uuid,date,uuid)',
    'cancelar_lancamento(uuid,text)','justificar_sem_comprovante(uuid,text)','decidir_reembolso(uuid,boolean,uuid,text)',
    'salvar_recorrencia(jsonb)','gerar_previstos(date)','checklist_fechamento(date)','fechar_mes(date,jsonb)',
    'painel_inicial()','dados_relatorio(date,date)','verificar_duplicidade(text,text,text)',
    'autorizar_comprovante(uuid)','autorizar_arquivo_contador()'];
  servidor text[] := array['registrar_comprovante(uuid,jsonb)','registrar_arquivo_contador(uuid,jsonb)'];
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
-- Funções auxiliares usadas nas políticas de RLS (o schema private não é exposto pela API).
grant execute on function private.membro_atual(), private.is_admin(), private.pode(text, text),
  private.alcance(text, text), private.ve_registro(text, uuid), private.sessao_erro() to authenticated;
