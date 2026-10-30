-- 0022 · Viagens e competições e os prazos na agenda.
-- Orçamento, delegação (atletas e equipe, quartos), acessibilidade no nível da viagem (sem dado de
-- saúde por pessoa), adiantamento, despesas e devolução ligados aos lançamentos do Dinheiro,
-- acerto final e custo por atleta e por quilômetro.

create table public.viagens (
  id uuid primary key,
  titulo text not null check (private.texto_ok(titulo, 2, 160)),
  destino text not null check (private.texto_ok(destino, 2, 120)),
  saida date not null,
  retorno date not null,
  distancia_km int check (distancia_km between 0 and 30000),
  orcamento numeric(14, 2) check (orcamento between 0 and 10000000),
  situacao text not null default 'planejada' check (situacao in ('planejada', 'em_andamento', 'encerrada', 'cancelada')),
  -- acessibilidade da viagem como um todo (nada de condição de saúde de cada pessoa)
  quartos_adaptados int check (quartos_adaptados between 0 and 200),
  transporte_acessivel boolean not null default false,
  observacoes text check (char_length(observacoes) <= 1000 and observacoes !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]'),
  evento_id uuid references public.eventos (id),
  verba_id uuid references public.verbas (id),
  projeto_id uuid references public.projetos (id),
  responsavel uuid references public.membros (id),
  encerrada_em timestamptz,
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (retorno >= saida and retorno <= saida + 60)
);
create index viagens_saida_idx on public.viagens (saida);
create index viagens_evento_idx on public.viagens (evento_id) where evento_id is not null;
create index viagens_verba_idx on public.viagens (verba_id) where verba_id is not null;
create index viagens_projeto_idx on public.viagens (projeto_id) where projeto_id is not null;
create index viagens_responsavel_idx on public.viagens (responsavel) where responsavel is not null;
create index viagens_criado_por_idx on public.viagens (criado_por);

create table public.viagem_delegacao (
  id uuid primary key,
  viagem_id uuid not null references public.viagens (id),
  pessoa_id uuid references public.pessoas (id),
  membro_id uuid references public.membros (id),
  nome text not null check (private.texto_ok(nome, 2, 120)),
  funcao text not null check (funcao in ('atleta', 'tecnico', 'staff', 'acompanhante', 'outro')),
  quarto text check (private.texto_opcional_ok(quarto, 20)),
  check (funcao <> 'atleta' or pessoa_id is not null)
);
create index viagem_delegacao_viagem_idx on public.viagem_delegacao (viagem_id);
create unique index viagem_delegacao_pessoa_unica on public.viagem_delegacao (viagem_id, pessoa_id) where pessoa_id is not null;
create index viagem_delegacao_pessoa_idx on public.viagem_delegacao (pessoa_id) where pessoa_id is not null;
create index viagem_delegacao_membro_idx on public.viagem_delegacao (membro_id) where membro_id is not null;

create table public.viagem_lancamentos (
  lancamento_id uuid primary key references public.lancamentos (id),
  viagem_id uuid not null references public.viagens (id),
  papel text not null check (papel in ('adiantamento', 'despesa', 'devolucao')),
  vinculado_por uuid not null references public.membros (id),
  vinculado_em timestamptz not null default now()
);
create index viagem_lancamentos_viagem_idx on public.viagem_lancamentos (viagem_id);
create index viagem_lancamentos_vinculado_por_idx on public.viagem_lancamentos (vinculado_por);

do $$ declare t text; begin
  foreach t in array array['viagens','viagem_delegacao','viagem_lancamentos'] loop
    perform private.proteger_tabela(format('public.%I', t)::regclass);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.trg_auditar()', t || '_auditar', t);
    execute format('create policy ler on public.%I for select to authenticated using ((select private.pode(''viagens'', ''ver'')))', t);
  end loop;
end $$;
create trigger viagens_sem_apagar before delete on public.viagens for each row execute function private.trg_sem_apagar();

create function private.pode_mexer_viagem(v public.viagens) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.pode('viagens', 'editar') or (private.pode('viagens', 'criar') and auth.uid() in (v.criado_por, coalesce(v.responsavel, v.criado_por)))
$$;

