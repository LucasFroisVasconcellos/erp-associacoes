import { expect, test } from 'vitest';
import { estadoValidade, formatarTelefone, idade, menorDeIdade, ultimasCompetencias } from './comum';

test('idade conta o aniversário do ano', () => {
  expect(idade('2010-10-22', '2026-10-21')).toBe(15);
  expect(idade('2010-10-22', '2026-10-22')).toBe(16);
  expect(idade('2008-02-29', '2026-02-28')).toBe(17);
  expect(idade(null)).toBeNull();
});

test('menor de idade', () => {
  expect(menorDeIdade(null)).toBe(false);
  expect(menorDeIdade('1990-01-01')).toBe(false);
});

test('validade: vencido, vence em 30 dias, em dia', () => {
  expect(estadoValidade('2026-10-21', '2026-10-22')).toBe('vencido');
  expect(estadoValidade('2026-11-21', '2026-10-22')).toBe('vence');
  expect(estadoValidade('2026-11-22', '2026-10-22')).toBe('ok');
  expect(estadoValidade(null)).toBeNull();
});

test('competências viram o ano', () => {
  expect(ultimasCompetencias(3, '2026-02-15')).toEqual(['2026-02-01', '2026-01-01', '2025-12-01']);
});

test('telefone formatado', () => {
  expect(formatarTelefone('16900000001')).toBe('(16) 90000-0001');
  expect(formatarTelefone('+551633330000')).toBe('(16) 3333-0000');
  expect(formatarTelefone('123')).toBe('123');
});
