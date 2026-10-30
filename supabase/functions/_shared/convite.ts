// Quem decide se o convite pode existir é o banco, com a sessão do administrador; só depois a service role envia o e-mail.
import { erroInterno, json } from './http.ts';
import type { RespostaRpc } from './envio.ts';

export interface DepsConvite {
  origemApp: string;
  registrarConvite(args: Record<string, unknown>): Promise<RespostaRpc>;
  enviarEmail(email: string, redirectTo: string): Promise<{ ok?: boolean; ja_existe?: boolean }>;
}

const LIMITE_CORPO = 16 * 1024;
const CAMPOS = ['email', 'nome', 'cargo', 'permissoes'];

function statusDe(erro?: string): number {
  if (erro === 'sem_permissao' || erro === 'sem_acesso' || erro === 'precisa_2fa' || erro === 'confirme_2fa') return 403;
  if (erro === 'limite') return 429;
  if (erro === 'ja_e_membro') return 409;
  return 422;
}

export async function tratarConvite(req: Request, deps: DepsConvite): Promise<Response> {
  if (req.method !== 'POST') return json(405, { erro: 'metodo_nao_permitido' });
  try {
    const bruto = await req.text();
    if (bruto.length > LIMITE_CORPO) return json(413, { erro: 'grande_demais' });
    let corpo: unknown;
    try { corpo = JSON.parse(bruto); } catch { return json(400, { erro: 'json_invalido' }); }
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return json(400, { erro: 'invalido' });
    const c = corpo as Record<string, unknown>;
    const extra = Object.keys(c).find((k) => !CAMPOS.includes(k));
    if (extra) return json(400, { erro: 'invalido', campo: extra });
    if (typeof c.email !== 'string' || typeof c.nome !== 'string' || typeof c.cargo !== 'string' || !Array.isArray(c.permissoes)) {
      return json(400, { erro: 'invalido' });
    }

    const r = await deps.registrarConvite({ p_email: c.email, p_nome: c.nome, p_cargo: c.cargo, p_permissoes: c.permissoes });
    if (!r.ok) return json(statusDe(r.erro), { erro: r.erro ?? 'invalido', campo: r.campo });

    const email = String(r.email);
    const envio = await deps.enviarEmail(email, `${deps.origemApp}/#/entrar/link`);
    if (envio.ja_existe) return json(200, { ok: true, ja_tem_login: true });
    if (!envio.ok) return erroInterno('enviar_email');
    return json(200, { ok: true });
  } catch (e) {
    return erroInterno('convidar', e);
  }
}
