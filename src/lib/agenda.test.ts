import { describe, expect, test } from 'vitest';
import { dataSP, diaPorExtenso, diasDoEvento, gradeDoMes, horaSP, instanteSP, outroMes, semanaDe } from './agenda';
import { dobrar, escaparTexto, gerarIcs } from './ics';

describe('datas da agenda no fuso de Cidade Exemplo', () => {
  test('data e hora locais → instante com o fuso explícito, e de volta', () => {
    const i = instanteSP('2026-11-03', '19:30');
    expect(i).toBe('2026-11-03T19:30:00-03:00');
    expect(dataSP(i)).toBe('2026-11-03');
    expect(horaSP(i)).toBe('19:30');
  });

  test('23h30 em Cidade Exemplo já é o dia seguinte em UTC, mas a data local continua certa', () => {
    const i = instanteSP('2026-12-31', '23:30');
    expect(new Date(i).toISOString()).toBe('2027-01-01T02:30:00.000Z');
    expect(dataSP(i)).toBe('2026-12-31');
  });

  test('entrada malformada é recusada', () => {
    expect(() => instanteSP('2026-11-3', '19:30')).toThrow();
    expect(() => instanteSP('2026-11-03', '7:30')).toThrow();
  });

  test('grade do mês: semanas completas de domingo a sábado, cobrindo o mês todo', () => {
    const g = gradeDoMes('2026-02-15'); // fevereiro de 2026 começa num domingo
    expect(g[0]![0]).toBe('2026-02-01');
    expect(g.every((s) => s.length === 7)).toBe(true);
    expect(g.flat()).toContain('2026-02-28');
    const m = gradeDoMes('2026-10-21');
    expect(m[0]![0]).toBe('2026-09-27');
    expect(m.at(-1)!.at(-1)).toBe('2026-10-31');
  });

  test('semana, troca de mês e ano bissexto', () => {
    expect(semanaDe('2026-10-21')).toEqual(['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
    expect(outroMes('2026-01-31', 1)).toBe('2026-02-01');
    expect(outroMes('2026-01-15', -1)).toBe('2025-12-01');
    expect(gradeDoMes('2028-02-10').flat()).toContain('2028-02-29');
    expect(diaPorExtenso('2026-11-03')).toBe('terça, 3 de novembro');
  });

  test('dias ocupados por um evento', () => {
    expect(diasDoEvento({ inicio: instanteSP('2026-11-03', '19:30'), fim: instanteSP('2026-11-03', '21:00'), dia_inteiro: false })).toEqual(['2026-11-03']);
    expect(diasDoEvento({ inicio: instanteSP('2026-11-06', '00:00'), fim: instanteSP('2026-11-08', '00:00'), dia_inteiro: true }))
      .toEqual(['2026-11-06', '2026-11-07', '2026-11-08']);
    // termina à meia-noite: não ocupa o dia seguinte
    expect(diasDoEvento({ inicio: instanteSP('2026-11-03', '20:00'), fim: instanteSP('2026-11-04', '00:00'), dia_inteiro: false })).toEqual(['2026-11-03']);
  });
});

describe('.ics (RFC 5545)', () => {
  const agora = new Date('2026-10-21T12:00:00Z');
  test('escape de barra, vírgula, ponto e vírgula e quebra de linha; sem caracteres de controle', () => {
    expect(escaparTexto('Treino; quadra 2, sede\\fundos\nlevar bola\u0007')).toBe('Treino\\; quadra 2\\, sede\\\\fundos\\nlevar bola');
  });

  test('dobra linhas longas em até 75 bytes sem quebrar acentos', () => {
    const longa = 'SUMMARY:' + 'ação '.repeat(40);
    const dobrada = dobrar(longa);
    for (const l of dobrada.split('\r\n')) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(dobrada.split('\r\n').map((l, i) => (i ? l.slice(1) : l)).join('')).toBe(longa);
  });

  test('evento com hora em UTC; dia inteiro com fim exclusivo; cancelado fica de fora', () => {
    const ics = gerarIcs([
      { id: 'a', titulo: 'Treino', inicio: instanteSP('2026-11-03', '19:30'), fim: instanteSP('2026-11-03', '21:30'), dia_inteiro: false, local: 'Ginásio, quadra 2', tipo: 'Treino' },
      { id: 'b', titulo: 'Campeonato Paulista', inicio: instanteSP('2026-11-06', '00:00'), fim: instanteSP('2026-11-08', '00:00'), dia_inteiro: true },
      { id: 'c', titulo: 'Cancelado', inicio: instanteSP('2026-11-04', '10:00'), fim: instanteSP('2026-11-04', '11:00'), dia_inteiro: false, cancelado_em: '2026-10-20T10:00:00Z' },
    ], agora, dataSP);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART:20261103T223000Z');
    expect(ics).toContain('LOCATION:Ginásio\\, quadra 2');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261106');
    expect(ics).toContain('DTEND;VALUE=DATE:20261109');
    expect(ics).toContain('UID:a@erp-associacoes');
    expect(ics).not.toContain('Cancelado');
    expect(ics.split('BEGIN:VEVENT').length - 1).toBe(2);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/\n/);
  });
});
