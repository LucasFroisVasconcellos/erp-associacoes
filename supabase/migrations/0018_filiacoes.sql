-- 0018 · Filiações e vínculos institucionais e os prazos na agenda.
-- Cadastro aberto (tipos criados pela diretoria), situação com histórico (auditoria), datas com
-- alerta, contribuição que vira conta a pagar no financeiro, checklist de documentos que
-- reaproveita os documentos da governança, e o alerta de dependência: verba que depende de uma
-- filiação pendente, suspensa ou vencida aparece como risco.

create table public.tipos_filiacao (
  id uuid primary key,
  nome text not null check (private.texto_ok(nome, 2, 60)),
  ativo boolean not null default true,
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now()
);
create unique index tipos_filiacao_nome_unico on public.tipos_filiacao (lower(nome));
create index tipos_filiacao_criado_por_idx on public.tipos_filiacao (criado_por);

create table public.filiacoes (
  id uuid primary key,
  entidade text not null check (private.texto_ok(entidade, 2, 160)),
  tipo_id uuid not null references public.tipos_filiacao (id),
  categoria text check (private.texto_opcional_ok(categoria, 80)),
  situacao text not null default 'preparacao' check (situacao in ('preparacao', 'ativa', 'pendente', 'suspensa', 'encerrada')),
  inicio date,
  validade date,
  renovacao date,
  contribuicao_valor numeric(14, 2) check (contribuicao_valor between 0 and 1000000),
  contribuicao_periodicidade text check (contribuicao_periodicidade in ('mensal', 'anual', 'outra')),
  recorrencia_id uuid references public.recorrencias (id),
  beneficios text check (char_length(beneficios) <= 1000 and beneficios !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]'),
  obrigacoes text check (char_length(obrigacoes) <= 1000 and obrigacoes !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]'),
  responsavel uuid references public.membros (id),
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index filiacoes_tipo_idx on public.filiacoes (tipo_id);
create index filiacoes_recorrencia_idx on public.filiacoes (recorrencia_id) where recorrencia_id is not null;
create index filiacoes_responsavel_idx on public.filiacoes (responsavel) where responsavel is not null;
create index filiacoes_criado_por_idx on public.filiacoes (criado_por);

create table public.filiacao_documentos (
  id uuid primary key,
  filiacao_id uuid not null references public.filiacoes (id),
  nome text not null check (private.texto_ok(nome, 2, 200)),
  documento_institucional_id uuid references public.documentos_institucionais (id),
  entregue_em date
);
create unique index filiacao_documentos_unico on public.filiacao_documentos (filiacao_id, lower(nome));
create index filiacao_documentos_doc_idx on public.filiacao_documentos (documento_institucional_id) where documento_institucional_id is not null;

-- dependência: verba que só vale com a filiação em dia
alter table public.verbas add column filiacao_id uuid references public.filiacoes (id);
create index verbas_filiacao_idx on public.verbas (filiacao_id) where filiacao_id is not null;

do $$ declare t text; begin
  foreach t in array array['tipos_filiacao','filiacoes','filiacao_documentos'] loop
    perform private.proteger_tabela(format('public.%I', t)::regclass);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.trg_auditar()', t || '_auditar', t);
    execute format('create policy ler on public.%I for select to authenticated using ((select private.pode(''filiacoes'', ''ver'')))', t);
  end loop;
  foreach t in array array['tipos_filiacao','filiacoes'] loop
    execute format('create trigger %I before delete on public.%I for each row execute function private.trg_sem_apagar()', t || '_sem_apagar', t);
  end loop;
end $$;

create function private.salvar_tipo_filiacao(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_tipo_filiacao', 'filiacoes', 'editar'); v_id uuid; v_nome text;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','nome','ativo']), false) then return private.erro('invalido'); end if;
  v_id := private.j_uuid(p -> 'id');      if v_id is null then return private.erro('invalido', 'id'); end if;
  v_nome := private.j_texto(p -> 'nome'); if not private.texto_ok(v_nome, 2, 60) then return private.erro('invalido', 'nome'); end if;
  if not private.vazio(p -> 'ativo') and private.j_bool(p -> 'ativo') is null then return private.erro('invalido', 'ativo'); end if;
  if exists (select 1 from public.tipos_filiacao where lower(nome) = lower(v_nome) and id <> v_id) then return private.erro('duplicado', 'nome'); end if;
  insert into public.tipos_filiacao (id, nome, ativo, criado_por) values (v_id, v_nome, coalesce(private.j_bool(p -> 'ativo'), true), auth.uid())
  on conflict (id) do update set nome = excluded.nome, ativo = excluded.ativo;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Tipos sugeridos (só se a diretoria pedir).
