import { describe, expect, test } from 'vitest';
import { chaveAcessoValida, lerQrNfce } from './nfce';

const CHAVE = '35261012345678000190550010000001231123456785';

describe('chave de acesso (NF-e/NFC-e)', () => {
  test('aceita DV correto e recusa qualquer dígito trocado', () => {
    expect(chaveAcessoValida(CHAVE)).toBe(true);
    for (let i = 0; i < CHAVE.length; i++) {
      const t = CHAVE.slice(0, i) + String((Number(CHAVE[i]) + 1) % 10) + CHAVE.slice(i + 1);
      expect(chaveAcessoValida(t)).toBe(false);
    }
  });
});

describe('QR code da NFC-e', () => {
  test('lê a chave da URL oficial da Sefaz', () => {
    const url = `https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=${CHAVE}|2|1|1|ABCDEF`;
    expect(lerQrNfce(url)).toEqual({ ok: true, chave: CHAVE, url, uf: '35' });
  });
  test('recusa domínio fora do governo, http e esquemas perigosos', () => {
    for (const url of [
      `https://fazenda.sp.gov.br.golpe.com/x?p=${CHAVE}|2`,
      `http://www.nfce.fazenda.sp.gov.br/x?p=${CHAVE}|2`,
      `javascript:alert(1)//?p=${CHAVE}`,
      `https://evil.com/?p=${CHAVE}`,
      'texto qualquer',
    ]) expect(lerQrNfce(url).ok, url).toBe(false);
  });
  test('recusa chave com DV inválido', () => {
    const ruim = CHAVE.slice(0, 43) + '0';
    expect(lerQrNfce(`https://www.nfce.fazenda.sp.gov.br/x?p=${ruim}|2`).ok).toBe(false);
  });
});
