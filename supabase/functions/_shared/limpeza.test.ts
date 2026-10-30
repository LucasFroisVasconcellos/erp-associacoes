import { expect, test } from 'vitest';
import { tratarLimpeza } from './limpeza';

const post = () => new Request('https://x.test', { method: 'POST' });
const C = '5f4dcc3b-5aa7-465d-8a2b-9c0e1f2a3b4c/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.pdf';

test('remove e confirma; caminho ou bucket estranho não é tocado; falha de remoção não confirma', async () => {
  const feitos: string[] = [];
  const r = await tratarLimpeza(post(), {
    pegar: async () => ({ ok: true, arquivos: [{ bucket: 'saude', caminho: C }, { bucket: 'saude', caminho: '../../outro/arquivo' },
      { bucket: 'publico', caminho: C }, { bucket: 'pessoas', caminho: C }] }),
    remover: async (b) => ({ ok: b === 'saude' }),
    confirmar: async (b, c) => { feitos.push(`${b}:${c}`); },
  });
  expect(await r.json()).toEqual({ ok: true, removidos: 1, falhas: 3 });
  expect(feitos).toEqual([`saude:${C}`]);
});

test('só POST; erro ao ler a fila vira resposta genérica', async () => {
  const d = { pegar: async () => ({ erro: 'x' }), remover: async () => ({ ok: true }), confirmar: async () => undefined };
  expect((await tratarLimpeza(new Request('https://x.test'), d as never)).status).toBe(405);
  expect((await tratarLimpeza(post(), d as never)).status).toBe(500);
});
