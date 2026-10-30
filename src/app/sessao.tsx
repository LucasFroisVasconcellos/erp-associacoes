import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { fonte } from '@/dados/fonte';
import type { Perfil } from '@/dados/tipos';
import { apagarTodosRascunhos } from '@/lib/comprovante';
import { ErroApp } from '@/lib/erros';
import { geracao } from '@/lib/geracao';

export type EstadoSessao =
  | { tipo: 'carregando' }
  | { tipo: 'fora' }
  | { tipo: 'cadastrar_2fa'; email: string }
  | { tipo: 'precisa_2fa'; email: string; fatorId: string }
  | { tipo: 'sem_acesso'; email: string }
  | { tipo: 'dentro'; perfil: Perfil };

interface ContextoSessao {
  estado: EstadoSessao;
  perfil: Perfil | null;
  atualizar: () => Promise<void>;
  sair: (motivo?: string, todos?: boolean) => Promise<void>;
}

const Ctx = createContext<ContextoSessao | null>(null);
const INATIVIDADE_MS = 30 * 60 * 1000;

export function ProvedorSessao({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [estado, setEstado] = useState<EstadoSessao>({ tipo: 'carregando' });
  const usuarioAtual = useRef<string | null>(null);
  const pedido = useRef(0);

  const limpar = useCallback(() => { geracao.avancar(); qc.clear(); }, [qc]);

  const atualizar = useCallback(async () => {
    const meu = ++pedido.current;
    try {
      const s = await fonte().sessao();
      if (meu !== pedido.current) return;
      if (!s) {
        if (usuarioAtual.current) limpar();
        usuarioAtual.current = null;
        setEstado({ tipo: 'fora' });
        return;
      }
      if (usuarioAtual.current && usuarioAtual.current !== s.usuarioId) limpar();
      usuarioAtual.current = s.usuarioId;
      if (s.aal !== 'aal2') {
        await fonte().rpc('aceitar_convite').catch(() => undefined);
        const fatores = await fonte().fatores();
        if (meu !== pedido.current) return;
        const ok = fatores.find((f) => f.status === 'verified');
        setEstado(ok ? { tipo: 'precisa_2fa', email: s.email, fatorId: ok.id } : { tipo: 'cadastrar_2fa', email: s.email });
        return;
      }
      const perfil = await fonte().rpc<Perfil & { ok: boolean }>('meu_perfil');
      if (meu !== pedido.current) return;
      setEstado({ tipo: 'dentro', perfil });
    } catch (e) {
      if (meu !== pedido.current) return;
      if (e instanceof ErroApp && e.detalhe.erro === 'sessao_expirada') { await fonte().sair().catch(() => undefined); setEstado({ tipo: 'fora' }); toast.info(e.message); return; }
      if (e instanceof ErroApp && e.detalhe.erro === 'sem_acesso') {
        setEstado({ tipo: 'sem_acesso', email: (await fonte().sessao())?.email ?? '' });
        return;
      }
      if ((e as Error).name === 'RespostaObsoleta') return;
      setEstado({ tipo: 'fora' });
      toast.error(e instanceof ErroApp ? e.message : 'Não foi possível verificar sua sessão. Entre de novo.');
    }
  }, [limpar]);

  const sair = useCallback(async (motivo?: string, todos = false) => {
    // Saída pela pessoa apaga os rascunhos do aparelho (podem ter fotos de comprovantes);
    // a saída por inatividade preserva o que foi feito sem internet.
    if (!motivo) await apagarTodosRascunhos();
    limpar();
    usuarioAtual.current = null;
    let falhouTodos = false;
    await fonte().sair(todos).catch(() => { falhouTodos = todos; });
    setEstado({ tipo: 'fora' });
    if (falhouTodos) toast.error('Você saiu deste aparelho, mas não deu para encerrar os outros agora. Entre e tente de novo.');
    else if (todos) toast.success('Você saiu de todos os aparelhos.');
    if (motivo) toast.info(motivo);
  }, [limpar]);

  useEffect(() => {
    void atualizar();
    return fonte().aoMudarSessao(() => { void atualizar(); });
  }, [atualizar]);

  // 30 min sem uso encerra a sessão, menos com "manter conectado" (até 30 dias, conferido no banco).
  useEffect(() => {
    if (estado.tipo !== 'dentro' || fonte().lembrado()) return;
    let t = window.setTimeout(() => void sair('Sua sessão foi encerrada depois de 30 minutos sem uso.'), INATIVIDADE_MS);
    const reiniciar = () => { window.clearTimeout(t); t = window.setTimeout(() => void sair('Sua sessão foi encerrada depois de 30 minutos sem uso.'), INATIVIDADE_MS); };
    const eventos = ['pointerdown', 'keydown', 'scroll', 'visibilitychange'] as const;
    eventos.forEach((ev) => window.addEventListener(ev, reiniciar, { passive: true }));
    return () => { window.clearTimeout(t); eventos.forEach((ev) => window.removeEventListener(ev, reiniciar)); };
  }, [estado.tipo, sair]);

  const valor = useMemo(() => ({ estado, perfil: estado.tipo === 'dentro' ? estado.perfil : null, atualizar, sair }), [estado, atualizar, sair]);
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useSessao() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSessao fora do ProvedorSessao');
  return c;
}

export function usePerfil(): Perfil {
  const { perfil } = useSessao();
  if (!perfil) throw new Error('perfil indisponível');
  return perfil;
}
