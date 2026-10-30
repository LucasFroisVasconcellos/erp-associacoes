import fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

const feio = fc.oneof(
  fc.string(), fc.string({ minLength: 200, maxLength: 3000 }), fc.integer(), fc.double(), fc.boolean(), fc.constant(null),
  fc.constantFrom("'; drop table public.verbas; --", '<script>alert(1)</script>', '\u0000', '-1.00', '99999999999.99', '1e9',
    '2026-02-30', '00000000-0000-0000-0000-000000000000', 'admin', '{"admin":true}', 'a\u0007b'),
  fc.array(fc.oneof(fc.string(), fc.integer()), { maxLength: 3 }), fc.dictionary(fc.string({ maxLength: 12 }), fc.oneof(fc.string(), fc.boolean(), fc.integer()), { maxKeys: 4 }),
);
const recusaDeTipo = (m: string) => /unsupported Unicode escape sequence|cannot be converted to text|invalid byte sequence for encoding|null character|invalid input syntax for type (uuid|date|json)|out of range/.test(m);

describe('fuzz', () => {
  let db: Banco; let pres: string; let tipo: string; let origem: string; let verba: string; let projeto: string;
  beforeAll(async () => {
    db = await novoBanco();
    pres = await primeiroAdmin(db);
    await convidarMembro(db, pres, { email: 'vice@exemplo.test', nome: 'Vice', cargo: 'vice_presidente' });
    await db.rpc('importar_modelos_verba', {}, sessao(pres));
    tipo = await db.valor(`select id from public.tipos_verba limit 1`);
    origem = randomUUID(); verba = randomUUID(); projeto = randomUUID();
    await db.rpc('salvar_origem_verba', { p: { id: origem, nome: 'Origem fictícia', categoria: 'empresa' } }, sessao(pres));
    await db.rpc('salvar_verba', { p: { id: verba, titulo: 'Verba base', tipo_id: tipo, origem_id: origem, forma_recebimento: 'caixa_livre' } }, sessao(pres));
    await db.rpc('salvar_projeto', { p: { id: projeto, nome: 'Projeto base' } }, sessao(pres));
  });
  afterAll(async () => { await db?.destruir(); });

  async function chamar(nome: string, args: Record<string, unknown>) {
    await db.linhas('delete from private.limites');
    try { return await db.rpc(nome, args, sessao(pres)); }
    catch (e) { const m = (e as Error).message; return recusaDeTipo(m) ? { erro: 'recusado_no_tipo' } : { excecao: m }; }
  }

  test('salvar_verba e regras', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({ id: fc.oneof(fc.uuid(), feio), titulo: feio, forma_recebimento: feio, valor_pedido: feio, valor_aprovado: feio,
        regras: fc.oneof(feio, fc.record({ conta_especifica: feio, guarda_anos: feio, documentos_antes: feio }, { requiredKeys: [] })),
        prazo_pedido: feio, responsavel: feio, extra: fc.option(feio) }, { requiredKeys: [] }),
      async (p) => { expect(await chamar('salvar_verba', { p: { tipo_id: tipo, origem_id: origem, ...p } })).not.toHaveProperty('excecao'); }),
    { numRuns: 200, seed: 20261031 });
    expect(await db.valor<number>(`select count(*)::int from public.verbas where not private.regras_validas(regras)
      or char_length(btrim(titulo)) not between 2 and 160 or valor_pedido < 0`)).toBe(0);
  });

  test('parcelas, recebimento, rubricas, classificação e justificativa', async () => {
    await fc.assert(fc.asyncProperty(fc.oneof(feio, fc.array(fc.record({ id: fc.oneof(fc.uuid(), feio), valor: feio, data_prevista: feio }, { requiredKeys: [] }), { maxLength: 4 })),
      async (p) => { expect(await chamar('salvar_parcelas', { p_verba: verba, p: typeof p === 'string' ? JSON.stringify(p) : p })).not.toHaveProperty('excecao'); }),
    { numRuns: 150, seed: 20261032 });
    await fc.assert(fc.asyncProperty(fc.record({ id: fc.oneof(fc.uuid(), feio), nome: feio, valor_previsto: feio, ordem: feio, ativa: feio }, { requiredKeys: [] }),
      async (p) => { expect(await chamar('salvar_rubrica', { p_projeto: projeto, p })).not.toHaveProperty('excecao'); }),
    { numRuns: 150, seed: 20261033 });
    await fc.assert(fc.asyncProperty(fc.record({ nome: feio, vigencia_inicio: feio, vigencia_fim: feio, valor_aprovado: feio, regras: feio,
      situacao: feio, prazo_prestacao: feio, responsavel: feio }, { requiredKeys: [] }),
      async (p) => { expect(await chamar('editar_projeto', { p_id: projeto, p })).not.toHaveProperty('excecao'); }),
    { numRuns: 150, seed: 20261034 });
    await fc.assert(fc.asyncProperty(fc.string({ maxLength: 30 }), fc.string({ maxLength: 400 }),
      async (regra, motivo) => { expect(await chamar('justificar_regra', { p_lancamento: randomUUID(), p_projeto: projeto, p_regra: regra, p_motivo: motivo })).not.toHaveProperty('excecao'); }),
    { numRuns: 80, seed: 20261035 });
    expect(await db.valor<number>(`select count(*)::int from public.projeto_rubricas where valor_previsto < 0 or char_length(btrim(nome)) < 2`)).toBe(0);
    expect(await db.valor<number>(`select count(*)::int from public.projetos where not private.regras_validas(regras)`)).toBe(0);
  });
});

