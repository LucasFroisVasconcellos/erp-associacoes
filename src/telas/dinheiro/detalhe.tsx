// Nada se apaga: erro vira estorno, com motivo.
import { abrirSeletor } from '@/lib/seletor';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, CheckCircle2, FileText, FileUp, Image as ImageIcon, PencilLine, Undo2, XCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { BlocoErro, CarregandoLista } from '@/components/app/estados';
import { Folha } from '@/components/app/folha';
import { Grupo, Linha } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { Valor } from '@/components/app/valor';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { usePerfil } from '@/app/sessao';
import { chaves, useAcao, useCategorias, useComprovantes, useContas, useLancamento } from '@/dados/consultas';
import { fonte } from '@/dados/fonte';
import type { Lancamento } from '@/dados/tipos';
import { pode } from '@/lib/acesso';
import { prepararComprovante } from '@/lib/comprovante';
import { formatarData, hojeSP } from '@/lib/datas';
import { ErroApp, mensagemErro } from '@/lib/erros';
import { FORMAS } from './novo-lancamento';

const SITUACAO = { realizada: 'Realizado', prevista: 'Previsto', cancelada: 'Cancelado' } as const;
const msg = (e: unknown) => (e instanceof ErroApp ? e.message : mensagemErro({ erro: 'falha_interna' }));

function Comprovantes({ l }: { l: Lancamento }) {
  const qc = useQueryClient();
  const perfil = usePerfil();
  const c = useComprovantes(l.id);
  const camera = useRef<HTMLInputElement>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const podeAnexar = pode(perfil, 'financeiro', 'editar') || (l.criado_por === perfil.membro.id && pode(perfil, 'financeiro', 'criar'));

  async function anexar(lista: FileList | null, origem: 'camera' | 'galeria') {
    if (!lista?.length || enviando) return;
    setEnviando(true);
    try {
      for (const f of Array.from(lista).slice(0, 6)) {
        const r = await prepararComprovante(f, origem);
        if ('erro' in r) { toast.error(mensagemErro({ erro: r.erro })); continue; }
        const fd = new FormData();
        fd.set('destino', 'comprovante'); fd.set('lancamento_id', l.id); fd.set('origem', r.origem); fd.set('arquivo', r.arquivo);
        const res = await fonte().enviarArquivo(fd);
        if (res.duplicado) toast.warning('Esse comprovante já foi usado em outro lançamento. Confira se não é repetido.');
      }
      toast.success('Comprovante anexado');
      for (const k of [chaves.comprovantes(l.id), chaves.lancamento(l.id), ['lancamentos'], chaves.painel]) void qc.invalidateQueries({ queryKey: k });
    } catch (e) { toast.error(msg(e)); } finally { setEnviando(false); }
  }
  async function abrir(caminho: string) {
    // abre a janela já no clique (bloqueador de pop-up) e só então busca a URL assinada de 60 s
    const janela = window.open('about:blank', '_blank');
    try {
      const url = await fonte().urlArquivo('comprovantes', caminho);
      if (janela) { janela.opener = null; janela.location.href = url; }
    } catch (e) { janela?.close(); toast.error(msg(e)); }
  }
  return (
    <Grupo titulo="Comprovantes" rodape={l.sem_comprovante_motivo ? `Sem comprovante: ${l.sem_comprovante_motivo}` : undefined}>
      {c.isPending ? <Linha titulo="Carregando…" /> : (c.data ?? []).length === 0
        ? <Linha titulo="Nenhum comprovante anexado" descricao={l.tipo === 'saida' && l.situacao === 'realizada' ? 'Toda saída precisa de comprovante ou justificativa.' : undefined} />
        : c.data!.map((x, i) => (
          <Linha key={x.id} icone={x.mime === 'application/pdf' || x.mime.includes('xml') ? FileText : ImageIcon} cor="cinza"
            titulo={`Comprovante ${i + 1}`} descricao={`${x.mime === 'application/pdf' ? 'PDF' : x.mime.includes('xml') ? 'XML da nota' : 'Imagem'} · ${Math.round(x.tamanho / 1024)} KB${x.chave_acesso ? ' · com chave da nota' : ''}`}
            aoTocar={() => void abrir(x.caminho)} seta />
        ))}
      {podeAnexar && (
        <div className="flex gap-2 px-4 py-3">
          <Button variant="secondary" size="sm" disabled={enviando} onClick={() => abrirSeletor(camera.current)}><Camera data-icon="inline-start" aria-hidden="true" />Tirar foto</Button>
          <Button variant="secondary" size="sm" disabled={enviando} onClick={() => abrirSeletor(arquivo.current)}>
            {enviando ? <Spinner data-icon="inline-start" /> : <FileUp data-icon="inline-start" aria-hidden="true" />}{enviando ? 'Enviando…' : 'Escolher arquivo'}
          </Button>
          <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { void anexar(e.target.files, 'camera'); e.target.value = ''; }} />
          <input ref={arquivo} type="file" accept="image/*,application/pdf,.xml,text/xml" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { void anexar(e.target.files, 'galeria'); e.target.value = ''; }} />
        </div>
      )}
    </Grupo>
  );
}

