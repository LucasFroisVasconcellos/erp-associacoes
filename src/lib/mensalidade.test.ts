import { describe, expect, test } from 'vitest';
import { anoParcelaAberta, fimFevereiro, formatarPercentual, proximoVencimento, salarioMinimoPara, valorDaCategoria, valorParcelaUnica } from './mensalidade';

const SM = [{ vigente_desde: '2025-01-01', valor: '1518.00' }, { vigente_desde: '2026-01-01', valor: '1621.00' }];

describe('mensalidade em porcentagem do salário mínimo', () => {
  test('regra dos 45 dias (mesma do servidor)', () => {
    expect(salarioMinimoPara(SM, '2026-02-10')).toBe('1518.00');
    expect(salarioMinimoPara(SM, '2026-02-15')).toBe('1621.00');
    expect(salarioMinimoPara(SM, '2025-01-10')).toBeNull();
  });
  test('1% de R$ 1.621 = R$ 16,21; valor fixo não muda; sem mínimo = null', () => {
    expect(valorDaCategoria({ valor_mensalidade: '0', percentual_salario_minimo: '1.00' }, SM, '2026-03-10')).toBe('16.21');
    expect(valorDaCategoria({ valor_mensalidade: '0', percentual_salario_minimo: '1.50' }, SM, '2026-03-10')).toBe('24.32');
    expect(valorDaCategoria({ valor_mensalidade: '30.00', percentual_salario_minimo: null }, SM, '2026-03-10')).toBe('30.00');
    expect(valorDaCategoria({ valor_mensalidade: '0', percentual_salario_minimo: '1.00' }, [], '2026-03-10')).toBeNull();
  });
  test('próximo vencimento e percentual', () => {
    expect(proximoVencimento('2026-10-28', 10)).toBe('2026-11-10');
    expect(proximoVencimento('2026-12-28', 10)).toBe('2027-01-10');
    expect(proximoVencimento('2026-10-05', 10)).toBe('2026-10-10');
    expect(formatarPercentual('1.00')).toBe('1%');
    expect(formatarPercentual('1.5')).toBe('1,5%');
  });
});

describe('parcela única', () => {
  test('10% de R$ 1.621 = R$ 162,10; sem percentual = null', () => {
    expect(valorParcelaUnica({ percentual_parcela_unica: '10.00' }, SM, 2026)).toBe('162.10');
    expect(valorParcelaUnica({ percentual_parcela_unica: null }, SM, 2026)).toBeNull();
  });
  test('prazo até o fim de fevereiro (ano bissexto) e janela dez–fev', () => {
    expect(fimFevereiro(2028)).toBe('2028-02-29');
    expect(fimFevereiro(2027)).toBe('2027-02-28');
    expect(anoParcelaAberta('2026-12-05')).toBe(2027);
    expect(anoParcelaAberta('2027-02-28')).toBe(2027);
    expect(anoParcelaAberta('2026-10-28')).toBeNull();
  });
});
