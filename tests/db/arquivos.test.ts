import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco;
let pres: string, tes: string, dir: string, dir2: string;
let lancDir: string;
const SHA = 'a'.repeat(64);

const conta = (sql: string, ctx?: Parameters<Banco['valor']>[1], params?: unknown[]) =>
  db.valor<number>(`select count(*)::int from (${sql}) t`, ctx, params);
/** Simula o upload feito pela Edge Function com a service role. */
const subir = (bucket: string, nome: string, mime = 'image/jpeg', tamanho = 1234) =>
  db.linhas(`insert into storage.objects (bucket_id, name, metadata) values ($1, $2, jsonb_build_object('mimetype', $3::text, 'size', $4::int))`,
    'postgres', [bucket, nome, mime, tamanho]);

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  tes = await convidarMembro(db, pres, { email: 'tes@exemplo.test', nome: 'Tesoureira', cargo: 'tesoureiro' });
  dir = await convidarMembro(db, pres, { email: 'dir@exemplo.test', nome: 'Diretor', cargo: 'diretor' });
  dir2 = await convidarMembro(db, pres, { email: 'dir2@exemplo.test', nome: 'Diretora Dois', cargo: 'diretor', permissoes: [
    { modulo: 'financeiro', acao: 'ver', alcance: 'proprios' }, { modulo: 'financeiro', acao: 'criar', alcance: 'tudo' }] });
  const contaId = randomUUID(); const cat = randomUUID();
  await db.rpc('salvar_conta', { p: { id: contaId, nome: 'Conta Movimento', tipo: 'movimento', saldo_inicial: '0', data_saldo_inicial: '2026-01-01' } }, sessao(tes));
  await db.rpc('salvar_categoria', { p: { id: cat, nome: 'Transporte', tipo: 'saida' } }, sessao(tes));
  lancDir = randomUUID();
  const hoje = await db.valor<string>(`select to_char(private.hoje(), 'YYYY-MM-DD')`);
  const r = await db.rpc('criar_lancamento', { p: { id: lancDir, tipo: 'saida', situacao: 'realizada', valor: '80.00', data: hoje,
    descricao: 'Pedágio', categoria_id: cat, conta_id: contaId, forma_pagamento: 'dinheiro' } }, sessao(dir));
  if (!r.ok) throw new Error(JSON.stringify(r));
});
afterAll(async () => { await db?.destruir(); });

