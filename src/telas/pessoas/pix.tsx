import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import type { ConfigPix } from '@/dados/tipos';
import { carregarComRecarga, depsNavegador } from '@/lib/sob-demanda';
import { brCodePix } from '@/lib/pix';
import { matrizQrCom } from '@/lib/qr';
import { formatarBRL } from '@/lib/dinheiro';

async function matrizQr(texto: string): Promise<boolean[][]> {
  return matrizQrCom(await carregarComRecarga(() => import('@zxing/library'), depsNavegador()), texto);
}

export function QrCode({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [matriz, setMatriz] = useState<boolean[][] | null>(null);
  const [falhou, setFalhou] = useState(false);
  useEffect(() => {
    let vivo = true;
    matrizQr(texto).then((m) => vivo && setMatriz(m)).catch(() => vivo && setFalhou(true));
    return () => { vivo = false; };
  }, [texto]);
  if (falhou) return <p className="text-muted-foreground text-[13px]">Não foi possível desenhar o QR Code. Use o “copia e cola”.</p>;
  if (!matriz) return <Skeleton className="size-56 rounded-[12px]" />;
  const n = matriz.length, borda = 4, total = n + borda * 2;
  const d = matriz.flatMap((linha, y) => linha.map((escuro, x) => (escuro ? `M${x + borda} ${y + borda}h1v1h-1z` : ''))).join('');
  return (
    <svg role="img" aria-label={rotulo} viewBox={`0 0 ${total} ${total}`} className="size-56 rounded-[12px] bg-white" shapeRendering="crispEdges">
      <path d={d} fill="#000" />
    </svg>
  );
}

export function CobrancaPix({ config, valor, txid, descricao }: { config: ConfigPix; valor: string; txid: string; descricao: string }) {
  const [copiado, setCopiado] = useState(false);
  let codigo: string;
  try { codigo = brCodePix({ ...config, valor, txid }); }
  catch { return <p className="text-destructive text-[15px]">A chave Pix da Associação Exemplo está incompleta. Peça à tesouraria para conferir em Pessoas › Mensalidades › Configurar a mensalidade.</p>; }
  async function copiar() {
    try { await navigator.clipboard.writeText(codigo); setCopiado(true); toast.success('Código Pix copiado'); setTimeout(() => setCopiado(false), 2500); }
    catch { toast.error('Não foi possível copiar. Selecione o texto e copie.'); }
  }
  return (
    <div className="flex flex-col items-center gap-4">
      <QrCode texto={codigo} rotulo={`QR Code Pix de ${formatarBRL(valor)}: ${descricao}`} />
      <p className="numeros text-[22px] font-bold">{formatarBRL(valor)}</p>
      <p className="text-muted-foreground -mt-3 text-center text-[13px]">{descricao} · para {config.nome}</p>
      <Textarea readOnly rows={3} aria-label="Código Pix copia e cola" className="font-mono text-[12px] break-all" value={codigo} onFocus={(e) => e.currentTarget.select()} />
      <Button size="lg" className="w-full" onClick={() => void copiar()}>
        {copiado ? <Check data-icon="inline-start" aria-hidden="true" /> : <Copy data-icon="inline-start" aria-hidden="true" />}{copiado ? 'Copiado' : 'Copiar código Pix'}
      </Button>
      <p className="text-muted-foreground text-center text-[13px] text-pretty">Mande o código para a pessoa pagar no app do banco. A baixa é feita pela tesouraria depois de conferir o extrato.</p>
    </div>
  );
}
