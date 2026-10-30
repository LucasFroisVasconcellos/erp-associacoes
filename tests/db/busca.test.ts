import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco; let pres: string, tes: string, dirProprios: string;
const rpc = (n: string, a: Record<string, unknown>, q: string) => db.rpc(n, a, sessao(q));
const tipos = (r: { resultados: { tipo: string }[] }) => r.resultados.map((x) => x.tipo).sort();

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  tes = await convidarMembro(db, pres, { email: 'tes@exemplo.test', nome: 'Tesoureira', cargo: 'tesoureiro' });
  dirProprios = await convidarMembro(db, pres, { email: 'dp@exemplo.test', nome: 'Diretor', cargo: 'diretor' });
  await db.linhas(`update public.permissoes set alcance = 'proprios' where membro_id = $1 and modulo = 'financeiro'`, 'postgres', [dirProprios]);
  const hoje = await db.valor<string>(`select to_char(private.hoje(), 'YYYY-MM-DD')`);
  const conta = randomUUID(), cat = randomUUID();
  await rpc('salvar_conta', { p: { id: conta, nome: 'Conta', tipo: 'movimento', saldo_inicial: '0', data_saldo_inicial: '2025-01-01' } }, tes);
  await rpc('salvar_categoria', { p: { id: cat, nome: 'Transporte', tipo: 'saida' } }, tes);
  await rpc('criar_lancamento', { p: { id: randomUUID(), tipo: 'saida', situacao: 'realizada', valor: '80.00', data: hoje, descricao: 'Ônibus para Campinas', categoria_id: cat, conta_id: conta } }, tes);
  await rpc('criar_lancamento', { p: { id: randomUUID(), tipo: 'saida', situacao: 'realizada', valor: '10.00', data: hoje, descricao: '100% desconto teste_x', categoria_id: cat, conta_id: conta } }, tes);
});
afterAll(async () => { await db?.destruir(); });

test('acha o que a pessoa pode ver e respeita o alcance "próprios"', async () => {
  expect(tipos(await rpc('busca_global', { p_termo: 'campinas' }, tes))).toEqual(['lancamento']);
  expect((await rpc('busca_global', { p_termo: 'campinas' }, dirProprios)).resultados).toEqual([]);
});
test('curingas do LIKE são texto; termo curto, longo ou com controle é recusado', async () => {
  expect((await rpc('busca_global', { p_termo: '%' + '%' }, tes)).resultados).toEqual([]);
  expect((await rpc('busca_global', { p_termo: '100%' }, tes)).resultados).toHaveLength(1);
  expect((await rpc('busca_global', { p_termo: '_x' }, tes)).resultados).toHaveLength(1);
  expect((await rpc('busca_global', { p_termo: 'a' }, tes)).campo).toBe('termo');
  expect((await rpc('busca_global', { p_termo: 'a'.repeat(61) }, tes)).campo).toBe('termo');
  expect((await rpc('busca_global', { p_termo: 'a\u0007b' }, tes)).campo).toBe('termo');
});
test('anon e sessão sem 2FA não acham nada', async () => {
  expect(await db.falha(`select public.busca_global('campinas')`, 'anon')).toMatch(/permission denied/);
  expect((await db.rpc('busca_global', { p_termo: 'campinas' }, sessao(tes, { aal: 'aal1' }))).resultados ?? []).toEqual([]);
});
