// A lista nominal de beneficiários não sai no PDF (dado pessoal, muitas vezes de menores): só o número de presentes.
import type { DadosPrestacao } from '@/dados/tipos';
import { gerarCsv } from './csv';
import { formatarData, hojeSP } from './datas';
import { formatarBRL, somar } from './dinheiro';
import { baixar } from './exportar';
import { FORMAS_TEXTO } from './formas';

const NOME_SITUACAO_BEM = { disponivel: 'Em uso', emprestado: 'Em uso (emprestado)', manutencao: 'Em manutenção', baixado: 'Baixado' } as const;

export function resumoPrestacao(d: DadosPrestacao) {
  const pg = d.pagamentos;
  const receitas = somar(pg.filter((p) => p.tipo === 'entrada').map((p) => p.valor));
  const despesas = somar(pg.filter((p) => p.tipo === 'saida').map((p) => p.valor));
  return { receitas, despesas, saldo: somar([receitas, '-' + despesas]), semComprovante: pg.filter((p) => p.tipo === 'saida' && !p.comprovante && !p.sem_comprovante_motivo).length };
}

export function nomeArquivo(projeto: string, sufixo: string, ext: 'csv' | 'pdf') {
  const base = projeto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'projeto';
  return `erp-${base}-${sufixo}-${hojeSP()}.${ext}`;
}

/** Documento do favorecido mascarado no meio (o completo fica no sistema). */
export function mascararDocumento(doc: string | null): string {
  if (!doc) return '';
  if (doc.length === 14) return `${doc.slice(0, 2)}.${doc.slice(2, 5)}.${doc.slice(5, 8)}/${doc.slice(8, 12)}-${doc.slice(12)}`; // CNPJ é público
  if (doc.length === 11) return `***.${doc.slice(3, 6)}.${doc.slice(6, 9)}-**`; // CPF: padrão de mascaramento do governo
  return '';
}

const COLUNAS_PAGAMENTOS = [
  { chave: 'data', titulo: 'Data' }, { chave: 'tipo', titulo: 'Tipo' }, { chave: 'valor', titulo: 'Valor' }, { chave: 'descricao', titulo: 'Descrição' },
  { chave: 'favorecido', titulo: 'Favorecido ou pagador' }, { chave: 'documento', titulo: 'CPF/CNPJ' }, { chave: 'forma', titulo: 'Forma de pagamento' },
  { chave: 'conta', titulo: 'Conta' }, { chave: 'rubrica', titulo: 'Rubrica' }, { chave: 'comprovante', titulo: 'Comprovante' },
] as const;

export function linhasPagamentos(d: DadosPrestacao) {
  return d.pagamentos.map((p) => ({
    data: formatarData(p.data), tipo: p.tipo === 'entrada' ? 'Receita' : 'Despesa', valor: p.valor.replace('.', ','), descricao: p.descricao,
    favorecido: p.favorecido ?? '', documento: mascararDocumento(p.documento), forma: p.forma_pagamento ? FORMAS_TEXTO[p.forma_pagamento] ?? p.forma_pagamento : '',
    conta: p.conta ?? '', rubrica: p.rubrica ?? '', comprovante: p.comprovante ? 'Sim' : p.sem_comprovante_motivo ? `Não (${p.sem_comprovante_motivo})` : 'Não',
  }));
}

export function csvPagamentos(d: DadosPrestacao) {
  return gerarCsv(linhasPagamentos(d) as never[], COLUNAS_PAGAMENTOS as never);
}

export function csvRubricas(d: DadosPrestacao) {
  const linhas = d.projeto.rubricas.map((r) => ({ rubrica: r.nome, previsto: r.previsto.replace('.', ','), realizado: r.realizado.replace('.', ','),
    percentual: r.pct === null ? '' : String(r.pct).replace('.', ','), saldo: somar([r.previsto, '-' + r.realizado]).replace('.', ',') }));
  return gerarCsv(linhas as never[], [{ chave: 'rubrica', titulo: 'Rubrica' }, { chave: 'previsto', titulo: 'Previsto' }, { chave: 'realizado', titulo: 'Realizado' },
    { chave: 'percentual', titulo: '% executado' }, { chave: 'saldo', titulo: 'Saldo' }] as never);
}

export function exportarCsvPrestacao(d: DadosPrestacao) {
  baixar(csvPagamentos(d), nomeArquivo(d.projeto.nome, 'relacao-de-pagamentos', 'csv'), 'text/csv;charset=utf-8');
  baixar(csvRubricas(d), nomeArquivo(d.projeto.nome, 'execucao-por-rubrica', 'csv'), 'text/csv;charset=utf-8');
}

