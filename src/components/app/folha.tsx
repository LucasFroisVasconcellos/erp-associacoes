import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

interface Props {
  aberta: boolean;
  aoMudar: (v: boolean) => void;
  titulo: string;
  descricao?: string;
  rodape?: ReactNode;
  children: ReactNode;
  larga?: boolean;
}

export function Folha({ aberta, aoMudar, titulo, descricao, rodape, children, larga }: Props) {
  const celular = useIsMobile();
  if (celular) {
    return (
      <Drawer open={aberta} onOpenChange={aoMudar} repositionInputs={false}>
        <DrawerContent className="max-h-[92svh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>{titulo}</DrawerTitle>
            <DrawerDescription className={cn(!descricao && 'sr-only')}>{descricao ?? titulo}</DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto overscroll-contain px-5 pb-2">{children}</div>
          {rodape && <DrawerFooter>{rodape}</DrawerFooter>}
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Dialog open={aberta} onOpenChange={aoMudar}>
      <DialogContent className={cn('max-h-[88svh] grid-rows-[auto_1fr_auto] overflow-hidden', larga ? 'sm:max-w-2xl' : 'sm:max-w-lg')}>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription className={cn(!descricao && 'sr-only')}>{descricao ?? titulo}</DialogDescription>
        </DialogHeader>
        <div className="-mx-6 overflow-y-auto overscroll-contain px-6">{children}</div>
        {rodape && <DialogFooter>{rodape}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
