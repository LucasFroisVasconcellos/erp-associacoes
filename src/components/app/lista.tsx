import { ChevronRight, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from '@/components/ui/item';
import { cn } from '@/lib/utils';

export function Grupo({ titulo, rodape, acao, children, className }: {
  titulo?: string; rodape?: ReactNode; acao?: ReactNode; children: ReactNode; className?: string;
}) {
  const filhos = (Array.isArray(children) ? children : [children]).flat().filter(Boolean);
  return (
    <section className={cn('flex flex-col gap-1.5', className)} aria-label={titulo}>
      {(titulo || acao) && (
        <div className="flex items-end justify-between gap-3 px-4">
          {titulo && <h2 className="text-muted-foreground text-[13px] font-medium">{titulo}</h2>}
          {acao}
        </div>
      )}
      {/* role="list" do ItemGroup exige filhos role="listitem"; o separador fica dentro do item */}
      <ItemGroup>
        {filhos.map((f, i) => (
          <div role="listitem" key={i}>
            {i > 0 && <ItemSeparator aria-hidden="true" />}
            {f}
          </div>
        ))}
      </ItemGroup>
      {rodape && <div className="text-muted-foreground px-4 text-[13px] leading-snug text-pretty">{rodape}</div>}
    </section>
  );
}

const CORES = {
  azul: 'bg-[#0a68d4]', verde: 'bg-[#1e7b34]', laranja: 'bg-[#c45c00]', vermelho: 'bg-[#c00014]',
  roxo: 'bg-[#7a3fc4]', cinza: 'bg-[#6c6c70]', teal: 'bg-[#00737e]', indigo: 'bg-[#3e3ab8]',
} as const;
export type CorIcone = keyof typeof CORES;

export function IconeQuadrado({ icone: Icone, cor = 'azul', className }: { icone: LucideIcon; cor?: CorIcone; className?: string }) {
  return (
    <span className={cn('inline-flex size-[30px] shrink-0 items-center justify-center rounded-[8px] text-white', CORES[cor], className)}>
      <Icone aria-hidden="true" className="size-[18px]" strokeWidth={2.2} />
    </span>
  );
}

interface PropsLinha {
  titulo: ReactNode;
  descricao?: ReactNode;
  icone?: LucideIcon;
  cor?: CorIcone;
  valor?: ReactNode;
  valorNoTitulo?: boolean;
  para?: string;
  aoTocar?: () => void;
  seta?: boolean;
  desabilitada?: boolean;
  destrutiva?: boolean;
  rotuloAcessivel?: string;
}

export function Linha({ titulo, descricao, icone, cor, valor, valorNoTitulo, para, aoTocar, seta, desabilitada, destrutiva, rotuloAcessivel }: PropsLinha) {
  const corpo = (
    <>
      {icone && <ItemMedia><IconeQuadrado icone={icone} cor={cor} /></ItemMedia>}
      <ItemContent className="min-w-0">
        <ItemTitle className={cn('w-full items-start', destrutiva && 'text-destructive')}>
          <span className="line-clamp-2 min-w-0 flex-1 break-words">{titulo}</span>
          {valorNoTitulo && valor !== undefined && <span className="shrink-0 pl-2 text-right">{valor}</span>}
        </ItemTitle>
        {descricao && <ItemDescription className="line-clamp-2">{descricao}</ItemDescription>}
      </ItemContent>
      {((!valorNoTitulo && valor !== undefined) || seta || para) && (
        <ItemActions className="text-muted-foreground shrink-0 gap-1.5 text-[17px]">
          {!valorNoTitulo && valor}
          {(seta ?? Boolean(para)) && <ChevronRight aria-hidden="true" className="text-muted-foreground/60 size-5" strokeWidth={2.2} />}
        </ItemActions>
      )}
    </>
  );
  if (para && !desabilitada) {
    return <Item asChild><Link to={para} aria-label={rotuloAcessivel} className="focus-visible:ring-ring/35 focus-visible:ring-4 focus-visible:ring-inset">{corpo}</Link></Item>;
  }
  if (aoTocar) {
    return (
      <Item asChild>
        <button type="button" onClick={aoTocar} disabled={desabilitada} aria-label={rotuloAcessivel}
          className="hover:bg-muted/70 active:bg-muted w-full text-left focus-visible:ring-4 focus-visible:ring-ring/35 focus-visible:ring-inset disabled:opacity-50">
          {corpo}
        </button>
      </Item>
    );
  }
  return <Item>{corpo}</Item>;
}
