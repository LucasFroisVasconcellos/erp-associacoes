import fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco; let pres: string, sec: string, tes: string, dir: string, dirProprios: string;
let ano: number, hoje: string, conta: string, catS: string, catE: string;
const rpc = (n: string, a: Record<string, unknown>, q: string) => db.rpc(n, a, sessao(q));

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  sec = await convidarMembro(db, pres, { email: 'sec@exemplo.test', nome: 'Secretária', cargo: 'secretario' });
  tes = await convidarMembro(db, pres, { email: 'tes@exemplo.test', nome: 'Tesoureira', cargo: 'tesoureiro' });
  dir = await convidarMembro(db, pres, { email: 'dir@exemplo.test', nome: 'Diretor', cargo: 'diretor' });
  dirProprios = await convidarMembro(db, pres, { email: 'dp@exemplo.test', nome: 'Diretor 2', cargo: 'diretor' });
  await db.linhas(`update public.permissoes set alcance = 'proprios' where membro_id = $1 and modulo = 'financeiro'`, 'postgres', [dirProprios]);
  hoje = await db.valor<string>(`select to_char(private.hoje(), 'YYYY-MM-DD')`); ano = Number(hoje.slice(0, 4));
  conta = randomUUID(); catS = randomUUID(); catE = randomUUID();
  await rpc('salvar_conta', { p: { id: conta, nome: 'Conta', tipo: 'movimento', saldo_inicial: '0', data_saldo_inicial: '2025-01-01' } }, tes);
  await rpc('salvar_categoria', { p: { id: catS, nome: 'Transporte', tipo: 'saida' } }, tes);
  await rpc('salvar_categoria', { p: { id: catE, nome: 'Mensalidades', tipo: 'entrada' } }, tes);
  await rpc('criar_lancamento', { p: { id: randomUUID(), tipo: 'saida', situacao: 'realizada', valor: '250.00', data: hoje, descricao: 'Ônibus', categoria_id: catS, conta_id: conta } }, tes);
});
afterAll(async () => { await db?.destruir(); });

describe('orçamento anual', () => {
  test('só quem administra o financeiro grava; ano fora da janela e campos extras recusados', async () => {
    const p = [{ categoria_id: catS, valor: '3000.00' }];
    expect((await rpc('salvar_orcamento', { p_ano: ano, p }, dir)).erro).toBe('sem_permissao');
    expect((await rpc('salvar_orcamento', { p_ano: ano + 5, p }, tes)).campo).toBe('ano');
    expect((await rpc('salvar_orcamento', { p_ano: ano, p: [{ ...p[0], ano: 1999 }] }, tes)).campo).toBe('linhas');
    expect((await rpc('salvar_orcamento', { p_ano: ano, p: [{ categoria_id: catS, valor: '-1' }] }, tes)).campo).toBe('linhas');
    expect((await rpc('salvar_orcamento', { p_ano: ano, p: [p[0], p[0]] }, tes)).campo).toBe('categoria_id');
    expect(await rpc('salvar_orcamento', { p_ano: ano, p }, tes)).toMatchObject({ ok: true });
    expect(await rpc('salvar_orcamento', { p_ano: ano, p: [{ categoria_id: catS, valor: '3500.00' }] }, tes)).toMatchObject({ ok: true });
  });
  test('previsto × realizado por categoria e mês; só quem vê o financeiro inteiro', async () => {
    const r = await rpc('orcamento_ano', { p_ano: ano }, tes);
    const t = r.categorias.find((c: { id: string }) => c.id === catS);
    expect(t).toMatchObject({ previsto: '3500.00', realizado: '250.00' });
    expect(t.por_mes).toEqual([{ mes: Number(hoje.slice(5, 7)), valor: '250.00' }]);
    expect((await rpc('orcamento_ano', { p_ano: ano }, dirProprios)).erro).toBe('sem_permissao');
    expect(await db.linhas('select * from public.orcamentos', 'anon').catch((e: Error) => e.message)).toMatch(/permission denied/);
  });
  test('fuzz: nunca exceção nem valor negativo gravado', async () => {
    const feio = fc.oneof(fc.string(), fc.constant(null), fc.integer(), fc.constantFrom('-0.01', '1e9', '99999999999.99', "'; drop table x; --"));
    await fc.assert(fc.asyncProperty(fc.oneof(feio, fc.array(fc.record({ categoria_id: fc.oneof(fc.constant(catS), fc.uuid(), feio), valor: feio }, { requiredKeys: [] }), { maxLength: 3 })),
      fc.oneof(fc.integer({ min: 2018, max: 2105 }), fc.constant(null)), async (p, a) => {
        await db.linhas('delete from private.limites');
        try { await rpc('salvar_orcamento', { p_ano: a, p }, tes); }
        catch (e) { expect((e as Error).message).toMatch(/invalid input syntax|out of range|null character|unsupported Unicode/); }
      }), { numRuns: 200, seed: 2026102801 });
    expect(await db.valor('select count(*)::int from public.orcamentos where valor < 0')).toBe(0);
  });
});

