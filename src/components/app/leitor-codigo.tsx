import { useEffect, useRef, useState } from 'react';
import { ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Folha } from './folha';

export function LeitorCodigo({ aberto, aoMudar, aoLer }: { aberto: boolean; aoMudar: (v: boolean) => void; aoLer: (texto: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [erroCamera, setErroCamera] = useState<string | null>(null);
  const [digitado, setDigitado] = useState('');

  useEffect(() => {
    if (!aberto) return;
    let parar: (() => void) | undefined;
    let cancelado = false;
    setErroCamera(null);
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (cancelado || !video.current) return;
        const leitor = new BrowserMultiFormatReader();
        const controles = await leitor.decodeFromConstraints({ video: { facingMode: 'environment' } }, video.current, (r) => {
          if (r) { controles.stop(); aoLer(r.getText()); }
        });
        parar = () => controles.stop();
        if (cancelado) parar();
      } catch (e) {
        if (!cancelado) setErroCamera((e as Error).name === 'NotAllowedError'
          ? 'A câmera não foi liberada. Libere nas configurações do navegador ou digite o código abaixo.'
          : 'Não foi possível abrir a câmera neste aparelho. Digite ou cole o código abaixo.');
      }
    })();
    return () => { cancelado = true; parar?.(); };
  }, [aberto, aoLer]);

  return (
    <Folha aberta={aberto} aoMudar={aoMudar} titulo="Ler código" descricao="Aponte para o QR code do cupom fiscal ou para o código de barras do boleto.">
      <FieldGroup className="pb-4">
        <div className="relative aspect-[4/3] overflow-hidden rounded-[16px] bg-black">
          <video ref={video} className="size-full object-cover" muted playsInline aria-label="Imagem da câmera" />
          <ScanLine aria-hidden="true" className="absolute inset-0 m-auto size-24 text-white/70" strokeWidth={1.2} />
        </div>
        {erroCamera && <FieldError>{erroCamera}</FieldError>}
        <Field>
          <FieldLabel htmlFor="codigo-digitado">Ou digite / cole o código</FieldLabel>
          <Input id="codigo-digitado" name="codigo" inputMode="text" autoComplete="off" spellCheck={false}
            placeholder="Linha digitável do boleto ou link do QR…" value={digitado} onChange={(e) => setDigitado(e.target.value)} />
          <FieldDescription>A linha digitável tem 47 ou 48 números; pode colar com espaços e pontos.</FieldDescription>
        </Field>
        <Button disabled={digitado.trim().length < 20} onClick={() => aoLer(digitado.trim())}>Usar este código</Button>
      </FieldGroup>
    </Folha>
  );
}
