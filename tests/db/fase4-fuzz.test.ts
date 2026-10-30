import fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

const feio = fc.oneof(
  fc.string(), fc.string({ minLength: 200, maxLength: 3000 }), fc.integer(), fc.double(), fc.boolean(), fc.constant(null),
  fc.constantFrom("'; drop table public.pessoas; --", '<script>alert(1)</script>', '\u0000', '-1.00', '99999999999.99', '1e9',
    '2026-02-30', '00000000-0000-0000-0000-000000000000', 'admin', '{"admin":true}', 'a\u0007b', '../../etc/passwd'),
  fc.array(fc.oneof(fc.string(), fc.integer()), { maxLength: 3 }), fc.dictionary(fc.string({ maxLength: 12 }), fc.oneof(fc.string(), fc.boolean(), fc.integer()), { maxKeys: 4 }),
);
const recusaDeTipo = (m: string) => /unsupported Unicode escape sequence|cannot be converted to text|invalid byte sequence for encoding|null character|invalid input syntax for type (uuid|date|json|integer)|out of range/.test(m);

async function darSaude(db: Banco, pres: string, membro: string) {
  const atuais = await db.valor<unknown[]>(`select jsonb_agg(jsonb_build_object('modulo', modulo, 'acao', acao, 'alcance', alcance)) from public.permissoes where membro_id = $1`, 'postgres', [membro]);
  await db.rpc('definir_permissoes', { p_membro: membro, p_permissoes: [...atuais, { modulo: 'saude', acao: 'ver', alcance: 'tudo' }, { modulo: 'saude', acao: 'editar', alcance: 'tudo' }] }, sessao(pres));
}

