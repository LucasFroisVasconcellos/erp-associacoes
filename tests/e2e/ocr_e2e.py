"""Leitura de foto do comprovante (OCR no aparelho) na build de demonstração, com os cabeçalhos
reais (/ocr/* com política própria). Gera um cupom fictício como imagem e confere o preenchimento."""
import json, sys, tempfile
from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4174/'
problemas = []
fonte = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 34)
img = Image.new('RGB', (900, 620), 'white'); d = ImageDraw.Draw(img)
for i, l in enumerate(['PADARIA BOM PAO LTDA', 'CNPJ 12.345.678/0001-90', '20/10/2026 12:31', 'PAO FRANCES 1,80', 'CAFE 5,50', 'TOTAL R$ 7,30', 'DINHEIRO 10,00']):
    d.text((40, 30 + i * 80), l, fill='black', font=fonte)
foto = tempfile.NamedTemporaryFile(suffix='.png', delete=False).name; img.save(foto)

with sync_playwright() as p:
    nav = p.chromium.launch(headless=True)
    ctx = nav.new_context(viewport={'width': 390, 'height': 844}, locale='pt-BR', timezone_id='America/Sao_Paulo')
    page = ctx.new_page()
    page.on('console', lambda m: problemas.append(f'console.{m.type}: {m.text[:300]}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: problemas.append(f'pageerror: {str(e)[:300]}'))
    page.goto(BASE); page.wait_for_load_state('networkidle')
    page.get_by_label('E-mail').fill('presidencia@exemplo.test'); page.get_by_label('Senha').fill('demo1234')
    page.get_by_role('button', name='Entrar').click(); page.wait_for_selector('text=Verificação em duas etapas')
    page.keyboard.type('123456'); page.wait_for_selector('text=Saldo da Associação Exemplo', timeout=10000)
    page.get_by_role('button', name='Novo lançamento').click(); page.wait_for_selector('text=Passo 1 de 2')
    page.locator('input[type=file][capture]').set_input_files(foto)
    try:
        page.wait_for_selector('text=Lemos a foto', timeout=90000)
    except Exception:
        problemas.append('OCR não terminou em 90 s')
    page.get_by_role('button', name='Continuar').click(); page.wait_for_selector('text=Passo 2 de 2')
    valor, desc = page.get_by_label('Valor').input_value(), page.get_by_label('Com o que foi').input_value()
    if valor != '7,30': problemas.append(f'valor lido errado: {valor!r}')
    if 'PADARIA' not in desc.upper(): problemas.append(f'estabelecimento não lido: {desc!r}')
    nav.close()
print(json.dumps({'problemas': problemas, 'valor': valor, 'descricao': desc}, ensure_ascii=False))
