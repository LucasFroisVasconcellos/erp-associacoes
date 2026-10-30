import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Banco, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco;
let pres: string;
const importar = (serie: unknown) => db.valor<Record<string, unknown>>('select private.importar_salario_minimo($1::jsonb)', 'postgres', [JSON.stringify(serie)]);
const vigencias = () => db.linhas(`select to_char(vigente_desde, 'YYYY-MM-DD') d, valor::text v from public.salarios_minimos order by 1`);
const mes = (m: string, v: string) => ({ data: `01/${m}`, valor: v });

beforeAll(async () => { db = await novoBanco(); pres = await primeiroAdmin(db); });
afterAll(async () => { await db?.destruir(); });

describe('importar a série do Banco Central', () => {
  test('série igual ao que já está cadastrado: não cria nada', async () => {
    const r = await importar([mes('11/2025', '1518.00'), mes('12/2025', '1518.00'), mes('01/2026', '1621.00'), mes('02/2026', '1621.00')]);
    expect(r).toMatchObject({ ok: true, criadas: 0, conflitos: 0, recusadas: 0 });
    expect(await vigencias()).toHaveLength(2);
  });

  test('reajuste novo em janeiro vira vigência nova (e repetir não duplica)', async () => {
    const serie = [mes('12/2026', '1621.00'), mes('01/2027', '1700.00'), mes('02/2027', '1700.00')];
    expect(await importar(serie)).toMatchObject({ ok: true, criadas: 1 });
    expect(await importar(serie)).toMatchObject({ ok: true, criadas: 0 });
    expect(await vigencias()).toContainEqual({ d: '2027-01-01', v: '1700.00' });
  });

  test('valor menor que o anterior ou aumento acima de 25%: recusado', async () => {
    expect(await importar([mes('11/2027', '1000.00')])).toMatchObject({ ok: true, criadas: 0, recusadas: 1 });
    expect(await importar([mes('11/2027', '9999.00')])).toMatchObject({ ok: true, criadas: 0, recusadas: 1 });
  });

  test('não sobrescreve o que foi cadastrado à mão', async () => {
    await db.rpc('salvar_salario_minimo', { p_vigente_desde: '2027-10-01', p_valor: '1800.00' }, sessao(pres));
    expect(await importar([mes('10/2027', '1790.00')])).toMatchObject({ ok: true, criadas: 0, conflitos: 1 });
    expect(await vigencias()).toContainEqual({ d: '2027-10-01', v: '1800.00' });
  });

  test('resposta malformada ou fora da faixa: nada é gravado', async () => {
    const antes = (await vigencias()).length;
    for (const ruim of [{}, [], [{ data: '2027-01-01', valor: '1700' }], [mes('01/2029', '1.700,00')], [mes('01/2029', '50.00')],
      [mes('01/2029', '1900.00'), { data: '01/02/2029', valor: 'x' }], [mes('01/2099', '1900.00')], Array.from({ length: 61 }, () => mes('01/2029', '1900.00'))]) {
      expect((await importar(ruim)).ok).toBe(false);
    }
    expect((await vigencias()).length).toBe(antes);
  });

  test('nenhum papel da API executa as funções automáticas', async () => {
    for (const f of ['private.importar_salario_minimo(\'[]\'::jsonb)', 'private.pedir_salario_minimo()', 'private.processar_salario_minimo()']) {
      expect(await db.falha(`select ${f}`, sessao(pres))).toMatch(/permission denied/);
      expect(await db.falha(`select ${f}`, 'anon')).toMatch(/permission denied/);
    }
  });

  test('cada execução fica na auditoria', async () => {
    expect(await db.valor<number>(`select count(*)::int from public.auditoria where acao = 'salario_minimo_automatico'`, 'postgres')).toBeGreaterThan(5);
  });
});
