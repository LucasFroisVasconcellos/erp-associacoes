import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco;
let pres: string, tes: string, dir: string, soProjetos: string, verbaPropria: string;
let hoje: string, tipoEmenda: string, tipoPatrocinio: string, origem: string, verba: string, projeto: string;
let contaProj: string, contaLivre: string, catSaida: string, catEntrada: string, rubTransporte: string, rubUniforme: string;

const rpc = (nome: string, args: Record<string, unknown>, quem: string) => db.rpc(nome, args, sessao(quem));
const data = (expr: string) => db.valor<string>(`select to_char(${expr}, 'YYYY-MM-DD')`);
const conta = (sql: string, params?: unknown[]) => db.valor<number>(`select count(*)::int from (${sql}) t`, 'postgres', params);
const lancar = async (quem: string, extra: Record<string, unknown>) => {
  const p = { id: randomUUID(), tipo: 'saida', situacao: 'realizada', valor: '100.00', data: hoje, descricao: 'Gasto do projeto',
    categoria_id: catSaida, conta_id: contaProj, forma_pagamento: 'pix', ...extra };
  const r = await rpc('criar_lancamento', { p }, quem);
  if (!r.ok) throw new Error('lançamento falhou: ' + JSON.stringify(r));
  return p.id;
};

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  await convidarMembro(db, pres, { email: 'vice@exemplo.test', nome: 'Vice', cargo: 'vice_presidente' });
  tes = await convidarMembro(db, pres, { email: 'tes@exemplo.test', nome: 'Tesoureira', cargo: 'tesoureiro' });
  dir = await convidarMembro(db, pres, { email: 'dir@exemplo.test', nome: 'Diretor', cargo: 'diretor' });
  soProjetos = await convidarMembro(db, pres, { email: 'proj@exemplo.test', nome: 'Só Projetos', cargo: 'diretor', permissoes: [
    { modulo: 'projetos', acao: 'ver', alcance: 'tudo' }, { modulo: 'agenda', acao: 'ver', alcance: 'tudo' }] });
  verbaPropria = await convidarMembro(db, pres, { email: 'vp@exemplo.test', nome: 'Verba Própria', cargo: 'diretor', permissoes: [
    { modulo: 'verbas', acao: 'ver', alcance: 'proprios' }, { modulo: 'verbas', acao: 'criar', alcance: 'tudo' }] });
  hoje = await data('private.hoje()');
  contaProj = randomUUID(); contaLivre = randomUUID(); catSaida = randomUUID(); catEntrada = randomUUID();
  await rpc('salvar_conta', { p: { id: contaLivre, nome: 'Conta Movimento', tipo: 'movimento', saldo_inicial: '0', data_saldo_inicial: '2026-01-01' } }, tes);
  await rpc('salvar_conta', { p: { id: contaProj, nome: 'Conta da Emenda', tipo: 'projeto', saldo_inicial: '0', data_saldo_inicial: '2026-01-01' } }, tes);
  await rpc('salvar_categoria', { p: { id: catSaida, nome: 'Transporte', tipo: 'saida' } }, tes);
  await rpc('salvar_categoria', { p: { id: catEntrada, nome: 'Repasse', tipo: 'entrada' } }, tes);
});
afterAll(async () => { await db?.destruir(); });