type Dialogo = null | 'estornar' | 'cancelar' | 'justificar' | 'baixa' | 'corrigir';

export function DetalheLancamento() {
  const { id = '' } = useParams();
  const perfil = usePerfil();
  const l = useLancamento(id);
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  if (l.isPending) return <Pagina titulo="Lançamento" voltar={{ para: '/dinheiro', rotulo: 'Dinheiro' }}><CarregandoLista linhas={5} /></Pagina>;
  if (l.isError || !l.data) {
    return <Pagina titulo="Lançamento" voltar={{ para: '/dinheiro', rotulo: 'Dinheiro' }}><BlocoErro erro={l.error ?? new ErroApp({ erro: 'nao_encontrado' })} tentarDeNovo={() => void l.refetch()} /></Pagina>;
  }
  const x = l.data;
  const meu = x.criado_por === perfil.membro.id;
  const editar = pode(perfil, 'financeiro', 'editar');
  const podeCorrigir = (editar || (meu && pode(perfil, 'financeiro', 'criar'))) && x.situacao !== 'cancelada' && !x.estornado && !x.estorno_de;
  const semComp = x.tipo === 'saida' && x.situacao === 'realizada' && !x.comprovantes && !x.sem_comprovante_motivo && !x.estorno_de;
  const forma = FORMAS.find((f) => f.valor === x.forma_pagamento)?.rotulo;
  return (
    <Pagina titulo={x.tipo === 'entrada' ? 'Entrada' : 'Saída'} voltar={{ para: '/dinheiro', rotulo: 'Dinheiro' }}
      acoes={podeCorrigir ? <Button variant="ghost" size="sm" onClick={() => setDialogo('corrigir')}><PencilLine data-icon="inline-start" aria-hidden="true" />Corrigir</Button> : undefined}>
      <section className="bg-card flex flex-col items-center gap-2 rounded-[24px] px-5 py-7 text-center">
        <Valor valor={x.valor} tipo={x.tipo} className={`font-rounded text-[40px] leading-none font-bold tracking-[-0.03em] ${x.estornado || x.situacao === 'cancelada' ? 'text-muted-foreground line-through' : ''}`} />
        <p className="text-[17px] font-medium text-pretty">{x.descricao}</p>
        <div className="flex flex-wrap justify-center gap-1.5">
          <Badge variant={x.situacao === 'realizada' ? 'secondary' : 'outline'}>{SITUACAO[x.situacao]}</Badge>
          {x.estornado && <Badge variant="outline">Estornado</Badge>}
          {x.estorno_de && <Badge variant="outline">Estorno</Badge>}
          {semComp && <Badge variant="destructive">Sem comprovante</Badge>}
        </div>
      </section>
      <Grupo titulo="Detalhes">
        <Linha titulo={x.situacao === 'prevista' ? 'Vencimento' : 'Data'} valor={formatarData(x.data)} />
        {x.data_documento && <Linha titulo="Data do gasto" valor={formatarData(x.data_documento)} />}
        <Linha titulo="Conta" valor={x.conta ?? '—'} />
        <Linha titulo="Categoria" valor={x.categoria ?? '—'} />
        {forma && <Linha titulo="Forma de pagamento" valor={forma} />}
        {Object.entries(x.detalhes ?? {}).map(([k, v]) => <Linha key={k} titulo={k.charAt(0).toUpperCase() + k.slice(1)} valor={String(v)} />)}
        <Linha titulo="Lançado por" valor={x.autor ?? '—'} />
        {x.motivo && <Linha titulo="Motivo" descricao={x.motivo} />}
      </Grupo>
      <Comprovantes l={x} />
      <Grupo titulo="Ações">
        {semComp && (editar || meu) && <Linha icone={FileText} cor="laranja" titulo="Justificar sem comprovante" descricao="Ex.: tarifa do banco, débito automático." aoTocar={() => setDialogo('justificar')} />}
        {x.situacao === 'prevista' && pode(perfil, 'financeiro', 'aprovar') && <Linha icone={CheckCircle2} cor="verde" titulo={x.tipo === 'saida' ? 'Registrar pagamento' : 'Registrar recebimento'} aoTocar={() => setDialogo('baixa')} />}
        {x.situacao === 'prevista' && (editar || meu) && <Linha icone={XCircle} cor="cinza" titulo="Cancelar previsão" aoTocar={() => setDialogo('cancelar')} />}
        {x.situacao === 'realizada' && editar && !x.estornado && !x.estorno_de && <Linha icone={Undo2} cor="vermelho" titulo="Estornar lançamento" descricao="Cria um lançamento inverso. Nada é apagado." destrutiva aoTocar={() => setDialogo('estornar')} />}
      </Grupo>
      {(dialogo === 'estornar' || dialogo === 'cancelar' || dialogo === 'justificar') && <ComMotivo tipo={dialogo} l={x} aoFechar={() => setDialogo(null)} />}
      {dialogo === 'baixa' && <DarBaixa l={x} aoFechar={() => setDialogo(null)} />}
      {dialogo === 'corrigir' && <Corrigir l={x} aoFechar={() => setDialogo(null)} />}
    </Pagina>
  );
}

