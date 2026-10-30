import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { type Banco, convidarMembro, novoBanco, primeiroAdmin, sessao } from './harness';

const MB = 1024 * 1024;
let db: Banco; let pres: string, sec: string;

async function enviar(mime: string, tamanho: number, ext: string) {
  const id = randomUUID();
  expect((await db.rpc('salvar_documento_institucional', { p: { id, tipo: 'estatuto', titulo: 'Estatuto social' } }, sessao(sec))).ok).toBe(true);
  const caminho = `${id}/${randomUUID()}.${ext}`;
  await db.linhas(`insert into storage.objects (bucket_id, name, metadata) values ('institucional', $1, $2)`, 'postgres',
    [caminho, JSON.stringify({ mimetype: mime, size: tamanho })]);
  const r = await db.valor<Record<string, unknown>>(`select public.registrar_documento($1, $2)`, 'service',
    [sec, JSON.stringify({ area: 'institucional', documento_id: id, caminho, sha256: 'c'.repeat(64) })]);
  return { r, id };
}

beforeAll(async () => {
  db = await novoBanco();
  pres = await primeiroAdmin(db);
  sec = await convidarMembro(db, pres, { email: 'sec@exemplo.test', nome: 'Sec', cargo: 'secretario' });
});
afterAll(async () => { await db?.destruir(); });

test('PDF de 20 MB e de exatamente 50 MB: aceito', async () => {
  expect((await enviar('application/pdf', 20 * MB, 'pdf')).r.ok).toBe(true);
  expect((await enviar('application/pdf', 50 * MB, 'pdf')).r.ok).toBe(true);
});

test('PDF acima de 50 MB e foto acima de 10 MB: recusados, nada é gravado', async () => {
  for (const [mime, tam, ext] of [['application/pdf', 50 * MB + 1, 'pdf'], ['image/jpeg', 10 * MB + 1, 'jpg']] as const) {
    const { r, id } = await enviar(mime, tam, ext);
    expect(r).toMatchObject({ erro: 'invalido', campo: 'tamanho' });
    expect(await db.valor('select arquivo_caminho from public.documentos_institucionais where id = $1', 'postgres', [id])).toBeNull();
  }
});

test('a regra é a mesma nas restrições das tabelas (sem passar pela função)', async () => {
  const ok = (m: string | null, t: number | null) => db.valor<boolean>('select private.tamanho_arquivo_ok($1, $2)', 'postgres', [m, t]);
  expect(await ok('application/pdf', 50 * MB)).toBe(true);
  expect(await ok('application/pdf', 50 * MB + 1)).toBe(false);
  expect(await ok('image/png', 10 * MB + 1)).toBe(false);
  expect(await ok(null, 2 * MB)).toBe(true);
  expect(await ok(null, 11 * MB)).toBe(false);
  expect(await ok('application/pdf', 0)).toBe(false);
  expect(await ok('application/pdf', null)).toBe(false);
  const { id } = await enviar('application/pdf', 1 * MB, 'pdf');
  expect(await db.falha(`update public.documentos_institucionais set arquivo_mime = 'image/jpeg', arquivo_tamanho = $2 where id = $1`, 'postgres', [id, 20 * MB]))
    .toMatch(/arquivo_tamanho_check/);
  expect(await db.falha('select private.tamanho_arquivo_ok($1, $2)', sessao(sec), ['application/pdf', 1])).toMatch(/permission denied/);
});
