import fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

let db: Banco; let pres: string, sec: string, dir: string, hoje: string, atleta: string, consent: string;
const rpc = (n: string, a: Record<string, unknown>, q: string) => db.rpc(n, a, sessao(q));
const objeto = (nome: string, mime = 'image/jpeg') => db.linhas(`insert into storage.objects (bucket_id, name, metadata) values ('pessoas', $1, $2)`, 'postgres', [nome, JSON.stringify({ mimetype: mime, size: 2048 })]);
const registrar = (caminho: string, doc = atleta) => db.valor<Record<string, unknown>>(`select public.registrar_documento($1, $2)`, 'service',
  [sec, JSON.stringify({ area: 'foto_pessoa', documento_id: doc, caminho, sha256: 'b'.repeat(64) })]);
const foto = () => db.valor<string | null>('select foto_caminho from public.pessoas where id = $1', 'postgres', [atleta]);

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  sec = await convidarMembro(db, pres, { email: 'sec@exemplo.test', nome: 'Secretária', cargo: 'secretario' });
  dir = await convidarMembro(db, pres, { email: 'dir@exemplo.test', nome: 'Diretor', cargo: 'diretor' });
  hoje = await db.valor<string>(`select to_char(private.hoje(), 'YYYY-MM-DD')`);
  atleta = randomUUID();
  expect((await rpc('salvar_pessoa', { p: { id: atleta, nome: 'Atleta Foto', atleta: true, associado: false } }, sec)).ok).toBe(true);
});
afterAll(async () => { await db?.destruir(); });

describe('foto 3x4', () => {
  test('sem autorização de imagem, nem autoriza nem registra (fail closed)', async () => {
    expect((await rpc('autorizar_documento', { p_area: 'foto_pessoa', p_documento: atleta }, sec)).erro).toBe('sem_consentimento');
    const c = `${atleta}/${randomUUID()}.jpg`; await objeto(c);
    expect((await registrar(c)).erro).toBe('sem_consentimento');
    expect(await foto()).toBeNull();
  });
  test('com autorização: só quem edita pessoas autoriza; PDF recusado; trocar a foto põe a antiga na fila', async () => {
    consent = randomUUID();
    expect((await rpc('registrar_consentimento', { p: { id: consent, pessoa_id: atleta, finalidade: 'imagem', base_legal: 'consentimento', concedido_por: 'titular', nome_concedente: 'Atleta Foto', concedido_em: hoje } }, sec)).ok).toBe(true);
    expect((await rpc('autorizar_documento', { p_area: 'foto_pessoa', p_documento: atleta }, dir)).erro).toBe('sem_permissao');
    expect((await rpc('autorizar_documento', { p_area: 'foto_pessoa', p_documento: atleta }, sec)).ok).toBe(true);
    const pdf = `${atleta}/${randomUUID()}.pdf`; await objeto(pdf, 'application/pdf');
    expect((await registrar(pdf)).campo).toBe('mime');
    const a = `${atleta}/${randomUUID()}.jpg`, b = `${atleta}/${randomUUID()}.png`;
    await objeto(a); await objeto(b, 'image/png');
    expect((await registrar(`${randomUUID()}/${randomUUID()}.jpg`)).campo).toBe('caminho');
    expect((await registrar(a)).ok).toBe(true);
    expect((await registrar(b)).ok).toBe(true);
    expect(await foto()).toBe(b);
    expect(await db.valor<number>(`select count(*)::int from private.arquivos_remover where caminho = $1`, 'postgres', [a])).toBe(1);
  });
  test('ler o arquivo: só quem vê pessoas e só a foto atual; anon nada', async () => {
    const atual = (await foto())!;
    const ve = (q: Parameters<Banco['valor']>[1]) => db.valor<number>(`select count(*)::int from storage.objects where bucket_id = 'pessoas' and name = $1`, q, [atual]);
    expect(await ve(sessao(sec))).toBe(1);
    expect(await ve(sessao(sec, { aal: 'aal1' }))).toBe(0); // sem a segunda etapa, nada
    await db.linhas(`delete from public.permissoes where membro_id = $1 and modulo = 'pessoas'`, 'postgres', [dir]);
    expect(await ve(sessao(dir))).toBe(0);
    expect(await db.valor<number>(`select count(*)::int from storage.objects where bucket_id = 'pessoas'`, 'anon').catch(() => 0)).toBe(0);
  });
  test('revogar a autorização tira a foto e põe na fila; remover é idempotente', async () => {
    const atual = (await foto())!;
    expect((await rpc('revogar_consentimento', { p_id: consent }, sec)).ok).toBe(true);
    expect(await foto()).toBeNull();
    expect(await db.valor<number>(`select count(*)::int from private.arquivos_remover where caminho = $1`, 'postgres', [atual])).toBe(1);
    expect(await rpc('remover_foto_pessoa', { p_pessoa: atleta }, sec)).toMatchObject({ ok: true, repetido: true });
    expect((await rpc('remover_foto_pessoa', { p_pessoa: atleta }, dir)).erro).toBe('sem_permissao');
  });
});

