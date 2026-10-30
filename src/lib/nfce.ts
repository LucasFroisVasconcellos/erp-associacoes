// Só aceita https em domínio .gov.br de fazenda/sefaz; nada de abrir link arbitrário.

export function chaveAcessoValida(chave: string): boolean {
  if (!/^\d{44}$/.test(chave)) return false;
  let soma = 0;
  let peso = 2;
  for (let i = 42; i >= 0; i--) {
    soma += Number(chave[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const r = soma % 11;
  return (r < 2 ? 0 : 11 - r) === Number(chave[43]);
}

export function hostSefazConfiavel(host: string): boolean {
  const h = host.toLowerCase();
  return h.endsWith('.gov.br') && /(^|\.)(fazenda|sefaz|sef|nfce|nfe|sefa|sefin)[a-z]*\./.test(h);
}

export type QrNfce = { ok: true; chave: string; url: string; uf: string } | { ok: false; erro: string };

export function lerQrNfce(texto: string): QrNfce {
  let url: URL;
  try { url = new URL(texto.trim()); } catch { return { ok: false, erro: 'nao_e_link' }; }
  if (url.protocol !== 'https:') return { ok: false, erro: 'link_inseguro' };
  if (!hostSefazConfiavel(url.hostname)) return { ok: false, erro: 'dominio' };
  const p = url.searchParams.get('p') ?? url.searchParams.get('chNFe') ?? '';
  const chave = p.split('|')[0] ?? '';
  if (!chaveAcessoValida(chave)) return { ok: false, erro: 'chave' };
  return { ok: true, chave, url: url.toString(), uf: chave.slice(0, 2) };
}
