import { describe, expect, test } from 'vitest';
import { carregarComRecarga, type DepsRecarga } from './sob-demanda';

function deps(inicial: string | null = null) {
  const estado = { valor: inicial, recargas: 0 };
  const d: DepsRecarga = { ler: () => estado.valor, gravar: (v) => { estado.valor = v; }, recarregar: () => { estado.recargas++; } };
  return { d, estado };
}
const pendente = async (p: Promise<unknown>) => (await Promise.race([p.then(() => 'resolveu', () => 'falhou'), new Promise((r) => setTimeout(() => r('pendente'), 20))]));

describe('telas sob demanda', () => {
  test('carregou: devolve o módulo e limpa a marca de recarga', async () => {
    const { d, estado } = deps('1');
    expect(await carregarComRecarga(async () => ({ Tela: 1 }), d)).toEqual({ Tela: 1 });
    expect(estado.valor).toBeNull();
    expect(estado.recargas).toBe(0);
  });
  test('primeira falha: recarrega uma vez e fica esperando', async () => {
    const { d, estado } = deps();
    expect(await pendente(carregarComRecarga(() => Promise.reject(new Error('404')), d))).toBe('pendente');
    expect(estado.recargas).toBe(1);
    expect(estado.valor).toBe('1');
  });
  test('falha de novo depois da recarga: mostra o erro e não entra em laço', async () => {
    const { d, estado } = deps('1');
    await expect(carregarComRecarga(() => Promise.reject(new Error('sem internet')), d)).rejects.toThrow('sem internet');
    expect(estado.recargas).toBe(0);
  });
});
