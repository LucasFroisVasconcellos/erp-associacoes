import { ErroApp, type ProblemaLinha } from './erros';
import { validarChaveCaptcha } from './chave-captcha';

export { validarChaveCaptcha };

export interface Config { url: string; chave: string; captcha: string | null }

function papelDoJwt(chave: string): string | null {
  const partes = chave.split('.');
  if (partes.length !== 3) return null;
  try {
    const json = JSON.parse(atob(partes[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.role === 'string' ? json.role : null;
  } catch { return null; }
}

/**
 * Falha FECHADA: sem URL https ou com chave secreta, o sistema não inicia.
 * (A chave publicável é pública por natureza; a proteção dos dados está na RLS.)
 */
export function validarConfig(env: Record<string, string | undefined>): Config {
  const url = env.VITE_SUPABASE_URL?.trim();
  const chave = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(url)) throw new Error('VITE_SUPABASE_URL precisa ser um endereço https do projeto Supabase.');
  if (!chave) throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY não foi definida.');
  if (chave.startsWith('sb_secret_') || papelDoJwt(chave) === 'service_role') {
    throw new Error('A chave configurada é SECRETA. Use só a chave publicável no site e troque (revogue) a secreta no Supabase.');
  }
  if (!chave.startsWith('sb_publishable_') && papelDoJwt(chave) !== 'anon') throw new Error('A chave do Supabase não é uma chave publicável válida.');
  return { url, chave, captcha: validarChaveCaptcha(env.VITE_TURNSTILE_SITEKEY) };
}



interface ErroSupabase { message?: string; code?: string; name?: string }

export function interpretar<T>(data: unknown, error: ErroSupabase | null): T {
  if (error) {
    const msg = error.message ?? '';
    if (error.name === 'AbortError' || /abort|timeout/i.test(msg)) throw new ErroApp({ erro: 'tempo_esgotado' });
    if (/fetch|network|load failed/i.test(msg)) throw new ErroApp({ erro: 'rede' });
    if (error.code === '42501') throw new ErroApp({ erro: 'sem_permissao' });
    // o banco recusou o próprio formato do dado (caractere nulo, número/data malformados)
    if (['22P05', '22P02', '22007', '22008', '22003'].includes(error.code ?? '')) throw new ErroApp({ erro: 'invalido' });
    throw new ErroApp({ erro: 'falha_interna' });
  }
  const d = data as { erro?: string; campo?: string; problemas?: unknown } | null;
  if (d && typeof d === 'object' && typeof d.erro === 'string') {
    throw new ErroApp({ erro: d.erro, campo: d.campo, ...(Array.isArray(d.problemas) ? { problemas: (d.problemas as ProblemaLinha[]).slice(0, 50) } : {}) });
  }
  return data as T;
}
