// Precisa rodar ANTES do roteador ler o endereço: tira a sessão do fragmento (link padrão do e-mail
// do Supabase), guarda só em memória e leva para a tela do link. Importado primeiro no main.tsx.
import { guardarLinkEmail, lerLinkEmail } from './link-email';

const link = lerLinkEmail(location.hash);
if (link) {
  guardarLinkEmail(link);
  history.replaceState(null, '', `${location.pathname}#/entrar/link?padrao=1&type=${link.fluxo}`);
}
