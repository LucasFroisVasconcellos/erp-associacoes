import { afterAll, beforeAll, expect, test } from 'vitest';
import { type Banco, novoBanco } from './harness';

let db: Banco;
beforeAll(async () => { db = await novoBanco(); });
afterAll(async () => { await db?.destruir(); });

const lista = async (sql: string) => (await db.linhas(sql)).map((r) => Object.values(r).join(' '));

test('toda tabela de public tem RLS ativada e forçada', async () => {
  expect(await lista(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity)`)).toEqual([]);
});

test('toda tabela de public exige 2FA (aal2) por política RESTRICTIVE', async () => {
  expect(await lista(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and not exists (
        select 1 from pg_policy p
        where p.polrelid = c.oid and not p.polpermissive
          and pg_get_expr(p.polqual, p.polrelid) like '%aal2%')`)).toEqual([]);
});

test('nenhuma função em public é SECURITY DEFINER (a lógica fica em private)', async () => {
  expect(await lista(`
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef`)).toEqual([]);
});

test('anon executa só a transparência pública (Fase 7), nenhuma outra função', async () => {
  expect((await lista(`
    select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')`)).sort()).toEqual(['private.transparencia_publica', 'public.transparencia_publica']);
});

test('toda função de public e private fixa o search_path', async () => {
  expect(await lista(`
    select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')`)).toEqual([]);
});

test('toda chave estrangeira tem índice', async () => {
  expect(await lista(`
    select c.conrelid::regclass || '.' || a.attname from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f' and n.nspname = 'public'
      and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = a.attnum)`)).toEqual([]);
});

test('views de public usam security_invoker', async () => {
  expect(await lista(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and not coalesce('security_invoker=true' = any (c.reloptions), false)`)).toEqual([]);
});

test('cliente (anon/authenticated) não tem INSERT/UPDATE/DELETE/TRUNCATE em tabela nenhuma', async () => {
  expect(await lista(`
    select c.relname || ':' || r.rolname || ':' || pr.p
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated')) r(rolname)
    cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) pr(p)
    where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege(r.rolname, c.oid, pr.p)`)).toEqual([]);
});

test('anon não lê tabela nenhuma de public', async () => {
  expect(await lista(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v') and has_table_privilege('anon', c.oid, 'SELECT')`)).toEqual([]);
});
