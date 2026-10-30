import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco;
let pres: string, sec: string, tes: string, dir: string;
let hoje: string, cat: string, conta: string, catEntrada: string, adulto: string, menor: string, mesAtual: string;

const rpc = (nome: string, args: Record<string, unknown>, quem: string) => db.rpc(nome, args, sessao(quem));
const data = (expr: string) => db.valor<string>(`select to_char(${expr}, 'YYYY-MM-DD')`);
const conta_ = (sql: string, params?: unknown[]) => db.valor<number>(`select count(*)::int from (${sql}) t`, 'postgres', params);
const pessoa = (extra: Record<string, unknown> = {}) => ({ id: randomUUID(), nome: 'Atleta Fictício', atleta: true, associado: true, ...extra });

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  await convidarMembro(db, pres, { email: 'vice@exemplo.test', nome: 'Vice', cargo: 'vice_presidente' });
  sec = await convidarMembro(db, pres, { email: 'sec@exemplo.test', nome: 'Secretária', cargo: 'secretario' });
  tes = await convidarMembro(db, pres, { email: 'tes@exemplo.test', nome: 'Tesoureira', cargo: 'tesoureiro' });
  dir = await convidarMembro(db, pres, { email: 'dir@exemplo.test', nome: 'Diretor', cargo: 'diretor' });
  hoje = await data('private.hoje()');
  mesAtual = await data(`date_trunc('month', private.hoje())`);
  conta = randomUUID(); catEntrada = randomUUID();
  await rpc('salvar_conta', { p: { id: conta, nome: 'Conta Movimento', tipo: 'movimento', saldo_inicial: '0', data_saldo_inicial: '2026-01-01' } }, tes);
  await rpc('salvar_categoria', { p: { id: catEntrada, nome: 'Mensalidades', tipo: 'entrada' } }, tes);
});
afterAll(async () => { await db?.destruir(); });

describe('cadastro de pessoas', () => {
  test('diretor só vê; secretaria cadastra; campos extras recusados (sem login de atleta pelo formulário)', async () => {
    expect((await rpc('salvar_pessoa', { p: pessoa() }, dir)).erro).toBe('sem_permissao');
    expect((await rpc('salvar_pessoa', { p: { ...pessoa(), membro_id: dir } }, sec)).erro).toBe('invalido');
    expect((await rpc('salvar_pessoa', { p: { ...pessoa(), atleta: false, associado: false } }, sec)).campo).toBe('atleta');
    expect((await rpc('salvar_pessoa', { p: { ...pessoa(), email: 'não é e-mail' } }, sec)).campo).toBe('email');
    expect((await rpc('salvar_pessoa', { p: { ...pessoa(), data_nascimento: '2999-01-01' } }, sec)).campo).toBe('data_nascimento');
  });

  test('menor de idade sem responsável legal é recusado', async () => {
    const nasc = await data(`private.hoje() - interval '12 years'`);
    menor = randomUUID();
    expect((await rpc('salvar_pessoa', { p: { ...pessoa({ id: menor, nome: 'Atleta Menor' }), data_nascimento: nasc } }, sec)).erro).toBe('responsavel_obrigatorio');
    expect((await rpc('salvar_pessoa', { p: { ...pessoa({ id: menor, nome: 'Atleta Menor' }), data_nascimento: nasc, responsavel_nome: 'Mãe Fictícia', responsavel_contato: '(11) 90000-0000' } }, sec)).ok).toBe(true);
  });

  test('categoria e mensalidade gerada uma vez só (inclusive em paralelo)', async () => {
    cat = randomUUID(); adulto = randomUUID();
    expect((await rpc('salvar_categoria_socio', { p: { id: cat, nome: 'Atleta', valor_mensalidade: '30.00', dia_vencimento: 10 } }, sec)).ok).toBe(true);
    expect((await rpc('salvar_pessoa', { p: pessoa({ id: adulto, categoria_id: cat, telefone: '(16) 99999-0000' }) }, sec)).ok).toBe(true);
    expect(await db.valor('select telefone from public.pessoas where id = $1', 'postgres', [adulto])).toBe('16999990000');
    expect((await rpc('gerar_mensalidades', { p_competencia: hoje }, sec)).campo).toBe('competencia');
    const r = await Promise.all([1, 2, 3].map(() => rpc('gerar_mensalidades', { p_competencia: mesAtual }, sec)));
    expect(r.reduce((s, x) => s + x.criadas, 0)).toBe(1);
    expect(await db.valor<string>(`select txid from public.mensalidades where pessoa_id = $1`, 'postgres', [adulto])).toMatch(/^ERPX[0-9A-F]{21}$/);
  });
});

