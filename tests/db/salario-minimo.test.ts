import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco;
let pres: string, sec: string, dir: string;
let mesAtual: string;

const rpc = (nome: string, args: Record<string, unknown>, quem: string) => db.rpc(nome, args, sessao(quem));
const data = (expr: string) => db.valor<string>(`select to_char(${expr}, 'YYYY-MM-DD')`);
const pessoa = (cat: string) => ({ id: randomUUID(), nome: 'Associado Fictício', atleta: false, associado: true, categoria_id: cat });
const valorDe = (id: string) => db.valor<string>('select valor::text from public.mensalidades where pessoa_id = $1', 'postgres', [id]);

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  sec = await convidarMembro(db, pres, { email: 'sec@exemplo.test', nome: 'Secretária', cargo: 'secretario' });
  dir = await convidarMembro(db, pres, { email: 'dir@exemplo.test', nome: 'Diretor', cargo: 'diretor' });
  mesAtual = await data(`date_trunc('month', private.hoje())`);
});
afterAll(async () => { await db?.destruir(); });

describe('salário mínimo', () => {
  test('vem com os valores oficiais de 2025 e 2026', async () => {
    expect(await db.valor<string>(`select valor::text from public.salarios_minimos where vigente_desde = '2026-01-01'`)).toBe('1621.00');
    expect(await db.valor<string>(`select valor::text from public.salarios_minimos where vigente_desde = '2025-01-01'`)).toBe('1518.00');
  });

  test('regra dos 45 dias: o reajuste de janeiro só entra em cobrança com vencimento 45 dias depois', async () => {
    expect(await db.valor<string>(`select private.salario_minimo_para('2026-02-10')::text`)).toBe('1518.00');
    expect(await db.valor<string>(`select private.salario_minimo_para('2026-02-15')::text`)).toBe('1621.00');
    expect(await db.valor<string>(`select private.salario_minimo_para('2026-03-10')::text`)).toBe('1621.00');
    expect(await db.valor(`select private.salario_minimo_para('2025-01-10')`)).toBeNull();
  });

  test('só quem edita pessoas cadastra; valores absurdos recusados', async () => {
    expect((await rpc('salvar_salario_minimo', { p_vigente_desde: '2027-01-01', p_valor: '1700.00' }, dir)).erro).toBe('sem_permissao');
    expect((await rpc('salvar_salario_minimo', { p_vigente_desde: '2027-01-01', p_valor: '-1' }, sec)).campo).toBe('salario_minimo');
    expect((await rpc('salvar_salario_minimo', { p_vigente_desde: '2027-01-01', p_valor: '50' }, sec)).campo).toBe('salario_minimo');
    expect((await rpc('salvar_salario_minimo', { p_vigente_desde: '2027-01-01', p_valor: '1e3' }, sec)).campo).toBe('salario_minimo');
    expect((await rpc('salvar_salario_minimo', { p_vigente_desde: '1999-01-01', p_valor: '1000' }, sec)).campo).toBe('vigente_desde');
    expect((await rpc('salvar_salario_minimo', { p_vigente_desde: '2999-01-01', p_valor: '1000' }, sec)).campo).toBe('vigente_desde');
    expect((await rpc('salvar_salario_minimo', { p_vigente_desde: '2026-01-01', p_valor: '1621.00' }, sec)).ok).toBe(true);
  });

  test('ninguém escreve direto na tabela (só pela função)', async () => {
    expect(await db.falha(`insert into public.salarios_minimos (vigente_desde, valor) values ('2030-01-01', 2000)`, sessao(pres))).toMatch(/permission denied|row-level/);
    expect(await db.falha(`update public.salarios_minimos set valor = 1 where vigente_desde = '2026-01-01'`, sessao(pres))).toMatch(/permission denied|row-level/);
  });
});

