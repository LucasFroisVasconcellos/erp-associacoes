import type { Deliberacao, Presenca, Reuniao } from '@/dados/tipos';
import { formatarData } from './datas';
import { baixar } from './exportar';

const NOME_TIPO: Record<Reuniao['tipo'], string> = {
  diretoria: 'Reunião de diretoria', assembleia_ordinaria: 'Assembleia geral ordinária',
  assembleia_extraordinaria: 'Assembleia geral extraordinária', conselho_fiscal: 'Reunião do conselho fiscal',
};
const NOME_RESULTADO: Record<Deliberacao['resultado'], string> = { aprovada: 'Aprovada', rejeitada: 'Rejeitada', retirada: 'Retirada de pauta' };

export function quorumAtingido(r: Pick<Reuniao, 'quorum_minimo'>, presentes: number): boolean {
  return r.quorum_minimo === null || presentes >= r.quorum_minimo;
}

export function nomeArquivoAta(r: Pick<Reuniao, 'titulo' | 'data'>): string {
  const base = r.titulo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'reuniao';
  return `erp-ata-${base}-${r.data.slice(0, 10)}.pdf`;
}

export async function exportarPdfAta(r: Reuniao, presencas: Presenca[], deliberacoes: Deliberacao[], geradoPor: string) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const largura = doc.internal.pageSize.getWidth() - 80;
  const azul: [number, number, number] = [0, 102, 204];
  const fimY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const quando = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(r.data));

  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('Associação Exemplo', 40, 48);
  doc.setFontSize(12); doc.text(`Ata — ${NOME_TIPO[r.tipo]}`, 40, 68);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(`${r.titulo} · ${quando}${r.local ? ` · ${r.local}` : ''}`, 40, 86);
  const ok = quorumAtingido(r, presencas.length);
  doc.text(`Presentes: ${presencas.length}${r.quorum_minimo !== null ? ` · quórum mínimo: ${r.quorum_minimo} (${ok ? 'atingido' : 'NÃO atingido'})` : ''}`, 40, 100);
  if (!r.ata_aprovada_em) { doc.setTextColor(192, 0, 20); doc.text('RASCUNHO — ata ainda não aprovada', 40, 114); doc.setTextColor(0, 0, 0); }
  else doc.text(`Ata aprovada em ${formatarData(r.ata_aprovada_em)}`, 40, 114);

  let y = 136;
  const bloco = (titulo: string, texto: string) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(titulo, 40, y); y += 14;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    for (const linha of doc.splitTextToSize(texto, largura) as string[]) {
      if (y > doc.internal.pageSize.getHeight() - 50) { doc.addPage(); y = 50; }
      doc.text(linha, 40, y); y += 13;
    }
    y += 8;
  };
  bloco('Pauta', r.pauta);
  autoTable(doc, { startY: y, head: [['Presentes']], body: presencas.length ? presencas.map((p) => [p.nome]) : [['Lista de presença não registrada']],
    styles: { fontSize: 9, cellPadding: 3 }, headStyles: { fillColor: azul } });
  autoTable(doc, { startY: fimY() + 16, head: [['Item', 'Deliberação', 'A favor', 'Contra', 'Abstenções', 'Resultado']],
    body: deliberacoes.length ? deliberacoes.map((d) => [String(d.ordem), d.texto, String(d.votos_favor), String(d.votos_contra), String(d.abstencoes), NOME_RESULTADO[d.resultado]])
      : [['—', 'Nenhuma deliberação registrada', '', '', '', '']],
    styles: { fontSize: 9, cellPadding: 3 }, headStyles: { fillColor: azul }, columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } } });
  y = fimY() + 24;
  bloco('Texto da ata', r.ata ?? '(sem texto)');

  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i); doc.setFontSize(8);
    doc.text(`Gerado em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date())} por ${geradoPor} · página ${i} de ${paginas}`,
      40, doc.internal.pageSize.getHeight() - 20);
  }
  baixar(doc.output('arraybuffer'), nomeArquivoAta(r), 'application/pdf');
}
