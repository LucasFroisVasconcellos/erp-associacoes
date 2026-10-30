"""Passeio visual pela build de demonstração: celular e computador, claro e escuro.
Coleta erros de console (inclusive violações de CSP) e estouro horizontal."""
import json, sys
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4174/'
OUT = sys.argv[1]
problemas = []

def vigiar(page, nome):
    page.on('console', lambda m: problemas.append(f'[{nome}] console.{m.type}: {m.text[:300]}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: problemas.append(f'[{nome}] pageerror: {str(e)[:300]}'))

def estouro(page, onde):
    w = page.evaluate('() => [document.documentElement.scrollWidth, window.innerWidth]')
    if w[0] > w[1] + 1:
        problemas.append(f'[{onde}] estouro horizontal {w}')

def entrar(page):
    page.goto(BASE)
    page.wait_for_load_state('networkidle')
    page.get_by_label('E-mail').fill('presidencia@exemplo.test')
    page.get_by_label('Senha').fill('demo1234')
    page.get_by_role('button', name='Entrar').click()
    page.wait_for_selector('text=Verificação em duas etapas')
    page.keyboard.type('123456')
    page.wait_for_selector('text=Saldo da Associação Exemplo', timeout=10000)
    page.wait_for_timeout(600)

with sync_playwright() as p:
    nav = p.chromium.launch(headless=True)
    for nome, vp, esquema in [('celular', {'width': 390, 'height': 844}, 'light'), ('computador', {'width': 1280, 'height': 820}, 'light'), ('celular-escuro', {'width': 390, 'height': 844}, 'dark')]:
        ctx = nav.new_context(viewport=vp, color_scheme=esquema, device_scale_factor=2 if 'celular' in nome else 1, locale='pt-BR', timezone_id='America/Sao_Paulo')
        page = ctx.new_page(); vigiar(page, nome)
        page.goto(BASE); page.wait_for_load_state('networkidle')
        page.screenshot(path=f'{OUT}/{nome}-01-entrar.png')
        entrar(page)
        page.screenshot(path=f'{OUT}/{nome}-02-inicio.png', full_page=True); estouro(page, nome + ' inicio')
        page.goto(BASE + '#/dinheiro'); page.wait_for_selector('text=Lançamentos'); page.wait_for_timeout(700)
        page.screenshot(path=f'{OUT}/{nome}-03-dinheiro.png', full_page=True); estouro(page, nome + ' dinheiro')
        # abrir um lançamento (transição push)
        page.locator('a[href*="/dinheiro/lancamento/"]').first.click(); page.wait_for_timeout(900)
        page.screenshot(path=f'{OUT}/{nome}-04-detalhe.png', full_page=True); estouro(page, nome + ' detalhe')
        # novo lançamento
        if 'celular' in nome:
            page.get_by_role('button', name='Novo lançamento').click()
        else:
            page.get_by_role('button', name='Novo lançamento').first.click()
        page.wait_for_selector('text=Passo 1 de 2'); page.wait_for_timeout(500)
        page.screenshot(path=f'{OUT}/{nome}-05-comprovante.png')
        page.get_by_role('button', name='Preencher sem comprovante').click(); page.wait_for_selector('text=Passo 2 de 2'); page.wait_for_timeout(300)
        page.get_by_label('Valor').press_sequentially('4590')  # teclado numérico: sem vírgula
        assert page.get_by_label('Valor').input_value() == '45,90', 'máscara de centavos falhou'
        page.get_by_label('Com o que foi').fill('Lanche da equipe')
        page.get_by_role('button', name='Salvar lançamento').click(); page.wait_for_timeout(300)
        # sem conta e sem categoria: a validação precisa apontar os dois campos
        assert page.get_by_text('Escolha de qual conta saiu').is_visible(), 'faltou erro da conta'
        assert page.get_by_text('Escolha a categoria: ela organiza').is_visible(), 'faltou erro da categoria'
        page.get_by_role('combobox', name='Conta').click(); page.get_by_role('option').first.click()
        page.get_by_role('combobox', name='Categoria').click(); page.get_by_role('option').first.click()
        page.screenshot(path=f'{OUT}/{nome}-06-novo.png')
        page.get_by_role('button', name='Salvar lançamento').click()
        page.wait_for_selector('text=Saída registrada', timeout=8000)
        page.wait_for_timeout(400)
        page.goto(BASE + '#/acessos'); page.wait_for_selector('text=Diretoria no sistema'); page.wait_for_timeout(500)
        page.screenshot(path=f'{OUT}/{nome}-07-acessos.png', full_page=True); estouro(page, nome + ' acessos')
        page.goto(BASE + '#/nao-existe'); page.wait_for_selector('text=Página não encontrada'); page.wait_for_timeout(300)
        # agenda (mês e lista), tarefas (quadro e detalhe) e avisos
        # no celular o mês mostra só pontinhos; o título do treino aparece com certeza na Lista (o teste não depende do dia da semana)
        page.goto(BASE + '#/agenda'); page.wait_for_selector('text=Hoje ·'); page.wait_for_timeout(500)
        page.screenshot(path=f'{OUT}/{nome}-11-agenda.png', full_page=True); estouro(page, nome + ' agenda')
        page.get_by_role('radio', name='Lista').click(); page.wait_for_selector('text=Treino da equipe'); page.wait_for_timeout(500)
        page.screenshot(path=f'{OUT}/{nome}-12-agenda-lista.png', full_page=True); estouro(page, nome + ' agenda lista')
        page.get_by_role('button', name='Reunião de diretoria').first.click(); page.wait_for_selector('text=Editar evento'); page.wait_for_timeout(500)
        page.screenshot(path=f'{OUT}/{nome}-13-evento.png'); page.keyboard.press('Escape'); page.wait_for_timeout(400)
        page.goto(BASE + '#/tarefas'); page.wait_for_selector('text=Montar a pauta da reunião'); page.wait_for_timeout(500)
        page.screenshot(path=f'{OUT}/{nome}-14-tarefas.png', full_page=True); estouro(page, nome + ' tarefas')
        page.get_by_role('link', name='Montar a pauta da reunião').first.click(); page.wait_for_selector('text=Checklist'); page.wait_for_timeout(500)
        page.screenshot(path=f'{OUT}/{nome}-15-tarefa.png', full_page=True); estouro(page, nome + ' tarefa')
        page.goto(BASE + '#/avisos'); page.wait_for_selector('text=No mural'); page.wait_for_timeout(400)
        page.screenshot(path=f'{OUT}/{nome}-16-avisos.png', full_page=True); estouro(page, nome + ' avisos')
        # verbas (lista e detalhe) e projetos (lista e detalhe com rubricas e pendências)
        page.goto(BASE + '#/verbas'); page.wait_for_selector('text=Emenda para cadeiras de jogo'); page.wait_for_timeout(400)
        page.screenshot(path=f'{OUT}/{nome}-17-verbas.png', full_page=True); estouro(page, nome + ' verbas')
        page.get_by_role('link', name='Emenda para cadeiras de jogo e viagens').first.click(); page.wait_for_selector('text=Parcelas'); page.wait_for_timeout(400)
        page.screenshot(path=f'{OUT}/{nome}-18-verba.png', full_page=True); estouro(page, nome + ' verba')
        page.goto(BASE + '#/projetos'); page.wait_for_selector('text=Cadeiras de jogo e viagens 2026'); page.wait_for_timeout(400)
        page.screenshot(path=f'{OUT}/{nome}-19-projetos.png', full_page=True); estouro(page, nome + ' projetos')
        page.get_by_role('link', name='Cadeiras de jogo e viagens 2026').first.click(); page.wait_for_selector('text=Rubricas'); page.wait_for_timeout(500)
        page.screenshot(path=f'{OUT}/{nome}-20-projeto.png', full_page=True); estouro(page, nome + ' projeto')
        # pessoas (lista, mensalidades com Pix, ficha), patrimônio, governança e filiações
        page.goto(BASE + '#/pessoas'); page.wait_for_selector('text=Ana Exemplo'); page.wait_for_timeout(400)
        page.screenshot(path=f'{OUT}/{nome}-21-pessoas.png', full_page=True); estouro(page, nome + ' pessoas')
        page.get_by_role('radio', name='Mensalidades').click(); page.wait_for_timeout(500)
        page.get_by_role('button', name='Bruno Fictício').first.click(); page.wait_for_selector('text=Copiar código Pix'); page.wait_for_timeout(700)
        assert page.get_by_role('img', name='QR Code Pix').count() or page.locator('svg[role=img]').count(), 'faltou o QR Code'
        page.screenshot(path=f'{OUT}/{nome}-22-mensalidade-pix.png'); estouro(page, nome + ' pix')
        page.keyboard.press('Escape'); page.wait_for_timeout(400)
        page.goto(BASE + '#/pessoas'); page.wait_for_selector('text=Ana Exemplo')
        page.get_by_role('link', name='Ana Exemplo').first.click(); page.wait_for_selector('text=Área de saúde'); page.wait_for_timeout(500)
        page.screenshot(path=f'{OUT}/{nome}-23-pessoa.png', full_page=True); estouro(page, nome + ' pessoa')
        page.goto(BASE + '#/patrimonio'); page.wait_for_selector('text=CAD-001'); page.wait_for_timeout(400)
        page.screenshot(path=f'{OUT}/{nome}-24-patrimonio.png', full_page=True); estouro(page, nome + ' patrimonio')
        page.get_by_role('link', name='CAD-001').first.click(); page.wait_for_selector('text=Empréstimo'); page.wait_for_timeout(400)
        page.screenshot(path=f'{OUT}/{nome}-25-bem.png', full_page=True); estouro(page, nome + ' bem')
        page.goto(BASE + '#/documentos/governanca'); page.wait_for_selector('text=CND Federal'); page.wait_for_timeout(400)
        page.screenshot(path=f'{OUT}/{nome}-26-governanca.png', full_page=True); estouro(page, nome + ' governanca')
        page.get_by_role('radio', name='Reuniões').click(); page.wait_for_timeout(300)
        page.get_by_role('link', name='Assembleia geral ordinária').first.click(); page.wait_for_selector('text=Ata aprovada'); page.wait_for_timeout(400)
        page.screenshot(path=f'{OUT}/{nome}-27-reuniao.png', full_page=True); estouro(page, nome + ' reuniao')
        page.goto(BASE + '#/filiacoes'); page.wait_for_selector('text=Federação Estadual Exemplo'); page.wait_for_timeout(500)
        page.screenshot(path=f'{OUT}/{nome}-28-filiacoes.png', full_page=True); estouro(page, nome + ' filiacoes')
        page.get_by_role('link', name='Federação Estadual Exemplo').first.click(); page.wait_for_selector('text=Documentos exigidos'); page.wait_for_timeout(400)
        page.screenshot(path=f'{OUT}/{nome}-29-filiacao.png', full_page=True); estouro(page, nome + ' filiacao')
        # conciliação, captação (funil, rifa, recibos, contrapartidas) e viagens
        page.goto(BASE + '#/dinheiro/conciliacao'); page.wait_for_selector('text=Para conciliar'); page.wait_for_timeout(500)
        page.screenshot(path=f'{OUT}/{nome}-30-conciliacao.png', full_page=True); estouro(page, nome + ' conciliacao')
        page.goto(BASE + '#/captacao'); page.wait_for_selector('text=Empresa Exemplo Ltda.'); page.wait_for_timeout(400)
        page.screenshot(path=f'{OUT}/{nome}-31-captacao.png', full_page=True); estouro(page, nome + ' captacao')
        page.get_by_role('link', name='Empresa Exemplo Ltda.').first.click(); page.wait_for_selector('text=Histórico de conversas'); page.wait_for_timeout(300)
        page.screenshot(path=f'{OUT}/{nome}-32-oportunidade.png', full_page=True); estouro(page, nome + ' oportunidade')
        page.goto(BASE + '#/captacao?aba=acoes'); page.wait_for_selector('text=Rifa para o Brasileiro')
        page.get_by_role('link', name='Rifa para o Brasileiro').first.click(); page.wait_for_selector('text=Vendedores'); page.wait_for_timeout(400)
        page.screenshot(path=f'{OUT}/{nome}-33-rifa.png', full_page=True); estouro(page, nome + ' rifa')
        page.goto(BASE + '#/captacao?aba=recibos'); page.wait_for_selector('text=Doador Exemplo'); page.wait_for_timeout(300)
        page.screenshot(path=f'{OUT}/{nome}-34-recibos.png', full_page=True); estouro(page, nome + ' recibos')
        page.get_by_role('button', name='Adicionar', exact=True).first.click(); page.wait_for_selector('text=Emitir recibo de doação'); page.wait_for_timeout(400)
        page.screenshot(path=f'{OUT}/{nome}-35-emitir-recibo.png'); estouro(page, nome + ' emitir recibo')
        page.keyboard.press('Escape'); page.wait_for_timeout(300)
        page.goto(BASE + '#/captacao?aba=contrapartidas'); page.wait_for_selector('text=Marca no uniforme de jogo'); page.wait_for_timeout(300)
        page.screenshot(path=f'{OUT}/{nome}-36-contrapartidas.png', full_page=True); estouro(page, nome + ' contrapartidas')
        page.goto(BASE + '#/viagens'); page.wait_for_selector('text=Campeonato Brasileiro'); page.wait_for_timeout(400)
        page.screenshot(path=f'{OUT}/{nome}-37-viagens.png', full_page=True); estouro(page, nome + ' viagens')
        page.get_by_role('link', name='Campeonato Brasileiro').first.click(); page.wait_for_selector('text=Acerto'); page.wait_for_timeout(2000)
        assert page.get_by_text('Lançamento', exact=True).count() == 0, 'lançamento ligado sem dados'
        page.screenshot(path=f'{OUT}/{nome}-38-viagem.png', full_page=True); estouro(page, nome + ' viagem')
        page.goto(BASE + '#/mais'); page.wait_for_timeout(600)
        page.screenshot(path=f'{OUT}/{nome}-09-mais.png', full_page=True); estouro(page, nome + ' mais')
        page.goto(BASE + '#/dinheiro/fechamento'); page.wait_for_selector('text=Conferência'); page.wait_for_timeout(500)
        page.screenshot(path=f'{OUT}/{nome}-10-fechamento.png', full_page=True)
        ctx.close()
    nav.close()

print(json.dumps(problemas, ensure_ascii=False, indent=1))
