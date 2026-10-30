-- Stub mínimo do ambiente Supabase, usado SÓ nos testes locais.
-- Reproduz o que importa para segurança: papéis, auth.uid()/auth.jwt(),
-- as permissões padrão perigosas do schema public e o storage.objects.

-- Papéis são globais no cluster: cria só se ainda não existirem.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  -- Igual ao papel "postgres" do Supabase: NÃO é superusuário, mas tem BYPASSRLS.
  -- As migrations rodam com este papel nos testes, para pegar problemas de privilégio.
  if not exists (select 1 from pg_roles where rolname = 'supabase_postgres') then
    create role supabase_postgres nologin nosuperuser bypassrls;
  end if;
end $$;
grant anon, authenticated, service_role to supabase_postgres;
grant create on schema public to supabase_postgres;

-- Supabase concede tudo em public para estes papéis por padrão.
-- As migrations precisam revogar explicitamente; o stub garante que o teste perceba se não revogarem.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role supabase_postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role supabase_postgres in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role supabase_postgres in schema public grant all on sequences to anon, authenticated, service_role;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now(),
  raw_user_meta_data jsonb not null default '{}'
);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role, supabase_postgres;
grant execute on all functions in schema auth to anon, authenticated, service_role, supabase_postgres;
grant select, references, delete on auth.users to supabase_postgres; -- igual à produção (conferido em 28/10/2026)

create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)]
$$;
grant usage on schema storage to anon, authenticated, service_role, supabase_postgres;
-- No Supabase o papel postgres pode criar políticas em storage.objects e buckets.
alter table storage.objects owner to supabase_postgres;
grant all on storage.buckets to supabase_postgres;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated;
grant all on storage.buckets to service_role;
grant execute on all functions in schema storage to anon, authenticated, service_role;
