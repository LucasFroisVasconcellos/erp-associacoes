-- 0020 · extrato bancário (OFX/CSV) e conciliação.
-- O aparelho lê o arquivo do banco e manda só as linhas (data, valor, descrição, id do banco);
-- o servidor valida, guarda sem duplicar e sugere o lançamento correspondente. O que sobra dos
-- dois lados vira pendência; o checklist do fechamento passa a contar as linhas sem conciliar.

create table public.extrato_linhas (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.contas_bancarias (id),
  data date not null,
  valor numeric(14, 2) not null check (valor <> 0 and abs(valor) <= 100000000),
  descricao text not null check (char_length(descricao) between 1 and 200 and descricao !~ '[[:cntrl:]]'),
  -- id da transação no banco (FITID do OFX) ou impressão digital da linha: reimportar não duplica
  chave text not null check (char_length(chave) between 3 and 120),
  lancamento_id uuid unique references public.lancamentos (id),
  ignorada_motivo text check (private.texto_opcional_ok(ignorada_motivo, 300)),
  conciliado_por uuid references public.membros (id),
  conciliado_em timestamptz,
  importado_por uuid not null references public.membros (id),
  importado_em timestamptz not null default now(),
  unique (conta_id, chave),
  check (lancamento_id is null or ignorada_motivo is null)
);
create index extrato_linhas_conta_data_idx on public.extrato_linhas (conta_id, data);
create index extrato_linhas_pendentes_idx on public.extrato_linhas (data) where lancamento_id is null and ignorada_motivo is null;
create index extrato_linhas_importado_por_idx on public.extrato_linhas (importado_por);
create index extrato_linhas_conciliado_por_idx on public.extrato_linhas (conciliado_por) where conciliado_por is not null;
select private.proteger_tabela('public.extrato_linhas');
create trigger extrato_linhas_auditar after insert or update or delete on public.extrato_linhas for each row execute function private.trg_auditar();
create trigger extrato_linhas_sem_apagar before delete on public.extrato_linhas for each row execute function private.trg_sem_apagar();
-- o extrato mostra todo o movimento da conta: só quem vê o financeiro inteiro
create policy ler on public.extrato_linhas for select to authenticated
  using ((select private.pode('financeiro', 'ver')) and (select private.alcance('financeiro', 'ver')) = 'tudo');

-- Lançamentos que podem corresponder a uma linha: mesma conta, mesmo valor e sentido,
-- realizados, ainda sem linha, até 5 dias de diferença (o mais próximo primeiro).
create function private.candidatos_extrato(x public.extrato_linhas) returns setof public.lancamentos
language sql stable security definer set search_path = '' as $$
  select l.* from public.lancamentos l
   where l.conta_id = x.conta_id and l.situacao = 'realizada'
     and l.tipo = case when x.valor > 0 then 'entrada' else 'saida' end
     and l.valor = abs(x.valor)
     and l.data between x.data - 5 and x.data + 5
     and not exists (select 1 from public.extrato_linhas e where e.lancamento_id = l.id)
   order by abs(l.data - x.data), l.criado_em
   limit 5
$$;

create function private.importar_extrato(p_conta uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('importar_extrato', 'financeiro', 'editar'); v_n int; v_total int;
begin
  if v_erro is not null then return v_erro; end if;
  if not exists (select 1 from public.contas_bancarias where id = p_conta and ativa) then return private.erro('invalido', 'conta_id'); end if;
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) not between 1 and 2000 then return private.erro('invalido', 'linhas'); end if;
  if exists (select 1 from jsonb_array_elements(p) x
              where jsonb_typeof(x) <> 'object' or not private.so_chaves(x, array['data','valor','descricao','id'])
                 or private.j_data(x -> 'data') is null or private.j_data(x -> 'data') not between private.hoje() - 800 and private.hoje()
                 or coalesce(private.j_valor(x -> 'valor', true), 0) = 0
                 or private.j_texto(x -> 'descricao') is null or char_length(private.j_texto(x -> 'descricao')) not between 1 and 200
                 or private.j_texto(x -> 'descricao') ~ '[[:cntrl:]]'
                 or (not private.vazio(x -> 'id') and coalesce(private.j_texto(x -> 'id'), '') !~ '^[A-Za-z0-9._:/-]{1,100}$')) then
    return private.erro('invalido', 'linhas');
  end if;
  v_total := jsonb_array_length(p);
  insert into public.extrato_linhas (conta_id, data, valor, descricao, chave, importado_por)
  select p_conta, private.j_data(x -> 'data'), private.j_valor(x -> 'valor', true), private.j_texto(x -> 'descricao'),
         -- com id do banco, ele é a chave; sem id, a linha + a ordem entre linhas iguais do mesmo arquivo
         coalesce('id:' || private.j_texto(x -> 'id'),
                  'h:' || md5(concat_ws('|', x ->> 'data', private.j_valor(x -> 'valor', true)::text, lower(private.j_texto(x -> 'descricao')),
                       row_number() over (partition by x ->> 'data', private.j_valor(x -> 'valor', true), lower(private.j_texto(x -> 'descricao')) order by n)))),
         auth.uid()
  from jsonb_array_elements(p) with ordinality t(x, n)
  on conflict (conta_id, chave) do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'novas', v_n, 'repetidas', v_total - v_n);
