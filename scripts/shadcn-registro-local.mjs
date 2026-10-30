#!/usr/bin/env node
// Converte a fonte oficial dos componentes shadcn em itens de registro locais, trocando só os marcadores:
//  - `from "cn"`                          -> `from "@/lib/utils"`
//  - `@/registry/bases/radix/ui/<x>`       -> `@/components/ui/<x>`
//  - `@/registry/bases/radix/hooks/<x>`    -> `@/hooks/<x>`
//  - <IconPlaceholder lucide="XIcon" .../> -> <XIcon .../> + import de lucide-react
// Uso: node scripts/shadcn-registro-local.mjs <pasta bases/radix> <saida> [--estilo design/estilo.css] comp1 comp2 ...
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , base, saida, ...resto] = process.argv;
let mapa = null;
const nomes = [];
for (let i = 0; i < resto.length; i++) {
  if (resto[i] === '--estilo') { mapa = lerMapa(resto[++i]); continue; }
  nomes.push(resto[i]);
}
const semDefinicao = new Set();

function lerMapa(arquivo) {
  const css = readFileSync(arquivo, 'utf8');
  const m = new Map();
  // a última definição de um gancho vale (os ajustes ficam no fim do arquivo)
  for (const [, nome, classes] of css.matchAll(/\.(cn-[a-z0-9-]+)\s*\{\s*@apply\s+([^;]+);\s*\}/g)) {
    m.set(nome, classes.replace(/\s+/g, ' ').trim());
  }
  return m;
}

function aplicarEstilo(s) {
  const semAll = (t) => t.replace(/(?<![\w-])transition-all(?![\w-])/g, 'transition-[color,background-color,border-color,box-shadow,opacity,transform,translate,scale]');
  if (!mapa) return semAll(s);
  return semAll(s).replace(/(?<![\w-])cn-[a-z0-9-]+(?![\w-])/g, (token) => {
    const v = mapa.get(token);
    if (v === undefined) { semDefinicao.add(token); return ''; }
    return semAll(v);
  });
}
if (!base || !saida || nomes.length === 0) {
  console.error('uso: shadcn-registro-local.mjs <bases/radix> <saida> <componentes...>');
  process.exit(1);
}

function transformar(fonte, arquivo) {
  let s = fonte
    .replace(/from "cn"/g, 'from "@/lib/utils"')
    .replace(/@\/registry\/bases\/radix\/ui\//g, '@/components/ui/')
    .replace(/@\/registry\/bases\/radix\/hooks\//g, '@/hooks/')
    .replace(/@\/registry\/bases\/radix\/lib\//g, '@/lib/')
    // o projeto não usa Next.js: o tema vem do hook próprio
    .replace(/from "next-themes"/g, 'from "@/hooks/use-theme"');

  const icones = new Set();
  s = s.replace(/<IconPlaceholder\b([^>]*?)\/>/gs, (_m, attrs) => {
    const lucide = /lucide="([A-Za-z0-9]+)"/.exec(attrs)?.[1];
    if (!lucide) throw new Error(`${arquivo}: IconPlaceholder sem lucide`);
    icones.add(lucide);
    const resto = attrs.replace(/\s*(lucide|tabler|hugeicons|phosphor|remixicon)="[^"]*"/g, '');
    return `<${lucide}${resto}/>`;
  });
  s = s.replace(/^import \{ IconPlaceholder \} from "[^"]+"\n/m, '');
  if (s.includes('IconPlaceholder')) throw new Error(`${arquivo}: IconPlaceholder restante`);
  if (icones.size) {
    const imp = `import { ${[...icones].sort().join(', ')} } from "lucide-react"\n`;
    s = s.replace(/^((?:"use client"\n\n)?)/, `$1${imp}`);
  }
  if (/@\/registry\/|@\/app\/|from "cn"/.test(s)) throw new Error(`${arquivo}: marcador do registro não convertido`);
  return s;
}

mkdirSync(saida, { recursive: true });
for (const entrada of nomes) {
  const ehHook = entrada.startsWith('hook:');
  const nome = ehHook ? entrada.slice(5) : entrada;
  const arquivo = ehHook ? join(base, 'hooks', `${nome}.ts`) : join(base, 'ui', `${nome}.tsx`);
  const conteudo = aplicarEstilo(transformar(readFileSync(arquivo, 'utf8'), arquivo));
  const tipo = ehHook ? 'registry:hook' : 'registry:ui';
  const item = {
    $schema: 'https://ui.shadcn.com/schema/registry-item.json',
    name: nome,
    type: tipo,
    files: [{ path: ehHook ? `hooks/${nome}.ts` : `ui/${nome}.tsx`, type: tipo, content: conteudo }],
  };
  writeFileSync(join(saida, `${nome}.json`), JSON.stringify(item, null, 2));
}
console.log(`${nomes.length} itens gerados em ${saida}`);
if (semDefinicao.size) console.log(`ganchos sem definição (removidos): ${[...semDefinicao].sort().join(' ')}`);