export async function exportarPdfPrestacao(d: DadosPrestacao, geradoPor: string) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const p = d.projeto; const r = resumoPrestacao(d);
  const azul: [number, number, number] = [0, 102, 204];
  const titulo = (t: string, y: number) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(t, 40, y); doc.setFont('helvetica', 'normal'); doc.setFontSize(10); };
  const fimY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
  doc.text('Associação Exemplo', 40, 44);
  doc.setFontSize(13); doc.text(`Prestação de contas — ${p.nome}`, 40, 64);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  const cabecalho = [
    d.verba ? `Verba: ${d.verba.titulo} · ${d.verba.tipo} · origem: ${d.verba.origem}` : `Fonte: ${p.fonte ?? '—'}`,
    `Vigência: ${formatarData(p.vigencia_inicio)} a ${formatarData(p.vigencia_fim)} · Valor aprovado: ${formatarBRL(p.valor_aprovado)} · Contrapartida: ${formatarBRL(p.valor_contrapartida)}`,
    `Receitas: ${formatarBRL(r.receitas)} · Despesas: ${formatarBRL(r.despesas)} · Saldo: ${formatarBRL(r.saldo)}` +
      (p.pct_gasto !== null ? ` · Executado: ${p.pct_gasto.toLocaleString('pt-BR')}% do orçamento` : ''),
  ];
  cabecalho.forEach((t, i) => doc.text(t, 40, 84 + i * 14));
  let y = 84 + cabecalho.length * 14 + 6;
  if (p.pendencias.abertas > 0 || r.semComprovante > 0) {
    doc.setTextColor(192, 0, 20);
    doc.text(`Atenção: ${p.pendencias.abertas} pendência(s) de regra em aberto${r.semComprovante ? `, ${r.semComprovante} despesa(s) sem comprovante` : ''}. Resolva antes de enviar.`, 40, y);
    doc.setTextColor(0, 0, 0); y += 16;
  }

  titulo('1. Execução por rubrica (previsto x realizado)', y + 10);
  autoTable(doc, { startY: y + 18, head: [['Rubrica', 'Previsto', 'Realizado', '% executado', 'Saldo']],
    body: p.rubricas.map((x) => [x.nome, formatarBRL(x.previsto), formatarBRL(x.realizado), x.pct === null ? '—' : `${x.pct.toLocaleString('pt-BR')}%`, formatarBRL(somar([x.previsto, '-' + x.realizado]))]),
    styles: { fontSize: 9, cellPadding: 4 }, headStyles: { fillColor: azul }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } } });

  titulo('2. Relação de pagamentos e receitas', fimY() + 28);
  autoTable(doc, { startY: fimY() + 36, head: [['Data', 'Tipo', 'Valor', 'Descrição', 'Favorecido', 'CPF/CNPJ', 'Forma', 'Rubrica', 'Comprovante']],
    body: linhasPagamentos(d).map((l) => [l.data, l.tipo, formatarBRL(l.valor.replace(',', '.')), l.descricao, l.favorecido, l.documento, l.forma, l.rubrica, l.comprovante]),
    styles: { fontSize: 8, cellPadding: 3 }, headStyles: { fillColor: azul }, columnStyles: { 2: { halign: 'right' } } });

  titulo('3. Cronograma de atividades realizadas', fimY() + 28);
  autoTable(doc, { startY: fimY() + 36, head: [['Data', 'Atividade', 'Tipo', 'Local', 'Atletas presentes']],
    body: d.atividades.length ? d.atividades.map((a) => [formatarData(a.inicio.slice(0, 10)), a.titulo, a.tipo, a.local ?? '', a.presentes ? String(a.presentes) : '—'])
      : [['—', 'Nenhum evento ligado a este projeto na agenda', '', '', '']],
    styles: { fontSize: 9, cellPadding: 4 }, headStyles: { fillColor: azul }, columnStyles: { 4: { halign: 'right' } } });

  if (d.verba?.documentos.length) {
    titulo('4. Documentos exigidos', fimY() + 28);
    autoTable(doc, { startY: fimY() + 36, head: [['Momento', 'Documento', 'Entregue']],
      body: d.verba.documentos.map((x) => [x.momento === 'antes' ? 'Antes do pedido' : 'Depois do recebimento', x.nome, x.entregue ? 'Sim' : 'Não']),
      styles: { fontSize: 9, cellPadding: 4 }, headStyles: { fillColor: azul } });
  }
  titulo(`${d.verba?.documentos.length ? 5 : 4}. Bens adquiridos com recurso do projeto`, fimY() + 28);
  autoTable(doc, { startY: fimY() + 36, head: [['Nº patrimônio', 'Bem', 'Aquisição', 'Valor', 'Situação']],
    body: d.bens?.length ? d.bens.map((b) => [b.numero, b.nome, formatarData(b.data_aquisicao), formatarBRL(b.valor), NOME_SITUACAO_BEM[b.situacao]])
      : [['—', 'Nenhum bem cadastrado com origem neste projeto (Patrimônio)', '', '', '']],
    styles: { fontSize: 9, cellPadding: 4 }, headStyles: { fillColor: azul }, columnStyles: { 3: { halign: 'right' } } });
  doc.setFontSize(8);
  doc.text('Extratos da conta: anexar os do banco (conciliação na Fase 5). Lista nominal de beneficiários: só se o termo exigir, gerada à parte.', 40, fimY() + 24);

  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i); doc.setFontSize(8);
    doc.text(`Gerado em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date())} por ${geradoPor} · página ${i} de ${paginas}`,
      40, doc.internal.pageSize.getHeight() - 20);
  }
  baixar(doc.output('arraybuffer'), nomeArquivo(p.nome, 'prestacao-de-contas', 'pdf'), 'application/pdf');
}
