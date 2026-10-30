import { describe, expect, test } from 'vitest';
import { normalizarDecimais } from './normalizar';

describe('normalizarDecimais (numeric do banco → texto com 2 casas)', () => {
  test('dinheiro e porcentagem viram texto; inteiros e textos ficam iguais', () => {
    expect(normalizarDecimais([{ vigente_desde: '2026-01-01', valor: 1621 }])).toEqual([{ vigente_desde: '2026-01-01', valor: '1621.00' }]);
    expect(normalizarDecimais({ valor_mensalidade: 0, percentual_salario_minimo: 1, dia_vencimento: 10, ano: 2026, nome: 'Associado' }))
      .toEqual({ valor_mensalidade: '0.00', percentual_salario_minimo: '1.00', dia_vencimento: 10, ano: 2026, nome: 'Associado' });
  });
  test('objetos aninhados de funções (RPC) e valores que já são texto', () => {
    expect(normalizarDecimais({ ok: true, categorias: [{ previsto: 10.5, meses: [{ mes: 1, valor: 3 }] }], valor: '16.21' }))
      .toEqual({ ok: true, categorias: [{ previsto: '10.50', meses: [{ mes: 1, valor: '3.00' }] }], valor: '16.21' });
  });
  test('nulos e não-objetos passam direto', () => {
    expect(normalizarDecimais(null)).toBeNull();
    expect(normalizarDecimais(5)).toBe(5);
    expect(normalizarDecimais({ valor: null })).toEqual({ valor: null });
  });
});
