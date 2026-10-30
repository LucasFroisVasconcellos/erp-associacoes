"""Fluxo do CAPTCHA no navegador com CSP + Trusted Types reais (cabeçalhos do _headers).
O Turnstile e o Supabase Auth são imitados por interceptação de rede."""
import json, sys
from playwright.sync_api import sync_playwright
BASE = 'http://127.0.0.1:4175/'
FALSO = open(sys.argv[1]).read()
problemas, pedidos = [], []

def auth(route):
    req = route.request
    corpo = json.loads(req.post_data or '{}')
    pedidos.append({'url': req.url.split('/auth/v1/')[1].split('?')[0], 'token': (corpo.get('gotrue_meta_security') or {}).get('captcha_token')})
    route.fulfill(status=400, content_type='application/json', body=json.dumps({'code': 'captcha_failed', 'error_code': 'captcha_failed', 'msg': 'captcha protection: request disallowed (timeout-or-duplicate)'}))

with sync_playwright() as p:
    nav = p.chromium.launch()
    pg = nav.new_page()
    pg.on('console', lambda m: problemas.append(f'console.{m.type}: {m.text[:250]}') if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: problemas.append(f'pageerror: {str(e)[:250]}'))
    pg.route('https://challenges.cloudflare.com/**', lambda r: r.fulfill(status=200, content_type='application/javascript', body=FALSO))
    pg.route('https://projeto-ficticio.supabase.co/auth/v1/**', auth)
    pg.goto(BASE); pg.wait_for_load_state('networkidle')
    botao = pg.get_by_role('button', name='Entrar')
    pg.get_by_label('E-mail').fill('a@b.test'); pg.get_by_label('Senha').fill('senha-de-teste')
    r = {'travado_sem_token': botao.is_disabled()}
    pg.evaluate('window.__liberar()'); pg.wait_for_timeout(300)
    r['liberado_com_token'] = botao.is_enabled()
    botao.click(); pg.wait_for_selector('text=Não conseguimos confirmar que é uma pessoa', timeout=5000)
    r['mensagem_captcha_no_login'] = True
    pg.wait_for_timeout(300)
    r['resets_apos_tentativa'] = pg.evaluate('window.__resets')
    botao.click(); pg.wait_for_timeout(600)
    pg.goto(BASE + '#/entrar/recuperar'); pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(300)
    pg.get_by_label('E-mail').fill('a@b.test')
    pg.get_by_role('button', name='Enviar link').click(); pg.wait_for_timeout(800)
    r['recuperacao_mostra_erro'] = pg.get_by_text('Não conseguimos confirmar que é uma pessoa').count() > 0
    r['recuperacao_nao_diz_enviado'] = pg.get_by_text('o link chega em alguns minutos').count() == 0
    # pedir acesso: token do CAPTCHA com action própria; vai sem sessão (só a chave publicável)
    envio = {}
    def funcao(route):
        envio['corpo'] = json.loads(route.request.post_data or '{}'); envio['auth'] = route.request.headers.get('authorization'); envio['apikey'] = bool(route.request.headers.get('apikey'))
        route.fulfill(status=200, content_type='application/json', body='{"ok":true}')
    pg.route('https://projeto-ficticio.supabase.co/functions/v1/pedir-acesso', funcao)
    pg.goto(BASE + '#/entrar/pedir'); pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(300)
    pg.get_by_label('Seu nome').fill('Pessoa Fictícia'); pg.get_by_label('E-mail').fill('pessoa@exemplo.test')
    pg.get_by_role('button', name='Enviar pedido').click()
    try: pg.wait_for_selector('text=Pedido recebido', timeout=5000); r['pedir_acesso_ok'] = True
    except Exception: r['pedir_acesso_ok'] = False
    r['pedir_acesso_action'] = 'pedir_acesso' in (pg.evaluate('window.__acoes') or [])
    r['pedir_acesso_sem_sessao'] = envio.get('auth') is None and envio.get('apikey') is True
    r['pedir_acesso_com_token'] = str((envio.get('corpo') or {}).get('captcha', '')).startswith('TOKEN-')
    r['pedidos'] = pedidos
    toks = [x['token'] for x in pedidos]
    r['todos_com_token'] = all(toks)
    r['tokens_unicos'] = len(set(toks)) == len(toks)
    nav.close()
r['problemas_console'] = [x for x in problemas if 'Failed to load resource' not in x]
print(json.dumps(r, ensure_ascii=False, indent=1))