describe('mensalidades', () => {
  let mens: string;
  test('baixa só com entrada realizada, uma vez; não serve para duas cobranças', async () => {
    mens = await db.valor('select id from public.mensalidades where pessoa_id = $1', 'postgres', [adulto]);
    const entrada = randomUUID(), saida = randomUUID(), catS = randomUUID();
    await rpc('salvar_categoria', { p: { id: catS, nome: 'Material', tipo: 'saida' } }, tes);
    await rpc('criar_lancamento', { p: { id: entrada, tipo: 'entrada', situacao: 'realizada', valor: '30.00', data: hoje, descricao: 'Pix mensalidade', categoria_id: catEntrada, conta_id: conta } }, tes);
    await rpc('criar_lancamento', { p: { id: saida, tipo: 'saida', situacao: 'realizada', valor: '30.00', data: hoje, descricao: 'Saída qualquer', categoria_id: catS, conta_id: conta } }, tes);
    expect((await rpc('registrar_pagamento_mensalidade', { p_id: mens, p_lancamento: saida }, tes)).campo).toBe('lancamento_id');
    expect((await rpc('registrar_pagamento_mensalidade', { p_id: mens, p_lancamento: entrada }, dir)).erro).toBe('sem_permissao'); // baixa é da tesouraria (financeiro/editar)
  });

  test('tesouraria dá baixa; repetir é recusado; reabrir paga exige financeiro/editar', async () => {
    const entrada = await db.valor<string>(`select id from public.lancamentos where descricao = 'Pix mensalidade'`);
    expect((await rpc('registrar_pagamento_mensalidade', { p_id: mens, p_lancamento: entrada }, tes)).ok).toBe(true);
    expect((await rpc('registrar_pagamento_mensalidade', { p_id: mens, p_lancamento: entrada }, tes)).erro).toBe('ja_paga');
    expect((await rpc('mudar_mensalidade', { p_id: mens, p_situacao: 'aberta', p_motivo: null }, sec)).erro).toBe('sem_permissao');
    expect((await rpc('mudar_mensalidade', { p_id: mens, p_situacao: 'paga', p_motivo: 'x' }, pres)).campo).toBe('situacao');
  });

  test('dispensar exige motivo; desligar cancela as futuras em aberto', async () => {
    const prox = await data(`date_trunc('month', private.hoje()) + interval '1 month'`);
    await rpc('gerar_mensalidades', { p_competencia: prox }, sec);
    const futura = await db.valor<string>('select id from public.mensalidades where pessoa_id = $1 and competencia = $2', 'postgres', [adulto, prox]);
    expect((await rpc('mudar_mensalidade', { p_id: futura, p_situacao: 'dispensada', p_motivo: '' }, sec)).campo).toBe('motivo');
    expect((await rpc('salvar_pessoa', { p: pessoa({ id: adulto, categoria_id: cat, situacao: 'desligado' }) }, sec)).ok).toBe(true);
    expect(await db.valor('select situacao from public.mensalidades where id = $1', 'postgres', [futura])).toBe('cancelada');
    expect(await db.valor('select situacao from public.mensalidades where id = $1', 'postgres', [mens])).toBe('paga');
    expect(await db.falha('delete from public.pessoas where id = $1', 'postgres', [adulto])).toMatch(/não se apaga/);
  });

  test('chave Pix: só quem administra o financeiro; formato validado', async () => {
    expect((await rpc('salvar_config_pix', { p: { chave: 'contato@exemplo.org', nome: 'Associação Exemplo', cidade: 'CIDADE EXEMPLO' } }, sec)).erro).toBe('sem_permissao');
    expect((await rpc('salvar_config_pix', { p: { chave: '123', nome: 'Associação Exemplo', cidade: 'CIDADE EXEMPLO' } }, tes)).campo).toBe('chave');
    expect((await rpc('salvar_config_pix', { p: { chave: 'contato@exemplo.org', nome: 'Associação Exemplo', cidade: 'CIDADE EXEMPLO' } }, tes)).campo).toBe('nome');
    expect((await rpc('salvar_config_pix', { p: { chave: 'ERP@exemplo.org', nome: 'ASSOC EXEMPLO', cidade: 'Cidade Exemplo' } }, tes)).ok).toBe(true);
    expect(await db.valor(`select valor from public.configuracoes where chave = 'pix'`, sessao(dir))).toEqual({ chave: 'erp@exemplo.org', nome: 'ASSOC EXEMPLO', cidade: 'CIDADE EXEMPLO' });
  });
});

