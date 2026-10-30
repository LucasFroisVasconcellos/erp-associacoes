import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { decodificar, lerCsv, lerData, lerOfx, lerValor } from './extrato';

describe('datas e valores', () => {
  test('datas em vários formatos; data impossível é recusada', () => {
    expect(lerData('20261005120000[-3:BRT]')).toBe('2026-10-05');
    expect(lerData('05/10/2026')).toBe('2026-10-05');
    expect(lerData('5/1/26')).toBe('2026-01-05');
    expect(lerData('2026-02-30')).toBeNull();
    expect(lerData('31/02/2026')).toBeNull();
    expect(lerData('ontem')).toBeNull();
  });
  test('valores brasileiros, com D/C, parênteses e R$', () => {
    expect(lerValor('1.234,56')).toBe('1234.56');
    expect(lerValor('-1234.56')).toBe('-1234.56');
    expect(lerValor('1234,56 D')).toBe('-1234.56');
    expect(lerValor('50,00C')).toBe('50.00');
    expect(lerValor('(12,00)')).toBe('-12.00');
    expect(lerValor('R$ 10,00')).toBe('10.00');
    expect(lerValor('1,234.50')).toBe('1234.50');
    expect(lerValor('0,00')).toBeNull();
    expect(lerValor('=1+1')).toBeNull();
  });
  test('qualquer texto: ou null, ou um valor no formato que o servidor aceita', () => {
    fc.assert(fc.property(fc.string(), (t) => { const v = lerValor(t); return v === null || /^-?\d{1,9}\.\d{2}$/.test(v); }), { seed: 20261120 });
    fc.assert(fc.property(fc.string(), (t) => { const d = lerData(t); return d === null || /^\d{4}-\d{2}-\d{2}$/.test(d); }), { seed: 20261121 });
  });
});

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
CHARSET:1252

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261005120000[-3:BRT]<TRNAMT>100.00<FITID>ABC-1<MEMO>PIX RECEBIDO JOAO
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261006<TRNAMT>-2.50<FITID>ABC-2<NAME>TARIFA<MEMO>TARIFA
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>xx<TRNAMT>-1.00<FITID>ABC-3<MEMO>RUIM
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe('OFX', () => {
  test('SGML: lê as transações e descarta a inválida', () => {
    const r = lerOfx(OFX_SGML);
    expect(r.linhas).toEqual([
      { data: '2026-10-05', valor: '100.00', descricao: 'PIX RECEBIDO JOAO', id: 'ABC-1' },
      { data: '2026-10-06', valor: '-2.50', descricao: 'TARIFA', id: 'ABC-2' },
    ]);
    expect(r.ignoradas).toBe(1);
  });
  test('XML 2.x com tags fechadas e id com caractere estranho (não vira id)', () => {
    const r = lerOfx('<OFX><STMTTRN><DTPOSTED>20261001</DTPOSTED><TRNAMT>-10.5</TRNAMT><FITID>a b<c</FITID><MEMO>CONTA DE LUZ</MEMO></STMTTRN></OFX>');
    expect(r.linhas).toEqual([{ data: '2026-10-01', valor: '-10.50', descricao: 'CONTA DE LUZ', id: undefined }]);
  });
  test('Windows-1252: acentos corretos', () => {
    const bytes = new Uint8Array([...new TextEncoder().encode('CHARSET:1252\n<OFX><STMTTRN><DTPOSTED>20261001<TRNAMT>1<MEMO>'), 0xc7, 0xc3, 0x4f]).buffer;
    expect(lerOfx(decodificar(bytes)).linhas[0]!.descricao).toBe('ÇÃO');
  });
  test('qualquer texto: nunca quebra e só devolve linhas válidas', () => {
    fc.assert(fc.property(fc.string({ maxLength: 400 }), (t) => lerOfx(`<STMTTRN>${t}`).linhas.every((l) => /^\d{4}-\d{2}-\d{2}$/.test(l.data) && !/[\u0000-\u001f]/.test(l.descricao))), { seed: 20261122 });
  });
});

describe('CSV', () => {
  test('cabeçalho com nomes diferentes, crédito/débito separados e linha de saldo ignorada', async () => {
    const r = await lerCsv('Extrato da conta\nData;Histórico;Crédito;Débito\n01/10/2026;SALDO ANTERIOR;100,00;\n02/10/2026;PIX RECEBIDO;50,00;\n03/10/2026;TARIFA;;2,50\n');
    expect(r.linhas).toEqual([
      { data: '2026-10-02', valor: '50.00', descricao: 'PIX RECEBIDO', id: undefined },
      { data: '2026-10-03', valor: '-2.50', descricao: 'TARIFA', id: undefined },
    ]);
  });
  test('coluna única de valor com sinal', async () => {
    const r = await lerCsv('data,descricao,valor\n2026-10-04,"Doação, rifa",-15.00\n');
    expect(r.linhas).toEqual([{ data: '2026-10-04', valor: '-15.00', descricao: 'Doação, rifa', id: undefined }]);
  });
  test('sem cabeçalho reconhecível: nada é lido', async () => {
    expect((await lerCsv('a,b,c\n1,2,3\n')).linhas).toEqual([]);
  });
});
