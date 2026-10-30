
/**
 * Chave pública do Turnstile: vazia = CAPTCHA desligado. Valor estranho para o sistema
 * (falha fechada). A chave SECRETA tem o mesmo prefixo, mas é bem mais longa: se alguém
 * colar a secreta por engano, o site não sobe e ela não vai parar no navegador.
 */
export function validarChaveCaptcha(bruta: string | undefined): string | null {
  const v = bruta?.trim();
  if (!v) return null;
  if (/^[0-3]x[0-9A-Za-z_-]{29,}$/.test(v)) throw new Error('VITE_TURNSTILE_SITEKEY parece a chave SECRETA do Turnstile. Use a chave pública (site key) e troque a secreta no Cloudflare.');
  if (!/^[0-3]x[0-9A-Za-z_-]{16,28}$/.test(v)) throw new Error('VITE_TURNSTILE_SITEKEY não parece uma chave pública do Turnstile.');
  return v;
}
