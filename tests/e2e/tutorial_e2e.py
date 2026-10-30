"""Tutorial de boas-vindas (6 passos, pular, rever em Ajustes) e ajuda ⓘ de cada tela."""
import json
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4174/'
problemas = []
with sync_playwright() as p:
    nav = p.chromium.launch(headless=True)
    for esquema in ['light', 'dark']:
        ctx = nav.new_context(viewport={'width': 390, 'height': 844}, locale='pt-BR', color_scheme=esquema)
        ctx.add_init_script("Object.defineProperty(navigator, 'webdriver', { get: () => false })")
        page = ctx.new_page()
        page.on('console', lambda m: problemas.append(f'console.{m.type}: {m.text[:300]}') if m.type == 'error' else None)
        page.on('pageerror', lambda e: problemas.append(f'pageerror: {str(e)[:300]}'))
        page.goto(BASE); page.wait_for_load_state('networkidle')
        page.get_by_label('E-mail').fill('presidencia@exemplo.test'); page.get_by_label('Senha').fill('demo1234')
        page.get_by_role('button', name='Entrar').click(); page.wait_for_selector('text=Verificação em duas etapas')
        page.keyboard.type('123456')
        try: page.wait_for_selector('text=Bem-vindo ao sistema da Associação Exemplo', timeout=10000)
        except Exception: problemas.append(f'{esquema}: tutorial não apareceu no primeiro acesso'); continue
        page.screenshot(path=f'/tmp/claude-0/tutorial-{esquema}.png')
        for _ in range(5): page.get_by_role('button', name='Próximo').click(); page.wait_for_timeout(150)
        page.get_by_role('button', name='Começar').click(); page.wait_for_timeout(300)
        # a demonstração perde a sessão ao recarregar; confere a marca de "já visto" guardada no aparelho
        if not page.evaluate("Object.keys(localStorage).some((k) => k.startsWith('erp:tutorial:v1:') && localStorage.getItem(k) === '1')"):
            problemas.append(f'{esquema}: tutorial não ficou marcado como visto')
        page.goto(BASE + '#/ajustes'); page.get_by_text('Ver o tutorial de novo').click()
        try: page.wait_for_selector('text=Bem-vindo ao sistema da Associação Exemplo', timeout=4000); page.get_by_role('button', name='Pular').click()
        except Exception: problemas.append(f'{esquema}: rever tutorial não funcionou')
        page.goto(BASE + '#/dinheiro/conciliacao'); page.wait_for_timeout(800)
        page.get_by_role('button', name='Ajuda: Conciliação').click()
        try: page.wait_for_selector('text=Baixe o extrato no app do banco', timeout=4000)
        except Exception: problemas.append(f'{esquema}: ajuda ⓘ da conciliação não abriu')
        page.screenshot(path=f'/tmp/claude-0/ajuda-{esquema}.png')
        ctx.close()
    nav.close()
print(json.dumps({'problemas': problemas}, ensure_ascii=False))
