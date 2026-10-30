import { expect, test } from 'vitest';
import { fracaoDoAno, situacao, totais } from './orcamento';

test('fração do ano', () => {
  expect(fracaoDoAno(2025, '2026-07-02')).toBe(1);
  expect(fracaoDoAno(2027, '2026-07-02')).toBe(0);
  expect(fracaoDoAno(2026, '2026-07-02')).toBeCloseTo(0.5, 1);
});
test('situação de despesa e receita', () => {
  const s = (tipo: 'entrada' | 'saida', previsto: string, realizado: string, f = 0.5) => situacao({ tipo, previsto, realizado }, f);
  expect(s('saida', '0', '10.00')).toBe('sem_orcamento');
  expect(s('saida', '1200.00', '1300.00')).toBe('estourou');
  expect(s('saida', '1200.00', '700.00')).toBe('ritmo');   // esperado 600 → 700 é > 10% acima
  expect(s('saida', '1200.00', '620.00')).toBe('ok');
  expect(s('entrada', '1000.00', '400.00')).toBe('abaixo'); // esperado 500
  expect(s('entrada', '1000.00', '480.00')).toBe('ok');
  expect(s('entrada', '1000.00', '0.00', 0)).toBe('ok');    // ano que ainda não começou
});
test('totais por tipo em centavos', () => {
  const l = (tipo: 'entrada' | 'saida', previsto: string, realizado: string) => ({ id: tipo + previsto, nome: 'x', tipo, previsto, realizado, a_realizar: '0', por_mes: [] });
  expect(totais([l('saida', '100.10', '50.05'), l('saida', '0.20', '0'), l('entrada', '999', '1')], 'saida')).toEqual({ previsto: 10030, realizado: 5005, aRealizar: 0 });
});
