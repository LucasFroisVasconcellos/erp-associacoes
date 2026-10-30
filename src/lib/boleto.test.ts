import { describe, expect, test } from 'vitest';
import { lerBoleto } from './boleto';

// Exemplos gerados por uma implementação independente (Python) das regras FEBRABAN.
const BANCO_LINHA = '00191234546789012345767890123457716260000015075';
const BANCO_BARRAS = '00197162600000150751234567890123456789012345';
const ARREC_MOD10 = '826400000004899012345679890123456786901234567898';
const ARREC_MOD11 = '828000000001899012345679890123456785901234567894';

describe('lerBoleto', () => {
  test('linha digitável bancária: valor e vencimento (novo ciclo do fator, 2025)', () => {
    const r = lerBoleto(BANCO_LINHA, '2026-10-20');
    expect(r).toEqual({ ok: true, tipo: 'bancario', codigoBarras: BANCO_BARRAS, valor: '150.75', vencimento: '2026-11-10' });
  });

  test('aceita pontos, espaços e quebras como no papel', () => {
    const comMascara = '00191.23454 67890.123457 67890.123457 7 16260000015075';
    expect(lerBoleto(comMascara, '2026-10-20')).toMatchObject({ ok: true, valor: '150.75' });
  });

  test('código de barras de 44 dígitos (leitor ou câmera)', () => {
    expect(lerBoleto(BANCO_BARRAS, '2026-10-20')).toMatchObject({ ok: true, tipo: 'bancario', valor: '150.75', vencimento: '2026-11-10' });
  });

  test('conta de consumo (arrecadação) com DV módulo 10 e módulo 11', () => {
    expect(lerBoleto(ARREC_MOD10, '2026-10-20')).toMatchObject({ ok: true, tipo: 'arrecadacao', valor: '89.90', vencimento: null });
    expect(lerBoleto(ARREC_MOD11, '2026-10-20')).toMatchObject({ ok: true, tipo: 'arrecadacao', valor: '89.90' });
  });

  test('qualquer dígito trocado é detectado pelos dígitos verificadores', () => {
    for (const base of [BANCO_LINHA, BANCO_BARRAS, ARREC_MOD10, ARREC_MOD11]) {
      for (let i = 0; i < base.length; i++) {
        const d = Number(base[i]);
        const trocado = base.slice(0, i) + String((d + 1) % 10) + base.slice(i + 1);
        expect(lerBoleto(trocado, '2026-10-20').ok, `${base} posição ${i}`).toBe(false);
      }
    }
  });

  test('entradas inválidas não quebram', () => {
    for (const x of ['', 'abc', '123', '0'.repeat(46), '9'.repeat(49), '<script>', BANCO_LINHA + '1']) {
      expect(lerBoleto(x, '2026-10-20').ok).toBe(false);
    }
  });
});
