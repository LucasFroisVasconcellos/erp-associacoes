import fc from 'fast-check';
import { describe, expect, it, test } from 'vitest';
import { formatarBRL, lerValorBRL, mascararValor, paraCampo, somar } from './dinheiro';

describe('lerValorBRL (o que a pessoa digita → texto "1234.56" para o servidor)', () => {
  test.each([
    ['1.234,56', '1234.56'], ['1234,56', '1234.56'], ['R$ 10', '10.00'], ['10,5', '10.50'], ['0,99', '0.99'],
    ['  R$ 1.000.000,00 ', '1000000.00'], ['50', '50.00'], ['1234.56', '1234.56'],
  ])('%s → %s', (entrada, saida) => expect(lerValorBRL(entrada)).toBe(saida));

  test.each(['', '-5', '0', '0,00', 'abc', '1,234', '10,123', '1.23.4,5', '1e3', '10000000,01', 'NaN', '5 5'])(
    'rejeita %s', (entrada) => expect(lerValorBRL(entrada)).toBeNull());

  test('nunca devolve formato fora de ^\\d{1,8}\\.\\d{2}$ (fuzzing)', () => {
    fc.assert(fc.property(fc.string(), (s) => {
      const r = lerValorBRL(s);
      return r === null || /^\d{1,8}\.\d{2}$/.test(r);
    }), { numRuns: 2000 });
  });

  test('ida e volta: centavos inteiros sobrevivem à formatação e leitura', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 1_000_000_000 }), (centavos) => {
      const txt = (centavos / 100).toFixed(2);
      return lerValorBRL(formatarBRL(txt)) === txt;
    }), { numRuns: 500 });
  });
});

describe('formatarBRL e somar', () => {
  test('formata no padrão brasileiro', () => {
    expect(formatarBRL('1234.5')).toBe('R$ 1.234,50');
    expect(formatarBRL('-30')).toBe('-R$ 30,00');
    expect(formatarBRL(null)).toBe('—');
  });
  test('soma sem erro de ponto flutuante', () => {
    expect(somar(['0.10', '0.20'])).toBe('0.30');
    expect(somar(['100.00', '-30.00', '0.01'])).toBe('70.01');
  });
});

describe('mascararValor (teclado numérico, sem vírgula)', () => {
  it.each([
    ['', ''], ['5', '0,05'], ['12530', '125,30'], ['0001', '0,01'], ['123456789', '1.234.567,89'],
    ['R$ 1.234,56', '1.234,56'], ['125.3', '12,53'], ['abc', ''], ['-50', '0,50'], ['99999999999999', '9.999.999,99'],
  ])('%s → %s', (e, s) => expect(mascararValor(e)).toBe(s));
  it('apagar o último dígito volta uma casa', () => expect(mascararValor('125,3')).toBe('12,53'));
  it('todo resultado da máscara é lido pelo servidor', () => {
    for (const t of ['1', '10', '999', '12345', '1234567890']) expect(lerValorBRL(mascararValor(t))).not.toBeNull();
  });
  it('paraCampo deixa o valor do servidor pronto para a máscara', () => {
    expect(paraCampo('12.3')).toBe('12,30');
    expect(paraCampo('1234.5')).toBe('1.234,50');
    expect(paraCampo(null)).toBe('');
    expect(mascararValor(paraCampo('12.3') + '4')).toBe('123,04');
  });
});

// Regressão: o PostgREST devolve numeric como número no JSON, e a tela quebrava com "e.trim is not a function".
describe('valores que chegam do banco como número', () => {
  test('formata, preenche o campo e soma igual ao texto', () => {
    expect(formatarBRL(1621)).toBe('R$ 1.621,00');
    expect(formatarBRL(16.21)).toBe('R$ 16,21');
    expect(formatarBRL(-30)).toBe('-R$ 30,00');
    expect(paraCampo(1621)).toBe('1.621,00');
    expect(somar([16.21, '0.79', 1])).toBe('18.00');
  });
  test('número inválido não vira valor', () => {
    expect(() => formatarBRL(Number.NaN)).toThrow();
  });
});
