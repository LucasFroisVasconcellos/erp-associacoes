import { describe, expect, test } from 'vitest';
import { type DepsConvite, tratarConvite } from './convite';

const corpoOk = { email: 'nova@exemplo.test', nome: 'Nova Diretora', cargo: 'diretor', permissoes: [{ modulo: 'financeiro', acao: 'ver' }] };

function deps(over: Partial<DepsConvite> = {}) {
  const chamadas: string[] = [];
  const d: DepsConvite = {
    origemApp: 'https://exemplo.github.io',
    registrarConvite: async (a) => { chamadas.push('registrar:' + a.p_email); return { ok: true, email: String(a.p_email).toLowerCase(), convite_id: 'c-1' }; },
    enviarEmail: async (email, redirect) => { chamadas.push(`email:${email}:${redirect}`); return { ok: true }; },
    ...over,
  };
  return { d, chamadas };
}
const pedido = (corpo: unknown, metodo = 'POST') => new Request('https://x.test/functions/v1/convidar', {
  method: metodo, headers: { 'content-type': 'application/json' }, body: metodo === 'POST' ? JSON.stringify(corpo) : undefined,
});

describe('convidar', () => {
  test('registra o convite como o administrador e só então envia o e-mail', async () => {
    const { d, chamadas } = deps();
    const r = await tratarConvite(pedido(corpoOk), d);
    expect(r.status).toBe(200);
    expect(chamadas).toEqual(['registrar:nova@exemplo.test', 'email:nova@exemplo.test:https://exemplo.github.io/#/entrar/link']);
  });

  test('o banco recusa (não é admin, 2FA antigo, inválido): nenhum e-mail sai', async () => {
    for (const erro of ['sem_permissao', 'confirme_2fa', 'invalido', 'limite', 'ja_e_membro']) {
      const { d, chamadas } = deps({ registrarConvite: async () => ({ erro }) });
      const r = await tratarConvite(pedido(corpoOk), d);
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect((await r.json()).erro).toBe(erro);
      expect(chamadas.some((c) => c.startsWith('email:'))).toBe(false);
    }
  });

  test('campos extras, JSON quebrado e tipos errados são recusados antes do banco', async () => {
    for (const corpo of [{ ...corpoOk, role: 'admin' }, { ...corpoOk, email: 5 }, [], 'texto', null]) {
      const { d, chamadas } = deps();
      expect((await tratarConvite(pedido(corpo), d)).status).toBe(400);
      expect(chamadas).toEqual([]);
    }
    const quebrado = new Request('https://x.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":' });
    expect((await tratarConvite(quebrado, deps().d)).status).toBe(400);
  });

  test('corpo grande demais é recusado', async () => {
    const { d } = deps();
    expect((await tratarConvite(pedido({ ...corpoOk, nome: 'x'.repeat(20_000) }), d)).status).toBe(413);
  });

  test('pessoa que já tem login: convite fica registrado e é aceito no próximo acesso', async () => {
    const { d } = deps({ enviarEmail: async () => ({ ja_existe: true }) });
    const r = await tratarConvite(pedido(corpoOk), d);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, ja_tem_login: true });
  });

  test('falha no envio do e-mail devolve erro genérico com requestId', async () => {
    const { d } = deps({ enviarEmail: async () => { throw new Error('smtp: senha errada'); } });
    const r = await tratarConvite(pedido(corpoOk), d);
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toMatch(/smtp|senha/);
  });

  test('só aceita POST', async () => {
    expect((await tratarConvite(pedido(null, 'GET'), deps().d)).status).toBe(405);
  });
});
