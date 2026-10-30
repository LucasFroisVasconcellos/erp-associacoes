// Auditoria adversarial: entradas aleatórias e malformadas contra as RPCs.
// Propriedades: (1) nenhuma entrada derruba a função com erro técnico (exceção do banco);
// (2) nada inválido é aceito; (3) o banco continua consistente depois de tudo.
import fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco;
let pres: string, tes: string, conta: string, cat: string, hoje: string;

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  await convidarMembro(db, pres, { email: 'vice@exemplo.test', nome: 'Vice', cargo: 'vice_presidente' });
  tes = await convidarMembro(db, pres, { email: 'tes@exemplo.test', nome: 'Tesoureira', cargo: 'tesoureiro' });
  conta = randomUUID(); cat = randomUUID();
  await db.rpc('salvar_conta', { p: { id: conta, nome: 'Conta', tipo: 'movimento', saldo_inicial: '0', data_saldo_inicial: '2026-01-01' } }, sessao(tes));
  await db.rpc('salvar_categoria', { p: { id: cat, nome: 'Material', tipo: 'saida' } }, sessao(tes));
  hoje = await db.valor<string>(`select to_char(private.hoje(), 'YYYY-MM-DD')`);
});
afterAll(async () => { await db?.destruir(); });

// Valores "feios": textos enormes, controle, unicode, SQL, números estranhos, tipos errados.
const feio = fc.oneof(
  fc.string(), fc.string({ minLength: 300, maxLength: 3000 }), fc.integer(), fc.double(), fc.boolean(), fc.constant(null),
  fc.constantFrom("'; drop table public.lancamentos; --", '<script>alert(1)</script>', '\u0000', '1e309', '-0', 'NaN', '0x10',
    '9999999999.99', '00000000-0000-0000-0000-000000000000', '../../etc/passwd', '{"a":1}', '٣٤٥', '１２３'),
  fc.array(fc.string(), { maxLength: 3 }), fc.dictionary(fc.string({ maxLength: 8 }), fc.string(), { maxKeys: 3 }),
);

// Como o PostgREST: parâmetro jsonb sempre chega como JSON (string vira "texto").
const json = (v: unknown) => (typeof v === 'string' ? JSON.stringify(v) : v);
// O Postgres recusa \u0000 dentro de jsonb ao converter o tipo (SQLSTATE 22P05): recusa segura na fronteira.
const recusaDeTipo = (m: string) => /unsupported Unicode escape sequence|cannot be converted to text|invalid byte sequence for encoding|null character/.test(m);
// O fuzz faz centenas de chamadas: zera o limite de uso para testar a validação, não o limite.
const zerarLimites = () => db.linhas('delete from private.limites');

async function chamar(nome: string, args: Record<string, unknown>) {
  try { return await db.rpc(nome, args, sessao(tes)); }
  catch (e) {
    const m = (e as Error).message;
    return recusaDeTipo(m) ? { erro: 'recusado_no_tipo' } : { excecao: m };
  }
}

test('criar_lancamento: payload aleatório nunca vira exceção nem é aceito quando inválido', async () => {
  const antes = await db.valor<number>('select count(*)::int from public.lancamentos');
  let aceitos = 0;
  await fc.assert(fc.asyncProperty(
    fc.record({ id: fc.oneof(fc.uuid(), feio), tipo: fc.oneof(fc.constantFrom('entrada', 'saida'), feio), valor: feio, data: feio, descricao: feio, extra: fc.option(feio) }, { requiredKeys: [] }),
    async (p) => {
      await zerarLimites();
      const r = await chamar('criar_lancamento', { p: { situacao: 'realizada', conta_id: conta, ...p } });
      expect(r).not.toHaveProperty('excecao');
      if (r.ok) aceitos++;
    }), { numRuns: 250, seed: 20261020 });
  // só pode ter sido aceito o que é realmente válido: confere no banco
  const invalidos = await db.valor<number>(`select count(*)::int from public.lancamentos
    where not (valor > 0 and valor <= 10000000 and char_length(btrim(descricao)) between 2 and 200 and data <= private.hoje())`);
  expect(invalidos).toBe(0);
  expect(await db.valor<number>('select count(*)::int from public.lancamentos')).toBe(antes + aceitos);
});

