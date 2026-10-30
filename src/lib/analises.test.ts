import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { benford, cent, concentracao, custos, duplicidades, foraDoPadrao, funis, inadimplencia, prever, qualidade, type DadosAnalise, type Realizado } from './analises';

const base = (extra: Partial<DadosAnalise> = {}): DadosAnalise => ({
  hoje: '2026-10-15', inicio: '2025-10-01', saldo: '1000.00', previstas: [], recorrencias: [], parcelas: [],
  mensalidades: { abertas_futuras: [], pagas_12m: 0, vencidas_abertas: [] }, realizados: [], captacao: {}, verbas: [],
  atletas_ativos: 0, treinos: { n: 0, presencas: 0 }, viagens: [], tarefas: null, ...extra,
});
let n = 0;
const r = (valor: string, extra: Partial<Realizado> = {}): Realizado => ({ id: `r${n++}`, data: '2026-09-10', tipo: 'saida', valor, categoria: 'Transporte',
  fonte: 'Transporte', contraparte_id: null, descricao: `Gasto ${n}`, comprovante: true, atraso_dias: 0, ...extra });

describe('previsão de caixa', () => {
  test('vencidas entram no mês atual; recorrência mensal; verba pesada pela situação; fôlego', () => {
    const d = base({
      previstas: [{ data: '2026-09-01', tipo: 'saida', valor: '300.00', categoria: 'Aluguel' }, { data: '2026-11-20', tipo: 'entrada', valor: '100.00', categoria: 'Doações' }],
      recorrencias: [{ tipo: 'saida', valor: '400.00', dia: 20, inicio: '2026-01-01', fim: null, descricao: 'Aluguel da quadra' }],
      parcelas: [{ data: '2026-12-10', valor: '1000.00', situacao: 'em_analise', verba: 'Edital' }],
    });
    const p = prever(d, 4);
    expect(p.meses.map((m) => m.mes)).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
    expect(p.meses[0]).toMatchObject({ saidas: 70000, saldo: 30000 }); // 300 vencida + 400 aluguel do dia 20
    expect(p.meses[1]).toMatchObject({ entradasCertas: 10000, saidas: 40000, saldo: 0 });
    expect(p.meses[2]).toMatchObject({ entradasProvaveis: 40000, saldo: 0 }); // 1000 × 40%
    expect(p.folego).toBe(3);
    expect(p.atrasadasPagar).toBe(30000);
  });
  test('cenários: atrasar verba, gasto extra e cortar recorrência', () => {
    const d = base({ parcelas: [{ data: '2026-11-10', valor: '1000.00', situacao: 'formalizado', verba: 'Patrocínio' }],
      recorrencias: [{ tipo: 'saida', valor: '100.00', dia: 25, inicio: '2026-01-01', fim: null, descricao: 'Internet' }] });
    const semCenario = prever(d, 6);
    const com = prever(d, 6, [{ id: 'a', tipo: 'atrasar_verba', rotulo: '', mes: '2026-11', verba: 'Patrocínio', meses: 3 },
      { id: 'b', tipo: 'gasto_extra', rotulo: '', mes: '2026-12', valor: '500.00' }, { id: 'c', tipo: 'cortar_recorrente', rotulo: '', mes: '2027-01', descricao: 'Internet' }]);
    expect(semCenario.meses[1]!.entradasProvaveis).toBe(95000);
    expect(com.meses[1]!.entradasProvaveis).toBe(0);
    expect(com.meses[4]!.entradasProvaveis).toBe(95000); // fev/2027
    expect(com.meses[2]!.saidas).toBe(60000);
    expect(com.meses[3]!.saidas).toBe(0);
  });
  test('soma do fluxo bate com o saldo final para qualquer dado', () => {
    const val = fc.integer({ min: 1, max: 10_000_00 }).map((c) => (c / 100).toFixed(2));
    const dia = fc.integer({ min: 0, max: 400 }).map((k) => new Date(Date.UTC(2026, 6, 1) + k * 86_400_000).toISOString().slice(0, 10));
    fc.assert(fc.property(fc.array(fc.record({ data: dia, tipo: fc.constantFrom('entrada' as const, 'saida' as const), valor: val, categoria: fc.constant('X') }), { maxLength: 30 }), (previstas) => {
      const p = prever(base({ previstas }), 12);
      const fluxo = p.meses.reduce((s, m) => s + m.entradasCertas + m.entradasProvaveis - m.saidas, 0);
      expect(p.meses.at(-1)!.saldo).toBe(cent('1000.00') + fluxo);
      for (const m of p.meses) expect(Number.isInteger(m.saldo)).toBe(true);
    }), { numRuns: 300 });
  });
});

