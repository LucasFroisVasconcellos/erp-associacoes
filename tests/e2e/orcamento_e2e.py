"""Orçamento anual e mensalidade paga em um passo, na build de demonstração com os cabeçalhos reais."""
import json
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4174/'
problemas = []
with sync_playwright() as p:
    nav = p.chromium.launch(headless=True)
    page = nav.new_page(viewport={'width': 390, 'height': 844}, locale='pt-BR', timezone_id='America/Sao_Paulo')
    page.on('console', lambda m: problemas.append(f'console.{m.type}: {m.text[:300]}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: problemas.append(f'pageerror: {str(e)[:300]}'))
    page.goto(BASE); page.wait_for_load_state('networkidle')
    page.get_by_label('E-mail').fill('presidencia@exemplo.test'); page.get_by_label('Senha').fill('demo1234')
    page.get_by_role('button', name='Entrar').click(); page.wait_for_selector('text=Verificação em duas etapas')
    page.keyboard.type('123456'); page.wait_for_selector('text=Saldo da Associação Exemplo', timeout=10000)
    # orçamento
    page.goto(BASE + '#/dinheiro/orcamento'); page.wait_for_selector('text=Despesas por categoria')
    page.get_by_role('button', name='Definir valores').click(); page.wait_for_selector('text=Sugerir pelo que foi realizado')
    page.get_by_label('Orçamento de Arbitragem').fill(''); page.get_by_label('Orçamento de Arbitragem').press_sequentially('300000')
    if page.get_by_label('Orçamento de Arbitragem').input_value() != '3.000,00': problemas.append('orçamento: máscara do valor')
    page.get_by_role('button', name='Salvar').click()
    try: page.wait_for_selector('text=Orçamento salvo', timeout=8000)
    except Exception: problemas.append('orçamento: não salvou')
    # mensalidade em um passo
    page.goto(BASE + '#/pessoas?aba=mensalidades'); page.wait_for_timeout(1500)
    alvo = page.get_by_text('Em aberto · vence').first if page.get_by_text('Em aberto · vence').count() else None
    if alvo is None: problemas.append('mensalidade: nenhuma aberta na demonstração')
    else:
        alvo.click(); page.wait_for_selector('text=Cobrar')
        page.get_by_role('radio', name='Dar baixa').click()
        page.get_by_role('button', name='Marcar como paga').click()
        try: page.wait_for_selector('text=Mensalidade paga e entrada lançada no Dinheiro', timeout=8000)
        except Exception: problemas.append('mensalidade: baixa em um passo falhou')
    nav.close()
print(json.dumps({'problemas': problemas}, ensure_ascii=False))
