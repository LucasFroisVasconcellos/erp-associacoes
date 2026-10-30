// Prepara o comprovante no aparelho: confere o tipo pelos bytes e regrava fotos em JPEG, o que remove o GPS (EXIF).
import { createStore, del, get, keys, set } from 'idb-keyval';
import { LIMITE_PDF_BYTES, validarArquivo } from '../../supabase/functions/_shared/tipo-arquivo';
import type { OrigemComprovante } from '@/dados/tipos';
import { carregarComRecarga, depsNavegador } from '@/lib/sob-demanda';

export interface ArquivoPronto { arquivo: File; origem: OrigemComprovante; previa: string | null; tamanhoOriginal: number }

const IMAGEM = /^image\/(jpeg|png|webp|heic|heif)$/i;

export async function prepararComprovante(f: File, origem: OrigemComprovante): Promise<ArquivoPronto | { erro: string }> {
  if (f.size === 0) return { erro: 'vazio' };
  // HEIC do iPhone: o navegador converte ao desenhar no canvas; os bytes iniciais não são JPEG/PNG.
  if (IMAGEM.test(f.type) || /\.(heic|heif)$/i.test(f.name)) {
    if (f.size > 40 * 1024 * 1024) return { erro: 'grande_demais' };
    // Arquivo de versão antiga do site: recarrega uma vez; sem internet, avisa disso em vez de culpar o tipo.
    let imageCompression: typeof import('browser-image-compression').default;
    try { imageCompression = (await carregarComRecarga(() => import('browser-image-compression'), depsNavegador())).default; }
    catch { return { erro: 'rede' }; }
    try {
      const reduzida = await imageCompression(f, {
        maxWidthOrHeight: 1600, maxSizeMB: 0.3, initialQuality: 0.82, fileType: 'image/jpeg', useWebWorker: false, preserveExif: false,
      });
      const pronto = new File([reduzida], 'comprovante.jpg', { type: 'image/jpeg' });
      const v = validarArquivo('comprovante', new Uint8Array(await pronto.arrayBuffer()), pronto.name);
      if (!v.ok) return { erro: v.erro };
      return { arquivo: pronto, origem, previa: URL.createObjectURL(pronto), tamanhoOriginal: f.size };
    } catch {
      return { erro: 'tipo_nao_permitido' };
    }
  }
  if (f.size > LIMITE_PDF_BYTES) return { erro: 'grande_demais' };
  const v = validarArquivo('comprovante', new Uint8Array(await f.arrayBuffer()), f.name);
  if (!v.ok) return { erro: v.erro };
  return { arquivo: f, origem: v.ext === 'xml' ? 'xml' : origem, previa: null, tamanhoOriginal: f.size };
}

export async function prepararDocumento(f: File): Promise<{ arquivo: File } | { erro: string }> {
  if (f.size === 0) return { erro: 'vazio' };
  if (IMAGEM.test(f.type) || /\.(heic|heif)$/i.test(f.name)) {
    if (f.size > 40 * 1024 * 1024) return { erro: 'grande_demais' };
    let imageCompression: typeof import('browser-image-compression').default;
    try { imageCompression = (await carregarComRecarga(() => import('browser-image-compression'), depsNavegador())).default; }
    catch { return { erro: 'rede' }; }
    try {
      const reduzida = await imageCompression(f, {
        maxWidthOrHeight: 2200, maxSizeMB: 0.8, initialQuality: 0.85, fileType: 'image/jpeg', useWebWorker: false, preserveExif: false,
      });
      const pronto = new File([reduzida], 'documento.jpg', { type: 'image/jpeg' });
      const v = validarArquivo('documento', new Uint8Array(await pronto.arrayBuffer()), pronto.name);
      return v.ok ? { arquivo: pronto } : { erro: v.erro };
    } catch {
      return { erro: 'tipo_nao_permitido' };
    }
  }
  if (f.size > LIMITE_PDF_BYTES) return { erro: 'grande_demais' };
  const v = validarArquivo('documento', new Uint8Array(await f.arrayBuffer()), f.name);
  return v.ok ? { arquivo: f } : { erro: v.erro };
}

export async function sha256Hex(f: Blob): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', await f.arrayBuffer()));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface Rascunho {
  id: string;
  usuarioId: string;
  criadoEm: string;
  dados: Record<string, unknown>;
  arquivos: { blob: Blob; nome: string; origem: OrigemComprovante }[];
  lancamentoSalvo?: boolean;
}

let loja: ReturnType<typeof createStore> | null = null;
function store() {
  loja ??= createStore('erp-rascunhos', 'rascunhos');
  return loja;
}

export async function guardarRascunho(r: Rascunho) { await set(r.id, r, store()); }
export async function apagarRascunho(id: string) { await del(id, store()); }
export function rascunhosDe(lista: Rascunho[], usuarioId: string): Rascunho[] {
  return lista.filter((x) => x.usuarioId === usuarioId).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
}

export async function listarRascunhos(usuarioId: string): Promise<Rascunho[]> {
  try {
    const ids = await keys(store());
    const itens = await Promise.all(ids.map((k) => get<Rascunho>(k, store())));
    return rascunhosDe(itens.filter((x): x is Rascunho => Boolean(x)), usuarioId);
  } catch {
    return []; // sem IndexedDB (modo privado): sem rascunhos
  }
}
export async function apagarTodosRascunhos() {
  try { for (const k of await keys(store())) await del(k, store()); } catch { /* sem IndexedDB */ }
}
