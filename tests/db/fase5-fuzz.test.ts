import fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

const feio = fc.oneof(
  fc.string(), fc.string({ minLength: 200, maxLength: 3000 }), fc.integer(), fc.double(), fc.boolean(), fc.constant(null),
  fc.constantFrom("'; drop table public.recibos; --", '<script>alert(1)</script>', '\u0000', '-1.00', '-0.00', '99999999999.99', '1e9',
    '2026-02-30', '00000000-0000-0000-0000-000000000000', 'admin', '529.982.247-25', '00000000000', 'a\u0007b', '../../etc/passwd'),
  fc.array(fc.oneof(fc.string(), fc.integer()), { maxLength: 3 }), fc.dictionary(fc.string({ maxLength: 12 }), fc.oneof(fc.string(), fc.boolean(), fc.integer()), { maxKeys: 4 }),
);
const recusaDeTipo = (m: string) => /unsupported Unicode escape sequence|cannot be converted to text|invalid byte sequence for encoding|null character|invalid input syntax for type (uuid|date|json|integer)|out of range/.test(m);

describe('fuzz', () => {
  let db: Banco; let pres: string; let conta: string; let acao: string; let viagem: string; let pessoa: string;
  beforeAll(async () => {
    db = await novoBanco();
    pres = await primeiroAdmin(db);
    await convidarMembro(db, pres, { email: 'vice@exemplo.test', nome: 'Vice', cargo: 'vice_presidente' });
    const s = sessao(pres); const hoje = await db.valor<string>(`select to_char(private.hoje(), 'YYYY-MM-DD')`);
    conta = randomUUID(); acao = randomUUID(); viagem = randomUUID(); pessoa = randomUUID();
    await db.rpc('salvar_conta', { p: { id: conta, nome: 'Conta', tipo: 'movimento', saldo_inicial: '0', data_saldo_inicial: '2025-01-01' } }, s);
    await db.rpc('salvar_acao_captacao', { p: { id: acao, tipo: 'rifa', nome: 'Rifa base', data: hoje, quantidade: 100 } }, s);
    await db.rpc('salvar_viagem', { p: { id: viagem, titulo: 'Viagem base', destino: 'Destino', saida: hoje, retorno: hoje } }, s);
    await db.rpc('salvar_pessoa', { p: { id: pessoa, nome: 'Atleta base', atleta: true, associado: false } }, s);
  });
  afterAll(async () => { await db?.destruir(); });

  async function chamar(nome: string, args: Record<string, unknown>) {
    await db.linhas('delete from private.limites');
    try { return await db.rpc(nome, args, sessao(pres)); }
    catch (e) { const m = (e as Error).message; return recusaDeTipo(m) ? { erro: 'recusado_no_tipo' } : { excecao: m }; }
  }
  const prop = (nome: string, gerar: fc.Arbitrary<unknown>, args: (v: any) => Record<string, unknown>, seed: number, numRuns = 150) =>
    fc.assert(fc.asyncProperty(gerar, async (v) => { expect(await chamar(nome, args(v))).not.toHaveProperty('excecao'); }), { numRuns, seed });

  test('extrato e conciliação', async () => {
    await prop('importar_extrato', fc.oneof(feio, fc.array(fc.record({ data: feio, valor: feio, descricao: feio, id: feio, extra: fc.option(feio) }, { requiredKeys: [] }), { maxLength: 4 })),
      (p) => ({ p_conta: conta, p: typeof p === 'string' ? JSON.stringify(p) : p }), 20261111, 200);
    await prop('ignorar_linha', fc.tuple(fc.oneof(fc.uuid(), fc.constant(randomUUID())), fc.string({ maxLength: 400 })), ([l, m]) => ({ p_linha: l, p_motivo: m }), 20261112, 60);
    expect(await db.valor<number>(`select count(*)::int from public.extrato_linhas where valor = 0 or descricao ~ '[[:cntrl:]]'`)).toBe(0);
  });

  test('captação', async () => {
    await prop('salvar_oportunidade', fc.record({ id: fc.oneof(fc.uuid(), feio), tipo: feio, nome: feio, contato: feio, etapa: feio, valor_estimado: feio,
      proximo_passo: feio, proximo_passo_em: feio, verba_id: feio, responsavel: feio, criado_por: fc.option(feio) }, { requiredKeys: [] }), (p) => ({ p }), 20261113);
    await prop('salvar_vendedor', fc.record({ id: fc.oneof(fc.uuid(), feio), nome: feio, membro_id: feio, bilhetes: feio, vendidos: feio, valor_prestado: feio, lancamento_id: feio },
      { requiredKeys: [] }), (p) => ({ p_acao: acao, p }), 20261114);
    await prop('emitir_recibo', fc.record({ id: fc.oneof(fc.uuid(), feio), doador_nome: feio, doador_documento: feio, valor: feio, data: feio, forma: feio,
      descricao: feio, lancamento_id: feio, oportunidade_id: feio }, { requiredKeys: [] }), (p) => ({ p }), 20261115, 200);
    expect(await db.valor<number>(`select count(*)::int from public.acao_vendedores where vendidos > bilhetes and bilhetes > 0`)).toBe(0);
    expect(await db.valor<number>(`select count(*)::int from public.recibos where doador_documento is not null and not private.documento_valido(doador_documento)`)).toBe(0);
    // numeração sem buraco: os números de cada ano vão de 1 a n
    expect(await db.valor<number>(`select count(*)::int from (select ano, max(numero) m, count(*) n from public.recibos group by ano) x where m <> n`)).toBe(0);
  });

  test('viagens', async () => {
    await prop('salvar_viagem', fc.record({ id: fc.oneof(fc.uuid(), feio), titulo: feio, destino: feio, saida: feio, retorno: feio, distancia_km: feio, orcamento: feio,
      situacao: feio, quartos_adaptados: feio, transporte_acessivel: feio, observacoes: feio, responsavel: feio }, { requiredKeys: [] }), (p) => ({ p }), 20261116);
    await prop('salvar_delegacao', fc.oneof(feio, fc.array(fc.record({ id: fc.oneof(fc.uuid(), feio), pessoa_id: fc.oneof(fc.constant(pessoa), feio), nome: feio, funcao: feio, quarto: feio },
      { requiredKeys: [] }), { maxLength: 4 })), (p) => ({ p_viagem: viagem, p: typeof p === 'string' ? JSON.stringify(p) : p }), 20261117);
    expect(await db.valor<number>(`select count(*)::int from public.viagens where retorno < saida or retorno > saida + 60`)).toBe(0);
    expect(await db.valor<number>(`select count(*)::int from public.viagem_delegacao where funcao = 'atleta' and pessoa_id is null`)).toBe(0);
  });
});

