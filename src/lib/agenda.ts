// Datas e horas da agenda no fuso America/Sao_Paulo; o banco guarda instantes (timestamptz).
import { FUSO, hojeSP, somarDias } from './datas';

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const NOMES_DIAS_CURTOS = DIAS_CURTOS;

export function dataSP(iso: string): string {
  return hojeSP(new Date(iso));
}

export function horaSP(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

function deslocamentoMin(ms: number): number {
  const nome = new Intl.DateTimeFormat('en-US', { timeZone: FUSO, timeZoneName: 'longOffset' }).formatToParts(new Date(ms))
    .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(nome);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/** Data + hora locais → instante ISO com o fuso explícito, calculado para aquele dia (aguenta horário de verão). */
export function instanteSP(data: string, hora: string): string {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  const h = /^(\d{2}):(\d{2})$/.exec(hora);
  if (!d || !h) throw new Error('data ou hora inválida');
  const comoUtc = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(h[1]), Number(h[2]));
  let off = deslocamentoMin(comoUtc);
  off = deslocamentoMin(comoUtc - off * 60_000); // segunda volta: acerta perto de troca de horário
  const sinal = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  return `${data}T${hora}:00${sinal}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export function diaDaSemana(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

export function diaPorExtenso(iso: string): string {
  const [ano, mes, dia] = iso.split('-').map(Number);
  const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  void ano;
  return `${DIAS[diaDaSemana(iso)]}, ${dia} de ${meses[(mes ?? 1) - 1]}`;
}

export function inicioDaSemana(iso: string): string {
  return somarDias(iso, -diaDaSemana(iso));
}

export function semanaDe(iso: string): string[] {
  const ini = inicioDaSemana(iso);
  return Array.from({ length: 7 }, (_, i) => somarDias(ini, i));
}

export function gradeDoMes(iso: string): string[][] {
  const primeiro = `${iso.slice(0, 7)}-01`;
  const ultimo = somarDias(somarDias(primeiro, 32).slice(0, 8) + '01', -1);
  const semanas: string[][] = [];
  for (let ini = inicioDaSemana(primeiro); ini <= ultimo; ini = somarDias(ini, 7)) semanas.push(semanaDe(ini));
  return semanas;
}

export function outroMes(iso: string, delta: number): string {
  const d = new Date(`${iso.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 10);
}

export interface Periodo { inicio: string; fim: string }

export function diasDoEvento(e: { inicio: string; fim: string; dia_inteiro: boolean }): string[] {
  const ini = dataSP(e.inicio);
  let fim = dataSP(e.fim);
  // evento com hora que termina exatamente à meia-noite não ocupa o dia seguinte
  if (!e.dia_inteiro && fim > ini && horaSP(e.fim) === '00:00') fim = somarDias(fim, -1);
  const dias: string[] = [];
  for (let d = ini; d <= fim && dias.length < 63; d = somarDias(d, 1)) dias.push(d);
  return dias;
}

export { DIAS };
