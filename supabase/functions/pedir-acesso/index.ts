// Deploy com --no-verify-jwt: formulário público, a @supabase/server exige a chave publicável.
// Sem APP_ORIGIN ou TURNSTILE_SECRET_KEY a função não sobe (fail closed).
import { withSupabase } from '@supabase/server';
import { cabecalhosCors } from '../_shared/http.ts';
import { ipDoCabecalho, tratarPedido, type RespostaTurnstile } from '../_shared/pedido.ts';

const exigir = (nome: string) => {
  const v = Deno.env.get(nome);
  if (!v) throw new Error(`variável ${nome} ausente`);
  return v;
};
const ORIGEM = new URL(exigir('APP_ORIGIN'));
const SEGREDO = exigir('TURNSTILE_SECRET_KEY');
const cors = cabecalhosCors(ORIGEM.origin);

// Chave do HMAC do IP derivada do segredo (HKDF): o banco nunca vê o IP puro.
const chaveIp = crypto.subtle.importKey('raw', new TextEncoder().encode(SEGREDO), 'HKDF', false, ['deriveKey']).then((base) =>
  crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('erp-pedido-ip-v1'), info: new Uint8Array() },
    base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']));

export default {
  fetch: withSupabase({ auth: 'publishable', cors: { headers: cors } }, (req, ctx) =>
    tratarPedido(req, {
      ip: ipDoCabecalho(req.headers.get('x-forwarded-for')),
      hostname: ORIGEM.hostname,
      verificarCaptcha: async (token, ip) => {
        const corpo = new URLSearchParams({ secret: SEGREDO, response: token, remoteip: ip });
        const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: corpo, signal: AbortSignal.timeout(8000) });
        // a Cloudflare responde JSON (com error-codes) também em alguns erros: lemos sempre que der
        let resposta: RespostaTurnstile;
        try { resposta = await r.json() as RespostaTurnstile; } catch { throw new Error(`turnstile http ${r.status} sem json`); }
        if (typeof resposta?.success !== 'boolean') throw new Error(`turnstile http ${r.status} resposta inesperada`);
        return resposta;
      },
      hashIp: async (ip) => {
        const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await chaveIp, new TextEncoder().encode(ip)));
        return [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
      },
      registrar: async (p, ipHash) => {
        const { data, error } = await ctx.supabaseAdmin.rpc('registrar_pedido_acesso', { p, p_ip_hash: ipHash });
        if (error) throw error;
        return data;
      },
    })),
};