interface Cen { db: Banco; pres: string; tes: string; dir: string; conta: string; entrada10: string; linha: string; viagem: string; mesPassado: string; hoje: string }
async function cenario(): Promise<Cen> {
  const db = await novoBanco();
  const pres = await primeiroAdmin(db);
  await convidarMembro(db, pres, { email: 'vice@exemplo.test', nome: 'Vice', cargo: 'vice_presidente' });
  const tes = await convidarMembro(db, pres, { email: 'tes@exemplo.test', nome: 'Tesoureira', cargo: 'tesoureiro' });
  const dir = await convidarMembro(db, pres, { email: 'dir@exemplo.test', nome: 'Diretor', cargo: 'diretor' });
  const s = sessao(tes);
  const hoje = await db.valor<string>(`select to_char(private.hoje(), 'YYYY-MM-DD')`);
  const mesPassado = await db.valor<string>(`select to_char(date_trunc('month', private.hoje()) - interval '1 month' + interval '4 days', 'YYYY-MM-DD')`);
  const conta = randomUUID(), cat = randomUUID(), catS = randomUUID(), entrada10 = randomUUID(), viagem = randomUUID(), adiant = randomUUID();
  await db.rpc('salvar_conta', { p: { id: conta, nome: 'Conta', tipo: 'movimento', saldo_inicial: '0', data_saldo_inicial: '2025-01-01' } }, s);
  await db.rpc('salvar_categoria', { p: { id: cat, nome: 'Doações', tipo: 'entrada' } }, s);
  await db.rpc('salvar_categoria', { p: { id: catS, nome: 'Viagem', tipo: 'saida' } }, s);
  await db.rpc('criar_lancamento', { p: { id: entrada10, tipo: 'entrada', situacao: 'realizada', valor: '10.00', data: hoje, descricao: 'Doação', categoria_id: cat, conta_id: conta } }, s);
  await db.rpc('importar_extrato', { p_conta: conta, p: [{ data: mesPassado, valor: '-2.50', descricao: 'TARIFA', id: 'T1' }] }, s);
  const linha = await db.valor<string>(`select id from public.extrato_linhas limit 1`);
  await db.rpc('salvar_viagem', { p: { id: viagem, titulo: 'Viagem', destino: 'Campinas', saida: hoje, retorno: hoje } }, sessao(dir));
  await db.rpc('criar_lancamento', { p: { id: adiant, tipo: 'saida', situacao: 'realizada', valor: '100.00', data: hoje, descricao: 'Adiantamento', categoria_id: catS, conta_id: conta } }, s);
  await db.rpc('vincular_lancamento_viagem', { p_viagem: viagem, p_lancamento: adiant, p_papel: 'adiantamento' }, sessao(dir));
  return { db, pres, tes, dir, conta, entrada10, linha, viagem, mesPassado, hoje };
}
async function mutarFuncao(db: Banco, assinatura: string, de: string, para: string) {
  const def = await db.valor<string>(`select pg_get_functiondef('${assinatura}'::regprocedure)`);
  if (!def.includes(de)) throw new Error(`mutação inválida: "${de}" não está em ${assinatura}`);
  await db.linhas(def.replace(de, para));
}
const ok = (r: { ok?: boolean } | null) => r?.ok === true;

