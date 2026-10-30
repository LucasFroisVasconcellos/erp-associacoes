import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco;
let pres: string, sec: string, tes: string, dir: string;
let hoje: string, projeto: string, atleta: string, menor: string, catSaida: string;

const rpc = (nome: string, args: Record<string, unknown>, quem: string) => db.rpc(nome, args, sessao(quem));
const data = (expr: string) => db.valor<string>(`select to_char(${expr}, 'YYYY-MM-DD')`);
const conta = (sql: string, params?: unknown[]) => db.valor<number>(`select count(*)::int from (${sql}) t`, 'postgres', params);

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  sec = await convidarMembro(db, pres, { email: 'sec@exemplo.test', nome: 'Secretária', cargo: 'secretario' });
  tes = await convidarMembro(db, pres, { email: 'tes@exemplo.test', nome: 'Tesoureira', cargo: 'tesoureiro' });
  dir = await convidarMembro(db, pres, { email: 'dir@exemplo.test', nome: 'Diretor', cargo: 'diretor' });
  hoje = await data('private.hoje()');
  projeto = randomUUID(); atleta = randomUUID(); menor = randomUUID(); catSaida = randomUUID();
  await rpc('salvar_projeto', { p: { id: projeto, nome: 'Projeto Cadeiras' } }, pres);
  await rpc('salvar_categoria', { p: { id: catSaida, nome: 'Anuidades', tipo: 'saida' } }, tes);
  await rpc('salvar_pessoa', { p: { id: atleta, nome: 'Atleta Adulto', atleta: true, associado: false } }, sec);
  await rpc('salvar_pessoa', { p: { id: menor, nome: 'Atleta Menor', atleta: true, associado: false,
    data_nascimento: await data(`private.hoje() - interval '13 years'`), responsavel_nome: 'Mãe Fictícia', responsavel_contato: '(11) 90000-0000' } }, sec);
});
afterAll(async () => { await db?.destruir(); });

