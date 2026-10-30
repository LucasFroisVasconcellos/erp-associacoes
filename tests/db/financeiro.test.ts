import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco;
let pres: string, tes: string, dir: string, dir2: string;
let contaMov: string, contaProj: string, catSaida: string, catEntrada: string, hoje: string, mesPassado: string;

const lanc = (extra: Record<string, unknown> = {}) => ({
  id: randomUUID(), tipo: 'saida', situacao: 'realizada', valor: '50.00', data: hoje,
  descricao: 'Almoço na viagem', categoria_id: catSaida, conta_id: contaMov, forma_pagamento: 'pix', ...extra,
});
const criar = (quem: string, p: Record<string, unknown>) => db.rpc('criar_lancamento', { p }, sessao(quem));
const conta = (sql: string, ctx?: Parameters<Banco['valor']>[1], params?: unknown[]) =>
  db.valor<number>(`select count(*)::int from (${sql}) t`, ctx, params);
const data = (expr: string) => db.valor<string>(`select to_char(${expr}, 'YYYY-MM-DD')`);

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  await convidarMembro(db, pres, { email: 'vice@exemplo.test', nome: 'Vice', cargo: 'vice_presidente' });
  tes = await convidarMembro(db, pres, { email: 'tes@exemplo.test', nome: 'Tesoureira', cargo: 'tesoureiro' });
  dir = await convidarMembro(db, pres, { email: 'dir@exemplo.test', nome: 'Diretor', cargo: 'diretor' });
  dir2 = await convidarMembro(db, pres, { email: 'dir2@exemplo.test', nome: 'Diretora Dois', cargo: 'diretor', permissoes: [
    { modulo: 'financeiro', acao: 'ver', alcance: 'proprios' }, { modulo: 'financeiro', acao: 'criar', alcance: 'tudo' }] });
  hoje = await data('private.hoje()');
  mesPassado = await data(`(date_trunc('month', private.hoje()) - interval '1 month')`);
});
afterAll(async () => { await db?.destruir(); });

describe('cadastros', () => {
  test('diretor não cadastra conta bancária; tesoureira cadastra', async () => {
    const p = { id: randomUUID(), nome: 'Conta Movimento', banco: 'Banco Exemplo', tipo: 'movimento', saldo_inicial: '1000.00', data_saldo_inicial: '2026-01-01' };
    expect((await db.rpc('salvar_conta', { p }, sessao(dir))).erro).toBe('sem_permissao');
    expect((await db.rpc('salvar_conta', { p }, sessao(tes))).ok).toBe(true);
    contaMov = p.id;
    contaProj = randomUUID();
    expect((await db.rpc('salvar_conta', { p: { id: contaProj, nome: 'Conta do Projeto', tipo: 'projeto', saldo_inicial: '0', data_saldo_inicial: '2026-01-01' } }, sessao(tes))).ok).toBe(true);
  });

  test('salvar de novo com o mesmo id atualiza, sem duplicar', async () => {
    expect((await db.rpc('salvar_conta', { p: { id: contaMov, nome: 'Conta Movimento Principal', banco: 'Banco Exemplo', tipo: 'movimento', saldo_inicial: '1000.00', data_saldo_inicial: '2026-01-01' } }, sessao(tes))).ok).toBe(true);
    expect(await conta(`select * from public.contas_bancarias where nome like 'Conta Movimento%'`)).toBe(1);
  });

  test('cadastro rejeita campos extras e tipos inválidos', async () => {
    const s = sessao(tes);
    const base = { nome: 'Conta X', tipo: 'movimento', saldo_inicial: '0', data_saldo_inicial: '2026-01-01' };
    expect((await db.rpc('salvar_conta', { p: { ...base, id: randomUUID(), criado_por: dir } }, s)).erro).toBe('invalido');
    expect((await db.rpc('salvar_conta', { p: { ...base, id: randomUUID(), tipo: 'cofre' } }, s)).campo).toBe('tipo');
    expect((await db.rpc('salvar_conta', { p: { ...base, id: 'nao-e-uuid' } }, s)).campo).toBe('id');
    expect((await db.rpc('salvar_conta', { p: { ...base, id: randomUUID(), saldo_inicial: '1,5' } }, s)).campo).toBe('saldo_inicial');
    expect((await db.rpc('salvar_conta', { p: '"texto"' }, s)).erro).toBe('invalido'); // JSON que não é objeto
  });

  test('categorias por tipo, sem duplicar nome', async () => {
    const s = sessao(tes);
    catSaida = randomUUID(); catEntrada = randomUUID();
    expect((await db.rpc('salvar_categoria', { p: { id: catSaida, nome: 'Alimentação', tipo: 'saida' } }, s)).ok).toBe(true);
    expect((await db.rpc('salvar_categoria', { p: { id: catEntrada, nome: 'Doações', tipo: 'entrada' } }, s)).ok).toBe(true);
    expect((await db.rpc('salvar_categoria', { p: { id: randomUUID(), nome: 'alimentação', tipo: 'saida' } }, s)).erro).toBe('duplicado');
  });

  test('diretor cadastra fornecedor; documento só com dígitos válidos', async () => {
    expect((await db.rpc('salvar_contraparte', { p: { id: randomUUID(), nome: 'Posto Central', tipo: 'fornecedor', documento: '12345678000190' } }, sessao(dir))).ok).toBe(true);
    expect((await db.rpc('salvar_contraparte', { p: { id: randomUUID(), nome: 'Posto Z', tipo: 'fornecedor', documento: '12.345' } }, sessao(dir))).campo).toBe('documento');
  });
});

