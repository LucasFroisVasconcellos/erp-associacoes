import { describe, expect, test, vi } from 'vitest';
import { ACAO_CAPTCHA, ipDoCabecalho, tratarPedido, type DepsPedido } from './pedido.ts';

const OK = { success: true, hostname: 'erp.exemplo.test', action: ACAO_CAPTCHA };
function deps(extra: Partial<DepsPedido> = {}) {
  const chamadas: string[] = [];
  const d: DepsPedido = {
    ip: '203.0.113.7', hostname: 'erp.exemplo.test',
    verificarCaptcha: async () => { chamadas.push('captcha'); return OK; },
    hashIp: async () => 'a'.repeat(64),
    registrar: async (p) => { chamadas.push(`registrar:${JSON.stringify(p)}`); return { ok: true }; },
    ...extra,
  };
  return { d, chamadas };
}
const pedido = (corpo: unknown, metodo = 'POST') => new Request('https://f.test/pedir-acesso', { method: metodo, body: metodo === 'POST' ? JSON.stringify(corpo) : undefined });
const base = { nome: 'Pessoa Fictícia', email: 'pessoa@exemplo.test', captcha: 'tok' };

describe('pedir-acesso', () => {
  test('caminho feliz: CAPTCHA conferido e só os campos do pedido vão ao banco', async () => {
    const { d, chamadas } = deps();
    const r = await tratarPedido(pedido(base), d);
    expect(r.status).toBe(200);
    expect(chamadas).toEqual(['captcha', `registrar:${JSON.stringify({ nome: base.nome, email: base.email })}`]);
  });
  test('sem token, token ruim, de outro site ou de outra ação: nega antes do banco', async () => {
    for (const v of [{ success: false }, { ...OK, hostname: 'outro.site' }, { ...OK, action: 'login' }, { ...OK, action: undefined }]) {
      const { d, chamadas } = deps({ verificarCaptcha: async () => v });
      expect((await tratarPedido(pedido(base), d)).status).toBe(403);
      expect(chamadas).toEqual([]);
    }
    const { d, chamadas } = deps();
    expect((await tratarPedido(pedido({ nome: 'A B', email: 'a@b.test' }), d)).status).toBe(400);
    expect((await tratarPedido(pedido({ ...base, captcha: '' }), d)).status).toBe(400);
    expect(chamadas).toEqual([]);
  });
  test('provedor do CAPTCHA fora do ar: falha fechada (503), nada gravado', async () => {
    const { d, chamadas } = deps({ verificarCaptcha: async () => { throw new Error('timeout'); } });
    expect((await tratarPedido(pedido(base), d)).status).toBe(503);
    expect(chamadas).toEqual([]);
  });
  test('campos extras, tipos errados, corpo grande, método e IP ausente', async () => {
    const { d } = deps();
    expect((await tratarPedido(pedido({ ...base, cargo: 'presidente' }), d)).status).toBe(400);
    expect((await tratarPedido(pedido({ ...base, email: ['x'] }), d)).status).toBe(400);
    expect((await tratarPedido(pedido({ ...base, mensagem: 'oi' }), d)).status).toBe(400);
    expect((await tratarPedido(pedido({ ...base, nome: 'x'.repeat(9000) }), d)).status).toBe(413);
    expect((await tratarPedido(pedido(null, 'GET'), d)).status).toBe(405);
    expect((await tratarPedido(new Request('https://f.test', { method: 'POST', body: '{' }), d)).status).toBe(400);
    expect((await tratarPedido(pedido(base), deps({ ip: null }).d)).status).toBe(400);
  });
  test('limite do banco vira 429; erro de campo vira 422; exceção não vaza detalhe', async () => {
    expect((await tratarPedido(pedido(base), deps({ registrar: async () => ({ ok: false, erro: 'limite' }) }).d)).status).toBe(429);
    const r = await tratarPedido(pedido(base), deps({ registrar: async () => ({ ok: false, erro: 'invalido', campo: 'email' }) }).d);
    expect(r.status).toBe(422); expect(await r.json()).toEqual({ erro: 'invalido', campo: 'email' });
    const x = await tratarPedido(pedido(base), deps({ registrar: async () => { throw new Error('senha do banco xyz'); } }).d);
    expect(x.status).toBe(500); expect(await x.text()).not.toMatch(/senha|xyz/);
  });
  test('IP do cabeçalho: só o primeiro e só se parecer IP', () => {
    expect(ipDoCabecalho('203.0.113.7, 10.0.0.1')).toBe('203.0.113.7');
    expect(ipDoCabecalho('2001:db8::1')).toBe('2001:db8::1');
    expect(ipDoCabecalho('<script>')).toBeNull();
    expect(ipDoCabecalho(null)).toBeNull();
  });
  test('falha do CAPTCHA fica no log com o motivo, sem o token', async () => {
    const espiao = vi.spyOn(console, 'error').mockImplementation(() => {});
    const segredoDoToken = 'TOKEN-SECRETO-123';
    const a = deps({ verificarCaptcha: async () => ({ success: false, 'error-codes': ['invalid-input-secret'] }) });
    await tratarPedido(pedido({ ...base, captcha: segredoDoToken }), a.d);
    const b = deps({ verificarCaptcha: async () => { throw new Error('turnstile http 500 sem json'); } });
    await tratarPedido(pedido({ ...base, captcha: segredoDoToken }), b.d);
    const logs = espiao.mock.calls.map((c) => String(c[0]));
    espiao.mockRestore();
    expect(logs.some((l) => l.includes('invalid-input-secret'))).toBe(true);
    expect(logs.some((l) => l.includes('turnstile http 500'))).toBe(true);
    expect(logs.join(' ')).not.toContain(segredoDoToken);
  });
});
