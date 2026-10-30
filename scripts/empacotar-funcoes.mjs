// Uso: node scripts/empacotar-funcoes.mjs <pasta de saída>
import { readFileSync, writeFileSync } from 'node:fs';
import { build } from 'rolldown';

const saida = process.argv[2];
if (!saida) throw new Error('informe a pasta de saída');
const VERSAO_SERVER = 'npm:@supabase/server@1.9.2';
for (const f of ['convidar', 'enviar-arquivo', 'pedir-acesso', 'limpar-arquivos']) {
  const arquivo = `${saida}/${f}.ts`;
  await build({
    input: `supabase/functions/${f}/index.ts`,
    platform: 'neutral',
    external: ['@supabase/server'],
    output: { file: arquivo, format: 'esm', minify: false, comments: { legal: false } },
    logLevel: 'warn',
  });
  writeFileSync(arquivo, readFileSync(arquivo, 'utf8').replace('from "@supabase/server"', `from "${VERSAO_SERVER}"`));
  console.log('gerado', arquivo);
}
