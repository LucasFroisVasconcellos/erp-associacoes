import fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco;
let pres: string, tes: string, dir: string, dirProprios: string;
let mesPassado: string, competencia: string, conta: string, catE: string, catS: string;
const rpc = (nome: string, args: Record<string, unknown>, quem: string) => db.rpc(nome, args, sessao(quem));
const data = (expr: string) => db.valor<string>(`select to_char(${expr}, 'YYYY-MM-DD')`);

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  tes = await convidarMembro(db, pres, { email: 'tes@exemplo.test', nome: 'Tesoureira', cargo: 'tesoureiro' });
  dir = await convidarMembro(db, pres, { email: 'dir@exemplo.test', nome: 'Diretor', cargo: 'diretor' });
  dirProprios = await convidarMembro(db, pres, { email: 'dp@exemplo.test', nome: 'Diretor Próprios', cargo: 'diretor' });
  await db.linhas(`update public.permissoes set alcance = 'proprios' where membro_id = $1 and modulo = 'financeiro'`, 'postgres', [dirProprios]);
  mesPassado = await data(`date_trunc('month', private.hoje()) - interval '1 month' + interval '4 days'`);
  competencia = mesPassado.slice(0, 8) + '01';
  conta = randomUUID(); catE = randomUUID(); catS = randomUUID();
  await rpc('salvar_conta', { p: { id: conta, nome: 'Conta Movimento', tipo: 'movimento', saldo_inicial: '0', data_saldo_inicial: '2024-01-01' } }, tes);
  await rpc('salvar_categoria', { p: { id: catE, nome: 'Doações', tipo: 'entrada' } }, tes);
  await rpc('salvar_categoria', { p: { id: catS, nome: 'Material esportivo', tipo: 'saida' } }, tes);
});
afterAll(async () => { await db?.destruir(); });

const plano = [
  { codigo: '3.1.01', nome: 'Doações recebidas', natureza: 'receita' },
  { codigo: '4.1.02', nome: 'Material esportivo', natureza: 'despesa' },
  { codigo: '1.1.01', nome: 'Banco conta movimento', natureza: 'ativo' },
];

describe('plano de contas', () => {
  test('só quem administra o financeiro importa; campos extras e código inválido são recusados', async () => {
    expect((await rpc('importar_plano_contas', { p_lote: randomUUID(), p_arquivo: 'plano.csv', p: plano }, dir)).erro).toBe('sem_permissao');
    expect((await rpc('importar_plano_contas', { p_lote: randomUUID(), p_arquivo: 'plano.csv', p: [{ ...plano[0], admin: true }] }, tes)).campo).toBe('linhas');
    expect((await rpc('importar_plano_contas', { p_lote: randomUUID(), p_arquivo: 'plano.csv', p: [{ ...plano[0], codigo: "1'; drop" }] }, tes)).campo).toBe('linhas');
    expect((await rpc('importar_plano_contas', { p_lote: randomUUID(), p_arquivo: 'plano.csv', p: [plano[0], plano[0]] }, tes)).campo).toBe('codigo');
  });
  test('importa, repete o lote sem efeito e reimporta atualizando o nome', async () => {
    const lote = randomUUID();
    expect(await rpc('importar_plano_contas', { p_lote: lote, p_arquivo: 'plano.csv', p: plano }, tes)).toMatchObject({ ok: true, novas: 3 });
    expect(await rpc('importar_plano_contas', { p_lote: lote, p_arquivo: 'plano.csv', p: plano }, tes)).toMatchObject({ ok: true, repetido: true });
    const r = await rpc('importar_plano_contas', { p_lote: randomUUID(), p_arquivo: 'plano2.csv', p: [{ ...plano[0], nome: 'Doações de pessoas' }] }, tes);
    expect(r).toMatchObject({ ok: true, novas: 0 });
    expect(await db.valor(`select nome from public.plano_contas where codigo = '3.1.01'`)).toBe('Doações de pessoas');
  });
  test('categoria de saída só liga em conta de despesa', async () => {
    const receita = await db.valor<string>(`select id from public.plano_contas where codigo = '3.1.01'`);
    const despesa = await db.valor<string>(`select id from public.plano_contas where codigo = '4.1.02'`);
    expect((await rpc('vincular_categoria_conta', { p_categoria: catS, p_conta: receita }, tes)).campo).toBe('conta_contabil_id');
    expect((await rpc('vincular_categoria_conta', { p_categoria: catS, p_conta: despesa }, dir)).erro).toBe('sem_permissao');
    expect(await rpc('vincular_categoria_conta', { p_categoria: catS, p_conta: despesa }, tes)).toMatchObject({ ok: true });
    expect(await rpc('vincular_categoria_conta', { p_categoria: catE, p_conta: receita }, tes)).toMatchObject({ ok: true });
  });
});

