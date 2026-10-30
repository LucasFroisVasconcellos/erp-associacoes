import { ChevronLeft } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';
import { BotaoAjuda } from './ajuda';

interface Props {
  titulo: string;
  voltar?: { para: string; rotulo: string };
  acoes?: ReactNode;
  sob?: ReactNode;
  children: ReactNode;
  className?: string;
  larga?: boolean;
}

export function Pagina({ titulo, voltar, acoes, sob, children, className, larga }: Props) {
  const sentinela = useRef<HTMLDivElement>(null);
  const [compacta, setCompacta] = useState(false);

  useEffect(() => {
    const el = sentinela.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => setCompacta(!e!.isIntersecting), { rootMargin: '-52px 0px 0px 0px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => { document.title = `${titulo} · Associação Exemplo`; }, [titulo]);

  return (
    <div className={cn('flex min-h-full flex-col', className)}>
      <header
        className={cn(
          'pt-seguro sticky top-0 z-30 transition-[background-color,box-shadow] duration-200',
          compacta ? 'material-barra shadow-[0_0.5px_0_var(--border)]' : 'bg-background',
        )}
      >
        <div className={cn('mx-auto grid h-13 grid-cols-[1fr_auto_1fr]', larga ? 'max-w-6xl' : 'max-w-3xl', ' items-center gap-2 px-2 sm:px-4')}>
          <div className="flex min-w-0 items-center">
            {voltar && (
              <Link
                to={voltar.para}
                className="text-tint hover:bg-tint/8 inline-flex h-11 min-w-0 items-center gap-0.5 rounded-full pr-3 pl-1 text-[17px] transition-colors focus-visible:ring-4 focus-visible:ring-ring/35"
              >
                <ChevronLeft aria-hidden="true" className="size-7 shrink-0" strokeWidth={2.4} />
                <span className="truncate">{voltar.rotulo}</span>
              </Link>
            )}
          </div>
          {/* título compacto é cópia visual do h1: o leitor de tela lê só o h1 */}
          <p
            aria-hidden="true"
            className={cn(
              'truncate text-center text-[17px] font-semibold transition-[opacity,transform] duration-200',
              // fora do modo compacto o título invisível não ocupa espaço (o "voltar" não é cortado)
              compacta ? 'max-w-[50vw] translate-y-0 opacity-100' : 'max-w-0 translate-y-1 opacity-0',
            )}
          >
            {titulo}
          </p>
          <div className="flex items-center justify-end gap-1">{acoes}</div>
        </div>
      </header>

      <main id="conteudo" className={cn('mx-auto w-full flex-1 px-4 pb-32 sm:px-6 lg:pb-12', larga ? 'max-w-6xl' : 'max-w-3xl')}>
        <div className="flex items-center gap-1.5 pt-1 pb-3">
          <h1 className="font-display text-[34px] leading-[1.1] font-bold tracking-[-0.02em] text-balance">{titulo}</h1>
          <BotaoAjuda />
        </div>
        <div ref={sentinela} aria-hidden="true" className="h-px" />
        {sob && <div className="pb-4">{sob}</div>}
        <div className="flex flex-col gap-7">{children}</div>
      </main>
    </div>
  );
}
