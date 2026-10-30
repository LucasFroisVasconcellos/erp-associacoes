// CSV para Excel brasileiro. Células iniciadas por = + - @ tab ou CR ganham apóstrofo (evita injeção de fórmula).
import Papa from 'papaparse';

export interface Coluna<T> { chave: keyof T & string; titulo: string }

export function gerarCsv<T extends Record<string, unknown>>(linhas: T[], colunas: Coluna<T>[]): string {
  const dados = linhas.map((l) => colunas.map((c) => {
    const v = l[c.chave];
    return v === null || v === undefined ? '' : String(v);
  }));
  const csv = Papa.unparse({ fields: colunas.map((c) => c.titulo), data: dados }, {
    delimiter: ';', newline: '\r\n', escapeFormulae: true, quotes: false,
  });
  return '﻿' + csv;
}
