// Quem tem alcance "próprios" só vê as suas; quem decide é o banco (RLS).
// Mover é por botão, não por arrastar: funciona com toque, teclado e leitor de tela.
import { ArrowRight, CalendarClock, Check, ChevronDown, CircleDot, ListChecks, MoreHorizontal, Plus, Repeat, User, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { BlocoErro, CarregandoLista, Vazio } from '@/components/app/estados';
import { Folha } from '@/components/app/folha';
import { Grupo, Linha } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { Segmentado } from '@/components/app/segmentado';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { usePerfil } from '@/app/sessao';
import { useAcaoOrg, useAgenda, useMembros, useTarefas } from '@/dados/consultas';
import { fonte } from '@/dados/fonte';
import type { Prioridade, SituacaoTarefa, Tarefa } from '@/dados/tipos';
import { type Perfil, pode } from '@/lib/acesso';
import { formatarData, hojeSP, somarDias } from '@/lib/datas';
import { contar } from '@/lib/texto';
import { NOME_PRIORIDADE, NOME_SITUACAO, SeletorPessoa, erroMsg, nomeDe } from '@/telas/organizacao/comum';

type Visao = 'quadro' | 'lista';
type Filtro = 'minhas' | 'todas';
const COLUNAS: SituacaoTarefa[] = ['a_fazer', 'fazendo', 'feito'];

export const podeEditarTarefa = (perfil: Perfil, t: Tarefa) =>
  pode(perfil, 'tarefas', 'editar') || (t.criado_por === perfil.membro.id && pode(perfil, 'tarefas', 'criar'));
export const podeAndarTarefa = (perfil: Perfil, t: Tarefa) => podeEditarTarefa(perfil, t) || t.responsavel === perfil.membro.id;

export function Prazo({ t, hoje }: { t: Pick<Tarefa, 'prazo' | 'situacao'>; hoje: string }) {
  if (!t.prazo) return null;
  const atrasada = t.prazo < hoje && (t.situacao === 'a_fazer' || t.situacao === 'fazendo');
  const texto = t.prazo === hoje ? 'Hoje' : t.prazo === somarDias(hoje, 1) ? 'Amanhã' : formatarData(t.prazo);
  return <Badge variant={atrasada ? 'destructive' : 'secondary'}><CalendarClock aria-hidden="true" />{atrasada ? `Atrasada · ${texto}` : texto}</Badge>;
}

export function Tarefas() {
  const perfil = usePerfil();
  const hoje = hojeSP();
  const [params, setParams] = useSearchParams();
  const eventoFiltro = params.get('evento');
  const [visao, setVisao] = useState<Visao>('quadro');
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [nova, setNova] = useState(() => params.get('nova') === '1');
  const tarefas = useTarefas();
  const gerou = useRef(false);
  useEffect(() => {
    if (gerou.current) return;
    gerou.current = true;
    void fonte().rpc('gerar_tarefas_recorrentes').then((r) => { if ((r as { criadas?: number }).criadas) void tarefas.refetch(); }).catch(() => undefined);
  }, [tarefas]);

  const lista = useMemo(() => (tarefas.data ?? [])
    .filter((t) => t.situacao !== 'cancelada')
    .filter((t) => filtro === 'todas' || t.responsavel === perfil.membro.id)
    .filter((t) => !eventoFiltro || t.evento_id === eventoFiltro), [tarefas.data, filtro, perfil.membro.id, eventoFiltro]);

  return (
    <Pagina titulo="Tarefas" acoes={
      <>
        {pode(perfil, 'tarefas', 'criar') && <Button size="icon" variant="ghost" aria-label="Nova tarefa" onClick={() => setNova(true)}><Plus aria-hidden="true" /></Button>}
        <Button asChild size="icon" variant="ghost"><Link to="/tarefas/rotinas" aria-label="Tarefas recorrentes e modelos"><Repeat aria-hidden="true" /></Link></Button>
      </>
    } sob={
      <div className="flex flex-col gap-2">
        <Segmentado<Visao> rotulo="Como mostrar" valor={visao} aoMudar={setVisao} opcoes={[{ valor: 'quadro', rotulo: 'Quadro' }, { valor: 'lista', rotulo: 'Por prazo' }]} />
        <Segmentado<Filtro> rotulo="De quem" valor={filtro} aoMudar={setFiltro} opcoes={[{ valor: 'todas', rotulo: 'Todas' }, { valor: 'minhas', rotulo: 'Minhas' }]} />
      </div>
    }>
      {eventoFiltro && (
        <div className="bg-card flex items-center justify-between gap-3 rounded-[14px] px-4 py-3 text-[15px]">
          <span>Mostrando só as tarefas de um evento.</span>
          <Button variant="ghost" size="sm" onClick={() => { params.delete('evento'); setParams(params); }}><X data-icon="inline-start" aria-hidden="true" />Ver todas</Button>
        </div>
      )}
      {tarefas.isError ? <BlocoErro erro={tarefas.error} tentarDeNovo={() => void tarefas.refetch()} />
        : tarefas.isPending ? <CarregandoLista linhas={5} rotulo="Carregando as tarefas…" />
          : lista.length === 0 ? (
            <Vazio icone={ListChecks} titulo={filtro === 'minhas' ? 'Nenhuma tarefa sua' : 'Nenhuma tarefa ainda'}
              descricao="Crie tarefas com responsável e prazo, ou use um modelo a partir de um evento da agenda."
              acao={pode(perfil, 'tarefas', 'criar') ? <Button onClick={() => setNova(true)}><Plus data-icon="inline-start" aria-hidden="true" />Nova tarefa</Button> : undefined} />
          ) : visao === 'quadro' ? <Quadro tarefas={lista} hoje={hoje} /> : <PorPrazo tarefas={lista} hoje={hoje} />}
      {nova && <FormTarefa tarefa={null} eventoInicial={eventoFiltro} aoFechar={() => setNova(false)} />}
    </Pagina>
  );
}

function MoverTarefa({ t }: { t: Tarefa }) {
  const perfil = usePerfil();
  const mudar = useAcaoOrg('mudar_situacao_tarefa');
  if (!podeAndarTarefa(perfil, t)) return null;
  const proxima: SituacaoTarefa | null = t.situacao === 'a_fazer' ? 'fazendo' : t.situacao === 'fazendo' ? 'feito' : null;
  const ir = (s: SituacaoTarefa) => mudar.mutate({ p_id: t.id, p_situacao: s }, { onError: (e) => toast.error(erroMsg(e)) });
  return (
    <div className="flex items-center gap-1">
      {proxima && (
        <Button size="sm" variant={proxima === 'feito' ? 'default' : 'secondary'} disabled={mudar.isPending} onClick={() => ir(proxima)}>
          {proxima === 'feito' ? <Check data-icon="inline-start" aria-hidden="true" /> : <ArrowRight data-icon="inline-start" aria-hidden="true" />}
          {proxima === 'feito' ? 'Concluir' : 'Começar'}
          <span className="sr-only">: {t.titulo}</span>
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={`Mover a tarefa ${t.titulo}`}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Mover para</DropdownMenuLabel>
          <DropdownMenuGroup>
            {COLUNAS.filter((c) => c !== t.situacao).map((c) => <DropdownMenuItem key={c} onSelect={() => ir(c)}><CircleDot aria-hidden="true" />{NOME_SITUACAO[c]}</DropdownMenuItem>)}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild><Link to={`/tarefas/${t.id}`}>Abrir</Link></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function Cartao({ t, hoje }: { t: Tarefa; hoje: string }) {
  const membros = useMembros();
  return (
    <li className="bg-card flex flex-col gap-2 rounded-[14px] p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <Link to={`/tarefas/${t.id}`} className="rounded-[6px] text-[17px] leading-snug font-medium focus-visible:ring-4 focus-visible:ring-ring/35">
        {t.prioridade === 'alta' && <span className="text-destructive mr-1" aria-label="Prioridade alta">!</span>}
        {t.titulo}
      </Link>
      <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-[13px]">
        <Prazo t={t} hoje={hoje} />
        <span className="inline-flex items-center gap-1"><User aria-hidden="true" className="size-3.5" />{nomeDe(membros.data, t.responsavel)}</span>
        {!!t.itens_total && <span className="inline-flex items-center gap-1"><ListChecks aria-hidden="true" className="size-3.5" />{t.itens_feitos}/{t.itens_total}</span>}
        {t.recorrencia_id && <Repeat aria-label="Tarefa recorrente" className="size-3.5" />}
      </div>
      <div className="flex justify-end"><MoverTarefa t={t} /></div>
    </li>
  );
}

function Quadro({ tarefas, hoje }: { tarefas: Tarefa[]; hoje: string }) {
  return (
    <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0">
      {COLUNAS.map((c) => {
        const daColuna = tarefas.filter((t) => t.situacao === c)
          .sort((a, b) => (a.prazo ?? '9999').localeCompare(b.prazo ?? '9999'));
        return (
          <section key={c} aria-label={`${NOME_SITUACAO[c]}: ${contar(daColuna.length, 'tarefa', 'tarefas')}`}
            className="bg-muted/60 flex w-[82%] shrink-0 snap-start flex-col gap-2 rounded-[18px] p-2 sm:w-auto">
            <h2 className="flex items-center justify-between px-2 pt-1 text-[15px] font-semibold">
              {NOME_SITUACAO[c]}<span className="text-muted-foreground text-[13px] font-normal tabular-nums">{daColuna.length}</span>
            </h2>
            <ul className="flex flex-col gap-2">
              {daColuna.length === 0 && <li className="text-muted-foreground px-2 py-6 text-center text-[13px]">Nenhuma</li>}
              {daColuna.map((t) => <Cartao key={t.id} t={t} hoje={hoje} />)}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function PorPrazo({ tarefas, hoje }: { tarefas: Tarefa[]; hoje: string }) {
  const membros = useMembros();
  const abertas = tarefas.filter((t) => t.situacao === 'a_fazer' || t.situacao === 'fazendo');
  const grupos: [string, Tarefa[]][] = [
    ['Atrasadas', abertas.filter((t) => t.prazo && t.prazo < hoje)],
    ['Hoje', abertas.filter((t) => t.prazo === hoje)],
    ['Próximos 7 dias', abertas.filter((t) => t.prazo && t.prazo > hoje && t.prazo <= somarDias(hoje, 7))],
    ['Mais adiante', abertas.filter((t) => t.prazo && t.prazo > somarDias(hoje, 7))],
    ['Sem prazo', abertas.filter((t) => !t.prazo)],
    ['Concluídas recentemente', tarefas.filter((t) => t.situacao === 'feito')],
  ];
  return (
    <>
      {grupos.filter(([, l]) => l.length).map(([titulo, l]) => (
        <Grupo key={titulo} titulo={`${titulo} (${l.length})`}>
          {l.sort((a, b) => (a.prazo ?? '9999').localeCompare(b.prazo ?? '9999')).map((t) => (
            <Linha key={t.id} icone={t.situacao === 'feito' ? Check : t.situacao === 'fazendo' ? ArrowRight : CircleDot}
              cor={t.situacao === 'feito' ? 'verde' : titulo === 'Atrasadas' ? 'vermelho' : t.situacao === 'fazendo' ? 'laranja' : 'azul'}
              titulo={t.titulo} para={`/tarefas/${t.id}`}
              descricao={[NOME_SITUACAO[t.situacao], t.prazo && formatarData(t.prazo), nomeDe(membros.data, t.responsavel),
                t.itens_total ? `${t.itens_feitos}/${t.itens_total} itens` : null].filter(Boolean).join(' · ')} />
          ))}
        </Grupo>
      ))}
    </>
  );
}

export function FormTarefa({ tarefa, eventoInicial, aoFechar }: { tarefa: Tarefa | null; eventoInicial?: string | null; aoFechar: () => void }) {
  const hoje = hojeSP();
  const acao = useAcaoOrg(tarefa ? 'editar_tarefa' : 'criar_tarefa');
  const agenda = useAgenda(hoje, somarDias(hoje, 119));
  const [id] = useState(() => tarefa?.id ?? crypto.randomUUID());
  const [titulo, setTitulo] = useState(tarefa?.titulo ?? '');
  const [descricao, setDescricao] = useState(tarefa?.descricao ?? '');
  const [responsavel, setResponsavel] = useState(tarefa?.responsavel ?? '');
  const [prazo, setPrazo] = useState(tarefa?.prazo ?? '');
  const [prioridade, setPrioridade] = useState<Prioridade>(tarefa?.prioridade ?? 'normal');
  const [lembrete] = useState(String(tarefa?.lembrete_dias ?? 1));
  const [evento, setEvento] = useState(tarefa?.evento_id ?? eventoInicial ?? '');
  const [itens, setItens] = useState('');
  const [mais, setMais] = useState(Boolean(tarefa?.descricao || tarefa?.evento_id || eventoInicial));
  const [erro, setErro] = useState<string | null>(null);
  const eventos = (agenda.data?.eventos ?? []).filter((e) => !e.cancelado_em);
  async function salvar() {
    setErro(null);
    const campos = {
      titulo: titulo.trim(), descricao: descricao.trim() || null, prazo: prazo || null, prioridade,
      lembrete_dias: Number(lembrete), ...(responsavel ? { responsavel } : {}),
    };
    try {
      if (tarefa) {
        await acao.mutateAsync({ p_id: tarefa.id, p: { ...campos, ...(evento !== (tarefa.evento_id ?? '') ? { evento_id: evento || null } : {}) } });
        toast.success('Tarefa atualizada');
      } else {
        const lista = itens.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 50);
        await acao.mutateAsync({ p: { id, ...campos, ...(evento ? { evento_id: evento } : {}), ...(lista.length ? { itens: lista } : {}) } });
        toast.success('Tarefa criada');
      }
      aoFechar();
    } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo={tarefa ? 'Editar tarefa' : 'Nova tarefa'} larga
      rodape={<Button size="lg" className="w-full" disabled={titulo.trim().length < 2 || acao.isPending} onClick={() => void salvar()}>
        {acao.isPending && <Spinner data-icon="inline-start" />}{tarefa ? 'Salvar mudanças' : 'Criar tarefa'}</Button>}>
      <FieldGroup className="pb-2">
        <Field>
          <FieldLabel htmlFor="tf-titulo">O que precisa ser feito</FieldLabel>
          <Input id="tf-titulo" name="tf-titulo" maxLength={160} autoComplete="off" placeholder="Ex.: Reservar a quadra para o amistoso…" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        </Field>
        <SeletorPessoa id="tf-resp" rotulo="Responsável" valor={responsavel} aoMudar={setResponsavel} opcional={!tarefa} />
        <Field><FieldLabel htmlFor="tf-prazo">Prazo (opcional)</FieldLabel><Input id="tf-prazo" name="tf-prazo" type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} /></Field>
        <Segmentado<Prioridade> rotulo="Prioridade" valor={prioridade} aoMudar={setPrioridade}
          opcoes={(['baixa', 'normal', 'alta'] as Prioridade[]).map((p) => ({ valor: p, rotulo: NOME_PRIORIDADE[p] }))} />
        {!tarefa && (
          <Field>
            <FieldLabel htmlFor="tf-itens">Checklist (opcional)</FieldLabel>
            <Textarea id="tf-itens" name="tf-itens" rows={3} placeholder={'Um item por linha\nEx.: Ligar para o ginásio'} value={itens} onChange={(e) => setItens(e.target.value)} />
          </Field>
        )}
        {!mais && <Button variant="ghost" className="self-start" onClick={() => setMais(true)}><ChevronDown data-icon="inline-start" aria-hidden="true" />Descrição e evento</Button>}
        {mais && (
          <>
            <Field>
              <FieldLabel htmlFor="tf-desc">Descrição (opcional)</FieldLabel>
              <Textarea id="tf-desc" name="tf-desc" rows={3} maxLength={2000} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="tf-evento">Ligada a um evento (opcional)</FieldLabel>
              <Select value={evento || 'nenhum'} onValueChange={(v) => setEvento(v === 'nenhum' ? '' : v)}>
                <SelectTrigger id="tf-evento"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  <SelectItem value="nenhum">Nenhum</SelectItem>
                  {evento && !eventos.some((e) => e.id === evento) && <SelectItem value={evento}>Evento atual</SelectItem>}
                  {eventos.map((e) => <SelectItem key={e.id} value={e.id}>{e.titulo} · {formatarData(hojeSP(new Date(e.inicio)))}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
              <FieldDescription>Eventos dos próximos 4 meses.</FieldDescription>
            </Field>
          </>
        )}
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

