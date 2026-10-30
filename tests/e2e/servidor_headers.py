"""Serve uma pasta aplicando o _headers como o Cloudflare Pages faria: toda regra que casa com o
caminho soma cabeçalhos, na ordem do arquivo; "! Nome" remove o que uma regra anterior pôs."""
import http.server, sys, os, functools
pasta, porta = sys.argv[1], int(sys.argv[2])
regras, atual = [], None
for l in open(os.path.join(pasta, '_headers'), encoding='utf8'):
    if not l.strip() or l.strip().startswith('#'): continue
    if not l[0].isspace(): atual = (l.strip(), []); regras.append(atual); continue
    t = l.strip()
    if t.startswith('!'): atual[1].append((t[1:].strip(), None)); continue
    k, v = t.split(':', 1); atual[1].append((k.strip(), v.strip()))
def casa(regra, caminho):
    return caminho.startswith(regra[:-1]) if regra.endswith('*') else caminho == regra
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        caminho = self.path.split('?')[0]
        final = []
        for regra, cabs in regras:
            if not casa(regra, caminho): continue
            for k, v in cabs:
                if v is None: final = [(a, b) for a, b in final if a.lower() != k.lower()]
                else: final.append((k, v))
        for k, v in final: self.send_header(k, v)
        super().end_headers()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', porta), functools.partial(H, directory=pasta)).serve_forever()