describe('fuzz', () => {
  let db: Banco; let pres: string; let pessoa: string; let bem: string; let reuniao: string; let filiacao: string; let tipo: string;
  beforeAll(async () => {
    db = await novoBanco();
    pres = await primeiroAdmin(db);
    await convidarMembro(db, pres, { email: 'vice@exemplo.test', nome: 'Vice', cargo: 'vice_presidente' });
    await darSaude(db, pres, pres);
    const s = sessao(pres);
    pessoa = randomUUID(); bem = randomUUID(); reuniao = randomUUID(); filiacao = randomUUID();
    await db.rpc('salvar_pessoa', { p: { id: pessoa, nome: 'Atleta base', atleta: true, associado: true } }, s);
    await db.rpc('registrar_consentimento', { p: { id: randomUUID(), pessoa_id: pessoa, finalidade: 'saude', base_legal: 'consentimento', concedido_por: 'titular', nome_concedente: 'Atleta base', concedido_em: await db.valor(`select to_char(private.hoje(), 'YYYY-MM-DD')`) } }, s);
    await db.rpc('salvar_bem', { p: { id: bem, numero: 'BASE-1', nome: 'Bem base', categoria: 'bola', origem: 'doacao' } }, s);
    await db.rpc('salvar_reuniao', { p: { id: reuniao, tipo: 'diretoria', titulo: 'Reunião base', data: new Date().toISOString(), pauta: 'Pauta' } }, s);
    await db.rpc('importar_tipos_filiacao', {}, s);
    tipo = await db.valor(`select id from public.tipos_filiacao limit 1`);
    await db.rpc('salvar_filiacao', { p: { id: filiacao, entidade: 'Entidade base', tipo_id: tipo } }, s);
  });
  afterAll(async () => { await db?.destruir(); });

  async function chamar(nome: string, args: Record<string, unknown>) {
    await db.linhas('delete from private.limites');
    try { return await db.rpc(nome, args, sessao(pres)); }
    catch (e) { const m = (e as Error).message; return recusaDeTipo(m) ? { erro: 'recusado_no_tipo' } : { excecao: m }; }
  }
  const prop = (nome: string, gerar: fc.Arbitrary<unknown>, args: (v: any) => Record<string, unknown>, seed: number, numRuns = 150) =>
    fc.assert(fc.asyncProperty(gerar, async (v) => { expect(await chamar(nome, args(v))).not.toHaveProperty('excecao'); }), { numRuns, seed });

  test('pessoas, consentimento e saúde', async () => {
    await prop('salvar_pessoa', fc.record({ id: fc.oneof(fc.uuid(), feio), nome: feio, atleta: feio, associado: feio, data_nascimento: feio, email: feio,
      telefone: feio, situacao: feio, responsavel_nome: feio, responsavel_contato: feio, categoria_id: feio, membro_id: fc.option(feio) }, { requiredKeys: [] }),
      (p) => ({ p }), 20261041, 200);
    await prop('salvar_saude', fc.record({ deficiencia: feio, classe_funcional: feio, observacoes: feio, extra: fc.option(feio) }, { requiredKeys: [] }),
      (p) => ({ p_pessoa: pessoa, p }), 20261042);
    await prop('registrar_consentimento', fc.record({ id: fc.oneof(fc.uuid(), feio), pessoa_id: fc.oneof(fc.constant(pessoa), feio), finalidade: feio,
      base_legal: feio, concedido_por: feio, nome_concedente: feio, concedido_em: feio }, { requiredKeys: [] }), (p) => ({ p }), 20261043);
    await prop('salvar_config_pix', fc.record({ chave: feio, nome: feio, cidade: feio }, { requiredKeys: [] }), (p) => ({ p }), 20261044);
    expect(await db.valor<number>(`select count(*)::int from public.pessoas where not (atleta or associado) or char_length(btrim(nome)) < 2
      or (private.menor_de_idade(data_nascimento) and responsavel_nome is null)`)).toBe(0);
    expect(await db.valor<number>(`select count(*)::int from public.pessoa_saude s where not private.consentimento_ativo(s.pessoa_id, 'saude')`)).toBe(0);
  });

  test('patrimônio', async () => {
    await prop('salvar_bem', fc.record({ id: fc.oneof(fc.uuid(), feio), numero: feio, nome: feio, categoria: feio, origem: feio, projeto_id: feio,
      valor: feio, data_aquisicao: feio, observacao: feio }, { requiredKeys: [] }), (p) => ({ p }), 20261045);
    await prop('emprestar_bem', fc.record({ id: fc.oneof(fc.uuid(), feio), bem_id: fc.oneof(fc.constant(bem), feio), pessoa_id: fc.oneof(fc.constant(pessoa), feio),
      inicio: feio, previsao_devolucao: feio, termo_versao: feio, termo_aceito_por: feio, termo_aceito_em: feio }, { requiredKeys: [] }), (p) => ({ p }), 20261046);
    await prop('registrar_manutencao', fc.record({ id: fc.oneof(fc.uuid(), feio), bem_id: fc.oneof(fc.constant(bem), feio), data: feio, descricao: feio,
      custo: feio, proxima_em: feio, em_manutencao: feio }, { requiredKeys: [] }), (p) => ({ p }), 20261047);
    expect(await db.valor<number>(`select count(*)::int from public.bens where numero !~ '^[A-Z0-9-]{1,20}$' or valor < 0`)).toBe(0);
    expect(await db.valor<number>(`select count(*)::int from public.bens b where (b.situacao = 'emprestado') <>
      exists (select 1 from public.emprestimos e where e.bem_id = b.id and e.devolvido_em is null)`)).toBe(0);
  });

  test('governança e filiações', async () => {
    await prop('salvar_presencas', fc.oneof(feio, fc.array(fc.record({ nome: feio, membro_id: feio }, { requiredKeys: [] }), { maxLength: 5 })),
      (p) => ({ p_reuniao: reuniao, p: typeof p === 'string' ? JSON.stringify(p) : p }), 20261048);
    await prop('salvar_deliberacao', fc.record({ id: fc.oneof(fc.uuid(), feio), ordem: feio, texto: feio, votos_favor: feio, votos_contra: feio,
      abstencoes: feio, resultado: feio }, { requiredKeys: [] }), (p) => ({ p_reuniao: reuniao, p }), 20261049);
    await prop('salvar_mandato', fc.record({ id: fc.oneof(fc.uuid(), feio), nome: feio, cargo: feio, orgao: feio, inicio: feio, fim: feio, membro_id: feio }, { requiredKeys: [] }),
      (p) => ({ p }), 20261050);
    await prop('salvar_filiacao', fc.record({ id: fc.oneof(fc.uuid(), feio), entidade: feio, tipo_id: fc.oneof(fc.constant(tipo), feio), situacao: feio,
      validade: feio, renovacao: feio, contribuicao_valor: feio, contribuicao_periodicidade: feio, beneficios: feio, responsavel: feio }, { requiredKeys: [] }),
      (p) => ({ p }), 20261051);
    await prop('salvar_documento_filiacao', fc.record({ id: fc.oneof(fc.uuid(), feio), nome: feio, documento_institucional_id: feio, entregue: feio }, { requiredKeys: [] }),
      (p) => ({ p_filiacao: filiacao, p }), 20261052);
    expect(await db.valor<number>(`select count(*)::int from public.deliberacoes d where d.votos_favor + d.votos_contra + d.abstencoes >
      greatest((select count(*) from public.reuniao_presencas p where p.reuniao_id = d.reuniao_id), 10000)`)).toBe(0);
    expect(await db.valor<number>(`select count(*)::int from public.filiacoes where contribuicao_valor < 0 or char_length(btrim(entidade)) < 2`)).toBe(0);
  });
});

