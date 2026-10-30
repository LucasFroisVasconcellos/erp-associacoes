-- 0025 · transparência.
-- A diretoria gera uma prévia de um período, confere e PUBLICA. O que vai ao ar é uma FOTOGRAFIA
-- (snapshot) congelada, só com números agregados: totais por mês e por categoria/conta contábil,
-- verbas públicas (órgão público e parlamentar), projetos e filiações. Nunca: descrições de
-- lançamentos, nomes de pessoas físicas, atletas, mensalidades individuais ou dados de saúde.
-- A página pública (sem login) lê SÓ as fotografias publicadas, por uma função que não aceita
-- parâmetros. Nenhuma tabela é aberta ao público.

create table public.transparencia_publicacoes (
  id uuid primary key,
  titulo text not null check (private.texto_ok(titulo, 3, 120)),
  periodo_inicio date not null,
  periodo_fim date not null check (periodo_fim >= periodo_inicio and periodo_fim - periodo_inicio <= 400),
  dados jsonb not null,
  observacao text check (private.texto_opcional_ok(observacao, 500)),
  publicado_por uuid not null references public.membros (id),
  publicado_em timestamptz not null default now(),
  retirado_por uuid references public.membros (id),
  retirado_em timestamptz,
  motivo_retirada text check (private.texto_opcional_ok(motivo_retirada, 300)),
  check ((retirado_em is null) = (motivo_retirada is null))
);
create index transparencia_publicado_por_idx on public.transparencia_publicacoes (publicado_por);
create index transparencia_retirado_por_idx on public.transparencia_publicacoes (retirado_por) where retirado_por is not null;
create index transparencia_ativas_idx on public.transparencia_publicacoes (periodo_fim desc) where retirado_em is null;
select private.proteger_tabela('public.transparencia_publicacoes');
create trigger transparencia_auditar after insert or update or delete on public.transparencia_publicacoes for each row execute function private.trg_auditar();
create trigger transparencia_sem_apagar before delete on public.transparencia_publicacoes for each row execute function private.trg_sem_apagar();
create policy ler on public.transparencia_publicacoes for select to authenticated using ((select private.pode('financeiro', 'ver')));

-- A fotografia: só agregados. Categoria aparece pelo nome da conta do contador quando ligada.
create function private.montar_transparencia(p_inicio date, p_fim date) returns jsonb
language sql stable security definer set search_path = '' as $$
  with mov as (
    select l.tipo, l.valor, l.data, l.projeto_id, coalesce(pc.nome, c.nome) grupo
      from public.lancamentos l join public.categorias c on c.id = l.categoria_id
      left join public.plano_contas pc on pc.id = c.conta_contabil_id
     where l.situacao = 'realizada' and l.data between p_inicio and p_fim
       and l.estorno_de is null and not exists (select 1 from public.lancamentos e where e.estorno_de = l.id)
  )
  select jsonb_build_object(
    'entradas', (select coalesce(sum(valor), 0)::text from mov where tipo = 'entrada'),
    'saidas', (select coalesce(sum(valor), 0)::text from mov where tipo = 'saida'),
    'por_mes', coalesce((select jsonb_agg(jsonb_build_object('mes', m, 'entradas', e::text, 'saidas', s::text) order by m) from (
        select to_char(data, 'YYYY-MM') m, sum(valor) filter (where tipo = 'entrada') e, sum(valor) filter (where tipo = 'saida') s
          from mov group by 1) x), '[]'),
    'receitas', coalesce((select jsonb_agg(jsonb_build_object('grupo', grupo, 'valor', t::text) order by t desc) from (
        select grupo, sum(valor) t from mov where tipo = 'entrada' group by grupo) x), '[]'),
    'despesas', coalesce((select jsonb_agg(jsonb_build_object('grupo', grupo, 'valor', t::text) order by t desc) from (
        select grupo, sum(valor) t from mov where tipo = 'saida' group by grupo) x), '[]'),
    -- só recursos públicos têm nome e valor individual; doações de pessoas físicas ficam só nos totais
    'verbas_publicas', coalesce((select jsonb_agg(jsonb_build_object('titulo', v.titulo, 'origem', o.nome, 'situacao', v.situacao,
          'aprovado', coalesce(v.valor_aprovado, 0)::text,
          'recebido_no_periodo', coalesce((select sum(p.valor_recebido) from public.verba_parcelas p where p.verba_id = v.id and p.recebido_em between p_inicio and p_fim), 0)::text) order by v.titulo)
        from public.verbas v join public.origens_verba o on o.id = v.origem_id
       where o.categoria in ('orgao_publico', 'parlamentar') and v.situacao not in ('ideia', 'pedido_enviado', 'em_analise', 'negado', 'cancelado')), '[]'),
    'projetos', coalesce((select jsonb_agg(jsonb_build_object('nome', pj.nome, 'fonte', pj.fonte, 'aprovado', coalesce(pj.valor_aprovado, 0)::text,
          'executado_no_periodo', coalesce((select sum(m.valor) from mov m where m.projeto_id = pj.id and m.tipo = 'saida'), 0)::text,
          'vigencia_inicio', pj.vigencia_inicio, 'vigencia_fim', pj.vigencia_fim) order by pj.nome)
        from public.projetos pj where pj.valor_aprovado is not null
         and (pj.vigencia_fim is null or pj.vigencia_fim >= p_inicio) and (pj.vigencia_inicio is null or pj.vigencia_inicio <= p_fim)), '[]'),
    'filiacoes', coalesce((select jsonb_agg(jsonb_build_object('entidade', f.entidade, 'situacao', f.situacao) order by f.entidade)
        from public.filiacoes f where f.situacao in ('ativa', 'pendente', 'suspensa')), '[]'),
    'entidade', (select jsonb_build_object('nome', c.valor ->> 'nome', 'cnpj', c.valor ->> 'cnpj') from public.configuracoes c where c.chave = 'entidade'))
