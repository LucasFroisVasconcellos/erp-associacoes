import { describe, expect, test } from 'vitest';
import { competencia, formatarData, hojeSP, mesPorExtenso } from './datas';

describe('datas no fuso de Cidade Exemplo', () => {
  test('hojeSP usa America/Sao_Paulo, não o fuso do aparelho', () => {
    // 02:30 UTC de 21/10 ainda é 20/10 em São Paulo (UTC-3)
    expect(hojeSP(new Date('2026-10-21T02:30:00Z'))).toBe('2026-10-20');
    expect(hojeSP(new Date('2026-10-21T03:30:00Z'))).toBe('2026-10-21');
  });
  test('formatarData sem deslocar o dia', () => {
    expect(formatarData('2026-01-01')).toBe('01/01/2026');
    expect(formatarData('')).toBe('—');
  });
  test('competência e mês por extenso', () => {
    expect(competencia('2026-10-20')).toBe('2026-10-01');
    expect(mesPorExtenso('2026-10-01')).toBe('outubro de 2026');
  });
});
