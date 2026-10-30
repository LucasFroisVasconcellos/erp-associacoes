// Só a rotina agendada chama, com a chave secreta nomeada "emails"
// (conferida pela @supabase/server antes de chegar aqui).
import { erroInterno, json } from './http.ts';

export interface EmailDaFila { id: string; para: string; assunto: string; corpo: string }

export interface DepsEmails {
  origemApp: string;
  pegar(lote: number): Promise<{ ok?: boolean; emails?: EmailDaFila[]; erro?: string }>;
  marcar(id: string, enviado: boolean, erro: string | null): Promise<unknown>;
  /** envia um e-mail em TEXTO PURO (sem HTML); lança erro se o servidor de e-mail recusar */
  enviar(msg: { para: string; assunto: string; texto: string }): Promise<void>;
  prazoMs?: number;
  agora?: () => number;
}

const LOTE = 20;
const EMAIL = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** Só o nome do erro vai para a fila e para o log: nada de mensagem do servidor (pode conter o endereço). */
function codigoDoErro(e: unknown): string {
  const c = (e as { code?: unknown })?.code;
  if (typeof c === 'string' && /^[A-Z_]{2,30}$/.test(c)) return c;
  return e instanceof Error ? e.name.slice(0, 40) : 'falha';
}

export function montarTexto(corpo: string, origemApp: string): string {
  return `${corpo}\n\n${origemApp}\n\n— Sistema de Gestão da Associação Exemplo (mensagem automática; não responda)`;
}

export async function tratarEmails(req: Request, deps: DepsEmails): Promise<Response> {
  if (req.method !== 'POST') return json(405, { erro: 'metodo_nao_permitido' });
  const agora = deps.agora ?? Date.now;
  const fimEm = agora() + (deps.prazoMs ?? 100_000);
  let enviados = 0, falhas = 0, lotes = 0;
  try {
    // no máximo 5 lotes por execução; o resto fica para a próxima
    while (lotes < 5 && agora() < fimEm) {
      lotes++;
      const r = await deps.pegar(LOTE);
      if (!r?.ok || !Array.isArray(r.emails)) return erroInterno('pegar_emails');
      if (r.emails.length === 0) break;
      for (const m of r.emails) {
        // defesa extra: endereço e assunto conferidos antes de ir para o SMTP
        if (typeof m.para !== 'string' || !EMAIL.test(m.para) || typeof m.assunto !== 'string' || /[\r\n]/.test(m.assunto)) {
          await deps.marcar(m.id, false, 'dados_invalidos');
          falhas++;
          continue;
        }
        try {
          await deps.enviar({ para: m.para, assunto: m.assunto, texto: montarTexto(String(m.corpo), deps.origemApp) });
          await deps.marcar(m.id, true, null);
          enviados++;
        } catch (e) {
          const codigo = codigoDoErro(e);
          console.error(JSON.stringify({ etapa: 'enviar', erro: codigo }));
          await deps.marcar(m.id, false, codigo);
          falhas++;
        }
      }
      if (r.emails.length < LOTE) break;
    }
    return json(200, { ok: true, enviados, falhas });
  } catch (e) {
    return erroInterno('enviar_emails', e);
  }
}
