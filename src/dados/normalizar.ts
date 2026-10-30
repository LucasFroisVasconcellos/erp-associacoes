// O PostgREST devolve numeric como número no JSON; o sistema trata dinheiro e porcentagem como texto com 2 casas.
// Lista fechada de campos: inteiros como dia, ano e número da camisa continuam números.
export const CAMPOS_DECIMAIS = new Set([
  'valor', 'valor_mensalidade', 'valor_aprovado', 'valor_estimado', 'valor_pedido', 'valor_prestado', 'valor_previsto',
  'valor_recebido', 'valor_contrapartida', 'contribuicao_valor', 'custo', 'credito', 'debito', 'orcamento', 'preco_unitario',
  'saldo', 'saldo_anterior', 'saldo_atual', 'saldo_inicial', 'previsto', 'realizado', 'a_realizar', 'total',
  'percentual_salario_minimo', 'percentual_parcela_unica',
]);

export function normalizarDecimais<T>(x: T, profundidade = 0): T {
  if (profundidade > 12 || x === null || typeof x !== 'object') return x;
  if (Array.isArray(x)) return x.map((v) => normalizarDecimais(v, profundidade + 1)) as T;
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    saida[k] = typeof v === 'number' && CAMPOS_DECIMAIS.has(k) && Number.isFinite(v) ? v.toFixed(2) : normalizarDecimais(v, profundidade + 1);
  }
  return saida as T;
}
