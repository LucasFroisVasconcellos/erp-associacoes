// DOMParser não resolve entidades externas, e DOCTYPE/ENTITY é recusado antes mesmo de ler.
import { chaveAcessoValida } from './nfce';

export interface ItemNota { descricao: string; quantidade: string; valor: string | null }
export type NotaFiscal =
  | { ok: true; chave: string; emitente: string | null; cnpj: string | null; data: string | null; valor: string | null; itens: ItemNota[] }
  | { ok: false; erro: string };

const texto = (raiz: Element | Document, tag: string): string | null => {
  const el = raiz.getElementsByTagNameNS('*', tag)[0] ?? raiz.getElementsByTagName(tag)[0];
  const t = el?.textContent?.trim();
  return t ? t.slice(0, 200) : null;
};

function decimal(v: string | null): string | null {
  if (!v || !/^\d{1,10}(\.\d{1,2})?$/.test(v)) return null;
  const [i = '0', d = ''] = v.split('.');
  return `${i.replace(/^0+(?=\d)/, '')}.${(d + '00').slice(0, 2)}`;
}

function quantidade(v: string | null): string {
  if (!v || !/^\d{1,11}(\.\d{1,4})?$/.test(v)) return '';
  return v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v;
}

export function lerXmlNfe(xml: string): NotaFiscal {
  if (xml.length > 5_000_000) return { ok: false, erro: 'grande_demais' };
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return { ok: false, erro: 'xml_perigoso' };
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return { ok: false, erro: 'xml_invalido' };
  const raiz = doc.documentElement?.localName;
  if (raiz !== 'nfeProc' && raiz !== 'NFe') return { ok: false, erro: 'nao_e_nfe' };
  const inf = doc.getElementsByTagNameNS('*', 'infNFe')[0];
  const chave = (inf?.getAttribute('Id') ?? '').replace(/^NFe/, '');
  if (!chaveAcessoValida(chave)) return { ok: false, erro: 'chave' };
  const emit = doc.getElementsByTagNameNS('*', 'emit')[0];
  const dh = texto(doc, 'dhEmi') ?? texto(doc, 'dEmi');
  const data = dh && /^\d{4}-\d{2}-\d{2}/.test(dh) ? dh.slice(0, 10) : null;
  const itens: ItemNota[] = [];
  const dets = doc.getElementsByTagNameNS('*', 'det');
  for (let i = 0; i < Math.min(dets.length, 200); i++) {
    const det = dets[i];
    if (!det) continue;
    itens.push({ descricao: texto(det, 'xProd') ?? '', quantidade: quantidade(texto(det, 'qCom')), valor: decimal(texto(det, 'vProd')) });
  }
  return {
    ok: true, chave,
    emitente: emit ? texto(emit, 'xNome') : null,
    cnpj: emit ? (texto(emit, 'CNPJ') ?? texto(emit, 'CPF')) : null,
    data, valor: decimal(texto(doc, 'vNF')), itens,
  };
}
