import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco;
let pres: string, sec: string, tes: string, dir: string;
let conta: string, catEntrada: string, catSocio: string, catFixa: string, mesAtual: string;

const rpc = (nome: string, args: Record<string, unknown>, quem: string) => db.rpc(nome, args, sessao(quem));
const data = (expr: string) => db.valor<string>(`select to_char(${expr}, 'YYYY-MM-DD')`);
const novaPessoa = async (cat: string) => {
  const id = randomUUID();
  const r = await rpc('salvar_pessoa', { p: { id, nome: 'Associado Fictício', atleta: false, associado: true, categoria_id: cat } }, sec);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return id;
};
const pagar = (pessoa: string, extra: Record<string, unknown> = {}, quem = tes) => rpc('receber_parcela_unica', {
  p_id: randomUUID(), p_pessoa: pessoa, p_ano: 2026, p_lancamento: randomUUID(), p_conta: conta,
  p_data: '2026-02-10', p_forma: 'pix', p_categoria: catEntrada, ...extra }, quem);

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  sec = await convidarMembro(db, pres, { email: 'sec@exemplo.test', nome: 'Secretária', cargo: 'secretario' });
  tes = await convidarMembro(db, pres, { email: 'tes@exemplo.test', nome: 'Tesoureira', cargo: 'tesoureiro' });
  dir = await convidarMembro(db, pres, { email: 'dir@exemplo.test', nome: 'Diretor', cargo: 'diretor' });
  mesAtual = await data(`date_trunc('month', private.hoje())`);
  conta = randomUUID(); catEntrada = randomUUID(); catSocio = randomUUID(); catFixa = randomUUID();
  await rpc('salvar_conta', { p: { id: conta, nome: 'Conta Movimento', tipo: 'movimento', saldo_inicial: '0', data_saldo_inicial: '2025-01-01' } }, tes);
  await rpc('salvar_categoria', { p: { id: catEntrada, nome: 'Mensalidades', tipo: 'entrada' } }, tes);
});
afterAll(async () => { await db?.destruir(); });

describe('categoria com parcela única', () => {
  test('só em categoria por porcentagem e sempre mais barata que 12 mensalidades', async () => {
    const base = { id: catSocio, nome: 'Associado', percentual_salario_minimo: '1', dia_vencimento: 28 };
    expect((await rpc('salvar_categoria_socio', { p: { ...base, percentual_parcela_unica: '13' } }, sec)).campo).toBe('percentual_parcela_unica');
    expect((await rpc('salvar_categoria_socio', { p: { ...base, percentual_parcela_unica: '0' } }, sec)).campo).toBe('percentual_parcela_unica');
    expect((await rpc('salvar_categoria_socio', { p: { id: catFixa, nome: 'Fixa', valor_mensalidade: '30.00', percentual_parcela_unica: '10', dia_vencimento: 10 } }, sec)).campo)
      .toBe('percentual_parcela_unica');
    expect((await rpc('salvar_categoria_socio', { p: { id: catFixa, nome: 'Fixa', valor_mensalidade: '30.00', dia_vencimento: 10 } }, sec)).ok).toBe(true);
    expect((await rpc('salvar_categoria_socio', { p: { ...base, percentual_parcela_unica: '10' } }, sec)).ok).toBe(true);
  });
});

describe('receber a parcela única', () => {
  test('lança 10% de R$ 1.621 = R$ 162,10 e dispensa as mensalidades abertas do ano', async () => {
    const p = await novaPessoa(catSocio);
    expect((await rpc('gerar_mensalidades', { p_competencia: mesAtual }, sec)).ok).toBe(true);
    const r = await pagar(p);
    expect(r.ok).toBe(true);
    expect(r.valor).toBe('162.10');
    expect(await db.valor<string>('select valor::text from public.lancamentos where id = $1', 'postgres', [r.lancamento_id])).toBe('162.10');
    if (mesAtual.startsWith('2026')) {
      expect(await db.valor<string>('select situacao from public.mensalidades where pessoa_id = $1', 'postgres', [p])).toBe('dispensada');
    }
    // gerar de novo no ano não cria mensalidade para quem pagou a parcela única
    const prox = await data(`date_trunc('month', private.hoje()) + interval '1 month'`);
    await rpc('gerar_mensalidades', { p_competencia: prox }, sec);
    if (prox.startsWith('2026')) expect(await db.valor<number>(`select count(*)::int from public.mensalidades where pessoa_id = $1 and situacao = 'aberta'`, 'postgres', [p])).toBe(0);
  });

  test('repetir o mesmo toque não duplica; pagar de novo no ano é recusado', async () => {
    const p = await novaPessoa(catSocio);
    const args = { p_id: randomUUID(), p_lancamento: randomUUID() };
    expect((await pagar(p, args)).ok).toBe(true);
    expect((await pagar(p, args)).repetido).toBe(true);
    expect((await pagar(p)).erro).toBe('ja_paga');
    expect(await db.valor<number>('select count(*)::int from public.parcelas_unicas where pessoa_id = $1', 'postgres', [p])).toBe(1);
  });

  test('em paralelo, só uma passa', async () => {
    const p = await novaPessoa(catSocio);
    const r = await Promise.all([1, 2, 3].map(() => pagar(p)));
    expect(r.filter((x) => x.ok).length).toBe(1);
    expect(await db.valor<number>(`select count(*)::int from public.lancamentos where descricao = 'Mensalidade parcela única 2026' and valor = 162.10`, 'postgres'))
      .toBe(await db.valor<number>('select count(*)::int from public.parcelas_unicas', 'postgres'));
  });

  test('fora do prazo, no futuro, ano inválido ou categoria sem parcela única: recusado', async () => {
    const p = await novaPessoa(catSocio);
    expect((await pagar(p, { p_data: '2026-03-01' })).campo).toBe('data');
    expect((await pagar(p, { p_data: '2025-11-30' })).campo).toBe('data');
    expect((await pagar(p, { p_ano: 2023, p_data: '2023-02-01' })).campo).toBe('ano');
    expect((await pagar(p, { p_ano: 2999 })).campo).toBe('ano');
    const f = await novaPessoa(catFixa);
    expect((await pagar(f)).campo).toBe('parcela_unica');
  });

  test('mensalidade do ano já paga bloqueia a parcela única (não cobra duas vezes)', async () => {
    const p = await novaPessoa(catSocio);
    await db.linhas(`insert into public.mensalidades (pessoa_id, competencia, valor, vencimento, situacao, pago_em)
      values ($1, '2026-01-01', 16.21, '2026-01-28', 'paga', '2026-01-20')`, 'postgres', [p]);
    expect((await pagar(p)).erro).toBe('ja_paga');
  });

  test('permissões: diretor e secretaria sem financeiro/editar não recebem', async () => {
    const p = await novaPessoa(catSocio);
    expect((await pagar(p, {}, dir)).erro).toBe('sem_permissao');
    expect((await pagar(p, {}, sec)).erro).toBe('sem_permissao');
  });

  test('ninguém grava direto na tabela', async () => {
    expect(await db.falha(`insert into public.parcelas_unicas (id, pessoa_id, ano, valor, pago_em, lancamento_id, criado_por)
      values (gen_random_uuid(), gen_random_uuid(), 2026, 1, '2026-01-01', gen_random_uuid(), gen_random_uuid())`, sessao(pres))).toMatch(/permission denied|row-level/);
  });
});
