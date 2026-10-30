// A foto só é aceita com autorização de imagem; o servidor confere de novo, inclusive o tipo real do arquivo.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Hash, Phone, Ruler, Shirt, Trash2, UserRound } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Folha } from '@/components/app/folha';
import { Grupo, Linha } from '@/components/app/lista';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { usePerfil } from '@/app/sessao';
import { chavesF4, useAcaoF4, useConsentimentos } from '@/dados/consultas';
import { fonte } from '@/dados/fonte';
import type { Pessoa } from '@/dados/tipos';
import { pode } from '@/lib/acesso';
import { formatarData, hojeSP } from '@/lib/datas';
import { ErroApp } from '@/lib/erros';
import { prepararFoto3x4, soTelefone } from '@/lib/foto';
import { abrirSeletor } from '@/lib/seletor';
import { erroMsg } from '@/telas/organizacao/comum';
import { formatarTelefone } from './comum';

const TAMANHOS = ['PP', 'P', 'M', 'G', 'GG', 'XGG'] as const;
const iniciais = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]!.toUpperCase()).join('');

export async function enviarFoto(pessoaId: string, f: File) {
  const pronta = await prepararFoto3x4(f).catch(() => { throw new ErroApp({ erro: 'tipo_nao_permitido' }); });
  const fd = new FormData();
  fd.set('destino', 'documento'); fd.set('area', 'foto_pessoa'); fd.set('documento_id', pessoaId); fd.set('arquivo', pronta);
  await fonte().enviarArquivo(fd);
}

