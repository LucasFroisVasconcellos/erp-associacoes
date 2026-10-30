import fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

const feio = fc.oneof(
  fc.string(), fc.string({ minLength: 200, maxLength: 5000 }), fc.integer(), fc.double(), fc.boolean(), fc.constant(null),
  fc.constantFrom("'; drop table public.tarefas; --", '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '\u0000',
    '2026-02-30', '2026-13-01T10:00:00Z', '9999-12-31T23:59:59Z', '2026-11-03T19:30:00', '00000000-0000-0000-0000-000000000000',
    'javascript:alert(1)', '‮evil', 'a\u0007b', '１２３'),
  fc.array(fc.string(), { maxLength: 3 }), fc.dictionary(fc.string({ maxLength: 8 }), fc.string(), { maxKeys: 3 }),
);
const recusaDeTipo = (m: string) => /unsupported Unicode escape sequence|cannot be converted to text|invalid byte sequence for encoding|null character|invalid input syntax for type (uuid|date)|date\/time field value out of range|out of range/.test(m);

describe('fuzz', () => {
  let db: Banco; let pres: string; let dir: string; let tipo: string; let hoje: string;
  beforeAll(async () => {
    db = await novoBanco();
    pres = await primeiroAdmin(db);
    await convidarMembro(db, pres, { email: 'vice@exemplo.test', nome: 'Vice', cargo: 'vice_presidente' });
    dir = await convidarMembro(db, pres, { email: 'dir@exemplo.test', nome: 'Diretor', cargo: 'diretor' });
    await db.rpc('importar_tipos_evento', {}, sessao(dir));
    tipo = await db.valor(`select id from public.tipos_evento limit 1`);
    hoje = await db.valor<string>(`select to_char(private.hoje(), 'YYYY-MM-DD')`);
  });
  afterAll(async () => { await db?.destruir(); });

  async function chamar(nome: string, args: Record<string, unknown>) {
    await db.linhas('delete from private.limites');
    try { return await db.rpc(nome, args, sessao(dir)); }
    catch (e) { const m = (e as Error).message; return recusaDeTipo(m) ? { erro: 'recusado_no_tipo' } : { excecao: m }; }
  }

  test('salvar_evento', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({ id: fc.oneof(fc.uuid(), feio), titulo: feio, inicio: feio, fim: feio, dia_inteiro: feio, local: feio,
        descricao: feio, participantes: feio, extra: fc.option(feio) }, { requiredKeys: [] }),
      async (p) => { expect(await chamar('salvar_evento', { p: { tipo_id: tipo, ...p } })).not.toHaveProperty('excecao'); }),
    { numRuns: 200, seed: 20261021 });
    // tudo que entrou respeita as regras
    expect(await db.valor<number>(`select count(*)::int from public.eventos
      where not (fim >= inicio and char_length(btrim(titulo)) between 2 and 120 and titulo !~ '[[:cntrl:]]')`)).toBe(0);
  });

  test('criar_tarefa e comentar_tarefa', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({ id: fc.oneof(fc.uuid(), feio), titulo: feio, descricao: feio, responsavel: feio, prazo: feio,
        prioridade: feio, lembrete_dias: feio, itens: feio, evento_id: feio, situacao: feio }, { requiredKeys: [] }),
      async (p) => { expect(await chamar('criar_tarefa', { p })).not.toHaveProperty('excecao'); }),
    { numRuns: 200, seed: 20261022 });
    const t = randomUUID();
    expect((await chamar('criar_tarefa', { p: { id: t, titulo: 'Base do fuzz', prazo: hoje } })).ok).toBe(true);
    await fc.assert(fc.asyncProperty(fc.oneof(fc.string({ maxLength: 3000 }), fc.constantFrom('\u0000', 'a\u001bb', '   ')),
      async (texto) => { expect(await chamar('comentar_tarefa', { p_tarefa: t, p_id: randomUUID(), p_texto: texto })).not.toHaveProperty('excecao'); }),
    { numRuns: 150, seed: 20261023 });
    expect(await db.valor<number>(`select count(*)::int from public.tarefas
      where not (char_length(btrim(titulo)) between 2 and 160 and prioridade in ('baixa','normal','alta'))`)).toBe(0);
    expect(await db.valor<number>(`select count(*)::int from public.tarefa_comentarios
      where char_length(btrim(texto)) = 0 or texto ~ '[\\x01-\\x09\\x0b\\x0c\\x0e-\\x1f\\x7f]'`)).toBe(0);
  });

  test('salvar_item_tarefa, mudar_situacao_tarefa e publicar_aviso', async () => {
    const t = randomUUID();
    await chamar('criar_tarefa', { p: { id: t, titulo: 'Base 2' } });
    await fc.assert(fc.asyncProperty(fc.record({ id: fc.oneof(fc.uuid(), feio), texto: feio, feito: feio, remover: feio, x: fc.option(feio) }, { requiredKeys: [] }),
      async (p) => { expect(await chamar('salvar_item_tarefa', { p_tarefa: t, p })).not.toHaveProperty('excecao'); }),
    { numRuns: 150, seed: 20261024 });
    await fc.assert(fc.asyncProperty(fc.string({ maxLength: 20 }),
      async (s) => { expect(await chamar('mudar_situacao_tarefa', { p_id: t, p_situacao: s })).not.toHaveProperty('excecao'); }),
    { numRuns: 80, seed: 20261025 });
    await fc.assert(fc.asyncProperty(fc.record({ id: fc.oneof(fc.uuid(), feio), titulo: feio, texto: feio, expira_em: feio }, { requiredKeys: [] }),
      async (p) => { expect(await chamar('publicar_aviso', { p })).not.toHaveProperty('excecao'); }),
    { numRuns: 150, seed: 20261026 });
    expect(await db.valor<number>(`select count(*)::int from public.tarefas where situacao <> all (private.situacoes_tarefa())`)).toBe(0);
  });
});