create function private.salvar_viagem(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_viagem', 'viagens', 'criar'); v_id uuid; v public.viagens; v_sit text;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','titulo','destino','saida','retorno','distancia_km','orcamento','situacao','quartos_adaptados',
       'transporte_acessivel','observacoes','evento_id','verba_id','projeto_id','responsavel']), false) then
    return private.erro('invalido');
  end if;
  v_id := private.j_uuid(p -> 'id'); if v_id is null then return private.erro('invalido', 'id'); end if;
  select * into v from public.viagens where id = v_id for update;
  if v.id is not null and not private.pode_mexer_viagem(v) then return private.negar('salvar_viagem'); end if;
  if v.situacao in ('encerrada', 'cancelada') then return private.erro('viagem_encerrada'); end if;
  if not private.texto_ok(private.j_texto(p -> 'titulo'), 2, 160) then return private.erro('invalido', 'titulo'); end if;
  if not private.texto_ok(private.j_texto(p -> 'destino'), 2, 120) then return private.erro('invalido', 'destino'); end if;
  if private.j_data(p -> 'saida') is null or private.j_data(p -> 'saida') not between private.hoje() - 3700 and private.hoje() + 1000 then return private.erro('invalido', 'saida'); end if;
  if private.j_data(p -> 'retorno') is null or private.j_data(p -> 'retorno') < private.j_data(p -> 'saida') or private.j_data(p -> 'retorno') > private.j_data(p -> 'saida') + 60 then
    return private.erro('invalido', 'retorno');
  end if;
  if not private.vazio(p -> 'distancia_km') and coalesce(private.j_inteiro(p -> 'distancia_km'), -1) not between 0 and 30000 then return private.erro('invalido', 'distancia_km'); end if;
  if not private.vazio(p -> 'orcamento') and private.j_valor(p -> 'orcamento') is null then return private.erro('invalido', 'orcamento'); end if;
  v_sit := coalesce(private.j_texto(p -> 'situacao'), 'planejada');
  -- encerrar só pelo acerto (encerrar_viagem); cancelar pode
  if v_sit not in ('planejada', 'em_andamento', 'cancelada') then return private.erro('invalido', 'situacao'); end if;
  if not private.vazio(p -> 'quartos_adaptados') and coalesce(private.j_inteiro(p -> 'quartos_adaptados'), -1) not between 0 and 200 then return private.erro('invalido', 'quartos_adaptados'); end if;
  if not private.vazio(p -> 'transporte_acessivel') and private.j_bool(p -> 'transporte_acessivel') is null then return private.erro('invalido', 'transporte_acessivel'); end if;
  if not private.vazio(p -> 'observacoes') and (jsonb_typeof(p -> 'observacoes') <> 'string' or not private.texto_longo_ok(p ->> 'observacoes', 1000)) then return private.erro('invalido', 'observacoes'); end if;
  if not private.vazio(p -> 'evento_id') and not exists (select 1 from public.eventos where id = private.j_uuid(p -> 'evento_id')) then return private.erro('invalido', 'evento_id'); end if;
  if not private.vazio(p -> 'verba_id') and not exists (select 1 from public.verbas where id = private.j_uuid(p -> 'verba_id')) then return private.erro('invalido', 'verba_id'); end if;
  if not private.vazio(p -> 'projeto_id') and not exists (select 1 from public.projetos where id = private.j_uuid(p -> 'projeto_id')) then return private.erro('invalido', 'projeto_id'); end if;
  if not private.vazio(p -> 'responsavel') and not private.membro_ativo(private.j_uuid(p -> 'responsavel')) then return private.erro('invalido', 'responsavel'); end if;
  insert into public.viagens (id, titulo, destino, saida, retorno, distancia_km, orcamento, situacao, quartos_adaptados, transporte_acessivel, observacoes,
                              evento_id, verba_id, projeto_id, responsavel, criado_por)
  values (v_id, private.j_texto(p -> 'titulo'), private.j_texto(p -> 'destino'), private.j_data(p -> 'saida'), private.j_data(p -> 'retorno'),
          private.j_inteiro(p -> 'distancia_km'), private.j_valor(p -> 'orcamento'), v_sit, private.j_inteiro(p -> 'quartos_adaptados'),
          coalesce(private.j_bool(p -> 'transporte_acessivel'), false), nullif(btrim(coalesce(p ->> 'observacoes', '')), ''),
          private.j_uuid(p -> 'evento_id'), private.j_uuid(p -> 'verba_id'), private.j_uuid(p -> 'projeto_id'), private.j_uuid(p -> 'responsavel'), auth.uid())
  on conflict (id) do update set titulo = excluded.titulo, destino = excluded.destino, saida = excluded.saida, retorno = excluded.retorno,
    distancia_km = excluded.distancia_km, orcamento = excluded.orcamento, situacao = excluded.situacao, quartos_adaptados = excluded.quartos_adaptados,
    transporte_acessivel = excluded.transporte_acessivel, observacoes = excluded.observacoes, evento_id = excluded.evento_id, verba_id = excluded.verba_id,
    projeto_id = excluded.projeto_id, responsavel = excluded.responsavel, atualizado_em = now();
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Delegação: substitui a lista inteira. p = [{id, pessoa_id?, membro_id?, nome, funcao, quarto?}]
create function private.salvar_delegacao(p_viagem uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_delegacao', 'viagens', 'criar'); v public.viagens; v_n int;
begin
  if v_erro is not null then return v_erro; end if;
  select * into v from public.viagens where id = p_viagem for update;
  if v.id is null then return private.erro('nao_encontrado'); end if;
  if not private.pode_mexer_viagem(v) then return private.negar('salvar_delegacao'); end if;
  if v.situacao in ('encerrada', 'cancelada') then return private.erro('viagem_encerrada'); end if;
  -- escolher atletas exige ver o cadastro de pessoas
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) > 200
     or exists (select 1 from jsonb_array_elements(p) x
                 where jsonb_typeof(x) <> 'object' or not private.so_chaves(x, array['id','pessoa_id','membro_id','nome','funcao','quarto'])
                    or private.j_uuid(x -> 'id') is null
                    or not private.texto_ok(private.j_texto(x -> 'nome'), 2, 120)
                    or coalesce(private.j_texto(x -> 'funcao'), '') not in ('atleta', 'tecnico', 'staff', 'acompanhante', 'outro')
                    or (private.j_texto(x -> 'funcao') = 'atleta' and private.vazio(x -> 'pessoa_id'))
                    or (not private.vazio(x -> 'pessoa_id') and (not private.pode('pessoas', 'ver')
                        or not exists (select 1 from public.pessoas s where s.id = private.j_uuid(x -> 'pessoa_id') and s.situacao = 'ativo')))
                    or (not private.vazio(x -> 'membro_id') and not private.membro_ativo(private.j_uuid(x -> 'membro_id')))
                    or (not private.vazio(x -> 'quarto') and not private.texto_ok(private.j_texto(x -> 'quarto'), 1, 20)))
     or (select count(distinct x ->> 'id') from jsonb_array_elements(p) x) <> jsonb_array_length(p)
     or (select count(*) - count(distinct x ->> 'pessoa_id') from jsonb_array_elements(p) x where not private.vazio(x -> 'pessoa_id')) > 0 then
    return private.erro('invalido', 'delegacao');
  end if;
  delete from public.viagem_delegacao where viagem_id = p_viagem;
  insert into public.viagem_delegacao (id, viagem_id, pessoa_id, membro_id, nome, funcao, quarto)
  select private.j_uuid(x -> 'id'), p_viagem, private.j_uuid(x -> 'pessoa_id'), private.j_uuid(x -> 'membro_id'), private.j_texto(x -> 'nome'),
         private.j_texto(x -> 'funcao'), nullif(private.j_texto(x -> 'quarto'), '')
  from jsonb_array_elements(p) x;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'pessoas', v_n);
