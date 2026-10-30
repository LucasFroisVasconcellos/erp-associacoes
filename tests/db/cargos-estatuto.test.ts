import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco;
let pres: string, cf: string, rep: string, tes: string;
const acoes = (id: string) => db.linhas('select modulo, acao from public.permissoes where membro_id = $1', 'postgres', [id]);

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  tes = await convidarMembro(db, pres, { email: 'tes@exemplo.test', nome: 'Tesoureira', cargo: 'tesoureiro' });
  cf = await convidarMembro(db, pres, { email: 'cf@exemplo.test', nome: 'Conselheiro', cargo: 'conselho_fiscal' });
  rep = await convidarMembro(db, pres, { email: 'rep@exemplo.test', nome: 'Representante', cargo: 'representante_atletas' });
});
afterAll(async () => { await db?.destruir(); });

describe('Conselho Fiscal', () => {
  test('só ver e exportar; nunca criar, editar, aprovar ou administrar; sem pessoas e saúde', async () => {
    const a = await acoes(cf);
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((x) => x.acao === 'ver' || x.acao === 'exportar')).toBe(true);
    expect(a.some((x) => x.modulo === 'pessoas' || x.modulo === 'saude')).toBe(false);
    expect(a).toContainEqual({ modulo: 'financeiro', acao: 'ver' });
  });

  test('não é administrador e não muda nada no Dinheiro', async () => {
    expect((await db.rpc('meu_perfil', {}, sessao(cf))).membro.admin).toBe(false);
    expect((await db.rpc('modelo_permissoes', { p_cargo: 'dev' }, sessao(cf))).erro).toBe('sem_permissao');
    const r = await db.rpc('salvar_conta', { p: { id: randomUUID(), nome: 'Conta X', tipo: 'movimento', saldo_inicial: '0', data_saldo_inicial: '2026-01-01' } }, sessao(cf));
    expect(r.erro).toBe('sem_permissao');
  });

  test('lê o que fiscaliza (contas criadas pela tesouraria)', async () => {
    await db.rpc('salvar_conta', { p: { id: randomUUID(), nome: 'Conta Movimento', tipo: 'movimento', saldo_inicial: '0', data_saldo_inicial: '2026-01-01' } }, sessao(tes));
    expect(await db.valor<number>('select count(*)::int from public.contas_bancarias', sessao(cf))).toBeGreaterThan(0);
    expect(await db.valor<number>('select count(*)::int from public.pessoas', sessao(cf))).toBe(0);
  });
});

describe('Representante dos Atletas', () => {
  test('recebe o modelo do diretor e não é administrador', async () => {
    const dir = (await db.rpc('modelo_permissoes', { p_cargo: 'diretor' }, sessao(pres))).permissoes;
    const r = (await db.rpc('modelo_permissoes', { p_cargo: 'representante_atletas' }, sessao(pres))).permissoes;
    expect(r).toEqual(dir);
    expect((await db.rpc('meu_perfil', {}, sessao(rep))).membro.admin).toBe(false);
  });
});

test('cargo fora da lista continua recusado', async () => {
  expect((await db.rpc('modelo_permissoes', { p_cargo: 'conselheiro' }, sessao(pres))).campo).toBe('cargo');
});
