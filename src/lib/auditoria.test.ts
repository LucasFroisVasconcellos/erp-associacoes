import { describe, expect, test } from 'vitest';
import { csvAuditoria, nomeArquivoAuditoria, type LinhaAuditoriaExportada } from './auditoria';

const linha = (x: Partial<LinhaAuditoriaExportada>): LinhaAuditoriaExportada => ({
  id: 1, em: '2026-10-01T02:30:00Z', autor: 'Lia Demonstração', membro_id: 'm1', acao: 'inserir', tabela: 'lancamentos',
  registro_id: 'L1', antes: null, depois: { valor: '10.00' }, ...x,
});

describe('exportação da auditoria', () => {
  test('data e hora no fuso de São Paulo e nomes legíveis', () => {
    const csv = csvAuditoria([linha({})]);
    expect(csv).toContain('30/09/2026, 23:30:00'); // 02:30 UTC de 01/10
    expect(csv).toContain('Criou;lançamento;L1');
    expect(csv.startsWith('﻿')).toBe(true);
  });
  test('sem autor aparece como Sistema; ação desconhecida sai como veio', () => {
    expect(csvAuditoria([linha({ autor: null, acao: 'nova_acao' })])).toContain(';Sistema;nova_acao;');
  });
  test('conteúdo vindo do banco não vira fórmula no Excel', () => {
    const csv = csvAuditoria([linha({ registro_id: '=HYPERLINK("http://x")', autor: '+cmd' })]);
    expect(csv).not.toMatch(/;=HYPERLINK/);
    expect(csv).not.toMatch(/;\+cmd/);
  });
  test('nome do arquivo sem acento nem espaço', () => {
    expect(nomeArquivoAuditoria({ inicio: '2026-09-01', fim: '2026-09-30' }, 'csv', 'Júlia Exemplo')).toBe('erp-auditoria-2026-09-01-a-2026-09-30-julia-exemplo.csv');
    expect(nomeArquivoAuditoria({ inicio: '2026-09-01', fim: '2026-09-30' }, 'pdf')).toBe('erp-auditoria-2026-09-01-a-2026-09-30.pdf');
  });
});