describe('mensalidade recebida em um passo', () => {
  let mens: string;
  beforeAll(async () => {
    const cat = randomUUID(), pessoa = randomUUID();
    await rpc('salvar_categoria_socio', { p: { id: cat, nome: 'Associado', valor_mensalidade: '50.00', dia_vencimento: 10 } }, sec);
    await rpc('salvar_pessoa', { p: { id: pessoa, nome: 'Associado Fictício', atleta: false, associado: true, categoria_id: cat } }, sec);
    await rpc('gerar_mensalidades', { p_competencia: hoje.slice(0, 8) + '01' }, sec);
    mens = await db.valor<string>('select id from public.mensalidades where pessoa_id = $1', 'postgres', [pessoa]);
  });
  test('permissão, categoria do tipo errado e data no futuro são recusadas', async () => {
    const args = (extra = {}) => ({ p_id: mens, p_lancamento: randomUUID(), p_conta: conta, p_data: hoje, p_forma: 'pix', p_categoria: catE, ...extra });
    expect((await rpc('receber_mensalidade', args(), dir)).erro).toBe('sem_permissao');
    expect((await rpc('receber_mensalidade', args({ p_categoria: catS }), tes)).campo).toBe('categoria_id');
    expect((await rpc('receber_mensalidade', args({ p_data: '2099-01-01' }), tes)).campo).toBe('data');
    expect(await db.valor(`select situacao from public.mensalidades where id = $1`, 'postgres', [mens])).toBe('aberta');
  });
  test('cria a entrada, dá baixa e repetir não duplica; descrição sem o nome da pessoa', async () => {
    const id = randomUUID();
    const args = { p_id: mens, p_lancamento: id, p_conta: conta, p_data: hoje, p_forma: 'pix', p_categoria: catE };
    expect(await rpc('receber_mensalidade', args, tes)).toMatchObject({ ok: true });
    expect(await rpc('receber_mensalidade', args, tes)).toMatchObject({ ok: true, repetido: true });
    expect((await rpc('receber_mensalidade', { ...args, p_lancamento: randomUUID() }, tes)).erro).toBe('ja_paga');
    const l = (await db.linhas('select descricao, valor::text from public.lancamentos where id = $1', 'postgres', [id]))[0]!;
    expect(l.valor).toBe('50.00'); expect(String(l.descricao)).not.toMatch(/Fictício/);
    expect(await db.valor(`select situacao from public.mensalidades where id = $1`, 'postgres', [mens])).toBe('paga');
  });
});

test('mutação: sem a checagem de alcance, quem só vê os próprios leria o orçamento de todos', async () => {
  const assinatura = 'private.orcamento_ano(integer)';
  const original = await db.valor<string>(`select pg_get_functiondef('${assinatura}'::regprocedure)`);
  const de = "if private.alcance('financeiro', 'ver') <> 'tudo' then return private.negar('orcamento_ano'); end if;";
  expect(original).toContain(de);
  await db.linhas('delete from private.limites');
  expect((await rpc('orcamento_ano', { p_ano: ano }, dirProprios)).ok).toBeUndefined();
  try { await db.linhas(original.replace(de, '')); expect((await rpc('orcamento_ano', { p_ano: ano }, dirProprios)).ok).toBe(true); }
  finally { await db.linhas(original); }
});
