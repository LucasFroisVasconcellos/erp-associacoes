// "Quem leu" só aparece para quem publicou e para administradores (RLS).
// Texto puro: nada de HTML.
import { Archive, Bell, CheckCheck, Eye, Megaphone, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { BlocoErro, CarregandoLista, Vazio } from '@/components/app/estados';
import { Folha } from '@/components/app/folha';
import { Grupo, Linha } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { usePerfil } from '@/app/sessao';
import { useAcaoOrg, useAvisos, useLeituras, useMembros } from '@/dados/consultas';
import type { Aviso } from '@/dados/tipos';
import { pode } from '@/lib/acesso';
import { formatarData, hojeSP } from '@/lib/datas';
import { erroMsg, nomeDe } from '@/telas/organizacao/comum';

const vigente = (a: Aviso, hoje: string) => !a.arquivado_em && (!a.expira_em || a.expira_em >= hoje);

export function Avisos() {
  const perfil = usePerfil();
  const hoje = hojeSP();
  const avisos = useAvisos();
  const membros = useMembros();
  const [novo, setNovo] = useState(false);
  const [aberto, setAberto] = useState<Aviso | null>(null);
  const ativos = (avisos.data ?? []).filter((a) => vigente(a, hoje));
  const antigos = (avisos.data ?? []).filter((a) => !vigente(a, hoje)).slice(0, 20);
  return (
    <Pagina titulo="Avisos" acoes={pode(perfil, 'avisos', 'criar')
      ? <Button size="icon" variant="ghost" aria-label="Novo aviso" onClick={() => setNovo(true)}><Plus aria-hidden="true" /></Button> : undefined}>
      {avisos.isError ? <BlocoErro erro={avisos.error} tentarDeNovo={() => void avisos.refetch()} />
        : avisos.isPending ? <CarregandoLista linhas={3} rotulo="Carregando os avisos…" />
          : ativos.length === 0 && antigos.length === 0 ? (
            <Vazio icone={Megaphone} titulo="Nenhum aviso no mural" descricao="Avisos da diretoria aparecem aqui, com a confirmação de quem já leu."
              acao={pode(perfil, 'avisos', 'criar') ? <Button onClick={() => setNovo(true)}><Plus data-icon="inline-start" aria-hidden="true" />Publicar aviso</Button> : undefined} />
          ) : (
            <>
              <Grupo titulo="No mural">
                {ativos.length === 0 && <Linha titulo="Nenhum aviso em vigor" />}
                {ativos.map((a) => (
                  <Linha key={a.id} icone={a.lido ? Bell : Megaphone} cor={a.lido ? 'cinza' : 'laranja'} aoTocar={() => setAberto(a)} seta
                    titulo={a.titulo} descricao={`${nomeDe(membros.data, a.autor)} · ${formatarData(a.publicado_em)}`}
                    valor={a.lido ? undefined : <Badge>Novo</Badge>} />
                ))}
              </Grupo>
              {antigos.length > 0 && (
                <Grupo titulo="Arquivados ou vencidos">
                  {antigos.map((a) => <Linha key={a.id} icone={Archive} cor="cinza" titulo={a.titulo} aoTocar={() => setAberto(a)} seta descricao={formatarData(a.publicado_em)} />)}
                </Grupo>
              )}
            </>
          )}
      {novo && <FormAviso aoFechar={() => setNovo(false)} />}
      {aberto && <DetalheAviso aviso={aberto} aoFechar={() => setAberto(null)} />}
    </Pagina>
  );
}

function DetalheAviso({ aviso: a, aoFechar }: { aviso: Aviso; aoFechar: () => void }) {
  const perfil = usePerfil();
  const membros = useMembros();
  const lido = useAcaoOrg('marcar_aviso_lido');
  const arquivar = useAcaoOrg('arquivar_aviso');
  const podeVerLeituras = a.autor === perfil.membro.id || perfil.membro.admin;
  const leituras = useLeituras(a.id, podeVerLeituras);
  const [jaLi, setJaLi] = useState(Boolean(a.lido));
  const ativos = (membros.data ?? []).filter((m) => m.ativo);
  const quemLeu = new Set((leituras.data ?? []).map((l) => l.membro_id));
  async function confirmar() {
    try { await lido.mutateAsync({ p_id: a.id }); setJaLi(true); } catch (e) { toast.error(erroMsg(e)); }
  }
  async function arquivarAviso() {
    try { await arquivar.mutateAsync({ p_id: a.id }); toast.success('Aviso arquivado'); aoFechar(); } catch (e) { toast.error(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo={a.titulo}
      descricao={`${nomeDe(membros.data, a.autor)} · ${formatarData(a.publicado_em)}${a.expira_em ? ` · vale até ${formatarData(a.expira_em)}` : ''}`}
      rodape={
        <div className="flex w-full flex-col gap-2">
          {!a.arquivado_em && (jaLi
            ? <p className="text-muted-foreground flex items-center justify-center gap-1.5 text-[15px]"><CheckCheck aria-hidden="true" className="size-4" />Você confirmou a leitura</p>
            : <Button size="lg" disabled={lido.isPending} onClick={() => void confirmar()}>{lido.isPending && <Spinner data-icon="inline-start" />}Li e entendi</Button>)}
          {!a.arquivado_em && (a.autor === perfil.membro.id || perfil.membro.admin) && (
            <Button size="lg" variant="ghost" disabled={arquivar.isPending} onClick={() => void arquivarAviso()}><Archive data-icon="inline-start" aria-hidden="true" />Arquivar</Button>
          )}
        </div>
      }>
      <div className="flex flex-col gap-5 pb-2">
        <p className="text-[17px] whitespace-pre-wrap">{a.texto}</p>
        {podeVerLeituras && (
          <Grupo titulo={`Leitura: ${quemLeu.size} de ${ativos.length}`}>
            {ativos.map((m) => (
              <Linha key={m.id} icone={quemLeu.has(m.id) ? Eye : Bell} cor={quemLeu.has(m.id) ? 'verde' : 'cinza'} titulo={m.nome}
                valor={quemLeu.has(m.id) ? 'Leu' : 'Ainda não'} />
            ))}
          </Grupo>
        )}
      </div>
    </Folha>
  );
}

function FormAviso({ aoFechar }: { aoFechar: () => void }) {
  const publicar = useAcaoOrg('publicar_aviso');
  const [id] = useState(() => crypto.randomUUID());
  const [titulo, setTitulo] = useState('');
  const [texto, setTexto] = useState('');
  const [expira, setExpira] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  async function enviar() {
    setErro(null);
    try {
      await publicar.mutateAsync({ p: { id, titulo: titulo.trim(), texto: texto.trim(), ...(expira ? { expira_em: expira } : {}) } });
      toast.success('Aviso publicado');
      aoFechar();
    } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo="Novo aviso"
      rodape={<Button size="lg" className="w-full" disabled={titulo.trim().length < 2 || !texto.trim() || publicar.isPending} onClick={() => void enviar()}>
        {publicar.isPending && <Spinner data-icon="inline-start" />}Publicar</Button>}>
      <FieldGroup className="pb-2">
        <Field><FieldLabel htmlFor="av-titulo">Título</FieldLabel><Input id="av-titulo" name="av-titulo" maxLength={120} autoComplete="off" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Reunião extraordinária no sábado…" /></Field>
        <Field>
          <FieldLabel htmlFor="av-texto">Aviso</FieldLabel>
          <Textarea id="av-texto" name="av-texto" rows={6} maxLength={4000} value={texto} onChange={(e) => setTexto(e.target.value)} />
          <FieldDescription>{texto.length}/4000. Não coloque dados de saúde ou documentos de atletas aqui.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="av-exp">Vale até (opcional)</FieldLabel>
          <Input id="av-exp" name="av-exp" type="date" min={hojeSP()} value={expira} onChange={(e) => setExpira(e.target.value)} />
          <FieldDescription>Depois dessa data, o aviso sai do mural sozinho.</FieldDescription>
        </Field>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