export function FotoAtleta({ pessoa }: { pessoa: Pessoa }) {
  const perfil = usePerfil();
  const qc = useQueryClient();
  const consent = useConsentimentos(pessoa.id);
  const remover = useAcaoF4('remover_foto_pessoa');
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const url = useQuery({
    queryKey: ['foto-pessoa', pessoa.id, pessoa.foto_caminho],
    queryFn: () => fonte().urlArquivo('pessoas', pessoa.foto_caminho!),
    enabled: !!pessoa.foto_caminho, staleTime: 50_000, refetchInterval: 50_000, // link assinado vale 60 s
  });
  const autorizada = (consent.data ?? []).some((c) => c.finalidade === 'imagem' && !c.revogado_em);
  const editar = pode(perfil, 'pessoas', 'editar') && pessoa.situacao !== 'desligado';
  async function enviar(f: File | undefined) {
    if (!f) return;
    setEnviando(true);
    try {
      await enviarFoto(pessoa.id, f);
      void qc.invalidateQueries({ queryKey: chavesF4.pessoas });
      toast.success('Foto guardada');
    } catch (e) {
      toast.error(e instanceof ErroApp && e.detalhe.erro === 'sem_consentimento' ? 'Registre antes a autorização de uso de imagem desta pessoa (em Autorizações).' : erroMsg(e));
    } finally { setEnviando(false); }
  }
  async function tirar() {
    try { await remover.mutateAsync({ p_pessoa: pessoa.id }); toast.success('Foto removida'); } catch (e) { toast.error(erroMsg(e)); }
  }
  return (
    <div className="bg-card flex items-center gap-4 rounded-[18px] p-4">
      <div className="bg-muted text-muted-foreground font-rounded flex aspect-[3/4] w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-[12px] text-[26px] font-bold">
        {pessoa.foto_caminho && url.data ? <img src={url.data} alt={`Foto 3x4 de ${pessoa.nome}`} className="size-full object-cover" /> : <span aria-hidden="true">{iniciais(pessoa.nome)}</span>}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-[15px] font-semibold">Foto 3x4 <span className="text-muted-foreground font-normal">(opcional)</span></p>
        {!editar ? null : !autorizada && !pessoa.foto_caminho ? (
          <p className="text-muted-foreground text-[13px]">Para guardar a foto, registre antes a autorização de uso de imagem em Autorizações, logo abaixo.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {autorizada && <Button variant="secondary" size="sm" disabled={enviando} onClick={() => abrirSeletor(entrada.current)}>
              {enviando ? <Spinner data-icon="inline-start" /> : <Camera data-icon="inline-start" aria-hidden="true" />}{pessoa.foto_caminho ? 'Trocar' : 'Adicionar foto'}</Button>}
            {pessoa.foto_caminho && <Button variant="ghost" size="sm" disabled={remover.isPending} onClick={() => void tirar()}><Trash2 data-icon="inline-start" aria-hidden="true" />Remover</Button>}
          </div>
        )}
        <input ref={entrada} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true"
          onChange={(e) => { void enviar(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
    </div>
  );
}

export function FichaEsportiva({ pessoa }: { pessoa: Pessoa }) {
  const perfil = usePerfil();
  const [editar, setEditar] = useState(false);
  const p = pessoa;
  const vazia = !p.apelido && p.numero_camisa === null && !p.posicao && !p.tamanho_uniforme && !p.na_associacao_desde && !p.emergencia_nome;
  const podeEditar = pode(perfil, 'pessoas', 'editar') && p.situacao !== 'desligado';
  return (
    <Grupo titulo="Ficha do atleta" acao={podeEditar ? <Button variant="link" size="xs" onClick={() => setEditar(true)}>{vazia ? 'Preencher' : 'Editar'}</Button> : undefined}
      rodape="Sem dados de saúde aqui: classe funcional e deficiência ficam na área de saúde.">
      {vazia && <Linha titulo="Nada preenchido ainda" descricao="Apelido, camisa, posição, uniforme e contato de emergência." />}
      {(p.apelido || p.numero_camisa !== null) && <Linha icone={Hash} cor="azul" titulo={[p.numero_camisa !== null && `Camisa ${p.numero_camisa}`, p.apelido && `“${p.apelido}”`].filter(Boolean).join(' · ')} />}
      {p.posicao && <Linha icone={UserRound} cor="indigo" titulo="Posição" valor={p.posicao} />}
      {p.tamanho_uniforme && <Linha icone={Shirt} cor="teal" titulo="Uniforme" valor={p.tamanho_uniforme} />}
      {p.na_associacao_desde && <Linha icone={Ruler} cor="cinza" titulo="Na Associação Exemplo desde" valor={formatarData(p.na_associacao_desde)} />}
      {p.emergencia_nome && <Linha icone={Phone} cor="vermelho" titulo={`Emergência: ${p.emergencia_nome}`} descricao={formatarTelefone(p.emergencia_telefone) || undefined} />}
      {editar && <EditarFicha pessoa={p} aoFechar={() => setEditar(false)} />}
    </Grupo>
  );
}

function EditarFicha({ pessoa, aoFechar }: { pessoa: Pessoa; aoFechar: () => void }) {
  const salvar = useAcaoF4('salvar_ficha_atleta');
  const [f, setF] = useState(() => fichaInicial(pessoa));
  const [erro, setErro] = useState<string | null>(null);
  async function enviar() {
    setErro(null);
    try { await salvar.mutateAsync({ p_pessoa: pessoa.id, p: fichaParaEnvio(f) }); toast.success('Ficha salva'); aoFechar(); }
    catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && !salvar.isPending && aoFechar()} titulo="Ficha do atleta" descricao={pessoa.nome}
      rodape={<Button size="lg" className="w-full" disabled={!fichaValida(f) || salvar.isPending} onClick={() => void enviar()}>{salvar.isPending && <Spinner data-icon="inline-start" />}Salvar</Button>}>
      <FieldGroup className="pb-2">
        <CamposFicha f={f} muda={(x) => setF((v) => ({ ...v, ...x }))} />
        <FieldDescription>Ao desligar a pessoa, o contato de emergência e a foto são apagados.</FieldDescription>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

export type FormFicha = ReturnType<typeof fichaInicial>;
export function fichaInicial(p?: Pessoa | null) {
  return {
    apelido: p?.apelido ?? '', numero_camisa: p?.numero_camisa == null ? '' : String(p.numero_camisa), posicao: p?.posicao ?? '',
    tamanho_uniforme: p?.tamanho_uniforme ?? '', na_associacao_desde: p?.na_associacao_desde ?? '',
    emergencia_nome: p?.emergencia_nome ?? '', emergencia_telefone: p?.emergencia_telefone ? formatarTelefone(p.emergencia_telefone) : '',
  };
}
const camisaOk = (f: FormFicha) => f.numero_camisa === '' || /^\d{1,2}$/.test(f.numero_camisa);
const telOk = (f: FormFicha) => !f.emergencia_telefone.trim() || /^\+?\d{10,13}$/.test(soTelefone(f.emergencia_telefone));
export const fichaValida = (f: FormFicha) => camisaOk(f) && telOk(f);
export const fichaVazia = (f: FormFicha) => Object.values(f).every((v) => !v.trim());
export function fichaParaEnvio(f: FormFicha) {
  const t = (s: string) => s.trim() || null;
  return {
    apelido: t(f.apelido), numero_camisa: f.numero_camisa === '' ? null : Number(f.numero_camisa), posicao: t(f.posicao), tamanho_uniforme: f.tamanho_uniforme || null,
    na_associacao_desde: f.na_associacao_desde || null, emergencia_nome: t(f.emergencia_nome),
    emergencia_telefone: f.emergencia_telefone.trim() ? soTelefone(f.emergencia_telefone) : null,
  };
}

export function CamposFicha({ f, muda }: { f: FormFicha; muda: (x: Partial<FormFicha>) => void }) {
  return (
    <>
        <div className="grid grid-cols-2 gap-3">
          <Field><FieldLabel htmlFor="fa-apelido">Apelido</FieldLabel><Input id="fa-apelido" name="fa-apelido" maxLength={40} autoComplete="off" value={f.apelido} onChange={(e) => muda({ apelido: e.target.value })} /></Field>
          <Field data-invalid={!camisaOk(f) || undefined}><FieldLabel htmlFor="fa-camisa">Número da camisa</FieldLabel>
            <Input id="fa-camisa" name="fa-camisa" inputMode="numeric" maxLength={2} autoComplete="off" placeholder="0 a 99" aria-invalid={!camisaOk(f) || undefined} value={f.numero_camisa} onChange={(e) => muda({ numero_camisa: e.target.value.replace(/\D/g, '') })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field><FieldLabel htmlFor="fa-posicao">Posição</FieldLabel><Input id="fa-posicao" name="fa-posicao" maxLength={40} autoComplete="off" placeholder="Ex.: pivô, goleiro" value={f.posicao} onChange={(e) => muda({ posicao: e.target.value })} /></Field>
          <Field><FieldLabel htmlFor="fa-uniforme">Uniforme</FieldLabel>
            <Select value={f.tamanho_uniforme || 'nenhum'} onValueChange={(v) => muda({ tamanho_uniforme: v === 'nenhum' ? '' : v })}>
              <SelectTrigger id="fa-uniforme"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value="nenhum">Não informado</SelectItem>{TAMANHOS.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectGroup></SelectContent>
            </Select></Field>
        </div>
        <Field><FieldLabel htmlFor="fa-desde">Na Associação Exemplo desde</FieldLabel><Input id="fa-desde" name="fa-desde" type="date" max={hojeSP()} value={f.na_associacao_desde} onChange={(e) => muda({ na_associacao_desde: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field><FieldLabel htmlFor="fa-em-nome">Contato de emergência</FieldLabel><Input id="fa-em-nome" name="fa-em-nome" maxLength={120} autoComplete="off" placeholder="Nome" value={f.emergencia_nome} onChange={(e) => muda({ emergencia_nome: e.target.value })} /></Field>
          <Field data-invalid={!telOk(f) || undefined}><FieldLabel htmlFor="fa-em-tel">Telefone</FieldLabel><Input id="fa-em-tel" name="fa-em-tel" type="tel" inputMode="tel" maxLength={20} autoComplete="off" placeholder="(11) 90000-0000" aria-invalid={!telOk(f) || undefined} value={f.emergencia_telefone} onChange={(e) => muda({ emergencia_telefone: e.target.value })} /></Field>
        </div>
    </>
  );
}