describe('lançamentos em lote', () => {
  const linha = (extra: Record<string, unknown> = {}) => ({ id: randomUUID(), tipo: 'saida', valor: '89.90', data: mesPassado,
    descricao: 'Bolas de treino', categoria_id: catS, conta_id: conta, ...extra });
  test('tudo ou nada: uma linha ruim recusa o lote e diz qual', async () => {
    const lote = [linha(), linha({ valor: '0' }), linha({ categoria_id: catE })];
    const r = await rpc('importar_lancamentos', { p_lote: randomUUID(), p_arquivo: 'antigo.xlsx', p: lote }, tes);
    expect(r).toMatchObject({ ok: false, erro: 'linhas_invalidas' });
    expect(r.problemas).toEqual([{ linha: 2, erro: 'invalido', campo: 'valor' }, { linha: 3, erro: 'invalido', campo: 'categoria_id' }]);
    expect(await db.valor('select count(*)::int from public.lancamentos')).toBe(0);
  });
  test('campos extras (situacao, criado_por) e permissão', async () => {
    const r = await rpc('importar_lancamentos', { p_lote: randomUUID(), p_arquivo: 'a.csv', p: [linha({ criado_por: pres })] }, tes);
    expect(r.problemas[0]).toMatchObject({ linha: 1, erro: 'invalido' });
    expect((await rpc('importar_lancamentos', { p_lote: randomUUID(), p_arquivo: 'a.csv', p: [linha()] }, dir)).erro).toBe('sem_permissao');
  });
  test('importa; repetir o lote ou as mesmas linhas em outro arquivo não duplica', async () => {
    const lote = randomUUID(); const linhas = [linha(), linha({ tipo: 'entrada', categoria_id: catE, valor: '500.00', descricao: 'Doação' })];
    expect(await rpc('importar_lancamentos', { p_lote: lote, p_arquivo: 'antigo.xlsx', p: linhas }, tes)).toMatchObject({ ok: true, novas: 2 });
    expect(await rpc('importar_lancamentos', { p_lote: lote, p_arquivo: 'antigo.xlsx', p: linhas }, tes)).toMatchObject({ repetido: true });
    expect(await rpc('importar_lancamentos', { p_lote: randomUUID(), p_arquivo: 'copia.xlsx', p: linhas }, tes)).toMatchObject({ ok: true, novas: 0, repetidas: 2 });
    expect(await db.valor('select count(*)::int from public.lancamentos where importacao_id = $1', 'postgres', [lote])).toBe(2);
  });
  test('data antes do saldo inicial da conta é recusada', async () => {
    const r = await rpc('importar_lancamentos', { p_lote: randomUUID(), p_arquivo: 'a.csv', p: [linha({ data: '2023-05-01' })] }, tes);
    expect(r.problemas[0]).toMatchObject({ campo: 'data' });
  });
});

describe('extrato → lançamentos', () => {
  let tarifa: string, deposito: string;
  beforeAll(async () => {
    await rpc('importar_extrato', { p_conta: conta, p: [
      { data: mesPassado, valor: '-12.90', descricao: 'TARIFA PACOTE', id: 'T1' },
      { data: mesPassado, valor: '300.00', descricao: 'PIX JOAO', id: 'T2' }] }, tes);
    tarifa = await db.valor<string>(`select id from public.extrato_linhas where chave = 'id:T1'`);
    deposito = await db.valor<string>(`select id from public.extrato_linhas where chave = 'id:T2'`);
  });
  test('quem só vê os próprios lançamentos não pode; categoria de tipo errado recusa tudo', async () => {
    const p = [{ linha: tarifa, id: randomUUID(), categoria_id: catS }, { linha: deposito, id: randomUUID(), categoria_id: catS }];
    expect((await rpc('lancar_do_extrato', { p }, dirProprios)).erro).toBe('sem_permissao');
    expect((await rpc('lancar_do_extrato', { p }, tes)).campo).toBe('categoria_id');
    expect(await db.valor(`select count(*)::int from public.extrato_linhas where lancamento_id is not null`)).toBe(0);
  });
  test('cria e concilia; repetir o envio não duplica', async () => {
    const p = [{ linha: tarifa, id: randomUUID(), categoria_id: catS, descricao: 'Tarifa bancária' }, { linha: deposito, id: randomUUID(), categoria_id: catE }];
    expect(await rpc('lancar_do_extrato', { p }, tes)).toMatchObject({ ok: true, criados: 2 });
    expect(await rpc('lancar_do_extrato', { p }, tes)).toMatchObject({ ok: true, criados: 0 });
    expect(await db.valor(`select l.valor::text from public.extrato_linhas e join public.lancamentos l on l.id = e.lancamento_id where e.id = $1`, 'postgres', [tarifa])).toBe('12.90');
    expect((await rpc('lancar_do_extrato', { p: [{ linha: tarifa, id: randomUUID(), categoria_id: catS }] }, tes)).erro).toBe('ja_conciliada');
  });
});

