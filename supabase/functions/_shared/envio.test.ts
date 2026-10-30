// Testes da lógica da Edge Function "enviar-arquivo" (sem Deno: dependências injetadas).
import { describe, expect, test } from 'vitest';
import { type DepsEnvio, tratarEnvio } from './envio';

const LANC = '8f14e45f-ceea-467a-9575-6f1b1f0a2b3c';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]);

function deps(over: Partial<DepsEnvio> = {}) {
  const chamadas: string[] = [];
  const d: DepsEnvio = {
    usuario: 'u-1',
    autorizar: async (fn) => { chamadas.push('autorizar:' + fn); return { ok: true }; },
    gravar: async (bucket, caminho) => { chamadas.push(`gravar:${bucket}:${caminho}`); return { ok: true }; },
    remover: async (bucket, caminho) => { chamadas.push(`remover:${bucket}:${caminho}`); },
    registrar: async (fn) => { chamadas.push('registrar:' + fn); return { ok: true, id: 'c-1', duplicado: false }; },
    ...over,
  };
  return { d, chamadas };
}

// Como um navegador de verdade: corpo multipart serializado, com content-type e content-length.
async function pedido(campos: Record<string, string | Blob>, metodo = 'POST', extraHeaders: Record<string, string> = {}) {
  if (metodo !== 'POST') return new Request('https://x.test/functions/v1/enviar-arquivo', { method: metodo });
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, v as never);
  const r = new Response(fd);
  const corpo = new Uint8Array(await r.arrayBuffer());
  return new Request('https://x.test/functions/v1/enviar-arquivo', { method: 'POST', body: corpo,
    headers: { 'content-type': r.headers.get('content-type')!, 'content-length': String(corpo.length), ...extraHeaders } });
}
const arquivo = (bytes: Uint8Array<ArrayBuffer>, nome: string, tipo = 'image/png') => new File([bytes], nome, { type: tipo });