describe('patrimônio', () => {
  let cadeira: string, bola: string, emp: string;

  test('cadastro: diretor só vê; origem projeto exige projeto; número único', async () => {
    cadeira = randomUUID(); bola = randomUUID();
    const base = { id: cadeira, numero: 'cad-001', nome: 'Cadeira de jogo', categoria: 'cadeira_jogo', origem: 'projeto' };
    expect((await rpc('salvar_bem', { p: { ...base, projeto_id: projeto } }, dir)).erro).toBe('sem_permissao');
    expect((await rpc('salvar_bem', { p: base }, sec)).campo).toBe('projeto_id');
    expect((await rpc('salvar_bem', { p: { ...base, projeto_id: projeto, categoria: 'carro' } }, sec)).campo).toBe('categoria');
    expect((await rpc('salvar_bem', { p: { ...base, projeto_id: projeto, dono: pres } }, sec)).erro).toBe('invalido');
    expect((await rpc('salvar_bem', { p: { ...base, projeto_id: projeto, valor: '4500.00', data_aquisicao: hoje } }, sec)).ok).toBe(true);
    expect(await db.valor('select numero from public.bens where id = $1', 'postgres', [cadeira])).toBe('CAD-001');
    expect((await rpc('salvar_bem', { p: { id: bola, numero: 'CAD-001', nome: 'Bola', categoria: 'bola', origem: 'doacao' } }, sec)).erro).toBe('duplicado');
    expect((await rpc('salvar_bem', { p: { id: bola, numero: 'BOL-001', nome: 'Bola', categoria: 'bola', origem: 'doacao' } }, sec)).ok).toBe(true);
  });

  test('bem comprado com recurso do projeto aparece na prestação de contas', async () => {
    const r = await rpc('dados_prestacao', { p_id: projeto }, pres);
    expect(r.bens.map((b: { numero: string }) => b.numero)).toEqual(['CAD-001']);
  });

  test('empréstimo: menor só com termo aceito pelo responsável; um aberto por bem', async () => {
    emp = randomUUID();
    const termo = { termo_versao: 'v1', termo_aceito_em: hoje, inicio: hoje };
    expect((await rpc('emprestar_bem', { p: { id: emp, bem_id: cadeira, pessoa_id: menor, termo_aceito_por: 'Atleta Menor', ...termo } }, sec)).campo).toBe('termo_aceito_por');
    expect((await rpc('emprestar_bem', { p: { id: emp, bem_id: cadeira, pessoa_id: menor, termo_aceito_por: 'Mãe Fictícia', ...termo, termo_versao: '1' } }, sec)).campo).toBe('termo_versao');
    expect((await rpc('emprestar_bem', { p: { id: emp, bem_id: cadeira, pessoa_id: menor, termo_aceito_por: 'mãe fictícia', ...termo } }, sec)).ok).toBe(true);
    expect(await db.valor('select situacao from public.bens where id = $1', 'postgres', [cadeira])).toBe('emprestado');
    // em paralelo, só um segundo empréstimo poderia passar — e nenhum passa, o bem já está fora
    const r = await Promise.all([1, 2].map(() => rpc('emprestar_bem', { p: { id: randomUUID(), bem_id: cadeira, pessoa_id: atleta, termo_aceito_por: 'Atleta Adulto', ...termo } }, sec)));
    expect(r.every((x) => x.erro === 'bem_indisponivel')).toBe(true);
    expect((await rpc('baixar_bem', { p_id: cadeira, p_motivo: 'Quebrou' }, sec)).erro).toBe('bem_emprestado');
  });

  test('devolução, manutenção com próxima data na agenda e baixa definitiva', async () => {
    expect((await rpc('devolver_bem', { p_emprestimo: emp, p_data: await data('private.hoje() + 1'), p_observacao: null }, sec)).campo).toBe('data');
    expect((await rpc('devolver_bem', { p_emprestimo: emp, p_data: hoje, p_observacao: 'Ok' }, sec)).ok).toBe(true);
    expect((await rpc('devolver_bem', { p_emprestimo: emp, p_data: hoje, p_observacao: null }, sec)).repetido).toBe(true);
    const proxima = await data('private.hoje() + 30');
    expect((await rpc('registrar_manutencao', { p: { id: randomUUID(), bem_id: cadeira, data: hoje, descricao: 'Troca de pneu', custo: '120.00', proxima_em: hoje } }, sec)).campo).toBe('proxima_em');
    expect((await rpc('registrar_manutencao', { p: { id: randomUUID(), bem_id: cadeira, data: hoje, descricao: 'Troca de pneu', custo: '120.00', proxima_em: proxima, em_manutencao: true } }, sec)).ok).toBe(true);
    expect(await db.valor('select situacao from public.bens where id = $1', 'postgres', [cadeira])).toBe('manutencao');
    const ag = await rpc('agenda_periodo', { p_inicio: hoje, p_fim: proxima }, dir);
    expect(ag.prazos.some((x: { tipo: string; titulo: string }) => x.tipo === 'patrimonio' && x.titulo.includes('CAD-001'))).toBe(true);
    expect((await rpc('baixar_bem', { p_id: bola, p_motivo: 'x' }, sec)).campo).toBe('motivo');
    expect((await rpc('baixar_bem', { p_id: bola, p_motivo: 'Furou' }, sec)).ok).toBe(true);
    expect((await rpc('salvar_bem', { p: { id: bola, numero: 'BOL-001', nome: 'Bola nova', categoria: 'bola', origem: 'doacao' } }, sec)).erro).toBe('bem_baixado');
    expect(await db.falha('delete from public.bens where id = $1', 'postgres', [bola])).toMatch(/apag|delete|não/i);
  });
});

