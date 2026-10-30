import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { LogOut, Plus, Search, Settings } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useOutlet } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider,
} from '@/components/ui/sidebar';
import { fonte } from '@/dados/fonte';
import { NOME_CARGO, pode } from '@/lib/acesso';
import { FASE_ATUAL, GRUPOS, MODULOS, grupoPorRota, moduloPorRota, podeVerModulo, type InfoModulo } from '@/lib/modulos';
import { cn } from '@/lib/utils';
import { useSessao, usePerfil } from './sessao';
import { useNovoLancamento } from '@/telas/dinheiro/novo-lancamento';
import { ProvedorBusca, useBusca } from '@/components/app/busca';
import { Tutorial } from '@/components/app/ajuda';

const ABAS = GRUPOS;
const SECOES = GRUPOS.map((g) => ({ titulo: g.nome, ids: g.modulos }));
const abaAtiva = (caminho: string) => grupoPorRota(caminho).rota;

function profundidade(caminho: string) { return caminho.split('/').filter(Boolean).length; }

function visivel(m: InfoModulo, perfil: ReturnType<typeof usePerfil>) {
  return podeVerModulo(perfil, m) || m.fase > FASE_ATUAL;
}

function BarraLateral() {
  const perfil = usePerfil();
  const { sair } = useSessao();
  const { pathname } = useLocation();
  const atual = moduloPorRota(pathname)?.id;
  const novo = useNovoLancamento();
  const busca = useBusca();
  return (
    <Sidebar collapsible="none" className="sticky top-0 hidden h-svh border-r lg:flex">
      <SidebarHeader className="gap-3 px-3 pt-5">
        <div className="flex items-center gap-2.5 px-2">
          <span aria-hidden="true" className="bg-primary text-primary-foreground inline-flex size-8 items-center justify-center rounded-[9px] text-[13px] font-bold">AE</span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[15px] font-semibold">Associação Exemplo</p>
            <p className="text-muted-foreground truncate text-[12px]">Gestão da diretoria</p>
          </div>
        </div>
        <Button variant="secondary" onClick={busca.abrir} className="text-muted-foreground w-full justify-start">
          <Search data-icon="inline-start" aria-hidden="true" />Buscar
        </Button>
        {pode(perfil, 'financeiro', 'criar') && (
          <Button onClick={() => novo.abrir()} className="w-full">
            <Plus data-icon="inline-start" aria-hidden="true" />
            Novo lançamento
          </Button>
        )}
      </SidebarHeader>
      <SidebarContent className="[mask-image:linear-gradient(to_bottom,#000_calc(100%-2.5rem),transparent)] pb-6">
        {SECOES.map((s) => (
          <SidebarGroup key={s.titulo}>
            <SidebarGroupLabel className="text-[12px]">{s.titulo}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {s.ids.map((id) => MODULOS.find((m) => m.id === id)!).filter((m) => visivel(m, perfil)).map((m) => (
                  <SidebarMenuItem key={m.id}>
                    <SidebarMenuButton asChild isActive={atual === m.id}>
                      <Link to={m.rota} aria-current={atual === m.id ? 'page' : undefined}>
                        <m.icone aria-hidden="true" />
                        <span className="truncate">{m.nome}</span>
                        {m.fase > FASE_ATUAL && <Badge variant="secondary" className="ml-auto">Fase {m.fase}</Badge>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-auto w-full justify-start gap-2.5 px-2 py-2 text-left text-foreground">
              <span aria-hidden="true" className="bg-muted inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold">
                {perfil.membro.nome.split(' ').map((p) => p[0]).slice(0, 2).join('')}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">{perfil.membro.nome}</span>
                <span className="text-muted-foreground block truncate text-[12px] font-normal">{NOME_CARGO[perfil.membro.cargo]}</span>
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-60">
            <DropdownMenuLabel className="truncate">{perfil.membro.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild><Link to="/ajustes"><Settings aria-hidden="true" />Ajustes</Link></DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => void sair()}><LogOut aria-hidden="true" />Sair</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

function BarraDeAbas() {
  const { pathname } = useLocation();
  const ativa = abaAtiva(pathname);
  return (
    <nav aria-label="Principal" className="material-barra pb-seguro fixed inset-x-0 bottom-0 z-40 shadow-[0_-0.5px_0_var(--border)] lg:hidden">
      <ul className="mx-auto grid h-[52px] max-w-xl grid-cols-5">
        {ABAS.map((a) => {
          const sel = ativa === a.rota;
          return (
            <li key={a.rota} className="flex">
              <Link
                to={a.rota}
                aria-current={sel ? 'page' : undefined}
                className={cn(
                  'flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium tracking-[0.01em] transition-colors focus-visible:ring-4 focus-visible:ring-ring/35 focus-visible:ring-inset',
                  sel ? 'text-tint' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <a.icone aria-hidden="true" className="size-6 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-safe:active:scale-90" strokeWidth={sel ? 2.4 : 1.8} />
                {a.nome}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function BotaoFlutuante() {
  const perfil = usePerfil();
  const novo = useNovoLancamento();
  // some ao rolar para baixo (não cobre a lista) e volta ao rolar para cima
  const [escondido, setEscondido] = useState(false);
  useEffect(() => {
    let ultimo = window.scrollY;
    const aoRolar = () => { const y = window.scrollY; if (Math.abs(y - ultimo) > 8) { setEscondido(y > ultimo && y > 80); ultimo = y; } };
    window.addEventListener('scroll', aoRolar, { passive: true });
    return () => window.removeEventListener('scroll', aoRolar);
  }, []);
  if (!pode(perfil, 'financeiro', 'criar')) return null;
  return (
    <Button
      onClick={() => novo.abrir()}
      size="icon-lg"
      aria-label="Novo lançamento"
      tabIndex={escondido ? -1 : undefined}
      className={cn('fixed right-4 bottom-[calc(68px+env(safe-area-inset-bottom))] z-40 size-14 shadow-[0_8px_24px_rgba(0,102,204,0.35)] transition-[transform,opacity] duration-200 lg:hidden',
        escondido && 'pointer-events-none translate-y-24 opacity-0')}
    >
      <Plus aria-hidden="true" className="size-7" strokeWidth={2.5} />
    </Button>
  );
}

function SaidaAnimada() {
  const local = useLocation();
  const saida = useOutlet();
  const reduzir = useReducedMotion();
  const anterior = useRef(local.pathname);
  const direcao = useRef(0);
  if (anterior.current !== local.pathname) {
    const a = profundidade(anterior.current), b = profundidade(local.pathname);
    direcao.current = b > a ? 1 : b < a ? -1 : 0;
    anterior.current = local.pathname;
  }
  const d = reduzir ? 0 : direcao.current;
  const curva = [0.32, 0.72, 0, 1] as const;
  return (
    <AnimatePresence mode="popLayout" initial={false} custom={d}>
      <motion.div
        key={local.pathname}
        custom={d}
        variants={{
          entra: (dir: number) => (dir === 0 ? { opacity: 0 } : { x: dir > 0 ? '100%' : '-30%', opacity: dir > 0 ? 1 : 0.9 }),
          fica: { x: 0, opacity: 1 },
          sai: (dir: number) => (dir === 0 ? { opacity: 0 } : { x: dir > 0 ? '-30%' : '100%', opacity: dir > 0 ? 0.9 : 1 }),
        }}
        initial="entra"
        animate="fica"
        exit="sai"
        transition={d === 0 ? { duration: 0.15 } : { duration: 0.42, ease: curva }}
        className="bg-background min-h-svh w-full will-change-transform"
      >
        {saida}
      </motion.div>
    </AnimatePresence>
  );
}

export function Casca() {
  return (
    <ProvedorBusca>
    <SidebarProvider className="min-h-svh">
      <a href="#conteudo" className="bg-primary text-primary-foreground sr-only z-50 rounded-full px-4 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Pular para o conteúdo
      </a>
      <BarraLateral />
      <SidebarInset className="bg-background relative min-w-0 overflow-x-hidden">
        {fonte().demo && import.meta.env.VITE_ARTEFATO !== '1' && ( // na versão do celular (claude.ai) a faixa sai
          <p role="note" className="bg-aviso/12 text-aviso px-4 py-1.5 text-center text-[13px] font-medium">
            Demonstração com dados fictícios — nada aqui é real
          </p>
        )}
        <SaidaAnimada />
      </SidebarInset>
      <BotaoFlutuante />
      <BarraDeAbas />
      <TutorialDaPessoa />
    </SidebarProvider>
    </ProvedorBusca>
  );
}

function TutorialDaPessoa() {
  const perfil = usePerfil();
  return <Tutorial membroId={perfil.membro.id} />;
}