create function private.importar_tipos_filiacao() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('importar_tipos_filiacao', 'filiacoes', 'editar'); v_n int;
begin
  if v_erro is not null then return v_erro; end if;
  insert into public.tipos_filiacao (id, nome, criado_por)
  select gen_random_uuid(), m.nome, auth.uid()
  from (values ('Confederação'), ('Federação'), ('Comitê'), ('Conselho'), ('Cadastro governamental'), ('Parceria')) m(nome)
  where not exists (select 1 from public.tipos_filiacao t where lower(t.nome) = lower(m.nome))
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'criados', v_n);
end $$;

create function private.salvar_filiacao(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_filiacao', 'filiacoes', 'criar'); v_id uuid; f public.filiacoes; v_tipo uuid;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','entidade','tipo_id','categoria','situacao','inicio','validade','renovacao','contribuicao_valor',
       'contribuicao_periodicidade','beneficios','obrigacoes','responsavel']), false) then
    return private.erro('invalido');
  end if;
  v_id := private.j_uuid(p -> 'id'); if v_id is null then return private.erro('invalido', 'id'); end if;
  if not private.texto_ok(private.j_texto(p -> 'entidade'), 2, 160) then return private.erro('invalido', 'entidade'); end if;
  v_tipo := private.j_uuid(p -> 'tipo_id');
  if v_tipo is null or not exists (select 1 from public.tipos_filiacao where id = v_tipo) then return private.erro('invalido', 'tipo_id'); end if;
  if not private.vazio(p -> 'categoria') and not private.texto_ok(private.j_texto(p -> 'categoria'), 1, 80) then return private.erro('invalido', 'categoria'); end if;
  if coalesce(private.j_texto(p -> 'situacao'), 'preparacao') not in ('preparacao', 'ativa', 'pendente', 'suspensa', 'encerrada') then return private.erro('invalido', 'situacao'); end if;
  if not private.vazio(p -> 'inicio') and private.j_data(p -> 'inicio') is null then return private.erro('invalido', 'inicio'); end if;
  if not private.vazio(p -> 'validade') and (private.j_data(p -> 'validade') is null or private.j_data(p -> 'validade') > private.hoje() + 3700) then return private.erro('invalido', 'validade'); end if;
  if not private.vazio(p -> 'renovacao') and (private.j_data(p -> 'renovacao') is null or private.j_data(p -> 'renovacao') > private.hoje() + 3700) then return private.erro('invalido', 'renovacao'); end if;
  if not private.vazio(p -> 'contribuicao_valor') and private.j_valor(p -> 'contribuicao_valor') is null then return private.erro('invalido', 'contribuicao_valor'); end if;
  if not private.vazio(p -> 'contribuicao_periodicidade') and coalesce(private.j_texto(p -> 'contribuicao_periodicidade'), '') not in ('mensal', 'anual', 'outra') then
    return private.erro('invalido', 'contribuicao_periodicidade');
  end if;
  if not private.vazio(p -> 'beneficios') and (jsonb_typeof(p -> 'beneficios') <> 'string' or not private.texto_longo_ok(p ->> 'beneficios', 1000)) then return private.erro('invalido', 'beneficios'); end if;
  if not private.vazio(p -> 'obrigacoes') and (jsonb_typeof(p -> 'obrigacoes') <> 'string' or not private.texto_longo_ok(p ->> 'obrigacoes', 1000)) then return private.erro('invalido', 'obrigacoes'); end if;
  if not private.vazio(p -> 'responsavel') and not private.membro_ativo(private.j_uuid(p -> 'responsavel')) then return private.erro('invalido', 'responsavel'); end if;
  select * into f from public.filiacoes where id = v_id for update;
  if f.id is not null and not private.pode('filiacoes', 'editar') and f.criado_por <> auth.uid() then return private.negar('salvar_filiacao'); end if;
  insert into public.filiacoes (id, entidade, tipo_id, categoria, situacao, inicio, validade, renovacao, contribuicao_valor, contribuicao_periodicidade,
                                beneficios, obrigacoes, responsavel, criado_por)
  values (v_id, private.j_texto(p -> 'entidade'), v_tipo, nullif(private.j_texto(p -> 'categoria'), ''), coalesce(private.j_texto(p -> 'situacao'), 'preparacao'),
          private.j_data(p -> 'inicio'), private.j_data(p -> 'validade'), private.j_data(p -> 'renovacao'), private.j_valor(p -> 'contribuicao_valor'),
          private.j_texto(p -> 'contribuicao_periodicidade'), nullif(btrim(coalesce(p ->> 'beneficios', '')), ''), nullif(btrim(coalesce(p ->> 'obrigacoes', '')), ''),
          private.j_uuid(p -> 'responsavel'), auth.uid())
  on conflict (id) do update set entidade = excluded.entidade, tipo_id = excluded.tipo_id, categoria = excluded.categoria, situacao = excluded.situacao,
    inicio = excluded.inicio, validade = excluded.validade, renovacao = excluded.renovacao, contribuicao_valor = excluded.contribuicao_valor,
    contribuicao_periodicidade = excluded.contribuicao_periodicidade, beneficios = excluded.beneficios, obrigacoes = excluded.obrigacoes,
    responsavel = excluded.responsavel, atualizado_em = now();
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Contribuição → financeiro. Mensal: conta recorrente; anual ou outra: uma conta a pagar na renovação.
-- Ids determinísticos: gerar de novo não duplica. Exige quem administra o financeiro.
create function private.gerar_contribuicao(p_filiacao uuid, p_categoria uuid, p_dia int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('gerar_contribuicao', 'financeiro', 'administrar'); f public.filiacoes; r jsonb; v_id uuid;
begin
  if v_erro is not null then return v_erro; end if;
  if not private.pode('filiacoes', 'ver') then return private.negar('gerar_contribuicao'); end if;
  select * into f from public.filiacoes where id = p_filiacao for update;
  if f.id is null then return private.erro('nao_encontrado'); end if;
  if coalesce(f.contribuicao_valor, 0) <= 0 or f.contribuicao_periodicidade is null then return private.erro('invalido', 'contribuicao_valor'); end if;
  if f.situacao = 'encerrada' then return private.erro('invalido', 'situacao'); end if;
  if f.contribuicao_periodicidade = 'mensal' then
    v_id := md5('filiacao:' || f.id::text)::uuid;
    r := private.salvar_recorrencia(jsonb_build_object('id', v_id, 'tipo', 'saida', 'descricao', left('Contribuição — ' || f.entidade, 200),
           'valor', f.contribuicao_valor::text, 'categoria_id', p_categoria, 'dia', p_dia, 'inicio', to_char(private.hoje(), 'YYYY-MM-DD')));
    if r ? 'erro' then return r; end if;
    update public.filiacoes set recorrencia_id = v_id, atualizado_em = now() where id = f.id;
  else
    if f.renovacao is null or f.renovacao < private.hoje() then return private.erro('invalido', 'renovacao'); end if;
    v_id := md5('filiacao:' || f.id::text || ':' || f.renovacao::text)::uuid;
    r := private.criar_lancamento(jsonb_build_object('id', v_id, 'tipo', 'saida', 'situacao', 'prevista', 'valor', f.contribuicao_valor::text,
           'data', to_char(f.renovacao, 'YYYY-MM-DD'), 'descricao', left('Contribuição — ' || f.entidade, 200), 'categoria_id', p_categoria));
    if r ? 'erro' then return r; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create function private.salvar_documento_filiacao(p_filiacao uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_documento_filiacao', 'filiacoes', 'editar'); v_id uuid; d public.filiacao_documentos; v_inst uuid;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','nome','documento_institucional_id','entregue']), false) then return private.erro('invalido'); end if;
  if not exists (select 1 from public.filiacoes where id = p_filiacao) then return private.erro('nao_encontrado'); end if;
  v_id := private.j_uuid(p -> 'id'); if v_id is null then return private.erro('invalido', 'id'); end if;
  select * into d from public.filiacao_documentos where id = v_id for update;
  if d.id is not null and d.filiacao_id <> p_filiacao then return private.erro('conflito', 'id'); end if;
  if not private.vazio(p -> 'documento_institucional_id') then
    v_inst := private.j_uuid(p -> 'documento_institucional_id');
    if v_inst is null or not exists (select 1 from public.documentos_institucionais where id = v_inst) then return private.erro('invalido', 'documento_institucional_id'); end if;
  end if;
  if not private.vazio(p -> 'entregue') and private.j_bool(p -> 'entregue') is null then return private.erro('invalido', 'entregue'); end if;
  if d.id is null then
    if not private.texto_ok(private.j_texto(p -> 'nome'), 2, 200) then return private.erro('invalido', 'nome'); end if;
    if exists (select 1 from public.filiacao_documentos where filiacao_id = p_filiacao and lower(nome) = lower(private.j_texto(p -> 'nome'))) then return private.erro('duplicado', 'nome'); end if;
    insert into public.filiacao_documentos (id, filiacao_id, nome, documento_institucional_id, entregue_em)
    values (v_id, p_filiacao, private.j_texto(p -> 'nome'), v_inst, case when private.j_bool(p -> 'entregue') then private.hoje() end);
  else
    update public.filiacao_documentos set documento_institucional_id = case when p ? 'documento_institucional_id' then v_inst else documento_institucional_id end,
      entregue_em = case when private.j_bool(p -> 'entregue') is null then entregue_em when private.j_bool(p -> 'entregue') then coalesce(entregue_em, private.hoje()) end
    where id = v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create function private.definir_dependencia_verba(p_verba uuid, p_filiacao uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('definir_dependencia_verba', 'verbas', 'editar'); v public.verbas;
begin
  if v_erro is not null then return v_erro; end if;
  select * into v from public.verbas where id = p_verba for update;
  if v.id is null or not private.ve_verba(v.criado_por, v.responsavel) then return private.erro('nao_encontrado'); end if;
  if p_filiacao is not null and not exists (select 1 from public.filiacoes where id = p_filiacao) then return private.erro('invalido', 'filiacao_id'); end if;
  update public.verbas set filiacao_id = p_filiacao, atualizado_em = now() where id = p_verba;
  return jsonb_build_object('ok', true);
end $$;

-- Situação de cada filiação, com documentos pendentes (ou vencidos na governança) e verbas em risco.
create function private.painel_filiacoes() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('painel_filiacoes', 'filiacoes', 'ver'); v_hoje date := private.hoje(); v_verbas boolean := private.pode('verbas', 'ver');
begin
  if v_erro is not null then return v_erro; end if;
  return jsonb_build_object('ok', true, 'filiacoes', coalesce((
    select jsonb_agg(jsonb_build_object('id', f.id,
      'vencida', f.validade is not null and f.validade < v_hoje,
      'vence_em_breve', f.validade is not null and f.validade between v_hoje and v_hoje + 45,
      'documentos_pendentes', (select count(*) from public.filiacao_documentos d
                                 left join public.documentos_institucionais i on i.id = d.documento_institucional_id
                                where d.filiacao_id = f.id and (d.entregue_em is null or (i.validade is not null and i.validade < v_hoje))),
      'verbas_em_risco', case when v_verbas then coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'titulo', v.titulo))
           from public.verbas v where v.filiacao_id = f.id and v.situacao <> all (private.situacoes_verba_finais())
             and private.ve_verba(v.criado_por, v.responsavel)
             and (f.situacao in ('pendente', 'suspensa', 'encerrada') or (f.validade is not null and f.validade < v_hoje))), '[]') end))
    from public.filiacoes f), '[]'));
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
  ('salvar_tipo_filiacao', 60), ('importar_tipos_filiacao', 10), ('salvar_filiacao', 200), ('gerar_contribuicao', 30),
  ('salvar_documento_filiacao', 300), ('definir_dependencia_verba', 100), ('painel_filiacoes', 300);

