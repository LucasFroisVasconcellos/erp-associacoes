# ADR 0012 — Comprovante lido no aparelho, menu em 5 grupos e importações em massa

**Situação:** aceita · **Data:** 2026-10-27

## Contexto
Testando a demonstração no celular, a diretoria pediu: valor com vírgula no teclado numérico, foto do comprovante no primeiro passo com preenchimento automático, menos menus, tema escuro que funcione e um jeito de trazer a contabilidade antiga (planilhas, extratos em PDF, plano de contas e balancete do contador).

## Decisão
- **Valor:** máscara de centavos (só números; os dois últimos são centavos), igual aos apps de banco. Funciona com o teclado numérico de qualquer celular.
- **Leitura da foto:** Tesseract.js 7.0.0 + dados em português (`@tesseract.js-data/por` 1.0.0), **no aparelho** (a foto não sai do celular para ser lida). Arquivos servidos pelo próprio site em `/ocr/` com CSP própria (`script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'`); a CSP das páginas não mudou. Trusted Types libera só `/ocr/worker.min.js` do mesmo site.
- **Planilhas:** `read-excel-file` 9.3.12 (Excel, no navegador, sem worker) e `papaparse` (CSV, já existente). **PDF de extrato:** `pdfjs-dist` 6.4.299 (Mozilla) sem worker separado (`pdf.worker` importado no próprio contexto), por causa da CSP e do Trusted Types. Dependências transitivas novas demais fixadas por `overrides` (quarentena de 7 dias: `worker-f` 0.1.20, `@napi-rs/canvas` 1.0.11).
- **Banco (0023):** `plano_contas`, `categorias.conta_contabil_id`, `importacoes` (lote de cada arquivo), `lancamentos.importacao_id`, `balancete_linhas`. RPCs `importar_lancamentos` e `lancar_do_extrato` são **tudo ou nada** (valida tudo antes de gravar) e **idempotentes** (id da linha calculado do conteúdo com SHA-256; lote com id). `comparar_balancete` compara o movimento das contas de receita e despesa do balancete com o que a diretoria lançou nas categorias ligadas.
- **Menu:** 5 grupos por objetivo (Início, Dinheiro, Recursos, Equipe, Organização), iguais no celular (abas) e no computador (barra lateral).
- **Tema escuro:** regras essenciais (fundo, cor do texto, `color-scheme`) fora das camadas do CSS, para estilos injetados pelo host (ex.: a página de demonstração no claude.ai) não quebrarem o modo escuro.

## Consequências
- A leitura da foto **não funciona dentro da demonstração no claude.ai** (o host não serve o arquivo de idioma `.gz`); lá ela avisa e o preenchimento é manual. No site real funciona e é testada no navegador (`tests/e2e/ocr_e2e.py`).
- PDF de banco varia de layout: o resultado sempre passa pela conciliação antes de valer. OFX continua sendo o formato recomendado.
- O balancete em PDF do contador continua guardado em *Documentos › Arquivos do contador*; para comparar, ele precisa mandar em Excel ou CSV.
