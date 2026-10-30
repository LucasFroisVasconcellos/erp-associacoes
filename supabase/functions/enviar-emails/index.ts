// Só a rotina agendada chama, com a chave secreta nomeada "emails".
// Deploy com --no-verify-jwt: quem autentica é a chave nomeada, conferida pela @supabase/server.
// Porta fixa 465 (SSL): as Edge Functions bloqueiam as portas 25 e 587.
import { withSupabase } from '@supabase/server';
import nodemailer from 'nodemailer';
import { tratarEmails } from '../_shared/emails.ts';

const exigir = (nome: string) => {
  const v = Deno.env.get(nome);
  if (!v) throw new Error(`variável ${nome} ausente`);
  return v;
};
const ORIGEM = new URL(exigir('APP_ORIGIN')).origin;
const REMETENTE = exigir('SMTP_REMETENTE');
const transporte = nodemailer.createTransport({
  host: exigir('SMTP_HOST'),
  port: 465,
  secure: true,
  auth: { user: exigir('SMTP_USUARIO'), pass: exigir('SMTP_SENHA') },
  connectionTimeout: 15_000,
  socketTimeout: 20_000,
});

export default {
  fetch: withSupabase({ auth: 'secret:emails' }, (req, ctx) =>
    tratarEmails(req, {
      origemApp: ORIGEM,
      pegar: async (lote) => {
        const { data, error } = await ctx.supabaseAdmin.rpc('pegar_emails', { p_lote: lote });
        if (error) throw error;
        return data;
      },
      marcar: async (id, enviado, erro) => {
        const { error } = await ctx.supabaseAdmin.rpc('marcar_email', { p_id: id, p_enviado: enviado, p_erro: erro });
        if (error) throw error;
      },
      enviar: async (m) => {
        await transporte.sendMail({ from: `Associação Exemplo Gestão <${REMETENTE}>`, to: m.para, subject: m.assunto, text: m.texto });
      },
    })),
};
