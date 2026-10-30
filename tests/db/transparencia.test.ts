import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco; let pres: string, tes: string, dir: string; let ini: string, fim: string;
const rpc = (n: string, a: Record<string, unknown>, q: string) => db.rpc(n, a, sessao(q));
const SEGREDO_DESCRICAO = 'Reembolso remédio do atleta Fulano de Tal';

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  tes = await convidarMembro(db, pres, { email: 'tes@exemplo.test', nome: 'Tesoureira', cargo: 'tesoureiro' });
  dir = await convidarMembro(db, pres, { email: 'dir@exemplo.test', nome: 'Diretor', cargo: 'diretor' });
  ini = await db.valor<string>(`select to_char(date_trunc('month', private.hoje()) - interval '1 month', 'YYYY-MM-DD')`);
  fim = await db.valor<string>(`select to_char(date_trunc('month', private.hoje()) - interval '1 day', 'YYYY-MM-DD')`);
  const conta = randomUUID(), catS = randomUUID(), catE = randomUUID();
  await rpc('salvar_conta', { p: { id: conta, nome: 'Conta', tipo: 'movimento', saldo_inicial: '0', data_saldo_inicial: '2025-01-01' } }, tes);
  await rpc('salvar_categoria', { p: { id: catS, nome: 'Saúde e bem-estar', tipo: 'saida' } }, tes);
  await rpc('salvar_categoria', { p: { id: catE, nome: 'Doações', tipo: 'entrada' } }, tes);
  await rpc('criar_lancamento', { p: { id: randomUUID(), tipo: 'saida', situacao: 'realizada', valor: '45.00', data: ini, descricao: SEGREDO_DESCRICAO, categoria_id: catS, conta_id: conta } }, tes);
  await rpc('criar_lancamento', { p: { id: randomUUID(), tipo: 'entrada', situacao: 'realizada', valor: '300.00', data: ini, descricao: 'Doação de Maria da Silva', categoria_id: catE, conta_id: conta } }, tes);
});
afterAll(async () => { await db?.destruir(); });

describe('prévia e publicação', () => {
  test('prévia: só agregados, sem descrição de lançamento', async () => {
    const r = await rpc('previa_transparencia', { p_inicio: ini, p_fim: fim }, tes);
    expect(r.dados).toMatchObject({ entradas: '300.00', saidas: '45.00' });
    expect(r.dados.despesas).toEqual([{ grupo: 'Saúde e bem-estar', valor: '45.00' }]);
    const texto = JSON.stringify(r);
    expect(texto).not.toContain('Fulano'); expect(texto).not.toContain('Maria da Silva');
  });
  test('período inválido, no futuro ou longo demais é recusado', async () => {
    expect((await rpc('previa_transparencia', { p_inicio: fim, p_fim: ini }, tes)).campo).toBe('periodo');
    expect((await rpc('previa_transparencia', { p_inicio: '2020-01-01', p_fim: fim }, tes)).campo).toBe('periodo');
    expect((await rpc('publicar_transparencia', { p_id: randomUUID(), p_titulo: 'Futuro', p_inicio: ini, p_fim: '2099-01-01', p_observacao: null }, tes)).campo).toBe('periodo');
  });
  test('publicar exige aprovar no financeiro e sessão válida', async () => {
    const args = { p_id: randomUUID(), p_titulo: 'Contas do mês', p_inicio: ini, p_fim: fim, p_observacao: null };
    expect((await rpc('publicar_transparencia', args, dir)).erro).toBe('sem_permissao');
    expect((await db.rpc('publicar_transparencia', args, sessao(tes, { totpHaSegundos: 31 * 86400, loginHaSegundos: 31 * 86400 }))).erro).toBe('sessao_expirada');
    expect(await rpc('publicar_transparencia', args, tes)).toMatchObject({ ok: true, repetido: false });
    expect(await rpc('publicar_transparencia', args, tes)).toMatchObject({ ok: true, repetido: true });
  });
});