interface Cen { db: Banco; pres: string; sec: string; dir: string; adulto: string; menor: string; bem: string; reuniao: string; filiacao: string; cat: string; hoje: string; treino: string }
async function cenario(): Promise<Cen> {
  const db = await novoBanco();
  const pres = await primeiroAdmin(db);
  await convidarMembro(db, pres, { email: 'vice@exemplo.test', nome: 'Vice', cargo: 'vice_presidente' });
  const sec = await convidarMembro(db, pres, { email: 'sec@exemplo.test', nome: 'Secretária', cargo: 'secretario' });
  const tes = await convidarMembro(db, pres, { email: 'tes@exemplo.test', nome: 'Tesoureira', cargo: 'tesoureiro' });
  const dir = await convidarMembro(db, pres, { email: 'dir@exemplo.test', nome: 'Diretor', cargo: 'diretor' });
  await darSaude(db, pres, sec);
  const s = sessao(sec);
  const hoje = await db.valor<string>(`select to_char(private.hoje(), 'YYYY-MM-DD')`);
  const adulto = randomUUID(), menor = randomUUID(), bem = randomUUID(), reuniao = randomUUID(), filiacao = randomUUID(), cat = randomUUID();
  await db.rpc('salvar_pessoa', { p: { id: adulto, nome: 'Atleta Adulto', atleta: true, associado: false } }, s);
  await db.rpc('salvar_pessoa', { p: { id: menor, nome: 'Atleta Menor', atleta: true, associado: false,
    data_nascimento: await db.valor(`select to_char(private.hoje() - interval '12 years', 'YYYY-MM-DD')`), responsavel_nome: 'Mãe Fictícia', responsavel_contato: '16900000000' } }, s);
  await db.rpc('salvar_bem', { p: { id: bem, numero: 'CAD-1', nome: 'Cadeira', categoria: 'cadeira_jogo', origem: 'doacao' } }, s);
  await db.rpc('salvar_reuniao', { p: { id: reuniao, tipo: 'diretoria', titulo: 'Reunião', data: new Date(Date.now() - 3600e3).toISOString(), pauta: 'Pauta', situacao: 'realizada' } }, s);
  await db.rpc('salvar_presencas', { p_reuniao: reuniao, p: [{ nome: 'A Fictícia' }, { nome: 'B Fictício' }] }, s);
  await db.rpc('salvar_ata', { p_reuniao: reuniao, p_ata: 'Ata.', p_aprovada_em: hoje }, s);
  await db.rpc('importar_tipos_filiacao', {}, s);
  await db.rpc('salvar_filiacao', { p: { id: filiacao, entidade: 'Federação Fictícia', tipo_id: await db.valor(`select id from public.tipos_filiacao limit 1`),
    contribuicao_valor: '100.00', contribuicao_periodicidade: 'anual', renovacao: await db.valor(`select to_char(private.hoje() + 10, 'YYYY-MM-DD')`) } }, s);
  await db.rpc('salvar_categoria', { p: { id: cat, nome: 'Anuidades', tipo: 'saida' } }, sessao(tes));
  const treino = randomUUID();
  await db.rpc('importar_tipos_evento', {}, s);
  await db.rpc('salvar_evento', { p: { id: treino, tipo_id: await db.valor(`select id from public.tipos_evento limit 1`), titulo: 'Treino',
    inicio: `${hoje}T00:01:00-03:00`, fim: `${hoje}T00:02:00-03:00` } }, s);
  return { db, pres, sec, dir, adulto, menor, bem, reuniao, filiacao, cat, hoje, treino };
}
async function mutarFuncao(db: Banco, assinatura: string, de: string, para: string) {
  const def = await db.valor<string>(`select pg_get_functiondef('${assinatura}'::regprocedure)`);
  if (!def.includes(de)) throw new Error(`mutação inválida: "${de}" não está em ${assinatura}`);
  await db.linhas(def.replace(de, para));
}
const ok = (r: { ok?: boolean } | null) => r?.ok === true;