describe('tipos, origens e regras', () => {
  test('nada vem pronto; modelos do Dossiê só quando pedidos, sem duplicar', async () => {
    expect(await conta('select * from public.tipos_verba')).toBe(0);
    expect((await rpc('importar_modelos_verba', {}, dir)).erro).toBe('sem_permissao');
    expect((await rpc('importar_modelos_verba', {}, tes)).criados).toBe(5);
    expect((await rpc('importar_modelos_verba', {}, tes)).criados).toBe(0);
    tipoEmenda = await db.valor(`select id from public.tipos_verba where nome like 'Emenda%'`);
    tipoPatrocinio = await db.valor(`select id from public.tipos_verba where nome = 'Patrocínio privado'`);
  });

  test('regras com chaves fechadas e tipos certos', async () => {
    const p = { id: randomUUID(), nome: 'Convênio municipal' };
    expect((await rpc('salvar_tipo_verba', { p: { ...p, regras: { conta_especifica: 'sim' } } }, tes)).campo).toBe('regras');
    expect((await rpc('salvar_tipo_verba', { p: { ...p, regras: { admin: true } } }, tes)).campo).toBe('regras');
    expect((await rpc('salvar_tipo_verba', { p: { ...p, regras: { guarda_anos: 99 } } }, tes)).campo).toBe('regras');
    expect((await rpc('salvar_tipo_verba', { p: { ...p, regras: { documentos_antes: ['<b>x</b>\u0007'] } } }, tes)).campo).toBe('regras');
    expect((await rpc('salvar_tipo_verba', { p: { ...p, regras: { conta_especifica: true, guarda_anos: 10 } } }, tes)).ok).toBe(true);
  });

  test('origem: categoria fechada, sem CPF; diretor com só "ver" não cadastra', async () => {
    origem = randomUUID();
    expect((await rpc('salvar_origem_verba', { p: { id: origem, nome: 'Deputado Exemplo', categoria: 'politico' } }, tes)).campo).toBe('categoria');
    expect((await rpc('salvar_origem_verba', { p: { id: origem, nome: 'Deputado Exemplo', categoria: 'parlamentar', cpf: '12345678901' } }, tes)).erro).toBe('invalido');
    expect((await rpc('salvar_origem_verba', { p: { id: origem, nome: 'Deputado Exemplo', categoria: 'parlamentar' } }, dir)).erro).toBe('sem_permissao');
    expect((await rpc('salvar_origem_verba', { p: { id: origem, nome: 'Deputado Exemplo', categoria: 'parlamentar' } }, tes)).ok).toBe(true);
  });
});

