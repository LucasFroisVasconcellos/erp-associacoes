// Quem confere de verdade é o servidor (setSession → getUser).

export type LinkEmail =
  | { tipo: 'sessao'; acesso: string; renovacao: string; fluxo: 'invite' | 'recovery' }
  | { tipo: 'erro'; fluxo: 'invite' | 'recovery' }
  | null;

const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const RENOVACAO = /^[A-Za-z0-9_-]{8,200}$/;

export function lerLinkEmail(fragmento: string): LinkEmail {
  if (!fragmento || fragmento.length > 8000) return null;
  // pega o pedaço depois do ÚLTIMO '#' que tem parâmetros de sessão ou de erro
  const partes = fragmento.split('#').filter(Boolean);
  const bruto = [...partes].reverse().find((p) => /(^|&)(access_token|error|error_code)=/.test(p));
  if (!bruto) return null;
  const q = new URLSearchParams(bruto.replace(/^[^?]*\?/, (m) => (m.includes('=') ? m : '')));
  const fluxo = q.get('type') === 'recovery' ? 'recovery' : 'invite';
  if (q.get('error') || q.get('error_code')) return { tipo: 'erro', fluxo };
  const acesso = q.get('access_token') ?? '';
  const renovacao = q.get('refresh_token') ?? '';
  const tipo = q.get('type');
  if (tipo !== 'invite' && tipo !== 'recovery') return null;
  if (!JWT.test(acesso) || acesso.length > 4000 || !RENOVACAO.test(renovacao)) return { tipo: 'erro', fluxo };
  return { tipo: 'sessao', acesso, renovacao, fluxo };
}

// Guardado só em memória entre o início do app e a tela do link (nunca em storage nem no endereço).
let pendente: LinkEmail = null;
export const guardarLinkEmail = (l: LinkEmail) => { pendente = l; };
export const retirarLinkEmail = (): LinkEmail => { const l = pendente; pendente = null; return l; };
