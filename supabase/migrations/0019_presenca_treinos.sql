-- 0019 · lista de presença dos atletas em treinos e jogos.
-- Quem marca: quem pode mexer no evento e vê o cadastro de pessoas.
-- Só atletas ativos; evento não cancelado e já começado (ou começando em até 1 dia).
-- A presença entra na prestação de contas do projeto ligado ao evento (comprova a atividade).

create table public.evento_presencas (
  evento_id uuid not null references public.eventos (id),
  pessoa_id uuid not null references public.pessoas (id),
  presente boolean not null,
  justificativa text check (private.texto_opcional_ok(justificativa, 200)),
  registrado_por uuid not null references public.membros (id),
  registrado_em timestamptz not null default now(),
  primary key (evento_id, pessoa_id)
);
create index evento_presencas_pessoa_idx on public.evento_presencas (pessoa_id);
create index evento_presencas_registrado_por_idx on public.evento_presencas (registrado_por);
select private.proteger_tabela('public.evento_presencas');
create trigger evento_presencas_auditar after insert or update or delete on public.evento_presencas for each row execute function private.trg_auditar();
create policy ler on public.evento_presencas for select to authenticated
  using ((select private.pode('agenda', 'ver')) and (select private.pode('pessoas', 'ver')));

-- Substitui a lista inteira do evento (marcar de novo corrige). p = [{pessoa_id, presente, justificativa?}]
create function private.salvar_presenca_evento(p_evento uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_presenca_evento', 'agenda', 'criar'); e public.eventos; v_n int; v_pres int;
begin
  if v_erro is not null then return v_erro; end if;
  if not private.pode('pessoas', 'ver') then return private.negar('salvar_presenca_evento'); end if;
  select * into e from public.eventos where id = p_evento for update;
  if e.id is null then return private.erro('nao_encontrado'); end if;
  if not (private.pode('agenda', 'editar') or e.criado_por = auth.uid()) then return private.negar('salvar_presenca_evento'); end if;
  if e.cancelado_em is not null then return private.erro('invalido', 'evento'); end if;
  if e.inicio > now() + interval '1 day' then return private.erro('evento_futuro'); end if;
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) > 300
     or exists (select 1 from jsonb_array_elements(p) x
                 where jsonb_typeof(x) <> 'object' or not private.so_chaves(x, array['pessoa_id','presente','justificativa'])
                    or private.j_bool(x -> 'presente') is null
                    or not exists (select 1 from public.pessoas s where s.id = private.j_uuid(x -> 'pessoa_id') and s.atleta and s.situacao = 'ativo')
                    or (not private.vazio(x -> 'justificativa') and not private.texto_ok(private.j_texto(x -> 'justificativa'), 2, 200)))
     or (select count(distinct x ->> 'pessoa_id') from jsonb_array_elements(p) x) <> jsonb_array_length(p) then
    return private.erro('invalido', 'presencas');
  end if;
  delete from public.evento_presencas where evento_id = p_evento;
  insert into public.evento_presencas (evento_id, pessoa_id, presente, justificativa, registrado_por)
  select p_evento, private.j_uuid(x -> 'pessoa_id'), private.j_bool(x -> 'presente'), nullif(private.j_texto(x -> 'justificativa'), ''), auth.uid()
  from jsonb_array_elements(p) x;
  get diagnostics v_n = row_count;
  select count(*) into v_pres from public.evento_presencas where evento_id = p_evento and presente;
  return jsonb_build_object('ok', true, 'marcados', v_n, 'presentes', v_pres);
end $$;