const MUTANTES: { controle: string; desligar: (c: Cen) => Promise<void>; ataque: (c: Cen) => Promise<boolean> }[] = [
  {
    controle: 'saúde só grava com consentimento ativo (fail closed)',
    desligar: ({ db }) => mutarFuncao(db, 'private.salvar_saude(uuid,jsonb)',
      "if not private.consentimento_ativo(p_pessoa, 'saude') then return private.erro('sem_consentimento'); end if;", ''),
    ataque: async ({ db, sec, adulto }) => ok(await db.rpc('salvar_saude', { p_pessoa: adulto, p: { classe_funcional: '2.0' } }, sessao(sec))),
  },
  {
    controle: 'saúde exige o módulo saude (o presidente não tem por padrão)',
    desligar: ({ db }) => mutarFuncao(db, 'private.salvar_saude(uuid,jsonb)', "private.checar('salvar_saude', 'saude', 'editar')", "private.checar('salvar_saude', 'pessoas', 'editar')"),
    ataque: async ({ db, sec, pres, adulto, hoje }) => {
      await db.rpc('registrar_consentimento', { p: { id: randomUUID(), pessoa_id: adulto, finalidade: 'saude', base_legal: 'consentimento', concedido_por: 'titular', nome_concedente: 'Atleta Adulto', concedido_em: hoje } }, sessao(sec));
      return ok(await db.rpc('salvar_saude', { p_pessoa: adulto, p: { classe_funcional: '2.0' } }, sessao(pres)));
    },
  },
  {
    controle: 'empréstimo a menor: o termo é aceito pelo responsável',
    desligar: ({ db }) => mutarFuncao(db, 'private.emprestar_bem(jsonb)', 'if private.menor_de_idade(x.data_nascimento) and', 'if false and'),
    ataque: async ({ db, sec, menor, bem, hoje }) => ok(await db.rpc('emprestar_bem', { p: { id: randomUUID(), bem_id: bem, pessoa_id: menor,
      inicio: hoje, termo_versao: 'v1', termo_aceito_por: 'Atleta Menor', termo_aceito_em: hoje } }, sessao(sec))),
  },
  {
    controle: 'ata aprovada não muda (trigger)',
    desligar: ({ db }) => mutarFuncao(db, 'private.trg_ata_congelada()', 'if not v_aprovando and exists', 'if false and exists'),
    ataque: async ({ db, reuniao }) => {
      try { await db.linhas(`update public.reunioes set ata = 'adulterada' where id = $1`, 'postgres', [reuniao]); return true; } catch { return false; }
    },
  },
  {
    controle: 'votos não passam do número de presentes',
    desligar: ({ db }) => mutarFuncao(db, 'private.salvar_deliberacao(uuid,jsonb)', 'if v_pres > 0 and v_votos > v_pres then', 'if false then'),
    ataque: async ({ db, sec }) => {
      const r = randomUUID();
      await db.rpc('salvar_reuniao', { p: { id: r, tipo: 'diretoria', titulo: 'Outra', data: new Date().toISOString(), pauta: 'Pauta' } }, sessao(sec));
      await db.rpc('salvar_presencas', { p_reuniao: r, p: [{ nome: 'Só Uma' }] }, sessao(sec));
      return ok(await db.rpc('salvar_deliberacao', { p_reuniao: r, p: { id: randomUUID(), ordem: 1, texto: 'Item', votos_favor: 5, votos_contra: 0, abstencoes: 0, resultado: 'aprovada' } }, sessao(sec)));
    },
  },
  {
    controle: 'contribuição de filiação no financeiro exige financeiro/administrar',
    desligar: ({ db }) => mutarFuncao(db, 'private.gerar_contribuicao(uuid,uuid,integer)',
      "private.checar('gerar_contribuicao', 'financeiro', 'administrar')", "private.checar('gerar_contribuicao', 'financeiro', 'criar')"),
    ataque: async ({ db, sec, filiacao, cat }) => ok(await db.rpc('gerar_contribuicao', { p_filiacao: filiacao, p_categoria: cat, p_dia: 5 }, sessao(sec))),
  },
  {
    controle: 'lista de presença exige ver o cadastro de pessoas',
    desligar: ({ db }) => mutarFuncao(db, 'private.salvar_presenca_evento(uuid,jsonb)',
      "if not private.pode('pessoas', 'ver') then return private.negar('salvar_presenca_evento'); end if;", ''),
    ataque: async ({ db, dir, treino }) => {
      await db.linhas(`delete from public.permissoes where membro_id = $1 and modulo = 'pessoas'`, 'postgres', [dir]);
      return ok(await db.rpc('salvar_presenca_evento', { p_evento: treino, p: [] }, sessao(dir)));
    },
  },
  {
    controle: 'cadastro de bem exige patrimonio/criar (diretor só vê)',
    desligar: ({ db }) => mutarFuncao(db, 'private.salvar_bem(jsonb)', "private.checar('salvar_bem', 'patrimonio', 'criar')", "private.checar('salvar_bem', 'patrimonio', 'ver')"),
    ataque: async ({ db, dir }) => ok(await db.rpc('salvar_bem', { p: { id: randomUUID(), numero: 'X-1', nome: 'Bem', categoria: 'bola', origem: 'doacao' } }, sessao(dir))),
  },
];

describe('mutação dos controles da Fase 4', () => {
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
