"""Exportação da auditoria na demo, com cabeçalhos reais: abre a folha, baixa CSV e PDF,
confere o conteúdo e passa o axe (WCAG 2.2 AA) com a folha aberta, no claro e no escuro."""
import json, sys
from playwright.sync_api import sync_playwright
BASE = 'http://127.0.0.1:4174/'; AXE = sys.argv[1]; OUT = sys.argv[2]
r, problemas = {}, []
with sync_playwright() as p:
    nav = p.chromium.launch()
    for esquema, axe in [('light', False), ('dark', False), ('light', True), ('dark', True)]:
        ctx = nav.new_context(viewport={'width': 390, 'height': 844}, color_scheme=esquema, accept_downloads=True, locale='pt-BR', timezone_id='America/Sao_Paulo', device_scale_factor=2, bypass_csp=axe)
        pg = ctx.new_page()
        if not axe: pg.on('console', lambda m: problemas.append(f'{m.type}: {m.text[:200]}') if m.type in ('error', 'warning') else None)
        if not axe: pg.on('pageerror', lambda e: problemas.append(f'pageerror: {str(e)[:200]}'))
        pg.goto(BASE); pg.wait_for_load_state('networkidle')
        pg.get_by_label('E-mail').fill('a@b.test'); pg.get_by_label('Senha').fill('demo1234')
        pg.get_by_role('button', name='Entrar').click(); pg.wait_for_selector('text=Verificação em duas etapas')
        pg.keyboard.type('123456'); pg.wait_for_selector('text=Saldo da Associação Exemplo')
        pg.goto(BASE + '#/acessos/auditoria'); pg.wait_for_selector('h1:has-text("Auditoria")')
        pg.get_by_role('button', name='Exportar').click(); pg.wait_for_selector('text=Exportar auditoria'); pg.wait_for_timeout(500)
        pg.screenshot(path=f'{OUT}/exportar-{esquema}.png')
        # período que inclui hoje (os registros da demo são de agora)
        hoje = pg.evaluate("() => new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo'}).format(new Date())")
        pg.get_by_label('De').fill(hoje[:8] + '01'); pg.get_by_label('Até').fill(hoje)
        if axe:
          pg.add_script_tag(path=AXE)
          v = pg.evaluate("""async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'] } })).violations.map(v => v.id + ' x' + v.nodes.length)""")
          r[f'axe_folha_{esquema}'] = v
          ctx.close(); continue
        with pg.expect_download() as d: pg.get_by_role('button', name='Baixar CSV').click()
        csv = open(d.value.path(), encoding='utf-8-sig').read()
        r[f'csv_{esquema}'] = {'arquivo': d.value.suggested_filename, 'linhas': len(csv.strip().splitlines()) - 1, 'cabecalho': csv.splitlines()[0]}
        with pg.expect_download() as d2: pg.get_by_role('button', name='Baixar PDF').click()
        r[f'pdf_{esquema}'] = {'arquivo': d2.value.suggested_filename, 'comeca_com_pdf': open(d2.value.path(), 'rb').read(5) == b'%PDF-'}
        ctx.close()
    nav.close()
r['problemas_console'] = problemas
print(json.dumps(r, ensure_ascii=False, indent=1))
