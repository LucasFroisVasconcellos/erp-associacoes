import { useQuery } from '@tanstack/react-query';
import { CalendarDays, FileText, Gavel, ListChecks, Search, User, Wallet, type LucideIcon } from 'lucide-react';
import { createContext, useContext, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { fonte } from '@/dados/fonte';
import { formatarData } from '@/lib/datas';
import { formatarBRL } from '@/lib/dinheiro';

type Tipo = 'lancamento' | 'pessoa' | 'tarefa' | 'evento' | 'documento' | 'reuniao';
interface Resultado { tipo: Tipo; id: string; titulo: string; detalhe: string | null; data: string | null }

const TIPOS: Record<Tipo, { nome: string; icone: LucideIcon; rota: (id: string) => string }> = {
  lancamento: { nome: 'Lançamentos', icone: Wallet, rota: (id) => `/dinheiro/lancamento/${id}` },
  pessoa: { nome: 'Pessoas', icone: User, rota: (id) => `/pessoas/${id}` },
  tarefa: { nome: 'Tarefas', icone: ListChecks, rota: (id) => `/tarefas/${id}` },
  evento: { nome: 'Agenda', icone: CalendarDays, rota: () => '/agenda' },
  documento: { nome: 'Documentos', icone: FileText, rota: () => '/documentos/governanca' },
  reuniao: { nome: 'Reuniões', icone: Gavel, rota: (id) => `/documentos/reunioes/${id}` },
};

function detalhe(r: Resultado) {
  if (r.tipo === 'lancamento' && r.detalhe) { const [t, v] = r.detalhe.split('|'); return `${t === 'saida' ? 'Saída' : 'Entrada'} ${formatarBRL(v)}${r.data ? ` · ${formatarData(r.data)}` : ''}`; }
  if (r.tipo === 'pessoa') return r.detalhe === 'atleta' ? 'Atleta' : 'Associado';
  return r.data ? formatarData(r.data) : '';
}

const Ctx = createContext<{ abrir: () => void }>({ abrir: () => {} });
export const useBusca = () => useContext(Ctx);

export function ProvedorBusca({ children }: { children: ReactNode }) {
  const [aberta, setAberta] = useState(false);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setAberta((x) => !x); } };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, []);
  const valor = useMemo(() => ({ abrir: () => setAberta(true) }), []);
  return <Ctx.Provider value={valor}>{children}{aberta && <CaixaBusca aoFechar={() => setAberta(false)} />}</Ctx.Provider>;
}

function CaixaBusca({ aoFechar }: { aoFechar: () => void }) {
  const navegar = useNavigate();
  const [texto, setTexto] = useState('');
  const termo = useDeferredValue(texto.trim());
  const [atrasado, setAtrasado] = useState('');
  useEffect(() => { const t = setTimeout(() => setAtrasado(termo), 250); return () => clearTimeout(t); }, [termo]);
  const r = useQuery({
    queryKey: ['busca', atrasado], enabled: atrasado.length >= 2 && atrasado.length <= 60, staleTime: 30_000,
    queryFn: () => fonte().rpc<{ resultados: Resultado[] }>('busca_global', { p_termo: atrasado }),
  });
  const porTipo = (Object.keys(TIPOS) as Tipo[]).map((t) => [t, (r.data?.resultados ?? []).filter((x) => x.tipo === t)] as const).filter(([, l]) => l.length);
  return (
    <CommandDialog open onOpenChange={(v) => !v && aoFechar()} title="Buscar no sistema" description="Lançamentos, pessoas, tarefas, agenda e documentos">
      <Command shouldFilter={false}>
        <CommandInput placeholder="Buscar lançamento, pessoa, tarefa…" value={texto} onValueChange={setTexto} maxLength={60} />
        <CommandList>
          {atrasado.length < 2 ? <p className="text-muted-foreground px-4 py-6 text-center text-[15px]">Digite pelo menos 2 letras.</p>
            : r.isFetching && !r.data ? <p className="flex justify-center py-6"><Spinner /></p>
              : <CommandEmpty>Nada encontrado para “{atrasado}”.</CommandEmpty>}
          {porTipo.map(([t, lista]) => {
            const T = TIPOS[t];
            return (
              <CommandGroup key={t} heading={T.nome}>
                {lista.map((x) => (
                  <CommandItem key={x.id} value={`${t}-${x.id}`} onSelect={() => { aoFechar(); void navegar(T.rota(x.id)); }} className="gap-3 py-2.5">
                    <T.icone aria-hidden="true" className="text-muted-foreground size-5" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-[15px]">{x.titulo}</span>
                      {detalhe(x) && <span className="text-muted-foreground block truncate text-[13px]">{detalhe(x)}</span>}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          })}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

export function BotaoBusca({ className }: { className?: string }) {
  const { abrir } = useBusca();
  return <Button variant="ghost" size="icon" aria-label="Buscar" className={className} onClick={abrir}><Search aria-hidden="true" /></Button>;
}
