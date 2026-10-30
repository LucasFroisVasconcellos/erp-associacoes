#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerHeaders, TURNSTILE } from './cabecalhos.mjs';

function conferirCsp(onde, csp, problemas, { cabecalho = false } = {}) {
  const exigidos = ["default-src 'none'", "script-src 'self'", "object-src 'none'", "base-uri 'none'", "require-trusted-types-for 'script'"];
  if (cabecalho) exigidos.push("frame-ancestors 'none'");
  for (const exigido of exigidos) if (!csp.includes(exigido)) problemas.push(`${onde}: CSP sem ${exigido}`);
  if (csp.includes('unsafe-eval')) problemas.push(`${onde}: CSP com 'unsafe-eval'`);
  if (/script-src[^;]*unsafe-inline/.test(csp)) problemas.push(`${onde}: CSP com script 'unsafe-inline'`);
  // nenhuma diretiva aceita curinga (*, "https:", *.dominio): cada origem é nomeada
  for (const d of csp.split(';').map((x) => x.trim()).filter(Boolean)) {
    const [nome, ...fontes] = d.split(/\s+/);
    const curingas = fontes.filter((f) => f.includes('*') || /^(https?|wss?):$/i.test(f));
    if (curingas.length) problemas.push(`${onde}: ${nome} com curinga (${curingas.join(' ')})`);
  }
  if (!/(?:^|;)\s*trusted-types default\s*(?:;|$)/.test(csp)) problemas.push(`${onde}: CSP sem "trusted-types default" (só a política da lista fechada)`);
  // origens de script e de moldura: só o próprio site e, com CAPTCHA, o domínio oficial do Turnstile
  for (const diretiva of ['script-src', 'frame-src']) {
    const fontes = new RegExp(`(?:^|;)\\s*${diretiva}\\s+([^;]*)`).exec(csp)?.[1]?.trim().split(/\s+/) ?? [];
    const estranhas = fontes.filter((f) => !["'self'", "'none'", TURNSTILE, "'unsafe-inline'"].includes(f));
    if (estranhas.length) problemas.push(`${onde}: ${diretiva} com origem não permitida (${estranhas.join(' ')})`);
  }
}

function arquivos(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? arquivos(p) : [p];
  });
}

function papelJwt(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).role ?? null; } catch { return null; }
}

export function verificarBuild(dir) {
  const problemas = [];
  for (const f of arquivos(dir)) {
    const nome = relative(dir, f);
    if (nome.endsWith('.map')) { problemas.push(`${nome}: mapa de código publicado`); continue; }
    if (!/\.(js|mjs|css|html|json|webmanifest|txt|svg)$/.test(nome)) continue;
    const t = readFileSync(f, 'utf8');
    if (['ERP_MODO_DEMONSTRACAO', 'fonte-demo', 'exemplo-cupom', 'cupom de exemplo', 'CUPOM FICTICIO', 'Neste link de demonstração'].some((x) => t.includes(x))) problemas.push(`${nome}: código da demonstração na build de produção`);
    if (/sb_secret_[A-Za-z0-9_-]+/.test(t)) problemas.push(`${nome}: chave secreta do Supabase (sb_secret_)`);
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(t)) problemas.push(`${nome}: chave privada`);
    for (const m of t.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g)) {
      if (papelJwt(m[0]) === 'service_role') problemas.push(`${nome}: JWT com papel service_role`);
    }
  }
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];
  if (!csp) problemas.push('index.html: sem CSP');
  else conferirCsp('index.html', csp, problemas);

  if (!existsSync(join(dir, '404.html'))) problemas.push('404.html: ausente (sem ele o Cloudflare Pages devolve a página do sistema, com status 200, para arquivo inexistente)');

  const arqHeaders = join(dir, '_headers');
  if (!existsSync(arqHeaders)) problemas.push('_headers: arquivo ausente (cabeçalhos de segurança do Cloudflare Pages)');
  else {
    const h = lerHeaders(readFileSync(arqHeaders, 'utf8'));
    const exigir = (nome, ok) => {
      const v = h[nome.toLowerCase()];
      if (v === undefined) problemas.push(`_headers: falta ${nome}`);
      else if (!ok(v)) problemas.push(`_headers: ${nome} com valor fraco (${v})`);
    };
    if (h['content-security-policy'] === undefined) problemas.push('_headers: falta Content-Security-Policy');
    else {
      conferirCsp('_headers', h['content-security-policy'], problemas, { cabecalho: true });
      // o <meta> é a segunda camada: tem de ser a MESMA política (frame-ancestors só vale no cabeçalho)
      const semFrame = h['content-security-policy'].split(';').map((x) => x.trim()).filter((x) => x && !x.startsWith('frame-ancestors')).join('; ');
      if (csp && csp.trim() !== semFrame) problemas.push('index.html: CSP do <meta> diferente da do cabeçalho em _headers');
    }
    exigir('Strict-Transport-Security', (v) => {
      const s = Number(/max-age=(\d+)/.exec(v)?.[1] ?? 0);
      if (s < 31536000) problemas.push(`_headers: HSTS curto demais (${s} s; mínimo 1 ano)`);
      return true;
    });
    exigir('X-Frame-Options', (v) => v.toUpperCase() === 'DENY');
    exigir('X-Content-Type-Options', (v) => v.toLowerCase() === 'nosniff');
    exigir('Referrer-Policy', (v) => ['no-referrer', 'same-origin', 'strict-origin'].includes(v));
    exigir('Permissions-Policy', (v) => /microphone=\(\)/.test(v) && /geolocation=\(\)/.test(v));
  }
  return problemas;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? 'dist';
  const p = verificarBuild(dir);
  if (p.length) { console.error('Build REPROVADA:\n- ' + p.join('\n- ')); process.exit(1); }
  console.log(`Build aprovada: ${arquivos(dir).length} arquivos conferidos em ${dir}`);
}
