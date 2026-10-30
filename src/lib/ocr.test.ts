import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { extrairDados } from './ocr';

const HOJE = '2026-10-27';

describe('extrairDados (texto da foto → sugestões)', () => {
  it('cupom fiscal típico', () => {
    const t = `PADARIA BOM PAO LTDA\nCNPJ 12.345.678/0001-90\nRUA XV 100\n20/10/2026 12:31\nPAO FRANCES 2 x 0,90 1,80\nCAFE 5,50\nTOTAL R$ 7,30\nDINHEIRO 10,00\nTROCO 2,70`;
    expect(extrairDados(t, HOJE)).toEqual({ valor: '7.30', data: '2026-10-20', emitente: 'PADARIA BOM PAO LTDA' });
  });
  it('comprovante de Pix com "Valor pago" e milhar', () => {
    const t = `Comprovante de Pix\nLoja Esportiva Exemplo\nValor pago R$ 1.234,56\n15/10/26`;
    expect(extrairDados(t, HOJE)).toMatchObject({ valor: '1234.56', data: '2026-10-15', emitente: 'Loja Esportiva Exemplo' });
  });
  it('sem a palavra total, usa o maior valor', () => {
    expect(extrairDados('3,00\n45,90\n12,00', HOJE).valor).toBe('45.90');
  });
  it('ignora datas impossíveis e futuras', () => {
    expect(extrairDados('31/02/2026 01/12/2026 05/10/2026', HOJE).data).toBe('2026-10-05');
  });
  it('texto vazio ou lixo não inventa nada', () => {
    expect(extrairDados('', HOJE)).toEqual({});
    expect(extrairDados('@@@ ### !!!', HOJE)).toEqual({});
  });
  it('nunca quebra e só devolve formatos que o servidor aceita', () => {
    fc.assert(fc.property(fc.string({ maxLength: 400 }), (s) => {
      const r = extrairDados(s, HOJE);
      if (r.valor) expect(r.valor).toMatch(/^\d{1,7}\.\d{2}$/);
      if (r.data) expect(r.data <= HOJE && /^\d{4}-\d{2}-\d{2}$/.test(r.data)).toBe(true);
      if (r.emitente) expect(r.emitente.length).toBeLessThanOrEqual(80);
    }), { numRuns: 500 });
  });
});
