import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco;
let pres: string, sec: string, tes: string, dir: string, dirProprios: string;
let hoje: string, mesPassado: string, conta: string, catE: string, catS: string;
const rpc = (nome: string, args: Record<string, unknown>, quem: string) => db.rpc(nome, args, sessao(quem));
const data = (expr: string) => db.valor<string>(`select to_char(${expr}, 'YYYY-MM-DD')`);
const lancar = async (tipo: 'entrada' | 'saida', valor: string, quando: string, extra: Record<string, unknown> = {}) => {
  const id = randomUUID();
  const r = await rpc('criar_lancamento', { p: { id, tipo, situacao: 'realizada', valor, data: quando, descricao: `Mov ${valor}`, categoria_id: tipo === 'entrada' ? catE : catS,
    conta_id: conta, ...extra } }, tes);
  if (!r.ok) throw new Error(JSON.stringify(r));
  // saída sem foto precisa de justificativa para o mês poder fechar
  if (tipo === 'saida') await rpc('justificar_sem_comprovante', { p_id: id, p_motivo: 'Tarifa sem comprovante' }, tes);
  return id;
};

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  sec = await convidarMembro(db, pres, { email: 'sec@exemplo.test', nome: 'Secretária', cargo: 'secretario' });
  tes = await convidarMembro(db, pres, { email: 'tes@exemplo.test', nome: 'Tesoureira', cargo: 'tesoureiro' });
  dir = await convidarMembro(db, pres, { email: 'dir@exemplo.test', nome: 'Diretor', cargo: 'diretor' });
  dirProprios = await convidarMembro(db, pres, { email: 'dp@exemplo.test', nome: 'Diretor Próprios', cargo: 'diretor' });
  await db.linhas(`update public.permissoes set alcance = 'proprios' where membro_id = $1 and modulo = 'financeiro'`, 'postgres', [dirProprios]);
  hoje = await data('private.hoje()');
  mesPassado = await data(`date_trunc('month', private.hoje()) - interval '1 month' + interval '4 days'`);
  conta = randomUUID(); catE = randomUUID(); catS = randomUUID();
  await rpc('salvar_conta', { p: { id: conta, nome: 'Conta Movimento', tipo: 'movimento', saldo_inicial: '0', data_saldo_inicial: '2025-01-01' } }, tes);
  await rpc('salvar_categoria', { p: { id: catE, nome: 'Doações', tipo: 'entrada' } }, tes);
  await rpc('salvar_categoria', { p: { id: catS, nome: 'Despesas', tipo: 'saida' } }, tes);
});
afterAll(async () => { await db?.destruir(); });