-- Frequência por atleta num período (para a ficha do atleta e para a comissão técnica).
create function private.frequencia_atletas(p_inicio date, p_fim date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('frequencia_atletas', 'pessoas', 'ver');
begin
  if v_erro is not null then return v_erro; end if;
  if not private.pode('agenda', 'ver') then return private.negar('frequencia_atletas'); end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio or p_fim - p_inicio > 400 then return private.erro('invalido', 'periodo'); end if;
  return jsonb_build_object('ok', true, 'atletas', coalesce((
    select jsonb_agg(jsonb_build_object('pessoa_id', x.pessoa_id, 'presentes', x.presentes, 'marcados', x.marcados))
    from (select ep.pessoa_id, count(*) filter (where ep.presente) presentes, count(*) marcados
            from public.evento_presencas ep join public.eventos e on e.id = ep.evento_id
           where e.cancelado_em is null and private.data_local(e.inicio) between p_inicio and p_fim
           group by ep.pessoa_id) x), '[]'));
end $$;

-- Prestação de contas: cada atividade do projeto leva o número de atletas presentes.
create or replace function private.dados_prestacao(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('dados_prestacao', 'projetos', 'exportar'); pr public.projetos; v public.verbas;
begin
  if v_erro is not null then return v_erro; end if;
  if not (private.pode('financeiro', 'ver') and private.alcance('financeiro', 'ver') = 'tudo') then return private.negar('dados_prestacao'); end if;
  select * into pr from public.projetos where id = p_id;
  if pr.id is null then return private.erro('nao_encontrado'); end if;
  select * into v from public.verbas where id = pr.verba_id;
  perform private.registrar('exportar', 'projetos', p_id::text, null, jsonb_build_object('relatorio', 'prestacao_contas'));
  return jsonb_build_object('ok', true, 'gerado_em', now(),
    'projeto', private.projeto_json(pr) || private.execucao_projeto(pr, true),
    'verba', case when v.id is not null then jsonb_build_object('titulo', v.titulo,
               'origem', (select o.nome from public.origens_verba o where o.id = v.origem_id),
               'tipo', (select t.nome from public.tipos_verba t where t.id = v.tipo_id),
               'documentos', coalesce((select jsonb_agg(jsonb_build_object('momento', d.momento, 'nome', d.nome, 'entregue', d.entregue_em is not null) order by d.momento, d.nome)
                              from public.verba_documentos d where d.verba_id = v.id), '[]')) end,
    'pagamentos', coalesce((select jsonb_agg(jsonb_build_object('data', to_char(l.data, 'YYYY-MM-DD'), 'tipo', l.tipo, 'valor', l.valor::text,
                     'descricao', l.descricao, 'favorecido', cp.nome, 'documento', cp.documento, 'forma_pagamento', l.forma_pagamento,
                     'conta', cb.nome, 'rubrica', r.nome, 'comprovante', exists (select 1 from public.comprovantes c where c.lancamento_id = l.id),
                     'sem_comprovante_motivo', l.sem_comprovante_motivo) order by l.data, l.criado_em)
                   from private.lancamentos_projeto(pr.id) l
                   left join public.contrapartes cp on cp.id = l.contraparte_id
                   left join public.contas_bancarias cb on cb.id = l.conta_id
                   left join public.lancamento_rubricas lr on lr.lancamento_id = l.id
                   left join public.projeto_rubricas r on r.id = lr.rubrica_id), '[]'),
    'atividades', coalesce((select jsonb_agg(jsonb_build_object('titulo', e.titulo, 'inicio', e.inicio, 'fim', e.fim, 'dia_inteiro', e.dia_inteiro,
                     'local', e.local, 'tipo', t.nome,
                     'presentes', (select count(*) from public.evento_presencas ep where ep.evento_id = e.id and ep.presente)) order by e.inicio)
                   from public.eventos e join public.tipos_evento t on t.id = e.tipo_id
                   where e.projeto_id = pr.id and e.cancelado_em is null), '[]'),
    'bens', coalesce((select jsonb_agg(jsonb_build_object('numero', b.numero, 'nome', b.nome, 'valor', b.valor::text,
                 'data_aquisicao', to_char(b.data_aquisicao, 'YYYY-MM-DD'), 'situacao', b.situacao) order by b.numero)
               from public.bens b where b.projeto_id = pr.id), '[]'));
end $$;

insert into private.limites_operacao (operacao, maximo_por_hora) values ('salvar_presenca_evento', 300), ('frequencia_atletas', 300);

create function public.salvar_presenca_evento(p_evento uuid, p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_presenca_evento(p_evento, p) $$;
create function public.frequencia_atletas(p_inicio date, p_fim date) returns jsonb language sql security invoker set search_path = '' as $$ select private.frequencia_atletas(p_inicio, p_fim) $$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
grant execute on function public.salvar_presenca_evento(uuid, jsonb), private.salvar_presenca_evento(uuid, jsonb) to authenticated;
grant execute on function public.frequencia_atletas(date, date), private.frequencia_atletas(date, date) to authenticated;
