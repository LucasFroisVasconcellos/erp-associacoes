import { gerarCsv } from './csv';
import { formatarData } from './datas';

export const ACAO_AUD: Record<string, string> = {
  inserir: 'Criou', alterar: 'Alterou', remover: 'Removeu', acesso_negado: 'Tentativa negada',
  exportar: 'Exportou', retencao: 'Limpeza de dados vencidos (LGPD)',
};
export const TABELA_AUD: Record<string, string> = {
  lancamentos: 'lançamento', contas_bancarias: 'conta', categorias: 'categoria', tipos_gasto: 'tipo de gasto', membros: 'membro',
  permissoes: 'permissões', convites: 'convite', fechamentos: 'fechamento do mês', comprovantes: 'comprovante', reembolsos: 'reembolso',
  arquivos_contador: 'arquivo do contador', recorrencias: 'conta recorrente', auditoria: 'auditoria',
};

/** Acima disso o PDF trava navegador de celular: a tela entrega CSV no lugar. */
export const LIMITE_PDF_AUDITORIA = 2000;

export interface LinhaAuditoriaExportada {
  id: number; em: string; autor: string | null; membro_id: string | null; acao: string;
  tabela: string | null; registro_id: string | null; antes: unknown; depois: unknown;
}
export interface ExportacaoAuditoria { linhas: LinhaAuditoriaExportada[]; truncado: boolean; inicio: string; fim: string }

const FMT = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Sao_Paulo' });
export const dataHoraSP = (iso: string) => FMT.format(new Date(iso));

const json = (v: unknown) => (v === null || v === undefined ? '' : JSON.stringify(v));

function plana(l: LinhaAuditoriaExportada) {
  return {
    id: l.id, em: dataHoraSP(l.em), autor: l.autor ?? 'Sistema', acao: ACAO_AUD[l.acao] ?? l.acao,
    tabela: l.tabela ? TABELA_AUD[l.tabela] ?? l.tabela : '', registro: l.registro_id ?? '', antes: json(l.antes), depois: json(l.depois),
  };
}

const COLUNAS = [
  { chave: 'id', titulo: 'Nº' }, { chave: 'em', titulo: 'Data e hora (São Paulo)' }, { chave: 'autor', titulo: 'Quem' },
  { chave: 'acao', titulo: 'Ação' }, { chave: 'tabela', titulo: 'O quê' }, { chave: 'registro', titulo: 'Registro' },
  { chave: 'antes', titulo: 'Antes' }, { chave: 'depois', titulo: 'Depois' },
] as const;

/** CSV completo (com antes e depois): serve de backup e abre no Excel sem executar fórmulas. */
export function csvAuditoria(linhas: LinhaAuditoriaExportada[]): string {
  return gerarCsv(linhas.map(plana) as never[], COLUNAS as never);
}

export function nomeArquivoAuditoria(e: Pick<ExportacaoAuditoria, 'inicio' | 'fim'>, ext: 'csv' | 'pdf', pessoa?: string | null) {
  const slug = pessoa ? '-' + pessoa.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '';
  return `erp-auditoria-${e.inicio}-a-${e.fim}${slug}.${ext}`;
}

export async function pdfAuditoria(e: ExportacaoAuditoria, geradoPor: string, pessoa?: string | null): Promise<ArrayBuffer> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
  doc.text('Associação Exemplo — Trilha de auditoria', 40, 44);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
  doc.text(`De ${formatarData(e.inicio)} a ${formatarData(e.fim)}${pessoa ? ` · pessoa: ${pessoa}` : ''} · ${e.linhas.length} registros${e.truncado ? ' (limite atingido: use um período menor)' : ''}`, 40, 64);
  autoTable(doc, {
    startY: 80,
    head: [['Nº', 'Data e hora', 'Quem', 'Ação', 'O quê', 'Registro']],
    body: e.linhas.map(plana).map((l) => [String(l.id), l.em, l.autor, l.acao, l.tabela, l.registro]),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [0, 102, 204] },
  });
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i); doc.setFontSize(8);
    doc.text(`Gerado em ${dataHoraSP(new Date().toISOString())} por ${geradoPor} · página ${i} de ${paginas}`, 40, doc.internal.pageSize.getHeight() - 20);
  }
  return doc.output('arraybuffer');
}