describe('conciliação bancária', () => {
  let l100: string, l50: string;
  test('importar: só a tesouraria; reimportar não duplica; linhas iguais no mesmo arquivo ficam as duas', async () => {
    l100 = await lancar('entrada', '100.00', mesPassado);
    l50 = await lancar('saida', '50.00', mesPassado);
    const linhas = [
      { data: mesPassado, valor: '100.00', descricao: 'PIX RECEBIDO', id: 'FIT-1' },
      { data: mesPassado, valor: '-50.00', descricao: 'PAGAMENTO' },
      { data: mesPassado, valor: '-2.50', descricao: 'TARIFA' },
      { data: mesPassado, valor: '-2.50', descricao: 'TARIFA' },
    ];
    expect((await rpc('importar_extrato', { p_conta: conta, p: linhas }, dir)).erro).toBe('sem_permissao');
    expect((await rpc('importar_extrato', { p_conta: conta, p: [{ ...linhas[0], saldo: '1' }] }, tes)).campo).toBe('linhas');
    expect((await rpc('importar_extrato', { p_conta: conta, p: [{ ...linhas[0], descricao: 'a\u0007b' }] }, tes)).campo).toBe('linhas');
    expect((await rpc('importar_extrato', { p_conta: conta, p: [{ ...linhas[0], valor: '0' }] }, tes)).campo).toBe('linhas');
    expect(await rpc('importar_extrato', { p_conta: conta, p: linhas }, tes)).toMatchObject({ ok: true, novas: 4, repetidas: 0 });
    expect(await rpc('importar_extrato', { p_conta: conta, p: linhas }, tes)).toMatchObject({ ok: true, novas: 0, repetidas: 4 });
  });

  test('sugestão e conciliação automática só no caso sem dúvida', async () => {
    const fim = await data('private.hoje()');
    const painel = await rpc('painel_conciliacao', { p_conta: conta, p_inicio: mesPassado, p_fim: fim }, tes);
    const pix = painel.linhas.find((x: { descricao: string }) => x.descricao === 'PIX RECEBIDO');
    expect(pix.sugestoes.map((s: { id: string }) => s.id)).toEqual([l100]);
    expect(await rpc('conciliar_automatico', { p_conta: conta }, tes)).toMatchObject({ conciliadas: 2 });
    expect(await db.valor('select lancamento_id from public.extrato_linhas where descricao = $1', 'postgres', ['PAGAMENTO'])).toBe(l50);
  });

  test('conciliar errado é recusado; o mesmo lançamento não serve duas vezes', async () => {
    const tarifa = await db.valor<string>(`select id from public.extrato_linhas where descricao = 'TARIFA' limit 1`);
    expect((await rpc('conciliar', { p_linha: tarifa, p_lancamento: l50 }, tes)).campo).toBe('lancamento_id'); // valor diferente
    await rpc('importar_extrato', { p_conta: conta, p: [{ data: hoje, valor: '-50.00', descricao: 'PAGAMENTO REPETIDO', id: 'FIT-9' }] }, tes);
    const nova = await db.valor<string>(`select id from public.extrato_linhas where chave = 'id:FIT-9'`);
    expect((await rpc('conciliar', { p_linha: nova, p_lancamento: l50 }, tes)).erro).toBe('ja_conciliada');
    expect((await rpc('conciliar', { p_linha: nova, p_lancamento: l100 }, dir)).erro).toBe('sem_permissao');
  });

  test('linha pendente impede o fechamento; ignorar com motivo libera; desfazer em mês fechado não', async () => {
    const comp = mesPassado.slice(0, 8) + '01';
    const ck = await rpc('checklist_fechamento', { p_competencia: comp }, tes);
    expect(ck.itens.find((i: { chave: string }) => i.chave === 'extrato').pendentes).toBe(2);
    expect(ck.pode_fechar).toBe(false);
    expect((await rpc('fechar_mes', { p_competencia: comp, p_confirmacoes: { extrato_conferido: true } }, tes)).erro).toBe('pendencias');
    const tarifas = await db.linhas(`select id from public.extrato_linhas where descricao = 'TARIFA'`);
    expect((await rpc('ignorar_linha', { p_linha: tarifas[0]!.id, p_motivo: 'x' }, tes)).campo).toBe('motivo');
    for (const t of tarifas) expect((await rpc('ignorar_linha', { p_linha: t.id, p_motivo: 'Tarifa lançada no total do mês' }, tes)).ok).toBe(true);
    expect((await rpc('fechar_mes', { p_competencia: comp, p_confirmacoes: { extrato_conferido: true } }, tes)).ok).toBe(true);
    expect((await rpc('desfazer_conciliacao', { p_linha: tarifas[0]!.id }, tes)).erro).toBe('mes_fechado');
  });

  test('extrato só para quem vê o financeiro inteiro', async () => {
    expect(await db.valor<number>('select count(*)::int from public.extrato_linhas', sessao(dirProprios))).toBe(0);
    expect((await rpc('painel_conciliacao', { p_conta: conta, p_inicio: mesPassado, p_fim: hoje }, dirProprios)).erro).toBe('sem_permissao');
    expect(await db.valor<number>('select count(*)::int from public.extrato_linhas', sessao(dir))).toBe(5);
  });
});