describe('enviar-arquivo', () => {
  test('aceita comprovante válido: autoriza como o usuário, grava com nome aleatório e registra', async () => {
    const { d, chamadas } = deps();
    const r = await tratarEnvio(await pedido({ destino: 'comprovante', lancamento_id: LANC, origem: 'camera', arquivo: arquivo(PNG, 'cupom.png') }), d);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, id: 'c-1' });
    expect(chamadas[0]).toBe('autorizar:autorizar_comprovante');
    expect(chamadas[1]).toMatch(new RegExp(`^gravar:comprovantes:${LANC}/[0-9a-f-]{36}\\.png$`));
    expect(chamadas[1]).not.toContain('cupom');
    expect(chamadas[2]).toBe('registrar:registrar_comprovante');
  });

  test('rejeita executável disfarçado de PDF sem gravar nada', async () => {
    const { d, chamadas } = deps();
    const r = await tratarEnvio(await pedido({ destino: 'comprovante', lancamento_id: LANC, origem: 'pdf', arquivo: arquivo(EXE, 'nota.pdf', 'application/pdf') }), d);
    expect(r.status).toBe(422);
    expect(chamadas.some((c) => c.startsWith('gravar'))).toBe(false);
  });

  test('sem permissão: não grava e devolve o código do banco', async () => {
    const { d, chamadas } = deps({ autorizar: async () => ({ erro: 'sem_permissao' }) });
    const r = await tratarEnvio(await pedido({ destino: 'comprovante', lancamento_id: LANC, origem: 'camera', arquivo: arquivo(PNG, 'a.png') }), d);
    expect(r.status).toBe(403);
    expect((await r.json()).erro).toBe('sem_permissao');
    expect(chamadas.some((c) => c.startsWith('gravar'))).toBe(false);
  });

  test('destino fora da lista fixa é recusado', async () => {
    const { d } = deps();
    const r = await tratarEnvio(await pedido({ destino: '../../auth', arquivo: arquivo(PNG, 'a.png') }), d);
    expect(r.status).toBe(400);
  });

  test('id de lançamento malformado é recusado antes de autorizar', async () => {
    const { d, chamadas } = deps();
    const r = await tratarEnvio(await pedido({ destino: 'comprovante', lancamento_id: '1 or 1=1', origem: 'camera', arquivo: arquivo(PNG, 'a.png') }), d);
    expect(r.status).toBe(400);
    expect(chamadas).toEqual([]);
  });

  test('campos extras no formulário são recusados', async () => {
    const { d } = deps();
    const r = await tratarEnvio(await pedido({ destino: 'comprovante', lancamento_id: LANC, origem: 'camera', arquivo: arquivo(PNG, 'a.png'), criado_por: 'outro' }), d);
    expect(r.status).toBe(400);
  });

  test('arquivo acima do limite é recusado pelo tamanho declarado', async () => {
    const { d } = deps();
    const r = await tratarEnvio(await pedido({ destino: 'comprovante', lancamento_id: LANC, origem: 'camera', arquivo: arquivo(PNG, 'a.png') }, 'POST', { 'content-length': String(60 * 1024 * 1024) }), d);
    expect(r.status).toBe(413);
  });

  test('pedido sem content-length é recusado antes de ler o corpo', async () => {
    const { d, chamadas } = deps();
    const corpo = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('x')); c.close(); } });
    const req = new Request('https://x.test/functions/v1/enviar-arquivo', { method: 'POST', body: corpo, duplex: 'half' } as RequestInit);
    expect((await tratarEnvio(req, d)).status).toBe(411);
    expect(chamadas).toEqual([]);
  });

  test('método diferente de POST é recusado', async () => {
    const { d } = deps();
    expect((await tratarEnvio(await pedido({}, 'GET'), d)).status).toBe(405);
  });

  test('se o registro falhar, o arquivo gravado é removido (sem órfãos)', async () => {
    const { d, chamadas } = deps({ registrar: async () => ({ erro: 'invalido', campo: 'mime' }) });
    const r = await tratarEnvio(await pedido({ destino: 'comprovante', lancamento_id: LANC, origem: 'camera', arquivo: arquivo(PNG, 'a.png') }), d);
    expect(r.status).toBe(422);
    expect(chamadas.some((c) => c.startsWith('remover:comprovantes:'))).toBe(true);
  });

  test('erro inesperado vira mensagem genérica com requestId, sem detalhes internos', async () => {
    const { d } = deps({ gravar: async () => { throw new Error('connection to db at 10.0.0.5 failed: senha=xyz'); } });
    const r = await tratarEnvio(await pedido({ destino: 'comprovante', lancamento_id: LANC, origem: 'camera', arquivo: arquivo(PNG, 'a.png') }), d);
    expect(r.status).toBe(500);
    const corpo = await r.json();
    expect(corpo.erro).toBe('falha_interna');
    expect(corpo.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(corpo)).not.toMatch(/10\.0\.0\.5|senha/);
  });

  test('arquivo do contador vai para a pasta da competência com o nome original saneado', async () => {
    const regs: unknown[] = [];
    const { d, chamadas } = deps({ registrar: async (_fn, p) => { regs.push(p); return { ok: true, id: 'a-1' }; } });
    const csv = new TextEncoder().encode('data;valor\n2026-09-01;10,00\n');
    const r = await tratarEnvio(await pedido({ destino: 'contador', competencia: '2026-09-01', tipo: 'balancete',
      arquivo: arquivo(csv, '../balancete<setembro>.csv', 'text/csv') }), d);
    expect(r.status).toBe(200);
    expect(chamadas[0]).toBe('autorizar:autorizar_arquivo_contador');
    expect(chamadas[1]).toMatch(/^gravar:contador:2026-09\/[0-9a-f-]{36}\.csv$/);
    expect((regs[0] as { nome_original: string }).nome_original).not.toMatch(/[<>/\\]/);
  });

  test('competência inválida do contador é recusada', async () => {
    const { d } = deps();
    const csv = new TextEncoder().encode('a;b\n');
    const r = await tratarEnvio(await pedido({ destino: 'contador', competencia: '2026-09-15', tipo: 'balancete', arquivo: arquivo(csv, 'a.csv', 'text/csv') }), d);
    expect(r.status).toBe(400);
  });
});

