import type {
  CategoriaBem, OrigemBem, OrgaoMandato, Periodicidade, SituacaoBem, SituacaoFiliacao, SituacaoMensalidade, SituacaoPessoa,
  TipoDocumentoInstitucional, TipoDocumentoPessoa, TipoDocumentoSaude, TipoReuniao,
} from '@/dados/tipos';
import type { CorIcone } from '@/components/app/lista';
import { hojeSP, somarDias } from '@/lib/datas';

export const NOME_SITUACAO_PESSOA: Record<SituacaoPessoa, string> = { ativo: 'Ativo', inativo: 'Inativo', desligado: 'Desligado' };
export const NOME_SITUACAO_MENS: Record<SituacaoMensalidade, string> = { aberta: 'Em aberto', paga: 'Paga', dispensada: 'Dispensada', cancelada: 'Cancelada' };
export const NOME_DOC_PESSOA: Record<TipoDocumentoPessoa, string> = {
  registro_federacao: 'Registro esportivo', autorizacao_imagem: 'Autorização de uso de imagem', termo_equipamento: 'Termo de equipamento', outro: 'Outro documento',
};
export const NOME_DOC_SAUDE: Record<TipoDocumentoSaude, string> = {
  atestado_medico: 'Atestado médico', laudo: 'Laudo', classificacao_funcional: 'Classificação funcional', outro: 'Outro documento de saúde',
};
export const NOME_CATEGORIA_BEM: Record<CategoriaBem, string> = {
  cadeira_jogo: 'Cadeira de jogo', bola: 'Bola', uniforme: 'Uniforme', equipamento_treino: 'Equipamento de treino', informatica: 'Informática', outro: 'Outro',
};
export const NOME_ORIGEM_BEM: Record<OrigemBem, string> = { compra: 'Compra', doacao: 'Doação', projeto: 'Recurso de projeto', outro: 'Outra' };
export const NOME_SITUACAO_BEM: Record<SituacaoBem, string> = { disponivel: 'Disponível', emprestado: 'Emprestado', manutencao: 'Em manutenção', baixado: 'Baixado' };
export const COR_SITUACAO_BEM: Record<SituacaoBem, CorIcone> = { disponivel: 'verde', emprestado: 'azul', manutencao: 'laranja', baixado: 'cinza' };
export const NOME_DOC_INST: Record<TipoDocumentoInstitucional, string> = {
  estatuto: 'Estatuto', regimento: 'Regimento interno', ata_registrada: 'Ata registrada', cnpj: 'Cartão CNPJ', procuracao: 'Procuração',
  certidao_federal: 'Certidão federal (CND)', certidao_estadual: 'Certidão estadual', certidao_municipal: 'Certidão municipal',
  certidao_fgts: 'Certidão do FGTS (CRF)', certidao_trabalhista: 'Certidão trabalhista (CNDT)', alvara: 'Alvará', outro: 'Outro',
};
export const NOME_ORGAO: Record<OrgaoMandato, string> = { diretoria: 'Diretoria', conselho_fiscal: 'Conselho fiscal', outro: 'Outro' };
export const NOME_TIPO_REUNIAO: Record<TipoReuniao, string> = {
  diretoria: 'Reunião de diretoria', assembleia_ordinaria: 'Assembleia geral ordinária', assembleia_extraordinaria: 'Assembleia geral extraordinária', conselho_fiscal: 'Reunião do conselho fiscal',
};
export const NOME_SITUACAO_FILIACAO: Record<SituacaoFiliacao, string> = {
  preparacao: 'Em preparação', ativa: 'Ativa', pendente: 'Pendente', suspensa: 'Suspensa', encerrada: 'Encerrada',
};
export const COR_SITUACAO_FILIACAO: Record<SituacaoFiliacao, CorIcone> = { preparacao: 'cinza', ativa: 'verde', pendente: 'laranja', suspensa: 'vermelho', encerrada: 'cinza' };
export const NOME_PERIODICIDADE: Record<Periodicidade, string> = { mensal: 'Mensal', anual: 'Anual', outra: 'Outra' };

/** Idade completa hoje (fuso de São Paulo). */
export function idade(nascimento: string | null, hoje = hojeSP()): number | null {
  if (!nascimento) return null;
  const [a, m, d] = nascimento.split('-').map(Number) as [number, number, number];
  const [ha, hm, hd] = hoje.split('-').map(Number) as [number, number, number];
  return ha - a - (hm < m || (hm === m && hd < d) ? 1 : 0);
}
export const menorDeIdade = (nascimento: string | null) => { const i = idade(nascimento); return i !== null && i < 18; };

export function estadoValidade(validade: string | null, hoje = hojeSP()): 'vencido' | 'vence' | 'ok' | null {
  if (!validade) return null;
  if (validade < hoje) return 'vencido';
  return validade <= somarDias(hoje, 30) ? 'vence' : 'ok';
}
export const COR_VALIDADE = { vencido: 'vermelho', vence: 'laranja', ok: 'verde' } as const satisfies Record<string, CorIcone>;

export function ultimasCompetencias(n: number, hoje = hojeSP()): string[] {
  const r: string[] = [];
  let [a, m] = hoje.split('-').map(Number) as [number, number];
  for (let i = 0; i < n; i++) {
    r.push(`${a}-${String(m).padStart(2, '0')}-01`);
    m -= 1; if (m === 0) { m = 12; a -= 1; }
  }
  return r;
}

export function formatarTelefone(t: string | null): string {
  if (!t) return '';
  const d = t.replace(/^\+55/, '');
  if (/^\d{11}$/.test(d)) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (/^\d{10}$/.test(d)) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t;
}
