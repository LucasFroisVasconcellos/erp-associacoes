import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { asciiPix, brCodePix, brCodeValido, crc16 } from './pix';

describe('crc16 (CCITT-FALSE)', () => {
  test('valor de conferência padrão do algoritmo', () => {
    expect(crc16('123456789')).toBe('29B1');
  });
  test('exemplo do manual do BR Code (Banco Central)', () => {
    const semCrc = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304';
    expect(crc16(semCrc)).toBe('1D3D');
  });
});

describe('brCodePix', () => {
  const base = { chave: 'tesouraria@exemplo.test', nome: 'Associação Exemplo de Esportes Adaptados', cidade: 'Cidade Exemplo' };

  test('monta os campos na ordem e com tamanhos certos', () => {
    const c = brCodePix({ ...base, valor: '30', txid: 'ERPX0123456789ABCDEF01234' });
    expect(c.startsWith('000201')).toBe(true);
    expect(c).toContain('0014br.gov.bcb.pix0123tesouraria@exemplo.test');
    expect(c).toContain('540530.00');
    expect(c).toContain('5802BR');
    expect(c).toContain('5925ASSOCIACAO EXEMPLO DE ESP'); // corta em 25, sem acento
    expect(c).toContain('6014CIDADE EXEMPLO');
    expect(c).toContain('62290525ERPX0123456789ABCDEF01234');
    expect(brCodeValido(c)).toBe(true);
  });

  test('sem valor: o campo 54 não vai; sem txid: "***"', () => {
    const c = brCodePix(base);
    expect(c).not.toMatch(/54\d{2}\d/);
    expect(c).toContain('0503***');
  });

  test('txid é limpo (só letras e números)', () => {
    expect(brCodePix({ ...base, txid: 'AB-CD/12' })).toContain('0506ABCD12');
  });

  test('recusa dados inválidos', () => {
    expect(() => brCodePix({ ...base, chave: ' ' })).toThrow();
    expect(() => brCodePix({ ...base, nome: '!!' })).toThrow();
  });

  test('qualquer alteração no código quebra a conferência', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 60 }), fc.constantFrom('0', '1', 'A', 'Z'), (pos, ch) => {
      const c = brCodePix({ ...base, valor: '45.50', txid: 'ERPXX' });
      const alterado = c.slice(0, pos) + ch + c.slice(pos + 1);
      return alterado === c || !brCodeValido(alterado);
    }), { seed: 20261101 });
  });

  test('nada além de ASCII imprimível no código', () => {
    fc.assert(fc.property(fc.string({ minLength: 3, maxLength: 40 }), fc.string({ minLength: 2, maxLength: 30 }), (nome, cidade) => {
      const n = asciiPix(nome, 25), cid = asciiPix(cidade, 15);
      if (n.length < 3 || cid.length < 2) return true;
      return /^[\x20-\x7e]+$/.test(brCodePix({ chave: 'a@b.co', nome, cidade }));
    }), { seed: 20261102 });
  });
});
