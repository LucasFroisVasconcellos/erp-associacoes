import fc from 'fast-check';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco; let pres: string, dir: string;
const ip = (s: string) => createHash('sha256').update(s).digest('hex');
const pedir = (p: Record<string, unknown>, h = ip('1.1.1.1')) => db.valor<Record<string, unknown>>('select public.registrar_pedido_acesso($1, $2)', 'service', [JSON.stringify(p), h]);
const pendentes = (email: string) => db.valor<number>(`select count(*)::int from public.pedidos_acesso where email = $1 and situacao = 'pendente'`, 'postgres', [email]);
const idDe = (email: string) => db.valor<string>(`select id from public.pedidos_acesso where email = $1 order by criado_em desc limit 1`, 'postgres', [email]);
const rpc = (n: string, a: Record<string, unknown>, q: string, o?: Parameters<typeof sessao>[1]) => db.rpc(n, a, sessao(q, o));

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  dir = await convidarMembro(db, pres, { email: 'dir@exemplo.test', nome: 'Diretor', cargo: 'diretor' });
});
afterAll(async () => { await db?.destruir(); });

describe('pedido público', () => {
  test('só a service role grava; cliente logado e anônimo não', async () => {
    const args = [JSON.stringify({ nome: 'Pessoa Teste', email: 'x@exemplo.test' }), ip('9.9.9.9')];
    expect(await db.falha('select public.registrar_pedido_acesso($1, $2)', sessao(dir), args)).toMatch(/permission denied/);
    expect(await db.falha('select public.registrar_pedido_acesso($1, $2)', 'anon', args)).toMatch(/permission denied/);
    expect(await db.falha('insert into public.pedidos_acesso (nome, email) values ($1, $2)', sessao(pres), ['A B', 'a@b.test'])).toMatch(/permission denied/);
  });
  test('valida campos; repetido ou de quem já é membro: mesma resposta, nada novo', async () => {
    expect((await pedir({ nome: 'Ana', email: 'ana@exemplo.test', cargo: 'presidente' })).erro).toBe('invalido');
    expect((await pedir({ nome: 'Ana', email: 'não é e-mail' })).campo).toBe('email');
    expect((await pedir({ nome: 'A', email: 'ana@exemplo.test' })).campo).toBe('nome');
    expect((await pedir({ nome: 'Ana', email: 'ana@exemplo.test', mensagem: 'oi' })).erro).toBe('invalido');
    expect((await pedir({ nome: 'Ana', email: 'ana@exemplo.test' }, 'abc')).campo).toBe('ip');
    expect(await pedir({ nome: 'Ana Exemplo', email: 'ANA@exemplo.test' }, ip('2.2.2.2'))).toEqual({ ok: true });
    expect(await pedir({ nome: 'Ana de novo', email: 'ana@exemplo.test' }, ip('3.3.3.3'))).toEqual({ ok: true });
    expect(await pendentes('ana@exemplo.test')).toBe(1);
    expect(await pedir({ nome: 'Diretor', email: 'dir@exemplo.test' }, ip('4.4.4.4'))).toEqual({ ok: true });
    expect(await pendentes('dir@exemplo.test')).toBe(0);
  });
  test('limite: 3 por hora por IP', async () => {
    const h = ip('5.5.5.5');
    for (const n of [1, 2, 3]) expect(await pedir({ nome: `Pessoa ${n}`, email: `p${n}@exemplo.test` }, h)).toEqual({ ok: true });
    expect((await pedir({ nome: 'Pessoa 4', email: 'p4@exemplo.test' }, h)).erro).toBe('limite');
  });
  test('concorrência: 6 pedidos simultâneos do mesmo IP gravam no máximo 3', async () => {
    const h = ip('6.6.6.6');
    const r = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => pedir({ nome: `Simultâneo ${n}`, email: `s${n}@exemplo.test` }, h)));
    expect(r.filter((x) => x.ok).length).toBe(3);
    expect(await db.valor<number>(`select count(*)::int from public.pedidos_acesso where ip_hash = $1`, 'postgres', [h])).toBe(3);
  });
  test('administrador lê sem o ip_hash; quem não é administrador não vê nada', async () => {
    expect(await db.valor<number>('select count(*)::int from public.pedidos_acesso', sessao(pres))).toBeGreaterThan(0);
    expect(await db.falha('select ip_hash from public.pedidos_acesso', sessao(pres))).toMatch(/permission denied/);
    expect(await db.valor<number>('select count(*)::int from public.pedidos_acesso', sessao(dir))).toBe(0);
    expect(await db.falha('select id from public.pedidos_acesso', 'anon')).toMatch(/permission denied/);
  });
});

