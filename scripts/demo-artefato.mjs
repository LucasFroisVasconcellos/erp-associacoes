#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

rmSync('dist-artefato', { recursive: true, force: true });
execSync('node scripts/copiar-ocr.mjs', { stdio: 'inherit' });
execSync('npx vite build --mode demo --outDir dist-artefato', { stdio: 'inherit', env: { ...process.env, VITE_ARTEFATO: '1' } });
const html = readFileSync('dist-artefato/index.html', 'utf8');
const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'));
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
const tags = [...head.matchAll(/<(?:script|link)\b[^>]*(?:><\/script>|\/?>)/g)].map((m) => m[0])
  .filter((t) => !/rel="(icon|apple-touch-icon|manifest)"/.test(t));
const pagina = ['<title>Associação Exemplo Gestão (demonstração)</title>', '<meta name="theme-color" content="#f2f2f7">', ...tags, body.trim()].join('\n');
if (pagina.includes('Content-Security-Policy')) throw new Error('CSP não deveria estar no artefato');
writeFileSync('dist-artefato/index.html', pagina + '\n');
rmSync('dist-artefato/_headers', { force: true });
rmSync('dist-artefato/404.html', { force: true });
console.log(pagina);
