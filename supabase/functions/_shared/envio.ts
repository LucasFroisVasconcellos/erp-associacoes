// Ordem: método → tamanho → campos permitidos → destino da lista fixa → tipo real pelos bytes →
// autorização COMO O USUÁRIO → gravação com nome aleatório (service role) → registro → limpeza se falhar.
import { erroInterno, json } from './http.ts';
import { LIMITE_PDF_BYTES, nomeSeguro, validarArquivo, type Destino } from './tipo-arquivo.ts';

export interface RespostaRpc { ok?: boolean; erro?: string; campo?: string; [k: string]: unknown }

export interface DepsEnvio {
  /** id do usuário autenticado (vem do JWT validado, nunca do formulário). */
  usuario: string;
  autorizar(fn: string, args: Record<string, unknown>): Promise<RespostaRpc>;
  gravar(bucket: string, caminho: string, bytes: Uint8Array<ArrayBuffer>, mime: string): Promise<{ ok: boolean }>;
  remover(bucket: string, caminho: string): Promise<void>;
  registrar(fn: string, p: Record<string, unknown>): Promise<RespostaRpc>;
}

// Destinos possíveis: mapa fixo no servidor (o cliente só escolhe a chave).
const DESTINOS = {
  comprovante: {
    bucket: 'comprovantes',
    autorizar: 'autorizar_comprovante',
    registrar: 'registrar_comprovante',
    campos: ['destino', 'arquivo', 'lancamento_id', 'origem', 'chave_acesso', 'codigo_barras', 'url_qrcode'],
  },
  contador: {
    bucket: 'contador',
    autorizar: 'autorizar_arquivo_contador',
    registrar: 'registrar_arquivo_contador',
    campos: ['destino', 'arquivo', 'competencia', 'tipo', 'descricao'],
  },
  documento: {
    bucket: '',
    autorizar: 'autorizar_documento',
    registrar: 'registrar_documento',
    campos: ['destino', 'arquivo', 'area', 'documento_id'],
  },
} as const;