describe('lançamentos', () => {
  test('lançamento é idempotente: repetir o mesmo id não duplica', async () => {
    const p = lanc();
    expect((await criar(dir, p)).ok).toBe(true);
    const r2 = await criar(dir, p);
    expect(r2.ok).toBe(true);
    expect(r2.repetido).toBe(true);
    expect(await conta('select * from public.lancamentos where id = $1', 'postgres', [p.id])).toBe(1);
    expect((await criar(tes, p)).erro).toBe('conflito');
  });

  test('cliques duplos simultâneos criam um único lançamento', async () => {
    const p = lanc({ descricao: 'Clique duplo' });
    const rs = await Promise.all([1, 2, 3, 4].map(() => criar(dir, p)));
    expect(rs.every((r: any) => r.ok)).toBe(true);
    expect(await conta('select * from public.lancamentos where id = $1', 'postgres', [p.id])).toBe(1);
  });

  test('valores inválidos são rejeitados no servidor', async () => {
    for (const valor of ['0', '-5', '10.123', '1e3', '10000000.01', 'abc', '', ' 5', 5.5, null]) {
      const r = await criar(dir, lanc({ valor }));
      expect(r.erro, String(valor)).toBe('invalido');
      expect(r.campo, String(valor)).toBe('valor');
    }
    expect((await criar(dir, lanc({ valor: '10000000.00' }))).ok).toBe(true);
  });

  test('datas, categoria, campos extras e textos são validados', async () => {
    const amanha = await data('private.hoje() + 1');
    expect((await criar(dir, lanc({ data: amanha }))).campo).toBe('data');
    expect((await criar(dir, lanc({ data: '2025-12-31' }))).campo).toBe('data');
    expect((await criar(dir, lanc({ data: '2026-02-30' }))).campo).toBe('data');
    expect((await criar(dir, lanc({ categoria_id: catEntrada }))).campo).toBe('categoria_id');
    expect((await criar(dir, lanc({ categoria_id: randomUUID() }))).campo).toBe('categoria_id');
    expect((await criar(dir, lanc({ criado_por: tes }))).erro).toBe('invalido');
    expect((await criar(dir, lanc({ descricao: 'x'.repeat(201) }))).campo).toBe('descricao');
    expect((await criar(dir, lanc({ conta_id: null }))).campo).toBe('conta_id');
    expect((await criar(dir, lanc({ forma_pagamento: 'cheque_voador' }))).campo).toBe('forma_pagamento');
    expect((await criar(dir, lanc({ tipo: 'transferencia' }))).campo).toBe('tipo');
  });

  test('alcance "só os próprios" esconde lançamentos dos outros', async () => {
    expect((await criar(dir2, lanc({ descricao: 'Lançamento da Diretora Dois' }))).ok).toBe(true);
    const vistos = await db.valor<string[]>(`select coalesce(jsonb_agg(criado_por), '[]') from public.lancamentos`, sessao(dir2));
    expect(vistos.length).toBeGreaterThanOrEqual(1);
    expect(vistos.every((c) => c === dir2)).toBe(true);
    expect(await conta('select * from public.lancamentos', sessao(dir))).toBeGreaterThan(vistos.length);
  });

  test('descrição guiada: campos do tipo de gasto são conferidos', async () => {
    const tipo = randomUUID();
    const campos = [{ chave: 'litros', rotulo: 'Litros', tipo: 'numero', obrigatorio: true },
      { chave: 'posto', rotulo: 'Posto', tipo: 'texto', obrigatorio: false }];
    expect((await db.rpc('salvar_tipo_gasto', { p: { id: tipo, nome: 'Combustível', campos } }, sessao(tes))).ok).toBe(true);
    expect((await criar(dir, lanc({ tipo_gasto_id: tipo, detalhes: { posto: 'Posto X' } }))).campo).toBe('detalhes');
    expect((await criar(dir, lanc({ tipo_gasto_id: tipo, detalhes: { litros: '40.5', cor: 'azul' } }))).campo).toBe('detalhes');
    expect((await criar(dir, lanc({ tipo_gasto_id: tipo, detalhes: { litros: 'muitos' } }))).campo).toBe('detalhes');
    expect((await criar(dir, lanc({ detalhes: { litros: '1' } }))).campo).toBe('detalhes');
    expect((await criar(dir, lanc({ tipo_gasto_id: tipo, detalhes: { litros: '40.5', posto: 'Posto X' } }))).ok).toBe(true);
    const ruim = [{ chave: 'Litros!', rotulo: 'L', tipo: 'numero', obrigatorio: true }];
    expect((await db.rpc('salvar_tipo_gasto', { p: { id: randomUUID(), nome: 'Ruim', campos: ruim } }, sessao(tes))).campo).toBe('campos');
  });

  test('modelos opcionais de tipos de gasto só entram quando pedidos, uma vez', async () => {
    const antes = await conta('select * from public.tipos_gasto');
    expect((await db.rpc('importar_modelos_tipos_gasto', {}, sessao(tes))).ok).toBe(true);
    const depois = await conta('select * from public.tipos_gasto');
    expect(depois).toBeGreaterThan(antes);
    await db.rpc('importar_modelos_tipos_gasto', {}, sessao(tes));
    expect(await conta('select * from public.tipos_gasto')).toBe(depois);
  });

  test('estorno cria lançamento inverso, sem apagar nada', async () => {
    const saldo = async () => Number((await db.rpc('painel_inicial', {}, sessao(tes))).saldo_total);
    const antes = await saldo();
    const p = lanc({ valor: '30.00' });
    await criar(dir, p);
    expect(await saldo()).toBeCloseTo(antes - 30, 2);
    expect((await db.rpc('estornar_lancamento', { p_id: p.id, p_motivo: 'Lançado em dobro' }, sessao(dir))).erro).toBe('sem_permissao');
    const r = await db.rpc('estornar_lancamento', { p_id: p.id, p_motivo: 'Lançado em dobro' }, sessao(tes));
    expect(r.ok).toBe(true);
    expect(await saldo()).toBeCloseTo(antes, 2);
    expect((await db.rpc('estornar_lancamento', { p_id: p.id, p_motivo: 'De novo' }, sessao(tes))).erro).toBe('ja_estornado');
    expect((await db.rpc('estornar_lancamento', { p_id: r.estorno_id, p_motivo: 'Estorno do estorno' }, sessao(tes))).erro).toBe('invalido');
    expect((await db.rpc('estornar_lancamento', { p_id: randomUUID(), p_motivo: 'Fantasma' }, sessao(tes))).erro).toBe('nao_encontrado');
    expect((await db.rpc('estornar_lancamento', { p_id: p.id, p_motivo: '' }, sessao(pres))).campo).toBe('motivo');
  });

  test('estornos simultâneos do mesmo lançamento geram um só estorno', async () => {
    const p = lanc({ valor: '12.00', descricao: 'Estorno concorrente' });
    await criar(dir, p);
    await Promise.all([1, 2, 3].map(() => db.rpc('estornar_lancamento', { p_id: p.id, p_motivo: 'Teste de concorrência' }, sessao(tes)).catch(() => null)));
    expect(await conta('select * from public.lancamentos where estorno_de = $1', 'postgres', [p.id])).toBe(1);
  });

  test('quem lançou corrige o próprio lançamento; outro diretor não', async () => {
    const p = lanc({ descricao: 'Pedágio errado' });
    await criar(dir, p);
    expect((await db.rpc('editar_lancamento', { p_id: p.id, p: { descricao: 'Pedágio Rodovia' } }, sessao(dir))).ok).toBe(true);
    expect((await db.rpc('editar_lancamento', { p_id: p.id, p: { descricao: 'Hackeado' } }, sessao(dir2))).erro).toBe('sem_permissao');
    expect((await db.rpc('editar_lancamento', { p_id: p.id, p: { criado_por: dir2 } }, sessao(tes))).erro).toBe('invalido');
    expect((await db.rpc('editar_lancamento', { p_id: p.id, p: { valor: '-1' } }, sessao(tes))).campo).toBe('valor');
    expect(await db.valor('select descricao from public.lancamentos where id = $1', 'postgres', [p.id])).toBe('Pedágio Rodovia');
    expect(await conta(`select * from public.auditoria where tabela = 'lancamentos' and registro_id = $1 and acao = 'alterar'`, 'postgres', [p.id])).toBeGreaterThanOrEqual(1);
  });

  test('ninguém apaga lançamento', async () => {
    const p = lanc();
    await criar(dir, p);
    expect(await db.falha('delete from public.lancamentos where id = $1', sessao(pres), [p.id])).toMatch(/permission denied/);
    expect(await db.falha('delete from public.lancamentos where id = $1', 'postgres', [p.id])).toMatch(/não se apaga/);
  });
});

