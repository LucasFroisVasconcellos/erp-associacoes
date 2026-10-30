// Agenda em .ics (RFC 5545). Leva só os dados do evento, nunca a lista de participantes.
import { somarDias } from './datas';

export interface EventoIcs {
  id: string; titulo: string; inicio: string; fim: string; dia_inteiro: boolean;
  local?: string | null; descricao?: string | null; tipo?: string | null; cancelado_em?: string | null;
}

/** Escape de texto (RFC 5545 §3.3.11): barra, ponto e vírgula, vírgula e quebras de linha. */
export function escaparTexto(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n')
    // demais caracteres de controle não são permitidos no conteúdo
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
}

/** Dobra linhas com mais de 75 bytes (UTF-8), sem cortar um caractere ao meio (§3.1). */
export function dobrar(linha: string): string {
  const cod = new TextEncoder();
  const partes: string[] = [];
  let atual = '';
  let bytes = 0;
  for (const ch of linha) {
    const n = cod.encode(ch).length;
    const limite = partes.length === 0 ? 75 : 74;
    if (bytes + n > limite) { partes.push(atual); atual = ''; bytes = 0; }
    atual += ch; bytes += n;
  }
  partes.push(atual);
  return partes.join('\r\n ');
}

const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dataIcs = (d: string) => d.replace(/-/g, '');

export function gerarIcs(eventos: EventoIcs[], agora: Date = new Date(), dataLocal: (iso: string) => string): string {
  const linhas = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Associação Exemplo//Gestao da diretoria//PT-BR', 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', 'X-WR-CALNAME:Agenda Associação Exemplo'];
  const carimbo = utc(agora.toISOString());
  for (const e of eventos) {
    if (e.cancelado_em) continue;
    linhas.push('BEGIN:VEVENT', `UID:${e.id}@erp-associacoes`, `DTSTAMP:${carimbo}`);
    if (e.dia_inteiro) {
      // no .ics o fim de evento de dia inteiro é o dia SEGUINTE ao último dia (exclusivo)
      linhas.push(`DTSTART;VALUE=DATE:${dataIcs(dataLocal(e.inicio))}`, `DTEND;VALUE=DATE:${dataIcs(somarDias(dataLocal(e.fim), 1))}`);
    } else {
      linhas.push(`DTSTART:${utc(e.inicio)}`, `DTEND:${utc(e.fim > e.inicio ? e.fim : new Date(new Date(e.inicio).getTime() + 3_600_000).toISOString())}`);
    }
    linhas.push(`SUMMARY:${escaparTexto(e.titulo)}`);
    if (e.local) linhas.push(`LOCATION:${escaparTexto(e.local)}`);
    if (e.descricao) linhas.push(`DESCRIPTION:${escaparTexto(e.descricao)}`);
    if (e.tipo) linhas.push(`CATEGORIES:${escaparTexto(e.tipo)}`);
    linhas.push('END:VEVENT');
  }
  linhas.push('END:VCALENDAR');
  return linhas.map(dobrar).join('\r\n') + '\r\n';
}