describe('balancete do contador', () => {
  const bal = [
    { codigo: '3.1.01', nome: 'Doações recebidas', debito: '0', credito: '800.00' },
    { codigo: '4.1.02', nome: 'Material esportivo', debito: '102.80', credito: '0' },
  ];
  test('importa por mês; valores inválidos e permissão', async () => {
    expect((await rpc('importar_balancete', { p_lote: randomUUID(), p_arquivo: 'b.csv', p_competencia: competencia, p: [{ ...bal[0], debito: '-1' }] }, tes)).campo).toBe('linhas');
    expect((await rpc('importar_balancete', { p_lote: randomUUID(), p_arquivo: 'b.csv', p_competencia: mesPassado, p: bal }, tes)).campo).toBe('competencia');
    expect((await rpc('importar_balancete', { p_lote: randomUUID(), p_arquivo: 'b.csv', p_competencia: competencia, p: bal }, dirProprios)).erro).toBe('sem_permissao');
    expect(await rpc('importar_balancete', { p_lote: randomUUID(), p_arquivo: 'balancete.csv', p_competencia: competencia, p: bal }, tes)).toMatchObject({ ok: true, linhas: 2 });
  });
  test('compara com o que a diretoria lançou e aponta a diferença', async () => {
    const r = await rpc('comparar_balancete', { p_competencia: competencia }, tes);
    expect(r.balancete.arquivo).toBe('balancete.csv');
    const doacoes = r.contas.find((c: { codigo: string }) => c.codigo === '3.1.01');
    const material = r.contas.find((c: { codigo: string }) => c.codigo === '4.1.02');
    expect(doacoes).toMatchObject({ sistema: '800.00', contador: '800.00', diferenca: '0.00' });
    expect(material).toMatchObject({ sistema: '102.80', contador: '102.80', diferenca: '0.00' });
    expect((await rpc('comparar_balancete', { p_competencia: competencia }, dirProprios)).erro).toBe('sem_permissao');
  });
  test('RLS: quem só vê os próprios lançamentos não lê balancete nem lotes', async () => {
    expect(await db.linhas('select * from public.balancete_linhas', sessao(dirProprios))).toHaveLength(0);
    expect(await db.linhas('select * from public.importacoes', sessao(dirProprios))).toHaveLength(0);
    expect((await db.linhas('select * from public.balancete_linhas', sessao(tes))).length).toBe(2);
  });
});

const feio = fc.oneof(
  fc.string(), fc.integer(), fc.double(), fc.boolean(), fc.constant(null),
  fc.constantFrom("'; drop table public.lancamentos; --", '-1.00', '99999999999.99', '2026-02-30', '00000000-0000-0000-0000-000000000000', 'a\u0007b', '9.9.9.9.9.9.9.9', '1'.repeat(300)),
  fc.dictionary(fc.string({ maxLength: 10 }), fc.oneof(fc.string(), fc.integer()), { maxKeys: 3 }),
);
const recusaDeTipo = (m: string) => /unsupported Unicode escape sequence|cannot be converted to text|invalid byte sequence|null character|invalid input syntax for type (uuid|date|json|integer)|out of range/.test(m);