describe('verbas', () => {
  test('nova verba herda as regras do tipo e já nasce com o checklist de documentos', async () => {
    verba = randomUUID();
    const r = await rpc('salvar_verba', { p: { id: verba, titulo: 'Emenda para cadeiras de jogo', tipo_id: tipoEmenda, origem_id: origem,
      forma_recebimento: 'conta_especifica', valor_pedido: '80000.00', responsavel: tes } }, tes);
    expect(r.ok).toBe(true);
    expect(await db.valor(`select regras ->> 'conta_especifica' from public.verbas where id = $1`, 'postgres', [verba])).toBe('true');
    expect(await conta('select * from public.verba_documentos where verba_id = $1', [verba])).toBe(7);
  });

  test('campos extras e valores inválidos recusados; repetir o id edita', async () => {
    const base = { id: verba, titulo: 'Emenda para cadeiras de jogo', tipo_id: tipoEmenda, origem_id: origem, forma_recebimento: 'conta_especifica' };
    expect((await rpc('salvar_verba', { p: { ...base, situacao: 'encerrado' } }, tes)).erro).toBe('invalido');
    expect((await rpc('salvar_verba', { p: { ...base, valor_pedido: '1,5' } }, tes)).campo).toBe('valor_pedido');
    expect((await rpc('salvar_verba', { p: { ...base, forma_recebimento: 'pix' } }, tes)).campo).toBe('forma_recebimento');
    expect((await rpc('salvar_verba', { p: { ...base, valor_pedido: '80000.00', valor_aprovado: '60000.00' } }, tes)).repetido).toBe(true);
    expect(await conta('select * from public.verbas where id = $1', [verba])).toBe(1);
  });

  test('alcance "próprios": vê só as suas; não edita a dos outros', async () => {
    expect(await db.valor<number>('select count(*)::int from public.verbas', sessao(verbaPropria))).toBe(0);
    const minha = randomUUID();
    expect((await rpc('salvar_verba', { p: { id: minha, titulo: 'Rifa de Natal', tipo_id: tipoPatrocinio, origem_id: origem, forma_recebimento: 'caixa_livre' } }, verbaPropria)).ok).toBe(true);
    expect(await db.valor<number>('select count(*)::int from public.verbas', sessao(verbaPropria))).toBe(1);
    expect((await rpc('salvar_verba', { p: { id: verba, titulo: 'Tomada', tipo_id: tipoEmenda, origem_id: origem, forma_recebimento: 'caixa_livre' } }, verbaPropria)).erro).toBe('sem_permissao');
    expect(await db.valor<number>('select count(*)::int from public.verba_documentos where verba_id = $1', sessao(verbaPropria), [verba])).toBe(0);
  });

  test('situação: só da lista; sair de uma final só administrador', async () => {
    const outra = randomUUID();
    await rpc('salvar_verba', { p: { id: outra, titulo: 'Edital negado', tipo_id: tipoPatrocinio, origem_id: origem, forma_recebimento: 'caixa_livre' } }, tes);
    expect((await rpc('mudar_situacao_verba', { p_id: outra, p_situacao: 'aprovadissimo' }, tes)).campo).toBe('situacao');
    expect((await rpc('mudar_situacao_verba', { p_id: outra, p_situacao: 'negado' }, tes)).ok).toBe(true);
    expect((await rpc('mudar_situacao_verba', { p_id: outra, p_situacao: 'aprovado' }, tes)).erro).toBe('verba_encerrada');
    expect((await rpc('salvar_verba', { p: { id: outra, titulo: 'Mudou', tipo_id: tipoPatrocinio, origem_id: origem, forma_recebimento: 'caixa_livre' } }, tes)).erro).toBe('verba_encerrada');
    expect((await rpc('mudar_situacao_verba', { p_id: outra, p_situacao: 'aprovado' }, pres)).ok).toBe(true);
  });

  test('parcelas: substitui as não recebidas; id de outra verba é recusado', async () => {
    const p1 = randomUUID(), p2 = randomUUID();
    const em = (d: number) => data(`private.hoje() + ${d}`);
    expect((await rpc('salvar_parcelas', { p_verba: verba, p: [{ id: p1, valor: '0', data_prevista: await em(10) }] }, tes)).campo).toBe('parcelas');
    expect((await rpc('salvar_parcelas', { p_verba: verba, p: [{ id: p1, valor: '30000.00', data_prevista: await em(10) }, { id: p1, valor: '1.00', data_prevista: await em(20) }] }, tes)).campo).toBe('parcelas');
    expect((await rpc('salvar_parcelas', { p_verba: verba, p: [{ id: p1, valor: '30000.00', data_prevista: await em(10) }, { id: p2, valor: '30000.00', data_prevista: await em(70) }] }, tes)).parcelas).toBe(2);
    expect((await rpc('salvar_parcelas', { p_verba: verba, p: [{ id: p1, valor: '30000.00', data_prevista: await em(10) }, { id: p2, valor: '30000.00', data_prevista: await em(70) }] }, tes)).parcelas).toBe(2);
    expect(await conta('select * from public.verba_parcelas where verba_id = $1', [verba])).toBe(2);
    expect((await rpc('salvar_parcelas', { p_verba: verba, p: '"x"' }, tes)).campo).toBe('parcelas'); // JSON que não é lista
  });

  test('checklist de documentos: responsável marca; quem só vê não marca', async () => {
    const doc = await db.valor<string>(`select id from public.verba_documentos where verba_id = $1 and momento = 'antes' limit 1`, 'postgres', [verba]);
    expect((await rpc('salvar_documento_verba', { p_verba: verba, p: { id: doc, entregue: true } }, dir)).erro).toBe('sem_permissao');
    expect((await rpc('salvar_documento_verba', { p_verba: verba, p: { id: doc, entregue: true } }, tes)).ok).toBe(true);
    expect(await db.valor('select entregue_por from public.verba_documentos where id = $1', 'postgres', [doc])).toBe(tes);
  });
});

