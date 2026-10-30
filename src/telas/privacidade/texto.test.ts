import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { CONTATO_ENCARREGADO, SECOES, politicaEmMarkdown } from './texto';

describe('política de privacidade', () => {
  test('o documento do repositório é o mesmo texto da tela (rode "npm run politica" se mudar)', () => {
    const arquivo = readFileSync(join(import.meta.dirname, '../../../docs/politica-privacidade.md'), 'utf8');
    expect(arquivo).toBe(politicaEmMarkdown());
  });
  test('cobre o que a LGPD pede: controladora, dados, base legal, compartilhamento, prazo, segurança, direitos e contato', () => {
    const titulos = SECOES.map((s) => s.titulo).join(' | ');
    for (const t of ['Quem cuida', 'Quais dados', 'Com base', 'compartilhados', 'quanto tempo', 'protegidos', 'direitos']) expect(titulos).toContain(t);
    expect(politicaEmMarkdown()).toContain('ANPD');
    expect(politicaEmMarkdown().split(CONTATO_ENCARREGADO).length - 1).toBeGreaterThanOrEqual(2);
  });
});
