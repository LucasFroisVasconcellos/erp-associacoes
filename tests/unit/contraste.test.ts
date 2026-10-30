// Contraste WCAG 2.2 AA (4.5:1 texto comum) dos pares de cor usados de verdade nas telas.
// Lê os tokens direto de src/index.css (claro em :root, escuro em .dark).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const css = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'index.css'), 'utf8');

function tokens(seletor: string): Record<string, string> {
  const bloco = new RegExp(`${seletor.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  return Object.fromEntries([...bloco.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2].toLowerCase()]));
}
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** Tokens translúcidos (rgba) para combinar com o fundo que fica embaixo. */
function translucidos(seletor: string): Record<string, [number, number, number, number]> {
  const bloco = new RegExp(`${seletor.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  return Object.fromEntries([...bloco.matchAll(/--([a-z0-9-]+):\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)\s*;/g)]
    .map((m) => [m[1], [Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])]]));
}
function sobre(rgbaTok: [number, number, number, number], fundo: string) {
  const b = rgb(fundo); const [r, g, bl, a] = rgbaTok;
  return '#' + [r, g, bl].map((c, i) => Math.round(c * a + b[i]! * (1 - a)).toString(16).padStart(2, '0')).join('');
}
function luminancia(h: string) {
  const [r, g, b] = rgb(h).map((c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function mistura(frente: string, fundo: string, alfa: number) {
  const a = rgb(frente), b = rgb(fundo);
  return '#' + a.map((c, i) => Math.round(c * alfa + b[i]! * (1 - alfa)).toString(16).padStart(2, '0')).join('');
}
const contraste = (a: string, b: string) => { const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

// [texto, fundo, opacidade do fundo tingido (opcional)]
const PARES: [string, string, number?][] = [
  ['foreground', 'background'], ['foreground', 'card'], ['card-foreground', 'card'], ['popover-foreground', 'popover'],
  ['muted-foreground', 'card'], ['muted-foreground', 'background'], ['muted-foreground', 'popover'],
  ['primary-foreground', 'primary'],
  ['tint', 'card'], ['tint', 'background'], ['tint', 'card', 0.12],
  ['destructive', 'card'], ['destructive', 'card', 0.12],
  ['entrada', 'card'], ['entrada', 'background'],
  ['aviso', 'card'], ['aviso', 'background'],
  ['sidebar-foreground', 'sidebar'], ['tint', 'sidebar', 0.12],
  ['foreground', 'segmento'], ['aviso', 'background', 0.12],
];

// Texto sobre campo preenchido (fundo "muted", translúcido) em cada superfície.
const SOBRE_CAMPO: [string, string][] = [['muted-foreground', 'card'], ['muted-foreground', 'popover'], ['muted-foreground', 'background'], ['foreground', 'popover']];

for (const [nome, seletor] of [['claro', ':root'], ['escuro', '.dark']] as const) {
  describe(`contraste AA sobre campos preenchidos no tema ${nome}`, () => {
    const t = { ...tokens(':root'), ...(seletor === '.dark' ? tokens('.dark') : {}) };
    const tr = { ...translucidos(':root'), ...(seletor === '.dark' ? translucidos('.dark') : {}) };
    test.each(SOBRE_CAMPO)('%s sobre campo em %s', (texto, superficie) => {
      expect(contraste(t[texto]!, sobre(tr.muted!, t[superficie]!))).toBeGreaterThanOrEqual(4.5);
    });
  });
}

for (const [nome, seletor] of [['claro', ':root'], ['escuro', '.dark']] as const) {
  describe(`contraste AA no tema ${nome}`, () => {
    const t = tokens(seletor);
    test.each(PARES)('%s sobre %s', (texto, fundo, alfa) => {
      expect(t[texto], `token --${texto} ausente em ${seletor}`).toBeDefined();
      expect(t[fundo], `token --${fundo} ausente em ${seletor}`).toBeDefined();
      const f = alfa ? mistura(alfa === 0.12 && texto === 'destructive' ? t.destructive! : t[texto]!, t[fundo]!, alfa) : t[fundo]!;
      expect(contraste(t[texto]!, f)).toBeGreaterThanOrEqual(4.5);
    });
  });
}