describe('captação', () => {
  let op: string, verba: string, contra: string, rifa: string;
  test('funil: diretor só vê; histórico de conversas; próximo passo na agenda', async () => {
    op = randomUUID();
    const p = { id: op, tipo: 'patrocinio', nome: 'Empresa Fictícia Ltda.', etapa: 'contato', valor_estimado: '5000.00', proximo_passo: 'Enviar proposta', proximo_passo_em: await data('private.hoje() + 3') };
    expect((await rpc('salvar_oportunidade', { p }, dir)).erro).toBe('sem_permissao');
    expect((await rpc('salvar_oportunidade', { p: { ...p, etapa: 'ganho' } }, sec)).campo).toBe('etapa');
    expect((await rpc('salvar_oportunidade', { p: { ...p, criado_por: dir } }, sec)).erro).toBe('invalido');
    expect((await rpc('salvar_oportunidade', { p }, sec)).ok).toBe(true);
    const i = randomUUID();
    expect((await rpc('registrar_interacao', { p_oportunidade: op, p: { id: i, data: hoje, texto: 'Ligação com o gerente de marketing' } }, sec)).ok).toBe(true);
    expect((await rpc('registrar_interacao', { p_oportunidade: op, p: { id: i, data: hoje, texto: 'Ligação com o gerente de marketing' } }, sec)).repetido).toBe(true);
    const ag = await rpc('agenda_periodo', { p_inicio: hoje, p_fim: await data('private.hoje() + 10') }, dir);
    expect(ag.prazos.some((x: { tipo: string; ref: string }) => x.tipo === 'captacao' && x.ref === op)).toBe(true);
    const painel = await rpc('painel_captacao', {}, dir);
    expect(painel.etapas.contato).toMatchObject({ n: 1, valor: '5000.00' });
  });

  test('contrapartida com foto: autoriza pela captação; o registro do arquivo marca a entrega', async () => {
    const tipo = randomUUID(), origem = randomUUID(); verba = randomUUID(); contra = randomUUID();
    await rpc('salvar_tipo_verba', { p: { id: tipo, nome: 'Patrocínio' } }, tes);
    await rpc('salvar_origem_verba', { p: { id: origem, nome: 'Empresa Fictícia', categoria: 'empresa' } }, tes);
    await rpc('salvar_verba', { p: { id: verba, titulo: 'Patrocínio uniforme', tipo_id: tipo, origem_id: origem, forma_recebimento: 'caixa_livre' } }, tes);
    expect((await rpc('salvar_contrapartida', { p: { id: contra, verba_id: verba, descricao: 'Marca no uniforme', prazo: hoje } }, dir)).erro).toBe('sem_permissao');
    expect((await rpc('salvar_contrapartida', { p: { id: contra, verba_id: verba, descricao: 'Marca no uniforme', prazo: hoje } }, sec)).ok).toBe(true);
    expect((await rpc('autorizar_documento', { p_area: 'contrapartida', p_documento: contra }, dir)).erro).toBe('sem_permissao');
    expect((await rpc('autorizar_documento', { p_area: 'contrapartida', p_documento: contra }, sec)).ok).toBe(true);
    const caminho = `${contra}/${randomUUID()}.jpg`;
    await db.linhas(`insert into storage.objects (bucket_id, name, metadata) values ('captacao', $1, '{"mimetype":"image/jpeg","size":5000}')`, 'postgres', [caminho]);
    const args = [sec, JSON.stringify({ area: 'contrapartida', documento_id: contra, caminho, sha256: 'c'.repeat(64) })];
    expect((await db.valor(`select public.registrar_documento($1, $2)`, 'service', args)).ok).toBe(true);
    expect(await db.valor(`select entregue_em is not null from public.contrapartidas where id = $1`, 'postgres', [contra])).toBe(true);
  });

  test('rifa: bilhetes não passam do total; vendidos não passam do recebido; entrada só uma vez', async () => {
    rifa = randomUUID();
    expect((await rpc('salvar_acao_captacao', { p: { id: rifa, tipo: 'rifa', nome: 'Rifa de Natal', data: hoje, preco_unitario: '10.00', quantidade: 100, custo: '150.00',
      autorizacao: 'Parecer do contador de 01/10' } }, sec)).ok).toBe(true);
    const vend = (extra: Record<string, unknown>) => rpc('salvar_vendedor', { p_acao: rifa, p: { id: randomUUID(), nome: 'Vendedor Fictício', bilhetes: 60, vendidos: 50, valor_prestado: '500.00', ...extra } }, sec);
    expect((await vend({ vendidos: 70 })).campo).toBe('vendidos');
    expect((await vend({})).ok).toBe(true);
    expect((await vend({ nome: 'Outra Vendedora', bilhetes: 50, vendidos: 0, valor_prestado: '0' })).campo).toBe('bilhetes');
    const entrada = await lancar('entrada', '300.00', hoje);
    expect((await vend({ nome: 'Terceira', bilhetes: 30, vendidos: 30, valor_prestado: '300.00', lancamento_id: entrada })).ok).toBe(true);
    expect((await vend({ nome: 'Quarta', bilhetes: 5, vendidos: 0, valor_prestado: '0', lancamento_id: entrada })).campo).toBe('lancamento_id');
    const p = await rpc('painel_captacao', {}, sec);
    expect(p.acoes.find((a: { id: string }) => a.id === rifa)).toMatchObject({ arrecadado: '800.00', vendidos: 80, resultado: '650.00' });
  });

  test('recibos: só a tesouraria; números em sequência sem buraco mesmo em paralelo; CPF conferido', async () => {
    const base = { doador_nome: 'Doador Fictício', valor: '20.00', data: hoje, forma: 'bens', descricao: 'Duas bolas de basquete' };
    expect((await rpc('emitir_recibo', { p: { id: randomUUID(), ...base } }, sec)).erro).toBe('sem_permissao');
    expect((await rpc('emitir_recibo', { p: { id: randomUUID(), ...base, doador_documento: '123.456.789-00' } }, tes)).campo).toBe('doador_documento');
    expect((await rpc('emitir_recibo', { p: { id: randomUUID(), ...base, forma: 'dinheiro' } }, tes)).campo).toBe('lancamento_id');
    const r = await Promise.all([1, 2, 3, 4, 5].map(() => rpc('emitir_recibo', { p: { id: randomUUID(), ...base, doador_documento: '529.982.247-25' } }, tes)));
    expect(r.map((x) => x.numero).sort()).toEqual([1, 2, 3, 4, 5]);
    const id = randomUUID();
    const e = await lancar('entrada', '75.00', hoje);
    const a = await rpc('emitir_recibo', { p: { id, ...base, forma: 'dinheiro', valor: '75.00', lancamento_id: e, descricao: null } }, tes);
    expect(a.numero).toBe(6);
    expect((await rpc('emitir_recibo', { p: { id, ...base, forma: 'dinheiro', valor: '75.00', lancamento_id: e } }, tes)).numero).toBe(6);
    expect((await rpc('emitir_recibo', { p: { id: randomUUID(), ...base, forma: 'dinheiro', valor: '75.00', lancamento_id: e } }, tes)).campo).toBe('lancamento_id');
    expect((await rpc('cancelar_recibo', { p_id: id, p_motivo: 'x' }, tes)).campo).toBe('motivo');
    expect((await rpc('cancelar_recibo', { p_id: id, p_motivo: 'Emitido com o nome errado' }, tes)).ok).toBe(true);
    expect(await db.falha(`delete from public.recibos where id = $1`, 'postgres', [id])).toMatch(/apaga|não/i);
    // o recibo traz CPF: diretor não lê
    expect(await db.valor<number>('select count(*)::int from public.recibos', sessao(dir))).toBe(6);
    expect(await db.valor<number>('select count(*)::int from public.recibos', sessao(dirProprios))).toBe(0);
  });

  test('dados da Associação Exemplo no recibo: CNPJ conferido; só quem administra o financeiro', async () => {
    const p = { nome: 'Associação Fictícia', cnpj: '11.222.333/0001-81', endereco: 'Rua Exemplo, 100 — Cidade Exemplo' };
    expect((await rpc('salvar_config_entidade', { p }, sec)).erro).toBe('sem_permissao');
    expect((await rpc('salvar_config_entidade', { p: { ...p, cnpj: '11.222.333/0001-80' } }, tes)).campo).toBe('cnpj');
    expect((await rpc('salvar_config_entidade', { p }, tes)).ok).toBe(true);
    expect(await db.valor(`select valor ->> 'cnpj' from public.configuracoes where chave = 'entidade'`)).toBe('11222333000181');
  });
});

