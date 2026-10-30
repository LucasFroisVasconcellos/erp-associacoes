import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco; let pres: string, tes: string, dirProprios: string; let hoje: string;
const rpc = (n: string, a: Record<string, unknown>, q: string) => db.rpc(n, a, sessao(q));

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  tes = await convidarMembro(db, pres, { email: 'tes@exemplo.test', nome: 'Tesoureira', cargo: 'tesoureiro' });
  dirProprios = await convidarMembro(db, pres, { email: 'dp@exemplo.test', nome: 'Diretor', cargo: 'diretor' });
  await db.linhas(`update public.permissoes set alcance = 'proprios' where membro_id = $1 and modulo = 'financeiro'`, 'postgres', [dirProprios]);
  hoje = await db.valor<string>(`select to_char(private.hoje(), 'YYYY-MM-DD')`);
  const conta = randomUUID(), cat = randomUUID(), catE = randomUUID();
  await rpc('salvar_conta', { p: { id: conta, nome: 'Conta', tipo: 'movimento', saldo_inicial: '1000.00', data_saldo_inicial: '2025-01-01' } }, tes);
  await rpc('salvar_categoria', { p: { id: cat, nome: 'Transporte', tipo: 'saida' } }, tes);
  await rpc('salvar_categoria', { p: { id: catE, nome: 'Doações', tipo: 'entrada' } }, tes);
  await rpc('criar_lancamento', { p: { id: randomUUID(), tipo: 'saida', situacao: 'realizada', valor: '200.00', data: hoje, descricao: 'Ônibus', categoria_id: cat, conta_id: conta } }, tes);
  await rpc('criar_lancamento', { p: { id: randomUUID(), tipo: 'entrada', situacao: 'prevista', valor: '500.00', data: hoje, descricao: 'Doação prometida', categoria_id: catE } }, tes);
});
afterAll(async () => { await db?.destruir(); });

test('devolve saldo, previstas e realizados agregados', async () => {
  const r = await rpc('dados_analise', {}, tes);
  expect(r).toMatchObject({ ok: true, saldo: '800.00' });
  expect(r.previstas).toEqual([expect.objectContaining({ tipo: 'entrada', valor: '500.00', categoria: 'Doações' })]);
  expect(r.realizados).toHaveLength(1);
  expect(r.realizados[0]).toMatchObject({ valor: '200.00', fonte: 'Transporte', comprovante: false });
  expect(Object.keys(r.realizados[0])).not.toContain('criado_por');
  expect(r.mensalidades).toMatchObject({ pagas_12m: 0, vencidas_abertas: [] });
});

test('negado a quem só vê os próprios lançamentos e sem 2FA', async () => {
  expect((await rpc('dados_analise', {}, dirProprios)).erro).toBe('sem_permissao');
  expect((await db.rpc('dados_analise', {}, sessao(tes, { aal: 'aal1' }))).erro).toBeTruthy();
});

test('tarefas por diretor só para quem vê tarefas', async () => {
  await db.linhas(`delete from public.permissoes where membro_id = $1 and modulo = 'tarefas'`, 'postgres', [tes]);
  expect((await rpc('dados_analise', {}, tes)).tarefas).toBeNull();
  expect(Array.isArray((await rpc('dados_analise', {}, pres)).tarefas)).toBe(true);
});

test('mutação: sem a checagem de alcance, quem só vê os próprios leria tudo', async () => {
  const assinatura = 'private.dados_analise()';
  const original = await db.valor<string>(`select pg_get_functiondef('${assinatura}'::regprocedure)`);
  const de = "if private.alcance('financeiro', 'ver') <> 'tudo' then return private.negar('dados_analise'); end if;";
  expect(original).toContain(de);
  expect((await rpc('dados_analise', {}, dirProprios)).ok).toBeUndefined();
  try {
    await db.linhas(original.replace(de, ''));
    expect((await rpc('dados_analise', {}, dirProprios)).ok).toBe(true);
  } finally { await db.linhas(original); }
  expect((await rpc('dados_analise', {}, dirProprios)).erro).toBe('sem_permissao');
});
