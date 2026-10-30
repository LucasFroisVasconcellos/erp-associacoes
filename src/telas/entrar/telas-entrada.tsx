// Mensagens não revelam se o e-mail existe; o link do e-mail vira sessão
// e é APAGADO do endereço antes de qualquer outra coisa.
import { KeyRound, LockKeyhole, ShieldCheck, ShieldX } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ASSOCIACAO } from '@/lib/associacao';
import { retirarLinkEmail } from '@/lib/link-email';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useCaptcha } from '@/components/app/captcha';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Spinner } from '@/components/ui/spinner';
import { useSessao } from '@/app/sessao';
import { fonte } from '@/dados/fonte';
import { ErroApp, mensagemErro } from '@/lib/erros';

function msg(e: unknown) { return e instanceof ErroApp ? e.message : mensagemErro({ erro: 'falha_interna' }); }

export function Moldura({ titulo, subtitulo, icone, children }: { titulo: string; subtitulo?: string; icone?: ReactNode; children: ReactNode }) {
  useEffect(() => { document.title = `${titulo} · Associação Exemplo`; }, [titulo]);
  return (
    <main id="conteudo" className="pt-seguro pb-seguro flex min-h-svh flex-col items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-[400px] flex-col gap-7">
        <div className="flex flex-col items-center gap-3 text-center">
          <span aria-hidden="true" className="bg-primary text-primary-foreground inline-flex size-16 items-center justify-center rounded-[18px] shadow-[0_10px_30px_rgba(0,102,204,0.3)]">
            {icone ?? <span className="text-[22px] font-bold">AE</span>}
          </span>
          <h1 className="font-display text-[28px] leading-tight font-bold tracking-[-0.02em] text-balance">{titulo}</h1>
          {subtitulo && <p className="text-muted-foreground text-[15px] text-pretty">{subtitulo}</p>}
        </div>
        <div className="bg-card rounded-[22px] p-5 shadow-[0_1px_3px_rgba(0,0,0,0.05)] sm:p-6">{children}</div>
        {fonte().demo && <p className="text-aviso text-center text-[13px] font-medium">Demonstração: entre com qualquer e-mail e senha; o código é 123456.</p>}
        <p className="text-center text-[13px]"><Link to="/transparencia" className="text-tint underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-4 focus-visible:ring-ring/35 focus-visible:outline-none">Transparência</Link> · <Link to="/privacidade" className="text-tint underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-4 focus-visible:ring-ring/35 focus-visible:outline-none">Política de privacidade</Link></p>
      </div>
    </main>
  );
}

export function Entrar() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [manter, setManter] = useState(true); // vem marcado por decisão da diretoria; desmarcar em aparelho emprestado
  const captcha = useCaptcha();
  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    if (enviando || captcha.pendente) return;
    setErro(null); setEnviando(true);
    try { await fonte().entrar(email, senha, captcha.token, manter); }
    catch (e) { setErro(msg(e)); document.getElementById('senha')?.focus(); }
    finally { setEnviando(false); captcha.reiniciar(); } // o token do CAPTCHA vale uma vez só
  }
  return (
    <Moldura titulo="Gestão da Associação Exemplo" subtitulo="Acesso da diretoria da Associação Exemplo">
      <form onSubmit={enviar} noValidate>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">E-mail</FieldLabel>
            <Input id="email" name="email" type="email" autoComplete="username" inputMode="email" spellCheck={false} required
              placeholder="voce@exemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field data-invalid={!!erro || undefined}>
            <FieldLabel htmlFor="senha">Senha</FieldLabel>
            <Input id="senha" name="password" type="password" autoComplete="current-password" required aria-invalid={!!erro || undefined}
              aria-describedby={erro ? 'erro-login' : undefined} value={senha} onChange={(e) => setSenha(e.target.value)} />
            {erro && <FieldError id="erro-login" role="alert">{erro}</FieldError>}
          </Field>
          <label htmlFor="manter" className="flex min-h-11 cursor-pointer items-start gap-3 text-[15px]">
            <Checkbox id="manter" className="mt-0.5" checked={manter} onCheckedChange={(v) => setManter(v === true)} />
            <span>Manter conectado neste aparelho por 30 dias<span className="text-muted-foreground block text-[13px]">Só no seu celular ou computador. Ao tocar em Sair, ele esquece.</span></span>
          </label>
          {captcha.elemento}
          <Button type="submit" size="lg" disabled={enviando || captcha.pendente}>
            {enviando && <Spinner data-icon="inline-start" />}
            {enviando ? 'Entrando…' : 'Entrar'}
          </Button>
          <Button asChild variant="ghost"><Link to="/entrar/recuperar">Esqueci a senha</Link></Button>
          <p className="text-muted-foreground text-center text-[15px]">Ainda não tem acesso? <Link className="text-tint font-medium" to="/entrar/pedir">Pedir acesso</Link></p>
        </FieldGroup>
      </form>
    </Moldura>
  );
}

