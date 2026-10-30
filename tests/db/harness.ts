// Ferramentas de teste do banco: Postgres real, um banco novo por arquivo de teste.
// O servidor de teste roda FORA da pasta do projeto (PGHOST = socket local).
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..');
export const TEMPLATE = process.env.ERP_TEMPLATE_DB ?? 'erp_tpl';
const CONEXAO = {
  host: process.env.PGHOST ?? '/var/tmp/erp-pgtest',
  port: Number(process.env.PGPORT ?? 54329),
  user: 'postgres',
};

export type Claims = Record<string, unknown>;
export type Contexto = 'postgres' | 'anon' | 'service' | Claims;
export type Json = any; // respostas JSON das RPCs (validadas pelos testes)

async function admin<T>(fn: (c: pg.Client) => Promise<T>, database = 'postgres'): Promise<T> {
  const c = new pg.Client({ ...CONEXAO, database });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

export function arquivosMigration(): string[] {
  const dir = join(RAIZ, 'supabase', 'migrations');
  return readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort().map((f) => join(dir, f));
}

/** Cria o banco-modelo: stub do Supabase + todas as migrations, em ordem. */
export async function prepararTemplate(): Promise<void> {
  await admin(async (c) => {
    await c.query(`drop database if exists ${TEMPLATE} with (force)`);
    await c.query(`create database ${TEMPLATE}`);
  });
  await admin(async (c) => {
    await c.query(readFileSync(join(AQUI, 'supabase-stub.sql'), 'utf8'));
    await c.query(`grant create on database ${TEMPLATE} to supabase_postgres`);
    await c.query('set role supabase_postgres');
    for (const f of arquivosMigration()) {
      try { await c.query(readFileSync(f, 'utf8')); }
      catch (e) { throw new Error(`migration ${f}: ${(e as Error).message}`); }
    }
  }, TEMPLATE);
}

export interface Banco {
  nome: string;
  /** Executa SQL no contexto dado e devolve as linhas. */
  linhas(sql: string, ctx?: Contexto, params?: unknown[]): Promise<Record<string, unknown>[]>;
  /** Executa SQL e devolve o primeiro valor da primeira linha. */
  valor<T = Json>(sql: string, ctx?: Contexto, params?: unknown[]): Promise<T>;
  /** Chama public.<nome>(...) com argumentos nomeados. */
  rpc(nome: string, args: Record<string, unknown>, ctx: Contexto): Promise<Json>;
  /** Espera erro; devolve a mensagem. */
  falha(sql: string, ctx?: Contexto, params?: unknown[]): Promise<string>;
  destruir(): Promise<void>;
}

/** Banco descartável (cópia do modelo) para um arquivo de teste. */
export async function novoBanco(): Promise<Banco> {
  const nome = 'erp_t_' + randomUUID().replace(/-/g, '').slice(0, 16);
  await admin((c) => c.query(`create database ${nome} template ${TEMPLATE}`));
  const pool = new pg.Pool({ ...CONEXAO, database: nome, max: 4 });
  pool.on('error', () => {}); // conexões ociosas encerradas no drop do banco

  async function linhas(sql: string, ctx: Contexto = 'postgres', params: unknown[] = []) {
    const c = await pool.connect();
    try {
      await c.query('begin');
      if (ctx === 'anon') {
        await c.query(`set local role anon`);
        await c.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
      } else if (ctx === 'service') {
        await c.query(`set local role service_role`);
        await c.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
      } else if (ctx !== 'postgres') {
        await c.query(`set local role authenticated`);
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(ctx)]);
      }
      const r = await c.query(sql, params);
      await c.query('commit');
      return r.rows as Record<string, unknown>[];
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async function valor<T>(sql: string, ctx?: Contexto, params?: unknown[]): Promise<T> {
    const r = await linhas(sql, ctx, params);
    const primeira = r[0];
    return (primeira ? Object.values(primeira)[0] : null) as T;
  }

  return {
    nome,
    linhas,
    valor,
    async rpc(fn, args, ctx) {
      if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw new Error('nome de rpc inválido');
      const chaves = Object.keys(args);
      for (const k of chaves) if (!/^[a-z_][a-z0-9_]*$/.test(k)) throw new Error('parâmetro inválido');
      const lista = chaves.map((k, i) => `${k} => $${i + 1}`).join(', ');
      const vals = chaves.map((k) => {
        const v = args[k];
        return v === undefined ? null : typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
      });
      return valor(`select to_jsonb(public.${fn}(${lista})) as r`, ctx, vals);
    },
    async falha(sql, ctx, params) {
      try { await linhas(sql, ctx, params); } catch (e) { return (e as Error).message; }
      throw new Error('era esperado erro, mas o comando funcionou: ' + sql.slice(0, 120));
    },
    async destruir() {
      await pool.end();
      await admin((c) => c.query(`drop database if exists ${nome} with (force)`));
    },
  };
}

/** Claims de uma sessão do Supabase. aal2 + TOTP recente por padrão. */
export function sessao(id: string, { aal = 'aal2', totpHaSegundos = 5, loginHaSegundos = 600 } = {}): Claims {
  const agora = Math.floor(Date.now() / 1000);
  const amr: { method: string; timestamp: number }[] = [];
  if (aal === 'aal2') amr.push({ method: 'totp', timestamp: agora - totpHaSegundos });
  amr.push({ method: 'password', timestamp: agora - loginHaSegundos });
  return { sub: id, role: 'authenticated', aal, amr, session_id: randomUUID() };
}

export async function criarUsuario(db: Banco, email: string): Promise<string> {
  return db.valor(`insert into auth.users (email) values ($1) returning id`, 'postgres', [email]);
}

/** Primeiro administrador (como o dono do projeto faria no SQL Editor). */
export async function primeiroAdmin(db: Banco, email = 'presidente@exemplo.test', cargo = 'presidente'): Promise<string> {
  const id = await criarUsuario(db, email);
  await db.linhas(`select private.bootstrap_admin($1, 'Presidente Teste', $2)`, 'postgres', [email, cargo]);
  return id;
}

/** Convida e aceita (simula a Edge Function convidar + o primeiro login da pessoa). */
export async function convidarMembro(db: Banco, adminId: string,
  { email, nome = 'Diretor Teste', cargo = 'diretor', permissoes }: { email: string; nome?: string; cargo?: string; permissoes?: unknown[] }): Promise<string> {
  const perms = permissoes ?? (await db.rpc('modelo_permissoes', { p_cargo: cargo }, sessao(adminId))).permissoes;
  const r = await db.rpc('registrar_convite', { p_email: email, p_nome: nome, p_cargo: cargo, p_permissoes: perms }, sessao(adminId));
  if (!r?.ok) throw new Error('convite falhou: ' + JSON.stringify(r));
  const id = await criarUsuario(db, email);
  const a = await db.rpc('aceitar_convite', {}, sessao(id, { aal: 'aal1' }));
  if (!a?.ok) throw new Error('aceite falhou: ' + JSON.stringify(a));
  return id;
}
