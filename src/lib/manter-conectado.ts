// "Manter conectado": marca com a data-limite (30 dias). Sem a marca, ou vencida, a sessão vive só na aba.
const MARCA = 'erp.manter-ate';
const TRINTA_DIAS = 30 * 86_400_000;
export function lembrado(agora = Date.now()): boolean {
  try { return Number(localStorage.getItem(MARCA)) > agora; } catch { return false; }
}
export function definirLembrar(sim: boolean) {
  try {
    if (sim) localStorage.setItem(MARCA, String(Date.now() + TRINTA_DIAS));
    else { localStorage.removeItem(MARCA); localStorage.removeItem('erp.sessao'); localStorage.removeItem('erp.sessao-code-verifier'); }
  } catch { /* sem storage: fica só na aba */ }
}
