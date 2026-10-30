import { concentracao, duplicidades, foraDoPadrao, inadimplencia, porMes, prever, qualidade, reais, type DadosAnalise } from './analises';
import { formatarBRL } from './dinheiro';
import { mesPorExtenso } from './datas';
import { baixar } from './exportar';

const brl = (c: number) => formatarBRL(reais(c));

/** Linhas do relatório (separadas do PDF para poder testar). */
export type PeriodoRelatorio = 'mes' | 'trimestre' | 'ano';
export function conteudoRelatorio(d: DadosAnalise, periodo: PeriodoRelatorio = 'mes') {
  const serie = porMes(d.realizados, d.inicio, d.hoje);
  // mês e trimestre: os últimos meses completos; ano: de janeiro até hoje
  const meses = periodo === 'ano' ? serie.filter((m) => m.mes.startsWith(d.hoje.slice(0, 4)))
    : serie.slice(0, -1).slice(periodo === 'trimestre' ? -3 : -1);
  const usados = meses.length ? meses : serie.slice(-1);
  const passado = { mes: usados[0]!.mes, entradas: usados.reduce((t, m) => t + m.entradas, 0), saidas: usados.reduce((t, m) => t + m.saidas, 0) };
  const doPeriodo = d.realizados.filter((r) => usados.some((m) => r.data.startsWith(m.mes)));
  const prev = prever(d, 6);
  const conc = concentracao(periodo === 'mes' ? d.realizados : doPeriodo);
  const q = qualidade(doPeriodo);
  const nomePeriodo = periodo === 'mes' ? mesPorExtenso(`${usados[0]!.mes}-01`)
    : periodo === 'trimestre' ? `${mesPorExtenso(`${usados[0]!.mes}-01`)} a ${mesPorExtenso(`${usados.at(-1)!.mes}-01`)}` : `${d.hoje.slice(0, 4)} (até hoje)`;
  const quem = periodo === 'mes' ? 'diretoria' : periodo === 'trimestre' ? 'conselho fiscal' : 'assembleia';
  const inad = inadimplencia(d);
  const alertas: string[] = [];
  if (prev.folego !== null) alertas.push(`O caixa previsto fica negativo em ${mesPorExtenso(`${prev.meses[prev.folego]!.mes}-01`)}.`);
  if (conc.nivel !== 'baixo' && conc.fontes[0]) alertas.push(`${conc.fontes[0].fonte} responde por ${Math.round(conc.fontes[0].parte * 100)}% das receitas (concentração ${conc.nivel}).`);
  const fora = foraDoPadrao(d.realizados).filter((x) => doPeriodo.some((r) => r.id === x.id)).length; if (fora) alertas.push(`${fora} gasto(s) bem acima do normal da categoria para conferir.`);
  const dup = duplicidades(doPeriodo).length; if (dup) alertas.push(`${dup} possível(is) lançamento(s) repetido(s) para conferir.`);
  if (q.semComprovante) alertas.push(`${q.semComprovante} saída(s) do período sem comprovante.`);
  if (inad.quantidade) alertas.push(`${inad.quantidade} mensalidade(s) em atraso, somando ${brl(inad.total)}.`);
  return {
    titulo: `Relatório para ${quem === 'diretoria' ? 'a diretoria' : quem === 'conselho fiscal' ? 'o conselho fiscal' : 'a assembleia'} — ${nomePeriodo}`,
    numeros: [
      ['Saldo hoje', formatarBRL(d.saldo)],
      ['Entradas do período', brl(passado.entradas)], ['Saídas do período', brl(passado.saidas)], ['Resultado do período', brl(passado.entradas - passado.saidas)],
      ['Menor saldo previsto (6 meses)', `${brl(prev.menorSaldo)} em ${mesPorExtenso(`${prev.mesMenor}-01`)}`],
      ['A receber em atraso', brl(prev.atrasadasReceber)], ['A pagar em atraso', brl(prev.atrasadasPagar)],
    ] as [string, string][],
    alertas: alertas.length ? alertas : ['Nenhum alerta neste período.'],
  };
}

export async function baixarRelatorioMensal(d: DadosAnalise, periodo: PeriodoRelatorio = 'mes') {
  const c = conteudoRelatorio(d, periodo);
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(c.titulo, 40, 56);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100);
  doc.text(`Associação Exemplo · gerado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · os alertas são sinais para conferência, não acusações`, 40, 72);
  doc.setTextColor(0);
  autoTable(doc, { startY: 90, head: [['Indicador', 'Valor']], body: c.numeros, theme: 'striped', styles: { fontSize: 11 }, headStyles: { fillColor: [0, 91, 184] } });
  const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 28;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Alertas', 40, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
  c.alertas.forEach((a, i) => doc.text(doc.splitTextToSize(`• ${a}`, 515), 40, y + 20 + i * 30));
  baixar(doc.output('blob'), `relatorio-${periodo}-${d.hoje.slice(0, 7)}.pdf`, 'application/pdf');
}