describe('análises', () => {
  test('concentração: uma fonte com 41% dá alerta moderado; uma só fonte dá alto', () => {
    const c = concentracao([r('4100.00', { tipo: 'entrada', fonte: 'Empresa A' }), r('3000.00', { tipo: 'entrada', fonte: 'B' }), r('2900.00', { tipo: 'entrada', fonte: 'C' })]);
    expect(c.fontes[0]).toMatchObject({ fonte: 'Empresa A', parte: 0.41 });
    expect(c.nivel).toBe('alto');
    expect(concentracao(Array.from({ length: 10 }, (_, i) => r('100.00', { tipo: 'entrada', fonte: `F${i}` }))).nivel).toBe('baixo');
  });
  test('fora do padrão: só o valor muito acima da mediana da categoria', () => {
    const lista = ['50.00', '55.00', '60.00', '52.00', '58.00', '54.00', '900.00'].map((v) => r(v));
    expect(foraDoPadrao(lista).map((x) => x.valor)).toEqual(['900.00']);
    expect(foraDoPadrao(lista.slice(0, 5))).toEqual([]); // poucos dados: não acusa
  });
  test('duplicidades: mesmo valor e descrição em até 3 dias', () => {
    const a = r('89.90', { descricao: 'Bolas de treino', data: '2026-09-01' }), b = r('89.90', { descricao: 'bolas  de TREINO', data: '2026-09-03' });
    const c = r('89.90', { descricao: 'Bolas de treino', data: '2026-09-10' });
    expect(duplicidades([a, b, c])).toEqual([[a, b]]);
  });
  test('qualidade, Benford, custos, inadimplência e funis', () => {
    expect(qualidade([r('1.00', { comprovante: false }), r('2.00'), r('3.00', { tipo: 'entrada', atraso_dias: 10 })])).toMatchObject({ comComprovante: 0.5, semComprovante: 1 });
    expect(benford([r('1.00')])).toBeNull();
    const muitos = Array.from({ length: 900 }, (_, i) => r((10 ** (1 + (i / 900) * 3)).toFixed(2)));
    expect(benford(muitos)!.conforme).toBe(true);
    const d = base({ atletas_ativos: 10, treinos: { n: 4, presencas: 30 }, realizados: [r('1200.00'), r('800.00')],
      viagens: [{ titulo: 'V', km: 200, atletas: 8, custo: '1600.00' }], inicio: '2026-09-01',
      mensalidades: { abertas_futuras: [], pagas_12m: 9, vencidas_abertas: [{ dias: 45, valor: '50.00' }] },
      captacao: { prospeccao: { n: 4, valor: '0' }, fechado: { n: 1, valor: '500.00' } },
      verbas: [{ situacao: 'aprovado', pedido: '1000', aprovado: '800', recebido: '0' }, { situacao: 'negado', pedido: '500', aprovado: '0', recebido: '0' }] });
    expect(custos(d)).toMatchObject({ porAtletaMes: 10000, porTreino: 50000, presencaMedia: 7.5, porKm: 800, porAtletaViagem: 20000 });
    expect(inadimplencia(d)).toMatchObject({ taxa: 0.1, total: 5000 });
    expect(inadimplencia(d).faixas[1]!.valor).toBe(5000);
    expect(funis(d).verbas).toMatchObject({ pedido: 150000, aprovado: 80000, taxaAprovacao: 0.5 });
  });
});

test('relatório mensal: números do mês passado e alertas em linguagem simples', async () => {
  const { conteudoRelatorio } = await import('./relatorio-mensal');
  const c = conteudoRelatorio(base({ inicio: '2026-09-01', saldo: '100.00',
    realizados: [r('500.00', { data: '2026-09-05', comprovante: false }), r('800.00', { tipo: 'entrada', fonte: 'Empresa A', data: '2026-09-02' })],
    previstas: [{ data: '2026-11-01', tipo: 'saida', valor: '900.00', categoria: 'Aluguel' }] }));
  expect(c.titulo).toBe('Relatório para a diretoria — setembro de 2026');
  expect(c.numeros.find((n) => n[0] === 'Resultado do período')![1]).toBe('R$ 300,00');
  expect(c.alertas.join(' ')).toMatch(/negativo em novembro de 2026/);
  expect(c.alertas.join(' ')).toMatch(/Empresa A responde por 100%/);
  expect(c.alertas.join(' ')).toMatch(/1 saída\(s\) do período sem comprovante/);
  const ano = conteudoRelatorio(base({ inicio: '2026-09-01', realizados: [r('500.00', { data: '2026-09-05' }), r('100.00', { data: '2026-10-02' })] }), 'ano');
  expect(ano.titulo).toBe('Relatório para a assembleia — 2026 (até hoje)');
  expect(ano.numeros.find((n) => n[0] === 'Saídas do período')![1]).toBe('R$ 600,00');
});
