import type { ConfigEntidade, Recibo } from '@/dados/tipos';
import { formatarData } from './datas';
import { formatarBRL } from './dinheiro';
import { baixar } from './exportar';

const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze',
  'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function ate999(n: number): string {
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100), r = n % 100;
  const partes = [CENTENAS[c]!];
  if (r < 20) partes.push(UNIDADES[r]!);
  else partes.push([DEZENAS[Math.floor(r / 10)]!, UNIDADES[r % 10]!].filter(Boolean).join(' e '));
  return partes.filter(Boolean).join(' e ');
}

function inteiroPorExtenso(n: number): string {
  if (n === 0) return 'zero';
  const grupos: [number, string, string][] = [[1_000_000_000, 'bilhão', 'bilhões'], [1_000_000, 'milhão', 'milhões'], [1000, 'mil', 'mil'], [1, '', '']];
  let texto = ''; let resto = n;
  for (const [base, sing, plur] of grupos) {
    const q = Math.floor(resto / base); resto %= base;
    if (!q) continue;
    const parte = base === 1000 && q === 1 ? 'mil' : [ate999(q), q === 1 ? sing : plur].filter(Boolean).join(' ');
    // regra do português: "e" antes de grupo menor que 100 ou de centena redonda ("mil e cem", "dois mil e vinte")
    texto = texto ? `${texto}${q < 100 || q % 100 === 0 ? ' e ' : ' '}${parte}` : parte;
  }
  return texto;
}

export function valorPorExtenso(valor: string): string {
  const [r = '0', c = '0'] = Number(valor).toFixed(2).split('.');
  const reais = Number(r), centavos = Number(c);
  const milhaoRedondo = reais >= 1_000_000 && reais % 1_000_000 === 0;
  const pReais = reais ? `${inteiroPorExtenso(reais)}${milhaoRedondo ? ' de' : ''} ${reais === 1 ? 'real' : 'reais'}` : '';
  const pCent = centavos ? `${inteiroPorExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}` : '';
  return [pReais, pCent].filter(Boolean).join(' e ') || 'zero reais';
}

export function formatarDocumento(d: string | null): string {
  if (!d) return '';
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return d;
}

const FORMA = { dinheiro: 'em dinheiro', bens: 'em bens', servicos: 'em serviços' } as const;

export async function exportarPdfRecibo(r: Recibo, entidade: ConfigEntidade | null) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const largura = doc.internal.pageSize.getWidth() - 100;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(entidade?.nome ?? 'Associação Exemplo', 50, 60);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text([entidade ? `CNPJ ${formatarDocumento(entidade.cnpj)}` : 'CNPJ: [preencher em Captação → Dados da Associação Exemplo]', entidade?.endereco ?? ''].filter(Boolean), 50, 78);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text(`RECIBO DE DOAÇÃO Nº ${r.numero}/${r.ano}`, 50, 130);
  if (r.cancelado_em) { doc.setTextColor(192, 0, 20); doc.text(`CANCELADO — ${r.motivo_cancelamento ?? ''}`, 50, 150); doc.setTextColor(0, 0, 0); }
  doc.setFontSize(20); doc.text(formatarBRL(r.valor), 50, 185);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(12);
  const texto = `Recebemos de ${r.doador_nome}${r.doador_documento ? `, ${r.doador_documento.length === 11 ? 'CPF' : 'CNPJ'} ${formatarDocumento(r.doador_documento)}` : ''}, `
    + `a doação ${FORMA[r.forma]} no valor de ${formatarBRL(r.valor)} (${valorPorExtenso(r.valor)}), em ${formatarData(r.data)}`
    + `${r.descricao ? `, referente a: ${r.descricao}` : ''}. A doação é destinada às atividades da associação, sem contrapartida ao doador.`;
  doc.text(doc.splitTextToSize(texto, largura) as string[], 50, 220, { lineHeightFactor: 1.5 });
  doc.line(50, 400, 300, 400);
  doc.setFontSize(10); doc.text('Assinatura do responsável pela associação', 50, 414);
  doc.setFontSize(8);
  doc.text(`Recibo emitido pelo sistema de gestão em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(r.emitido_em))}.`,
    50, doc.internal.pageSize.getHeight() - 30);
  baixar(doc.output('arraybuffer'), `erp-recibo-${r.ano}-${String(r.numero).padStart(4, '0')}.pdf`, 'application/pdf');
}
