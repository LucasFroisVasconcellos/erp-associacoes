import { describe, expect, test } from 'vitest';
import { gerarCsv } from './csv';

describe('gerarCsv (abre certo no Excel brasileiro e sem injeção de fórmula)', () => {
  test('usa ponto e vírgula, BOM UTF-8 e cabeçalho', () => {
    const csv = gerarCsv([{ data: '20/10/2026', valor: '10,00' }], [{ chave: 'data', titulo: 'Data' }, { chave: 'valor', titulo: 'Valor' }]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.slice(1).split('\r\n')[0]).toBe('Data;Valor');
  });
  test('neutraliza células que começam com = + - @ tab ou CR', () => {
    const linhas = ['=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUM(A1)', '\tx', '\rx'].map((d) => ({ d }));
    const corpo = gerarCsv(linhas, [{ chave: 'd', titulo: 'D' }]).slice(1).split('\r\n').slice(1);
    for (const c of corpo) expect(c.replace(/^"/, '')).toMatch(/^'/);
  });
  test('aspas e separadores dentro do texto ficam escapados', () => {
    const csv = gerarCsv([{ d: 'Posto "Central"; BR-116' }], [{ chave: 'd', titulo: 'D' }]);
    expect(csv).toContain('"Posto ""Central""; BR-116"');
  });
});