describe('página pública (sem login)', () => {
  test('anon vê só a fotografia publicada, congelada', async () => {
    const r = await db.rpc('transparencia_publica', {}, 'anon');
    expect(r.publicacoes).toHaveLength(1);
    expect(r.publicacoes[0]).toMatchObject({ titulo: 'Contas do mês', dados: { entradas: '300.00' } });
    expect(Object.keys(r.publicacoes[0])).not.toContain('publicado_por');
    // lançamento novo depois de publicar não muda o que está no ar
    const cat = await db.valor<string>(`select id from public.categorias where nome = 'Doações'`);
    const conta = await db.valor<string>(`select id from public.contas_bancarias limit 1`);
    await rpc('criar_lancamento', { p: { id: randomUUID(), tipo: 'entrada', situacao: 'realizada', valor: '1000.00', data: ini, descricao: 'Nova', categoria_id: cat, conta_id: conta } }, tes);
    expect((await db.rpc('transparencia_publica', {}, 'anon')).publicacoes[0].dados.entradas).toBe('300.00');
  });
  test('anon não lê tabela nem chama prévia, publicar ou retirar', async () => {
    expect(await db.falha('select * from public.transparencia_publicacoes', 'anon')).toMatch(/permission denied/);
    expect(await db.falha('select * from public.lancamentos', 'anon')).toMatch(/permission denied/);
    for (const [f, a] of [['previa_transparencia', `'${ini}'::date, '${fim}'::date`], ['publicar_transparencia', `gen_random_uuid(), 'x', '${ini}'::date, '${fim}'::date, null`],
      ['retirar_transparencia', `gen_random_uuid(), 'motivo'`], ['montar_transparencia', `'${ini}'::date, '${fim}'::date`]] as const) {
      const schema = f === 'montar_transparencia' ? 'private' : 'public';
      expect(await db.falha(`select ${schema}.${f}(${a})`, 'anon')).toMatch(/permission denied/);
    }
  });
  test('retirar tira do ar sem apagar; precisa de motivo e permissão', async () => {
    const id = await db.valor<string>(`select id from public.transparencia_publicacoes limit 1`);
    expect((await rpc('retirar_transparencia', { p_id: id, p_motivo: 'x' }, tes)).campo).toBe('motivo');
    expect((await rpc('retirar_transparencia', { p_id: id, p_motivo: 'Valor corrigido' }, dir)).erro).toBe('sem_permissao');
    expect(await rpc('retirar_transparencia', { p_id: id, p_motivo: 'Valor corrigido' }, tes)).toMatchObject({ ok: true });
    expect((await db.rpc('transparencia_publica', {}, 'anon')).publicacoes).toEqual([]);
    expect(await db.valor('select count(*)::int from public.transparencia_publicacoes')).toBe(1);
    expect(await db.falha(`delete from public.transparencia_publicacoes`, 'postgres')).toBeTruthy();
  });
});


test('fuzz: argumentos aleatórios em prévia e publicação nunca viram exceção', async () => {
  const fc = (await import('fast-check')).default;
  const feio = fc.oneof(fc.string(), fc.constant(null), fc.constantFrom("'; drop table public.lancamentos; --", '2026-02-30', 'a\u0007b', '9'.repeat(400), '<script>x</script>'));
  const data = fc.oneof(fc.constant(null), fc.integer({ min: -800, max: 400 }).map((k) => new Date(Date.UTC(2026, 0, 1) + k * 86_400_000).toISOString().slice(0, 10)));
  await fc.assert(fc.asyncProperty(feio, data, data, feio, async (titulo, a, b, obs) => {
    await db.linhas('delete from private.limites');
    for (const [n, args] of [['previa_transparencia', { p_inicio: a, p_fim: b }], ['publicar_transparencia', { p_id: randomUUID(), p_titulo: titulo, p_inicio: a, p_fim: b, p_observacao: obs }]] as const) {
      try { await db.rpc(n, args, sessao(tes)); }
      catch (e) { expect((e as Error).message).toMatch(/invalid byte sequence|null character|unsupported Unicode/); }
    }
  }), { numRuns: 200, seed: 20261027 });
  expect(await db.valor(`select count(*)::int from public.transparencia_publicacoes where periodo_fim > private.hoje() or periodo_fim < periodo_inicio`)).toBe(0);
});
