import { expect, test } from 'vitest';
import { formatarDocumento, valorPorExtenso } from './recibo';

test('valor por extenso', () => {
  expect(valorPorExtenso('1.00')).toBe('um real');
  expect(valorPorExtenso('0.01')).toBe('um centavo');
  expect(valorPorExtenso('0.50')).toBe('cinquenta centavos');
  expect(valorPorExtenso('20.00')).toBe('vinte reais');
  expect(valorPorExtenso('100.00')).toBe('cem reais');
  expect(valorPorExtenso('101.00')).toBe('cento e um reais');
  expect(valorPorExtenso('115.30')).toBe('cento e quinze reais e trinta centavos');
  expect(valorPorExtenso('1000.00')).toBe('mil reais');
  expect(valorPorExtenso('1100.00')).toBe('mil e cem reais');
  expect(valorPorExtenso('2020.00')).toBe('dois mil e vinte reais');
  expect(valorPorExtenso('1234.56')).toBe('mil duzentos e trinta e quatro reais e cinquenta e seis centavos');
  expect(valorPorExtenso('1000000.00')).toBe('um milhão de reais');
  expect(valorPorExtenso('2500000.00')).toBe('dois milhões e quinhentos mil reais');
  expect(valorPorExtenso('1001.00')).toBe('mil e um reais');
});

test('CPF e CNPJ formatados', () => {
  expect(formatarDocumento('52998224725')).toBe('529.982.247-25');
  expect(formatarDocumento('11222333000181')).toBe('11.222.333/0001-81');
  expect(formatarDocumento(null)).toBe('');
});
