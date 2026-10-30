// Pré-visualização; o valor cobrado é calculado no servidor (private.gerar_mensalidades).
// Vale o salário mínimo vigente 45 dias antes do vencimento (prazo do estatuto para aumento).
import type { CategoriaSocio, SalarioMinimo } from '@/dados/tipos';
import { somarDias } from '@/lib/datas';

export const DIAS_ANTECEDENCIA_AUMENTO = 45;

export function salarioMinimoPara(salarios: SalarioMinimo[], vencimento: string): string | null {
  const limite = somarDias(vencimento, -DIAS_ANTECEDENCIA_AUMENTO);
  const vale = salarios.filter((s) => s.vigente_desde <= limite).sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde))[0];
  return vale?.valor ?? null;
}

export function valorDaCategoria(c: Pick<CategoriaSocio, 'valor_mensalidade' | 'percentual_salario_minimo'>, salarios: SalarioMinimo[], vencimento: string): string | null {
  if (c.percentual_salario_minimo == null) return Number(c.valor_mensalidade).toFixed(2);
  const sm = salarioMinimoPara(salarios, vencimento);
  if (sm == null) return null;
  // em centavos para não errar o arredondamento (mesmo resultado do round(…, 2) do Postgres)
  const centavos = Math.round(Number(sm) * Number(c.percentual_salario_minimo));
  return (centavos / 100).toFixed(2);
}

export const fimFevereiro = (ano: number) => somarDias(`${ano}-03-01`, -1);

export function valorParcelaUnica(c: Pick<CategoriaSocio, 'percentual_parcela_unica'>, salarios: SalarioMinimo[], ano: number): string | null {
  if (c.percentual_parcela_unica == null) return null;
  const sm = salarioMinimoPara(salarios, fimFevereiro(ano));
  if (sm == null) return null;
  return (Math.round(Number(sm) * Number(c.percentual_parcela_unica)) / 100).toFixed(2);
}

export function anoParcelaAberta(hoje: string): number | null {
  const [a, m] = hoje.split('-').map(Number) as [number, number];
  if (m === 12) return a + 1;
  if (m <= 2) return a;
  return null;
}

export function proximoVencimento(hoje: string, dia: number): string {
  const [a, m] = hoje.split('-').map(Number) as [number, number];
  const noMes = `${a}-${String(m).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  if (noMes >= hoje) return noMes;
  const [a2, m2] = m === 12 ? [a + 1, 1] : [a, m + 1];
  return `${a2}-${String(m2).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export const formatarPercentual = (p: string | number) => `${Number(p).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
