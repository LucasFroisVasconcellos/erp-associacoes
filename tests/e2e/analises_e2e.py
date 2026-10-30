"""Análises na build de demonstração: cenário "e se" muda a previsão sem gravar nada e o relatório
mensal sai em PDF. Coleta erros de console (CSP e Trusted Types)."""
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
    page.goto(BASE); page.wait_for_load_state('networkidle')
    page.get_by_label('E-mail').fill('presidencia@exemplo.test'); page.get_by_label('Senha').fill('demo1234')
    page.get_by_role('button', name='Entrar').click(); page.wait_for_selector('text=Verificação em duas etapas')
    page.keyboard.type('123456'); page.wait_for_selector('text=Saldo da Associação Exemplo', timeout=10000)
    page.goto(BASE + '#/analises'); page.wait_for_selector('text=Saldo previsto mês a mês')
    page.get_by_text('Adicionar cenário').click(); page.wait_for_selector('text=Novo cenário')
    page.get_by_label('Valor (R$)').press_sequentially('5000000')  # R$ 50.000,00
    page.get_by_role('button', name='Simular').click()
    try:
        page.wait_for_selector('text=sem os cenários', timeout=5000)
        if page.get_by_text('Negativo já').count() + page.locator('text=/\\d+ (mês|meses)$/').count() == 0: problemas.append('cenário: fôlego não ficou negativo com gasto de 50 mil')
    except Exception: problemas.append('cenário: previsão não mudou')
    with page.expect_download(timeout=15000) as d:
        page.get_by_role('button', name='Relatório').click(); page.get_by_role('menuitem', name='Do trimestre (conselho fiscal)').click()
    if not d.value.suggested_filename.endswith('.pdf'): problemas.append('relatório: não é PDF')
    for aba in ['receitas', 'qualidade', 'custos']:
        page.goto(BASE + f'#/analises?aba={aba}'); page.wait_for_timeout(1200)
        if page.get_by_text('Algo deu errado').count(): problemas.append(f'aba {aba} com erro')
    nav.close()
print(json.dumps({'problemas': problemas}, ensure_ascii=False))
