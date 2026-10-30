-- 0013 · lembretes de tarefas e resumo semanal por e-mail.
-- Desenho (fila no banco; quem envia é a Edge Function "enviar-emails", ligada só no lançamento):
--  * private.preparar_emails() roda todo dia (pg_cron) e coloca na fila, uma vez só:
--      - lembrete de tarefa N dias antes do prazo (N = lembrete_dias da tarefa) e no dia;
--      - resumo semanal às segundas: minhas tarefas da semana, eventos da semana, avisos não lidos.
--  * a Edge Function pega um lote (pegar_emails: SKIP LOCKED, sem envio duplo), envia e marca.
--  * conteúdo mínimo: título, data e o link do sistema. Nada de valores, nem dados de terceiros.
--  * cada pessoa pode desligar os lembretes e o resumo (preferências).
--  * a fila fica no schema private (não exposto) e guarda o membro, nunca o e-mail;
--    o endereço é lido do cadastro só na hora do envio. Linhas enviadas saem depois de 30 dias.

create table public.preferencias_email (
  membro_id uuid primary key references public.membros (id),
  lembretes boolean not null default true,
  resumo_semanal boolean not null default true,
  atualizado_em timestamptz not null default now()
);
select private.proteger_tabela('public.preferencias_email');
create trigger preferencias_email_auditar after insert or update or delete on public.preferencias_email
  for each row execute function private.trg_auditar();
create policy ler on public.preferencias_email for select to authenticated
  using (membro_id = (select private.membro_atual()));

create table private.fila_emails (
  id uuid primary key default gen_random_uuid(),
  -- chave de idempotência: 'lembrete:<tarefa>:<prazo>:<antes|dia>' ou 'resumo:<membro>:<segunda>'
  chave text not null unique check (char_length(chave) <= 200),
  membro_id uuid not null references public.membros (id) on delete cascade,
  assunto text not null check (char_length(assunto) <= 200 and assunto !~ '[[:cntrl:]]'),
  corpo text not null check (char_length(corpo) <= 6000),
  criado_em timestamptz not null default now(),
  tentativas int not null default 0 check (tentativas between 0 and 10),
  pego_em timestamptz,
  enviado_em timestamptz,
  erro text check (char_length(erro) <= 120)
);
create index fila_emails_pendentes_idx on private.fila_emails (criado_em) where enviado_em is null;
create index fila_emails_membro_idx on private.fila_emails (membro_id);
revoke all on private.fila_emails from public, anon, authenticated, service_role;

create function private.salvar_preferencias_email(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_preferencias_email');
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['lembretes','resumo_semanal']), false) then return private.erro('invalido'); end if;
  if private.j_bool(p -> 'lembretes') is null then return private.erro('invalido', 'lembretes'); end if;
  if private.j_bool(p -> 'resumo_semanal') is null then return private.erro('invalido', 'resumo_semanal'); end if;
  insert into public.preferencias_email (membro_id, lembretes, resumo_semanal)
  values (auth.uid(), private.j_bool(p -> 'lembretes'), private.j_bool(p -> 'resumo_semanal'))
  on conflict (membro_id) do update set lembretes = excluded.lembretes, resumo_semanal = excluded.resumo_semanal, atualizado_em = now();
  return jsonb_build_object('ok', true);
end $$;

create function private.quer_email(p_membro uuid, p_tipo text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select case p_tipo when 'lembrete' then lembretes else resumo_semanal end
                   from public.preferencias_email where membro_id = p_membro), true)
$$;

create function private.pode_membro(p_membro uuid, p_modulo text, p_acao text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.permissoes where membro_id = p_membro and modulo = p_modulo and acao = p_acao)
$$;

create function private.data_br(d date) returns text
language sql immutable set search_path = '' as $$ select to_char(d, 'DD/MM/YYYY') $$;