describe('contas a pagar, reembolsos e recorrências', () => {
  test('conta a pagar: prevista aparece no painel e só quem aprova dá baixa', async () => {
    const venc = await data('private.hoje() + 10');
    const p = lanc({ situacao: 'prevista', data: venc, descricao: 'Aluguel da quadra', conta_id: null });
    expect((await criar(tes, p)).ok).toBe(true);
    const painel = await db.rpc('painel_inicial', {}, sessao(tes));
    expect(painel.a_pagar.some((x: any) => x.id === p.id)).toBe(true);
    const baixa = { p_id: p.id, p_data: hoje, p_conta_id: contaMov };
    expect((await db.rpc('realizar_lancamento', baixa, sessao(dir))).erro).toBe('sem_permissao');
    expect((await db.rpc('realizar_lancamento', baixa, sessao(tes))).ok).toBe(true);
    expect(await db.valor('select situacao from public.lancamentos where id = $1', 'postgres', [p.id])).toBe('realizada');
    expect((await db.rpc('realizar_lancamento', baixa, sessao(tes))).erro).toBe('invalido');
  });

  test('reembolso: pedido pelo diretor, decidido por outra pessoa', async () => {
    const p = lanc({ reembolso: true, conta_id: null, descricao: 'Combustível pago do bolso' });
    expect((await criar(dir, p)).ok).toBe(true);
    expect(await db.valor('select situacao from public.reembolsos where lancamento_id = $1', 'postgres', [p.id])).toBe('solicitado');
    const aprovar = { p_id: p.id, p_aprovar: true, p_conta_id: contaMov, p_motivo: null };
    expect((await db.rpc('decidir_reembolso', aprovar, sessao(dir))).erro).toBe('sem_permissao');
    expect((await db.rpc('decidir_reembolso', aprovar, sessao(tes))).ok).toBe(true);
    expect(await db.valor('select situacao from public.reembolsos where lancamento_id = $1', 'postgres', [p.id])).toBe('pago');
    const meu = lanc({ reembolso: true, conta_id: null, descricao: 'Material pago pela tesoureira' });
    await criar(tes, meu);
    expect((await db.rpc('decidir_reembolso', { ...aprovar, p_id: meu.id }, sessao(tes))).erro).toBe('proprio_reembolso');
    expect((await db.rpc('decidir_reembolso', { p_id: meu.id, p_aprovar: false, p_conta_id: null, p_motivo: 'Sem nota fiscal' }, sessao(pres))).ok).toBe(true);
    expect(await db.valor('select situacao from public.lancamentos where id = $1', 'postgres', [meu.id])).toBe('cancelada');
  });

  test('recorrência gera previstos uma única vez, mesmo com chamadas simultâneas', async () => {
    const r = { id: randomUUID(), tipo: 'saida', descricao: 'Internet da sede', valor: '120.00', categoria_id: catSaida, dia: 5, inicio: hoje };
    expect((await db.rpc('salvar_recorrencia', { p: r }, sessao(dir))).erro).toBe('sem_permissao');
    expect((await db.rpc('salvar_recorrencia', { p: r }, sessao(tes))).ok).toBe(true);
    const ate = await data('private.hoje() + 70');
    const rs = await Promise.all([1, 2, 3].map(() => db.rpc('gerar_previstos', { p_ate: ate }, sessao(tes))));
    const total = rs.reduce((s: number, x: any) => s + x.criados, 0);
    expect(total).toBeGreaterThanOrEqual(2);
    expect((await db.rpc('gerar_previstos', { p_ate: ate }, sessao(tes))).criados).toBe(0);
    expect(await conta('select * from public.lancamentos where recorrencia_id = $1', 'postgres', [r.id])).toBe(total);
    expect((await db.rpc('salvar_recorrencia', { p: { ...r, id: randomUUID(), dia: 31 } }, sessao(tes))).campo).toBe('dia');
  });
});

