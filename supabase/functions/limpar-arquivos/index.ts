// Deploy com --no-verify-jwt: quem autentica é a chave secreta nomeada "limpeza", só usada pela rotina agendada.
import { withSupabase } from '@supabase/server';
import { tratarLimpeza } from '../_shared/limpeza.ts';

export default {
  fetch: withSupabase({ auth: 'secret:limpeza' }, (req, ctx) =>
    tratarLimpeza(req, {
      pegar: async (lote) => {
        const { data, error } = await ctx.supabaseAdmin.rpc('pegar_arquivos_remover', { p_lote: lote });
        if (error) throw error;
        return data;
      },
      remover: async (bucket, caminho) => {
        const { error } = await ctx.supabaseAdmin.storage.from(bucket).remove([caminho]);
        return { ok: !error };
      },
      confirmar: async (bucket, caminho) => {
        const { error } = await ctx.supabaseAdmin.rpc('confirmar_remocao', { p_bucket: bucket, p_caminho: caminho });
        if (error) throw error;
      },
    })),
};