describe('viagens', () => {
  let viagem: string, atleta: string;
  test('diretor cria a própria viagem; não mexe na de outro; delegação só com atleta cadastrado', async () => {
    viagem = randomUUID(); atleta = randomUUID();
    await rpc('salvar_pessoa', { p: { id: atleta, nome: 'Atleta Fictício', atleta: true, associado: false } }, sec);
    const v = { id: viagem, titulo: 'Brasileiro em Campinas', destino: 'Campinas (SP)', saida: await data('private.hoje() - 5'), retorno: await data('private.hoje() - 2'),
      distancia_km: 300, orcamento: '2000.00', quartos_adaptados: 3, transporte_acessivel: true };
    expect((await rpc('salvar_viagem', { p: { ...v, retorno: await data('private.hoje() - 9') } }, dir)).campo).toBe('retorno');
    expect((await rpc('salvar_viagem', { p: { ...v, situacao: 'encerrada' } }, dir)).campo).toBe('situacao');
    expect((await rpc('salvar_viagem', { p: v }, dir)).ok).toBe(true);
    expect((await rpc('salvar_viagem', { p: { ...v, titulo: 'Outro título' } }, tes)).erro).toBe('sem_permissao');
    const del = [{ id: randomUUID(), pessoa_id: atleta, nome: 'Atleta Fictício', funcao: 'atleta', quarto: '101' }, { id: randomUUID(), nome: 'Técnico Fictício', funcao: 'tecnico' }];
    expect((await rpc('salvar_delegacao', { p_viagem: viagem, p: [{ id: randomUUID(), nome: 'Sem cadastro', funcao: 'atleta' }] }, dir)).campo).toBe('delegacao');
    expect((await rpc('salvar_delegacao', { p_viagem: viagem, p: [...del, { ...del[0], id: randomUUID() }] }, dir)).campo).toBe('delegacao');
    expect((await rpc('salvar_delegacao', { p_viagem: viagem, p: [{ ...del[1], deficiencia: 'x' }] }, dir)).campo).toBe('delegacao');
    expect((await rpc('salvar_delegacao', { p_viagem: viagem, p: del }, dir)).pessoas).toBe(2);
  });

  test('adiantamento, despesas e devolução; acerto pendente impede encerrar; custos por atleta e km', async () => {
    const adiant = await lancar('saida', '500.00', hoje), desp = await lancar('saida', '400.00', hoje), devol = await lancar('entrada', '100.00', hoje);
    expect((await rpc('vincular_lancamento_viagem', { p_viagem: viagem, p_lancamento: devol, p_papel: 'despesa' }, dir)).campo).toBe('lancamento_id');
    expect((await rpc('vincular_lancamento_viagem', { p_viagem: viagem, p_lancamento: adiant, p_papel: 'adiantamento' }, dir)).ok).toBe(true);
    expect((await rpc('vincular_lancamento_viagem', { p_viagem: viagem, p_lancamento: desp, p_papel: 'despesa' }, dir)).ok).toBe(true);
    const n = (await rpc('painel_viagens', {}, dir)).viagens.find((x: { id: string }) => x.id === viagem);
    expect(n).toMatchObject({ gasto: '400.00', adiantado: '500.00', saldo_acerto: '100.00', atletas: 1, custo_por_atleta: '400.00', custo_por_km: '1.33' });
    expect((await rpc('encerrar_viagem', { p_id: viagem }, dir)).erro).toBe('sem_permissao');
    expect((await rpc('encerrar_viagem', { p_id: viagem }, pres)).erro).toBe('acerto_pendente');
    expect((await rpc('vincular_lancamento_viagem', { p_viagem: viagem, p_lancamento: devol, p_papel: 'devolucao' }, dir)).ok).toBe(true);
    expect((await rpc('encerrar_viagem', { p_id: viagem }, pres)).ok).toBe(true);
    expect((await rpc('salvar_viagem', { p: { id: viagem, titulo: 'X', destino: 'Y', saida: hoje, retorno: hoje } }, pres)).erro).toBe('viagem_encerrada');
    expect((await rpc('vincular_lancamento_viagem', { p_viagem: viagem, p_lancamento: desp, p_papel: null }, pres)).erro).toBe('viagem_encerrada');
  });

  test('viagem futura e acerto aparecem na agenda', async () => {
    const v2 = randomUUID(); const saida = await data('private.hoje() + 4');
    await rpc('salvar_viagem', { p: { id: v2, titulo: 'Paulista em Santos', destino: 'Santos (SP)', saida, retorno: saida } }, dir);
    const ag = await rpc('agenda_periodo', { p_inicio: hoje, p_fim: await data('private.hoje() + 15') }, tes);
    const meus = ag.prazos.filter((x: { tipo: string; ref: string }) => x.tipo === 'viagem' && x.ref === v2);
    expect(meus.length).toBe(2);
  });
});
