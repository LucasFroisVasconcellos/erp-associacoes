// Testes da lógica da Edge Function "enviar-emails" (sem Deno nem SMTP: dependências injetadas).
import { describe, expect, test } from 'vitest';
import { type DepsEmails, type EmailDaFila, montarTexto, tratarEmails } from './emails';

const post = () => new Request('https://x.test/functions/v1/enviar-emails', { method: 'POST' });
const email = (i: number, extra: Partial<EmailDaFila> = {}): EmailDaFila => ({ id: `e-${i}`, para: `pessoa${i}@exemplo.test`, assunto: `Assunto ${i}`, corpo: 'Corpo', ...extra });

function deps(lotes: EmailDaFila[][], over: Partial<DepsEmails> = {}) {
  const marcados: [string, boolean, string | null][] = [];
  const enviados: { para: string; assunto: string; texto: string }[] = [];
  let i = 0;
  const d: DepsEmails = {
    origemApp: 'https://seu-projeto.pages.dev',
    pegar: async () => ({ ok: true, emails: lotes[i++] ?? [] }),
    marcar: async (id, ok, erro) => { marcados.push([id, ok, erro]); },
    enviar: async (m) => { enviados.push(m); },
    ...over,
  };
  return { d, marcados, enviados };
}

describe('enviar-emails', () => {
  test('envia em texto puro, com o link do sistema, e marca cada um', async () => {
    const { d, marcados, enviados } = deps([[email(1), email(2)]]);
    const r = await tratarEmails(post(), d);
    expect(await r.json()).toEqual({ ok: true, enviados: 2, falhas: 0 });
    expect(enviados[0]!.texto).toBe(montarTexto('Corpo', 'https://seu-projeto.pages.dev'));
    expect(marcados).toEqual([['e-1', true, null], ['e-2', true, null]]);
  });

  test('só aceita POST', async () => {
    const { d } = deps([]);
    expect((await tratarEmails(new Request('https://x.test', { method: 'GET' }), d)).status).toBe(405);
  });

  test('falha de um e-mail não para os outros; só o código do erro é gravado (nunca a mensagem)', async () => {
    const erro = Object.assign(new Error('550 mailbox pessoa1@exemplo.test unavailable'), { code: 'EENVELOPE' });
    const { d, marcados } = deps([[email(1), email(2)]], {
      enviar: async (m) => { if (m.para.startsWith('pessoa1')) throw erro; },
    });
    const r = await tratarEmails(post(), d);
    expect(await r.json()).toEqual({ ok: true, enviados: 1, falhas: 1 });
    expect(marcados).toContainEqual(['e-1', false, 'EENVELOPE']);
    expect(JSON.stringify(marcados)).not.toContain('@');
  });

  test('assunto com quebra de linha ou endereço estranho não vai para o SMTP (injeção de cabeçalho)', async () => {
    const { d, marcados, enviados } = deps([[email(1, { assunto: 'Oi\r\nBcc: todos@x.test' }), email(2, { para: 'x@y.test\r\nBcc: z@w.test' }), email(3)]]);
    await tratarEmails(post(), d);
    expect(enviados.map((e) => e.para)).toEqual(['pessoa3@exemplo.test']);
    expect(marcados.filter((m) => m[2] === 'dados_invalidos')).toHaveLength(2);
  });

  test('lote cheio pede o próximo; para em 5 lotes ou no prazo', async () => {
    const cheio = (n: number) => Array.from({ length: 20 }, (_, k) => email(n * 100 + k));
    const { d, enviados } = deps([cheio(1), cheio(2), cheio(3), cheio(4), cheio(5), cheio(6)]);
    await tratarEmails(post(), d);
    expect(enviados).toHaveLength(100);
    let t = 0;
    const lento = deps([cheio(1), cheio(2), cheio(3)], { agora: () => (t += 10_000), prazoMs: 25_000 });
    await tratarEmails(post(), lento.d);
    expect(lento.enviados.length).toBeLessThan(60);
  });

  test('erro ao pegar a fila: resposta genérica com requestId, sem detalhe', async () => {
    const { d } = deps([], { pegar: async () => ({ erro: 'permission denied for table fila_emails' }) });
    const r = await tratarEmails(post(), d);
    expect(r.status).toBe(500);
    const corpo = await r.json();
    expect(corpo.erro).toBe('falha_interna');
    expect(JSON.stringify(corpo)).not.toContain('fila_emails');
  });
});