describe('governança', () => {
  let reuniao: string;

  test('documento institucional: tesouraria cadastra certidão; diretor só vê; validade vai para a agenda', async () => {
    const id = randomUUID(); const validade = await data('private.hoje() + 20');
    const p = { id, tipo: 'certidao_federal', titulo: 'CND Federal', validade };
    expect((await rpc('salvar_documento_institucional', { p }, dir)).erro).toBe('sem_permissao');
    expect((await rpc('salvar_documento_institucional', { p: { ...p, tipo: 'diploma' } }, tes)).campo).toBe('tipo');
    expect((await rpc('salvar_documento_institucional', { p }, tes)).ok).toBe(true);
    const ag = await rpc('agenda_periodo', { p_inicio: hoje, p_fim: validade }, dir);
    expect(ag.prazos.some((x: { tipo: string; ref: string }) => x.tipo === 'governanca' && x.ref === id)).toBe(true);
    const painel = await rpc('painel_governanca', {}, dir);
    expect(painel.ok).toBe(true);
  });

  test('upload institucional: autorização pelo módulo documentos; registro só pela service role', async () => {
    const id = randomUUID();
    await rpc('salvar_documento_institucional', { p: { id, tipo: 'estatuto', titulo: 'Estatuto social' } }, sec);
    expect((await rpc('autorizar_documento', { p_area: 'institucional', p_documento: id }, dir)).erro).toBe('sem_permissao');
    expect((await rpc('autorizar_documento', { p_area: 'institucional', p_documento: id }, sec)).ok).toBe(true);
    const caminho = `${id}/${randomUUID()}.pdf`;
    await db.linhas(`insert into storage.objects (bucket_id, name, metadata) values ('institucional', $1, '{"mimetype":"application/pdf","size":2048}')`, 'postgres', [caminho]);
    const args = [sec, JSON.stringify({ area: 'institucional', documento_id: id, caminho, sha256: 'b'.repeat(64) })];
    expect(await db.falha(`select public.registrar_documento($1, $2)`, sessao(sec), args)).toMatch(/permission denied/);
    expect((await db.valor(`select public.registrar_documento($1, $2)`, 'service', args)).ok).toBe(true);
    expect(await db.valor('select arquivo_caminho from public.documentos_institucionais where id = $1', 'postgres', [id])).toBe(caminho);
  });

  test('mandato: fim depois do início; vencimento na agenda', async () => {
    const p = { id: randomUUID(), nome: 'Presidente Fictício', cargo: 'Presidente', orgao: 'diretoria', inicio: '2024-01-01', fim: '2023-12-31' };
    expect((await rpc('salvar_mandato', { p }, sec)).campo).toBe('fim');
    expect((await rpc('salvar_mandato', { p: { ...p, fim: await data('private.hoje() + 10') } }, dir)).erro).toBe('sem_permissao');
    expect((await rpc('salvar_mandato', { p: { ...p, fim: await data('private.hoje() + 10') } }, sec)).ok).toBe(true);
  });

  test('reunião: quórum, votos não passam do número de presentes', async () => {
    reuniao = randomUUID();
    const r = { id: reuniao, tipo: 'assembleia_ordinaria', titulo: 'AGO 2026', data: new Date(Date.now() - 3600e3).toISOString(),
      pauta: '1. Contas de 2025\n2. Eleição', quorum_minimo: 3 };
    expect((await rpc('salvar_reuniao', { p: r }, sec)).ok).toBe(true);
    expect((await rpc('salvar_presencas', { p_reuniao: reuniao, p: [{ nome: 'A Fictícia' }, { nome: 'B Fictício' }] }, sec)).quorum_atingido).toBe(false);
    expect((await rpc('salvar_presencas', { p_reuniao: reuniao, p: [{ nome: 'A Fictícia' }, { nome: 'B Fictício' }, { nome: 'C Fictício', membro_id: sec }] }, sec)).quorum_atingido).toBe(true);
    expect((await rpc('salvar_presencas', { p_reuniao: reuniao, p: [{ nome: 'X', papel: 'admin' }] }, sec)).campo).toBe('presencas');
    const d = { id: randomUUID(), ordem: 1, texto: 'Aprovação das contas de 2025', votos_favor: 3, votos_contra: 1, abstencoes: 0, resultado: 'aprovada' };
    expect((await rpc('salvar_deliberacao', { p_reuniao: reuniao, p: d }, sec)).campo).toBe('votos');
    expect((await rpc('salvar_deliberacao', { p_reuniao: reuniao, p: { ...d, votos_contra: 0 } }, sec)).ok).toBe(true);
    const ontem = await data('private.hoje() - 1');
    const ag = await rpc('agenda_periodo', { p_inicio: ontem, p_fim: hoje }, dir);
    expect(ag.prazos.some((x: { tipo: string; ref: string }) => x.tipo === 'reuniao' && x.ref === reuniao)).toBe(true);
  });

  test('ata aprovada fica congelada — pelo app e direto no banco', async () => {
    expect((await rpc('salvar_ata', { p_reuniao: reuniao, p_ata: 'Ata da AGO.', p_aprovada_em: hoje }, sec)).campo).toBe('situacao');
    await rpc('salvar_reuniao', { p: { id: reuniao, tipo: 'assembleia_ordinaria', titulo: 'AGO 2026', data: new Date(Date.now() - 3600e3).toISOString(),
      pauta: '1. Contas de 2025\n2. Eleição', quorum_minimo: 3, situacao: 'realizada' } }, sec);
    expect((await rpc('salvar_ata', { p_reuniao: reuniao, p_ata: 'Ata da AGO.', p_aprovada_em: hoje }, sec)).ok).toBe(true);
    expect((await rpc('salvar_ata', { p_reuniao: reuniao, p_ata: 'Ata trocada.', p_aprovada_em: null }, sec)).erro).toBe('ata_aprovada');
    expect((await rpc('salvar_presencas', { p_reuniao: reuniao, p: [{ nome: 'Intruso' }] }, sec)).erro).toBe('ata_aprovada');
    expect(await db.falha(`update public.reunioes set ata = 'adulterada' where id = $1`, 'postgres', [reuniao])).toMatch(/Ata aprovada/);
    expect(await db.falha(`delete from public.reuniao_presencas where reuniao_id = $1`, 'postgres', [reuniao])).toMatch(/Ata aprovada/);
    expect(await db.falha(`update public.deliberacoes set votos_favor = 99 where reuniao_id = $1`, 'postgres', [reuniao])).toMatch(/Ata aprovada/);
  });
});