interface Cen { db: Banco; pres: string; dir: string; proprio: string; tarefa: string; aviso: string }
async function cenario(): Promise<Cen> {
  const db = await novoBanco();
  const pres = await primeiroAdmin(db);
  await convidarMembro(db, pres, { email: 'vice@exemplo.test', nome: 'Vice', cargo: 'vice_presidente' });
  const dir = await convidarMembro(db, pres, { email: 'dir@exemplo.test', nome: 'Diretor', cargo: 'diretor' });
  const proprio = await convidarMembro(db, pres, { email: 'p@exemplo.test', nome: 'Própria', cargo: 'diretor', permissoes: [
    { modulo: 'tarefas', acao: 'ver', alcance: 'proprios' }, { modulo: 'avisos', acao: 'ver', alcance: 'tudo' }] });
  const tarefa = randomUUID(); const aviso = randomUUID();
  await db.rpc('criar_tarefa', { p: { id: tarefa, titulo: 'Tarefa do presidente' } }, sessao(pres));
  await db.rpc('publicar_aviso', { p: { id: aviso, titulo: 'Aviso do presidente', texto: 'texto' } }, sessao(pres));
  await db.rpc('marcar_aviso_lido', { p_id: aviso }, sessao(dir));
  return { db, pres, dir, proprio, tarefa, aviso };
}
async function mutarFuncao(db: Banco, assinatura: string, de: string, para: string) {
  const def = await db.valor<string>(`select pg_get_functiondef('${assinatura}'::regprocedure)`);
  if (!def.includes(de)) throw new Error(`mutação inválida: "${de}" não está em ${assinatura}`);
  await db.linhas(def.replace(de, para));
}
const ok = (r: { ok?: boolean } | null) => r?.ok === true;

const MUTANTES: { controle: string; desligar: (c: Cen) => Promise<void>; ataque: (c: Cen) => Promise<boolean> }[] = [
  {
    controle: 'alcance "próprios" esconde tarefas alheias (RLS)',
    desligar: ({ db }) => mutarFuncao(db, 'private.ve_tarefa(uuid,uuid)', "private.alcance('tarefas', 'ver') = 'tudo'", 'true'),
    ataque: async ({ db, proprio, tarefa }) => (await db.valor<number>('select count(*)::int from public.tarefas where id = $1', sessao(proprio), [tarefa])) === 1,
  },
  {
    controle: 'só responsável ou editor anda a tarefa',
    desligar: ({ db }) => mutarFuncao(db, 'private.pode_andar_tarefa(public.tarefas)', "(t.responsavel = auth.uid() and private.pode('tarefas', 'ver'))", 'true'),
    ataque: async ({ db, dir, tarefa }) => {
      // diretor sem tarefas/editar, que não criou nem é responsável
      await db.linhas(`delete from public.permissoes where membro_id = $1 and modulo = 'tarefas' and acao = 'editar'`, 'postgres', [dir]);
      return ok(await db.rpc('mudar_situacao_tarefa', { p_id: tarefa, p_situacao: 'feito' }, sessao(dir)));
    },
  },
  {
    controle: 'quem leu um aviso só é visível para o autor e para administradores',
    desligar: async ({ db }) => {
      await db.linhas('drop policy ler on public.aviso_leituras');
      await db.linhas('create policy ler on public.aviso_leituras for select to authenticated using (true)');
    },
    ataque: async ({ db, proprio, aviso }) => (await db.valor<number>('select count(*)::int from public.aviso_leituras where aviso_id = $1', sessao(proprio), [aviso])) > 0,
  },
  {
    controle: 'tarefa não se apaga',
    desligar: ({ db }) => db.linhas('drop trigger tarefas_sem_apagar on public.tarefas').then(() => undefined),
    ataque: async ({ db, tarefa }) => { try { await db.linhas('delete from public.tarefas where id = $1', 'postgres', [tarefa]); return true; } catch { return false; } },
  },
  {
    controle: 'campos extras recusados em criar_tarefa (mass assignment de criado_por)',
    desligar: ({ db }) => mutarFuncao(db, 'private.criar_tarefa(jsonb)',
      "if not coalesce(private.so_chaves(p, array['id','titulo','descricao','responsavel','prazo','prioridade','evento_id','lembrete_dias','itens']), false) then",
      'if false then'),
    ataque: async ({ db, dir }) => {
      const r = await db.rpc('criar_tarefa', { p: { id: randomUUID(), titulo: 'Com campo extra', criado_por: randomUUID() } }, sessao(dir));
      return ok(r);
    },
  },
];

describe('mutação dos controles da Fase 2', () => {
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
