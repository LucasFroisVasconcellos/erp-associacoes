import { expect, test } from 'vitest';
import { nomeArquivoAta, quorumAtingido } from './ata';

test('quórum: sem mínimo sempre atinge; com mínimo conta os presentes', () => {
  expect(quorumAtingido({ quorum_minimo: null }, 0)).toBe(true);
  expect(quorumAtingido({ quorum_minimo: 3 }, 2)).toBe(false);
  expect(quorumAtingido({ quorum_minimo: 3 }, 3)).toBe(true);
});

test('nome do arquivo sem acento, barra ou caractere estranho', () => {
  expect(nomeArquivoAta({ titulo: 'Assembleia / Eleição 2026', data: '2026-10-22T22:00:00Z' })).toBe('erp-ata-assembleia-eleicao-2026-2026-10-22.pdf');
  expect(nomeArquivoAta({ titulo: '../../', data: '2026-10-22T22:00:00Z' })).toBe('erp-ata-reuniao-2026-10-22.pdf');
});