test('autorização de saúde não aparece para quem só vê o cadastro', async () => {
  const x = randomUUID();
  await db.linhas(`insert into public.consentimentos (id, pessoa_id, finalidade, base_legal, concedido_por, nome_concedente, concedido_em, registrado_por)
    select $1, id, 'saude', 'exigencia_esportiva', 'titular', 'Fulano Fictício', private.hoje(), $2 from public.pessoas limit 1`, 'postgres', [x, pres]);
  expect(await db.valor<number>(`select count(*)::int from public.consentimentos where id = $1`, sessao(dir), [x])).toBe(0);
  await db.linhas(`update public.consentimentos set revogado_em = now() where id = $1`, 'postgres', [x]);
});

describe('área de saúde', () => {
  let atleta: string;
  test('ninguém tem saúde por padrão; presidente não lê', async () => {
    atleta = randomUUID();
    await rpc('salvar_pessoa', { p: pessoa({ id: atleta, nome: 'Atleta Saúde' }) }, sec);
    expect((await rpc('salvar_saude', { p_pessoa: atleta, p: { classe_funcional: '4.5' } }, pres)).erro).toBe('sem_permissao');
    // administrador libera a área de saúde só para a secretaria (comissão técnica, no exemplo)
    const atuais = await db.valor<{ modulo: string; acao: string; alcance: string }[]>(
      `select jsonb_agg(jsonb_build_object('modulo', modulo, 'acao', acao, 'alcance', alcance)) from public.permissoes where membro_id = $1`, 'postgres', [sec]);
    expect((await rpc('definir_permissoes', { p_membro: sec, p_permissoes: [...atuais, { modulo: 'saude', acao: 'ver', alcance: 'tudo' }, { modulo: 'saude', acao: 'editar', alcance: 'tudo' }] }, pres)).ok).toBe(true);
  });

  test('sem consentimento o banco recusa gravar (fail closed)', async () => {
    expect((await rpc('salvar_saude', { p_pessoa: atleta, p: { classe_funcional: '4.5' } }, sec)).erro).toBe('sem_consentimento');
    expect((await rpc('salvar_documento_saude', { p: { id: randomUUID(), pessoa_id: atleta, tipo: 'laudo' } }, sec)).erro).toBe('sem_consentimento');
  });

  test('consentimento de saúde: só quem cuida da saúde registra; de menor, só pelo responsável', async () => {
    const c = { id: randomUUID(), pessoa_id: atleta, finalidade: 'saude', base_legal: 'consentimento', concedido_por: 'titular', nome_concedente: 'Atleta Saúde', concedido_em: hoje };
    expect((await rpc('registrar_consentimento', { p: c }, pres)).erro).toBe('sem_permissao');
    expect((await rpc('registrar_consentimento', { p: { ...c, id: randomUUID(), pessoa_id: menor, nome_concedente: 'Atleta Menor' } }, sec)).campo).toBe('concedido_por');
    expect((await rpc('registrar_consentimento', { p: c }, sec)).ok).toBe(true);
    expect((await rpc('registrar_consentimento', { p: { ...c, id: randomUUID() } }, sec)).erro).toBe('ja_existe');
  });

  test('com consentimento grava; quem não tem o módulo não lê; auditoria guarda só os nomes dos campos', async () => {
    expect((await rpc('salvar_saude', { p_pessoa: atleta, p: { classe_funcional: '4.5', deficiencia: 'Lesão medular fictícia' } }, sec)).ok).toBe(true);
    expect(await db.valor<number>('select count(*)::int from public.pessoa_saude', sessao(pres))).toBe(0);
    expect(await db.valor<number>('select count(*)::int from public.pessoa_saude', sessao(sec))).toBe(1);
    const aud = await db.valor<unknown>(`select depois from public.auditoria where tabela = 'pessoa_saude' order by id desc limit 1`);
    expect(JSON.stringify(aud)).not.toMatch(/medular|4\.5/);
    expect(JSON.stringify(aud)).toContain('classe_funcional');
  });

  test('arquivo de laudo: autoriza como o usuário; registra só a service role; caminho fixo', async () => {
    const doc = randomUUID();
    expect((await rpc('salvar_documento_saude', { p: { id: doc, pessoa_id: atleta, tipo: 'laudo', validade: await data('private.hoje() + 20') } }, sec)).ok).toBe(true);
    expect((await rpc('autorizar_documento', { p_area: 'saude', p_documento: doc }, pres)).erro).toBe('sem_permissao');
    expect((await rpc('autorizar_documento', { p_area: 'saude', p_documento: doc }, sec)).ok).toBe(true);
    const caminho = `${doc}/${randomUUID()}.pdf`;
    await db.linhas(`insert into storage.objects (bucket_id, name, metadata) values ('saude', $1, '{"mimetype":"application/pdf","size":1234}')`, 'postgres', [caminho]);
    expect(await db.falha(`select public.registrar_documento($1, $2)`, sessao(sec), [sec, JSON.stringify({ area: 'saude', documento_id: doc, caminho, sha256: 'a'.repeat(64) })])).toMatch(/permission denied/);
    expect((await db.valor(`select public.registrar_documento($1, $2)`, 'service', [sec, JSON.stringify({ area: 'saude', documento_id: doc, caminho: `../${caminho}`, sha256: 'a'.repeat(64) })])).campo).toBe('caminho');
    expect((await db.valor(`select public.registrar_documento($1, $2)`, 'service', [sec, JSON.stringify({ area: 'saude', documento_id: doc, caminho, sha256: 'a'.repeat(64) })])).ok).toBe(true);
    const r = await rpc('resumo_pessoas', {}, sec);
    expect(r.saude_vencendo).toBe(1);
    expect((await rpc('resumo_pessoas', {}, dir)).saude_vencendo).toBeNull();
  });

  test('revogar apaga os dados de saúde e põe o arquivo na fila de remoção', async () => {
    const c = await db.valor<string>(`select id from public.consentimentos where pessoa_id = $1 and finalidade = 'saude'`, 'postgres', [atleta]);
    expect((await rpc('revogar_consentimento', { p_id: c }, dir)).erro).toBe('sem_permissao');
    expect((await rpc('revogar_consentimento', { p_id: c }, sec)).dados_apagados).toBe(true);
    expect(await conta_('select * from public.pessoa_saude where pessoa_id = $1', [atleta])).toBe(0);
    expect(await conta_('select * from public.documentos_saude where pessoa_id = $1', [atleta])).toBe(0);
    const fila = await db.valor<{ arquivos: { bucket: string }[] }>('select public.pegar_arquivos_remover(10)', 'service');
    expect(fila.arquivos.map((a) => a.bucket)).toEqual(['saude']);
    expect((await rpc('salvar_saude', { p_pessoa: atleta, p: { classe_funcional: '4.5' } }, sec)).erro).toBe('sem_consentimento');
  });

  test('exigência esportiva: revogar não apaga (há base legal própria)', async () => {
    const id = randomUUID();
    await rpc('registrar_consentimento', { p: { id, pessoa_id: atleta, finalidade: 'saude', base_legal: 'exigencia_esportiva', concedido_por: 'titular', nome_concedente: 'Atleta Saúde', concedido_em: hoje } }, sec);
    await rpc('salvar_saude', { p_pessoa: atleta, p: { classe_funcional: '2.0' } }, sec);
    expect((await rpc('revogar_consentimento', { p_id: id }, sec)).dados_apagados).toBe(false);
    expect(await conta_('select * from public.pessoa_saude where pessoa_id = $1', [atleta])).toBe(1);
  });

  test('retenção: saúde de desligado há mais de 1 ano e contatos há mais de 5 saem; nome e mensalidades ficam', async () => {
    await db.linhas(`update public.pessoas set situacao = 'desligado', desligado_em = private.hoje() - 400 where id = $1`, 'postgres', [atleta]);
    await db.linhas(`update public.pessoas set desligado_em = private.hoje() - 2000, email = 'ex@exemplo.test' where id = $1`, 'postgres', [adulto]);
    const r = await db.valor('select private.aplicar_retencao()', 'postgres');
    expect(r).toMatchObject({ saude: 1, contatos: 1 });
    expect(await conta_('select * from public.pessoa_saude where pessoa_id = $1', [atleta])).toBe(0);
    expect(await db.valor('select email from public.pessoas where id = $1', 'postgres', [adulto])).toBeNull();
    expect(await db.valor('select nome from public.pessoas where id = $1', 'postgres', [adulto])).toBe('Atleta Fictício');
    expect(await conta_('select * from public.mensalidades where pessoa_id = $1', [adulto])).toBe(2);
  });
});