describe('fuzz das importações', () => {
  async function chamar(nome: string, args: Record<string, unknown>) {
    await db.linhas('delete from private.limites');
    try { return await db.rpc(nome, args, sessao(tes)); }
    catch (e) { const m = (e as Error).message; return recusaDeTipo(m) ? { erro: 'recusado_no_tipo' } : { excecao: m }; }
  }
  const lista = (r: fc.Arbitrary<unknown>) => fc.oneof(feio, fc.array(r, { maxLength: 4 }));
  test('entradas aleatórias nunca viram exceção nem dado inválido', async () => {
    const casos: [string, fc.Arbitrary<unknown>, (v: any) => Record<string, unknown>][] = [
      ['importar_plano_contas', lista(fc.record({ codigo: feio, nome: feio, natureza: feio }, { requiredKeys: [] })), (p) => ({ p_lote: randomUUID(), p_arquivo: 'f.csv', p })],
      ['importar_lancamentos', lista(fc.record({ id: fc.oneof(fc.uuid(), feio), tipo: feio, valor: feio, data: feio, descricao: feio, categoria_id: fc.oneof(fc.constant(catS), feio), conta_id: fc.oneof(fc.constant(conta), feio) }, { requiredKeys: [] })),
        (p) => ({ p_lote: randomUUID(), p_arquivo: 'f.csv', p })],
      ['lancar_do_extrato', lista(fc.record({ linha: fc.oneof(fc.uuid(), feio), id: fc.oneof(fc.uuid(), feio), categoria_id: feio, descricao: feio }, { requiredKeys: [] })), (p) => ({ p })],
      ['importar_balancete', lista(fc.record({ codigo: feio, nome: feio, debito: feio, credito: feio, saldo_anterior: feio, saldo_atual: feio }, { requiredKeys: [] })),
        (p) => ({ p_lote: randomUUID(), p_arquivo: 'b.csv', p_competencia: competencia, p })],
    ];
    let semente = 20261027;
    for (const [nome, gerar, args] of casos) {
      await fc.assert(fc.asyncProperty(gerar, async (v) => { expect(await chamar(nome, args(v))).not.toHaveProperty('excecao'); }), { numRuns: 150, seed: semente++ });
    }
    expect(await db.valor(`select count(*)::int from public.lancamentos l join public.categorias c on c.id = l.categoria_id where c.tipo <> l.tipo or l.valor <= 0`)).toBe(0);
  });
});

async function mutar(banco: Banco, assinatura: string, de: string, para: string) {
  const def = await banco.valor<string>(`select pg_get_functiondef('${assinatura}'::regprocedure)`);
  if (!def.includes(de)) throw new Error(`mutação inválida: "${de}" não está em ${assinatura}`);
  await banco.linhas(def.replace(de, para));
}

describe('mutação dos controles das importações', () => {
  // cada ataque falha no banco original e passa no banco com o controle desligado
  const linhaErrada = () => ({ id: randomUUID(), tipo: 'saida', valor: '5.00', data: mesPassado, descricao: 'Errado', categoria_id: catE, conta_id: conta });
  const MUTANTES: { controle: string; assinatura: string; de: string; para: string; ataque: () => Promise<boolean> }[] = [
    { controle: 'lote só com financeiro/administrar', assinatura: 'private.importar_lancamentos(uuid,text,jsonb)',
      de: "private.checar('importar_lancamentos', 'financeiro', 'administrar')", para: "private.checar('importar_lancamentos', 'financeiro', 'ver')",
      ataque: async () => (await rpc('importar_lancamentos', { p_lote: randomUUID(), p_arquivo: 'x.csv', p: [{ ...linhaErrada(), categoria_id: catS }] }, dir)).ok === true },
    { controle: 'lote é tudo ou nada', assinatura: 'private.importar_lancamentos(uuid,text,jsonb)',
      de: "if jsonb_array_length(v_problemas) > 0 then", para: 'if false then',
      ataque: async () => (await rpc('importar_lancamentos', { p_lote: randomUUID(), p_arquivo: 'x.csv', p: [linhaErrada()] }, tes)).ok === true },
    { controle: 'extrato → lançamento valida a categoria', assinatura: 'private.lancar_do_extrato(jsonb)',
      de: "if v_e is not null then return v_e || jsonb_build_object('linha', e.id); end if;", para: '',
      ataque: async () => {
        await rpc('importar_extrato', { p_conta: conta, p: [{ data: mesPassado, valor: '-7.00', descricao: 'MUT', id: 'MUT-' + randomUUID().slice(0, 8) }] }, tes);
        const l = await db.valor<string>(`select id from public.extrato_linhas where descricao = 'MUT' and lancamento_id is null limit 1`);
        return (await rpc('lancar_do_extrato', { p: [{ linha: l, id: randomUUID(), categoria_id: catE }] }, tes)).ok === true;
      } },
    { controle: 'comparação só para quem vê o financeiro inteiro', assinatura: 'private.comparar_balancete(date)',
      de: "if private.alcance('financeiro', 'ver') <> 'tudo' then return private.negar('comparar_balancete'); end if;", para: '',
      ataque: async () => (await rpc('comparar_balancete', { p_competencia: competencia }, dirProprios)).ok === true },
  ];
  for (const m of MUTANTES) {
    test(m.controle, async () => {
      await db.linhas('delete from private.limites');
      const original = await db.valor<string>(`select pg_get_functiondef('${m.assinatura}'::regprocedure)`);
      expect(await m.ataque(), 'o ataque NÃO pode funcionar com o controle ligado').toBe(false);
      try {
        await mutar(db, m.assinatura, m.de, m.para);
        expect(await m.ataque(), 'com o controle desligado o ataque deveria funcionar').toBe(true);
      } finally { await db.linhas(original); }
    });
  }
});