function ComMotivo({ tipo, l, aoFechar }: { tipo: 'estornar' | 'cancelar' | 'justificar'; l: Lancamento; aoFechar: () => void }) {
  const qc = useQueryClient();
  const rpc = { estornar: 'estornar_lancamento', cancelar: 'cancelar_lancamento', justificar: 'justificar_sem_comprovante' }[tipo];
  const acao = useAcao(rpc);
  const [motivo, setMotivo] = useState('');
  const textos = {
    estornar: { t: 'Estornar este lançamento?', d: 'Será criado um lançamento inverso, com data de hoje. O original continua no histórico.', b: 'Estornar' },
    cancelar: { t: 'Cancelar esta previsão?', d: 'A conta a pagar ou receber sai das listas. O registro continua no histórico.', b: 'Cancelar previsão' },
    justificar: { t: 'Justificar a falta de comprovante', d: 'Explique por que não existe comprovante. Fica registrado com seu nome.', b: 'Salvar justificativa' },
  }[tipo];
  async function confirmar() {
    try {
      await acao.mutateAsync({ p_id: l.id, p_motivo: motivo.trim() });
      toast.success(tipo === 'estornar' ? 'Lançamento estornado' : tipo === 'cancelar' ? 'Previsão cancelada' : 'Justificativa salva');
      void qc.invalidateQueries({ queryKey: chaves.lancamento(l.id) });
      aoFechar();
    } catch (e) { toast.error(msg(e)); }
  }
  return (
    <AlertDialog open onOpenChange={(v) => !v && aoFechar()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{textos.t}</AlertDialogTitle>
          <AlertDialogDescription>{textos.d}</AlertDialogDescription>
        </AlertDialogHeader>
        <Field>
          <FieldLabel htmlFor="motivo">Motivo</FieldLabel>
          <Textarea id="motivo" name="motivo" maxLength={300} autoComplete="off" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Escreva o motivo…" />
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <AlertDialogAction variant={tipo === 'estornar' ? 'destructive' : 'default'} disabled={motivo.trim().length < 3 || acao.isPending}
            onClick={(e) => { e.preventDefault(); void confirmar(); }}>
            {acao.isPending && <Spinner data-icon="inline-start" />}{textos.b}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DarBaixa({ l, aoFechar }: { l: Lancamento; aoFechar: () => void }) {
  const contas = useContas();
  const acao = useAcao('realizar_lancamento');
  const [conta, setConta] = useState('');
  const [data, setData] = useState(hojeSP());
  async function confirmar() {
    try { await acao.mutateAsync({ p_id: l.id, p_data: data, p_conta_id: conta }); toast.success('Baixa registrada'); aoFechar(); }
    catch (e) { toast.error(msg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo={l.tipo === 'saida' ? 'Registrar pagamento' : 'Registrar recebimento'} descricao={l.descricao}
      rodape={<Button size="lg" className="w-full" disabled={!conta || acao.isPending} onClick={() => void confirmar()}>{acao.isPending && <Spinner data-icon="inline-start" />}Confirmar</Button>}>
      <FieldGroup className="pb-2">
        <Field>
          <FieldLabel htmlFor="baixa-conta">Conta</FieldLabel>
          <Select value={conta} onValueChange={setConta}>
            <SelectTrigger id="baixa-conta"><SelectValue placeholder="Escolha a conta" /></SelectTrigger>
            <SelectContent><SelectGroup>{(contas.data ?? []).filter((c) => c.ativa).map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="baixa-data">Data em que aconteceu</FieldLabel>
          <Input name="baixa-data" id="baixa-data" type="date" max={hojeSP()} value={data} onChange={(e) => setData(e.target.value)} />
        </Field>
      </FieldGroup>
    </Folha>
  );
}

function Corrigir({ l, aoFechar }: { l: Lancamento; aoFechar: () => void }) {
  const categorias = useCategorias();
  const acao = useAcao('editar_lancamento');
  const [descricao, setDescricao] = useState(l.descricao);
  const [categoria, setCategoria] = useState(l.categoria_id ?? '');
  async function salvar() {
    try {
      await acao.mutateAsync({ p_id: l.id, p: { descricao: descricao.trim(), categoria_id: categoria } });
      toast.success('Lançamento corrigido'); aoFechar();
    } catch (e) { toast.error(msg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo="Corrigir lançamento" descricao="Para mudar o valor ou a data de algo já realizado, estorne e lance de novo."
      rodape={<Button size="lg" className="w-full" disabled={descricao.trim().length < 2 || !categoria || acao.isPending} onClick={() => void salvar()}>{acao.isPending && <Spinner data-icon="inline-start" />}Salvar correção</Button>}>
      <FieldGroup className="pb-2">
        <Field>
          <FieldLabel htmlFor="corr-desc">Descrição</FieldLabel>
          <Input name="corr-desc" id="corr-desc" maxLength={200} autoComplete="off" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="corr-cat">Categoria</FieldLabel>
          <Select value={categoria} onValueChange={setCategoria}>
            <SelectTrigger id="corr-cat"><SelectValue placeholder="Escolha a categoria" /></SelectTrigger>
            <SelectContent><SelectGroup>{(categorias.data ?? []).filter((c) => c.tipo === l.tipo).map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
          <FieldDescription>Toda correção fica na trilha de auditoria, com o antes e o depois.</FieldDescription>
        </Field>
      </FieldGroup>
    </Folha>
  );
}
