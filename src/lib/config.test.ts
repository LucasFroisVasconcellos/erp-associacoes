import { describe, expect, test } from 'vitest';
import { validarChaveCaptcha, validarConfig, interpretar } from './config';
import { ErroApp, erroDeAuth, erroVisivelNaRecuperacao } from './erros';

const jwt = (payload: object) => `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.x`;

describe('configuração do Supabase no navegador', () => {
  test('aceita URL https e chave publicável', () => {
    expect(validarConfig({ VITE_SUPABASE_URL: 'https://abcd.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_123' }))
      .toEqual({ url: 'https://abcd.supabase.co', chave: 'sb_publishable_123', captcha: null });
    expect(() => validarConfig({ VITE_SUPABASE_URL: 'https://abcd.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ role: 'anon' }) })).not.toThrow();
  });
  test('recusa chave secreta ou service_role (nunca no frontend)', () => {
    expect(() => validarConfig({ VITE_SUPABASE_URL: 'https://a.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc' })).toThrow(/secreta/);
    expect(() => validarConfig({ VITE_SUPABASE_URL: 'https://a.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ role: 'service_role' }) })).toThrow(/secreta/);
  });
  test('recusa URL sem https ou ausente', () => {
    expect(() => validarConfig({ VITE_SUPABASE_URL: 'http://a.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_1' })).toThrow(/https/);
    expect(() => validarConfig({})).toThrow();
  });
});

describe('interpretar a resposta de uma RPC', () => {
  test('ok devolve os dados', () => {
    expect(interpretar({ ok: true, id: 'x' }, null)).toEqual({ ok: true, id: 'x' });
  });
  test('{erro} vira ErroApp com o código', () => {
    try { interpretar({ erro: 'mes_fechado' }, null); throw new Error('não lançou'); }
    catch (e) { expect(e).toBeInstanceOf(ErroApp); expect((e as ErroApp).detalhe.erro).toBe('mes_fechado'); }
  });
  test('recusa de tipo do Postgres (caractere nulo, sintaxe) vira "invalido", não erro genérico', () => {
    for (const code of ['22P05', '22P02', '22007', '22008', '22003']) {
      try { interpretar(null, { message: 'x', code }); throw new Error('não lançou'); }
      catch (e) { expect((e as ErroApp).detalhe.erro).toBe('invalido'); }
    }
  });
  test('falha de rede vira "rede"; falha do PostgREST vira genérica, sem texto técnico', () => {
    expect(() => interpretar(null, { message: 'Failed to fetch' })).toThrow(/conexão/);
    try { interpretar(null, { message: 'permission denied for table x', code: '42501' }); }
    catch (e) { expect((e as Error).message).not.toMatch(/permission denied|table/); }
  });
});

describe('chave pública do CAPTCHA (Turnstile)', () => {
  const base = { VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' };
  test('sem chave: CAPTCHA desligado', () => {
    expect(validarConfig(base).captcha).toBeNull();
    expect(validarConfig({ ...base, VITE_TURNSTILE_SITEKEY: '  ' }).captcha).toBeNull();
  });
  test('chave pública válida (inclusive a de teste do Cloudflare)', () => {
    expect(validarConfig({ ...base, VITE_TURNSTILE_SITEKEY: '0x4AAAAAAABkMYinukE8nzY' }).captcha).toBe('0x4AAAAAAABkMYinukE8nzY');
    expect(validarConfig({ ...base, VITE_TURNSTILE_SITEKEY: '1x00000000000000000000AA' }).captcha).toBe('1x00000000000000000000AA');
  });
  test('chave SECRETA colada por engano: o site não sobe', () => {
    expect(() => validarConfig({ ...base, VITE_TURNSTILE_SITEKEY: '1x0000000000000000000000000000000AA' })).toThrow(/SECRETA/);
    expect(() => validarConfig({ ...base, VITE_TURNSTILE_SITEKEY: '0x4AAAAAAABkMYinukE8nzYbkKzQ9sQn3Xh' })).toThrow(/SECRETA/);
  });
  test('valor estranho: o site não sobe', () => {
    for (const v of ['abc', 'x0123', '<script>', '0x4AAA']) expect(() => validarChaveCaptcha(v), v).toThrow();
  });
});

describe('erros do login (Supabase Auth)', () => {
  test('falha de CAPTCHA não vira "senha errada"', () => {
    expect(erroDeAuth({ status: 400, code: 'captcha_failed', message: 'captcha protection: request disallowed' }).detalhe.erro).toBe('captcha');
  });
  test('senha errada e conta inexistente dão a mesma mensagem', () => {
    expect(erroDeAuth({ status: 400, code: 'invalid_credentials' }).detalhe.erro).toBe('credenciais');
    expect(erroDeAuth({ status: 400 }).detalhe.erro).toBe('credenciais');
  });
  test('limite e rede', () => {
    expect(erroDeAuth({ status: 429 }).detalhe.erro).toBe('limite');
    expect(erroDeAuth({ status: 429, code: 'over_request_rate_limit' }).detalhe.erro).toBe('limite');
    expect(erroDeAuth({ status: 429, code: 'over_email_send_rate_limit' }).detalhe.erro).toBe('limite_conta');
    expect(erroDeAuth({ message: 'Failed to fetch' }).detalhe.erro).toBe('rede');
    expect(erroDeAuth({ status: 500, code: 'unexpected_failure' }).detalhe.erro).toBe('falha_interna');
  });
});

describe('recuperação de senha não revela se a conta existe', () => {
  test('aparecem só erros que não dependem da conta', () => {
    for (const e of ['captcha', 'limite', 'rede']) expect(erroVisivelNaRecuperacao(new ErroApp({ erro: e })), e).toBe(true);
  });
  test('limite por e-mail, credenciais e falha de envio ficam escondidos (mesma resposta de sucesso)', () => {
    const limiteDaConta = erroDeAuth({ status: 429, code: 'over_email_send_rate_limit' }); // só acontece para conta existente
    expect(erroVisivelNaRecuperacao(limiteDaConta)).toBe(false);
    for (const e of ['credenciais', 'falha_interna']) expect(erroVisivelNaRecuperacao(new ErroApp({ erro: e })), e).toBe(false);
    expect(erroVisivelNaRecuperacao(new Error('qualquer'))).toBe(false);
  });
});
