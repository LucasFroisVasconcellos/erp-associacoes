-- 0012 · Agenda, Tarefas e Avisos.
--  * todos com tarefas/ver veem todas as tarefas (transparência); alcance "próprios" ainda limita;
--  * tipos de evento são criados pela diretoria (lista sugerida importável, nada vem pronto);
--  * sem anexos em tarefas nesta fase; agenda exportada como arquivo .ics (gerado na tela);
--  * mesmo padrão da RLS + aal2 em toda tabela, escrita só por RPC, auditoria por gatilho,
--    criação idempotente pelo id do cliente, limite de uso por operação, nada se apaga
--    (evento e tarefa são cancelados; só item de checklist pode ser removido, com auditoria).

-- Instante ISO 8601 com fuso obrigatório (ex.: 2026-11-03T19:30:00-03:00 ou ...Z).
create function private.j_instante(j jsonb) returns timestamptz
language plpgsql immutable set search_path = '' as $$
declare s text := case when jsonb_typeof(j) = 'string' then j #>> '{}' end;
begin
  if s is null or s !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    return null;
  end if;
  return s::timestamptz;
exception when others then return null;
end $$;

-- Início do dia em Cidade Exemplo (dia inteiro guardado como meia-noite local).
create function private.meia_noite(d date) returns timestamptz
language sql immutable set search_path = '' as $$
  select (d::timestamp at time zone 'America/Sao_Paulo')
$$;

create function private.data_local(t timestamptz) returns date
language sql immutable set search_path = '' as $$
  select (t at time zone 'America/Sao_Paulo')::date
$$;

create function private.cores_evento() returns text[] language sql immutable set search_path = '' as $$
  select array['azul','verde','laranja','roxo','vermelho','teal','indigo','cinza']
$$;
create function private.icones_evento() returns text[] language sql immutable set search_path = '' as $$
  select array['treino','jogo','trofeu','viagem','reuniao','assembleia','captacao','prazo','projeto','outro']
$$;
create function private.situacoes_tarefa() returns text[] language sql immutable set search_path = '' as $$
  select array['a_fazer','fazendo','feito','cancelada']
$$;

create table public.tipos_evento (
  id uuid primary key,
  nome text not null check (private.texto_ok(nome, 2, 60)),
  cor text not null check (cor = any (private.cores_evento())),
  icone text not null check (icone = any (private.icones_evento())),
  ativo boolean not null default true,
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now()
);
create unique index tipos_evento_nome_unico on public.tipos_evento (lower(nome));
create index tipos_evento_criado_por_idx on public.tipos_evento (criado_por);

create table public.eventos (
  id uuid primary key,
  tipo_id uuid not null references public.tipos_evento (id),
  titulo text not null check (private.texto_ok(titulo, 2, 120)),
  inicio timestamptz not null,
  fim timestamptz not null,
  dia_inteiro boolean not null default false,
  local text check (private.texto_opcional_ok(local, 160)),
  descricao text check (char_length(descricao) <= 2000),
  projeto_id uuid references public.projetos (id),
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  cancelado_em timestamptz,
  cancelado_por uuid references public.membros (id),
  motivo_cancelamento text check (private.texto_opcional_ok(motivo_cancelamento, 300)),
  check (fim >= inicio and fim - inicio <= interval '62 days'),
  check (not dia_inteiro or (inicio = private.meia_noite(private.data_local(inicio))
                             and fim = private.meia_noite(private.data_local(fim))))
);
create index eventos_periodo_idx on public.eventos (inicio, fim);
create index eventos_tipo_idx on public.eventos (tipo_id);
create index eventos_projeto_idx on public.eventos (projeto_id) where projeto_id is not null;
create index eventos_criado_por_idx on public.eventos (criado_por);
create index eventos_cancelado_por_idx on public.eventos (cancelado_por) where cancelado_por is not null;

create table public.evento_participantes (
  evento_id uuid not null references public.eventos (id),
  membro_id uuid not null references public.membros (id),
  primary key (evento_id, membro_id)
);
create index evento_participantes_membro_idx on public.evento_participantes (membro_id);

create table public.tarefas_recorrentes (
  id uuid primary key,
  titulo text not null check (private.texto_ok(titulo, 2, 160)),
  descricao text check (char_length(descricao) <= 2000),
  responsavel uuid not null references public.membros (id),
  frequencia text not null check (frequencia in ('mensal', 'semanal')),
  dia int not null,                         -- mensal: 1..28; semanal: 0 (domingo) .. 6 (sábado)
  inicio date not null,
  fim date check (fim is null or fim >= inicio),
  lembrete_dias int not null default 1 check (lembrete_dias between 0 and 30),
  ativa boolean not null default true,
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now(),
  check ((frequencia = 'mensal' and dia between 1 and 28) or (frequencia = 'semanal' and dia between 0 and 6))
);
create index tarefas_recorrentes_responsavel_idx on public.tarefas_recorrentes (responsavel);
create index tarefas_recorrentes_criado_por_idx on public.tarefas_recorrentes (criado_por);

create table public.modelos_tarefas (
  id uuid primary key,
  nome text not null check (private.texto_ok(nome, 2, 80)),
  tipo_evento_id uuid references public.tipos_evento (id),
  -- [{ "titulo": "...", "dias_antes": 0..365 }, ...] (validado em private.itens_modelo_validos)
  itens jsonb not null,
  ativo boolean not null default true,
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now()
);
create unique index modelos_tarefas_nome_unico on public.modelos_tarefas (lower(nome));
create index modelos_tarefas_tipo_idx on public.modelos_tarefas (tipo_evento_id) where tipo_evento_id is not null;
create index modelos_tarefas_criado_por_idx on public.modelos_tarefas (criado_por);