const MUTANTES: { controle: string; desligar: (c: Cen) => Promise<void>; ataque: (c: Cen) => Promise<boolean> }[] = [
  {
    controle: 'importar extrato exige financeiro/editar (diretor não)',
    desligar: ({ db }) => mutarFuncao(db, 'private.importar_extrato(uuid,jsonb)', "private.checar('importar_extrato', 'financeiro', 'editar')", "private.checar('importar_extrato', 'financeiro', 'ver')"),
    ataque: async ({ db, dir, conta, hoje }) => ok(await db.rpc('importar_extrato', { p_conta: conta, p: [{ data: hoje, valor: '1.00', descricao: 'X' }] }, sessao(dir))),
  },
  {
    controle: 'conciliar exige o mesmo valor',
    desligar: ({ db }) => mutarFuncao(db, 'private.conciliar(uuid,uuid)', 'or l.valor <> abs(x.valor)', ''),
    ataque: async ({ db, tes, conta, hoje, entrada10 }) => {
      await db.rpc('importar_extrato', { p_conta: conta, p: [{ data: hoje, valor: '999.00', descricao: 'ENTRADA GRANDE', id: 'G1' }] }, sessao(tes));
      const l = await db.valor<string>(`select id from public.extrato_linhas where chave = 'id:G1'`);
      return ok(await db.rpc('conciliar', { p_linha: l, p_lancamento: entrada10 }, sessao(tes)));
    },
  },
  {
    controle: 'linha do extrato pendente impede fechar o mês',
    desligar: ({ db }) => mutarFuncao(db, 'private.fechar_mes(date,jsonb)', "if private.extrato_pendente(p_competencia, v_fim) > 0 then return private.erro('pendencias'); end if;", ''),
    ataque: async ({ db, tes, mesPassado }) => ok(await db.rpc('fechar_mes', { p_competencia: mesPassado.slice(0, 8) + '01', p_confirmacoes: { extrato_conferido: true } }, sessao(tes))),
  },
  {
    controle: 'recibo em dinheiro só com entrada do mesmo valor',
    desligar: ({ db }) => mutarFuncao(db, 'private.emitir_recibo(jsonb)', "or l.valor <> private.j_valor(p -> 'valor')", ''),
    ataque: async ({ db, tes, hoje, entrada10 }) => ok(await db.rpc('emitir_recibo', { p: { id: randomUUID(), doador_nome: 'Doador', valor: '1000.00', data: hoje, forma: 'dinheiro', lancamento_id: entrada10 } }, sessao(tes))),
  },
  {
    controle: 'recibo só pela tesouraria (financeiro/editar)',
    desligar: ({ db }) => mutarFuncao(db, 'private.emitir_recibo(jsonb)', "private.checar('emitir_recibo', 'financeiro', 'editar')", "private.checar('emitir_recibo', 'financeiro', 'ver')"),
    ataque: async ({ db, dir, hoje }) => ok(await db.rpc('emitir_recibo', { p: { id: randomUUID(), doador_nome: 'Doador', valor: '10.00', data: hoje, forma: 'bens', descricao: 'Bola' } }, sessao(dir))),
  },
  {
    controle: 'viagem de outra pessoa só com viagens/editar',
    desligar: ({ db }) => mutarFuncao(db, 'private.salvar_viagem(jsonb)', "if v.id is not null and not private.pode_mexer_viagem(v) then return private.negar('salvar_viagem'); end if;", ''),
    ataque: async ({ db, tes, viagem, hoje }) => ok(await db.rpc('salvar_viagem', { p: { id: viagem, titulo: 'Tomada', destino: 'Outro', saida: hoje, retorno: hoje } }, sessao(tes))),
  },
  {
    controle: 'encerrar viagem só com o acerto feito',
    desligar: ({ db }) => mutarFuncao(db, 'private.encerrar_viagem(uuid)', "if v_saldo > 0 then return private.erro('acerto_pendente'); end if;", ''),
    ataque: async ({ db, pres, viagem }) => ok(await db.rpc('encerrar_viagem', { p_id: viagem }, sessao(pres))),
  },
];

describe('mutação dos controles da Fase 5', () => {
  for (const m of MUTANTES) {
    test(m.controle, async () => {
      const original = await cenario(); const mutante = await cenario();
      try {
        expect(await m.ataque(original), 'o ataque NÃO pode funcionar com o controle ligado').toBe(false);
        await m.desligar(mutante);
        expect(await m.ataque(mutante), 'com o controle desligado o ataque deveria funcionar').toBe(true);
      } finally { await original.db.destruir(); await mutante.db.destruir(); }
    });
  }
});