end $$;

-- Liga (ou desliga, com papel nulo) um lançamento do Dinheiro à viagem.
-- Adiantamento e despesa são saídas; devolução do que sobrou é entrada.
create function private.vincular_lancamento_viagem(p_viagem uuid, p_lancamento uuid, p_papel text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('vincular_lancamento_viagem', 'viagens', 'criar'); v public.viagens; l public.lancamentos; vl public.viagem_lancamentos;
begin
  if v_erro is not null then return v_erro; end if;
  select * into v from public.viagens where id = p_viagem for update;
  if v.id is null then return private.erro('nao_encontrado'); end if;
  if not private.pode_mexer_viagem(v) then return private.negar('vincular_lancamento_viagem'); end if;
  if v.situacao in ('encerrada', 'cancelada') then return private.erro('viagem_encerrada'); end if;
  select * into l from public.lancamentos where id = p_lancamento;
  if l.id is null or not private.ve_registro('financeiro', l.criado_por) then return private.erro('nao_encontrado'); end if;
  select * into vl from public.viagem_lancamentos where lancamento_id = l.id for update;
  if p_papel is null then
    if vl.viagem_id = p_viagem then delete from public.viagem_lancamentos where lancamento_id = l.id; end if;
    return jsonb_build_object('ok', true);
  end if;
  if p_papel not in ('adiantamento', 'despesa', 'devolucao') then return private.erro('invalido', 'papel'); end if;
  if l.situacao <> 'realizada' or l.estorno_de is not null or exists (select 1 from public.lancamentos e where e.estorno_de = l.id)
     or l.tipo <> (case when p_papel = 'devolucao' then 'entrada' else 'saida' end) then
    return private.erro('invalido', 'lancamento_id');
  end if;
  if vl.lancamento_id is not null and vl.viagem_id <> p_viagem then return private.erro('conflito', 'lancamento_id'); end if;
  insert into public.viagem_lancamentos (lancamento_id, viagem_id, papel, vinculado_por) values (l.id, p_viagem, p_papel, auth.uid())
  on conflict (lancamento_id) do update set papel = excluded.papel, vinculado_por = excluded.vinculado_por, vinculado_em = now();
  return jsonb_build_object('ok', true);
end $$;

-- Números da viagem: gasto, adiantado, devolvido, saldo do acerto, custo por atleta e por km.
create function private.numeros_viagem(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with m as (
    select coalesce(sum(l.valor) filter (where vl.papel = 'despesa'), 0) gasto,
           coalesce(sum(l.valor) filter (where vl.papel = 'adiantamento'), 0) adiantado,
           coalesce(sum(l.valor) filter (where vl.papel = 'devolucao'), 0) devolvido
      from public.viagem_lancamentos vl join public.lancamentos l on l.id = vl.lancamento_id
     where vl.viagem_id = p_id and l.situacao = 'realizada' and not exists (select 1 from public.lancamentos e where e.estorno_de = l.id)
  ), a as (select count(*) n from public.viagem_delegacao where viagem_id = p_id and funcao = 'atleta'),
     d as (select count(*) n from public.viagem_delegacao where viagem_id = p_id)
  select jsonb_build_object('gasto', m.gasto::text, 'adiantado', m.adiantado::text, 'devolvido', m.devolvido::text,
    -- positivo: quem recebeu o adiantamento ainda deve devolver; negativo: o gasto passou do adiantado (pago direto pela Associação Exemplo)
    'saldo_acerto', (m.adiantado - m.gasto - m.devolvido)::text,
    'atletas', a.n, 'delegacao', d.n,
    'custo_por_atleta', case when a.n > 0 then round(m.gasto / a.n, 2)::text end,
    'custo_por_km', case when v.distancia_km > 0 then round(m.gasto / v.distancia_km, 2)::text end)
  from m, a, d, public.viagens v where v.id = p_id
$$;

create function private.painel_viagens() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('painel_viagens', 'viagens', 'ver');
begin
  if v_erro is not null then return v_erro; end if;
  return jsonb_build_object('ok', true, 'viagens', coalesce((
    select jsonb_agg(jsonb_build_object('id', v.id) || private.numeros_viagem(v.id)) from public.viagens v), '[]'));
end $$;

-- Encerrar = acerto feito: o adiantamento foi todo gasto ou devolvido (ou completado com despesa).
create function private.encerrar_viagem(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('encerrar_viagem', 'viagens', 'editar'); v public.viagens; v_saldo numeric;
begin
  if v_erro is not null then return v_erro; end if;
  select * into v from public.viagens where id = p_id for update;
  if v.id is null then return private.erro('nao_encontrado'); end if;
  if v.situacao = 'encerrada' then return jsonb_build_object('ok', true, 'repetido', true); end if;
  if v.situacao = 'cancelada' then return private.erro('viagem_encerrada'); end if;
  if v.retorno > private.hoje() then return private.erro('invalido', 'retorno'); end if;
  v_saldo := (private.numeros_viagem(p_id) ->> 'saldo_acerto')::numeric;
  if v_saldo > 0 then return private.erro('acerto_pendente'); end if;
  update public.viagens set situacao = 'encerrada', encerrada_em = now(), atualizado_em = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function private.agenda_periodo(p_inicio date, p_fim date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('agenda_periodo', 'agenda', 'ver');
  v_eu uuid := auth.uid(); v_fin boolean; v_fin_tudo boolean;
  v_ini timestamptz; v_fim timestamptz; v_prazos jsonb := '[]';
begin
  if v_erro is not null then return v_erro; end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio or p_fim - p_inicio > 120 then return private.erro('invalido', 'periodo'); end if;
  v_ini := private.meia_noite(p_inicio); v_fim := private.meia_noite(p_fim + 1);
  v_fin := private.pode('financeiro', 'ver'); v_fin_tudo := v_fin and private.alcance('financeiro', 'ver') = 'tudo';

  if v_fin then
    select coalesce(jsonb_agg(jsonb_build_object('tipo', case when l.tipo = 'saida' then 'a_pagar' else 'a_receber' end,
             'titulo', l.descricao, 'data', to_char(l.data, 'YYYY-MM-DD'), 'ref', l.id) order by l.data), '[]')
      into v_prazos
    from (select * from public.lancamentos l where l.situacao = 'prevista' and l.data between p_inicio and p_fim
            and (v_fin_tudo or l.criado_por = v_eu) order by l.data limit 300) l;
    v_prazos := v_prazos || coalesce((
      select jsonb_agg(jsonb_build_object('tipo', 'fechamento',
               'titulo', 'Fechar ' || to_char(m - interval '1 month', 'MM/YYYY') || ' e enviar ao contador',
               'data', to_char(m + interval '9 days', 'YYYY-MM-DD'), 'ref', to_char(m - interval '1 month', 'YYYY-MM-DD')))
      from generate_series(date_trunc('month', p_inicio::timestamp), date_trunc('month', p_fim::timestamp), interval '1 month') m
      where (m + interval '9 days')::date between p_inicio and p_fim
        and not private.mes_fechado((m - interval '1 month')::date)), '[]');
  end if;
  if private.pode('tarefas', 'ver') then
    v_prazos := v_prazos || coalesce((
      select jsonb_agg(jsonb_build_object('tipo', 'tarefa', 'titulo', t.titulo, 'data', to_char(t.prazo, 'YYYY-MM-DD'),
               'ref', t.id, 'responsavel', t.responsavel) order by t.prazo)
      from (select * from public.tarefas t where t.prazo between p_inicio and p_fim and t.situacao in ('a_fazer', 'fazendo')
              and private.ve_tarefa(t.responsavel, t.criado_por) order by t.prazo limit 300) t), '[]');
  end if;
  if private.pode('verbas', 'ver') then
    v_prazos := v_prazos || coalesce((
      select jsonb_agg(x.j order by x.d) from (
        select v.prazo_pedido d, jsonb_build_object('tipo', 'verba', 'titulo', 'Prazo do pedido: ' || v.titulo, 'data', to_char(v.prazo_pedido, 'YYYY-MM-DD'), 'ref', v.id) j
          from public.verbas v where v.prazo_pedido between p_inicio and p_fim and v.situacao in ('ideia', 'pedido_enviado', 'em_analise')
            and private.ve_verba(v.criado_por, v.responsavel)
        union all
        select x.data_prevista, jsonb_build_object('tipo', 'verba', 'titulo', 'Parcela ' || x.numero || ' a receber: ' || v.titulo, 'data', to_char(x.data_prevista, 'YYYY-MM-DD'), 'ref', v.id)
          from public.verba_parcelas x join public.verbas v on v.id = x.verba_id
         where x.recebido_em is null and x.data_prevista between p_inicio and p_fim
           and v.situacao <> all (private.situacoes_verba_finais()) and private.ve_verba(v.criado_por, v.responsavel)
        limit 300) x), '[]');
  end if;
  if private.pode('projetos', 'ver') then
    v_prazos := v_prazos || coalesce((
      select jsonb_agg(x.j order by x.d) from (
        select p.vigencia_fim d, jsonb_build_object('tipo', 'projeto', 'titulo', 'Fim da vigência: ' || p.nome, 'data', to_char(p.vigencia_fim, 'YYYY-MM-DD'), 'ref', p.id) j
          from public.projetos p where p.vigencia_fim between p_inicio and p_fim and p.situacao in ('planejamento', 'em_execucao')
        union all
        select p.prazo_prestacao, jsonb_build_object('tipo', 'projeto', 'titulo', 'Prestação de contas final: ' || p.nome, 'data', to_char(p.prazo_prestacao, 'YYYY-MM-DD'), 'ref', p.id)
          from public.projetos p where p.prazo_prestacao between p_inicio and p_fim and p.situacao not in ('encerrado', 'cancelado')
        union all
        select p.prazo_prestacao_parcial, jsonb_build_object('tipo', 'projeto', 'titulo', 'Prestação de contas parcial: ' || p.nome, 'data', to_char(p.prazo_prestacao_parcial, 'YYYY-MM-DD'), 'ref', p.id)
          from public.projetos p where p.prazo_prestacao_parcial between p_inicio and p_fim and p.situacao not in ('encerrado', 'cancelado')
        limit 300) x), '[]');
  end if;
  -- Fase 4: validade de documentos de pessoas (sem os de saúde), governança e filiações
  if private.pode('pessoas', 'ver') then
    v_prazos := v_prazos || coalesce((
      select jsonb_agg(jsonb_build_object('tipo', 'documento', 'titulo', 'Vence documento de ' || x.nome, 'data', to_char(d.validade, 'YYYY-MM-DD'), 'ref', x.id) order by d.validade)
      from (select * from public.documentos_pessoa d where d.arquivado_em is null and d.validade between p_inicio and p_fim limit 300) d
      join public.pessoas x on x.id = d.pessoa_id where x.situacao <> 'desligado'), '[]');
  end if;
  if private.pode('documentos', 'ver') then
    v_prazos := v_prazos || coalesce((
      select jsonb_agg(x.j order by x.d) from (
        select d.validade d, jsonb_build_object('tipo', 'governanca', 'titulo', 'Vence: ' || d.titulo, 'data', to_char(d.validade, 'YYYY-MM-DD'), 'ref', d.id) j
          from public.documentos_institucionais d where d.arquivado_em is null and d.validade between p_inicio and p_fim
        union all
        select m.fim, jsonb_build_object('tipo', 'governanca', 'titulo', 'Fim do mandato: ' || m.cargo || ' — ' || m.nome, 'data', to_char(m.fim, 'YYYY-MM-DD'), 'ref', m.id)
          from public.mandatos m where m.fim between p_inicio and p_fim
        union all
        select private.data_local(r.data), jsonb_build_object('tipo', 'reuniao', 'titulo', r.titulo, 'data', to_char(private.data_local(r.data), 'YYYY-MM-DD'), 'ref', r.id)
          from public.reunioes r where r.situacao <> 'cancelada' and private.data_local(r.data) between p_inicio and p_fim
        limit 300) x), '[]');
  end if;
  if private.pode('filiacoes', 'ver') then
    v_prazos := v_prazos || coalesce((
      select jsonb_agg(x.j order by x.d) from (
        select f.validade d, jsonb_build_object('tipo', 'filiacao', 'titulo', 'Vence a filiação: ' || f.entidade, 'data', to_char(f.validade, 'YYYY-MM-DD'), 'ref', f.id) j
          from public.filiacoes f where f.situacao <> 'encerrada' and f.validade between p_inicio and p_fim
        union all
        select f.renovacao, jsonb_build_object('tipo', 'filiacao', 'titulo', 'Renovar: ' || f.entidade, 'data', to_char(f.renovacao, 'YYYY-MM-DD'), 'ref', f.id)
          from public.filiacoes f where f.situacao <> 'encerrada' and f.renovacao between p_inicio and p_fim
        limit 300) x), '[]');
  end if;
  if private.pode('patrimonio', 'ver') then
    v_prazos := v_prazos || coalesce((
      select jsonb_agg(jsonb_build_object('tipo', 'patrimonio', 'titulo', 'Manutenção: ' || b.numero || ' — ' || b.nome, 'data', to_char(m.proxima_em, 'YYYY-MM-DD'), 'ref', b.id) order by m.proxima_em)
      from (select distinct on (bem_id) * from public.manutencoes order by bem_id, data desc) m
      join public.bens b on b.id = m.bem_id
      where m.proxima_em between p_inicio and p_fim and b.situacao <> 'baixado'), '[]');
  end if;

  -- Fase 5: captação (próximo passo do funil, contrapartida a entregar, rifas e eventos) e viagens
  if private.pode('captacao', 'ver') then
    v_prazos := v_prazos || coalesce((
      select jsonb_agg(x.j order by x.d) from (
        select o.proximo_passo_em d, jsonb_build_object('tipo', 'captacao', 'titulo', coalesce(o.proximo_passo, 'Próximo passo') || ': ' || o.nome, 'data', to_char(o.proximo_passo_em, 'YYYY-MM-DD'), 'ref', o.id) j
          from public.oportunidades o where o.proximo_passo_em between p_inicio and p_fim and o.etapa not in ('fechado', 'perdido')
        union all
        select c.prazo, jsonb_build_object('tipo', 'contrapartida', 'titulo', 'Contrapartida: ' || c.descricao, 'data', to_char(c.prazo, 'YYYY-MM-DD'), 'ref', c.verba_id)
          from public.contrapartidas c where c.entregue_em is null and c.prazo between p_inicio and p_fim
        union all
        select a.data, jsonb_build_object('tipo', 'captacao', 'titulo', case a.tipo when 'rifa' then 'Sorteio: ' else 'Evento: ' end || a.nome, 'data', to_char(a.data, 'YYYY-MM-DD'), 'ref', a.id)
          from public.acoes_captacao a where a.situacao in ('planejada', 'em_andamento') and a.data between p_inicio and p_fim
        limit 300) x), '[]');
  end if;
  if private.pode('viagens', 'ver') then
    v_prazos := v_prazos || coalesce((
      select jsonb_agg(x.j order by x.d) from (
        select v.saida d, jsonb_build_object('tipo', 'viagem', 'titulo', 'Viagem: ' || v.titulo, 'data', to_char(v.saida, 'YYYY-MM-DD'), 'ref', v.id) j
          from public.viagens v where v.situacao in ('planejada', 'em_andamento') and v.saida between p_inicio and p_fim
        union all
        select v.retorno + 7, jsonb_build_object('tipo', 'viagem', 'titulo', 'Acerto da viagem: ' || v.titulo, 'data', to_char(v.retorno + 7, 'YYYY-MM-DD'), 'ref', v.id)
          from public.viagens v where v.situacao in ('planejada', 'em_andamento') and v.retorno + 7 between p_inicio and p_fim
        limit 300) x), '[]');
  end if;

  return jsonb_build_object('ok', true,
    'eventos', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'tipo_id', e.tipo_id, 'titulo', e.titulo, 'inicio', e.inicio, 'fim', e.fim,
               'dia_inteiro', e.dia_inteiro, 'local', e.local, 'descricao', e.descricao, 'projeto_id', e.projeto_id,
               'criado_por', e.criado_por, 'cancelado_em', e.cancelado_em, 'motivo_cancelamento', e.motivo_cancelamento,
               'participantes', coalesce((select jsonb_agg(ep.membro_id) from public.evento_participantes ep where ep.evento_id = e.id), '[]'))
             order by e.inicio)
      from (select * from public.eventos e
             where e.inicio < v_fim
               and (case when e.dia_inteiro then e.fim + interval '1 day'
                         when e.fim = e.inicio then e.fim + interval '1 second' else e.fim end) > v_ini
             order by e.inicio limit 500) e), '[]'),
    'prazos', v_prazos);
end $$;

insert into private.limites_operacao (operacao, maximo_por_hora) values
  ('salvar_viagem', 200), ('salvar_delegacao', 200), ('vincular_lancamento_viagem', 500), ('painel_viagens', 300), ('encerrar_viagem', 60);

create function public.salvar_viagem(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_viagem(p) $$;
create function public.salvar_delegacao(p_viagem uuid, p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_delegacao(p_viagem, p) $$;
create function public.vincular_lancamento_viagem(p_viagem uuid, p_lancamento uuid, p_papel text) returns jsonb language sql security invoker set search_path = '' as $$ select private.vincular_lancamento_viagem(p_viagem, p_lancamento, p_papel) $$;
create function public.painel_viagens() returns jsonb language sql security invoker set search_path = '' as $$ select private.painel_viagens() $$;
create function public.encerrar_viagem(p_id uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.encerrar_viagem(p_id) $$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
do $$
declare f text;
begin
  foreach f in array array['salvar_viagem(jsonb)','salvar_delegacao(uuid,jsonb)','vincular_lancamento_viagem(uuid,uuid,text)','painel_viagens()','encerrar_viagem(uuid)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('grant execute on function private.%s to authenticated', f);
  end loop;
end $$;
