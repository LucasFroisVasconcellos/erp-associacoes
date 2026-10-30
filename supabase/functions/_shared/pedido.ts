// CAPTCHA validado NO SERVIDOR (sucesso, hostname e action); provedor fora do ar = nega. A resposta é igual para pedido novo, repetido ou de membro.
import { erroInterno, json } from './http.ts';
import type { RespostaRpc } from './envio.ts';

export interface RespostaTurnstile { success: boolean; hostname?: string; action?: string; 'error-codes'?: string[] }

export interface DepsPedido {
  ip: string | null;
  /** hostname do sistema (de APP_ORIGIN): o token precisa ter sido emitido nele. */
  hostname: string;
  verificarCaptcha(token: string, ip: string): Promise<RespostaTurnstile>;
  hashIp(ip: string): Promise<string>;
  registrar(p: Record<string, unknown>, ipHash: string): Promise<RespostaRpc>;
}

export const ACAO_CAPTCHA = 'pedir_acesso';
const LIMITE_CORPO = 8 * 1024;
const CAMPOS = ['nome', 'email', 'captcha'];
const IP = /^[0-9a-f:.]{3,45}$/i;

export function ipDoCabecalho(valor: string | null): string | null {
  const ip = valor?.split(',')[0]?.trim() ?? '';
  return IP.test(ip) ? ip : null;
}

export async function tratarPedido(req: Request, deps: DepsPedido): Promise<Response> {
  if (req.method !== 'POST') return json(405, { erro: 'metodo_nao_permitido' });
  try {
    const bruto = await req.text();
    if (bruto.length > LIMITE_CORPO) return json(413, { erro: 'grande_demais' });
    let corpo: unknown;
    try { corpo = JSON.parse(bruto); } catch { return json(400, { erro: 'json_invalido' }); }
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return json(400, { erro: 'invalido' });
    const c = corpo as Record<string, unknown>;
    const extra = Object.keys(c).find((k) => !CAMPOS.includes(k));
    if (extra) return json(400, { erro: 'invalido', campo: extra });
    for (const k of ['nome', 'email']) if (typeof c[k] !== 'string') return json(400, { erro: 'invalido', campo: k });
    if (typeof c.captcha !== 'string' || c.captcha.length < 1 || c.captcha.length > 2048) return json(400, { erro: 'captcha_ausente' });
    if (!deps.ip) return json(400, { erro: 'invalido', campo: 'ip' }); // sem IP não dá para limitar abuso: nega

    let v: RespostaTurnstile;
    try { v = await deps.verificarCaptcha(c.captcha, deps.ip); }
    catch (e) {
      // fail closed; no log só o motivo curto (nunca o token nem a chave)
      console.error(JSON.stringify({ etapa: 'captcha', erro: e instanceof Error ? e.message.slice(0, 120) : typeof e }));
      return json(503, { erro: 'captcha_indisponivel' });
    }
    if (!v.success || v.hostname !== deps.hostname || v.action !== ACAO_CAPTCHA) {
      const motivo = !v.success ? 'recusado' : v.hostname !== deps.hostname ? 'hostname' : 'action';
      console.error(JSON.stringify({ etapa: 'captcha', motivo, codigos: (v['error-codes'] ?? []).slice(0, 5), hostname: v.hostname ?? null, action: v.action ?? null }));
      return json(403, { erro: 'captcha_invalido' });
    }

    const r = await deps.registrar({ nome: c.nome, email: c.email }, await deps.hashIp(deps.ip));
    if (r.ok) return json(200, { ok: true });
    if (r.erro === 'limite') return json(429, { erro: 'limite' });
    return json(422, { erro: r.erro ?? 'invalido', campo: r.campo });
  } catch (e) {
    return erroInterno('pedir-acesso', e);
  }
}
