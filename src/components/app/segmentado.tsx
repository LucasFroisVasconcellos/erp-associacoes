import type { ReactNode } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

export function Segmentado<T extends string>({ valor, aoMudar, opcoes, rotulo, className }: {
  valor: T; aoMudar: (v: T) => void; opcoes: { valor: T; rotulo: ReactNode }[]; rotulo: string; className?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      value={valor}
      onValueChange={(v) => { if (v) aoMudar(v as T); }}
      aria-label={rotulo}
      spacing={0}
      className={cn('bg-muted grid w-full auto-cols-fr grid-flow-col rounded-[10px] p-[2px]', className)}
    >
      {opcoes.map((o) => (
        <ToggleGroupItem key={o.valor} value={o.valor} className="w-full rounded-[8px]! px-2">
          {o.rotulo}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function Pilulas<T extends string>({ valor, aoMudar, opcoes, rotulo }: {
  valor: T; aoMudar: (v: T) => void; opcoes: { valor: T; rotulo: ReactNode }[]; rotulo: string;
}) {
  return (
    <ToggleGroup type="single" value={valor} onValueChange={(v) => { if (v) aoMudar(v as T); }} aria-label={rotulo} spacing={2} className="flex flex-wrap justify-start">
      {opcoes.map((o) => (
        <ToggleGroupItem key={o.valor} value={o.valor}
          className="border-border text-muted-foreground data-[state=on]:bg-tint/12 data-[state=on]:text-tint data-[state=on]:border-tint/30 h-9 rounded-full! border px-4 text-[15px] data-[state=on]:font-semibold">
          {o.rotulo}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
