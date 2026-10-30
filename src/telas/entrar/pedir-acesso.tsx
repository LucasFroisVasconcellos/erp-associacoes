// Sem chave do CAPTCHA o formulário fica fechado (fail closed).
// A resposta é sempre igual, para não revelar se o e-mail já pediu acesso.
import { UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useCaptcha } from '@/components/app/captcha';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { fonte } from '@/dados/fonte';
import { ErroApp } from '@/lib/erros';
import { Moldura } from './telas-entrada';

export function PedirAcesso() {
  const captcha = useCaptcha('pedir_acesso');
  const demo = fonte().demo;
  const [f, setF] = useState({ nome: '', email: '' });
  const [enviando, setEnviando] = useState(false);
  const [feito, setFeito] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const aberto = captcha.ligado || demo;
  const valido = f.nome.trim().length >= 2 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim());
  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    if (enviando || !valido || (!demo && captcha.pendente)) return;
    setEnviando(true); setErro(null);
    try {
      await fonte().pedirAcesso({ nome: f.nome.trim(), email: f.email.trim(), captcha: captcha.token ?? 'demonstracao' });
      setFeito(true);
    } catch (e) { setErro(e instanceof ErroApp ? e.message : 'Não foi possível enviar agora.'); }
    finally { setEnviando(false); captcha.reiniciar(); }
  }
  return (
    <Moldura titulo="Pedir acesso" icone={<UserPlus className="size-8" />} subtitulo="Para quem faz parte da Associação Exemplo. A diretoria confere e libera.">
      {!aberto ? (
        <div className="flex flex-col gap-4">
          <Alert><AlertDescription>Os pedidos de acesso ainda não estão abertos. Fale com a diretoria da Associação Exemplo.</AlertDescription></Alert>
          <Button asChild variant="secondary"><Link to="/entrar">Voltar para a entrada</Link></Button>
        </div>
      ) : feito ? (
        <div className="flex flex-col gap-4">
          <Alert><AlertDescription role="status">Pedido recebido. Se for liberado, você recebe um convite por e-mail para criar a senha. Não precisa pedir de novo.</AlertDescription></Alert>
          <Button asChild variant="secondary"><Link to="/entrar">Voltar para a entrada</Link></Button>
        </div>
      ) : (
        <form onSubmit={enviar}>
          <FieldGroup>
            <Field><FieldLabel htmlFor="pa-nome">Seu nome</FieldLabel>
              <Input id="pa-nome" name="name" autoComplete="name" maxLength={120} required value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></Field>
            <Field><FieldLabel htmlFor="pa-email">E-mail</FieldLabel>
              <Input id="pa-email" name="email" type="email" autoComplete="email" inputMode="email" spellCheck={false} maxLength={254} required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            {captcha.elemento}
            {erro && <FieldError role="alert">{erro}</FieldError>}
            <Button type="submit" size="lg" disabled={enviando || !valido || (!demo && captcha.pendente)}>{enviando && <Spinner data-icon="inline-start" />}Enviar pedido</Button>
            <p className="text-muted-foreground text-center text-[13px]">Usamos nome e e-mail só para a diretoria decidir o acesso. Pedidos somem em até 90 dias. <Link className="text-tint underline" to="/privacidade">Privacidade</Link></p>
            <Button asChild variant="ghost"><Link to="/entrar">Voltar</Link></Button>
          </FieldGroup>
        </form>
      )}
    </Moldura>
  );
}
