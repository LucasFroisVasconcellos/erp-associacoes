import { cent } from './analises';

export type SituacaoOrcamento = 'sem_orcamento' | 'ok' | 'ritmo' | 'estourou' | 'abaixo';
export interface LinhaOrcamento { id: string; nome: string; tipo: 'entrada' | 'saida'; previsto: string; realizado: string; a_realizar: string; por_mes: { mes: number; valor: string }[] }

export function fracaoDoAno(ano: number, hoje: string) {
  const a = Number(hoje.slice(0, 4));
  if (ano < a) return 1; if (ano > a) return 0;
  const inicio = Date.UTC(a, 0, 1), fim = Date.UTC(a + 1, 0, 1), agora = Date.parse(`${hoje}T12:00:00Z`);
  return (agora - inicio) / (fim - inicio);
}

/** Despesa: estourou se passou do previsto; "ritmo" se está mais de 10% acima do esperado até hoje. Receita: "abaixo" se está 10% abaixo. */
export function situacao(l: Pick<LinhaOrcamento, 'tipo' | 'previsto' | 'realizado'>, fracao: number): SituacaoOrcamento {
  const p = cent(l.previsto), r = cent(l.realizado);
  if (p === 0) return 'sem_orcamento';
  const esperado = p * fracao;
  if (l.tipo === 'saida') return r > p ? 'estourou' : r > esperado * 1.1 && r > 0 ? 'ritmo' : 'ok';
  return fracao > 0 && r < esperado * 0.9 ? 'abaixo' : 'ok';
}

export function totais(linhas: LinhaOrcamento[], tipo: 'entrada' | 'saida') {
  const ls = linhas.filter((l) => l.tipo === tipo);
  return { previsto: ls.reduce((s, l) => s + cent(l.previsto), 0), realizado: ls.reduce((s, l) => s + cent(l.realizado), 0), aRealizar: ls.reduce((s, l) => s + cent(l.a_realizar), 0) };
}