create table public.tarefas (
  id uuid primary key,
  titulo text not null check (private.texto_ok(titulo, 2, 160)),
  descricao text check (char_length(descricao) <= 2000),
  responsavel uuid not null references public.membros (id),
  prazo date,
  prioridade text not null default 'normal' check (prioridade in ('baixa', 'normal', 'alta')),
  situacao text not null default 'a_fazer' check (situacao = any (private.situacoes_tarefa())),
  evento_id uuid references public.eventos (id),
  recorrencia_id uuid references public.tarefas_recorrentes (id),
  modelo_id uuid references public.modelos_tarefas (id),
  modelo_ordem int,
  lembrete_dias int not null default 1 check (lembrete_dias between 0 and 30),
  criado_por uuid not null references public.membros (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  concluida_em timestamptz,
  check ((situacao = 'feito') = (concluida_em is not null))
);
create index tarefas_responsavel_idx on public.tarefas (responsavel, situacao, prazo);
create index tarefas_prazo_idx on public.tarefas (prazo) where situacao in ('a_fazer', 'fazendo');
create index tarefas_evento_idx on public.tarefas (evento_id) where evento_id is not null;
create index tarefas_criado_por_idx on public.tarefas (criado_por);
create index tarefas_modelo_idx on public.tarefas (modelo_id) where modelo_id is not null;
-- geradores idempotentes: rodar de novo nunca duplica
create unique index tarefas_recorrencia_unica on public.tarefas (recorrencia_id, prazo) where recorrencia_id is not null;
create unique index tarefas_modelo_unica on public.tarefas (evento_id, modelo_id, modelo_ordem) where modelo_id is not null;

create table public.tarefa_itens (
  id uuid primary key,
  tarefa_id uuid not null references public.tarefas (id),
  ordem int not null check (ordem between 0 and 199),
  texto text not null check (private.texto_ok(texto, 1, 200)),
  feito boolean not null default false,
  feito_por uuid references public.membros (id),
  feito_em timestamptz
);
create index tarefa_itens_tarefa_idx on public.tarefa_itens (tarefa_id, ordem);
create index tarefa_itens_feito_por_idx on public.tarefa_itens (feito_por) where feito_por is not null;

create table public.tarefa_comentarios (
  id uuid primary key,
  tarefa_id uuid not null references public.tarefas (id),
  autor uuid not null references public.membros (id),
  -- texto puro: quebras de linha permitidas, demais caracteres de controle não
  texto text not null check (char_length(btrim(texto)) between 1 and 2000
                             and texto !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]'),
  criado_em timestamptz not null default now()
);
create index tarefa_comentarios_tarefa_idx on public.tarefa_comentarios (tarefa_id, criado_em);
create index tarefa_comentarios_autor_idx on public.tarefa_comentarios (autor);

create table public.avisos (
  id uuid primary key,
  titulo text not null check (private.texto_ok(titulo, 2, 120)),
  texto text not null check (char_length(btrim(texto)) between 1 and 4000
                             and texto !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]'),
  autor uuid not null references public.membros (id),
  publicado_em timestamptz not null default now(),
  expira_em date,
  arquivado_em timestamptz,
  arquivado_por uuid references public.membros (id)
);
create index avisos_publicado_idx on public.avisos (publicado_em desc);
create index avisos_autor_idx on public.avisos (autor);
create index avisos_arquivado_por_idx on public.avisos (arquivado_por) where arquivado_por is not null;

create table public.aviso_leituras (
  aviso_id uuid not null references public.avisos (id),
  membro_id uuid not null references public.membros (id),
  lido_em timestamptz not null default now(),
  primary key (aviso_id, membro_id)
);
create index aviso_leituras_membro_idx on public.aviso_leituras (membro_id);

do $$ declare t text; begin
  foreach t in array array['tipos_evento','eventos','evento_participantes','tarefas_recorrentes','modelos_tarefas',
                           'tarefas','tarefa_itens','tarefa_comentarios','avisos','aviso_leituras'] loop
    perform private.proteger_tabela(format('public.%I', t)::regclass);
  end loop;
  -- leituras de aviso e participantes não entram na trilha (volume sem valor de prova);
  -- quem foi colocado ou tirado de um evento fica registrado pela RPC
  foreach t in array array['tipos_evento','eventos','tarefas_recorrentes','modelos_tarefas',
                           'tarefas','tarefa_itens','tarefa_comentarios','avisos'] loop
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function private.trg_auditar()', t || '_auditar', t);
  end loop;
end $$;

-- Nada se apaga em eventos, tarefas, comentários e avisos (só item de checklist).
create function private.trg_sem_apagar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- única exceção: a rotina de retenção (LGPD), que liga esta marca só durante a própria transação
  if tg_op = 'DELETE' and current_setting('app.retencao', true) = 'on' then return old; end if;
  raise exception 'Registro não se apaga: use cancelar ou arquivar' using errcode = '42501';
end $$;
do $$ declare t text; begin
  foreach t in array array['eventos','tarefas','tarefa_comentarios','avisos','tipos_evento','modelos_tarefas','tarefas_recorrentes'] loop
    execute format('create trigger %I before delete on public.%I for each row execute function private.trg_sem_apagar()',
                   t || '_sem_apagar', t);
  end loop;
end $$;
-- Comentário não muda depois de escrito.
create trigger tarefa_comentarios_sem_alterar before update on public.tarefa_comentarios
  for each row execute function private.trg_sem_apagar();

-- Tarefa visível: tarefas/ver com alcance "tudo", ou alcance "próprios" e a pessoa é
-- responsável ou criou.
create function private.ve_tarefa(p_responsavel uuid, p_criado_por uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.pode('tarefas', 'ver')
     and (private.alcance('tarefas', 'ver') = 'tudo' or auth.uid() in (p_responsavel, p_criado_por))
$$;

create function private.ve_tarefa_id(p_tarefa uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tarefas t where t.id = p_tarefa and private.ve_tarefa(t.responsavel, t.criado_por))
$$;

create policy ler on public.tipos_evento for select to authenticated using ((select private.pode('agenda', 'ver')));
create policy ler on public.eventos for select to authenticated using ((select private.pode('agenda', 'ver')));
create policy ler on public.evento_participantes for select to authenticated using ((select private.pode('agenda', 'ver')));
create policy ler on public.tarefas for select to authenticated using (private.ve_tarefa(responsavel, criado_por));
create policy ler on public.tarefa_itens for select to authenticated using (private.ve_tarefa_id(tarefa_id));
create policy ler on public.tarefa_comentarios for select to authenticated using (private.ve_tarefa_id(tarefa_id));
create policy ler on public.tarefas_recorrentes for select to authenticated
  using ((select private.pode('tarefas', 'ver'))
         and ((select private.alcance('tarefas', 'ver')) = 'tudo' or (select auth.uid()) in (responsavel, criado_por)));
create policy ler on public.modelos_tarefas for select to authenticated using ((select private.pode('tarefas', 'ver')));
create policy ler on public.avisos for select to authenticated using ((select private.pode('avisos', 'ver')));
-- "quem leu": a própria leitura; todas as leituras para o autor do aviso e para administradores
create policy ler on public.aviso_leituras for select to authenticated
  using (membro_id = (select private.membro_atual())
         or (select private.is_admin())
         or exists (select 1 from public.avisos a where a.id = aviso_id and a.autor = (select private.membro_atual())));

create function private.membro_ativo(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p is not null and exists (select 1 from public.membros m where m.id = p and m.ativo
                                   and (m.acesso_expira_em is null or m.acesso_expira_em > now()))
$$;

create function private.texto_longo_ok(p text, p_max int) returns boolean
language sql immutable set search_path = '' as $$
  select p is null or (char_length(p) <= p_max and p !~ '[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]')
$$;

create function private.salvar_tipo_evento(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_tipo_evento', 'agenda', 'editar'); v_id uuid; v_nome text;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','nome','cor','icone','ativo']), false) then return private.erro('invalido'); end if;
  v_id := private.j_uuid(p -> 'id');      if v_id is null then return private.erro('invalido', 'id'); end if;
  v_nome := private.j_texto(p -> 'nome'); if not private.texto_ok(v_nome, 2, 60) then return private.erro('invalido', 'nome'); end if;
  if not (coalesce(private.j_texto(p -> 'cor'), '') = any (private.cores_evento())) then return private.erro('invalido', 'cor'); end if;
  if not (coalesce(private.j_texto(p -> 'icone'), '') = any (private.icones_evento())) then return private.erro('invalido', 'icone'); end if;
  if not private.vazio(p -> 'ativo') and private.j_bool(p -> 'ativo') is null then return private.erro('invalido', 'ativo'); end if;
  if exists (select 1 from public.tipos_evento where lower(nome) = lower(v_nome) and id <> v_id) then return private.erro('duplicado', 'nome'); end if;
  insert into public.tipos_evento (id, nome, cor, icone, ativo, criado_por)
  values (v_id, v_nome, p ->> 'cor', p ->> 'icone', coalesce(private.j_bool(p -> 'ativo'), true), auth.uid())
  on conflict (id) do update set nome = excluded.nome, cor = excluded.cor, icone = excluded.icone, ativo = excluded.ativo;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Lista sugerida (7.6). Só entra se a diretoria pedir; nomes já existentes são pulados.
create function private.importar_tipos_evento() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('importar_tipos_evento', 'agenda', 'editar'); v_n int;
begin
  if v_erro is not null then return v_erro; end if;
  insert into public.tipos_evento (id, nome, cor, icone, criado_por)
  select gen_random_uuid(), m.nome, m.cor, m.icone, auth.uid()
  from (values ('Treino', 'azul', 'treino'), ('Jogo', 'verde', 'jogo'), ('Campeonato', 'laranja', 'trofeu'),
               ('Viagem', 'teal', 'viagem'), ('Reunião de diretoria', 'indigo', 'reuniao'), ('Assembleia', 'roxo', 'assembleia'),
               ('Evento de captação', 'vermelho', 'captacao'), ('Prazo fiscal', 'cinza', 'prazo'), ('Prazo de projeto', 'cinza', 'projeto')
       ) m(nome, cor, icone)
  where not exists (select 1 from public.tipos_evento t where lower(t.nome) = lower(m.nome))
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'criados', v_n);
end $$;