export function Recuperar() {
  const [email, setEmail] = useState('');
  const [feito, setFeito] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const captcha = useCaptcha();
  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    if (enviando || captcha.pendente) return;
    setEnviando(true); setErro(null);
    try {
      const destino = `${location.origin}${location.pathname}#/entrar/link`;
      await fonte().pedirRecuperacao(email, destino, captcha.token);
      setFeito(true);
    } catch (e) { setErro(msg(e)); } finally { setEnviando(false); captcha.reiniciar(); }
  }
  return (
    <Moldura titulo="Recuperar a senha" icone={<KeyRound className="size-8" />} subtitulo="Enviaremos um link para criar uma senha nova.">
      {feito ? (
        <div className="flex flex-col gap-4">
          <Alert><AlertDescription role="status">Se o e-mail estiver cadastrado, o link chega em alguns minutos. Ele vale por pouco tempo e só pode ser usado uma vez.</AlertDescription></Alert>
          <Button asChild variant="secondary"><Link to="/entrar">Voltar para a entrada</Link></Button>
        </div>
      ) : (
        <form onSubmit={enviar}>
          <FieldGroup>
            <Field data-invalid={!!erro || undefined}>
              <FieldLabel htmlFor="email-rec">E-mail</FieldLabel>
              <Input id="email-rec" name="email" type="email" autoComplete="username" spellCheck={false} required value={email} onChange={(e) => setEmail(e.target.value)} />
              {erro && <FieldError role="alert">{erro}</FieldError>}
            </Field>
            {captcha.elemento}
            <Button type="submit" size="lg" disabled={enviando || captcha.pendente || !email.includes('@')}>
              {enviando && <Spinner data-icon="inline-start" />}Enviar link
            </Button>
            <Button asChild variant="ghost"><Link to="/entrar">Voltar</Link></Button>
          </FieldGroup>
        </form>
      )}
    </Moldura>
  );
}

export function CampoCodigo({ aoConfirmar, rotulo = 'Código de 6 números', ocupado }: { aoConfirmar: (c: string) => void; rotulo?: string; ocupado?: boolean }) {
  // Foco automático: é o único campo da tela e a ação principal.
  const [codigo, setCodigo] = useState('');
  return (
    <Field>
      <FieldLabel htmlFor="codigo-2fa">{rotulo}</FieldLabel>
      <InputOTP id="codigo-2fa" autoFocus maxLength={6} value={codigo} inputMode="numeric" pattern="^[0-9]*$" autoComplete="one-time-code"
        onChange={(v) => { setCodigo(v); if (v.length === 6 && !ocupado) aoConfirmar(v); }} containerClassName="justify-center">
        <InputOTPGroup>{[0, 1, 2, 3, 4, 5].map((i) => <InputOTPSlot key={i} index={i} className="h-14 w-11 text-[22px]" />)}</InputOTPGroup>
      </InputOTP>
      <FieldDescription className="text-center">Abra o aplicativo autenticador (Google Authenticator, Microsoft Authenticator ou outro).</FieldDescription>
    </Field>
  );
}

export function VerificarDoisFatores({ fatorId }: { fatorId: string }) {
  const { sair } = useSessao();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [chave, setChave] = useState(0);
  async function confirmar(c: string) {
    setOcupado(true); setErro(null);
    try { await fonte().confirmarCodigo(fatorId, c); }
    catch (e) { setErro(msg(e)); setChave((k) => k + 1); } finally { setOcupado(false); }
  }
  return (
    <Moldura titulo="Verificação em duas etapas" icone={<ShieldCheck className="size-8" />} subtitulo="Por segurança, confirme que é você.">
      <FieldGroup>
        <CampoCodigo key={chave} aoConfirmar={confirmar} ocupado={ocupado} />
        {ocupado && <p role="status" className="text-muted-foreground flex items-center justify-center gap-2 text-[15px]"><Spinner />Conferindo…</p>}
        {erro && <FieldError role="alert" className="text-center">{erro}</FieldError>}
        <Button variant="ghost" onClick={() => void sair()}>Usar outra conta</Button>
      </FieldGroup>
    </Moldura>
  );
}

