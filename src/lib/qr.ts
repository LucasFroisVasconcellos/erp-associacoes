import type * as Zxing from '@zxing/library';

export function matrizQrCom(z: typeof Zxing, texto: string): boolean[][] {
  const m = z.QRCodeEncoder.encode(texto, z.QRCodeDecoderErrorCorrectionLevel.M).getMatrix();
  return Array.from({ length: m.getHeight() }, (_, y) => Array.from({ length: m.getWidth() }, (_, x) => m.get(x, y) === 1));
}