describe('formalização e projeto', () => {
  test('formalizar exige projetos/criar e verbas/editar; duas chamadas simultâneas criam um projeto só', async () => {
    const vigIni = hoje, vigFim = await data('private.hoje() + 180');
    const p = { projeto_id: randomUUID(), vigencia_inicio: vigIni, vigencia_fim: vigFim };
    expect((await rpc('formalizar_verba', { p_verba: verba, p }, dir)).erro).toBe('sem_permissao');
    expect((await rpc('formalizar_verba', { p_verba: verba, p: { ...p, vigencia_fim: '2020-01-01' } }, tes)).campo).toBe('vigencia_fim');
    const [a, b] = await Promise.all([
      rpc('formalizar_verba', { p_verba: verba, p }, tes),
      rpc('formalizar_verba', { p_verba: verba, p: { ...p, projeto_id: randomUUID() } }, tes),
    ]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect(await conta('select * from public.projetos where verba_id = $1', [verba])).toBe(1);
    projeto = await db.valor('select id from public.projetos where verba_id = $1', 'postgres', [verba]);
    expect(await db.valor('select situacao from public.verbas where id = $1', 'postgres', [verba])).toBe('formalizado');
    // prazo da prestação = fim da vigência + 90 dias (regra do modelo) e tarefa com responsável
    expect(await db.valor<string>(`select to_char(prazo_prestacao, 'YYYY-MM-DD') from public.projetos where id = $1`, 'postgres', [projeto]))
      .toBe(await data('private.hoje() + 270'));
    expect(await db.valor(`select responsavel from public.tarefas where id = md5('prestacao:' || $1 || ':final')::uuid`, 'postgres', [projeto])).toBe(tes);
  });

  test('editar o prazo move a tarefa de prestação (sem criar outra)', async () => {
    const novo = await data('private.hoje() + 240');
    expect((await rpc('editar_projeto', { p_id: projeto, p: { prazo_prestacao: novo } }, tes)).erro).toBe('sem_permissao'); // tesoureira não edita projetos
    expect((await rpc('editar_projeto', { p_id: projeto, p: { prazo_prestacao: novo, verba_id: randomUUID() } }, pres)).erro).toBe('invalido');
    expect((await rpc('editar_projeto', { p_id: projeto, p: { prazo_prestacao: novo } }, pres)).ok).toBe(true);
    expect(await conta(`select * from public.tarefas where titulo like 'Prestação de contas final%'`)).toBe(1);
    expect(await db.valor<string>(`select to_char(prazo, 'YYYY-MM-DD') from public.tarefas where titulo like 'Prestação de contas final%'`)).toBe(novo);
  });

  test('conta específica: só quem administra o financeiro vincula', async () => {
    expect((await rpc('vincular_conta_projeto', { p_projeto: projeto, p_conta: contaProj, p_vincular: true }, dir)).erro).toBe('sem_permissao');
    expect((await rpc('vincular_conta_projeto', { p_projeto: projeto, p_conta: contaProj, p_vincular: true }, tes)).ok).toBe(true);
  });

  test('recebimento: só entrada realizada, na conta do projeto, uma vez', async () => {
    const parcela = await db.valor<string>('select id from public.verba_parcelas where verba_id = $1 and numero = 1', 'postgres', [verba]);
    const saida = await lancar(tes, {});
    const entradaLivre = await lancar(tes, { tipo: 'entrada', categoria_id: catEntrada, conta_id: contaLivre, valor: '30000.00' });
    const entrada = await lancar(tes, { tipo: 'entrada', categoria_id: catEntrada, valor: '30000.00', descricao: 'Repasse da emenda' });
    expect((await rpc('registrar_recebimento', { p_parcela: parcela, p: { lancamento_id: saida } }, tes)).campo).toBe('lancamento_id');
    expect((await rpc('registrar_recebimento', { p_parcela: parcela, p: { lancamento_id: entradaLivre } }, tes)).campo).toBe('conta_especifica');
    expect((await rpc('registrar_recebimento', { p_parcela: parcela, p: { lancamento_id: entrada } }, tes)).ok).toBe(true);
    expect((await rpc('registrar_recebimento', { p_parcela: parcela, p: { lancamento_id: entrada } }, tes)).erro).toBe('ja_recebida');
    const outra = await db.valor<string>('select id from public.verba_parcelas where verba_id = $1 and numero = 2', 'postgres', [verba]);
    expect((await rpc('registrar_recebimento', { p_parcela: outra, p: { lancamento_id: entrada } }, tes)).erro).toBe('conflito');
  });

  test('apoio em bens: registra valor estimado sem lançamento (não passa pelo caixa)', async () => {
    const v = randomUUID(), x = randomUUID();
    await rpc('salvar_verba', { p: { id: v, titulo: 'Passagens pagas pela confederação', tipo_id: tipoPatrocinio, origem_id: origem, forma_recebimento: 'pago_pela_origem' } }, tes);
    await rpc('salvar_parcelas', { p_verba: v, p: [{ id: x, valor: '4200.00', data_prevista: hoje }] }, tes);
    expect((await rpc('registrar_recebimento', { p_parcela: x, p: { lancamento_id: randomUUID() } }, tes)).campo).toBe('lancamento_id');
    expect((await rpc('registrar_recebimento', { p_parcela: x, p: { data: hoje, valor: '4200.00' } }, tes)).ok).toBe(true);
    expect(await db.valor('select lancamento_id from public.verba_parcelas where id = $1', 'postgres', [x])).toBeNull();
  });
});

describe('rubricas, pendências e execução', () => {
  let semRegra: string, emDinheiro: string;
  test('rubricas: só quem edita projetos; nome único no projeto; aviso se passar do aprovado', async () => {
    rubTransporte = randomUUID(); rubUniforme = randomUUID();
    expect((await rpc('salvar_rubrica', { p_projeto: projeto, p: { id: rubTransporte, nome: 'Transporte', valor_previsto: '20000.00' } }, tes)).erro).toBe('sem_permissao');
    expect((await rpc('salvar_rubrica', { p_projeto: projeto, p: { id: rubTransporte, nome: 'Transporte', valor_previsto: '20000.00' } }, pres)).ok).toBe(true);
    expect((await rpc('salvar_rubrica', { p_projeto: projeto, p: { id: randomUUID(), nome: 'TRANSPORTE', valor_previsto: '1.00' } }, pres)).erro).toBe('duplicado');
    expect((await rpc('salvar_rubrica', { p_projeto: projeto, p: { id: rubUniforme, nome: 'Uniformes', valor_previsto: '50000.00' } }, pres)).aviso).toBe('rubricas_acima_do_aprovado');
  });

  test('classificar: quem fez o lançamento pode; rubrica de outro projeto, não; quem não fez e não edita projetos, não', async () => {
    semRegra = await lancar(tes, { valor: '19000.00', descricao: 'Ônibus adaptado' });
    expect((await rpc('classificar_lancamento', { p_lancamento: semRegra, p_rubrica: rubTransporte }, tes)).ok).toBe(true);
    expect((await rpc('classificar_lancamento', { p_lancamento: semRegra, p_rubrica: rubTransporte }, dir)).erro).toBe('sem_permissao');
    const outroProj = randomUUID(), outraRub = randomUUID();
    await rpc('salvar_projeto', { p: { id: outroProj, nome: 'Outro projeto' } }, pres);
    await rpc('salvar_rubrica', { p_projeto: outroProj, p: { id: outraRub, nome: 'Material', valor_previsto: '10.00' } }, pres);
    expect((await rpc('classificar_lancamento', { p_lancamento: semRegra, p_rubrica: outraRub }, pres)).campo).toBe('rubrica_id');
  });

  test('pendências: dinheiro em espécie, sem rubrica e sem comprovante; justificar resolve só o justificável', async () => {
    emDinheiro = await lancar(tes, { valor: '1500.00', descricao: 'Lanche pago em espécie', forma_pagamento: 'dinheiro' });
    const pend = async () => (await db.linhas(`select regra, justificada from private.pendencias_projeto($1) where lancamento_id = $2 order by regra`, 'postgres', [projeto, emDinheiro]));
    expect((await pend()).map((x) => x.regra)).toEqual(['forma_dinheiro', 'sem_comprovante', 'sem_rubrica', 'sem_transferencia']);
    expect((await rpc('justificar_regra', { p_lancamento: emDinheiro, p_projeto: projeto, p_regra: 'sem_rubrica', p_motivo: 'Sem motivo' }, pres)).campo).toBe('regra');
    expect((await rpc('justificar_regra', { p_lancamento: emDinheiro, p_projeto: projeto, p_regra: 'forma_dinheiro', p_motivo: 'x' }, pres)).campo).toBe('motivo');
    expect((await rpc('justificar_regra', { p_lancamento: emDinheiro, p_projeto: projeto, p_regra: 'forma_dinheiro', p_motivo: 'Fornecedor só aceitava espécie' }, tes)).erro).toBe('sem_permissao');
    expect((await rpc('justificar_regra', { p_lancamento: emDinheiro, p_projeto: projeto, p_regra: 'forma_dinheiro', p_motivo: 'Fornecedor só aceitava espécie' }, pres)).ok).toBe(true);
    expect((await pend()).find((x) => x.regra === 'forma_dinheiro')!.justificada).toBe(true);
    // justificar o que não está pendente não grava nada
    expect((await rpc('justificar_regra', { p_lancamento: semRegra, p_projeto: projeto, p_regra: 'forma_dinheiro', p_motivo: 'Inventado' }, pres)).erro).toBe('nao_encontrado');
    expect(await db.falha(`update public.lancamento_justificativas set motivo = 'outro'`, 'postgres')).toMatch(/não se apaga/);
  });

  test('painel: gasto, ritmo e alerta de rubrica', async () => {
    const r = await rpc('painel_projeto', { p_id: projeto }, pres);
    expect(r.ok).toBe(true);
    const p = r.projeto;
    expect(p.gasto).toBe('20600.00');          // saídas efetivas na conta do projeto: 100 + 19.000 + 1.500
    expect(p.orcamento).toBe('60000.00');
    expect(p.pct_tempo).toBe(0);
    const t = p.rubricas.find((x: { nome: string }) => x.nome === 'Transporte');
    expect(t.realizado).toBe('19000.00');
    expect(t.alerta).toBe('perto_do_limite');
    expect(p.pendencias.abertas).toBeGreaterThan(0);
    expect(r.lancamentos.length).toBeGreaterThan(0);
  });

  test('quem só vê projetos vê os totais, mas não os lançamentos um a um', async () => {
    const r = await rpc('painel_projeto', { p_id: projeto }, soProjetos);
    expect(r.ok).toBe(true);
    expect(r.lancamentos).toBeNull();
    expect(r.projeto.pendencias.itens).toBeNull();
  });

  test('classificação vale em mês fechado (não mexe no lançamento) e fica na auditoria', async () => {
    const passado = await data(`date_trunc('month', private.hoje()) - interval '1 month'`);
    const velho = await lancar(tes, { data: passado, descricao: 'Do mês fechado' });
    await db.linhas(`insert into public.fechamentos (competencia, fechado_por) values ($1, $2)`, 'postgres', [passado, tes]);
    expect((await rpc('classificar_lancamento', { p_lancamento: velho, p_rubrica: rubTransporte }, pres)).ok).toBe(true);
    expect(await conta(`select * from public.auditoria where tabela = 'lancamento_rubricas' and depois ->> 'lancamento_id' = $1`, [velho])).toBe(1);
  });
});

describe('prestação de contas, agenda e nada se apaga', () => {
  test('dados da prestação: só com projetos/exportar e financeiro completo; fica registrado', async () => {
    expect((await rpc('dados_prestacao', { p_id: projeto }, dir)).erro).toBe('sem_permissao');
    expect((await rpc('dados_prestacao', { p_id: projeto }, soProjetos)).erro).toBe('sem_permissao');
    const r = await rpc('dados_prestacao', { p_id: projeto }, pres);
    expect(r.ok).toBe(true);
    expect(r.pagamentos.length).toBeGreaterThan(0);
    expect(r.verba.documentos.length).toBe(7);
    expect(await conta(`select * from public.auditoria where acao = 'exportar' and tabela = 'projetos' and registro_id = $1`, [projeto])).toBe(1);
  });

  test('agenda mostra parcelas e prestação só para quem vê verbas e projetos', async () => {
    const ate = await data('private.hoje() + 100');
    const tipos = (r: { prazos: { tipo: string }[] }) => new Set(r.prazos.map((x) => x.tipo));
    const a = await rpc('agenda_periodo', { p_inicio: hoje, p_fim: ate }, pres);
    expect(tipos(a).has('verba')).toBe(true);
    const b = await rpc('agenda_periodo', { p_inicio: hoje, p_fim: ate }, soProjetos);
    expect(tipos(b).has('verba')).toBe(false);
  });

  test('verba, projeto, rubrica e justificativa não se apagam', async () => {
    for (const [t, col, id] of [['verbas', 'id', verba], ['projetos', 'id', projeto], ['projeto_rubricas', 'id', rubTransporte]] as const) {
      expect(await db.falha(`delete from public.${t} where ${col} = $1`, 'postgres', [id])).toMatch(/não se apaga/);
    }
    expect(await db.falha(`insert into public.verbas (id, titulo, tipo_id, origem_id, forma_recebimento, criado_por) values (gen_random_uuid(), 'x', '${tipoEmenda}', '${origem}', 'caixa_livre', '${tes}')`, sessao(tes))).toMatch(/permission denied/);
  });
});