describe('fechamento e painel', () => {
  test('fechamento mensal: pendências travam, mês fechado não aceita mudanças', async () => {
    const semNota = lanc({ data: mesPassado, descricao: 'Tarifa bancária' });
    expect((await criar(tes, semNota)).ok).toBe(true);
    const ck = await db.rpc('checklist_fechamento', { p_competencia: mesPassado }, sessao(tes));
    expect(ck.pode_fechar).toBe(false);
    expect(ck.itens.find((i: any) => i.chave === 'comprovantes').pendentes).toBeGreaterThanOrEqual(1);
    const fechar = { p_competencia: mesPassado, p_confirmacoes: { extrato_conferido: true } };
    expect((await db.rpc('fechar_mes', fechar, sessao(tes))).erro).toBe('pendencias');
    const ids = await db.valor<string[]>(`select coalesce(jsonb_agg(id), '[]') from public.lancamentos
      where tipo = 'saida' and situacao = 'realizada' and date_trunc('month', data) = $1::date`, 'postgres', [mesPassado]);
    for (const id of ids) expect((await db.rpc('justificar_sem_comprovante', { p_id: id, p_motivo: 'Débito automático do banco' }, sessao(tes))).ok).toBe(true);
    expect((await db.rpc('fechar_mes', { ...fechar, p_confirmacoes: {} }, sessao(tes))).campo).toBe('extrato_conferido');
    expect((await db.rpc('fechar_mes', fechar, sessao(dir))).erro).toBe('sem_permissao');
    expect((await db.rpc('fechar_mes', fechar, sessao(tes))).ok).toBe(true);
    expect((await db.rpc('fechar_mes', fechar, sessao(tes))).erro).toBe('ja_fechado');
    expect((await criar(tes, lanc({ data: mesPassado }))).erro).toBe('mes_fechado');
    expect((await db.rpc('editar_lancamento', { p_id: semNota.id, p: { descricao: 'Mudança proibida' } }, sessao(tes))).erro).toBe('mes_fechado');
    expect((await db.rpc('estornar_lancamento', { p_id: semNota.id, p_motivo: 'Ajuste depois do fechamento' }, sessao(tes))).ok).toBe(true);
    expect(await db.falha('update public.lancamentos set valor = 1 where id = $1', 'postgres', [semNota.id])).toMatch(/mês fechado/);
    const mesAtual = await data(`date_trunc('month', private.hoje())`);
    expect((await db.rpc('fechar_mes', { ...fechar, p_competencia: mesAtual }, sessao(tes))).campo).toBe('competencia');
  });

  test('painel separa dinheiro livre e de projetos', async () => {
    const ent = lanc({ tipo: 'entrada', categoria_id: catEntrada, conta_id: contaProj, valor: '500.00', descricao: 'Repasse do projeto' });
    expect((await criar(tes, ent)).ok).toBe(true);
    const p = await db.rpc('painel_inicial', {}, sessao(tes));
    expect(p.ok).toBe(true);
    expect(Number(p.saldo_projetos)).toBe(500);
    expect(Number(p.saldo_total)).toBeCloseTo(Number(p.saldo_livre) + Number(p.saldo_projetos), 2);
    expect(Number(p.contas.find((c: any) => c.id === contaProj).saldo)).toBe(500);
  });

  test('painel com alcance "próprios" não mostra saldos da associação', async () => {
    const p = await db.rpc('painel_inicial', {}, sessao(dir2));
    expect(p.ok).toBe(true);
    expect(p.saldo_total).toBeNull();
    expect(p.contas).toEqual([]);
  });

  test('exportação exige permissão e fica registrada', async () => {
    expect((await db.rpc('dados_relatorio', { p_inicio: '2026-01-01', p_fim: hoje }, sessao(dir))).erro).toBe('sem_permissao');
    const r = await db.rpc('dados_relatorio', { p_inicio: '2026-01-01', p_fim: hoje }, sessao(tes));
    expect(r.ok).toBe(true);
    expect(r.lancamentos.length).toBeGreaterThan(0);
    expect(await conta(`select * from public.auditoria where acao = 'exportar'`)).toBeGreaterThanOrEqual(1);
    expect((await db.rpc('dados_relatorio', { p_inicio: hoje, p_fim: '2026-01-01' }, sessao(tes))).erro).toBe('invalido');
  });
});
