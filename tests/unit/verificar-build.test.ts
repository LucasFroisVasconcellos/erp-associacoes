import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { verificarBuild } from '../../scripts/verificar-build.mjs';
// @ts-expect-error módulo .mjs sem tipos
import { arquivoHeaders, politicaCsp } from '../../scripts/cabecalhos.mjs';

const CSP_PADRAO = politicaCsp('https://projeto.supabase.co');
const CSP = `<meta http-equiv="Content-Security-Policy" content="${CSP_PADRAO}" />`;
const HEADERS = arquivoHeaders('https://projeto.supabase.co');
const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.assinatura`;
let dirs: string[] = [];
function build(arquivos: Record<string, string>) {
  const d = mkdtempSync(join(tmpdir(), 'erp-build-'));
  dirs.push(d);
  mkdirSync(join(d, 'assets'));
  for (const [n, c] of Object.entries({ 'index.html': `<html><head>${CSP}</head></html>`, 'assets/app.js': 'console.log(1)', _headers: HEADERS, '404.html': '<html><body>Página não encontrada</body></html>', ...arquivos })) writeFileSync(join(d, n), c);
  return d;
}
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });

describe('verificação da build publicada', () => {
  test('build limpa passa', () => { expect(verificarBuild(build({}))).toEqual([]); });
  test('acusa mapa de código', () => { expect(verificarBuild(build({ 'assets/app.js.map': '{}' })).join()).toMatch(/mapa/); });
  test('acusa código da demonstração', () => { expect(verificarBuild(build({ 'assets/x.js': 'const m="ERP_MODO_DEMONSTRACAO"' })).join()).toMatch(/demonstra/); });
  test('acusa chave secreta e JWT service_role, mas aceita anon', () => {
    expect(verificarBuild(build({ 'assets/x.js': 'k="sb_secret_abc123"' })).join()).toMatch(/secreta/);
    expect(verificarBuild(build({ 'assets/x.js': `k="${jwt('service_role')}"` })).join()).toMatch(/service_role/);
    expect(verificarBuild(build({ 'assets/x.js': `k="${jwt('anon')}"` }))).toEqual([]);
  });
  test('acusa chave privada', () => { expect(verificarBuild(build({ 'assets/x.js': '-----BEGIN PRIVATE KEY-----' })).join()).toMatch(/privada/); });
  test('acusa index.html sem CSP ou com unsafe-eval', () => {
    expect(verificarBuild(build({ 'index.html': '<html></html>' })).join()).toMatch(/CSP/);
    expect(verificarBuild(build({ 'index.html': CSP.replace("'self'", "'self' 'unsafe-eval'") })).join()).toMatch(/unsafe-eval/);
  });

  test('acusa _headers ausente', () => {
    const d = build({});
    rmSync(join(d, '_headers'));
    expect(verificarBuild(d).join()).toMatch(/_headers/);
  });
  test('acusa cada cabeçalho de segurança que faltar no _headers', () => {
    for (const nome of ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']) {
      const sem = HEADERS.split('\n').filter((l: string) => !l.trim().startsWith(nome + ':')).join('\n');
      expect(verificarBuild(build({ _headers: sem })).join(), nome).toMatch(new RegExp(nome));
    }
  });
  test('acusa CSP do cabeçalho sem frame-ancestors ou com script inline', () => {
    expect(verificarBuild(build({ _headers: HEADERS.replace("frame-ancestors 'none'; ", '') })).join()).toMatch(/frame-ancestors/);
    expect(verificarBuild(build({ _headers: HEADERS.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'") })).join()).toMatch(/unsafe-inline/);
  });
  test('acusa HSTS curto demais', () => {
    expect(verificarBuild(build({ _headers: HEADERS.replace('max-age=63072000', 'max-age=300') })).join()).toMatch(/HSTS/);
  });

  test('CAPTCHA ligado: só o domínio oficial do Turnstile entra em script-src e frame-src', () => {
    const comCaptcha = arquivoHeaders('https://projeto.supabase.co', { captcha: true });
    const meta = `<meta http-equiv="Content-Security-Policy" content="${politicaCsp('https://projeto.supabase.co', { captcha: true })}" />`;
    expect(verificarBuild(build({ _headers: comCaptcha, 'index.html': `<html><head>${meta}</head></html>` }))).toEqual([]);
    expect(comCaptcha).toContain("script-src 'self' https://challenges.cloudflare.com;");
    expect(arquivoHeaders('https://projeto.supabase.co')).toContain("frame-src 'none'");
  });
  test('acusa script ou moldura de qualquer outra origem', () => {
    expect(verificarBuild(build({ _headers: HEADERS.replace("script-src 'self'", "script-src 'self' https://cdn.evil.example") })).join()).toMatch(/script-src com origem não permitida/);
    expect(verificarBuild(build({ _headers: HEADERS.replace("frame-src 'none'", 'frame-src https://evil.example') })).join()).toMatch(/frame-src com origem não permitida/);
  });
  test('acusa CSP do <meta> diferente da do cabeçalho (só frame-ancestors pode faltar no meta)', () => {
    const metaOk = `<meta http-equiv="Content-Security-Policy" content="${politicaCsp('https://projeto.supabase.co')}" />`;
    expect(verificarBuild(build({ 'index.html': `<html><head>${metaOk}</head></html>` }))).toEqual([]);
    const metaOutro = metaOk.replace("img-src 'self'", "img-src 'self' https://outro.example");
    expect(verificarBuild(build({ 'index.html': `<html><head>${metaOutro}</head></html>` })).join()).toMatch(/diferente/);
  });
  test('acusa curinga em qualquer diretiva e exige trusted-types default', () => {
    expect(verificarBuild(build({ _headers: HEADERS.replace("connect-src 'self'", "connect-src 'self' *") })).join()).toMatch(/curinga/);
    expect(verificarBuild(build({ _headers: HEADERS.replace("img-src 'self'", "img-src 'self' https:") })).join()).toMatch(/curinga/);
    expect(verificarBuild(build({ _headers: HEADERS.replace("connect-src 'self'", "connect-src 'self' https://*.example.com") })).join()).toMatch(/curinga/);
    expect(verificarBuild(build({ _headers: HEADERS.replace('trusted-types default', 'trusted-types default qualquer') })).join()).toMatch(/trusted-types/);
  });
  test('exige 404.html (sem ele o Cloudflare devolve a página do sistema para arquivo inexistente)', () => {
    const d = build({});
    rmSync(join(d, '404.html'));
    expect(verificarBuild(d).join()).toMatch(/404\.html/);
  });
});
