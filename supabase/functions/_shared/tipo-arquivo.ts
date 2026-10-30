// Tipo REAL pelos bytes iniciais, não pela extensão nem pelo Content-Type. Roda na Edge Function e no navegador.

export const LIMITE_BYTES = 10 * 1024 * 1024; // 10 MB: fotos, XML, planilhas e textos
/** PDF vai até 50 MB, o máximo do Supabase no plano gratuito. */
export const LIMITE_PDF_BYTES = 50 * 1024 * 1024;

export type Destino = 'comprovante' | 'contador' | 'documento';
export type Resultado = { ok: true; mime: string; ext: string } | { ok: false; erro: string };

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf', xml: 'application/xml',
  csv: 'text/csv', txt: 'text/plain', ofx: 'application/x-ofx', xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function comeca(bytes: Uint8Array, assinatura: number[], deslocamento = 0): boolean {
  if (bytes.length < deslocamento + assinatura.length) return false;
  return assinatura.every((v, i) => bytes[deslocamento + i] === v);
}
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

function tipoBinario(bytes: Uint8Array): string | null {
  if (comeca(bytes, [0xff, 0xd8, 0xff])) return 'jpg';
  if (comeca(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (comeca(bytes, ascii('RIFF')) && comeca(bytes, ascii('WEBP'), 8)) return 'webp';
  if (comeca(bytes, ascii('%PDF-'))) return 'pdf';
  if (comeca(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'zip';
  if (comeca(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole';
  return null;
}

function executavel(bytes: Uint8Array): boolean {
  return comeca(bytes, ascii('MZ')) || comeca(bytes, [0x7f, 0x45, 0x4c, 0x46]) || comeca(bytes, ascii('#!'))
    || comeca(bytes, [0xfe, 0xed, 0xfa, 0xce]) || comeca(bytes, [0xce, 0xfa, 0xed, 0xfe])
    || comeca(bytes, [0xfe, 0xed, 0xfa, 0xcf]) || comeca(bytes, [0xcf, 0xfa, 0xed, 0xfe]);
}

/** Texto "seguro": sem byte nulo e sem marcação ativa (HTML, SVG, script, DOCTYPE/ENTITY). */
function textoSeguro(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  const inicio = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 65536));
  if (/<\s*(html|svg|script|iframe|object|embed)\b|<!doctype|<!entity|javascript:/i.test(inicio)) return null;
  return inicio;
}

function extensao(nome: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(nome.trim());
  return m?.[1] ? m[1].toLowerCase() : '';
}

export function validarArquivo(destino: Destino, bytes: Uint8Array, nomeDeclarado: string): Resultado {
  if (bytes.length === 0) return { ok: false, erro: 'vazio' };
  if (bytes.length > LIMITE_PDF_BYTES) return { ok: false, erro: 'grande_demais' };
  if (executavel(bytes)) return { ok: false, erro: 'tipo_nao_permitido' };

  const bin = tipoBinario(bytes);
  // só o PDF ganha o limite maior; todo o resto continua em 10 MB
  if (bin !== 'pdf' && bytes.length > LIMITE_BYTES) return { ok: false, erro: 'grande_demais' };
  const ext = extensao(nomeDeclarado);
  const ok = (e: string): Resultado => ({ ok: true, mime: MIME[e] ?? 'application/octet-stream', ext: e });

  if (destino === 'documento') {
    return bin === 'jpg' || bin === 'png' || bin === 'webp' || bin === 'pdf' ? ok(bin) : { ok: false, erro: 'tipo_nao_permitido' };
  }

  if (destino === 'comprovante') {
    if (bin === 'jpg' || bin === 'png' || bin === 'webp' || bin === 'pdf') return ok(bin);
    if (bin) return { ok: false, erro: 'tipo_nao_permitido' };
    const txt = textoSeguro(bytes);
    if (txt === null) return { ok: false, erro: 'tipo_nao_permitido' };
    const semBom = txt.replace(/^﻿/, '').trimStart();
    const ehXml = semBom.startsWith('<?xml') || semBom.startsWith('<');
    const ehNota = /<(nfeProc|NFe|CFe|procEventoNFe)\b/.test(semBom.slice(0, 4096));
    return ehXml && ehNota ? ok('xml') : { ok: false, erro: 'tipo_nao_permitido' };
  }

  if (bin === 'pdf') return ok('pdf');
  if (bin === 'zip') return ext === 'xlsx' || ext === 'docx' ? ok(ext) : { ok: false, erro: 'tipo_nao_permitido' };
  if (bin === 'ole') return ext === 'xls' ? ok('xls') : { ok: false, erro: 'tipo_nao_permitido' };
  if (bin) return { ok: false, erro: 'tipo_nao_permitido' };
  const txt = textoSeguro(bytes);
  if (txt === null) return { ok: false, erro: 'tipo_nao_permitido' };
  if (ext === 'ofx') return /OFXHEADER|<OFX>/i.test(txt.slice(0, 1024)) ? ok('ofx') : { ok: false, erro: 'tipo_nao_permitido' };
  if (ext === 'xml') return txt.replace(/^﻿/, '').trimStart().startsWith('<') ? ok('xml') : { ok: false, erro: 'tipo_nao_permitido' };
  if (ext === 'csv' || ext === 'txt') return ok(ext);
  return { ok: false, erro: 'tipo_nao_permitido' };
}

/** Nome de exibição seguro: sem caminho, sem caracteres proibidos ou de controle, até 150. */
export function nomeSeguro(nome: string): string {
  const ultimo = nome.split(/[\\/]/).pop() ?? '';
  let limpo = ultimo.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim();
  limpo = limpo.replace(/^\.+/, '');
  if (!limpo) return 'arquivo';
  if (limpo.length > 150) {
    const ext = extensao(limpo);
    limpo = ext ? limpo.slice(0, 149 - ext.length) + '.' + ext : limpo.slice(0, 150);
  }
  return limpo;
}
