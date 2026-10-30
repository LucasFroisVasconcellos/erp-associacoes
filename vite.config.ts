import path from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// @ts-expect-error módulo .mjs sem tipos
import { arquivoHeaders, politicaCsp } from './scripts/cabecalhos.mjs';
import { validarChaveCaptcha } from './src/lib/chave-captcha.ts';

/**
 * Segurança do site publicado (Cloudflare Pages), só na build:
 *  - arquivo _headers com CSP, HSTS, frame-ancestors e demais cabeçalhos HTTP;
 *  - a mesma CSP também em <meta>, como segunda camada se o site for servido sem os cabeçalhos.
 * No "dev" a CSP quebraria a recarga automática do Vite.
 */
function seguranca(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const supabase = mode === 'demo' ? '' : (env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
  if (mode !== 'demo' && !/^https:\/\/[a-z0-9.-]+$/i.test(supabase)) {
    throw new Error('Defina VITE_SUPABASE_URL (https) para gerar a build de produção. Veja .env.example.');
  }
  // chave do CAPTCHA: valida na build (chave secreta ou estranha reprova aqui, não só no navegador)
  const captcha = mode !== 'demo' && validarChaveCaptcha(env.VITE_TURNSTILE_SITEKEY) !== null;
  return {
    name: 'erp-seguranca',
    apply: 'build',
    transformIndexHtml(html) {
      // Demonstração publicada em moldura: a página hospedeira já tem a própria CSP. Só em modo demo, nunca em produção.
      if (mode === 'demo' && env.VITE_ARTEFATO === '1') return html.replace('<!--CSP-->', '');
      return html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${politicaCsp(supabase, { captcha })}" />`);
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: arquivoHeaders(supabase, { captcha }) });
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), tailwindcss(), seguranca(mode)],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  build: {
    sourcemap: false, // sem mapas de código no site público
    target: 'es2022',
    outDir: mode === 'demo' ? 'dist-demo' : 'dist',
    chunkSizeWarningLimit: 700, // arquivo principal ~650 KB; avisa se voltar a crescer,
  },
}));