$$;

create function private.previa_transparencia(p_inicio date, p_fim date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('previa_transparencia', 'financeiro', 'ver');
begin
  if v_erro is not null then return v_erro; end if;
  if private.alcance('financeiro', 'ver') <> 'tudo' then return private.negar('previa_transparencia'); end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio or p_fim - p_inicio > 400 or p_fim > private.hoje() then return private.erro('invalido', 'periodo'); end if;
  return jsonb_build_object('ok', true, 'dados', private.montar_transparencia(p_inicio, p_fim));
end $$;

-- Publicar exige quem aprova no financeiro (tesouraria/presidência) e 2FA recente: é ato da diretoria.
create function private.publicar_transparencia(p_id uuid, p_titulo text, p_inicio date, p_fim date, p_observacao text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('publicar_transparencia', 'financeiro', 'aprovar'); v uuid;
begin
  if v_erro is not null then return v_erro; end if;
  if not private.totp_recente() then return private.erro('confirme_2fa'); end if;
  if p_id is null then return private.erro('invalido', 'id'); end if;
  if not private.texto_ok(p_titulo, 3, 120) then return private.erro('invalido', 'titulo'); end if;
  if p_observacao is not null and not private.texto_opcional_ok(p_observacao, 500) then return private.erro('invalido', 'observacao'); end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio or p_fim - p_inicio > 400 or p_fim > private.hoje() then return private.erro('invalido', 'periodo'); end if;
  if exists (select 1 from public.transparencia_publicacoes where id = p_id) then return jsonb_build_object('ok', true, 'repetido', true); end if;
  insert into public.transparencia_publicacoes (id, titulo, periodo_inicio, periodo_fim, dados, observacao, publicado_por)
  values (p_id, btrim(p_titulo), p_inicio, p_fim, private.montar_transparencia(p_inicio, p_fim), nullif(btrim(p_observacao), ''), auth.uid())
  on conflict (id) do nothing returning id into v;
  return jsonb_build_object('ok', true, 'id', p_id, 'repetido', v is null);
end $$;

-- Retirar do ar (com motivo). Nada é apagado: a fotografia fica guardada para a auditoria.
create function private.retirar_transparencia(p_id uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('retirar_transparencia', 'financeiro', 'aprovar'); t public.transparencia_publicacoes;
begin
  if v_erro is not null then return v_erro; end if;
  if not private.texto_ok(p_motivo, 3, 300) then return private.erro('invalido', 'motivo'); end if;
  select * into t from public.transparencia_publicacoes where id = p_id for update;
  if t.id is null then return private.erro('nao_encontrado'); end if;
  if t.retirado_em is not null then return jsonb_build_object('ok', true, 'repetido', true); end if;
  update public.transparencia_publicacoes set retirado_em = now(), retirado_por = auth.uid(), motivo_retirada = btrim(p_motivo) where id = t.id;
  return jsonb_build_object('ok', true);
end $$;

-- PÚBLICA (anon): só as fotografias no ar, mais recentes primeiro, no máximo 24. Sem parâmetros.
create function private.transparencia_publica() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'publicacoes', coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id, 'titulo', t.titulo, 'periodo_inicio', t.periodo_inicio, 'periodo_fim', t.periodo_fim,
      'publicado_em', t.publicado_em, 'observacao', t.observacao, 'dados', t.dados) order by t.periodo_fim desc, t.publicado_em desc)
    from (select * from public.transparencia_publicacoes where retirado_em is null order by periodo_fim desc, publicado_em desc limit 24) t), '[]'))
$$;

insert into private.limites_operacao (operacao, maximo_por_hora) values
  ('previa_transparencia', 120), ('publicar_transparencia', 20), ('retirar_transparencia', 20);

create function public.previa_transparencia(p_inicio date, p_fim date) returns jsonb language sql security invoker set search_path = '' as $$ select private.previa_transparencia(p_inicio, p_fim) $$;
create function public.publicar_transparencia(p_id uuid, p_titulo text, p_inicio date, p_fim date, p_observacao text) returns jsonb language sql security invoker set search_path = '' as $$ select private.publicar_transparencia(p_id, p_titulo, p_inicio, p_fim, p_observacao) $$;
create function public.retirar_transparencia(p_id uuid, p_motivo text) returns jsonb language sql security invoker set search_path = '' as $$ select private.retirar_transparencia(p_id, p_motivo) $$;
create function public.transparencia_publica() returns jsonb language sql security invoker set search_path = '' as $$ select private.transparencia_publica() $$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
do $$
declare f text;
begin
  foreach f in array array['previa_transparencia(date,date)','publicar_transparencia(uuid,text,date,date,text)','retirar_transparencia(uuid,text)','transparencia_publica()'] loop
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('grant execute on function private.%s to authenticated', f);
  end loop;
end $$;
-- a ÚNICA função aberta ao público
grant usage on schema private to anon;
grant execute on function public.transparencia_publica() to anon;
grant execute on function private.transparencia_publica() to anon;