describe('comprovantes', () => {
  test('buckets são privados e com limite de tamanho e tipos', async () => {
    const b = await db.linhas(`select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id`);
    expect(b.map((x) => x.id)).toEqual(['captacao', 'comprovantes', 'contador', 'institucional', 'pessoas', 'saude']);
    for (const x of b) {
      expect(x.public).toBe(false);
      expect(Number(x.file_size_limit)).toBeLessThanOrEqual(50 * 1024 * 1024); // 0037: teto do PDF; fotos e o resto ficam em 10 MB na função
      expect((x.allowed_mime_types as string[]).length).toBeGreaterThan(0);
    }
  });

  test('autorização: quem lançou ou quem edita pode anexar; outros não', async () => {
    expect((await db.rpc('autorizar_comprovante', { p_lancamento: lancDir }, sessao(dir))).ok).toBe(true);
    expect((await db.rpc('autorizar_comprovante', { p_lancamento: lancDir }, sessao(tes))).ok).toBe(true);
    expect((await db.rpc('autorizar_comprovante', { p_lancamento: lancDir }, sessao(dir2))).erro).toBe('sem_permissao');
    expect((await db.rpc('autorizar_comprovante', { p_lancamento: randomUUID() }, sessao(tes))).erro).toBe('nao_encontrado');
    expect((await db.rpc('autorizar_comprovante', { p_lancamento: lancDir }, sessao(dir, { aal: 'aal1' }))).erro).toBe('precisa_2fa');
  });

  test('cliente logado não registra comprovante nem grava no storage', async () => {
    expect(await db.falha(`select public.registrar_comprovante($1, '{}'::jsonb)`, sessao(tes), [tes])).toMatch(/permission denied/);
    expect(await db.falha(`insert into storage.objects (bucket_id, name) values ('comprovantes', $1)`, sessao(tes), [`${lancDir}/x.jpg`]))
      .toMatch(/row-level security|permission denied/);
  });

  test('registro exige arquivo existente, caminho do lançamento e metadados válidos', async () => {
    const caminho = `${lancDir}/${randomUUID()}.jpg`;
    const p = { lancamento_id: lancDir, caminho, sha256: SHA, origem: 'camera' };
    expect((await db.rpc('registrar_comprovante', { p_usuario: dir, p }, 'service')).erro).toBe('arquivo_inexistente');
    await subir('comprovantes', caminho);
    expect((await db.rpc('registrar_comprovante', { p_usuario: dir, p: { ...p, origem: 'telepatia' } }, 'service')).campo).toBe('origem');
    expect((await db.rpc('registrar_comprovante', { p_usuario: dir, p: { ...p, sha256: 'xyz' } }, 'service')).campo).toBe('sha256');
    expect((await db.rpc('registrar_comprovante', { p_usuario: dir, p: { ...p, extra: 1 } }, 'service')).erro).toBe('invalido');
    const outro = `${randomUUID()}/${randomUUID()}.jpg`;
    await subir('comprovantes', outro);
    expect((await db.rpc('registrar_comprovante', { p_usuario: dir, p: { ...p, caminho: outro } }, 'service')).campo).toBe('caminho');
    const r = await db.rpc('registrar_comprovante', { p_usuario: dir, p }, 'service');
    expect(r.ok).toBe(true);
    expect(r.duplicado).toBe(false);
    expect((await db.rpc('registrar_comprovante', { p_usuario: dir, p }, 'service')).erro).toBe('ja_registrado');
  });

  test('mesmo arquivo ou mesma chave de nota em outro lançamento gera aviso de duplicidade', async () => {
    const caminho = `${lancDir}/${randomUUID()}.pdf`;
    await subir('comprovantes', caminho, 'application/pdf');
    const chave = '3'.repeat(44);
    const r = await db.rpc('registrar_comprovante', { p_usuario: dir, p: { lancamento_id: lancDir, caminho, sha256: SHA, origem: 'pdf', chave_acesso: chave } }, 'service');
    expect(r.ok).toBe(true);
    expect(r.duplicado).toBe(true);
    const v = await db.rpc('verificar_duplicidade', { p_sha256: SHA, p_chave: null, p_codigo: null }, sessao(tes));
    expect(v.ok).toBe(true);
    expect(v.lancamentos).toContain(lancDir);
  });

  test('leitura do arquivo segue o alcance do financeiro', async () => {
    const nome = await db.valor<string>(`select caminho from public.comprovantes where lancamento_id = $1 limit 1`, 'postgres', [lancDir]);
    expect(await conta(`select * from storage.objects where bucket_id = 'comprovantes' and name = $1`, sessao(tes), [nome])).toBe(1);
    expect(await conta(`select * from storage.objects where bucket_id = 'comprovantes' and name = $1`, sessao(dir2), [nome])).toBe(0);
    expect(await conta(`select * from storage.objects where bucket_id = 'comprovantes' and name = $1`, sessao(tes, { aal: 'aal1' }), [nome])).toBe(0);
    expect(await conta(`select * from storage.objects`, 'anon')).toBe(0);
  });

  test('saída com comprovante sai da lista de pendências do mês', async () => {
    const mes = await db.valor<string>(`select to_char(date_trunc('month', private.hoje()), 'YYYY-MM-DD')`);
    const ck = await db.rpc('checklist_fechamento', { p_competencia: mes }, sessao(tes));
    expect(ck.ok).toBe(true);
    expect(ck.itens.find((i: any) => i.chave === 'comprovantes').pendentes).toBe(0);
  });
});

describe('arquivos do contador', () => {
  test('só quem pode enviar (contador:criar) é autorizado', async () => {
    expect((await db.rpc('autorizar_arquivo_contador', {}, sessao(dir))).erro).toBe('sem_permissao');
    expect((await db.rpc('autorizar_arquivo_contador', {}, sessao(tes))).ok).toBe(true);
  });

  test('registro pelo servidor, leitura por quem tem contador:ver', async () => {
    const caminho = `2026-09/${randomUUID()}.pdf`;
    await subir('contador', caminho, 'application/pdf', 5000);
    const p = { competencia: '2026-09-01', tipo: 'balancete', descricao: 'Balancete de setembro', nome_original: 'balancete set.pdf', caminho, sha256: SHA };
    expect(await db.falha(`select public.registrar_arquivo_contador($1, $2::jsonb)`, sessao(tes), [tes, JSON.stringify(p)])).toMatch(/permission denied/);
    expect((await db.rpc('registrar_arquivo_contador', { p_usuario: tes, p: { ...p, competencia: '2026-09-15' } }, 'service')).campo).toBe('competencia');
    expect((await db.rpc('registrar_arquivo_contador', { p_usuario: tes, p: { ...p, nome_original: '<script>.pdf' } }, 'service')).campo).toBe('nome_original');
    expect((await db.rpc('registrar_arquivo_contador', { p_usuario: tes, p }, 'service')).ok).toBe(true);
    expect(await conta('select * from public.arquivos_contador', sessao(dir))).toBe(1);
    expect(await conta('select * from public.arquivos_contador', sessao(dir2))).toBe(0);
    expect(await conta(`select * from storage.objects where bucket_id = 'contador'`, sessao(dir))).toBe(1);
    expect(await conta(`select * from storage.objects where bucket_id = 'contador'`, sessao(dir2))).toBe(0);
  });
});