create function private.preparar_emails(p_hoje date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_hoje date := coalesce(p_hoje, private.hoje());
  v_seg date := v_hoje - ((extract(isodow from v_hoje)::int) - 1);   -- segunda-feira desta semana
  v_lembretes int := 0; v_resumos int := 0;
begin
  -- lembretes: N dias antes (quando N > 0) e no dia; só tarefa aberta de membro ativo que quer receber
  insert into private.fila_emails (chave, membro_id, assunto, corpo)
  select 'lembrete:' || t.id || ':' || t.prazo || ':' || q.quando, t.responsavel,
         case q.quando when 'dia' then 'Tarefa para hoje: ' else 'Tarefa vence em ' || private.data_br(t.prazo) || ': ' end
           || left(t.titulo, 120),
         'Olá! Lembrete do sistema da Associação Exemplo.' || chr(10) || chr(10)
           || 'Tarefa: ' || t.titulo || chr(10) || 'Prazo: ' || private.data_br(t.prazo) || chr(10) || chr(10)
           || 'Abra o sistema para ver os detalhes.'
  from public.tarefas t
  cross join lateral (values ('antes', t.prazo - t.lembrete_dias), ('dia', t.prazo)) q(quando, em)
  where t.situacao in ('a_fazer', 'fazendo') and t.prazo is not null and q.em = v_hoje
    and (q.quando = 'dia' or t.lembrete_dias > 0)
    and private.membro_ativo(t.responsavel) and private.quer_email(t.responsavel, 'lembrete')
    and private.pode_membro(t.responsavel, 'tarefas', 'ver')
  on conflict (chave) do nothing;
  get diagnostics v_lembretes = row_count;

  -- resumo semanal: segundas-feiras
  if extract(isodow from v_hoje) = 1 then
    insert into private.fila_emails (chave, membro_id, assunto, corpo)
    select 'resumo:' || m.id || ':' || v_seg, m.id, 'Resumo da semana · Associação Exemplo',
           'Olá, ' || split_part(m.nome, ' ', 1) || '! Sua semana no sistema da Associação Exemplo.' || chr(10) || chr(10)
           || 'Suas tarefas até domingo (' || private.data_br(v_seg + 6) || '):' || chr(10)
           || coalesce((select string_agg('• ' || private.data_br(t.prazo) || ' — ' || left(t.titulo, 120), chr(10) order by t.prazo)
                        from (select * from public.tarefas t where t.responsavel = m.id and t.situacao in ('a_fazer', 'fazendo')
                                and t.prazo <= v_seg + 6 order by t.prazo limit 15) t), '• nenhuma')
           || case when exists (select 1 from public.tarefas t where t.responsavel = m.id and t.situacao in ('a_fazer', 'fazendo') and t.prazo < v_hoje)
                   then chr(10) || '(há tarefas atrasadas)' else '' end
           || case when private.pode_membro(m.id, 'agenda', 'ver') then
                chr(10) || chr(10) || 'Eventos da semana:' || chr(10)
                || coalesce((select string_agg('• ' || to_char(e.inicio at time zone 'America/Sao_Paulo', case when e.dia_inteiro then 'DD/MM' else 'DD/MM HH24:MI' end)
                                               || ' — ' || left(e.titulo, 120), chr(10) order by e.inicio)
                             from (select * from public.eventos e where e.cancelado_em is null
                                     and e.inicio >= private.meia_noite(v_seg) and e.inicio < private.meia_noite(v_seg + 7)
                                   order by e.inicio limit 15) e), '• nenhum')
              else '' end
           || case when private.pode_membro(m.id, 'avisos', 'ver') then
                chr(10) || chr(10) || 'Avisos não lidos: ' || (
                  select count(*) from public.avisos a where a.arquivado_em is null and (a.expira_em is null or a.expira_em >= v_hoje)
                    and not exists (select 1 from public.aviso_leituras l where l.aviso_id = a.id and l.membro_id = m.id))::text
              else '' end
           || chr(10) || chr(10) || 'Para não receber este resumo, desligue em Ajustes, no sistema.'
    from public.membros m
    where m.ativo and (m.acesso_expira_em is null or m.acesso_expira_em > now()) and private.quer_email(m.id, 'resumo')
    on conflict (chave) do nothing;
    get diagnostics v_resumos = row_count;
  end if;

  -- limpeza: enviados há mais de 30 dias; não enviados há mais de 7 (perderam o sentido)
  delete from private.fila_emails
   where (enviado_em is not null and enviado_em < now() - interval '30 days')
      or (enviado_em is null and criado_em < now() - interval '7 days');

  perform private.registrar('preparar_emails', null, null, null, jsonb_build_object('lembretes', v_lembretes, 'resumos', v_resumos));
  return jsonb_build_object('ok', true, 'lembretes', v_lembretes, 'resumos', v_resumos);
end $$;

-- Pega até p_lote e-mails pendentes e os reserva por 10 minutos (SKIP LOCKED: duas execuções
-- simultâneas nunca pegam o mesmo). O endereço vem do cadastro, só de membro ainda ativo.
create function private.pegar_emails(p_lote int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[];
begin
  if p_lote is null or p_lote not between 1 and 50 then return private.erro('invalido', 'lote'); end if;
  with escolhidos as (
    select f.id from private.fila_emails f
     where f.enviado_em is null and f.tentativas < 5
       and (f.pego_em is null or f.pego_em < now() - interval '10 minutes')
     order by f.criado_em
     limit p_lote
     for update skip locked
  ), marcados as (
    update private.fila_emails f set pego_em = now(), tentativas = f.tentativas + 1
      from escolhidos e where f.id = e.id
    returning f.id
  )
  select coalesce(array_agg(id), '{}') into v_ids from marcados;
  return jsonb_build_object('ok', true, 'emails', coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'para', m.email, 'assunto', x.assunto, 'corpo', x.corpo) order by x.criado_em)
    from private.fila_emails x join public.membros m on m.id = x.membro_id
    where x.id = any (v_ids) and m.ativo and (m.acesso_expira_em is null or m.acesso_expira_em > now())), '[]'));