create function public.salvar_tipo_filiacao(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_tipo_filiacao(p) $$;
create function public.importar_tipos_filiacao() returns jsonb language sql security invoker set search_path = '' as $$ select private.importar_tipos_filiacao() $$;
create function public.salvar_filiacao(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_filiacao(p) $$;
create function public.gerar_contribuicao(p_filiacao uuid, p_categoria uuid, p_dia int) returns jsonb language sql security invoker set search_path = '' as $$ select private.gerar_contribuicao(p_filiacao, p_categoria, p_dia) $$;
create function public.salvar_documento_filiacao(p_filiacao uuid, p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_documento_filiacao(p_filiacao, p) $$;
create function public.definir_dependencia_verba(p_verba uuid, p_filiacao uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.definir_dependencia_verba(p_verba, p_filiacao) $$;
create function public.painel_filiacoes() returns jsonb language sql security invoker set search_path = '' as $$ select private.painel_filiacoes() $$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
do $$
declare f text;
begin
  foreach f in array array['salvar_tipo_filiacao(jsonb)','importar_tipos_filiacao()','salvar_filiacao(jsonb)','gerar_contribuicao(uuid,uuid,integer)',
                           'salvar_documento_filiacao(uuid,jsonb)','definir_dependencia_verba(uuid,uuid)','painel_filiacoes()'] loop
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('grant execute on function private.%s to authenticated', f);
  end loop;
end $$;
