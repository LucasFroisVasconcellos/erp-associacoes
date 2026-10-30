// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { lerXmlNfe } from './nfe';

const CHAVE = '35261012345678000190550010000001231123456785';
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe><infNFe Id="NFe${CHAVE}" versao="4.00">
    <ide><dhEmi>2026-10-18T14:30:00-03:00</dhEmi></ide>
    <emit><CNPJ>12345678000190</CNPJ><xNome>Loja de Esportes Exemplo LTDA</xNome></emit>
    <det nItem="1"><prod><xProd>Bola de handebol</xProd><qCom>2.0000</qCom><vProd>180.00</vProd></prod></det>
    <det nItem="2"><prod><xProd>Apito</xProd><qCom>1.0000</qCom><vProd>15.50</vProd></prod></det>
    <total><ICMSTot><vNF>195.50</vNF></ICMSTot></total>
  </infNFe></NFe>
</nfeProc>`;

describe('lerXmlNfe', () => {
  test('extrai fornecedor, data, valor, chave e itens', () => {
    expect(lerXmlNfe(xml)).toEqual({
      ok: true, chave: CHAVE, emitente: 'Loja de Esportes Exemplo LTDA', cnpj: '12345678000190',
      data: '2026-10-18', valor: '195.50',
      itens: [{ descricao: 'Bola de handebol', quantidade: '2', valor: '180.00' }, { descricao: 'Apito', quantidade: '1', valor: '15.50' }],
    });
  });
  test('recusa XML com DOCTYPE/entidades (XXE) e documentos que não são NF-e', () => {
    expect(lerXmlNfe(`<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><nfeProc>&e;</nfeProc>`).ok).toBe(false);
    expect(lerXmlNfe('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').ok).toBe(false);
    expect(lerXmlNfe('não é xml').ok).toBe(false);
    expect(lerXmlNfe(xml.replace(CHAVE, CHAVE.slice(0, 43) + '0')).ok).toBe(false);
  });
  test('valores estranhos viram nulos (a pessoa confere antes de salvar)', () => {
    const r = lerXmlNfe(xml.replace('<vNF>195.50</vNF>', '<vNF>-1e9</vNF>'));
    expect(r.ok).toBe(true);
    expect(r.ok && r.valor).toBeNull();
  });
});
