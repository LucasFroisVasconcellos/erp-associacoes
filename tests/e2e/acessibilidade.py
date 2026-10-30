"""Auditoria automática WCAG 2.2 AA (axe-core) em todas as telas, claro e escuro.
O contexto usa bypass_csp só para injetar o axe — a CSP real é testada no passeio visual."""
import json, sys
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:4174/'
AXE = sys.argv[1]
ROTAS = ['', 'dinheiro', 'dinheiro?aba=prever', 'dinheiro?aba=reembolsos', 'dinheiro/contas', 'dinheiro/cadastros',
         'dinheiro/fechamento', 'dinheiro/importar', 'documentos', 'relatorios', 'acessos', 'acessos/auditoria', 'mais', 'recursos', 'equipe', 'organizacao', 'transparencia', 'transparencia/gestao', 'dinheiro/orcamento', 'analises', 'analises?aba=receitas', 'analises?aba=qualidade', 'analises?aba=custos', 'ajustes', 'privacidade', 'agenda', 'tarefas', 'tarefas/rotinas', 'avisos', 'verbas', 'verbas/cadastros', 'projetos', 'pessoas',
         'pessoas/cadastros', 'patrimonio', 'filiacoes', 'filiacoes/tipos', 'documentos/governanca',
         'dinheiro/conciliacao', 'captacao', 'captacao?aba=acoes', 'captacao?aba=recibos', 'captacao?aba=contrapartidas', 'viagens']
resultado = {}

def auditar(page, nome):
    page.add_script_tag(path=AXE)
    r = page.evaluate("""async () => { const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'] } });
      return r.violations.map(v => ({ id: v.id, impacto: v.impact, n: v.nodes.length, alvo: v.nodes.slice(0,2).map(n => n.target.join(' ')), resumo: v.nodes[0]?.failureSummary?.slice(0,220) })) }""")
    if r: resultado[nome] = r

