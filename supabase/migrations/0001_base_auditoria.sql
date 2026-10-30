-- 0001 · Base: schema privado, utilitários de validação e trilha de auditoria imutável.
-- Regra do projeto: o cliente solicita, o servidor decide. Tabelas só são lidas pelo
-- cliente (RLS); toda escrita passa por funções RPC que validam e registram.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Funções nascem com EXECUTE para PUBLIC no Postgres; o Supabase ainda concede tudo em
-- public para anon/authenticated. Desligamos esses padrões para os objetos criados aqui.
alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke all on functions from public, anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges in schema private revoke all on functions from public;

create function private.erro(p_codigo text, p_campo text default null)
returns jsonb language sql immutable set search_path = '' as $$
  select case when p_campo is null then jsonb_build_object('erro', p_codigo)
              else jsonb_build_object('erro', p_codigo, 'campo', p_campo) end
$$;

-- Texto obrigatório, aparado, sem caracteres de controle e dentro do tamanho.
create function private.texto_ok(p text, p_min int, p_max int)
returns boolean language sql immutable set search_path = '' as $$
  select p is not null
     and char_length(btrim(p)) between p_min and p_max
     and p !~ '[[:cntrl:]]'
$$;

-- Texto opcional: nulo/vazio é aceito; se vier, respeita o máximo e não tem controle.
create function private.texto_opcional_ok(p text, p_max int)
returns boolean language sql immutable set search_path = '' as $$
  select p is null or (char_length(p) <= p_max and p !~ '[[:cntrl:]]')
$$;

-- Objeto JSON só com as chaves permitidas (bloqueia mass assignment).
create function private.so_chaves(p jsonb, p_permitidas text[])
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'object'
     and not exists (select 1 from jsonb_object_keys(p) k where k <> all (p_permitidas))
$$;

-- "Hoje" sempre do servidor e no fuso de Cidade Exemplo.
create function private.hoje()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

-- Proteção padrão de toda tabela exposta (public), conforme checklist do Supabase:
--  * RLS ativada E forçada;
--  * nenhum privilégio para anon; authenticated só lê (as escritas passam pelas RPCs);
--  * política RESTRICTIVE exigindo 2FA (aal2) — soma-se às políticas de leitura.
create function private.proteger_tabela(p_tabela regclass) returns void
language plpgsql set search_path = '' as $$
begin
  execute format('alter table %s enable row level security', p_tabela);
  execute format('alter table %s force row level security', p_tabela);
  execute format('revoke all on %s from public, anon, authenticated, service_role', p_tabela);
  execute format('grant select on %s to authenticated', p_tabela);
  execute format('create policy exige_2fa on %s as restrictive for all to authenticated
                  using ((select auth.jwt() ->> %L) = %L)', p_tabela, 'aal', 'aal2');
end $$;

create table public.auditoria (
  id bigint generated always as identity primary key,
  em timestamptz not null default now(),
  membro_id uuid,
  acao text not null,
  tabela text,
  registro_id text,
  antes jsonb,
  depois jsonb
);
create index auditoria_em_idx on public.auditoria (em desc);
create index auditoria_registro_idx on public.auditoria (tabela, registro_id);
create index auditoria_membro_idx on public.auditoria (membro_id, em desc);
select private.proteger_tabela('public.auditoria');

create function private.bloquear_auditoria()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'A trilha de auditoria é imutável' using errcode = '42501';
end $$;
create trigger auditoria_sem_alterar before update or delete on public.auditoria
  for each row execute function private.bloquear_auditoria();
create trigger auditoria_sem_truncate before truncate on public.auditoria
  for each statement execute function private.bloquear_auditoria();

create function private.registrar(p_acao text, p_tabela text, p_registro text, p_antes jsonb, p_depois jsonb)
returns void language sql security definer set search_path = '' as $$
  -- Autor: o usuário da sessão; nas chamadas da Edge Function (service_role), o membro
  -- verificado que ela informa em app.ator.
  insert into public.auditoria (membro_id, acao, tabela, registro_id, antes, depois)
  values (coalesce(auth.uid(), nullif(current_setting('app.ator', true), '')::uuid),
          p_acao, p_tabela, p_registro, p_antes, p_depois);
$$;

-- Gatilho genérico: toda mudança em tabela auditada vira linha na trilha,
-- não importa por qual caminho a mudança chegou.
create function private.trg_auditar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_novo jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_velho jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_id text := coalesce(v_novo, v_velho) ->> 'id';
begin
  if v_id is null then
    v_id := coalesce(coalesce(v_novo, v_velho) ->> 'membro_id', coalesce(v_novo, v_velho) ->> 'competencia');
  end if;
  perform private.registrar(
    case tg_op when 'INSERT' then 'inserir' when 'UPDATE' then 'alterar' else 'remover' end,
    tg_table_name, v_id, v_velho, v_novo);
  return null;
end $$;

revoke all on all functions in schema private from public;
