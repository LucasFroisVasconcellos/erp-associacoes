// Datas YYYY-MM-DD no fuso America/Sao_Paulo. O "hoje" das regras vem do servidor; este só preenche formulários.

export const FUSO = 'America/Sao_Paulo';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function hojeSP(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

export function formatarData(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

export function competencia(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function mesPorExtenso(iso: string): string {
  const [ano, mes] = iso.split('-');
  return `${MESES[Number(mes) - 1] ?? '?'} de ${ano}`;
}

/** Soma dias a uma data ISO sem passar por fuso (meio-dia UTC evita virar o dia). */
export function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function mesAnterior(isoCompetencia: string): string {
  const d = new Date(`${isoCompetencia.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
}
