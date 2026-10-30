import fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco; let pres: string, tes: string, sec: string, hoje: string;
const rpc = (n: string, a: Record<string, unknown>, q: string) => db.rpc(n, a, sessao(q));
const base = () => ({ projeto_id: randomUUID(), nome: 'Escolinha de bocha', vigencia_inicio: hoje, vigencia_fim: `${Number(hoje.slice(0, 4)) + 1}${hoje.slice(4)}` });

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  tes = await convidarMembro(db, pres, { email: 'tes@exemplo.test', nome: 'Tesoureira', cargo: 'tesoureiro' });
  sec = await convidarMembro(db, pres, { email: 'sec@exemplo.test', nome: 'Secretária', cargo: 'secretario' });
  hoje = await db.valor<string>(`select to_char(private.hoje(), 'YYYY-MM-DD')`);
});
afterAll(async () => { await db?.destruir(); });

describe('criar projeto próprio', () => {
  test('cria com regras padrão, prazo de prestação e tarefa; toque duplo não duplica', async () => {
    const p = { ...base(), fonte: 'Recursos próprios', valor_aprovado: '12000.00' };
    expect(await rpc('criar_projeto', { p }, pres)).toMatchObject({ ok: true, id: p.projeto_id, repetido: false });
    expect(await rpc('criar_projeto', { p }, pres)).toMatchObject({ ok: true, repetido: true });
    const [x] = await db.linhas('select verba_id, situacao, valor_aprovado::text v, prazo_prestacao - vigencia_fim dias, responsavel from public.projetos where id = $1', 'postgres', [p.projeto_id]);
    expect(x).toMatchObject({ verba_id: null, situacao: 'em_execucao', v: '12000.00', dias: 30, responsavel: pres });
    expect(await db.valor<number>(`select count(*)::int from public.tarefas where titulo ilike '%prestação%' and titulo ilike '%Escolinha%'`)).toBe(1);
  });
  test('sem permissão, campos extras, datas e nome ruins são recusados; outro autor não reusa o id', async () => {
    const p = base();
    await db.linhas(`delete from public.permissoes where membro_id = $1 and modulo = 'projetos' and acao = 'criar'`, 'postgres', [sec]);
    expect((await rpc('criar_projeto', { p }, sec)).erro).toBe('sem_permissao');
    expect((await rpc('criar_projeto', { p: { ...p, verba_id: randomUUID() } }, pres)).erro).toBe('invalido');
    expect((await rpc('criar_projeto', { p: { ...p, nome: 'x' } }, pres)).campo).toBe('nome');
    expect((await rpc('criar_projeto', { p: { ...p, vigencia_fim: '2000-01-01' } }, pres)).campo).toBe('vigencia_fim');
    expect((await rpc('criar_projeto', { p: { ...p, vigencia_inicio: '1990-01-01' } }, pres)).campo).toBe('vigencia_inicio');
    expect((await rpc('criar_projeto', { p: { ...p, valor_aprovado: '-5' } }, pres)).campo).toBe('valor_aprovado');
    expect((await rpc('criar_projeto', { p: { ...p, responsavel: randomUUID() } }, pres)).campo).toBe('responsavel');
    expect(await rpc('criar_projeto', { p }, pres)).toMatchObject({ ok: true });
    expect((await rpc('criar_projeto', { p }, tes)).erro).toMatch(/conflito|sem_permissao/);
    expect(await db.linhas('select private.criar_projeto($1::jsonb)', 'anon', [JSON.stringify(p)]).catch((e: Error) => e.message)).toMatch(/permission denied/);
  });
  test('fuzz: nunca exceção inesperada', async () => {
    const feio = fc.oneof(fc.string(), fc.constant(null), fc.integer(), fc.constantFrom('2026-02-30', '-1', '1e12', "'; drop table x; --"));
    await fc.assert(fc.asyncProperty(fc.record({ projeto_id: fc.oneof(fc.uuid(), feio), nome: feio, vigencia_inicio: feio, vigencia_fim: feio, valor_aprovado: feio, fonte: feio }, { requiredKeys: [] }),
      async (p) => {
        await db.linhas('delete from private.limites');
        try { await rpc('criar_projeto', { p }, pres); }
        catch (e) { expect((e as Error).message).toMatch(/invalid input syntax|out of range|null character|unsupported Unicode/); }
      }), { numRuns: 150, seed: 2026102802 });
  });
});