end $$;

create function private.conciliar(p_linha uuid, p_lancamento uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('conciliar', 'financeiro', 'editar'); x public.extrato_linhas; l public.lancamentos;
begin
  if v_erro is not null then return v_erro; end if;
  select * into x from public.extrato_linhas where id = p_linha for update;
  if x.id is null then return private.erro('nao_encontrado'); end if;
  if x.lancamento_id = p_lancamento then return jsonb_build_object('ok', true, 'repetido', true); end if;
  if x.lancamento_id is not null or x.ignorada_motivo is not null then return private.erro('ja_conciliada'); end if;
  select * into l from public.lancamentos where id = p_lancamento for update;
  if l.id is null or l.conta_id <> x.conta_id or l.situacao <> 'realizada' or l.valor <> abs(x.valor)
     or l.tipo <> (case when x.valor > 0 then 'entrada' else 'saida' end) then
    return private.erro('invalido', 'lancamento_id');
  end if;
  if exists (select 1 from public.extrato_linhas where lancamento_id = l.id) then return private.erro('ja_conciliada'); end if;
  update public.extrato_linhas set lancamento_id = l.id, conciliado_por = auth.uid(), conciliado_em = now() where id = x.id;
  return jsonb_build_object('ok', true);
end $$;

-- Aceita de uma vez as sugestões sem dúvida: um só candidato, e ele só serve para esta linha.
create function private.conciliar_automatico(p_conta uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('conciliar_automatico', 'financeiro', 'editar'); v_n int;
begin
  if v_erro is not null then return v_erro; end if;
  perform 1 from public.extrato_linhas where conta_id = p_conta and lancamento_id is null and ignorada_motivo is null for update;
  with par as (
    select x.id linha, (select c.id from private.candidatos_extrato(x) c limit 1) lanc,
           (select count(*) from private.candidatos_extrato(x)) n
      from public.extrato_linhas x
     where x.conta_id = p_conta and x.lancamento_id is null and x.ignorada_motivo is null
  ), unicos as (
    select linha, lanc from par where n = 1 and lanc is not null
       and (select count(*) from par p2 where p2.lanc = par.lanc) = 1
  )
  update public.extrato_linhas e set lancamento_id = u.lanc, conciliado_por = auth.uid(), conciliado_em = now()
    from unicos u where e.id = u.linha;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'conciliadas', v_n);
end $$;

-- Linha que não vira lançamento (ex.: transferência entre contas já lançada de outro jeito), com motivo.
create function private.ignorar_linha(p_linha uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('ignorar_linha', 'financeiro', 'editar'); x public.extrato_linhas;
begin
  if v_erro is not null then return v_erro; end if;
  if not private.texto_ok(p_motivo, 3, 300) then return private.erro('invalido', 'motivo'); end if;
  select * into x from public.extrato_linhas where id = p_linha for update;
  if x.id is null then return private.erro('nao_encontrado'); end if;
  if x.lancamento_id is not null or x.ignorada_motivo is not null then return private.erro('ja_conciliada'); end if;
  update public.extrato_linhas set ignorada_motivo = btrim(p_motivo), conciliado_por = auth.uid(), conciliado_em = now() where id = x.id;
  return jsonb_build_object('ok', true);
end $$;

create function private.desfazer_conciliacao(p_linha uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('desfazer_conciliacao', 'financeiro', 'editar'); x public.extrato_linhas;
begin
  if v_erro is not null then return v_erro; end if;
  select * into x from public.extrato_linhas where id = p_linha for update;
  if x.id is null then return private.erro('nao_encontrado'); end if;
  if private.mes_fechado(x.data) then return private.erro('mes_fechado'); end if;
  if x.lancamento_id is null and x.ignorada_motivo is null then return jsonb_build_object('ok', true, 'repetido', true); end if;
  update public.extrato_linhas set lancamento_id = null, ignorada_motivo = null, conciliado_por = null, conciliado_em = null where id = x.id;
  return jsonb_build_object('ok', true);
end $$;

-- Painel de uma conta num período: linhas (com sugestões) e lançamentos sem linha no extrato.
create function private.painel_conciliacao(p_conta uuid, p_inicio date, p_fim date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('painel_conciliacao', 'financeiro', 'ver');
begin
  if v_erro is not null then return v_erro; end if;
  if private.alcance('financeiro', 'ver') <> 'tudo' then return private.negar('painel_conciliacao'); end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio or p_fim - p_inicio > 400 then return private.erro('invalido', 'periodo'); end if;
  return jsonb_build_object('ok', true,
    'linhas', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'data', x.data, 'valor', x.valor::text, 'descricao', x.descricao,
        'lancamento_id', x.lancamento_id, 'ignorada_motivo', x.ignorada_motivo,
        'sugestoes', case when x.lancamento_id is null and x.ignorada_motivo is null then coalesce((
           select jsonb_agg(jsonb_build_object('id', c.id, 'data', c.data, 'descricao', c.descricao)) from private.candidatos_extrato(x) c), '[]') end)
      order by x.data desc, x.importado_em)
      from (select * from public.extrato_linhas x where x.conta_id = p_conta and x.data between p_inicio and p_fim
             order by x.data desc limit 1000) x), '[]'),
    'sem_extrato', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'data', l.data, 'tipo', l.tipo, 'valor', l.valor::text, 'descricao', l.descricao) order by l.data)
      from (select * from public.lancamentos l where l.conta_id = p_conta and l.situacao = 'realizada' and l.data between p_inicio and p_fim
              and not exists (select 1 from public.extrato_linhas e where e.lancamento_id = l.id)
              -- só cobra o que o extrato importado cobre
              and exists (select 1 from public.extrato_linhas e where e.conta_id = p_conta and e.data >= l.data)
              and exists (select 1 from public.extrato_linhas e where e.conta_id = p_conta and e.data <= l.data)
            order by l.data limit 500) l), '[]'));
