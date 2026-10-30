"""Novo projeto, perfis de permissão, ficha e foto 3x4 do atleta, documento com arquivo já no cadastro
(build de demonstração com os cabeçalhos reais)."""
import json, re, struct, zlib
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4174/'

def png(w=90, h=120):
    cru = b''.join(b'\x00' + b''.join(bytes([(x * 3) % 256, (y * 2) % 256, 140]) for x in range(w)) for y in range(h))
    def bloco(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + bloco(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + bloco(b'IDAT', zlib.compress(cru)) + bloco(b'IEND', b'')

problemas = []
with sync_playwright() as p:
    nav = p.chromium.launch(headless=True)
    page = nav.new_page(viewport={'width': 390, 'height': 844}, locale='pt-BR', timezone_id='America/Sao_Paulo')
    page.on('console', lambda m: problemas.append(f'console.{m.type}: {m.text[:300]}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: problemas.append(f'pageerror: {str(e)[:300]}'))
    # -1. link PADRÃO do e-mail do Supabase (sessão no fragmento): abre "Crie sua senha" e o token sai do endereço
    jwt = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl'
    page.goto('about:blank')
    page.goto(BASE + f'#access_token={jwt}&expires_in=3600&refresh_token=abcdEFGH1234&token_type=bearer&type=invite')
    try: page.wait_for_selector('text=Crie sua senha', timeout=6000)
    except Exception: problemas.append('link do e-mail: não abriu Crie sua senha')
    if 'access_token' in page.url or 'abcdEFGH1234' in page.url: problemas.append('link do e-mail: o token ficou no endereço')
    page.goto('about:blank')  # o link do e-mail abre a página do zero
    page.goto(BASE + '#error=access_denied&error_code=otp_expired&error_description=x')
    try: page.wait_for_selector('text=Link inválido', timeout=6000)
    except Exception: problemas.append('link do e-mail: link vencido não mostrou Link inválido')
    nav.close(); nav = p.chromium.launch(headless=True)
    page = nav.new_page(viewport={'width': 390, 'height': 844}, locale='pt-BR', timezone_id='America/Sao_Paulo')
    page.on('console', lambda m: problemas.append(f'console.{m.type}: {m.text[:300]}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: problemas.append(f'pageerror: {str(e)[:300]}'))
    page.goto(BASE); page.wait_for_load_state('networkidle')
    # 0. pedir acesso (sem login) e a fila em Acessos
    page.get_by_role('link', name='Pedir acesso').click()
    page.get_by_label('Seu nome').fill('Helena Fictícia'); page.get_by_label('E-mail').fill('helena@exemplo.test')
    page.get_by_role('button', name='Enviar pedido').click()
    try: page.wait_for_selector('text=Pedido recebido', timeout=6000)
    except Exception: problemas.append('pedir acesso: não confirmou o envio')
    page.goto(BASE + '#/entrar'); page.wait_for_load_state('networkidle')
    if not page.get_by_label('Manter conectado neste aparelho por 30 dias').count(): problemas.append('login: sem a opção de manter conectado')
    elif not page.get_by_label('Manter conectado neste aparelho por 30 dias').is_checked(): problemas.append('login: manter conectado deveria vir marcado')
    page.get_by_label('E-mail').fill('presidencia@exemplo.test'); page.get_by_label('Senha').fill('demo1234')
    page.get_by_role('button', name='Entrar').click(); page.wait_for_selector('text=Verificação em duas etapas')
    page.keyboard.type('123456'); page.wait_for_selector('text=Saldo da Associação Exemplo', timeout=10000)

    page.goto(BASE + '#/acessos'); page.wait_for_selector('text=Pedidos de acesso')
    page.get_by_text('Helena Fictícia').click(); page.get_by_role('button', name='Liberar').click()
    if page.get_by_label('E-mail', exact=True).last.input_value() != 'helena@exemplo.test': problemas.append('pedir acesso: convite não veio preenchido')
    page.get_by_role('button', name='Enviar convite').click()
    try: page.wait_for_selector('text=Convite enviado para helena@exemplo.test', timeout=6000)
    except Exception: problemas.append('pedir acesso: liberar não convidou')
    page.wait_for_timeout(500)
    if page.get_by_text(re.compile(r'helena@exemplo\.test · pediu em')).count(): problemas.append('pedir acesso: pedido continuou pendente')

    # 1. novo projeto (sem verba)
    page.goto(BASE + '#/projetos'); page.get_by_role('button', name='Novo projeto').first.click()
    page.get_by_label('Nome do projeto').fill('Escolinha de bocha 2027')
    page.get_by_role('button', name='Criar projeto').click()
    try: page.wait_for_selector('text=Projeto criado', timeout=8000); page.wait_for_selector('h1:has-text("Escolinha de bocha 2027")', timeout=8000)
    except Exception: problemas.append('projeto: não criou nem abriu o projeto')

    # 2. permissões: "Todas" de um módulo e perfil pronto
    page.goto(BASE + '#/acessos'); page.wait_for_timeout(800)
    page.locator('a[href*="acessos/membro"]').last.click()
    page.wait_for_selector('text=Perfil pronto')
    todas = page.get_by_label('Todas as permissões de Agenda')
    todas.click()
    if page.locator('#m-agenda-administrar').get_attribute('data-state') != 'checked': problemas.append('permissões: "Todas" não marcou Administrar da Agenda')
    page.get_by_label('Perfil pronto').click(); page.get_by_role('option', name='Só consulta: ver tudo, sem mexer (menos saúde)').click(); page.wait_for_timeout(300)
    if page.locator('#m-financeiro-ver').get_attribute('data-state') != 'checked' or page.locator('#m-financeiro-criar').get_attribute('data-state') == 'checked':
        problemas.append('permissões: perfil "Só consulta" errado')
    if page.locator('#m-saude-ver').get_attribute('data-state') == 'checked': problemas.append('permissões: perfil marcou saúde')

    # 2b. salvar como modelo e ver na lista de Acessos; aplicar o modelo cadastrado
    page.get_by_role('button', name='Salvar estas permissões como modelo').click()
    page.get_by_label('Nome do modelo').fill('Comissão técnica'); page.get_by_role('button', name='Salvar modelo').click()
    try: page.wait_for_selector('text=Modelo salvo', timeout=5000)
    except Exception: problemas.append('modelos: não salvou')
    page.get_by_label('Perfil pronto').click(); page.get_by_role('option', name='Desmarcar tudo').click(); page.wait_for_timeout(300)
    page.get_by_label('Perfil pronto').click(); page.get_by_role('option', name='Comissão técnica').click(); page.wait_for_timeout(300)
    if page.locator('#m-financeiro-ver').get_attribute('data-state') != 'checked': problemas.append('modelos: aplicar o modelo cadastrado não marcou')
    page.goto(BASE + '#/acessos'); page.wait_for_selector('text=Modelos de permissão')
    if not page.get_by_text('Comissão técnica').count(): problemas.append('modelos: não aparece em Acessos')

    # 2c. cadastro novo de atleta já com ficha e foto (com a autorização de imagem)
    page.goto(BASE + '#/pessoas'); page.get_by_role('button', name='Cadastrar pessoa').first.click()
    page.wait_for_selector('text=Ficha do atleta (opcional)')
    page.get_by_label('Nome completo').fill('Igor Fictício'); page.get_by_label('Número da camisa').fill('12')
    page.locator('input[data-campo="ps-foto"]').set_input_files({'name': 'foto.png', 'mimeType': 'image/png', 'buffer': png()})
    page.get_by_text('O atleta autorizou o uso da imagem no cadastro').click()
    page.get_by_role('button', name='Cadastrar', exact=True).last.click()
    try: page.wait_for_selector('h1:has-text("Igor Fictício")', timeout=8000); page.wait_for_selector('text=Camisa 12', timeout=5000); page.wait_for_selector('img[alt^="Foto 3x4 de Igor"]', timeout=5000)
    except Exception: problemas.append('cadastro: ficha ou foto não vieram do cadastro')

    # 3. ficha e foto 3x4 (Caio tem autorização de imagem na demonstração)
    page.goto(BASE + '#/pessoas'); page.get_by_text('Caio Demonstração').first.click()
    page.wait_for_selector('h1:has-text("Caio Demonstração")'); page.wait_for_selector('text=Foto 3x4'); page.wait_for_timeout(500)
    page.locator('input[type=file][accept^="image/jpeg"]').set_input_files({'name': 'foto.png', 'mimeType': 'image/png', 'buffer': png()})
    try: page.wait_for_selector('text=Foto guardada', timeout=8000); page.wait_for_selector('img[alt^="Foto 3x4 de Caio"]', timeout=5000)
    except Exception: problemas.append('foto: não guardou nem mostrou')
    page.get_by_role('button', name='Preencher').click()
    page.get_by_label('Número da camisa').fill('10'); page.get_by_label('Posição').fill('Ponta')
    page.get_by_role('button', name='Salvar').click()
    try: page.wait_for_selector('text=Camisa 10', timeout=6000)
    except Exception: problemas.append('ficha: não salvou')
    # sem autorização de imagem (Bruno): não oferece o botão
    page.goto(BASE + '#/pessoas'); page.get_by_text('Bruno Fictício').first.click(); page.wait_for_selector('text=Foto 3x4')
    if page.get_by_role('button', name='Adicionar foto').count(): problemas.append('foto: ofereceu enviar sem autorização de imagem')

    # 4. documento de saúde já com o laudo (PDF) no cadastro
    page.goto(BASE + '#/pessoas'); page.get_by_text('Ana Exemplo').first.click(); page.wait_for_timeout(800)
    btn = page.get_by_role('button', name='Adicionar documento de saúde')
    if btn.count():
        btn.first.click()
        page.locator('input[type=file][accept*="pdf"]').last.set_input_files({'name': 'laudo.pdf', 'mimeType': 'application/pdf', 'buffer': b'%PDF-1.4\n%fim\n'})
        page.get_by_role('button', name='Registrar').click()
        try: page.wait_for_selector('text=Documento de saúde registrado com o arquivo', timeout=6000)
        except Exception: problemas.append('saúde: laudo não foi anexado no cadastro')
    else: problemas.append('saúde: botão para adicionar documento não achado')
    nav.close()
print(json.dumps({'problemas': problemas}, ensure_ascii=False))
