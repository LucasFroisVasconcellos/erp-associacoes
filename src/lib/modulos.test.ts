import { describe, expect, test } from 'vitest';
import { GRUPOS, MODULOS, grupoPorRota } from './modulos';

describe('menu em 5 grupos', () => {
  test('no máximo 5 abas e todo módulo em exatamente um grupo', () => {
    expect(GRUPOS).toHaveLength(5);
    for (const m of MODULOS) expect(GRUPOS.filter((g) => g.modulos.includes(m.id)).length, m.id).toBe(1);
  });
  test.each([
    ['/', 'inicio'], ['/avisos', 'inicio'], ['/dinheiro/conciliacao', 'dinheiro'], ['/relatorios', 'dinheiro'],
    ['/verbas/x', 'recursos'], ['/captacao', 'recursos'], ['/pessoas/1', 'equipe'], ['/viagens', 'equipe'],
    ['/agenda', 'organizacao'], ['/acessos/auditoria', 'organizacao'], ['/ajustes', 'organizacao'], ['/organizacao', 'organizacao'], ['/recursos', 'recursos'],
  ])('%s → %s', (rota, grupo) => expect(grupoPorRota(rota).id).toBe(grupo));
});