describe('filiações', () => {
  let tipo: string, filiacao: string, verba: string;

  test('tipos e cadastro: diretor só vê; campos validados', async () => {
    expect((await rpc('importar_tipos_filiacao', {}, dir)).erro).toBe('sem_permissao');
    expect((await rpc('importar_tipos_filiacao', {}, sec)).criados).toBe(6);
    expect((await rpc('importar_tipos_filiacao', {}, sec)).criados).toBe(0);
    tipo = await db.valor(`select id from public.tipos_filiacao where nome = 'Federação'`);
    filiacao = randomUUID();
    const p = { id: filiacao, entidade: 'Federação Fictícia de Basquete em Cadeira de Rodas', tipo_id: tipo, situacao: 'ativa',
      validade: await data('private.hoje() + 15'), renovacao: await data('private.hoje() + 10'), contribuicao_valor: '600.00', contribuicao_periodicidade: 'anual' };
    expect((await rpc('salvar_filiacao', { p }, dir)).erro).toBe('sem_permissao');
    expect((await rpc('salvar_filiacao', { p: { ...p, situacao: 'regular' } }, sec)).campo).toBe('situacao');
    expect((await rpc('salvar_filiacao', { p: { ...p, contribuicao_periodicidade: 'semanal' } }, sec)).campo).toBe('contribuicao_periodicidade');
    expect((await rpc('salvar_filiacao', { p: { ...p, recorrencia_id: randomUUID() } }, sec)).erro).toBe('invalido');
    expect((await rpc('salvar_filiacao', { p }, sec)).ok).toBe(true);
  });

  test('contribuição anual vira conta a pagar na renovação — só a tesouraria, sem duplicar', async () => {
    expect((await rpc('gerar_contribuicao', { p_filiacao: filiacao, p_categoria: catSaida, p_dia: 5 }, sec)).erro).toBe('sem_permissao');
    const a = await rpc('gerar_contribuicao', { p_filiacao: filiacao, p_categoria: catSaida, p_dia: 5 }, tes);
    expect(a.ok).toBe(true);
    await rpc('gerar_contribuicao', { p_filiacao: filiacao, p_categoria: catSaida, p_dia: 5 }, tes);
    expect(await conta(`select 1 from public.lancamentos where descricao like 'Contribuição — Federação Fictícia%' and situacao = 'prevista'`)).toBe(1);
  });

  test('contribuição mensal vira conta recorrente', async () => {
    const f = randomUUID(); const conf = await db.valor<string>(`select id from public.tipos_filiacao where nome = 'Confederação'`);
    await rpc('salvar_filiacao', { p: { id: f, entidade: 'Confederação Fictícia', tipo_id: conf, contribuicao_valor: '50.00', contribuicao_periodicidade: 'mensal' } }, sec);
    expect((await rpc('gerar_contribuicao', { p_filiacao: f, p_categoria: catSaida, p_dia: 31 }, tes)).campo).toBe('dia');
    expect((await rpc('gerar_contribuicao', { p_filiacao: f, p_categoria: catSaida, p_dia: 5 }, tes)).ok).toBe(true);
    expect(await db.valor(`select r.valor::text from public.filiacoes f join public.recorrencias r on r.id = f.recorrencia_id where f.id = $1`, 'postgres', [f])).toBe('50.00');
  });

  test('checklist: documento entregue ligado a uma certidão vencida conta como pendente', async () => {
    const cert = randomUUID();
    await rpc('salvar_documento_institucional', { p: { id: cert, tipo: 'certidao_fgts', titulo: 'CRF FGTS antiga', validade: await data('private.hoje() - 1') } }, sec);
    expect((await rpc('salvar_documento_filiacao', { p_filiacao: filiacao, p: { id: randomUUID(), nome: 'CRF FGTS', documento_institucional_id: cert, entregue: true } }, dir)).erro).toBe('sem_permissao');
    expect((await rpc('salvar_documento_filiacao', { p_filiacao: filiacao, p: { id: randomUUID(), nome: 'CRF FGTS', documento_institucional_id: cert, entregue: true } }, sec)).ok).toBe(true);
    expect((await rpc('salvar_documento_filiacao', { p_filiacao: filiacao, p: { id: randomUUID(), nome: 'crf fgts' } }, sec)).erro).toBe('duplicado');
    const painel = await rpc('painel_filiacoes', {}, dir);
    expect(painel.filiacoes.find((x: { id: string }) => x.id === filiacao).documentos_pendentes).toBe(1);
  });

  test('verba que depende de filiação suspensa aparece em risco; renovação na agenda', async () => {
    const tipoV = randomUUID(), origem = randomUUID(); verba = randomUUID();
    await rpc('salvar_tipo_verba', { p: { id: tipoV, nome: 'Patrocínio' } }, tes);
    await rpc('salvar_origem_verba', { p: { id: origem, nome: 'Empresa Fictícia', categoria: 'empresa' } }, tes);
    expect((await rpc('salvar_verba', { p: { id: verba, titulo: 'Patrocínio de campeonato', tipo_id: tipoV, origem_id: origem, forma_recebimento: 'caixa_livre' } }, tes)).ok).toBe(true);
    expect((await rpc('definir_dependencia_verba', { p_verba: verba, p_filiacao: filiacao }, dir)).erro).toBe('sem_permissao');
    expect((await rpc('definir_dependencia_verba', { p_verba: verba, p_filiacao: randomUUID() }, tes)).campo).toBe('filiacao_id');
    expect((await rpc('definir_dependencia_verba', { p_verba: verba, p_filiacao: filiacao }, tes)).ok).toBe(true);
    const emDia = await rpc('painel_filiacoes', {}, tes);
    expect(emDia.filiacoes.find((x: { id: string }) => x.id === filiacao).verbas_em_risco).toEqual([]);
    const f = await db.linhas('select * from public.filiacoes where id = $1', 'postgres', [filiacao]);
    await rpc('salvar_filiacao', { p: { id: filiacao, entidade: f[0].entidade, tipo_id: tipo, situacao: 'suspensa' } }, sec);
    const risco = await rpc('painel_filiacoes', {}, tes);
    expect(risco.filiacoes.find((x: { id: string }) => x.id === filiacao).verbas_em_risco.map((v: { id: string }) => v.id)).toEqual([verba]);
  });

  test('agenda: renovação e vencimento de filiação aparecem para quem vê filiações; saúde nunca', async () => {
    const f2 = randomUUID();
    await rpc('salvar_filiacao', { p: { id: f2, entidade: 'Comitê Fictício', tipo_id: tipo, situacao: 'ativa', renovacao: await data('private.hoje() + 5') } }, sec);
    const ag = await rpc('agenda_periodo', { p_inicio: hoje, p_fim: await data('private.hoje() + 30') }, dir);
    expect(ag.prazos.some((x: { tipo: string; ref: string }) => x.tipo === 'filiacao' && x.ref === f2)).toBe(true);
    expect(ag.prazos.some((x: { tipo: string }) => x.tipo === 'saude')).toBe(false);
  });
});
