// A cor nunca é a única pista: o sinal e o texto acompanham.
import { formatarBRL } from '@/lib/dinheiro';
import { cn } from '@/lib/utils';

export function Valor({ valor, tipo, className, oculto }: {
  valor: string | null | undefined; tipo?: 'entrada' | 'saida'; className?: string; oculto?: boolean;
}) {
  if (oculto) return <span className={cn('numeros', className)} aria-label="Valor oculto">•••</span>;
  const texto = formatarBRL(valor);
  const sinal = tipo === 'entrada' ? '+' : tipo === 'saida' ? '−' : '';
  return (
    <span
      className={cn('numeros whitespace-nowrap', tipo === 'entrada' && 'text-entrada', className)}
      aria-label={tipo ? `${tipo === 'entrada' ? 'Entrou' : 'Saiu'} ${texto}` : texto}
    >
      {sinal}{texto}
    </span>
  );
}
