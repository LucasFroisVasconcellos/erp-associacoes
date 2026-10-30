import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function RolagemHorizontal({ rotulo, children, className }: { rotulo: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [lado, setLado] = useState({ esq: false, dir: false });
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const medir = () => setLado({ esq: el.scrollLeft > 4, dir: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
    medir();
    el.addEventListener('scroll', medir, { passive: true });
    const ro = new ResizeObserver(medir); ro.observe(el);
    return () => { el.removeEventListener('scroll', medir); ro.disconnect(); };
  }, []);
  const mover = (d: number) => ref.current?.scrollBy({ left: d * ref.current.clientWidth * 0.7, behavior: 'smooth' });
  const mascara = lado.esq && lado.dir ? 'linear-gradient(to right, transparent, #000 2.5rem, #000 calc(100% - 2.5rem), transparent)'
    : lado.dir ? 'linear-gradient(to right, #000 calc(100% - 2.5rem), transparent)' : lado.esq ? 'linear-gradient(to right, transparent, #000 2.5rem)' : undefined;
  const seta = 'bg-card text-tint absolute top-1/2 z-10 hidden size-8 -translate-y-1/2 items-center justify-center rounded-full shadow-[0_1px_4px_rgba(0,0,0,0.18)] sm:inline-flex focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/35';
  return (
    <div className={cn('relative', className)}>
      {lado.esq && <button type="button" aria-label="Ver os anteriores" className={cn(seta, 'left-0')} onClick={() => mover(-1)}><ChevronLeft aria-hidden="true" className="size-5" /></button>}
      <nav ref={ref} aria-label={rotulo} className="-mx-4 flex gap-2 overflow-x-auto scroll-smooth px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={mascara ? { maskImage: mascara, WebkitMaskImage: mascara } : undefined}>
        {children}
      </nav>
      {lado.dir && <button type="button" aria-label="Ver mais" className={cn(seta, 'right-0')} onClick={() => mover(1)}><ChevronRight aria-hidden="true" className="size-5" /></button>}
    </div>
  );
}
