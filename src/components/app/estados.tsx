import { CircleAlert, RotateCw, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { mensagemErro, ErroApp } from '@/lib/erros';

export function CarregandoLista({ linhas = 4, rotulo = 'Carregando…' }: { linhas?: number; rotulo?: string }) {
  return (
    <div role="status" aria-live="polite" className="bg-card flex flex-col overflow-hidden rounded-[14px]">
      <span className="sr-only">{rotulo}</span>
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-[30px] rounded-[8px]" />
          <div className="flex flex-1 flex-col gap-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /></div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

export function textoDoErro(e: unknown): string {
  if (e instanceof ErroApp) return e.message;
  return mensagemErro({ erro: 'falha_interna' });
}

export function BlocoErro({ erro, tentarDeNovo }: { erro: unknown; tentarDeNovo?: () => void }) {
  return (
    <Alert variant="destructive" role="alert">
      <CircleAlert aria-hidden="true" />
      <AlertTitle>Não foi possível carregar</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>{textoDoErro(erro)}</span>
        {tentarDeNovo && (
          <Button size="sm" variant="outline" onClick={tentarDeNovo}>
            <RotateCw data-icon="inline-start" aria-hidden="true" />
            Tentar de novo
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function Vazio({ icone: Icone, titulo, descricao, acao }: { icone: LucideIcon; titulo: string; descricao: string; acao?: ReactNode }) {
  return (
    <Empty className="bg-card border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Icone aria-hidden="true" /></EmptyMedia>
        <EmptyTitle>{titulo}</EmptyTitle>
        <EmptyDescription>{descricao}</EmptyDescription>
      </EmptyHeader>
      {acao && <EmptyContent>{acao}</EmptyContent>}
    </Empty>
  );
}
