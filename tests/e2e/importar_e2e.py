"""Importações na build de demonstração, com os cabeçalhos reais (CSP e Trusted Types):
planilha Excel de lançamentos antigos, plano de contas, balancete, extrato em PDF e lançar do extrato.
Arquivos fictícios gerados aqui (openpyxl e reportlab)."""
import json, tempfile, os, datetime
import openpyxl
from reportlab.pdfgen import canvas
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4174/'
problemas, pasta = [], tempfile.mkdtemp()
hoje = datetime.date.today()
mes = hoje.replace(day=1) - datetime.timedelta(days=1)  # algum dia do mês passado

xl = os.path.join(pasta, 'tesouraria-antiga.xlsx')
wb = openpyxl.Workbook(); ws = wb.active
ws.append(['Planilha da tesouraria (fictícia)'])
ws.append(['Data', 'Histórico', 'Valor', 'Categoria'])
ws.append([datetime.date(2026, 2, 5), 'Bolas de treino', -320.5, 'Material esportivo'])
ws.append([datetime.date(2026, 2, 9), 'Doação de pessoa física', 150, 'doacoes'])
ws.append([datetime.date(2026, 2, 10), 'Lanche da equipe', -48.9, 'Lanches'])
wb.save(xl)

plano = os.path.join(pasta, 'plano.csv')
open(plano, 'w', encoding='utf-8').write('Código;Descrição\n3.1.09;Outras receitas\n4.1.09;Outras despesas\n')

pdf = os.path.join(pasta, 'extrato.pdf')
c = canvas.Canvas(pdf)
for i, linha in enumerate([f'EXTRATO CONTA CORRENTE {mes.year}', 'Data Historico Valor Saldo',
                           f'{mes.day:02d}/{mes.month:02d} PIX RECEBIDO MARIA EXEMPLO 75,00 C', f'{mes.day:02d}/{mes.month:02d} TARIFA DOC 8,50 D']):
    c.drawString(40, 800 - i * 20, linha)
c.save()

with sync_playwright() as p:
    nav = p.chromium.launch(headless=True)
    page = nav.new_page(viewport={'width': 390, 'height': 844}, locale='pt-BR', timezone_id='America/Sao_Paulo')
    page.on('console', lambda m: problemas.append(f'console.{m.type}: {m.text[:300]}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: problemas.append(f'pageerror: {str(e)[:300]}'))
    page.goto(BASE); page.wait_for_load_state('networkidle')
    page.get_by_label('E-mail').fill('presidencia@exemplo.test'); page.get_by_label('Senha').fill('demo1234')
    page.get_by_role('button', name='Entrar').click(); page.wait_for_selector('text=Verificação em duas etapas')
    page.keyboard.type('123456'); page.wait_for_selector('text=Saldo da Associação Exemplo', timeout=10000)

    # 1) planilha Excel: "Lanches" não existe → escolher categoria na prévia
    page.goto(BASE + '#/dinheiro/importar'); page.wait_for_selector('text=Lançamentos antigos')
    page.get_by_text('Lançamentos antigos').click(); page.wait_for_selector('text=Escolher planilha')
    page.locator('input[type=file]').last.set_input_files(xl)
    page.wait_for_selector('text=Escolha a categoria')
    page.get_by_role('combobox', name='Categoria para Lanches').click(); page.get_by_role('option', name='Alimentação').click()
    page.get_by_role('button', name='Importar 3 lançamentos').click()
    try: page.wait_for_selector('text=3 lançamentos importados', timeout=8000)
    except Exception: problemas.append('planilha: não importou os 3 lançamentos')

    # 2) plano de contas CSV
    page.get_by_text('Plano de contas do contador').click(); page.wait_for_selector('text=Escolher arquivo')
    page.locator('input[type=file]').last.set_input_files(plano)
    page.get_by_role('button', name='Importar 2 contas').click()
    try: page.wait_for_selector('text=Plano de contas importado', timeout=8000)
    except Exception: problemas.append('plano: não importou')

    # 3) comparação com o contador: diferença fictícia na conta de tarifas
    page.get_by_role('radio', name='Comparar com o contador').click()
    try: page.wait_for_selector('text=4.1.05 · Despesas bancárias', timeout=8000)
    except Exception: problemas.append('comparação: conta com diferença não apareceu')
    if page.get_by_text('Categorias sem conta do contador').count() == 0: problemas.append('comparação: categorias sem conta não apareceram')

    # 4) extrato em PDF na conciliação → linhas sem par → criar lançamentos
    page.goto(BASE + '#/dinheiro/conciliacao'); page.wait_for_selector('text=Conciliação')
    page.locator('input[type=file]').last.set_input_files(pdf)
    try: page.wait_for_selector('text=2 linhas novas', timeout=20000)
    except Exception: problemas.append('PDF: as 2 linhas do extrato não foram lidas')
    page.get_by_role('combobox', name='Mês').click(); page.get_by_role('option').nth(1).click(); page.wait_for_timeout(800)
    botoes = page.get_by_role('button', name='Criar lançamento')
    if botoes.count() == 0: problemas.append('conciliação: botão Criar lançamento não apareceu')
    else:
        botoes.first.click(); page.wait_for_selector('text=Criar e conciliar')
        page.get_by_role('combobox').last.click(); page.get_by_role('option').first.click()
        page.get_by_role('button', name='Criar e conciliar').click()
        try: page.wait_for_selector('text=1 lançamento criado e conciliado', timeout=8000)
        except Exception: problemas.append('conciliação: lançar do extrato falhou')
    page.screenshot(path=os.path.join(pasta, 'conciliacao.png'))
    nav.close()
print(json.dumps({'problemas': problemas}, ensure_ascii=False))
