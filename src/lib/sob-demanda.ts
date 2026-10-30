// Import que falha porque o site foi atualizado com a aba aberta: recarrega UMA vez; falhou de novo, o erro segue.

export interface DepsRecarga {
  ler(): string | null;
  gravar(v: string | null): void;
  recarregar(): void;
}

export const CHAVE_RECARGA = 'erp.recarregou-versao';

export function depsNavegador(): DepsRecarga {
  return {
    ler: () => { try { return sessionStorage.getItem(CHAVE_RECARGA); } catch { return '1'; } }, // sem storage: não arrisca laço
    gravar: (v) => { try { if (v === null) sessionStorage.removeItem(CHAVE_RECARGA); else sessionStorage.setItem(CHAVE_RECARGA, v); } catch { /* sem storage */ } },
    recarregar: () => location.reload(),
  };
}

export async function carregarComRecarga<M>(importar: () => Promise<M>, deps: DepsRecarga): Promise<M> {
  try {
    const m = await importar();
    deps.gravar(null);
    return m;
  } catch (e) {
    if (deps.ler() === '1') throw e;
    deps.gravar('1');
    deps.recarregar();
    return new Promise<never>(() => {});
  }
}