with sync_playwright() as p:
    nav = p.chromium.launch()
    for esquema in ['light', 'dark']:
        for vp_nome, vp in [('celular', {'width': 390, 'height': 844}), ('computador', {'width': 1280, 'height': 820})]:
            ctx = nav.new_context(viewport=vp, color_scheme=esquema, bypass_csp=True, locale='pt-BR', reduced_motion='reduce')
            page = ctx.new_page()
            page.goto(BASE); page.wait_for_load_state('networkidle')
            auditar(page, f'{esquema}/{vp_nome}/entrar')
            page.goto(BASE + '#/entrar/pedir'); page.wait_for_selector('text=Enviar pedido'); auditar(page, f'{esquema}/{vp_nome}/pedir-acesso')
            page.goto(BASE + '#/entrar'); page.wait_for_selector('text=Esqueci a senha')
            page.get_by_label('E-mail').fill('a@b.test'); page.get_by_label('Senha').fill('demo1234')
            page.get_by_role('button', name='Entrar').click(); page.wait_for_selector('text=Verificação em duas etapas')
            auditar(page, f'{esquema}/{vp_nome}/2fa')
            page.keyboard.type('123456'); page.wait_for_selector('text=Saldo da Associação Exemplo')
            for r in ROTAS:
                page.goto(BASE + '#/' + r); page.wait_for_timeout(700)
                auditar(page, f'{esquema}/{vp_nome}/{r or "inicio"}')
            # telas de detalhe (endereço com id): entra pela lista
            page.goto(BASE + '#/projetos'); page.wait_for_timeout(600)
            page.get_by_role('link', name='Cadeiras de jogo e viagens 2026').first.click(); page.wait_for_selector('text=Rubricas'); page.wait_for_timeout(600)
            auditar(page, f'{esquema}/{vp_nome}/projeto')
            page.goto(BASE + '#/verbas'); page.wait_for_timeout(600)
            page.get_by_role('link', name='Emenda para cadeiras de jogo e viagens').first.click(); page.wait_for_selector('text=Parcelas'); page.wait_for_timeout(600)
            auditar(page, f'{esquema}/{vp_nome}/verba')
            page.goto(BASE + '#/pessoas'); page.wait_for_selector('text=Ana Exemplo')
            page.get_by_role('link', name='Ana Exemplo').first.click(); page.wait_for_selector('text=Área de saúde'); page.wait_for_timeout(600)
            auditar(page, f'{esquema}/{vp_nome}/pessoa')
            page.goto(BASE + '#/pessoas'); page.wait_for_selector('text=Ana Exemplo')
            page.get_by_role('radio', name='Mensalidades').click(); page.wait_for_timeout(400)
            auditar(page, f'{esquema}/{vp_nome}/mensalidades')
            page.get_by_role('button', name='Bruno Fictício').first.click(); page.wait_for_selector('text=Copiar código Pix'); page.wait_for_timeout(700)
            auditar(page, f'{esquema}/{vp_nome}/mensalidade-pix')
            page.keyboard.press('Escape'); page.wait_for_timeout(300)
            page.goto(BASE + '#/patrimonio'); page.wait_for_selector('text=CAD-001')
            page.get_by_role('link', name='CAD-001').first.click(); page.wait_for_selector('text=Empréstimo'); page.wait_for_timeout(500)
            auditar(page, f'{esquema}/{vp_nome}/bem')
            page.goto(BASE + '#/documentos/governanca'); page.wait_for_selector('text=CND Federal')
            page.get_by_role('radio', name='Reuniões').click(); page.wait_for_timeout(300)
            auditar(page, f'{esquema}/{vp_nome}/reunioes')
            page.get_by_role('link', name='Reunião de diretoria').first.click(); page.wait_for_selector('text=Deliberações'); page.wait_for_timeout(500)
            auditar(page, f'{esquema}/{vp_nome}/reuniao')
            page.goto(BASE + '#/filiacoes'); page.wait_for_selector('text=Federação Estadual Exemplo')
            page.get_by_role('link', name='Federação Estadual Exemplo').first.click(); page.wait_for_selector('text=Documentos exigidos'); page.wait_for_timeout(500)
            auditar(page, f'{esquema}/{vp_nome}/filiacao')
            page.goto(BASE + '#/captacao'); page.wait_for_selector('text=Empresa Exemplo Ltda.')
            page.get_by_role('link', name='Empresa Exemplo Ltda.').first.click(); page.wait_for_selector('text=Histórico de conversas'); page.wait_for_timeout(500)
            auditar(page, f'{esquema}/{vp_nome}/oportunidade')
            page.goto(BASE + '#/captacao?aba=acoes'); page.wait_for_selector('text=Rifa para o Brasileiro')
            page.get_by_role('link', name='Rifa para o Brasileiro').first.click(); page.wait_for_selector('text=Vendedores'); page.wait_for_timeout(500)
            auditar(page, f'{esquema}/{vp_nome}/rifa')
            page.goto(BASE + '#/captacao?aba=recibos'); page.wait_for_selector('text=Doador Exemplo')
            page.get_by_role('button', name='Adicionar', exact=True).first.click(); page.wait_for_selector('text=Emitir recibo de doação'); page.wait_for_timeout(500)
            auditar(page, f'{esquema}/{vp_nome}/emitir-recibo')
            page.keyboard.press('Escape'); page.wait_for_timeout(300)
            page.goto(BASE + '#/viagens'); page.wait_for_selector('text=Campeonato Brasileiro')
            page.get_by_role('link', name='Campeonato Brasileiro').first.click(); page.wait_for_selector('text=Acerto'); page.wait_for_timeout(500)
            auditar(page, f'{esquema}/{vp_nome}/viagem')
            page.goto(BASE + '#/dinheiro'); page.wait_for_timeout(500)
            page.get_by_role('button', name='Novo lançamento').first.click(); page.wait_for_selector('text=Passo 1 de 2'); page.wait_for_timeout(400)
            auditar(page, f'{esquema}/{vp_nome}/novo-lancamento')
            ctx.close()
    nav.close()

# chave "axe": o rodar.sh reprova se houver qualquer violação
print(json.dumps({"axe": resultado}, ensure_ascii=False, indent=1))
