#!/usr/bin/env bash
# Regenera src/components/ui a partir da fonte oficial do shadcn + design/estilo.css.
# Precisa de um clone do registro oficial (só a pasta apps/v4) em $SHADCN_REPO:
#   git clone --depth 1 --filter=blob:none --sparse https://github.com/shadcn-ui/ui.git "$SHADCN_REPO"
#   git -C "$SHADCN_REPO" sparse-checkout set apps/v4/public/r apps/v4/registry
set -euo pipefail
: "${SHADCN_REPO:?defina SHADCN_REPO com o caminho do clone de shadcn-ui/ui}"
SAIDA="$(mktemp -d)"
COMPONENTES="button card badge alert alert-dialog dialog drawer sheet input input-group textarea label field select toggle toggle-group tabs separator skeleton spinner empty item tooltip sonner input-otp switch checkbox radio-group dropdown-menu popover command table progress avatar scroll-area sidebar kbd collapsible chart button-group hook:use-mobile"
node scripts/shadcn-registro-local.mjs "$SHADCN_REPO/apps/v4/registry/bases/radix" "$SAIDA" --estilo design/estilo.css $COMPONENTES
# o CLI busca a paleta base no registro; servimos o registro oficial clonado
python3 -m http.server 8765 --bind 127.0.0.1 --directory "$SHADCN_REPO/apps/v4/public/r" >/dev/null 2>&1 &
SERV=$!; trap 'kill $SERV' EXIT; sleep 1
rm -rf src/components/ui src/hooks/use-mobile.ts
REGISTRY_URL=http://127.0.0.1:8765 npx -y shadcn@4.21.4 add "$SAIDA"/*.json -y
