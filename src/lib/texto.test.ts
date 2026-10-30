import { expect, test } from 'vitest';
import { contar } from './texto';

test('plural em português, com o número na frente', () => {
  expect(contar(1, 'saída sem comprovante', 'saídas sem comprovante')).toBe('1 saída sem comprovante');
  expect(contar(2, 'saída sem comprovante', 'saídas sem comprovante')).toBe('2 saídas sem comprovante');
  expect(contar(0, 'pendência', 'pendências')).toBe('0 pendências');
});
