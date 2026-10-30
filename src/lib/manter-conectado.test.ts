import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { definirLembrar, lembrado } from './manter-conectado';

function armazenamento() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), _m: m };
}

describe('manter conectado', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', armazenamento()); });
  afterEach(() => { vi.unstubAllGlobals(); });
  test('marca vale 30 dias e depois vence', () => {
    expect(lembrado()).toBe(false);
    definirLembrar(true);
    expect(lembrado()).toBe(true);
    expect(lembrado(Date.now() + 29 * 86_400_000)).toBe(true);
    expect(lembrado(Date.now() + 31 * 86_400_000)).toBe(false);
  });
  test('desmarcar (ou sair) apaga a marca e a sessão guardada no aparelho', () => {
    definirLembrar(true); localStorage.setItem('erp.sessao', 'token'); localStorage.setItem('outra', 'x');
    definirLembrar(false);
    expect(lembrado()).toBe(false);
    expect(localStorage.getItem('erp.sessao')).toBeNull();
    expect(localStorage.getItem('outra')).toBe('x');
  });
  test('marca adulterada ou armazenamento bloqueado: não lembra', () => {
    localStorage.setItem('erp.manter-ate', 'sempre');
    expect(lembrado()).toBe(false);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('x'); }, removeItem: () => undefined });
    expect(lembrado()).toBe(false);
    expect(() => definirLembrar(true)).not.toThrow();
  });
});
