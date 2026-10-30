import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { lerLinhasExtrato } from './extrato-pdf';
import { idDoConteudo, lerBalancete, lerPlanoContas, montarLancamentos, payloadLancamentos } from './importar';

const HOJE = '2026-10-27';
const cad = {
  categorias: [{ id: 'c-s', nome: 'Material esportivo', tipo: 'saida' as const }, { id: 'c-e', nome: 'Doações', tipo: 'entrada' as const }],
  contas: [{ id: 'cc', nome: 'Conta Movimento' }, { id: 'cx', nome: 'Caixinha' }], contaPadrao: 'cc', hoje: HOJE,
};

describe('lançamentos antigos (planilha)', () => {
  test('acha o cabeçalho, entende vírgula, sinal, entrada/saída e categoria sem acento', () => {
    const t = [['Planilha da tesouraria 2025'], ['Data', 'Histórico', 'Valor', 'Categoria', 'Conta'],
      ['05/03/2025', 'Bolas de treino', '-1.234,50', 'material esportivo', ''],
      ['06/03/2025', 'Doação Maria', '200,00', 'Doacoes', 'caixinha'],
      ['', 'Saldo do mês', '999,00', '', ''],
      ['07/03/2026', 'Sem categoria', '-10,00', '', 'Banco X']];
    const r = montarLancamentos(t, cad)!;
    expect(r.ignoradas).toBe(1);
    expect(r.itens[0]).toMatchObject({ linha: 3, data: '2025-03-05', valor: '1234.50', tipo: 'saida', categoria_id: 'c-s', conta_id: 'cc', problemas: [] });
    expect(r.itens[1]).toMatchObject({ tipo: 'entrada', categoria_id: 'c-e', conta_id: 'cx' });
    expect(r.itens[2]!.problemas).toEqual(['conta "Banco X" não cadastrada']);
    expect(r.itens[2]!.categoria_id).toBeNull();
  });
  test('colunas separadas de entrada e saída; data no futuro é problema', () => {
    const t = [['Data', 'Descrição', 'Entrada', 'Saída'], ['2025-01-02', 'Patrocínio', '500,00', ''], ['2099-01-01', 'Gasto', '', '30,00']];
    const r = montarLancamentos(t, cad)!;
    expect(r.itens.map((i) => [i.tipo, i.valor])).toEqual([['entrada', '500.00'], ['saida', '30.00']]);
    expect(r.itens[1]!.problemas).toContain('data no futuro');
  });
  test('sem colunas reconhecíveis devolve null', () => expect(montarLancamentos([['a', 'b'], ['1', '2']], cad)).toBeNull());
  test('ids fixos: mesmo conteúdo dá o mesmo id; linhas iguais no mesmo arquivo ficam diferentes', async () => {
    const t = [['Data', 'Descrição', 'Valor', 'Categoria'], ['05/03/2025', 'Tarifa', '-5,00', 'Material esportivo'], ['05/03/2025', 'Tarifa', '-5,00', 'Material esportivo']];
    const a = await payloadLancamentos(montarLancamentos(t, cad)!.itens);
    const b = await payloadLancamentos(montarLancamentos(t, cad)!.itens);
    expect(a).toHaveLength(2);
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
    expect(a[0]!.id).not.toBe(a[1]!.id);
    expect(String(a[0]!.id)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  test('nunca quebra com lixo', () => {
    fc.assert(fc.property(fc.array(fc.array(fc.string(), { maxLength: 6 }), { maxLength: 20 }), (t) => {
      const r = montarLancamentos([['Data', 'Descrição', 'Valor'], ...t], cad);
      for (const i of r?.itens ?? []) if (i.valor) expect(i.valor).toMatch(/^\d{1,9}\.\d{2}$/);
    }), { numRuns: 300 });
  });
  test('idDoConteudo é estável', async () => expect(await idDoConteudo('a', 'b')).toBe(await idDoConteudo('a', 'b')));
});

describe('plano de contas e balancete do contador', () => {
  test('plano: natureza pelo nome, pela coluna ou pelo primeiro dígito; códigos ruins ficam de fora', () => {
    const r = lerPlanoContas([['Código', 'Descrição'], ['1.1.01', 'Caixa'], ['3.1.01', 'Doações de pessoas físicas'], ['4.2', 'Material esportivo'],
      ['x.1', 'Inválida'], ['2.3', 'Patrimônio social'], ['1.1.01', 'Repetida']])!;
    expect(r.contas).toEqual([
      { codigo: '1.1.01', nome: 'Caixa', natureza: 'ativo' }, { codigo: '3.1.01', nome: 'Doações de pessoas físicas', natureza: 'receita' },
      { codigo: '4.2', nome: 'Material esportivo', natureza: 'despesa' }, { codigo: '2.3', nome: 'Patrimônio social', natureza: 'patrimonio' }]);
    expect(r.ignoradas).toBe(2);
  });
  test('balancete: débito e crédito sem sinal; saldo com D/C', () => {
    const r = lerBalancete([['Conta', 'Nome', 'Saldo anterior', 'Débito', 'Crédito', 'Saldo atual'],
      ['3.1.01', 'Doações', '1.000,00C', '0,00', '800,00', '1.800,00C'], ['4.1.02', 'Material', '50,00D', '102,80', '', '152,80D']])!;
    expect(r.linhas).toEqual([
      { codigo: '3.1.01', nome: 'Doações', saldo_anterior: '1000.00', debito: '0.00', credito: '800.00', saldo_atual: '1800.00' },
      { codigo: '4.1.02', nome: 'Material', saldo_anterior: '-50.00', debito: '102.80', credito: '0.00', saldo_atual: '-152.80' }]);
  });
});

describe('extrato em PDF (linhas de texto)', () => {
  test('data com e sem ano, valor com sinal ou D/C, saldo do dia ignorado', () => {
    const r = lerLinhasExtrato(['EXTRATO DE CONTA CORRENTE - OUTUBRO 2026', 'Data Histórico Valor Saldo', '01/10 SALDO ANTERIOR 1.000,00',
      '02/10 PIX RECEBIDO JOAO 150,00 C 1.150,00', '03/10/2026 TARIFA PACOTE -12,90 1.137,10', '05/10 PAGTO BOLETO LOJA 89,90 D', 'linha qualquer'], 2025);
    expect(r.linhas).toEqual([
      { data: '2026-10-02', valor: '150.00', descricao: 'PIX RECEBIDO JOAO' },
      { data: '2026-10-03', valor: '-12.90', descricao: 'TARIFA PACOTE' },
      { data: '2026-10-05', valor: '-89.90', descricao: 'PAGTO BOLETO LOJA' }]);
  });
  test('nunca quebra com lixo', () => {
    fc.assert(fc.property(fc.array(fc.string(), { maxLength: 30 }), (l) => {
      for (const x of lerLinhasExtrato(l, 2026).linhas) { expect(x.valor).toMatch(/^-?\d+\.\d{2}$/); expect(x.descricao.length).toBeLessThanOrEqual(200); }
    }), { numRuns: 300 });
  });
});
