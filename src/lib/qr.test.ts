import * as z from '@zxing/library';
import { expect, test } from 'vitest';
import { brCodePix } from './pix';
import { matrizQrCom } from './qr';

// Desenha a matriz em pixels (4 px por módulo, com borda) e lê de volta com o leitor do zxing.
function ler(matriz: boolean[][]): string {
  const escala = 4, borda = 4, n = matriz.length, lado = (n + borda * 2) * escala;
  const lum = new Uint8ClampedArray(lado * lado).fill(255);
  matriz.forEach((linha, y) => linha.forEach((escuro, x) => {
    if (!escuro) return;
    for (let dy = 0; dy < escala; dy++) for (let dx = 0; dx < escala; dx++) lum[((y + borda) * escala + dy) * lado + (x + borda) * escala + dx] = 0;
  }));
  const fonte = new z.RGBLuminanceSource(lum, lado, lado);
  return new z.QRCodeReader().decode(new z.BinaryBitmap(new z.HybridBinarizer(fonte))).getText();
}

test('o QR desenhado lê de volta exatamente o código Pix', () => {
  const codigo = brCodePix({ chave: 'tesouraria@exemplo.test', nome: 'Associacao Exemplo', cidade: 'Cidade Exemplo', valor: '30.00', txid: 'ERPX0123456789ABCDEF01234' });
  expect(ler(matrizQrCom(z, codigo))).toBe(codigo);
});
