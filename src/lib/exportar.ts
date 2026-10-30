import type { LinhaRelatorio } from '@/dados/tipos';
import { gerarCsv } from './csv';
import { formatarData } from './datas';
import { formatarBRL, somar } from './dinheiro';

export function baixar(conteudo: BlobPart, nome: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement('a');
  a.href = url; a.download = nome; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

const COLUNAS = [
  { chave: 'data', titulo: 'Data' }, { chave: 'tipo', titulo: 'Tipo' }, { chave: 'situacao', titulo: 'Situação' },
  { chave: 'valor', titulo: 'Valor' }, { chave: 'descricao', titulo: 'Descrição' }, { chave: 'categoria', titulo: 'Categoria' },
  { chave: 'conta', titulo: 'Conta' }, { chave: 'forma_pagamento', titulo: 'Forma de pagamento' }, { chave: 'comprovante', titulo: 'Comprovante' },
  { chave: 'criado_por', titulo: 'Lançado por' },
] as const;

function linhaPlana(l: LinhaRelatorio) {
  return {
    ...l,
    data: formatarData(l.data),
    tipo: l.tipo === 'entrada' ? 'Entrada' : 'Saída',
    situacao: l.estorno_de ? 'Estorno' : l.situacao === 'realizada' ? 'Realizado' : l.situacao === 'prevista' ? 'Previsto' : 'Cancelado',
    valor: l.valor.replace('.', ','),
    comprovante: l.tem_comprovante ? 'Sim' : l.sem_comprovante_motivo ? `Não (${l.sem_comprovante_motivo})` : 'Não',
  };
}

export function totais(linhas: LinhaRelatorio[]) {
  const reais = linhas.filter((l) => l.situacao === 'realizada');
  const entradas = somar(reais.filter((l) => l.tipo === 'entrada').map((l) => l.valor));
  const saidas = somar(reais.filter((l) => l.tipo === 'saida').map((l) => l.valor));
  return { entradas, saidas, resultado: somar([entradas, '-' + saidas]) };
}

export function exportarCsv(linhas: LinhaRelatorio[], inicio: string, fim: string) {
  const csv = gerarCsv(linhas.map(linhaPlana) as never[], COLUNAS as never);
  baixar(csv, `erp-lancamentos-${inicio}-a-${fim}.csv`, 'text/csv;charset=utf-8');
}

export async function exportarPdf(linhas: LinhaRelatorio[], inicio: string, fim: string, geradoPor: string) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const t = totais(linhas);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
  doc.text('Associação Exemplo', 40, 44);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
  doc.text(`Relatório de lançamentos de ${formatarData(inicio)} a ${formatarData(fim)}`, 40, 64);
  doc.text(`Entradas: ${formatarBRL(t.entradas)}   Saídas: ${formatarBRL(t.saidas)}   Resultado: ${formatarBRL(t.resultado)}`, 40, 82);
  autoTable(doc, {
    startY: 98,
    head: [['Data', 'Tipo', 'Situação', 'Valor', 'Descrição', 'Categoria', 'Conta', 'Comprovante']],
    body: linhas.map(linhaPlana).map((l) => [l.data, l.tipo, l.situacao, formatarBRL(l.valor.replace(',', '.')), l.descricao, l.categoria ?? '', l.conta ?? '', l.comprovante]),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [0, 102, 204] },
    columnStyles: { 3: { halign: 'right' } },
  });
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i); doc.setFontSize(8);
    doc.text(`Gerado em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date())} por ${geradoPor} · página ${i} de ${paginas}`, 40, doc.internal.pageSize.getHeight() - 20);
  }
  baixar(doc.output('arraybuffer'), `erp-lancamentos-${inicio}-a-${fim}.pdf`, 'application/pdf');
}
