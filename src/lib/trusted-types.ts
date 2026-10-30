// Trusted Types: o navegador recusa qualquer atribuição de HTML (innerHTML etc.) ou de
// endereço de script que não passe por esta política. As listas são FECHADAS:
//  - HTML: só o CSS fixo que componentes do Radix injetam (Select e ScrollArea);
//  - script: só o carregador oficial do CAPTCHA (Cloudflare Turnstile), quando ligado,
//    e o worker do OCR servido pelo próprio site (/ocr/worker.min.js).
// Qualquer outra string é bloqueada — inclusive XSS.

export const HTML_PERMITIDO: readonly string[] = [
  '[data-radix-select-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-select-viewport]::-webkit-scrollbar{display:none}',
  '[data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none}',
];

export function permitirHtml(s: string): string {
  if (HTML_PERMITIDO.includes(s)) return s;
  throw new TypeError('HTML bloqueado pela política Trusted Types do sistema');
}

const SCRIPT_TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

/** Só o api.js oficial do Turnstile, com os parâmetros que a biblioteca usa (onload e render). */
export function permitirScriptUrl(s: string): string {
  let u: URL;
  try { u = new URL(s); } catch { throw new TypeError('Endereço de script bloqueado pela política Trusted Types do sistema'); }
  // worker do OCR: só o arquivo fixo, no mesmo endereço do site, sem parâmetros
  if (/^https?:$/.test(u.protocol) && u.href.startsWith(globalThis.location?.origin + '/') && u.pathname.endsWith('/ocr/worker.min.js') && !u.search && !u.hash && !u.username && !u.password) return s;
  const params = [...u.searchParams.keys()];
  const ok = u.origin + u.pathname === SCRIPT_TURNSTILE && !u.hash && !u.username && !u.password
    && params.every((k) => k === 'onload' || k === 'render') && new Set(params).size === params.length
    && /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(u.searchParams.get('onload') ?? 'x')
    && ['explicit', 'auto'].includes(u.searchParams.get('render') ?? 'explicit');
  if (!ok) throw new TypeError('Endereço de script bloqueado pela política Trusted Types do sistema');
  return s;
}

interface FabricaTT { createPolicy(nome: string, regras: { createHTML: (s: string) => string; createScriptURL: (s: string) => string }): unknown }

/** Cria a política "default" (precisa rodar antes do React). */
export function instalarPoliticaTrustedTypes() {
  const tt = (globalThis as { trustedTypes?: FabricaTT }).trustedTypes;
  if (!tt) return; // navegador sem Trusted Types (Safari/Firefox antigos): a CSP de scripts continua valendo
  tt.createPolicy('default', { createHTML: permitirHtml, createScriptURL: permitirScriptUrl });
}
