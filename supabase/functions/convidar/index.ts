// Deploy com verify_jwt LIGADO (padrão). Sem APP_ORIGIN a função não sobe.
import { withSupabase } from '@supabase/server';
import { cabecalhosCors } from '../_shared/http.ts';
import { tratarConvite } from '../_shared/convite.ts';

const ORIGEM = Deno.env.get('APP_ORIGIN');
const cors = cabecalhosCors(ORIGEM ? new URL(ORIGEM).origin : undefined);

export default {
  fetch: withSupabase({ auth: 'user', cors: { headers: cors } }, (req, ctx) =>
    tratarConvite(req, {
      origemApp: ORIGEM!.replace(/\/$/, ''),
      // com a sessão do administrador: o banco aplica RLS, aal2, 2FA recente e limite
      registrarConvite: async (args) => {
        const { data, error } = await ctx.supabase.rpc('registrar_convite', args);
        if (error) throw error;
        return data;
      },
      enviarEmail: async (email, redirectTo) => {
        const { error } = await ctx.supabaseAdmin.auth.admin.inviteUserByEmail(email, { redirectTo });
        if (!error) return { ok: true };
        if (error.status === 422 || /already.*registered|exists/i.test(error.message)) return { ja_existe: true };
        throw error;
      },
    })),
};