describe('categoria em porcentagem do salário mínimo', () => {
  test('aceita porcentagem OU valor fixo, nunca os dois', async () => {
    const base = { id: randomUUID(), nome: 'Sócio 1%', dia_vencimento: 10 };
    expect((await rpc('salvar_categoria_socio', { p: { ...base, percentual_salario_minimo: '1', valor_mensalidade: '30.00' } }, sec)).campo).toBe('valor_mensalidade');
    expect((await rpc('salvar_categoria_socio', { p: { ...base, percentual_salario_minimo: '0' } }, sec)).campo).toBe('percentual_salario_minimo');
    expect((await rpc('salvar_categoria_socio', { p: { ...base, percentual_salario_minimo: '101' } }, sec)).campo).toBe('percentual_salario_minimo');
    expect((await rpc('salvar_categoria_socio', { p: { ...base, percentual_salario_minimo: 1 } }, sec)).campo).toBe('percentual_salario_minimo');
    expect((await rpc('salvar_categoria_socio', { p: base }, sec)).campo).toBe('valor_mensalidade');
    expect((await rpc('salvar_categoria_socio', { p: { ...base, percentual_salario_minimo: '1', valor_mensalidade: '0' } }, sec)).ok).toBe(true);
    expect(await db.valor<string>('select percentual_salario_minimo::text from public.categorias_socio where id = $1', 'postgres', [base.id])).toBe('1.00');
  });

  test('gera com o valor calculado pelo servidor (1% de R$ 1.621 = R$ 16,21) e valor fixo continua igual', async () => {
    const pct = randomUUID(), fixa = randomUUID();
    // vencimento no dia 28 garante a regra dos 45 dias com o mínimo de 2026 no mês corrente (testes rodam em 2026+)
    expect((await rpc('salvar_categoria_socio', { p: { id: pct, nome: 'Contribuinte', percentual_salario_minimo: '1', dia_vencimento: 28 } }, sec)).ok).toBe(true);
    expect((await rpc('salvar_categoria_socio', { p: { id: fixa, nome: 'Fixa', valor_mensalidade: '30.00', dia_vencimento: 10 } }, sec)).ok).toBe(true);
    const a = pessoa(pct), b = pessoa(fixa);
    expect((await rpc('salvar_pessoa', { p: a }, sec)).ok).toBe(true);
    expect((await rpc('salvar_pessoa', { p: b }, sec)).ok).toBe(true);
    expect((await rpc('gerar_mensalidades', { p_competencia: mesAtual }, sec)).ok).toBe(true);
    const sm = await db.valor<string>(`select private.salario_minimo_para(make_date(extract(year from $1::date)::int, extract(month from $1::date)::int, 28))::text`, 'postgres', [mesAtual]);
    expect(await valorDe(a.id)).toBe((Math.round(Number(sm)) / 100).toFixed(2));
    expect(await valorDe(b.id)).toBe('30.00');
  });

  test('reajuste do mínimo não muda mensalidade já gerada', async () => {
    const id = await db.valor<string>(`select pessoa_id::text from public.mensalidades m join public.pessoas p on p.id = m.pessoa_id
      join public.categorias_socio c on c.id = p.categoria_id where c.nome = 'Contribuinte' limit 1`);
    const antes = await valorDe(id);
    expect((await rpc('salvar_salario_minimo', { p_vigente_desde: '2025-01-01', p_valor: '9999.00' }, sec)).ok).toBe(true);
    expect((await rpc('salvar_salario_minimo', { p_vigente_desde: '2026-01-01', p_valor: '9999.00' }, sec)).ok).toBe(true);
    expect(await valorDe(id)).toBe(antes);
    await rpc('salvar_salario_minimo', { p_vigente_desde: '2025-01-01', p_valor: '1518.00' }, sec);
    await rpc('salvar_salario_minimo', { p_vigente_desde: '2026-01-01', p_valor: '1621.00' }, sec);
  });

  test('sem salário mínimo para a data: não gera nenhuma (tudo ou nada)', async () => {
    await db.linhas(`delete from public.salarios_minimos`, 'postgres');
    const prox = await data(`date_trunc('month', private.hoje()) + interval '1 month'`);
    const antes = await db.valor<number>('select count(*)::int from public.mensalidades');
    expect((await rpc('gerar_mensalidades', { p_competencia: prox }, sec)).campo).toBe('salario_minimo');
    expect(await db.valor<number>('select count(*)::int from public.mensalidades')).toBe(antes);
  });
});
