import { abrirSeletor } from '@/lib/seletor';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, Paperclip } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { fonte, type BucketArquivo } from '@/dados/fonte';
import { prepararDocumento } from '@/lib/comprovante';
import { ErroApp, mensagemErro } from '@/lib/erros';

export type AreaDocumento = 'pessoa' | 'saude' | 'institucional' | 'contrapartida';
const BUCKET: Record<AreaDocumento, BucketArquivo> = { pessoa: 'pessoas', saude: 'saude', institucional: 'institucional', contrapartida: 'captacao' };

export async function enviarDocumento(area: AreaDocumento, documentoId: string, f: File) {
  const pronto = await prepararDocumento(f);
  if ('erro' in pronto) throw new ErroApp({ erro: pronto.erro });
  const fd = new FormData();
  fd.set('destino', 'documento'); fd.set('area', area); fd.set('documento_id', documentoId); fd.set('arquivo', pronto.arquivo);
  await fonte().enviarArquivo(fd);
}

export function CampoArquivo({ arquivo, aoEscolher, id = 'doc-arquivo', somenteImagem, rotulo }: {
  arquivo: File | null; aoEscolher: (f: File | null) => void; id?: string; somenteImagem?: boolean; rotulo?: string;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-2">
      {!somenteImagem && <span id={`${id}-rotulo`} className="text-[15px] font-medium">Arquivo (PDF ou foto, opcional)</span>}
      <div className="flex items-center gap-2">
        <Button type="button" variant="secondary" aria-labelledby={somenteImagem ? undefined : `${id}-rotulo`} onClick={() => abrirSeletor(entrada.current)}>
          <Paperclip data-icon="inline-start" aria-hidden="true" />{arquivo ? 'Trocar' : rotulo ?? 'Escolher arquivo'}
        </Button>
        {arquivo && <span className="text-muted-foreground min-w-0 truncate text-[13px]">{arquivo.name}</span>}
      </div>
      <input ref={entrada} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" data-campo={id}
        accept={somenteImagem ? 'image/jpeg,image/png,image/webp' : 'image/*,.pdf,application/pdf'}
        onChange={(e) => aoEscolher(e.target.files?.[0] ?? null)} />
    </div>
  );
}

export function AnexarDocumento({ area, documentoId, rotulo, temArquivo, invalida }: {
  area: AreaDocumento; documentoId: string; rotulo: string; temArquivo: boolean; invalida: readonly (readonly unknown[])[];
}) {
  const qc = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  async function enviar(f: File | undefined) {
    if (!f || enviando) return;
    setEnviando(true);
    try {
      await enviarDocumento(area, documentoId, f);
      toast.success(temArquivo ? 'Arquivo substituído' : 'Arquivo anexado');
      for (const k of invalida) void qc.invalidateQueries({ queryKey: k });
    } catch (e) {
      toast.error(e instanceof ErroApp ? e.message : mensagemErro({ erro: 'falha_interna' }));
    } finally {
      setEnviando(false);
      if (entrada.current) entrada.current.value = '';
    }
  }
  return (
    <>
      <Button size="icon-sm" variant={temArquivo ? 'ghost' : 'secondary'} disabled={enviando} aria-label={`${temArquivo ? 'Trocar' : 'Anexar'} arquivo: ${rotulo}`}
        title={temArquivo ? 'Trocar o arquivo' : 'Anexar arquivo'} onClick={() => abrirSeletor(entrada.current)}>
        {enviando ? <Spinner /> : <Paperclip aria-hidden="true" />}
      </Button>
      <input ref={entrada} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" accept="image/*,.pdf,application/pdf"
        onChange={(e) => void enviar(e.target.files?.[0])} />
    </>
  );
}

export function AbrirDocumento({ area, caminho, rotulo }: { area: AreaDocumento; caminho: string; rotulo: string }) {
  const [abrindo, setAbrindo] = useState(false);
  async function abrir() {
    // a janela abre no toque (senão o navegador bloqueia); o endereço chega depois
    const janela = window.open('about:blank', '_blank');
    setAbrindo(true);
    try {
      const url = await fonte().urlArquivo(BUCKET[area], caminho);
      if (janela) { janela.opener = null; janela.location.href = url; }
    } catch (e) {
      janela?.close();
      toast.error(e instanceof ErroApp ? e.message : 'Não foi possível abrir o arquivo.');
    } finally { setAbrindo(false); }
  }
  return (
    <Button size="icon-sm" variant="ghost" aria-label={`Abrir arquivo: ${rotulo}`} disabled={abrindo} onClick={() => void abrir()}>
      {abrindo ? <Spinner /> : <Eye aria-hidden="true" />}
    </Button>
  );
}