describe('enviar-arquivo · documentos (Fase 4)', () => {
  const DOC = '5f4dcc3b-5aa7-465d-8a2b-9c0e1f2a3b4c';
  test('laudo de saúde vai para o bucket "saude", autorizado como o usuário', async () => {
    const { d, chamadas } = deps();
    const r = await tratarEnvio(await pedido({ destino: 'documento', area: 'saude', documento_id: DOC, arquivo: arquivo(PNG, 'laudo.png') }), d);
    expect(r.status).toBe(200);
    expect(chamadas[0]).toBe('autorizar:autorizar_documento');
    expect(chamadas[1]).toMatch(new RegExp(`^gravar:saude:${DOC}/[0-9a-f-]{36}\\.png$`));
    expect(chamadas[2]).toBe('registrar:registrar_documento');
  });
  test('foto da contrapartida (Fase 5) vai para o bucket "captacao"', async () => {
    const { d, chamadas } = deps();
    expect((await tratarEnvio(await pedido({ destino: 'documento', area: 'contrapartida', documento_id: DOC, arquivo: arquivo(PNG, 'entrega.png') }), d)).status).toBe(200);
    expect(chamadas[1]).toMatch(new RegExp(`^gravar:captacao:${DOC}/`));
  });
  test('foto 3x4 do atleta vai para "pessoas" e PDF é recusado antes de qualquer chamada', async () => {
    const { d, chamadas } = deps();
    expect((await tratarEnvio(await pedido({ destino: 'documento', area: 'foto_pessoa', documento_id: DOC, arquivo: arquivo(PNG, 'foto.png') }), d)).status).toBe(200);
    expect(chamadas[1]).toMatch(new RegExp(`^gravar:pessoas:${DOC}/[0-9a-f-]{36}\\.png$`));
    const outro = deps();
    const pdf = new TextEncoder().encode('%PDF-1.4\n%fim');
    expect((await tratarEnvio(await pedido({ destino: 'documento', area: 'foto_pessoa', documento_id: DOC, arquivo: arquivo(pdf, 'foto.pdf', 'application/pdf') }), outro.d)).status).toBe(422);
    expect(outro.chamadas).toEqual([]);
  });
  test('área com nome herdado do objeto (constructor, toString, __proto__) é recusada antes do banco', async () => {
    for (const area of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const { d, chamadas } = deps();
      expect((await tratarEnvio(await pedido({ destino: 'documento', area, documento_id: DOC, arquivo: arquivo(PNG, 'a.png') }), d)).status).toBe(400);
      expect(chamadas).toEqual([]);
    }
  });
  test('área fora da lista, id inválido, campo extra e arquivo que não é foto/PDF são recusados', async () => {
    const { d, chamadas } = deps();
    expect((await tratarEnvio(await pedido({ destino: 'documento', area: 'comprovantes', documento_id: DOC, arquivo: arquivo(PNG, 'a.png') }), d)).status).toBe(400);
    expect((await tratarEnvio(await pedido({ destino: 'documento', area: 'saude', documento_id: '../x', arquivo: arquivo(PNG, 'a.png') }), d)).status).toBe(400);
    expect((await tratarEnvio(await pedido({ destino: 'documento', area: 'saude', documento_id: DOC, lancamento_id: DOC, arquivo: arquivo(PNG, 'a.png') }), d)).status).toBe(400);
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
    expect((await tratarEnvio(await pedido({ destino: 'documento', area: 'pessoa', documento_id: DOC, arquivo: arquivo(html, 'a.pdf', 'application/pdf') }), d)).status).toBe(422);
    expect(chamadas).toEqual([]);
  });
  test('banco recusa (sem consentimento): nada é gravado', async () => {
    const { d, chamadas } = deps({ autorizar: async () => ({ erro: 'sem_consentimento' }) });
    const r = await tratarEnvio(await pedido({ destino: 'documento', area: 'saude', documento_id: DOC, arquivo: arquivo(PNG, 'a.png') }), d);
    expect(r.status).toBe(422);
    expect(chamadas.some((c) => c.startsWith('gravar'))).toBe(false);
  });
});
