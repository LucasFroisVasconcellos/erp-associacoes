"""Transparência na build de demonstração com os cabeçalhos reais: a página pública abre SEM login e só
mostra o que foi publicado; a diretoria publica um período e retira do ar."""
import json
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4174/'
problemas = []
with sync_playwright() as p:
    nav = p.chromium.launch(headless=True)
    ctx = nav.new_context(viewport={'width': 390, 'height': 844}, locale='pt-BR', timezone_id='America/Sao_Paulo', accept_downloads=True)
    page = ctx.new_page()
    page.on('console', lambda m: problemas.append(f'console.{m.type}: {m.text[:300]}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: problemas.append(f'pageerror: {str(e)[:300]}'))
    # 1) sem login
    page.goto(BASE + '#/transparencia'); page.wait_for_load_state('networkidle')
    try: page.wait_for_selector('text=De onde veio o dinheiro', timeout=8000)
    except Exception: problemas.append('pública: não abriu sem login')
    if page.get_by_text('Saldo da Associação Exemplo').count(): problemas.append('pública: mostrou tela interna sem login')
    with page.expect_download(timeout=15000) as d:
        page.get_by_role('button', name='PDF').click()
    if not d.value.suggested_filename.endswith('.pdf'): problemas.append('pública: PDF não gerado')
    # 2) diretoria publica
    page.goto(BASE + '#/entrar'); page.wait_for_selector('text=Entrar')
    page.get_by_label('E-mail').fill('presidencia@exemplo.test'); page.get_by_label('Senha').fill('demo1234')
    page.get_by_role('button', name='Entrar').click(); page.wait_for_selector('text=Verificação em duas etapas')
    page.keyboard.type('123456'); page.wait_for_selector('text=Saldo da Associação Exemplo', timeout=10000)
    page.goto(BASE + '#/transparencia/gestao'); page.wait_for_selector('text=Prévia — como vai aparecer', timeout=10000)
    page.get_by_role('button', name='Publicar este período').click(); page.wait_for_selector('text=Publicar transparência')
    page.get_by_label('Título').fill('Contas de teste do e2e')
    page.get_by_role('button', name='Publicar', exact=True).click()
    try: page.wait_for_selector('text=Contas de teste do e2e', timeout=8000)
    except Exception: problemas.append('gestão: publicação não apareceu na lista')
    page.goto(BASE + '#/transparencia'); page.wait_for_timeout(1200)
    if page.get_by_role('combobox', name='Período').count() == 0: problemas.append('pública: a nova publicação não entrou na lista de períodos')
    # 3) retirar
    page.goto(BASE + '#/transparencia/gestao'); page.wait_for_selector('text=Contas de teste do e2e')
    page.get_by_role('button', name='Retirar').first.click(); page.wait_for_selector('text=Retirar do ar')
    page.get_by_label('Por quê').fill('Teste automático'); page.get_by_role('button', name='Retirar', exact=True).last.click()
    try: page.wait_for_selector('text=Retirada: Teste automático', timeout=8000)
    except Exception: problemas.append('gestão: retirar não funcionou')
    nav.close()
print(json.dumps({'problemas': problemas}, ensure_ascii=False))
