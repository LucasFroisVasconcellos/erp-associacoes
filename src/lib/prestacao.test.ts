import { describe, expect, test } from 'vitest';
import type { DadosPrestacao } from '@/dados/tipos';
import { csvPagamentos, csvRubricas, mascararDocumento, nomeArquivo, resumoPrestacao } from './prestacao';

const dados = {
  gerado_em: '2026-10-22T12:00:00Z',
  projeto: { nome: 'Cadeiras / Viagens: 2026!', rubricas: [{ id: 'r', nome: 'Transporte', previsto: '20000.00', realizado: '16300.00', pct: 81.5, ativa: true, alerta: null }] },
  verba: null,
  pagamentos: [
    { data: '2026-07-01', tipo: 'entrada', valor: '30000.00', descricao: 'Repasse', favorecido: 'Governo', documento: '12345678000190', forma_pagamento: 'transferencia', conta: 'Conta', rubrica: null, comprovante: true, sem_comprovante_motivo: null },
    { data: '2026-08-01', tipo: 'saida', valor: '8400.00', descricao: '=HYPERLINK("http://x")', favorecido: 'Pessoa', documento: '12345678901', forma_pagamento: 'pix', conta: 'Conta', rubrica: 'Transporte', comprovante: false, sem_comprovante_motivo: null },
  ],
  atividades: [],
} as unknown as DadosPrestacao;

describe('prestação de contas', () => {
  test('resumo: receitas, despesas, saldo e despesas sem comprovante', () => {
    expect(resumoPrestacao(dados)).toEqual({ receitas: '30000.00', despesas: '8400.00', saldo: '21600.00', semComprovante: 1 });
  });
  test('CPF mascarado no relatório; CNPJ completo (é público)', () => {
    expect(mascararDocumento('12345678901')).toBe('***.456.789-**');
    expect(mascararDocumento('12345678000190')).toBe('12.345.678/0001-90');
    expect(mascararDocumento(null)).toBe('');
  });
  test('CSV neutraliza fórmula vinda de descrição e não expõe o CPF inteiro', () => {
    const csv = csvPagamentos(dados);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toContain('12345678901');
    expect(csv.split('\r\n')[0]).toContain('Favorecido ou pagador');
    expect(csvRubricas(dados)).toContain('Transporte;20000,00;16300,00;81,5;3700,00');
  });
  test('nome de arquivo só com letras, números e hífen', () => {
    expect(nomeArquivo('Cadeiras / Viagens: 2026!', 'prestacao', 'pdf')).toMatch(/^erp-cadeiras-viagens-2026-prestacao-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(nomeArquivo('../../', 'x', 'csv')).toMatch(/^erp-projeto-x-/);
  });
});