// Área do documento → bucket (lista fixa no servidor).
const BUCKET_DA_AREA = new Map([['pessoa', 'pessoas'], ['saude', 'saude'], ['institucional', 'institucional'], ['contrapartida', 'captacao'], ['foto_pessoa', 'pessoas']]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COMPETENCIA = /^(\d{4})-(0[1-9]|1[0-2])-01$/;
const MARGEM_FORMULARIO = 64 * 1024;

function status(erro: string | undefined): number {
  if (erro === 'sem_permissao' || erro === 'sem_acesso' || erro === 'precisa_2fa' || erro === 'nao_autenticado') return 403;
  if (erro === 'limite') return 429;
  if (erro === 'nao_encontrado') return 404;
  return 422;
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function texto(fd: FormData, campo: string): string | null {
  const v = fd.get(campo);
  return typeof v === 'string' && v !== '' ? v : null;
}

export async function tratarEnvio(req: Request, deps: DepsEnvio): Promise<Response> {
  if (req.method !== 'POST') return json(405, { erro: 'metodo_nao_permitido' });
  // Sem tamanho declarado não lemos o corpo: evita que um envio "em pedaços" esgote a memória.
  const cabecalho = req.headers.get('content-length');
  if (cabecalho === null || !/^\d{1,12}$/.test(cabecalho)) return json(411, { erro: 'tamanho_obrigatorio' });
  if (Number(cabecalho) > LIMITE_PDF_BYTES + MARGEM_FORMULARIO) return json(413, { erro: 'grande_demais' });

  let gravado: { bucket: string; caminho: string } | null = null;
  try {
    let fd: FormData;
    try { fd = await req.formData(); } catch { return json(400, { erro: 'formulario_invalido' }); }

    const destinoNome = texto(fd, 'destino');
    if (destinoNome !== 'comprovante' && destinoNome !== 'contador' && destinoNome !== 'documento') return json(400, { erro: 'invalido', campo: 'destino' });
    const destino = DESTINOS[destinoNome];
    for (const chave of fd.keys()) {
      if (!(destino.campos as readonly string[]).includes(chave)) return json(400, { erro: 'invalido', campo: chave });
    }
    const arq = fd.get('arquivo');
    if (!(arq instanceof File)) return json(400, { erro: 'invalido', campo: 'arquivo' });
    // teto geral aqui; o limite por tipo (PDF 50 MB, resto 10 MB) é conferido pelos bytes em validarArquivo
    if (arq.size > LIMITE_PDF_BYTES) return json(413, { erro: 'grande_demais' });

    let argsAutorizar: Record<string, unknown> = {};
    let prefixo: string;
    let bucket: string = destino.bucket;
    const lancamento = texto(fd, 'lancamento_id');
    const competencia = texto(fd, 'competencia');
    const area = texto(fd, 'area');
    const documento = texto(fd, 'documento_id');
    if (destinoNome === 'documento') {
      if (!area || !BUCKET_DA_AREA.has(area)) return json(400, { erro: 'invalido', campo: 'area' });
      if (!documento || !UUID.test(documento)) return json(400, { erro: 'invalido', campo: 'documento_id' });
      argsAutorizar = { p_area: area, p_documento: documento };
      prefixo = documento;
      bucket = BUCKET_DA_AREA.get(area)!;
    } else if (destinoNome === 'comprovante') {
      if (!lancamento || !UUID.test(lancamento)) return json(400, { erro: 'invalido', campo: 'lancamento_id' });
      argsAutorizar = { p_lancamento: lancamento };
      prefixo = lancamento;
    } else {
      const m = competencia ? COMPETENCIA.exec(competencia) : null;
      if (!m) return json(400, { erro: 'invalido', campo: 'competencia' });
      prefixo = `${m[1]}-${m[2]}`;
    }

    const bytes = new Uint8Array(await arq.arrayBuffer());
    const tipo = validarArquivo(destinoNome as Destino, bytes, arq.name);
    if (!tipo.ok) return json(422, { erro: tipo.erro });
    if (area === 'foto_pessoa' && tipo.ext === 'pdf') return json(422, { erro: 'tipo_nao_permitido' }); // foto 3x4: só imagem

    const auth = await deps.autorizar(destino.autorizar, argsAutorizar);
    if (!auth.ok) return json(status(auth.erro), { erro: auth.erro ?? 'sem_permissao' });

    const caminho = `${prefixo}/${crypto.randomUUID()}.${tipo.ext}`;
    const g = await deps.gravar(bucket, caminho, bytes, tipo.mime);
    if (!g.ok) return erroInterno('gravar');
    gravado = { bucket, caminho };

    const hash = await sha256(bytes);
    const p: Record<string, unknown> = destinoNome === 'documento'
      ? { area, documento_id: documento, caminho, sha256: hash }
      : destinoNome === 'comprovante'
        ? { lancamento_id: lancamento, caminho, sha256: hash, origem: texto(fd, 'origem'),
            chave_acesso: texto(fd, 'chave_acesso'), codigo_barras: texto(fd, 'codigo_barras'), url_qrcode: texto(fd, 'url_qrcode') }
        : { competencia, tipo: texto(fd, 'tipo'), descricao: texto(fd, 'descricao'), nome_original: nomeSeguro(arq.name), caminho, sha256: hash };

    const reg = await deps.registrar(destino.registrar, p);
    if (!reg.ok) {
      await deps.remover(bucket, caminho);
      gravado = null;
      return json(status(reg.erro), { erro: reg.erro ?? 'invalido', campo: reg.campo });
    }
    gravado = null;
    return json(200, { ok: true, id: reg.id, duplicado: reg.duplicado ?? false });
  } catch (e) {
    if (gravado) { try { await deps.remover(gravado.bucket, gravado.caminho); } catch { /* registrado abaixo */ } }
    return erroInterno('enviar-arquivo', e);
  }
}
