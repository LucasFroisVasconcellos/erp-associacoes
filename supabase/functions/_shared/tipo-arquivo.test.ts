import { describe, expect, test } from 'vitest';
import { LIMITE_BYTES, LIMITE_PDF_BYTES, nomeSeguro, validarArquivo } from './tipo-arquivo';

const b = (...xs: (number | string)[]) => {
  const out: number[] = [];
  for (const x of xs) typeof x === 'string' ? out.push(...new TextEncoder().encode(x)) : out.push(x);
  return new Uint8Array(out);
};
const JPEG = b(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 'JFIF', 0);
const PNG = b(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d);
const WEBP = b('RIFF', 0, 0, 0, 0, 'WEBPVP8 ');
const PDF = b('%PDF-1.7\n%âãÏÓ\n');
const NFE = b('<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">');
const ZIP = b('PK', 3, 4, 20, 0, 6, 0);
const OLE = b(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
const CSV = b('Data;Valor\r\n01/10/2026;10,00\r\n');
const EXE = b('MZ', 0x90, 0, 3, 0);
const ELF = b(0x7f, 'ELF', 2, 1, 1);
const HTML = b('<!doctype html><html><script>alert(1)</script>');
const SVG = b('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');

describe('validarArquivo — comprovantes', () => {
  test.each([
    [JPEG, 'image/jpeg', 'jpg'], [PNG, 'image/png', 'png'], [WEBP, 'image/webp', 'webp'],
    [PDF, 'application/pdf', 'pdf'], [NFE, 'application/xml', 'xml'],
  ])('reconhece pelo conteúdo, não pela extensão', (bytes, mime, ext) => {
    expect(validarArquivo('comprovante', bytes, 'qualquer.bin')).toEqual({ ok: true, mime, ext });
  });
  test.each([[EXE, 'nota.pdf'], [ELF, 'foto.jpg'], [HTML, 'nota.pdf'], [SVG, 'nota.xml'], [ZIP, 'nota.pdf'], [CSV, 'nota.pdf'], [b(), 'vazio.pdf']])(
    'recusa conteúdo perigoso ou desconhecido mesmo com extensão "boa"', (bytes, nome) => {
      expect(validarArquivo('comprovante', bytes, nome).ok).toBe(false);
    });
  test('PDF vai até 50 MB; foto e o resto continuam em 10 MB', () => {
    const pdf20 = new Uint8Array(20 * 1024 * 1024); pdf20.set(PDF);
    expect(validarArquivo('documento', pdf20, 'estatuto.pdf').ok).toBe(true);
    const pdfGrande = new Uint8Array(LIMITE_PDF_BYTES + 1); pdfGrande.set(PDF);
    expect(validarArquivo('documento', pdfGrande, 'n.pdf')).toEqual({ ok: false, erro: 'grande_demais' });
    const jpg = new Uint8Array(LIMITE_BYTES + 1); jpg.set([0xff, 0xd8, 0xff]);
    expect(validarArquivo('documento', jpg, 'f.jpg')).toEqual({ ok: false, erro: 'grande_demais' });
    // disfarce: "PDF" que não começa com %PDF- não ganha o limite maior
    const falso = new Uint8Array(LIMITE_BYTES + 1); falso.set([0x25, 0x50]);
    expect(validarArquivo('documento', falso, 'n.pdf').ok).toBe(false);
  });
  test('XML com DOCTYPE/ENTITY é recusado (XXE)', () => {
    expect(validarArquivo('comprovante', b('<?xml version="1.0"?><!DOCTYPE nfeProc [<!ENTITY x "y">]><nfeProc>'), 'n.xml').ok).toBe(false);
  });
});

describe('validarArquivo — arquivos do contador', () => {
  test('aceita planilhas e textos conforme a extensão declarada e o conteúdo', () => {
    expect(validarArquivo('contador', ZIP, 'balancete.xlsx')).toMatchObject({ ok: true, ext: 'xlsx' });
    expect(validarArquivo('contador', ZIP, 'relatorio.docx')).toMatchObject({ ok: true, ext: 'docx' });
    expect(validarArquivo('contador', OLE, 'antigo.xls')).toMatchObject({ ok: true, ext: 'xls' });
    expect(validarArquivo('contador', CSV, 'razao.csv')).toMatchObject({ ok: true, ext: 'csv', mime: 'text/csv' });
    expect(validarArquivo('contador', b('OFXHEADER:100\nDATA:OFXSGML\n'), 'extrato.ofx')).toMatchObject({ ok: true, ext: 'ofx' });
    expect(validarArquivo('contador', PDF, 'dre.pdf')).toMatchObject({ ok: true, ext: 'pdf' });
  });
  test('recusa ZIP com extensão que não é de escritório, binários e texto com NUL', () => {
    expect(validarArquivo('contador', ZIP, 'pacote.zip').ok).toBe(false);
    expect(validarArquivo('contador', EXE, 'balancete.csv').ok).toBe(false);
    expect(validarArquivo('contador', b('a;b', 0, 'c'), 'x.csv').ok).toBe(false);
    expect(validarArquivo('contador', HTML, 'x.txt').ok).toBe(false);
  });
});

describe('nomeSeguro', () => {
  test('remove caminho, caracteres proibidos e controle; limita tamanho', () => {
    expect(nomeSeguro('C:\\Users\\x\\..\\balancete set.pdf')).toBe('balancete set.pdf');
    expect(nomeSeguro('../../etc/passwd')).toBe('passwd');
    expect(nomeSeguro('<script>alert(1)</script>.pdf')).toBe('script.pdf'); // a barra conta como caminho
    expect(nomeSeguro('a\u0000b\u0007c.pdf')).toBe('abc.pdf');
    expect(nomeSeguro('x'.repeat(300) + '.pdf').length).toBeLessThanOrEqual(150);
    expect(nomeSeguro('')).toBe('arquivo');
  });
});