end $$;

-- Linhas do extrato ainda sem conciliar no mês (usado pelo checklist e pelo fechamento).
create function private.extrato_pendente(p_inicio date, p_fim date) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.extrato_linhas where data between p_inicio and p_fim and lancamento_id is null and ignorada_motivo is null
$$;

create or replace function private.checklist_fechamento(p_competencia date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('checklist_fechamento', 'financeiro', 'ver');
  v_fim date; v_sem int; v_prev int; v_reemb int; v_fechado boolean; v_passado boolean; v_extr int; v_tem_extrato boolean;
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
  v_tem_extrato := exists (select 1 from public.extrato_linhas where data between p_competencia and v_fim);
  v_extr := private.extrato_pendente(p_competencia, v_fim);
  return jsonb_build_object('ok', true, 'competencia', p_competencia, 'ja_fechado', v_fechado, 'mes_encerrado', v_passado,
    'pode_fechar', not v_fechado and v_passado and v_sem = 0 and v_extr = 0,
    'itens', jsonb_build_array(
      jsonb_build_object('chave', 'comprovantes', 'titulo', 'Toda saída tem comprovante ou justificativa', 'pendentes', v_sem, 'bloqueia', true),
      jsonb_build_object('chave', 'previstas_vencidas', 'titulo', 'Contas vencidas no mês foram pagas ou recebidas', 'pendentes', v_prev, 'bloqueia', false),
      jsonb_build_object('chave', 'reembolsos', 'titulo', 'Pedidos de reembolso do mês foram decididos', 'pendentes', v_reemb, 'bloqueia', false),
      -- com extrato importado, o sistema conta; sem extrato, a conferência continua manual
      jsonb_build_object('chave', 'extrato', 'titulo', 'Extrato do banco conferido com os lançamentos',
        'pendentes', case when v_tem_extrato then v_extr end, 'bloqueia', true, 'manual', true)));
end $$;

create or replace function private.fechar_mes(p_competencia date, p_confirmacoes jsonb) returns jsonb
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
  lock table public.lancamentos in share row exclusive mode;
  v_fim := (p_competencia + interval '1 month' - interval '1 day')::date;
  if exists (select 1 from private.saidas_sem_comprovante(p_competencia, v_fim)) then return private.erro('pendencias'); end if;
  -- Fase 5: linha do extrato sem conciliar também impede o fechamento
  if private.extrato_pendente(p_competencia, v_fim) > 0 then return private.erro('pendencias'); end if;
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

insert into private.limites_operacao (operacao, maximo_por_hora) values
  ('importar_extrato', 30), ('conciliar', 1000), ('conciliar_automatico', 60), ('ignorar_linha', 500),
  ('desfazer_conciliacao', 300), ('painel_conciliacao', 300);

create function public.importar_extrato(p_conta uuid, p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.importar_extrato(p_conta, p) $$;
create function public.conciliar(p_linha uuid, p_lancamento uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.conciliar(p_linha, p_lancamento) $$;
create function public.conciliar_automatico(p_conta uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.conciliar_automatico(p_conta) $$;
create function public.ignorar_linha(p_linha uuid, p_motivo text) returns jsonb language sql security invoker set search_path = '' as $$ select private.ignorar_linha(p_linha, p_motivo) $$;
create function public.desfazer_conciliacao(p_linha uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.desfazer_conciliacao(p_linha) $$;
create function public.painel_conciliacao(p_conta uuid, p_inicio date, p_fim date) returns jsonb language sql security invoker set search_path = '' as $$ select private.painel_conciliacao(p_conta, p_inicio, p_fim) $$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
do $$
declare f text;
begin
  foreach f in array array['importar_extrato(uuid,jsonb)','conciliar(uuid,uuid)','conciliar_automatico(uuid)','ignorar_linha(uuid,text)',
                           'desfazer_conciliacao(uuid)','painel_conciliacao(uuid,date,date)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('grant execute on function private.%s to authenticated', f);
  end loop;
end $$;
