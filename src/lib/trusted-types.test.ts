import { describe, expect, test, vi } from 'vitest';
import { HTML_PERMITIDO, permitirHtml, permitirScriptUrl } from './trusted-types';

describe('política Trusted Types (lista fechada)', () => {
  test('aceita só o CSS fixo que o Radix injeta', () => {
    for (const s of HTML_PERMITIDO) expect(permitirHtml(s)).toBe(s);
  });
  test('recusa qualquer outro HTML, inclusive tentativas de XSS', () => {
    for (const s of ['<img src=x onerror=alert(1)>', '<script>alert(1)</script>', '', `${HTML_PERMITIDO[0]}<b>`]) {
      expect(() => permitirHtml(s)).toThrow(/bloqueado/);
    }
  });
});

describe('Trusted Types: endereço de script (só o Turnstile oficial)', () => {
  test('aceita o carregador que a biblioteca usa', () => {
    const u = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onloadTurnstileCallback&render=explicit';
    expect(permitirScriptUrl(u)).toBe(u);
  });
  test('recusa qualquer outro script, domínio parecido ou parâmetro extra', () => {
    for (const u of [
      'https://evil.example/turnstile/v0/api.js',
      'https://challenges.cloudflare.com.evil.example/turnstile/v0/api.js',
      'https://challenges.cloudflare.com/turnstile/v0/outro.js',
      'http://challenges.cloudflare.com/turnstile/v0/api.js',
      'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=alert(1)',
      'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=x&src=https://evil.example',
      'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=ok&onload=outro&render=explicit',
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&render=auto',
      'https://user@challenges.cloudflare.com/turnstile/v0/api.js',
      'javascript:alert(1)', 'data:text/javascript,alert(1)', '/assets/app.js', '',
    ]) expect(() => permitirScriptUrl(u), u).toThrow(/bloqueado/);
  });
});

describe('Trusted Types: worker do OCR (só o arquivo fixo do próprio site)', () => {
  const site = 'https://erp.example';
  vi.stubGlobal('location', new URL(site + '/'));
  test('aceita o worker do OCR no mesmo endereço', () => {
    for (const u of [`${site}/ocr/worker.min.js`, `${site}/app/ocr/worker.min.js`]) expect(permitirScriptUrl(u)).toBe(u);
  });
  test('recusa outro arquivo, outro site, parâmetros e credenciais', () => {
    for (const u of [
      `${site}/ocr/outro.js`, `${site}/ocr/worker.min.js?x=1`, `${site}/ocr/worker.min.js#a`,
      'https://evil.example/ocr/worker.min.js', `${site.replace('://', '://u:p@')}/ocr/worker.min.js`,
      'data:text/javascript,alert(1)', 'blob:' + site + '/ocr/worker.min.js', 'http://erp.example/ocr/worker.min.js',
    ]) expect(() => permitirScriptUrl(u), u).toThrow(/bloqueado/);
  });
});