end $$;

create function private.marcar_email(p_id uuid, p_enviado boolean, p_erro text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_id is null or p_enviado is null then return private.erro('invalido'); end if;
  update private.fila_emails
     set enviado_em = case when p_enviado then now() end,
         pego_em = case when p_enviado then pego_em end,
         erro = case when p_enviado then null else left(regexp_replace(coalesce(p_erro, 'falha'), '[^a-zA-Z0-9_ .:-]', '', 'g'), 120) end
   where id = p_id and enviado_em is null;
  if not found then return private.erro('nao_encontrado'); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function private.rotina_organizacao() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n int := private.gerar_ocorrencias(private.hoje() + 35); v_emails jsonb;
begin
  v_emails := private.preparar_emails();
  perform private.registrar('rotina_organizacao', null, null, null, jsonb_build_object('tarefas_criadas', v_n));
  return jsonb_build_object('ok', true, 'tarefas_criadas', v_n, 'emails', v_emails);
end $$;

create function public.salvar_preferencias_email(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_preferencias_email(p) $$;
create function public.pegar_emails(p_lote int) returns jsonb language sql security invoker set search_path = '' as $$ select private.pegar_emails(p_lote) $$;
create function public.marcar_email(p_id uuid, p_enviado boolean, p_erro text) returns jsonb language sql security invoker set search_path = '' as $$ select private.marcar_email(p_id, p_enviado, p_erro) $$;

insert into private.limites_operacao (operacao, maximo_por_hora) values ('salvar_preferencias_email', 30);

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
grant execute on function public.salvar_preferencias_email(jsonb), private.salvar_preferencias_email(jsonb) to authenticated;
-- envio: só a service role (Edge Function); nunca o navegador
revoke all on function public.pegar_emails(int), public.marcar_email(uuid, boolean, text) from authenticated;
grant execute on function public.pegar_emails(int), private.pegar_emails(int),
                          public.marcar_email(uuid, boolean, text), private.marcar_email(uuid, boolean, text) to service_role;
