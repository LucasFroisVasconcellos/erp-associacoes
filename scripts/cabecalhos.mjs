export const TURNSTILE = 'https://challenges.cloudflare.com';

// `cabecalho: true` acrescenta o que só vale como cabeçalho HTTP (frame-ancestors é ignorado em <meta>).
export function politicaCsp(supabase, { cabecalho = false, captcha = false } = {}) {
  const ws = supabase.replace(/^https:/, 'wss:');
  const cf = captcha ? ' ' + TURNSTILE : '';
  return [
    "default-src 'none'",
    `script-src 'self'${cf}`,
    // 'unsafe-inline' SÓ para estilos: Radix (trava de rolagem), sonner e input-otp injetam
    // <style> com conteúdo variável; scripts continuam só 'self' + Trusted Types.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${supabase ? ' ' + supabase : ''}`,
    "font-src 'self'",
    `connect-src 'self'${supabase ? ` ${supabase} ${ws}` : ''}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    captcha ? `frame-src ${TURNSTILE}` : "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    ...(cabecalho ? ["frame-ancestors 'none'"] : []),
    "require-trusted-types-for 'script'",
    'trusted-types default', // só a política "default" de src/lib/trusted-types.ts (lista fechada)
    'upgrade-insecure-requests',
  ].join('; ');
}

export function cabecalhosSeguranca(supabase, { captcha = false } = {}) {
  return {
    'Content-Security-Policy': politicaCsp(supabase, { cabecalho: true, captcha }),
    // 2 anos; sem "preload" porque o endereço *.pages.dev não é nosso (rever com domínio próprio)
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // câmera só para ler QR Code e código de barras no próprio site; o resto desligado
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Robots-Tag': 'noindex, nofollow',
  };
}

export function arquivoHeaders(supabase, { captcha = false } = {}) {
  const linhas = ['/*'];
  for (const [k, v] of Object.entries(cabecalhosSeguranca(supabase, { captcha }))) linhas.push(`  ${k}: ${v}`);
  linhas.push(
    '',
    '# a página: sempre buscar a versão nova (o nome dos assets muda a cada build)',
    '/index.html',
    '  Cache-Control: no-cache',
    '/',
    '  Cache-Control: no-cache',
    '',
    '# OCR (Tesseract.js): o worker precisa compilar WebAssembly e carregar o próprio núcleo.',
    '# Política própria e mais fechada só para esta pasta (sem acesso a nada fora do site).',
    '/ocr/*',
    '  ! Content-Security-Policy',
    "  Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'",
    '  Cache-Control: public, max-age=604800',
    '',
    '# arquivos com hash no nome: podem ficar em cache para sempre',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  );
  return linhas.join('\n');
}

export function lerHeaders(texto) {
  const regras = {};
  let atual = null;
  for (const bruta of texto.split(/\r?\n/)) {
    if (!bruta.trim() || bruta.trim().startsWith('#')) continue;
    if (!/^\s/.test(bruta)) { atual = bruta.trim(); regras[atual] ??= {}; continue; }
    const i = bruta.indexOf(':');
    if (atual && i > 0) regras[atual][bruta.slice(0, i).trim().toLowerCase()] = bruta.slice(i + 1).trim();
  }
  return regras['/*'] ?? {};
}