export function CadastrarDoisFatores() {
  const { sair } = useSessao();
  const [dados, setDados] = useState<{ id: string; qr: string; segredo: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const iniciou = useRef(false);
  useEffect(() => {
    if (iniciou.current) return;
    iniciou.current = true;
    fonte().cadastrarFator().then(setDados).catch((e) => setErro(msg(e)));
  }, []);
  async function confirmar(c: string) {
    if (!dados) return;
    setOcupado(true); setErro(null);
    try { await fonte().confirmarCodigo(dados.id, c); toast.success('Verificação em duas etapas ativada.'); }
    catch (e) { setErro(msg(e)); } finally { setOcupado(false); }
  }
  return (
    <Moldura titulo="Ative a verificação em duas etapas" icone={<LockKeyhole className="size-8" />}
      subtitulo="É obrigatória para toda a diretoria, porque o sistema guarda o dinheiro da associação.">
      <FieldGroup>
        <ol className="text-[15px] leading-snug [counter-reset:passo]">
          <li className="mb-2">1. Instale um aplicativo autenticador no celular.</li>
          <li className="mb-2">2. No aplicativo, leia o QR code abaixo (ou digite a chave).</li>
          <li>3. Digite o código de 6 números que aparecer.</li>
        </ol>
        {dados ? (
          <>
            {dados.qr && <img src={dados.qr} alt="QR code para o aplicativo autenticador" width={192} height={192} className="mx-auto size-48 rounded-[12px] bg-white p-2" />}
            <p className="bg-muted rounded-[12px] px-3 py-2 text-center font-mono text-[13px] break-all" translate="no" aria-label="Chave para digitar no aplicativo">{dados.segredo}</p>
            <CampoCodigo aoConfirmar={confirmar} ocupado={ocupado} />
          </>
        ) : !erro && <p role="status" className="flex items-center justify-center gap-2"><Spinner />Preparando…</p>}
        {erro && <FieldError role="alert">{erro}</FieldError>}
        <Button variant="ghost" onClick={() => void sair()}>Sair</Button>
      </FieldGroup>
    </Moldura>
  );
}

export function SemAcesso({ email }: { email: string }) {
  const { sair } = useSessao();
  return (
    <Moldura titulo="Acesso não liberado" icone={<ShieldX className="size-8" />}>
      <div className="flex flex-col gap-4 text-[15px]">
        <p>A conta <strong className="break-all">{email}</strong> não tem acesso ativo ao sistema. O acesso pode ter vencido ou sido desativado.</p>
        <p className="text-muted-foreground">Peça a um administrador da diretoria para liberar, ou fale com a Associação Exemplo: {ASSOCIACAO.email} · {ASSOCIACAO.telefone}.</p>
        <Button variant="secondary" onClick={() => void sair()}>Sair</Button>
      </div>
    </Moldura>
  );
}

/** Link do e-mail (convite ou recuperação): troca o token por sessão e o apaga do endereço. */
export function LinkDoEmail() {
  const navegar = useNavigate();
  const { atualizar } = useSessao();
  const [etapa, setEtapa] = useState<'conferindo' | 'senha' | 'erro'>('conferindo');
  const [tipo, setTipo] = useState<'invite' | 'recovery'>('invite');
  const feito = useRef(false);
  useEffect(() => {
    if (feito.current) return;
    feito.current = true;
    const consulta = new URLSearchParams(location.hash.split('?')[1] ?? '');
    const token = consulta.get('token_hash');
    const t = consulta.get('type') === 'recovery' ? 'recovery' : 'invite';
    history.replaceState(null, '', `${location.pathname}#/entrar/link`); // o token sai do endereço e do histórico
    setTipo(t);
    const padrao = retirarLinkEmail();
    if (padrao) {
      setTipo(padrao.fluxo);
      if (padrao.tipo === 'erro') { setEtapa('erro'); return; }
      fonte().sessaoDoLink(padrao.acesso, padrao.renovacao).then(() => setEtapa('senha')).catch(() => setEtapa('erro'));
      return;
    }
    if (!token || !/^[A-Za-z0-9_-]{10,200}$/.test(token)) { setEtapa('erro'); return; }
    fonte().confirmarLink(token, t).then(() => setEtapa('senha')).catch(() => setEtapa('erro'));
  }, []);
  if (etapa === 'erro') {
    return (
      <Moldura titulo="Link inválido" icone={<ShieldX className="size-8" />}>
        <div className="flex flex-col gap-4 text-[15px]">
          <p>Esse link já foi usado ou venceu. {tipo === 'invite' ? 'Peça um novo convite a um administrador.' : 'Peça um novo link de recuperação.'}</p>
          <Button asChild variant="secondary"><Link to={tipo === 'invite' ? '/entrar' : '/entrar/recuperar'}>Continuar</Link></Button>
        </div>
      </Moldura>
    );
  }
  if (etapa === 'conferindo') return <Moldura titulo="Conferindo o link…"><p role="status" className="flex justify-center gap-2"><Spinner />Um instante…</p></Moldura>;
  return <NovaSenha tipo={tipo} aoConcluir={async () => {
    if (tipo === 'invite') await fonte().rpc('aceitar_convite').catch(() => undefined);
    await atualizar();
    navegar('/', { replace: true });
  }} />;
}

function NovaSenha({ tipo, aoConcluir }: { tipo: 'invite' | 'recovery'; aoConcluir: () => Promise<void> }) {
  const [senha, setSenha] = useState('');
  const [conf, setConf] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [precisa2fa, setPrecisa2fa] = useState<string | null>(null);
  useEffect(() => {
    // Recuperação de quem já tem 2FA: confirma o código ANTES de trocar a senha.
    if (tipo === 'recovery') void fonte().fatores().then((f) => setPrecisa2fa(f.find((x) => x.status === 'verified')?.id ?? null));
  }, [tipo]);
  const fraca = senha.length > 0 && (senha.length < 10 || /^(.)\1+$/.test(senha) || /^(?:123456|senha|password|erp)/i.test(senha));
  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    if (senha.length < 10 || fraca) { setErro('Use pelo menos 10 caracteres, misturando palavras ou números.'); return; }
    if (senha !== conf) { setErro('As duas senhas não são iguais.'); return; }
    setEnviando(true); setErro(null);
    try { await fonte().definirSenha(senha); toast.success('Senha definida.'); await aoConcluir(); }
    catch (e) { setErro(msg(e)); } finally { setEnviando(false); }
  }
  if (precisa2fa) {
    return (
      <Moldura titulo="Confirme que é você" icone={<ShieldCheck className="size-8" />} subtitulo="Antes de trocar a senha, digite o código do aplicativo autenticador.">
        <CampoCodigo aoConfirmar={async (c) => {
          try { await fonte().confirmarCodigo(precisa2fa, c); setPrecisa2fa(null); } catch (e) { toast.error(msg(e)); }
        }} />
      </Moldura>
    );
  }
  return (
    <Moldura titulo={tipo === 'invite' ? 'Crie sua senha' : 'Senha nova'} icone={<KeyRound className="size-8" />}
      subtitulo={tipo === 'invite' ? 'Bem-vindo(a) à diretoria no sistema. Depois da senha, você ativa a verificação em duas etapas.' : undefined}>
      <form onSubmit={enviar}>
        <FieldGroup>
          <Field data-invalid={!!erro || undefined}>
            <FieldLabel htmlFor="nova-senha">Senha</FieldLabel>
            <Input id="nova-senha" name="new-password" type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} aria-describedby="dica-senha" />
            <FieldDescription id="dica-senha">Pelo menos 10 caracteres. Uma frase curta é fácil de lembrar e difícil de adivinhar.</FieldDescription>
          </Field>
          <Field data-invalid={!!erro || undefined}>
            <FieldLabel htmlFor="conf-senha">Repita a senha</FieldLabel>
            <Input id="conf-senha" name="confirm-password" type="password" autoComplete="new-password" value={conf} onChange={(e) => setConf(e.target.value)} />
            {erro && <FieldError role="alert">{erro}</FieldError>}
          </Field>
          <Button type="submit" size="lg" disabled={enviando}>{enviando && <Spinner data-icon="inline-start" />}Salvar senha</Button>
        </FieldGroup>
      </form>
    </Moldura>
  );
}