-- m: tipo_id, titulo, dia_inteiro, inicio, fim (instantes; ou datas se dia_inteiro), local, descricao, projeto_id
-- Devolve o erro, ou { inicio, fim } já normalizados.
create function private.validar_evento(m jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_dia boolean := coalesce(private.j_bool(m -> 'dia_inteiro'), false);
  v_ini timestamptz; v_fim timestamptz; v_uuid uuid;
begin
  if not private.vazio(m -> 'dia_inteiro') and private.j_bool(m -> 'dia_inteiro') is null then return private.erro('invalido', 'dia_inteiro'); end if;
  v_uuid := private.j_uuid(m -> 'tipo_id');
  if v_uuid is null or not exists (select 1 from public.tipos_evento where id = v_uuid and ativo) then return private.erro('invalido', 'tipo_id'); end if;
  if not private.texto_ok(private.j_texto(m -> 'titulo'), 2, 120) then return private.erro('invalido', 'titulo'); end if;
  if v_dia then
    v_ini := private.meia_noite(private.j_data(m -> 'inicio'));
    v_fim := private.meia_noite(coalesce(private.j_data(m -> 'fim'), private.j_data(m -> 'inicio')));
  else
    v_ini := private.j_instante(m -> 'inicio');
    v_fim := coalesce(private.j_instante(m -> 'fim'), v_ini);
  end if;
  if v_ini is null or private.data_local(v_ini) not between private.hoje() - 730 and private.hoje() + 1100 then return private.erro('invalido', 'inicio'); end if;
  if v_fim is null or v_fim < v_ini or v_fim - v_ini > interval '62 days' then return private.erro('invalido', 'fim'); end if;
  if not private.vazio(m -> 'local') and (jsonb_typeof(m -> 'local') <> 'string' or not private.texto_opcional_ok(private.j_texto(m -> 'local'), 160)) then
    return private.erro('invalido', 'local');
  end if;
  if not private.vazio(m -> 'descricao') and (jsonb_typeof(m -> 'descricao') <> 'string' or not private.texto_longo_ok(m ->> 'descricao', 2000)) then
    return private.erro('invalido', 'descricao');
  end if;
  if not private.vazio(m -> 'projeto_id') then
    v_uuid := private.j_uuid(m -> 'projeto_id');
    if v_uuid is null or not exists (select 1 from public.projetos where id = v_uuid and ativo) then return private.erro('invalido', 'projeto_id'); end if;
  end if;
  return jsonb_build_object('inicio', v_ini, 'fim', v_fim);
end $$;

-- Participantes: lista de ids de membros ativos (até 60), sem repetição.
create function private.participantes_validos(p jsonb) returns boolean
language sql stable security definer set search_path = '' as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 60
     and not exists (select 1 from jsonb_array_elements(p) e where private.j_uuid(e) is null or not private.membro_ativo(private.j_uuid(e)))
$$;

create function private.gravar_participantes(p_evento uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_antes jsonb; v_depois jsonb;
begin
  select coalesce(jsonb_agg(membro_id order by membro_id), '[]') into v_antes from public.evento_participantes where evento_id = p_evento;
  delete from public.evento_participantes where evento_id = p_evento;
  insert into public.evento_participantes (evento_id, membro_id)
  select distinct p_evento, private.j_uuid(e) from jsonb_array_elements(p) e;
  select coalesce(jsonb_agg(membro_id order by membro_id), '[]') into v_depois from public.evento_participantes where evento_id = p_evento;
  if v_antes is distinct from v_depois then
    perform private.registrar('alterar', 'evento_participantes', p_evento::text, v_antes, v_depois);
  end if;
end $$;

create function private.salvar_evento(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('salvar_evento', 'agenda', 'criar');
  v_id uuid; e public.eventos; v_norm jsonb; v_inserido uuid;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','tipo_id','titulo','dia_inteiro','inicio','fim','local','descricao','projeto_id','participantes']), false) then
    return private.erro('invalido');
  end if;
  v_id := private.j_uuid(p -> 'id');
  if v_id is null then return private.erro('invalido', 'id'); end if;
  v_norm := private.validar_evento(p);
  if v_norm ? 'erro' then return v_norm; end if;
  if not private.vazio(p -> 'participantes') and not coalesce(private.participantes_validos(p -> 'participantes'), false) then
    return private.erro('invalido', 'participantes');
  end if;

  select * into e from public.eventos where id = v_id for update;
  if e.id is null then
    insert into public.eventos (id, tipo_id, titulo, inicio, fim, dia_inteiro, local, descricao, projeto_id, criado_por)
    values (v_id, private.j_uuid(p -> 'tipo_id'), private.j_texto(p -> 'titulo'), (v_norm ->> 'inicio')::timestamptz,
            (v_norm ->> 'fim')::timestamptz, coalesce(private.j_bool(p -> 'dia_inteiro'), false),
            nullif(private.j_texto(p -> 'local'), ''), nullif(btrim(coalesce(p ->> 'descricao', '')), ''),
            private.j_uuid(p -> 'projeto_id'), auth.uid())
    on conflict (id) do nothing
    returning id into v_inserido;
    if v_inserido is null then return private.erro('conflito', 'id'); end if;  -- corrida: outra pessoa criou com o mesmo id
  else
    -- editar: agenda/editar, ou quem criou (com agenda/criar)
    if not (private.pode('agenda', 'editar') or e.criado_por = auth.uid()) then return private.negar('salvar_evento'); end if;
    if e.cancelado_em is not null then return private.erro('cancelado'); end if;
    update public.eventos set tipo_id = private.j_uuid(p -> 'tipo_id'), titulo = private.j_texto(p -> 'titulo'),
      inicio = (v_norm ->> 'inicio')::timestamptz, fim = (v_norm ->> 'fim')::timestamptz,
      dia_inteiro = coalesce(private.j_bool(p -> 'dia_inteiro'), false),
      local = nullif(private.j_texto(p -> 'local'), ''), descricao = nullif(btrim(coalesce(p ->> 'descricao', '')), ''),
      projeto_id = private.j_uuid(p -> 'projeto_id'), atualizado_em = now()
    where id = v_id;
  end if;
  if not private.vazio(p -> 'participantes') then perform private.gravar_participantes(v_id, p -> 'participantes'); end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create function private.cancelar_evento(p_id uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('cancelar_evento', 'agenda', 'criar'); e public.eventos;
begin
  if v_erro is not null then return v_erro; end if;
  if not private.texto_ok(p_motivo, 3, 300) then return private.erro('invalido', 'motivo'); end if;
  select * into e from public.eventos where id = p_id for update;
  if e.id is null then return private.erro('nao_encontrado'); end if;
  if not (private.pode('agenda', 'editar') or e.criado_por = auth.uid()) then return private.negar('cancelar_evento'); end if;
  if e.cancelado_em is not null then return jsonb_build_object('ok', true, 'repetido', true); end if;
  update public.eventos set cancelado_em = now(), cancelado_por = auth.uid(), motivo_cancelamento = btrim(p_motivo), atualizado_em = now()
   where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Agenda de um período: eventos + prazos automáticos (só leitura, conforme as permissões).
create function private.agenda_periodo(p_inicio date, p_fim date) returns jsonb
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
    -- fechamento do mês anterior: dia 10 (Dossiê 7.7: "enviar o fechamento ao contador até o dia 10")
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

create function private.validar_tarefa(m jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uuid uuid; v_prazo date;
begin
  if not private.texto_ok(private.j_texto(m -> 'titulo'), 2, 160) then return private.erro('invalido', 'titulo'); end if;
  if not private.vazio(m -> 'descricao') and (jsonb_typeof(m -> 'descricao') <> 'string' or not private.texto_longo_ok(m ->> 'descricao', 2000)) then
    return private.erro('invalido', 'descricao');
  end if;
  if not private.membro_ativo(private.j_uuid(m -> 'responsavel')) then return private.erro('invalido', 'responsavel'); end if;
  if not private.vazio(m -> 'prazo') then
    v_prazo := private.j_data(m -> 'prazo');
    if v_prazo is null or v_prazo not between private.hoje() - 365 and private.hoje() + 1100 then return private.erro('invalido', 'prazo'); end if;
  end if;
  if coalesce(private.j_texto(m -> 'prioridade'), 'normal') not in ('baixa', 'normal', 'alta') then return private.erro('invalido', 'prioridade'); end if;
  if not private.vazio(m -> 'lembrete_dias') and coalesce(private.j_inteiro(m -> 'lembrete_dias'), -1) not between 0 and 30 then
    return private.erro('invalido', 'lembrete_dias');
  end if;
  if not private.vazio(m -> 'evento_id') then
    v_uuid := private.j_uuid(m -> 'evento_id');
    if v_uuid is null or not exists (select 1 from public.eventos where id = v_uuid and cancelado_em is null) then return private.erro('invalido', 'evento_id'); end if;
  end if;
  return null;
end $$;

-- Itens de checklist na criação: lista de textos (até 50).
create function private.itens_validos(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 50
     and not exists (select 1 from jsonb_array_elements(p) e where jsonb_typeof(e) <> 'string' or not private.texto_ok(e #>> '{}', 1, 200))
$$;

create function private.criar_tarefa(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_erro jsonb := private.checar('criar_tarefa', 'tarefas', 'criar');
  v_id uuid; v_dono uuid; v_inserido uuid; v_resp uuid;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','titulo','descricao','responsavel','prazo','prioridade','evento_id','lembrete_dias','itens']), false) then
    return private.erro('invalido');
  end if;
  v_id := private.j_uuid(p -> 'id');
  if v_id is null then return private.erro('invalido', 'id'); end if;
  select criado_por into v_dono from public.tarefas where id = v_id;
  if v_dono is not null then
    if v_dono = auth.uid() then return jsonb_build_object('ok', true, 'id', v_id, 'repetido', true); end if;
    return private.erro('conflito', 'id');
  end if;
  -- sem responsável informado: quem cria
  if private.vazio(p -> 'responsavel') then p := jsonb_set(p, '{responsavel}', to_jsonb(auth.uid()::text)); end if;
  v_erro := private.validar_tarefa(p);
  if v_erro is not null then return v_erro; end if;
  if not private.vazio(p -> 'itens') and not coalesce(private.itens_validos(p -> 'itens'), false) then return private.erro('invalido', 'itens'); end if;
  v_resp := private.j_uuid(p -> 'responsavel');

  insert into public.tarefas (id, titulo, descricao, responsavel, prazo, prioridade, evento_id, lembrete_dias, criado_por)
  values (v_id, private.j_texto(p -> 'titulo'), nullif(btrim(coalesce(p ->> 'descricao', '')), ''), v_resp,
          private.j_data(p -> 'prazo'), coalesce(private.j_texto(p -> 'prioridade'), 'normal'), private.j_uuid(p -> 'evento_id'),
          coalesce(private.j_inteiro(p -> 'lembrete_dias'), 1), auth.uid())
  on conflict (id) do nothing
  returning id into v_inserido;
  if v_inserido is null then
    select criado_por into v_dono from public.tarefas where id = v_id;
    if v_dono = auth.uid() then return jsonb_build_object('ok', true, 'id', v_id, 'repetido', true); end if;
    return private.erro('conflito', 'id');
  end if;
  insert into public.tarefa_itens (id, tarefa_id, ordem, texto)
  select gen_random_uuid(), v_id, (o - 1)::int, btrim(e #>> '{}')
  from jsonb_array_elements(coalesce(nullif(p -> 'itens', 'null'::jsonb), '[]')) with ordinality x(e, o);
  if v_resp <> auth.uid() then
    perform private.notificar(v_resp, 'Nova tarefa para você: ' || left(private.j_texto(p -> 'titulo'), 160));
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'repetido', false);
end $$;

-- Quem mexe numa tarefa já criada:
--  * campos (título, descrição, prazo, prioridade, evento, responsável): tarefas/editar, ou quem criou (com tarefas/criar);
--  * situação e checklist: também o responsável.
create function private.pode_editar_tarefa(t public.tarefas) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.ve_tarefa(t.responsavel, t.criado_por)
     and (private.pode('tarefas', 'editar') or (t.criado_por = auth.uid() and private.pode('tarefas', 'criar')))
$$;
create function private.pode_andar_tarefa(t public.tarefas) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.pode_editar_tarefa(t) or (t.responsavel = auth.uid() and private.pode('tarefas', 'ver'))
$$;

create function private.editar_tarefa(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('editar_tarefa', 'tarefas', 'ver'); t public.tarefas; v_m jsonb; v_resp uuid;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['titulo','descricao','responsavel','prazo','prioridade','evento_id','lembrete_dias']), false) then
    return private.erro('invalido');
  end if;
  select * into t from public.tarefas where id = p_id for update;
  if t.id is null or not private.ve_tarefa(t.responsavel, t.criado_por) then return private.erro('nao_encontrado'); end if;
  if not private.pode_editar_tarefa(t) then return private.negar('editar_tarefa'); end if;
  if t.situacao = 'cancelada' then return private.erro('cancelada'); end if;
  v_m := jsonb_build_object('titulo', t.titulo, 'descricao', t.descricao, 'responsavel', t.responsavel::text,
           'prazo', to_char(t.prazo, 'YYYY-MM-DD'), 'prioridade', t.prioridade, 'evento_id', t.evento_id,
           'lembrete_dias', t.lembrete_dias) || p;
  -- evento já ligado que depois foi cancelado não impede editar o resto
  if not (p ? 'evento_id') then v_m := v_m - 'evento_id'; end if;
  v_erro := private.validar_tarefa(v_m);
  if v_erro is not null then return v_erro; end if;
  v_resp := private.j_uuid(v_m -> 'responsavel');
  update public.tarefas set titulo = private.j_texto(v_m -> 'titulo'),
    descricao = nullif(btrim(coalesce(v_m ->> 'descricao', '')), ''), responsavel = v_resp,
    prazo = private.j_data(v_m -> 'prazo'), prioridade = coalesce(private.j_texto(v_m -> 'prioridade'), 'normal'),
    evento_id = case when p ? 'evento_id' then private.j_uuid(p -> 'evento_id') else evento_id end,
    lembrete_dias = coalesce(private.j_inteiro(v_m -> 'lembrete_dias'), 1), atualizado_em = now()
  where id = p_id;
  if v_resp <> t.responsavel and v_resp <> auth.uid() then
    perform private.notificar(v_resp, 'Tarefa passada para você: ' || left(private.j_texto(v_m -> 'titulo'), 160));
  end if;
  return jsonb_build_object('ok', true);
end $$;

create function private.mudar_situacao_tarefa(p_id uuid, p_situacao text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('mudar_situacao_tarefa', 'tarefas', 'ver'); t public.tarefas;
begin
  if v_erro is not null then return v_erro; end if;
  if not (coalesce(p_situacao, '') = any (private.situacoes_tarefa())) then return private.erro('invalido', 'situacao'); end if;
  select * into t from public.tarefas where id = p_id for update;
  if t.id is null or not private.ve_tarefa(t.responsavel, t.criado_por) then return private.erro('nao_encontrado'); end if;
  if t.situacao = p_situacao then return jsonb_build_object('ok', true, 'repetido', true); end if;
  -- cancelar e reabrir uma cancelada: só quem pode editar; o resto, também o responsável
  if (p_situacao = 'cancelada' or t.situacao = 'cancelada') then
    if not private.pode_editar_tarefa(t) then return private.negar('mudar_situacao_tarefa'); end if;
  elsif not private.pode_andar_tarefa(t) then
    return private.negar('mudar_situacao_tarefa');
  end if;
  update public.tarefas set situacao = p_situacao, atualizado_em = now(),
    concluida_em = case when p_situacao = 'feito' then now() end
  where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Checklist: p = { id?, texto?, feito?, remover? }. Item novo: id do cliente + texto.
create function private.salvar_item_tarefa(p_tarefa uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_item_tarefa', 'tarefas', 'ver'); t public.tarefas; i public.tarefa_itens; v_id uuid; v_ordem int;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','texto','feito','remover']), false) then return private.erro('invalido'); end if;
  v_id := private.j_uuid(p -> 'id');
  if v_id is null then return private.erro('invalido', 'id'); end if;
  select * into t from public.tarefas where id = p_tarefa for update;
  if t.id is null or not private.ve_tarefa(t.responsavel, t.criado_por) then return private.erro('nao_encontrado'); end if;
  if not private.pode_andar_tarefa(t) then return private.negar('salvar_item_tarefa'); end if;
  if t.situacao = 'cancelada' then return private.erro('cancelada'); end if;
  if not private.vazio(p -> 'feito') and private.j_bool(p -> 'feito') is null then return private.erro('invalido', 'feito'); end if;
  if not private.vazio(p -> 'remover') and private.j_bool(p -> 'remover') is null then return private.erro('invalido', 'remover'); end if;
  if not private.vazio(p -> 'texto') and not private.texto_ok(private.j_texto(p -> 'texto'), 1, 200) then return private.erro('invalido', 'texto'); end if;

  select * into i from public.tarefa_itens where id = v_id;
  if i.id is not null and i.tarefa_id <> p_tarefa then return private.erro('conflito', 'id'); end if;
  if coalesce(private.j_bool(p -> 'remover'), false) then
    if i.id is null then return jsonb_build_object('ok', true, 'repetido', true); end if;
    delete from public.tarefa_itens where id = v_id;
    return jsonb_build_object('ok', true);
  end if;
  if i.id is null then
    if private.vazio(p -> 'texto') then return private.erro('invalido', 'texto'); end if;
    select coalesce(max(ordem) + 1, 0) into v_ordem from public.tarefa_itens where tarefa_id = p_tarefa;
    if v_ordem >= 200 then return private.erro('invalido', 'itens'); end if;
    insert into public.tarefa_itens (id, tarefa_id, ordem, texto, feito, feito_por, feito_em)
    values (v_id, p_tarefa, v_ordem, private.j_texto(p -> 'texto'), coalesce(private.j_bool(p -> 'feito'), false),
            case when private.j_bool(p -> 'feito') then auth.uid() end, case when private.j_bool(p -> 'feito') then now() end);
  else
    update public.tarefa_itens set
      texto = coalesce(private.j_texto(p -> 'texto'), texto),
      feito = coalesce(private.j_bool(p -> 'feito'), feito),
      feito_por = case when private.j_bool(p -> 'feito') is null then feito_por when private.j_bool(p -> 'feito') then auth.uid() end,
      feito_em = case when private.j_bool(p -> 'feito') is null then feito_em when private.j_bool(p -> 'feito') then now() end
    where id = v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create function private.comentar_tarefa(p_tarefa uuid, p_id uuid, p_texto text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('comentar_tarefa', 'tarefas', 'ver'); t public.tarefas; v_autor uuid; v_inserido uuid;
begin
  if v_erro is not null then return v_erro; end if;
  if p_id is null then return private.erro('invalido', 'id'); end if;
  if p_texto is null or char_length(btrim(p_texto)) not between 1 and 2000 or not private.texto_longo_ok(p_texto, 2000) then
    return private.erro('invalido', 'texto');
  end if;
  select * into t from public.tarefas where id = p_tarefa;
  if t.id is null or not private.ve_tarefa(t.responsavel, t.criado_por) then return private.erro('nao_encontrado'); end if;
  insert into public.tarefa_comentarios (id, tarefa_id, autor, texto) values (p_id, p_tarefa, auth.uid(), btrim(p_texto))
  on conflict (id) do nothing returning id into v_inserido;
  if v_inserido is null then
    select autor into v_autor from public.tarefa_comentarios where id = p_id;
    if v_autor = auth.uid() then return jsonb_build_object('ok', true, 'repetido', true); end if;
    return private.erro('conflito', 'id');
  end if;
  if t.responsavel <> auth.uid() then
    perform private.notificar(t.responsavel, 'Novo comentário na tarefa: ' || left(t.titulo, 160));
  end if;
  return jsonb_build_object('ok', true);
end $$;

create function private.salvar_tarefa_recorrente(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_tarefa_recorrente', 'tarefas', 'editar'); v_id uuid; v_freq text; v_dia int; v_ini date; v_fim date;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','titulo','descricao','responsavel','frequencia','dia','inicio','fim','lembrete_dias','ativa']), false) then
    return private.erro('invalido');
  end if;
  v_id := private.j_uuid(p -> 'id'); if v_id is null then return private.erro('invalido', 'id'); end if;
  if not private.texto_ok(private.j_texto(p -> 'titulo'), 2, 160) then return private.erro('invalido', 'titulo'); end if;
  if not private.vazio(p -> 'descricao') and (jsonb_typeof(p -> 'descricao') <> 'string' or not private.texto_longo_ok(p ->> 'descricao', 2000)) then
    return private.erro('invalido', 'descricao');
  end if;
  if not private.membro_ativo(private.j_uuid(p -> 'responsavel')) then return private.erro('invalido', 'responsavel'); end if;
  v_freq := private.j_texto(p -> 'frequencia');
  if coalesce(v_freq, '') not in ('mensal', 'semanal') then return private.erro('invalido', 'frequencia'); end if;
  v_dia := private.j_inteiro(p -> 'dia');
  if v_dia is null or (v_freq = 'mensal' and v_dia not between 1 and 28) or (v_freq = 'semanal' and v_dia not between 0 and 6) then
    return private.erro('invalido', 'dia');
  end if;
  v_ini := private.j_data(p -> 'inicio');
  if v_ini is null or v_ini not between private.hoje() - 365 and private.hoje() + 1100 then return private.erro('invalido', 'inicio'); end if;
  if not private.vazio(p -> 'fim') then
    v_fim := private.j_data(p -> 'fim');
    if v_fim is null or v_fim < v_ini or v_fim > private.hoje() + 3700 then return private.erro('invalido', 'fim'); end if;
  end if;
  if not private.vazio(p -> 'lembrete_dias') and coalesce(private.j_inteiro(p -> 'lembrete_dias'), -1) not between 0 and 30 then
    return private.erro('invalido', 'lembrete_dias');
  end if;
  if not private.vazio(p -> 'ativa') and private.j_bool(p -> 'ativa') is null then return private.erro('invalido', 'ativa'); end if;
  insert into public.tarefas_recorrentes (id, titulo, descricao, responsavel, frequencia, dia, inicio, fim, lembrete_dias, ativa, criado_por)
  values (v_id, private.j_texto(p -> 'titulo'), nullif(btrim(coalesce(p ->> 'descricao', '')), ''), private.j_uuid(p -> 'responsavel'),
          v_freq, v_dia, v_ini, v_fim, coalesce(private.j_inteiro(p -> 'lembrete_dias'), 1), coalesce(private.j_bool(p -> 'ativa'), true), auth.uid())
  on conflict (id) do update set titulo = excluded.titulo, descricao = excluded.descricao, responsavel = excluded.responsavel,
    frequencia = excluded.frequencia, dia = excluded.dia, inicio = excluded.inicio, fim = excluded.fim,
    lembrete_dias = excluded.lembrete_dias, ativa = excluded.ativa;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Datas em que uma recorrência cai, entre dois dias (inclusive).
create function private.datas_recorrencia(r public.tarefas_recorrentes, p_de date, p_ate date) returns setof date
language sql stable set search_path = '' as $$
  select d::date from generate_series(greatest(r.inicio, p_de)::timestamp, least(coalesce(r.fim, p_ate), p_ate)::timestamp, interval '1 day') d
  where (r.frequencia = 'mensal' and extract(day from d) = r.dia)
     or (r.frequencia = 'semanal' and extract(dow from d) = r.dia)
$$;

-- Gera as próximas ocorrências (até 35 dias à frente). Idempotente pela chave (recorrência, prazo).
-- Chamada pela rotina diária (sem sessão) e pela tela de Tarefas.
create function private.gerar_ocorrencias(p_ate date) returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  insert into public.tarefas (id, titulo, descricao, responsavel, prazo, recorrencia_id, lembrete_dias, criado_por)
  select gen_random_uuid(), r.titulo, r.descricao, r.responsavel, d, r.id, r.lembrete_dias, r.criado_por
  from public.tarefas_recorrentes r
  cross join lateral private.datas_recorrencia(r, private.hoje(), p_ate) d
  where r.ativa and private.membro_ativo(r.responsavel)
  on conflict (recorrencia_id, prazo) where recorrencia_id is not null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create function private.gerar_tarefas_recorrentes() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('gerar_tarefas_recorrentes', 'tarefas', 'ver');
begin
  if v_erro is not null then return v_erro; end if;
  return jsonb_build_object('ok', true, 'criadas', private.gerar_ocorrencias(private.hoje() + 35));
end $$;

create function private.itens_modelo_validos(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) between 1 and 40
     and not exists (
       select 1 from jsonb_array_elements(p) e
       where not private.so_chaves(e, array['titulo','dias_antes'])
          or not private.texto_ok(private.j_texto(e -> 'titulo'), 2, 160)
          or coalesce(private.j_inteiro(e -> 'dias_antes'), -1) not between 0 and 365)
$$;

create function private.salvar_modelo_tarefas(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('salvar_modelo_tarefas', 'tarefas', 'editar'); v_id uuid; v_nome text; v_tipo uuid;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','nome','tipo_evento_id','itens','ativo']), false) then return private.erro('invalido'); end if;
  v_id := private.j_uuid(p -> 'id'); if v_id is null then return private.erro('invalido', 'id'); end if;
  v_nome := private.j_texto(p -> 'nome'); if not private.texto_ok(v_nome, 2, 80) then return private.erro('invalido', 'nome'); end if;
  if not private.vazio(p -> 'tipo_evento_id') then
    v_tipo := private.j_uuid(p -> 'tipo_evento_id');
    if v_tipo is null or not exists (select 1 from public.tipos_evento where id = v_tipo) then return private.erro('invalido', 'tipo_evento_id'); end if;
  end if;
  if not coalesce(private.itens_modelo_validos(p -> 'itens'), false) then return private.erro('invalido', 'itens'); end if;
  if not private.vazio(p -> 'ativo') and private.j_bool(p -> 'ativo') is null then return private.erro('invalido', 'ativo'); end if;
  if exists (select 1 from public.modelos_tarefas where lower(nome) = lower(v_nome) and id <> v_id) then return private.erro('duplicado', 'nome'); end if;
  insert into public.modelos_tarefas (id, nome, tipo_evento_id, itens, ativo, criado_por)
  values (v_id, v_nome, v_tipo,
          (select jsonb_agg(jsonb_build_object('titulo', private.j_texto(e -> 'titulo'), 'dias_antes', private.j_inteiro(e -> 'dias_antes')))
             from jsonb_array_elements(p -> 'itens') e),
          coalesce(private.j_bool(p -> 'ativo'), true), auth.uid())
  on conflict (id) do update set nome = excluded.nome, tipo_evento_id = excluded.tipo_evento_id, itens = excluded.itens, ativo = excluded.ativo;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Modelo "Viagem para competição". Só entra se a diretoria pedir.
create function private.importar_modelo_viagem() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('importar_modelo_viagem', 'tarefas', 'editar'); v_n int;
begin
  if v_erro is not null then return v_erro; end if;
  insert into public.modelos_tarefas (id, nome, tipo_evento_id, itens, criado_por)
  select gen_random_uuid(), 'Viagem para competição',
         (select id from public.tipos_evento where lower(nome) = 'viagem' and ativo limit 1),
         '[{"titulo":"Inscrição na competição","dias_antes":45},{"titulo":"Confirmação dos atletas","dias_antes":30},
           {"titulo":"Transporte acessível","dias_antes":30},{"titulo":"Hospedagem acessível","dias_antes":30},
           {"titulo":"Alimentação","dias_antes":15},{"titulo":"Adiantamento de despesas","dias_antes":10},
           {"titulo":"Autorizações de menores","dias_antes":10},{"titulo":"Checagem das cadeiras de jogo","dias_antes":7},
           {"titulo":"Acerto de contas da viagem","dias_antes":0},{"titulo":"Relatório com fotos","dias_antes":0}]'::jsonb,
         auth.uid()
  where not exists (select 1 from public.modelos_tarefas where lower(nome) = 'viagem para competição');
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'criados', v_n);
end $$;

-- Aplica um modelo a um evento: cria uma tarefa por item, com prazo = início do evento − dias_antes.
-- Idempotente: aplicar de novo não duplica (chave evento + modelo + ordem).
-- p_responsaveis: { "0": "<uuid>", "3": "<uuid>" } (índice do item → responsável); padrão: quem aplica.
create function private.aplicar_modelo(p_modelo uuid, p_evento uuid, p_responsaveis jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('aplicar_modelo', 'tarefas', 'criar'); m public.modelos_tarefas; e public.eventos; v_n int;
begin
  if v_erro is not null then return v_erro; end if;
  if not private.pode('agenda', 'ver') then return private.negar('aplicar_modelo'); end if;
  select * into m from public.modelos_tarefas where id = p_modelo and ativo;
  if m.id is null then return private.erro('invalido', 'modelo'); end if;
  select * into e from public.eventos where id = p_evento and cancelado_em is null;
  if e.id is null then return private.erro('invalido', 'evento'); end if;
  p_responsaveis := coalesce(p_responsaveis, '{}'::jsonb);
  if jsonb_typeof(p_responsaveis) <> 'object'
     or exists (select 1 from jsonb_each(p_responsaveis) r
                where r.key !~ '^[0-9]{1,2}$' or r.key::int >= jsonb_array_length(m.itens) or not private.membro_ativo(private.j_uuid(r.value))) then
    return private.erro('invalido', 'responsaveis');
  end if;
  insert into public.tarefas (id, titulo, responsavel, prazo, evento_id, modelo_id, modelo_ordem, criado_por)
  select gen_random_uuid(), i ->> 'titulo', coalesce(private.j_uuid(p_responsaveis -> (o - 1)::text), auth.uid()),
         greatest(private.data_local(e.inicio) - (i ->> 'dias_antes')::int, private.hoje()), e.id, m.id, (o - 1)::int, auth.uid()
  from jsonb_array_elements(m.itens) with ordinality x(i, o)
  on conflict (evento_id, modelo_id, modelo_ordem) where modelo_id is not null do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'criadas', v_n);
end $$;

create function private.publicar_aviso(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('publicar_aviso', 'avisos', 'criar'); v_id uuid; v_autor uuid; v_exp date; v_inserido uuid;
begin
  if v_erro is not null then return v_erro; end if;
  if not coalesce(private.so_chaves(p, array['id','titulo','texto','expira_em']), false) then return private.erro('invalido'); end if;
  v_id := private.j_uuid(p -> 'id'); if v_id is null then return private.erro('invalido', 'id'); end if;
  if not private.texto_ok(private.j_texto(p -> 'titulo'), 2, 120) then return private.erro('invalido', 'titulo'); end if;
  if jsonb_typeof(p -> 'texto') is distinct from 'string' or char_length(btrim(p ->> 'texto')) not between 1 and 4000
     or not private.texto_longo_ok(p ->> 'texto', 4000) then
    return private.erro('invalido', 'texto');
  end if;
  if not private.vazio(p -> 'expira_em') then
    v_exp := private.j_data(p -> 'expira_em');
    if v_exp is null or v_exp < private.hoje() or v_exp > private.hoje() + 400 then return private.erro('invalido', 'expira_em'); end if;
  end if;
  insert into public.avisos (id, titulo, texto, autor, expira_em)
  values (v_id, private.j_texto(p -> 'titulo'), btrim(p ->> 'texto'), auth.uid(), v_exp)
  on conflict (id) do nothing returning id into v_inserido;
  if v_inserido is null then
    select autor into v_autor from public.avisos where id = v_id;
    if v_autor = auth.uid() then return jsonb_build_object('ok', true, 'id', v_id, 'repetido', true); end if;
    return private.erro('conflito', 'id');
  end if;
  -- quem publica já "leu"
  insert into public.aviso_leituras (aviso_id, membro_id) values (v_id, auth.uid()) on conflict do nothing;
  return jsonb_build_object('ok', true, 'id', v_id, 'repetido', false);
end $$;

create function private.arquivar_aviso(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('arquivar_aviso', 'avisos', 'ver'); a public.avisos;
begin
  if v_erro is not null then return v_erro; end if;
  select * into a from public.avisos where id = p_id for update;
  if a.id is null then return private.erro('nao_encontrado'); end if;
  if not (a.autor = auth.uid() or private.is_admin() or private.pode('avisos', 'editar')) then return private.negar('arquivar_aviso'); end if;
  if a.arquivado_em is not null then return jsonb_build_object('ok', true, 'repetido', true); end if;
  update public.avisos set arquivado_em = now(), arquivado_por = auth.uid() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create function private.marcar_aviso_lido(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('marcar_aviso_lido', 'avisos', 'ver');
begin
  if v_erro is not null then return v_erro; end if;
  if not exists (select 1 from public.avisos where id = p_id) then return private.erro('nao_encontrado'); end if;
  insert into public.aviso_leituras (aviso_id, membro_id) values (p_id, auth.uid()) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

create function private.resumo_organizacao() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_erro jsonb := private.checar('resumo_organizacao'); v_eu uuid := auth.uid(); v_hoje date := private.hoje();
begin
  if v_erro is not null then return v_erro; end if;
  return jsonb_build_object('ok', true,
    'minhas_tarefas', case when private.pode('tarefas', 'ver') then coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'titulo', t.titulo, 'prazo', to_char(t.prazo, 'YYYY-MM-DD'),
               'situacao', t.situacao, 'prioridade', t.prioridade, 'atrasada', t.prazo < v_hoje))
      from (select * from public.tarefas t where t.responsavel = v_eu and t.situacao in ('a_fazer', 'fazendo')
             order by t.prazo nulls last, t.criado_em limit 8) t), '[]') else '[]' end,
    'tarefas_atrasadas', case when private.pode('tarefas', 'ver') then (
      select count(*) from public.tarefas t where t.responsavel = v_eu and t.situacao in ('a_fazer', 'fazendo') and t.prazo < v_hoje) else 0 end,
    'proximos_eventos', case when private.pode('agenda', 'ver') then coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'titulo', e.titulo, 'inicio', e.inicio, 'dia_inteiro', e.dia_inteiro,
               'tipo_id', e.tipo_id, 'local', e.local))
      from (select * from public.eventos e where e.cancelado_em is null
              and (case when e.dia_inteiro then e.fim + interval '1 day' else e.fim end) >= now()
              and e.inicio < private.meia_noite(v_hoje + 15)
             order by e.inicio limit 5) e), '[]') else '[]' end,
    'avisos_nao_lidos', case when private.pode('avisos', 'ver') then (
      select count(*) from public.avisos a where a.arquivado_em is null and (a.expira_em is null or a.expira_em >= v_hoje)
        and not exists (select 1 from public.aviso_leituras l where l.aviso_id = a.id and l.membro_id = v_eu)) else 0 end);
