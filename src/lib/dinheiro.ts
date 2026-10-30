
const MAXIMO_CENTAVOS = 1_000_000_000n; // R$ 10.000.000,00

export function lerValorBRL(entrada: string): string | null {
  const s = entrada.trim().replace(/^R\$\s*/i, '');
  let inteiro: string;
  let decimais = '';
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s) || /^\d+(,\d{1,2})?$/.test(s)) {
    const [i = '', d = ''] = s.split(',');
    inteiro = i.replace(/\./g, '');
    decimais = d;
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    const [i = '', d = ''] = s.split('.');
    inteiro = i;
    decimais = d;
  } else {
    return null;
  }
  inteiro = inteiro.replace(/^0+(?=\d)/, '');
  if (inteiro.length > 8) return null;
  const centavos = BigInt(inteiro || '0') * 100n + BigInt((decimais + '00').slice(0, 2));
  if (centavos <= 0n || centavos > MAXIMO_CENTAVOS) return null;
  return deCentavos(centavos);
}

/**
 * O banco (PostgREST) devolve colunas numeric como NÚMERO no JSON (1621, 16.21), e a demonstração
 * devolve texto ("1621.00"). Aqui as duas formas viram o mesmo texto com 2 casas.
 */
export function textoValor(valor: string | number): string {
  return typeof valor === 'number' ? (Number.isFinite(valor) ? valor.toFixed(2) : 'inválido') : valor.trim();
}

function paraCentavos(valor: string | number): bigint {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(textoValor(valor));
  if (!m) throw new Error('valor inválido: ' + valor);
  const c = BigInt(m[2] ?? '0') * 100n + BigInt(((m[3] ?? '') + '00').slice(0, 2));
  return m[1] ? -c : c;
}

function deCentavos(c: bigint): string {
  const neg = c < 0n;
  const abs = neg ? -c : c;
  return `${neg ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

export function formatarBRL(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  const c = paraCentavos(valor);
  const neg = c < 0n;
  const abs = neg ? -c : c;
  const inteiro = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}R$ ${inteiro},${(abs % 100n).toString().padStart(2, '0')}`;
}

export function somar(valores: (string | number)[]): string {
  return deCentavos(valores.reduce((t, v) => t + paraCentavos(v), 0n));
}

export function negativo(valor: string | number): boolean {
  return paraCentavos(valor) < 0n;
}

/** Máscara de digitação estilo app de banco: só números, os 2 últimos são centavos ("12530" → "125,30").
 *  Funciona com o teclado numérico de qualquer celular, sem depender de vírgula ou ponto. */
export function mascararValor(texto: string): string {
  const d = texto.replace(/\D/g, '').replace(/^0+/, '').slice(0, 9); // teto do servidor: R$ 9.999.999,99
  if (!d) return '';
  const c = d.padStart(3, '0');
  return `${c.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${c.slice(-2)}`;
}

export function paraCampo(valor: string | number | null | undefined): string {
  return valor === null || valor === undefined || valor === '' ? '' : formatarBRL(valor).replace(/^-?R\$ /, '');
}