test('valores em texto: só "N" ou "N.NN" positivos até 10 milhões passam', async () => {
  await fc.assert(fc.asyncProperty(fc.string({ maxLength: 20 }), async (valor) => {
    await zerarLimites();
    const r = await chamar('criar_lancamento', { p: { id: randomUUID(), tipo: 'saida', situacao: 'realizada', valor, data: hoje, descricao: 'Fuzz de valor', categoria_id: cat, conta_id: conta } });
    expect(r).not.toHaveProperty('excecao');
    const valido = /^\d{1,8}(\.\d{1,2})?$/.test(valor) && Number(valor) > 0 && Number(valor) <= 10_000_000;
    expect(Boolean(r.ok), `valor ${JSON.stringify(valor)} → ${JSON.stringify(r)}`).toBe(valido);
  }), { numRuns: 300, seed: 7 });
});

test('RPCs de cadastro e acesso: entradas aleatórias nunca viram exceção', async () => {
  const alvos: [string, (v: unknown) => Record<string, unknown>][] = [
    ['salvar_conta', (v) => ({ p: json(v) })], ['salvar_categoria', (v) => ({ p: json(v) })], ['salvar_tipo_gasto', (v) => ({ p: json(v) })],
    ['salvar_recorrencia', (v) => ({ p: json(v) })], ['editar_lancamento', (v) => ({ p_id: randomUUID(), p: json(v) })],
    ['verificar_duplicidade', (v) => ({ p_sha256: typeof v === 'string' ? v : null, p_chave: null, p_codigo: null })],
  ];
  for (const [nome, args] of alvos) {
    await fc.assert(fc.asyncProperty(fc.oneof(feio, fc.object()), async (v) => {
      await zerarLimites();
      const r = await chamar(nome, args(v));
      expect(r, `${nome}(${JSON.stringify(v)?.slice(0, 80)})`).not.toHaveProperty('excecao');
    }), { numRuns: 60, seed: 11 });
  }
  // convite (administrador com 2FA recente) com campos aleatórios
  await fc.assert(fc.asyncProperty(feio, feio, feio, async (email, nome, cargo) => {
    await zerarLimites();
    let r;
    const txt = (v: unknown) => (v === null || typeof v === 'string' ? v : JSON.stringify(v)); // parâmetros text
    try { r = await db.rpc('registrar_convite', { p_email: txt(email), p_nome: txt(nome), p_cargo: txt(cargo), p_permissoes: [] }, sessao(pres)); }
    catch (e) { const m = (e as Error).message; r = recusaDeTipo(m) || /invalid byte sequence|null character/.test(m) ? { erro: 'recusado_no_tipo' } : { excecao: m }; }
    expect(r).not.toHaveProperty('excecao');
  }), { numRuns: 60, seed: 3 });
});

test('claims de sessão adulteradas não dão acesso', async () => {
  for (const claims of [
    { sub: tes, role: 'authenticated', aal: 'AAL2' },
    { sub: tes, role: 'authenticated', aal: 'aal2 ' },
    { sub: tes, role: 'authenticated', aal: ['aal2'] },
    { sub: 'nao-e-uuid', role: 'authenticated', aal: 'aal2' },
    { sub: randomUUID(), role: 'authenticated', aal: 'aal2' },
  ]) {
    let r;
    try { r = await db.rpc('meu_perfil', {}, claims); } catch (e) { r = { excecao: (e as Error).message }; }
    expect(r?.ok, JSON.stringify(claims)).not.toBe(true);
  }
  // amr com timestamp malformado: não dá para saber a idade da sessão, então vence (fail closed)
  const r = await db.rpc('definir_permissoes', { p_membro: tes, p_permissoes: [] },
    { sub: pres, role: 'authenticated', aal: 'aal2', amr: [{ method: 'totp', timestamp: '9999999999999999999' }, { method: 'totp', timestamp: 'agora' }] });
  expect(r.erro).toBe('sessao_expirada');
});