end $$;

-- Chamada pelo pg_cron (só o postgres executa): gera as tarefas recorrentes da semana seguinte.
create function private.rotina_organizacao() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n int := private.gerar_ocorrencias(private.hoje() + 35);
begin
  perform private.registrar('rotina_organizacao', null, null, null, jsonb_build_object('tarefas_criadas', v_n));
  return jsonb_build_object('ok', true, 'tarefas_criadas', v_n);
end $$;

insert into private.limites_operacao (operacao, maximo_por_hora) values
  ('salvar_evento', 200), ('cancelar_evento', 60), ('agenda_periodo', 600),
  ('criar_tarefa', 300), ('editar_tarefa', 300), ('mudar_situacao_tarefa', 600),
  ('salvar_item_tarefa', 600), ('comentar_tarefa', 200), ('aplicar_modelo', 30),
  ('salvar_tarefa_recorrente', 60), ('salvar_modelo_tarefas', 60), ('gerar_tarefas_recorrentes', 60),
  ('salvar_tipo_evento', 60), ('importar_tipos_evento', 10), ('importar_modelo_viagem', 10),
  ('publicar_aviso', 30), ('arquivar_aviso', 60), ('marcar_aviso_lido', 600), ('resumo_organizacao', 600);

-- Acrescenta à rotina da 0009: avisos arquivados ou vencidos há mais de 2 anos (e as leituras),
-- tarefas concluídas ou canceladas há mais de 5 anos (com checklist e comentários).
-- Eventos ficam: são histórico de atividades da associação (prestação de contas de projetos).
create or replace function private.aplicar_retencao(p_agora timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_convites int; v_notificacoes int; v_limites int; v_avisos int; v_tarefas int;
begin
  delete from public.convites
   where usado_em is null
     and coalesce(cancelado_em, expira_em) < p_agora - interval '90 days';
  get diagnostics v_convites = row_count;

  delete from public.notificacoes
   where lida_em is not null and lida_em < p_agora - interval '180 days';
  get diagnostics v_notificacoes = row_count;

  delete from private.limites where janela < p_agora - interval '1 day';
  get diagnostics v_limites = row_count;

  -- os gatilhos "sem apagar" valem para pessoas; a retenção é a exceção controlada
  perform set_config('app.retencao', 'on', true);

  with velhos as (
    select id from public.avisos
     where coalesce(arquivado_em, (expira_em + 1)::timestamptz, 'infinity') < p_agora - interval '2 years'
  ), l as (delete from public.aviso_leituras where aviso_id in (select id from velhos))
  delete from public.avisos where id in (select id from velhos);
  get diagnostics v_avisos = row_count;

  with velhas as (
    select id from public.tarefas
     where situacao in ('feito', 'cancelada') and atualizado_em < p_agora - interval '5 years'
  ), i as (delete from public.tarefa_itens where tarefa_id in (select id from velhas)),
     c as (delete from public.tarefa_comentarios where tarefa_id in (select id from velhas))
  delete from public.tarefas where id in (select id from velhas);
  get diagnostics v_tarefas = row_count;

  perform set_config('app.retencao', 'off', true);

  perform private.registrar('retencao', null, null, null,
    jsonb_build_object('convites', v_convites, 'notificacoes', v_notificacoes, 'limites', v_limites,
                       'avisos', v_avisos, 'tarefas', v_tarefas));
  return jsonb_build_object('ok', true, 'convites', v_convites, 'notificacoes', v_notificacoes, 'limites', v_limites,
                            'avisos', v_avisos, 'tarefas', v_tarefas);
end $$;
revoke all on function private.aplicar_retencao(timestamptz) from public, anon, authenticated, service_role;

create function public.salvar_tipo_evento(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_tipo_evento(p) $$;
create function public.importar_tipos_evento() returns jsonb language sql security invoker set search_path = '' as $$ select private.importar_tipos_evento() $$;
create function public.salvar_evento(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_evento(p) $$;
create function public.cancelar_evento(p_id uuid, p_motivo text) returns jsonb language sql security invoker set search_path = '' as $$ select private.cancelar_evento(p_id, p_motivo) $$;
create function public.agenda_periodo(p_inicio date, p_fim date) returns jsonb language sql security invoker set search_path = '' as $$ select private.agenda_periodo(p_inicio, p_fim) $$;
create function public.criar_tarefa(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.criar_tarefa(p) $$;
create function public.editar_tarefa(p_id uuid, p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.editar_tarefa(p_id, p) $$;
create function public.mudar_situacao_tarefa(p_id uuid, p_situacao text) returns jsonb language sql security invoker set search_path = '' as $$ select private.mudar_situacao_tarefa(p_id, p_situacao) $$;
create function public.salvar_item_tarefa(p_tarefa uuid, p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_item_tarefa(p_tarefa, p) $$;
create function public.comentar_tarefa(p_tarefa uuid, p_id uuid, p_texto text) returns jsonb language sql security invoker set search_path = '' as $$ select private.comentar_tarefa(p_tarefa, p_id, p_texto) $$;
create function public.salvar_tarefa_recorrente(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_tarefa_recorrente(p) $$;
create function public.gerar_tarefas_recorrentes() returns jsonb language sql security invoker set search_path = '' as $$ select private.gerar_tarefas_recorrentes() $$;
create function public.salvar_modelo_tarefas(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.salvar_modelo_tarefas(p) $$;
create function public.importar_modelo_viagem() returns jsonb language sql security invoker set search_path = '' as $$ select private.importar_modelo_viagem() $$;
create function public.aplicar_modelo(p_modelo uuid, p_evento uuid, p_responsaveis jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.aplicar_modelo(p_modelo, p_evento, p_responsaveis) $$;
create function public.publicar_aviso(p jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select private.publicar_aviso(p) $$;
create function public.arquivar_aviso(p_id uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.arquivar_aviso(p_id) $$;
create function public.marcar_aviso_lido(p_id uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.marcar_aviso_lido(p_id) $$;
create function public.resumo_organizacao() returns jsonb language sql security invoker set search_path = '' as $$ select private.resumo_organizacao() $$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon;
do $$
declare
  f text;
  usuario text[] := array['salvar_tipo_evento(jsonb)','importar_tipos_evento()','salvar_evento(jsonb)','cancelar_evento(uuid,text)',
    'agenda_periodo(date,date)','criar_tarefa(jsonb)','editar_tarefa(uuid,jsonb)','mudar_situacao_tarefa(uuid,text)',
    'salvar_item_tarefa(uuid,jsonb)','comentar_tarefa(uuid,uuid,text)','salvar_tarefa_recorrente(jsonb)','gerar_tarefas_recorrentes()',
    'salvar_modelo_tarefas(jsonb)','importar_modelo_viagem()','aplicar_modelo(uuid,uuid,jsonb)','publicar_aviso(jsonb)',
    'arquivar_aviso(uuid)','marcar_aviso_lido(uuid)','resumo_organizacao()'];
begin
  foreach f in array usuario loop
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('grant execute on function private.%s to authenticated', f);
  end loop;
end $$;
-- usadas nas políticas de RLS
grant execute on function private.ve_tarefa(uuid, uuid), private.ve_tarefa_id(uuid) to authenticated;
