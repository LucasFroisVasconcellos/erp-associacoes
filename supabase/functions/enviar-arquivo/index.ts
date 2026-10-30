// Deploy com verify_jwt LIGADO (padrão). Sem APP_ORIGIN a função não sobe (CORS fechado).
import { withSupabase } from '@supabase/server';
import { cabecalhosCors } from '../_shared/http.ts';
import { tratarEnvio } from '../_shared/envio.ts';

const ORIGEM = Deno.env.get('APP_ORIGIN');
const cors = cabecalhosCors(ORIGEM ? new URL(ORIGEM).origin : undefined);

export default {
  fetch: withSupabase({ auth: 'user', cors: { headers: cors } }, (req, ctx) =>
    tratarEnvio(req, {
      usuario: ctx.userClaims!.id,
      autorizar: async (fn, args) => {
        const { data, error } = await ctx.supabase.rpc(fn, args);
        if (error) throw error;
        return data;
      },
      gravar: async (bucket, caminho, bytes, mime) => {
        const { error } = await ctx.supabaseAdmin.storage.from(bucket).upload(caminho, bytes, { contentType: mime, upsert: false });
        return { ok: !error };
      },
      remover: async (bucket, caminho) => { await ctx.supabaseAdmin.storage.from(bucket).remove([caminho]); },
      registrar: async (fn, p) => {
        const { data, error } = await ctx.supabaseAdmin.rpc(fn, { p_usuario: ctx.userClaims!.id, p });
        if (error) throw error;
        return data;
      },
    })),
};
