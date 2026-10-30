import fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco; let pres: string, tes: string;
const rpc = (n: string, a: Record<string, unknown>, q: string) => db.rpc(n, a, sessao(q));
const PERM = [{ modulo: 'agenda', acao: 'ver', alcance: 'tudo' }, { modulo: 'tarefas', acao: 'ver', alcance: 'tudo' }];

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  tes = await convidarMembro(db, pres, { email: 'tes@exemplo.test', nome: 'Tesoureira', cargo: 'tesoureiro' });
});
afterAll(async () => { await db?.destruir(); });

describe('modelos de permissão', () => {
  test('só administrador cadastra; campos e permissões validados; nome e cargo sem repetir', async () => {
    const p = { id: randomUUID(), nome: 'Comissão técnica', permissoes: PERM };
    expect((await rpc('salvar_modelo_permissao', { p }, tes)).erro).toBe('sem_permissao');
    expect((await rpc('salvar_modelo_permissao', { p: { ...p, extra: 1 } }, pres)).erro).toBe('invalido');
    expect((await rpc('salvar_modelo_permissao', { p: { ...p, permissoes: [{ modulo: 'banco', acao: 'ver' }] } }, pres)).campo).toBe('permissoes');
    expect((await rpc('salvar_modelo_permissao', { p: { ...p, cargo: 'rei' } }, pres)).campo).toBe('cargo');
    expect((await rpc('salvar_modelo_permissao', { p }, pres)).ok).toBe(true);
    expect((await rpc('salvar_modelo_permissao', { p: { ...p, id: randomUUID(), nome: 'comissão TÉCNICA' } }, pres)).campo).toBe('nome');
    expect(await db.valor<number>('select count(*)::int from public.modelos_permissao', sessao(tes))).toBe(0);
    expect(await db.valor<number>('select count(*)::int from public.modelos_permissao', sessao(pres))).toBe(1);
  });
  test('modelo ligado a um cargo substitui o padrão; apagar volta ao padrão de fábrica', async () => {
    const fabrica = (await rpc('modelo_permissoes', { p_cargo: 'diretor' }, pres)).permissoes;
    expect(fabrica.length).toBeGreaterThan(2);
    const id = randomUUID();
    expect((await rpc('salvar_modelo_permissao', { p: { id, nome: 'Diretor (Associação Exemplo)', cargo: 'diretor', permissoes: PERM } }, pres)).ok).toBe(true);
    expect((await rpc('salvar_modelo_permissao', { p: { id: randomUUID(), nome: 'Outro diretor', cargo: 'diretor', permissoes: PERM } }, pres)).campo).toBe('cargo');
    expect((await rpc('modelo_permissoes', { p_cargo: 'diretor' }, pres)).permissoes).toEqual(PERM);
    // convite novo de diretor usa o modelo cadastrado
    const novo = await convidarMembro(db, pres, { email: 'dir2@exemplo.test', nome: 'Diretor 2', cargo: 'diretor' });
    expect(await db.valor<number>('select count(*)::int from public.permissoes where membro_id = $1', 'postgres', [novo])).toBe(PERM.length);
    expect((await rpc('apagar_modelo_permissao', { p_id: id }, tes)).erro).toBe('sem_permissao');
    expect(await rpc('apagar_modelo_permissao', { p_id: id }, pres)).toEqual({ ok: true });
    expect(await rpc('apagar_modelo_permissao', { p_id: id }, pres)).toMatchObject({ ok: true, repetido: true });
    expect((await rpc('modelo_permissoes', { p_cargo: 'diretor' }, pres)).permissoes).toEqual(fabrica);
  });
  test('fuzz: nunca exceção, nunca grava permissão inválida', async () => {
    const feio = fc.oneof(fc.string(), fc.constant(null), fc.integer(), fc.constantFrom('presidente', '', "'; drop table x; --"));
    await fc.assert(fc.asyncProperty(fc.record({ id: fc.oneof(fc.uuid(), feio), nome: feio, cargo: feio,
      permissoes: fc.oneof(feio, fc.array(fc.record({ modulo: feio, acao: feio, alcance: feio }, { requiredKeys: [] }), { maxLength: 3 })) }, { requiredKeys: [] }),
    async (p) => {
      await db.linhas('delete from private.limites');
      try { await rpc('salvar_modelo_permissao', { p }, pres); }
      catch (e) { expect((e as Error).message).toMatch(/invalid input syntax|null character|unsupported Unicode/); }
    }), { numRuns: 150, seed: 2026102805 });
    expect(await db.valor<number>(`select count(*)::int from public.modelos_permissao where not private.permissoes_validas(permissoes)`)).toBe(0);
  });
});
