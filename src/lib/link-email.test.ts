import { describe, expect, test } from 'vitest';
import { lerLinkEmail } from './link-email';

const AT = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
describe('lerLinkEmail (link padrão do e-mail do Supabase)', () => {
  test('convite e recuperação com a sessão no fragmento', () => {
    expect(lerLinkEmail(`#access_token=${AT}&expires_in=3600&refresh_token=abcdEFGH1234&token_type=bearer&type=invite`))
      .toEqual({ tipo: 'sessao', acesso: AT, renovacao: 'abcdEFGH1234', fluxo: 'invite' });
    expect(lerLinkEmail(`#/entrar/link#access_token=${AT}&refresh_token=abcdEFGH1234&type=recovery`))
      .toMatchObject({ tipo: 'sessao', fluxo: 'recovery' });
  });
  test('link vencido ou já usado vira erro (sem quebrar)', () => {
    expect(lerLinkEmail('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid')).toEqual({ tipo: 'erro', fluxo: 'invite' });
  });
  test('rotas normais, outros tipos e lixo: ignorados ou recusados', () => {
    expect(lerLinkEmail('#/dinheiro')).toBeNull();
    expect(lerLinkEmail('')).toBeNull();
    expect(lerLinkEmail(`#access_token=${AT}&refresh_token=abcdEFGH1234&type=magiclink`)).toBeNull();
    expect(lerLinkEmail('#access_token=<script>&refresh_token=x&type=invite')).toEqual({ tipo: 'erro', fluxo: 'invite' });
    expect(lerLinkEmail('#access_token=' + 'a'.repeat(9000))).toBeNull();
  });
});