interface Cen { db: Banco; pres: string; dir: string; tes: string; projeto: string; outra: string; lanc: string }
async function cenario(): Promise<Cen> {
  const db = await novoBanco();
  const pres = await primeiroAdmin(db);
  await convidarMembro(db, pres, { email: 'vice@exemplo.test', nome: 'Vice', cargo: 'vice_presidente' });
  const tes = await convidarMembro(db, pres, { email: 'tes@exemplo.test', nome: 'Tesoureira', cargo: 'tesoureiro' });
  const dir = await convidarMembro(db, pres, { email: 'dir@exemplo.test', nome: 'Diretor', cargo: 'diretor' });
  const s = sessao(tes);
  const conta = randomUUID(), cat = randomUUID(), projeto = randomUUID(), outroProj = randomUUID(), outra = randomUUID(), lanc = randomUUID();
  await db.rpc('salvar_categoria', { p: { id: cat, nome: 'Material', tipo: 'saida' } }, s);
  await db.rpc('salvar_projeto', { p: { id: projeto, nome: 'Projeto A' } }, sessao(pres));
  await db.rpc('salvar_projeto', { p: { id: outroProj, nome: 'Projeto B' } }, sessao(pres));
  await db.rpc('salvar_conta', { p: { id: conta, nome: 'Conta do A', tipo: 'projeto', projeto_id: projeto, saldo_inicial: '0', data_saldo_inicial: '2026-01-01' } }, s);
  await db.rpc('salvar_rubrica', { p_projeto: outroProj, p: { id: outra, nome: 'Rubrica do B', valor_previsto: '10.00' } }, sessao(pres));
  const hoje = await db.valor<string>(`select to_char(private.hoje(), 'YYYY-MM-DD')`);
  await db.rpc('criar_lancamento', { p: { id: lanc, tipo: 'saida', situacao: 'realizada', valor: '10.00', data: hoje, descricao: 'Gasto do A', categoria_id: cat, conta_id: conta } }, s);
  return { db, pres, dir, tes, projeto, outra, lanc };
}
async function mutarFuncao(db: Banco, assinatura: string, de: string, para: string) {
  const def = await db.valor<string>(`select pg_get_functiondef('${assinatura}'::regprocedure)`);
  if (!def.includes(de)) throw new Error(`mutação inválida: "${de}" não está em ${assinatura}`);
  await db.linhas(def.replace(de, para));
}
const ok = (r: { ok?: boolean } | null) => r?.ok === true;

const MUTANTES: { controle: string; desligar: (c: Cen) => Promise<void>; ataque: (c: Cen) => Promise<boolean> }[] = [
  {
    controle: 'rubrica precisa ser do projeto do lançamento (regressão do achado de 22/10)',
    desligar: ({ db }) => mutarFuncao(db, 'private.classificar_lancamento(uuid,uuid)', 'coalesce(l.projeto_id = r.projeto_id, false)', '(l.projeto_id = r.projeto_id)'),
    ataque: async ({ db, pres, lanc, outra }) => ok(await db.rpc('classificar_lancamento', { p_lancamento: lanc, p_rubrica: outra }, sessao(pres))),
  },
  {
    controle: 'só quem fez o lançamento ou quem edita projetos classifica',
    desligar: ({ db }) => mutarFuncao(db, 'private.classificar_lancamento(uuid,uuid)',
      "if not (private.pode('projetos', 'editar') or (l.criado_por = auth.uid() and private.pode('financeiro', 'criar'))) then", 'if false then'),
    ataque: async ({ db, dir, lanc }) => ok(await db.rpc('classificar_lancamento', { p_lancamento: lanc, p_rubrica: null }, sessao(dir))),
  },
  {
    controle: 'vincular conta a projeto exige financeiro/administrar',
    desligar: ({ db }) => mutarFuncao(db, 'private.vincular_conta_projeto(uuid,uuid,boolean)',
      "private.checar('vincular_conta_projeto', 'financeiro', 'administrar')", "private.checar('vincular_conta_projeto', 'financeiro', 'ver')"),
    ataque: async ({ db, dir, projeto }) => {
      const c = await db.valor<string>(`select id from public.contas_bancarias limit 1`);
      return ok(await db.rpc('vincular_conta_projeto', { p_projeto: projeto, p_conta: c, p_vincular: false }, sessao(dir)));
    },
  },
  {
    controle: 'regras com chaves fechadas (mass assignment de chave inventada)',
    // a checagem de chaves passa a olhar um objeto vazio (aceita qualquer chave)
    desligar: ({ db }) => mutarFuncao(db, 'private.regras_validas(jsonb)', "and private.so_chaves(p, array[", "and private.so_chaves(p - array(select jsonb_object_keys(p)), array["),
    ataque: async ({ db, pres, projeto }) => ok(await db.rpc('editar_projeto', { p_id: projeto, p: { regras: { liberar_tudo: true } } }, sessao(pres))),
  },
  {
    controle: 'dados de prestação exigem o financeiro completo',
    desligar: ({ db }) => mutarFuncao(db, 'private.dados_prestacao(uuid)',
      "if not (private.pode('financeiro', 'ver') and private.alcance('financeiro', 'ver') = 'tudo') then return private.negar('dados_prestacao'); end if;", ''),
    ataque: async ({ db, pres, projeto }) => {
      // presidente sem o financeiro (só projetos)
      await db.linhas(`delete from public.permissoes where membro_id = $1 and modulo = 'financeiro'`, 'postgres', [pres]);
      return ok(await db.rpc('dados_prestacao', { p_id: projeto }, sessao(pres)));
    },
  },
];

describe('mutação dos controles da Fase 3', () => {
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