describe('decisão do administrador', () => {
  test('não administrador e sessão vencida não decidem', async () => {
    const id = await idDe('ana@exemplo.test');
    expect((await rpc('decidir_pedido_acesso', { p_id: id, p_decisao: 'recusado' }, dir)).erro).toBe('sem_permissao');
    expect((await rpc('decidir_pedido_acesso', { p_id: id, p_decisao: 'recusado' }, pres, { totpHaSegundos: 31 * 86400, loginHaSegundos: 31 * 86400 })).erro).toBe('sessao_expirada');
    expect((await rpc('decidir_pedido_acesso', { p_id: id, p_decisao: 'talvez' }, pres)).campo).toBe('decisao');
  });
  test('aprovar só depois do convite para o mesmo e-mail; o ip_hash some', async () => {
    const id = await idDe('ana@exemplo.test');
    expect((await rpc('decidir_pedido_acesso', { p_id: id, p_decisao: 'aprovado' }, pres)).erro).toBe('sem_convite');
    expect((await rpc('registrar_convite', { p_email: 'ana@exemplo.test', p_nome: 'Ana Exemplo', p_cargo: 'diretor', p_permissoes: [] }, pres)).ok).toBe(true);
    expect(await rpc('decidir_pedido_acesso', { p_id: id, p_decisao: 'aprovado' }, pres)).toEqual({ ok: true });
    expect(await rpc('decidir_pedido_acesso', { p_id: id, p_decisao: 'aprovado' }, pres)).toMatchObject({ ok: true, repetido: true });
    expect(await rpc('decidir_pedido_acesso', { p_id: id, p_decisao: 'recusado' }, pres)).toMatchObject({ ok: false, erro: 'ja_decidido' });
    expect(await db.valor('select ip_hash from public.pedidos_acesso where id = $1', 'postgres', [id])).toBeNull();
  });
  test('recusar com motivo; auditoria guarda só os nomes dos campos', async () => {
    const id = await idDe('p1@exemplo.test');
    expect(await rpc('decidir_pedido_acesso', { p_id: id, p_decisao: 'recusado', p_motivo: 'Não faz parte da Associação Exemplo' }, pres)).toEqual({ ok: true });
    const aud = await db.valor<unknown>(`select depois from public.auditoria where tabela = 'pedidos_acesso' order by id desc limit 1`);
    expect(JSON.stringify(aud)).not.toMatch(/p1@exemplo|Não faz parte/);
  });
  test('fuzz: o pedido nunca estoura exceção nem grava fora das regras', async () => {
    const feio = fc.oneof(fc.string(), fc.constant(null), fc.integer(), fc.constantFrom('', 'a@b.c', '<script>', "'; drop table x; --", 'x'.repeat(600)));
    let n = 0;
    await fc.assert(fc.asyncProperty(fc.record({ nome: feio, email: feio }, { requiredKeys: [] }), async (p) => {
      n += 1;
      try { await pedir(p, ip(`fuzz-${n}`)); }
      catch (e) { expect((e as Error).message).toMatch(/invalid input syntax|null character|unsupported Unicode/); }
    }), { numRuns: 150, seed: 2026102804 });
    expect(await db.valor<number>(`select count(*)::int from public.pedidos_acesso where situacao = 'pendente'`)).toBeLessThanOrEqual(50);
  });
});