describe('ficha esportiva', () => {
  test('grava a lista fixa; campo extra, camisa e telefone ruins recusados', async () => {
    const p = { apelido: 'Foguete', numero_camisa: 7, posicao: 'Pivô', tamanho_uniforme: 'G', na_associacao_desde: '2018-03-01', emergencia_nome: 'Contato Fictício', emergencia_telefone: '16999990000' };
    expect((await rpc('salvar_ficha_atleta', { p_pessoa: atleta, p }, dir)).erro).toBe('sem_permissao');
    expect((await rpc('salvar_ficha_atleta', { p_pessoa: atleta, p: { ...p, classe_funcional: '1.0' } }, sec)).erro).toBe('invalido');
    expect((await rpc('salvar_ficha_atleta', { p_pessoa: atleta, p: { ...p, numero_camisa: 100 } }, sec)).campo).toBe('numero_camisa');
    expect((await rpc('salvar_ficha_atleta', { p_pessoa: atleta, p: { ...p, numero_camisa: '7' } }, sec)).campo).toBe('numero_camisa');
    expect((await rpc('salvar_ficha_atleta', { p_pessoa: atleta, p: { ...p, tamanho_uniforme: 'XXL' } }, sec)).campo).toBe('tamanho_uniforme');
    expect((await rpc('salvar_ficha_atleta', { p_pessoa: atleta, p: { ...p, emergencia_telefone: 'abc' } }, sec)).campo).toBe('emergencia_telefone');
    expect((await rpc('salvar_ficha_atleta', { p_pessoa: atleta, p: { ...p, na_associacao_desde: '2999-01-01' } }, sec)).campo).toBe('na_associacao_desde');
    expect(await rpc('salvar_ficha_atleta', { p_pessoa: atleta, p }, sec)).toMatchObject({ ok: true });
    expect(await rpc('salvar_ficha_atleta', { p_pessoa: atleta, p: { apelido: null } }, sec)).toMatchObject({ ok: true });
    const [x] = await db.linhas('select apelido, numero_camisa, posicao from public.pessoas where id = $1', 'postgres', [atleta]);
    expect(x).toMatchObject({ apelido: null, numero_camisa: 7, posicao: 'Pivô' });
  });
  test('desligar apaga contato de emergência e foto', async () => {
    expect((await rpc('salvar_pessoa', { p: { id: atleta, nome: 'Atleta Foto', atleta: true, associado: false, situacao: 'desligado' } }, sec)).ok).toBe(true);
    const [x] = await db.linhas('select emergencia_nome, emergencia_telefone, foto_caminho, numero_camisa from public.pessoas where id = $1', 'postgres', [atleta]);
    expect(x).toMatchObject({ emergencia_nome: null, emergencia_telefone: null, foto_caminho: null, numero_camisa: 7 });
    expect((await rpc('salvar_ficha_atleta', { p_pessoa: atleta, p: { apelido: 'x1' } }, sec)).erro).toBe('pessoa_desligada');
    expect((await rpc('autorizar_documento', { p_area: 'foto_pessoa', p_documento: atleta }, sec)).erro).toBe('nao_encontrado');
  });
  test('fuzz: nunca exceção inesperada', async () => {
    const outro = randomUUID();
    await rpc('salvar_pessoa', { p: { id: outro, nome: 'Atleta Fuzz', atleta: true, associado: false } }, sec);
    const feio = fc.oneof(fc.string(), fc.constant(null), fc.integer(), fc.double(), fc.boolean(), fc.constantFrom('', 'G', '2026-02-30', "'; drop table x; --", '\u0000'));
    await fc.assert(fc.asyncProperty(fc.record({ apelido: feio, numero_camisa: feio, posicao: feio, tamanho_uniforme: feio, na_associacao_desde: feio, emergencia_telefone: feio }, { requiredKeys: [] }),
      async (p) => {
        await db.linhas('delete from private.limites');
        try { await rpc('salvar_ficha_atleta', { p_pessoa: outro, p }, sec); }
        catch (e) { expect((e as Error).message).toMatch(/invalid input syntax|out of range|null character|unsupported Unicode/); }
      }), { numRuns: 200, seed: 2026102803 });
  });
});
