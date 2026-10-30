import { expect, test } from 'vitest';
import { rascunhosDe, type Rascunho } from './comprovante';

const r = (id: string, usuarioId: string, criadoEm: string): Rascunho => ({ id, usuarioId, criadoEm, dados: {}, arquivos: [] });

test('cada pessoa só vê os próprios rascunhos, do mais antigo para o mais novo', () => {
  const lista = [r('b', 'ana', '2026-10-02'), r('a', 'ana', '2026-10-01'), r('c', 'beto', '2026-10-01')];
  expect(rascunhosDe(lista, 'ana').map((x) => x.id)).toEqual(['a', 'b']);
  expect(rascunhosDe(lista, 'carla')).toEqual([]);
});
