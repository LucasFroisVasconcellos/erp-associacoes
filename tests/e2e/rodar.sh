#!/usr/bin/env bash
# Testes no navegador (Playwright em Python), com os cabeçalhos REAIS do _headers aplicados
# por um servidor local, como o Cloudflare Pages faria. Precisa de: Node 24, Python 3 e
#   pip install playwright==1.56.0 && python -m playwright install chromium
# Uso: bash tests/e2e/rodar.sh   (saídas e capturas de tela em tests/e2e/saida/, fora do Git)
set -euo pipefail
cd "$(dirname "$0")/../.."
E2E=tests/e2e; SAIDA=$E2E/saida; rm -rf "$SAIDA"; mkdir -p "$SAIDA"/{passeio,exportar}
AXE=node_modules/axe-core/axe.min.js

echo "1/4 builds: demonstração e produção com CAPTCHA (chave pública de TESTE do Cloudflare)"
node scripts/copiar-ocr.mjs >/dev/null
npx vite build --mode demo --outDir dist-demo >/dev/null
VITE_SUPABASE_URL=https://projeto-ficticio.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ficticia \
  VITE_TURNSTILE_SITEKEY=1x00000000000000000000AA npx vite build --outDir dist-captcha >/dev/null
node scripts/verificar-build.mjs dist-demo >/dev/null 2>&1 || true   # a demo é reprovada de propósito (código de demonstração)
node scripts/verificar-build.mjs dist-captcha

python3 "$E2E/servidor_headers.py" dist-demo 4174 & S1=$!
python3 "$E2E/servidor_headers.py" dist-captcha 4175 & S2=$!
trap 'kill $S1 $S2 2>/dev/null || true' EXIT
sleep 1

falhou=0
checar() { # nome, comando que imprime JSON; falha se "problemas" ou violações vierem preenchidos
  local nome=$1; shift
  if ! saida=$("$@"); then echo "FAIL $nome"; echo "$saida"; falhou=1; return; fi
  echo "$saida" > "$SAIDA/$nome.json"
  if python3 - "$SAIDA/$nome.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
ruim = d if isinstance(d, list) else {k: v for k, v in d.items() if (k.startswith(('problemas', 'axe')) and v) or v is False}
sys.exit(1 if ruim else 0)
PY
  then echo "PASS $nome"; else echo "FAIL $nome (veja $SAIDA/$nome.json)"; falhou=1; fi
}
echo "2/4 passeio visual (celular, computador, escuro): console, CSP e estouro horizontal"
checar passeio python3 "$E2E/passeio.py" "$SAIDA/passeio"
echo "3/4 acessibilidade WCAG 2.2 AA (axe) em todas as telas"
checar acessibilidade python3 "$E2E/acessibilidade.py" "$AXE"
echo "4/4 fluxos: exportar auditoria, CAPTCHA e leitura da foto do comprovante"
checar exportar python3 "$E2E/exportar_e2e.py" "$AXE" "$SAIDA/exportar"
checar captcha python3 "$E2E/captcha_e2e.py" "$E2E/turnstile-falso.js"
checar ocr python3 "$E2E/ocr_e2e.py"
checar importar python3 "$E2E/importar_e2e.py"
checar analises python3 "$E2E/analises_e2e.py"
checar transparencia python3 "$E2E/transparencia_e2e.py"
checar orcamento python3 "$E2E/orcamento_e2e.py"
checar tutorial python3 "$E2E/tutorial_e2e.py"
checar cadastros python3 "$E2E/cadastros_e2e.py"
exit $falhou
