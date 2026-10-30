// O SQL não apaga o arquivo físico do Storage; só a API apaga. Chamada só pela rotina agendada (chave nomeada).
import { erroInterno, json } from './http.ts';

export interface DepsLimpeza {
  pegar(lote: number): Promise<{ ok?: boolean; arquivos?: { bucket: string; caminho: string }[] }>;
  remover(bucket: string, caminho: string): Promise<{ ok: boolean }>;
  confirmar(bucket: string, caminho: string): Promise<unknown>;
}
const BUCKETS = new Set(['pessoas', 'saude', 'institucional', 'captacao', 'comprovantes', 'contador']);
const CAMINHO = /^[0-9a-f-]{7,36}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|pdf|xml|csv|txt|xlsx|xls|docx|ofx)$/;

export async function tratarLimpeza(req: Request, deps: DepsLimpeza): Promise<Response> {
  if (req.method !== 'POST') return json(405, { erro: 'metodo_nao_permitido' });
  let removidos = 0, falhas = 0;
  try {
    const r = await deps.pegar(50);
    if (!r?.ok || !Array.isArray(r.arquivos)) return erroInterno('pegar_arquivos');
    for (const a of r.arquivos) {
      // defesa extra: só buckets e caminhos do formato que o sistema gera
      if (!BUCKETS.has(a.bucket) || !CAMINHO.test(a.caminho)) { falhas++; continue; }
      const x = await deps.remover(a.bucket, a.caminho);
      if (x.ok) { await deps.confirmar(a.bucket, a.caminho); removidos++; } else falhas++;
    }
    return json(200, { ok: true, removidos, falhas });
  } catch (e) {
    return erroInterno('limpar_arquivos', e);
  }
}
