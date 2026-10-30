// Os prazos automáticos vêm do servidor já filtrados pelas permissões de quem vê.
import {
  Ban, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Download, ListChecks, MapPin, MoreHorizontal, Pencil,
  Settings2, Tags, Users, Wallet, Lock, HandCoins, Landmark, IdCard, ScrollText, BookUser, Boxes, Gavel, Megaphone, Plane,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { BlocoErro, CarregandoLista, Vazio } from '@/components/app/estados';
import { Folha } from '@/components/app/folha';
import { Grupo, IconeQuadrado, Linha, type CorIcone } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { Segmentado } from '@/components/app/segmentado';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { usePerfil } from '@/app/sessao';
import { useAcaoOrg, useAgenda, useMembros, useModelos, useTiposEvento } from '@/dados/consultas';
import { fonte } from '@/dados/fonte';
import type { AgendaPeriodo, CorEvento, Evento, IconeEvento, PrazoAgenda } from '@/dados/tipos';
import { pode } from '@/lib/acesso';
import {
  NOMES_DIAS_CURTOS, dataSP, diaPorExtenso, diasDoEvento, gradeDoMes, horaSP, instanteSP, outroMes, semanaDe,
} from '@/lib/agenda';
import { formatarData, hojeSP, mesPorExtenso, somarDias } from '@/lib/datas';
import { baixar } from '@/lib/exportar';
import { gerarIcs } from '@/lib/ics';
import { contar } from '@/lib/texto';
import { cn } from '@/lib/utils';
import { PresencaAtletas } from './presenca';
import { FUNDO_COR, ICONE_EVENTO, NOME_COR, NOME_ICONE, erroMsg, nomeDe, tipoDe } from '@/telas/organizacao/comum';

type Visao = 'mes' | 'semana' | 'lista';

const ICONE_PRAZO: Record<PrazoAgenda['tipo'], { icone: typeof Wallet; cor: CorIcone; rotulo: string }> = {
  a_pagar: { icone: Wallet, cor: 'vermelho', rotulo: 'A pagar' },
  a_receber: { icone: Wallet, cor: 'verde', rotulo: 'A receber' },
  fechamento: { icone: Lock, cor: 'cinza', rotulo: 'Fechamento do mês' },
  tarefa: { icone: ListChecks, cor: 'azul', rotulo: 'Prazo de tarefa' },
  verba: { icone: HandCoins, cor: 'laranja', rotulo: 'Verba' },
  projeto: { icone: Landmark, cor: 'roxo', rotulo: 'Projeto' },
  documento: { icone: IdCard, cor: 'teal', rotulo: 'Documento de atleta ou associado' },
  governanca: { icone: ScrollText, cor: 'indigo', rotulo: 'Governança' },
  reuniao: { icone: Gavel, cor: 'indigo', rotulo: 'Reunião ou assembleia' },
  filiacao: { icone: BookUser, cor: 'azul', rotulo: 'Filiação' },
  patrimonio: { icone: Boxes, cor: 'cinza', rotulo: 'Patrimônio' },
  captacao: { icone: Megaphone, cor: 'laranja', rotulo: 'Captação' },
  contrapartida: { icone: Megaphone, cor: 'roxo', rotulo: 'Contrapartida a entregar' },
  viagem: { icone: Plane, cor: 'teal', rotulo: 'Viagem' },
};

function periodoDa(visao: Visao, foco: string): [string, string] {
  if (visao === 'mes') { const g = gradeDoMes(foco); return [g[0]![0]!, g.at(-1)!.at(-1)!]; }
  if (visao === 'semana') { const s = semanaDe(foco); return [s[0]!, s[6]!]; }
  return [foco, somarDias(foco, 59)];
}

function quando(e: Evento): string {
  const ini = dataSP(e.inicio), fim = diasDoEvento(e).at(-1)!;
  if (e.dia_inteiro) return ini === fim ? 'Dia inteiro' : `${formatarData(ini)} a ${formatarData(fim)}`;
  const h = `${horaSP(e.inicio)}–${horaSP(e.fim)}`;
  return ini === fim ? h : `${formatarData(ini)} ${horaSP(e.inicio)} a ${formatarData(fim)} ${horaSP(e.fim)}`;
}

export function Agenda() {
  const perfil = usePerfil();
  const hoje = hojeSP();
  const [visao, setVisao] = useState<Visao>('mes');
  const [foco, setFoco] = useState(hoje);
  const [dia, setDia] = useState(hoje);
  const [ini, fim] = periodoDa(visao, visao === 'lista' ? hoje : foco);
  const agenda = useAgenda(ini, fim);
  const tipos = useTiposEvento();
  const [aberto, setAberto] = useState<Evento | null>(null);
  const [params] = useSearchParams();
  const [editando, setEditando] = useState<Evento | 'novo' | null>(() => (params.get('novo') === '1' ? 'novo' : null));
  const [gerirTipos, setGerirTipos] = useState(false);
  const podeCriar = pode(perfil, 'agenda', 'criar');

  function mover(delta: number) {
    const novo = visao === 'mes' ? outroMes(foco, delta) : somarDias(foco, delta * 7);
    setFoco(novo);
    setDia(visao === 'mes' ? (novo.slice(0, 7) === hoje.slice(0, 7) ? hoje : novo) : novo);
  }
  async function exportar() {
    try {
      const a = await fonte().rpc<AgendaPeriodo>('agenda_periodo', { p_inicio: somarDias(hoje, -30), p_fim: somarDias(hoje, 89) });
      const lista = a.eventos.map((e) => ({ ...e, tipo: tipoDe(tipos.data, e.tipo_id)?.nome ?? null }));
      baixar(gerarIcs(lista, new Date(), dataSP), `erp-agenda-${hoje}.ics`, 'text/calendar;charset=utf-8');
      toast.success(`${contar(lista.filter((e) => !e.cancelado_em).length, 'evento exportado', 'eventos exportados')}. Abra o arquivo no celular ou importe no Google Agenda.`);
    } catch (e) { toast.error(erroMsg(e, 'Não foi possível exportar agora.')); }
  }

  const mes = mesPorExtenso(foco);
  const titulo = visao === 'mes' ? mes.charAt(0).toUpperCase() + mes.slice(1) : visao === 'semana' ? `Semana de ${formatarData(semanaDe(foco)[0])}` : 'Próximos 60 dias';
  return (
    <Pagina titulo="Agenda" acoes={
      <>
        {podeCriar && <Button size="icon" variant="ghost" aria-label="Novo evento" onClick={() => setEditando('novo')}><CalendarPlus aria-hidden="true" /></Button>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label="Mais opções da agenda"><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => void exportar()}><Download aria-hidden="true" />Exportar para o celular (.ics)</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setGerirTipos(true)}><Tags aria-hidden="true" />Tipos de evento</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    } sob={
      <Segmentado<Visao> rotulo="Visão da agenda" valor={visao} aoMudar={(v) => { setVisao(v); setFoco(dia); }} opcoes={[
        { valor: 'mes', rotulo: 'Mês' }, { valor: 'semana', rotulo: 'Semana' }, { valor: 'lista', rotulo: 'Lista' },
      ]} />
    }>
      {visao !== 'lista' && (
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="icon" aria-label={visao === 'mes' ? 'Mês anterior' : 'Semana anterior'} onClick={() => mover(-1)}><ChevronLeft aria-hidden="true" /></Button>
          <h2 className="text-[17px] font-semibold" aria-live="polite">{titulo}</h2>
          <div className="flex items-center">
            <Button variant="link" size="sm" onClick={() => { setFoco(hoje); setDia(hoje); }}>Hoje</Button>
            <Button variant="ghost" size="icon" aria-label={visao === 'mes' ? 'Próximo mês' : 'Próxima semana'} onClick={() => mover(1)}><ChevronRight aria-hidden="true" /></Button>
          </div>
        </div>
      )}
      {agenda.isError ? <BlocoErro erro={agenda.error} tentarDeNovo={() => void agenda.refetch()} />
        : !agenda.data ? <CarregandoLista linhas={5} rotulo="Carregando a agenda…" />
          : (
            <>
              {tipos.data?.length === 0 && podeCriar && (
                <Vazio icone={Tags} titulo="Comece criando os tipos de evento" descricao="Treino, jogo, viagem, reunião… Use a lista do dossiê ou crie os seus."
                  acao={<Button onClick={() => setGerirTipos(true)}>Criar tipos de evento</Button>} />
              )}
              {visao === 'mes' && <Mes foco={foco} dia={dia} aoEscolher={setDia} dados={agenda.data} hoje={hoje} />}
              <ListaDeDias dias={visao === 'mes' ? [dia] : visao === 'semana' ? semanaDe(foco) : null} dados={agenda.data} hoje={hoje}
                aoAbrir={setAberto} ini={ini} fim={fim} ocultarVazios={visao === 'lista'} />
            </>
          )}
      {aberto && <DetalheEvento evento={aberto} aoFechar={() => setAberto(null)} aoEditar={() => { setEditando(aberto); setAberto(null); }} />}
      {editando && <FormEvento evento={editando === 'novo' ? null : editando} diaInicial={dia} aoFechar={() => setEditando(null)} />}
      {gerirTipos && <TiposDeEvento aoFechar={() => setGerirTipos(false)} />}
    </Pagina>
  );
}

function Mes({ foco, dia, aoEscolher, dados, hoje }: { foco: string; dia: string; aoEscolher: (d: string) => void; dados: AgendaPeriodo; hoje: string }) {
  const tipos = useTiposEvento();
  const porDia = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of dados.eventos) if (!e.cancelado_em) for (const d of diasDoEvento(e)) m.set(d, [...(m.get(d) ?? []), e.tipo_id]);
    for (const p of dados.prazos) m.set(p.data, [...(m.get(p.data) ?? []), `prazo:${p.tipo}`]);
    return m;
  }, [dados]);
  const mes = foco.slice(0, 7);
  return (
    <div className="bg-card rounded-[18px] p-2 sm:p-3">
      <div className="grid grid-cols-7 text-center" aria-hidden="true">
        {NOMES_DIAS_CURTOS.map((n) => <span key={n} className="text-muted-foreground py-1 text-[12px] font-medium uppercase">{n}</span>)}
      </div>
      <div role="grid" aria-label={`Calendário de ${mesPorExtenso(foco)}`} className="flex flex-col">
        {gradeDoMes(foco).map((semana) => (
          <div role="row" key={semana[0]} className="grid grid-cols-7">
            {semana.map((d) => {
              const marcas = porDia.get(d) ?? [];
              const sel = d === dia;
              const fora = d.slice(0, 7) !== mes;
              return (
                <div role="gridcell" key={d} aria-selected={sel}>
                  <button type="button" onClick={() => aoEscolher(d)}
                    aria-label={`${diaPorExtenso(d)}${marcas.length ? `, ${contar(marcas.length, 'item', 'itens')}` : ''}${d === hoje ? ', hoje' : ''}`}
                    className={cn('flex h-12 w-full flex-col items-center justify-start gap-1 rounded-[12px] pt-1.5 text-[17px] transition-colors focus-visible:ring-4 focus-visible:ring-ring/35',
                      sel ? 'bg-primary text-primary-foreground' : 'hover:bg-muted', fora && !sel && 'text-muted-foreground',
                      d === hoje && !sel && 'text-tint font-semibold')}>
                    <span className="leading-none tabular-nums">{Number(d.slice(8))}</span>
                    <span className="flex h-1.5 gap-0.5" aria-hidden="true">
                      {marcas.slice(0, 3).map((m, i) => {
                        const cor = m.startsWith('prazo:') ? 'cinza' : (tipoDe(tipos.data, m)?.cor ?? 'azul');
                        return <span key={i} className={cn('size-1.5 rounded-full', sel ? 'bg-primary-foreground' : FUNDO_COR[cor as CorEvento])} />;
                      })}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function ListaDeDias({ dias, dados, hoje, aoAbrir, ini, fim, ocultarVazios }: {
  dias: string[] | null; dados: AgendaPeriodo; hoje: string; aoAbrir: (e: Evento) => void; ini: string; fim: string; ocultarVazios: boolean;
}) {
  const tipos = useTiposEvento();
  const membros = useMembros();
  const lista = dias ?? Array.from({ length: 60 }, (_, i) => somarDias(ini, i)).filter((d) => d <= fim);
  const blocos = lista.map((d) => ({
    d,
    eventos: dados.eventos.filter((e) => diasDoEvento(e).includes(d)),
    prazos: dados.prazos.filter((p) => p.data === d),
  })).filter((b) => !ocultarVazios || b.eventos.length + b.prazos.length > 0);
  if (blocos.length === 0) return <Vazio icone={CalendarDays} titulo="Nada marcado" descricao="Nenhum evento ou prazo nos próximos 60 dias." />;
  return (
    <>
      {blocos.map(({ d, eventos, prazos }) => (
        <Grupo key={d} titulo={`${d === hoje ? 'Hoje · ' : ''}${diaPorExtenso(d)}`}>
          {eventos.length + prazos.length === 0 && <Linha titulo="Nada marcado" />}
          {eventos.map((e) => {
            const t = tipoDe(tipos.data, e.tipo_id);
            return (
              <Linha key={e.id} icone={ICONE_EVENTO[t?.icone ?? 'outro']} cor={t?.cor ?? 'azul'} aoTocar={() => aoAbrir(e)} seta
                titulo={<span className={cn(e.cancelado_em && 'line-through opacity-70')}>{e.titulo}</span>}
                descricao={[e.cancelado_em ? 'Cancelado' : quando(e), e.local].filter(Boolean).join(' · ')} />
            );
          })}
          {prazos.map((p, i) => {
            const c = ICONE_PRAZO[p.tipo];
            const para = p.tipo === 'tarefa' ? `/tarefas/${p.ref}` : p.tipo === 'fechamento' ? '/dinheiro/fechamento'
              : p.tipo === 'verba' ? `/verbas/${p.ref}` : p.tipo === 'projeto' ? `/projetos/${p.ref}`
              : p.tipo === 'documento' ? `/pessoas/${p.ref}` : p.tipo === 'governanca' ? '/documentos/governanca' : p.tipo === 'reuniao' ? `/documentos/reunioes/${p.ref}`
              : p.tipo === 'filiacao' ? `/filiacoes/${p.ref}` : p.tipo === 'viagem' ? `/viagens/${p.ref}`
              : p.tipo === 'contrapartida' ? '/captacao?aba=contrapartidas' : p.tipo === 'captacao' ? '/captacao' : p.tipo === 'patrimonio' ? `/patrimonio/${p.ref}`
              : p.ref ? `/dinheiro/lancamento/${p.ref}` : undefined;
            return <Linha key={`p${i}`} icone={c.icone} cor={c.cor} titulo={p.titulo} para={para}
              descricao={p.tipo === 'tarefa' ? `${c.rotulo} · ${nomeDe(membros.data, p.responsavel)}` : c.rotulo} />;
          })}
        </Grupo>
      ))}
    </>
  );
}

function DetalheEvento({ evento: e, aoFechar, aoEditar }: { evento: Evento; aoFechar: () => void; aoEditar: () => void }) {
  const perfil = usePerfil();
  const tipos = useTiposEvento();
  const membros = useMembros();
  const modelos = useModelos();
  const navegar = useNavigate();
  const cancelar = useAcaoOrg('cancelar_evento');
  const aplicar = useAcaoOrg<Record<string, unknown>, { criadas: number }>('aplicar_modelo');
  const [motivo, setMotivo] = useState('');
  const [pedindoMotivo, setPedindoMotivo] = useState(false);
  const [modelo, setModelo] = useState('');
  const t = tipoDe(tipos.data, e.tipo_id);
  const podeMexer = !e.cancelado_em && (pode(perfil, 'agenda', 'editar') || (e.criado_por === perfil.membro.id && pode(perfil, 'agenda', 'criar')));
  const ativos = (modelos.data ?? []).filter((m) => m.ativo);
  async function confirmarCancelamento() {
    try { await cancelar.mutateAsync({ p_id: e.id, p_motivo: motivo.trim() }); toast.success('Evento cancelado'); aoFechar(); }
    catch (x) { toast.error(erroMsg(x)); }
  }
  async function aplicarModelo() {
    try {
      const r = await aplicar.mutateAsync({ p_modelo: modelo, p_evento: e.id, p_responsaveis: {} });
      toast.success(r.criadas ? `${contar(r.criadas, 'tarefa criada', 'tarefas criadas')}. Distribua os responsáveis em Tarefas.` : 'As tarefas desse modelo já existiam para este evento.');
    } catch (x) { toast.error(erroMsg(x)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo={e.titulo} descricao={t?.nome}
      rodape={podeMexer ? (
        <div className="flex w-full flex-col gap-2">
          <Button size="lg" onClick={aoEditar}><Pencil data-icon="inline-start" aria-hidden="true" />Editar evento</Button>
          {pedindoMotivo ? (
            <Button size="lg" variant="destructive" disabled={motivo.trim().length < 3 || cancelar.isPending} onClick={() => void confirmarCancelamento()}>
              {cancelar.isPending && <Spinner data-icon="inline-start" />}Confirmar cancelamento
            </Button>
          ) : <Button size="lg" variant="ghost" className="text-destructive" onClick={() => setPedindoMotivo(true)}><Ban data-icon="inline-start" aria-hidden="true" />Cancelar evento</Button>}
        </div>
      ) : undefined}>
      <div className="flex flex-col gap-5 pb-2">
        <Grupo>
          <Linha icone={CalendarDays} cor={t?.cor ?? 'azul'} titulo={diaPorExtenso(dataSP(e.inicio))} descricao={quando(e)} />
          {e.local && <Linha icone={MapPin} cor="vermelho" titulo={e.local} />}
          {e.participantes.length > 0 && <Linha icone={Users} cor="indigo" titulo={contar(e.participantes.length, 'participante', 'participantes')}
            descricao={e.participantes.map((p) => nomeDe(membros.data, p)).join(', ')} />}
        </Grupo>
        {e.cancelado_em && <Badge variant="destructive" className="self-start">Cancelado: {e.motivo_cancelamento}</Badge>}
        {!e.cancelado_em && pode(perfil, 'pessoas', 'ver') && <PresencaAtletas evento={e} podeMarcar={podeMexer} />}
        {e.descricao && <p className="text-[15px] whitespace-pre-wrap">{e.descricao}</p>}
        {pedindoMotivo && (
          <Field>
            <FieldLabel htmlFor="ev-motivo">Motivo do cancelamento</FieldLabel>
            <Input id="ev-motivo" name="ev-motivo" maxLength={300} autoComplete="off" value={motivo} onChange={(x) => setMotivo(x.target.value)} placeholder="Ex.: quadra interditada…" />
            <FieldDescription>O evento não é apagado: fica na agenda marcado como cancelado.</FieldDescription>
          </Field>
        )}
        {!e.cancelado_em && pode(perfil, 'tarefas', 'criar') && (
          <Grupo titulo="Tarefas deste evento">
            <Linha icone={ListChecks} cor="azul" titulo="Ver e criar tarefas" para={`/tarefas?evento=${e.id}`} />
            {ativos.length > 0 && (
              <div className="flex flex-col gap-3 p-4">
                <Field>
                  <FieldLabel htmlFor="ev-modelo">Aplicar um modelo de tarefas</FieldLabel>
                  <Select value={modelo} onValueChange={setModelo}>
                    <SelectTrigger id="ev-modelo"><SelectValue placeholder="Escolha o modelo" /></SelectTrigger>
                    <SelectContent><SelectGroup>{ativos.map((m) => <SelectItem key={m.id} value={m.id}>{m.nome} ({m.itens.length})</SelectItem>)}</SelectGroup></SelectContent>
                  </Select>
                  <FieldDescription>Cria uma tarefa por item, com prazo contado a partir da data do evento. Aplicar de novo não duplica.</FieldDescription>
                </Field>
                <Button variant="secondary" disabled={!modelo || aplicar.isPending} onClick={() => void aplicarModelo()}>
                  {aplicar.isPending && <Spinner data-icon="inline-start" />}Criar as tarefas
                </Button>
              </div>
            )}
            {ativos.length === 0 && <Linha icone={Settings2} cor="cinza" titulo="Modelos de tarefas" descricao="Ex.: “Viagem para competição” cria as 10 tarefas da viagem." aoTocar={() => navegar('/tarefas/rotinas')} />}
          </Grupo>
        )}
      </div>
    </Folha>
  );
}

function FormEvento({ evento, diaInicial, aoFechar }: { evento: Evento | null; diaInicial: string; aoFechar: () => void }) {
  const tipos = useTiposEvento();
  const membros = useMembros();
  const salvar = useAcaoOrg('salvar_evento');
  const ativos = (tipos.data ?? []).filter((t) => t.ativo || t.id === evento?.tipo_id);
  const [id] = useState(() => evento?.id ?? crypto.randomUUID());
  const [tipoId, setTipoId] = useState(evento?.tipo_id ?? '');
  const [titulo, setTitulo] = useState(evento?.titulo ?? '');
  const [diaInteiro, setDiaInteiro] = useState(evento?.dia_inteiro ?? false);
  const [dIni, setDIni] = useState(evento ? dataSP(evento.inicio) : diaInicial);
  const [hIni, setHIni] = useState(evento && !evento.dia_inteiro ? horaSP(evento.inicio) : '19:30');
  const [dFim, setDFim] = useState(evento ? diasDoEvento(evento).at(-1)! : diaInicial);
  const [hFim, setHFim] = useState(evento && !evento.dia_inteiro ? horaSP(evento.fim) : '21:00');
  const [local, setLocal] = useState(evento?.local ?? '');
  const [descricao, setDescricao] = useState(evento?.descricao ?? '');
  const [participantes, setParticipantes] = useState<string[]>(evento?.participantes ?? []);
  const [erro, setErro] = useState<string | null>(null);
  const fimAntes = dFim < dIni || (!diaInteiro && dFim === dIni && hFim < hIni);
  async function enviar() {
    setErro(null);
    if (fimAntes) return setErro('O fim precisa ser depois do início.');
    try {
      await salvar.mutateAsync({ p: {
        id, tipo_id: tipoId, titulo: titulo.trim(), dia_inteiro: diaInteiro,
        inicio: diaInteiro ? dIni : instanteSP(dIni, hIni), fim: diaInteiro ? dFim : instanteSP(dFim, hFim),
        local: local.trim() || null, descricao: descricao.trim() || null, participantes,
      } });
      toast.success(evento ? 'Evento atualizado' : 'Evento criado');
      aoFechar();
    } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo={evento ? 'Editar evento' : 'Novo evento'} larga
      rodape={<Button size="lg" className="w-full" disabled={!tipoId || titulo.trim().length < 2 || salvar.isPending} onClick={() => void enviar()}>
        {salvar.isPending && <Spinner data-icon="inline-start" />}{evento ? 'Salvar mudanças' : 'Criar evento'}</Button>}>
      <FieldGroup className="pb-2">
        <Field>
          <FieldLabel htmlFor="ev-tipo">Tipo</FieldLabel>
          <Select value={tipoId} onValueChange={setTipoId}>
            <SelectTrigger id="ev-tipo"><SelectValue placeholder={ativos.length ? 'Escolha o tipo' : 'Crie os tipos em “Tipos de evento”'} /></SelectTrigger>
            <SelectContent><SelectGroup>{ativos.map((t) => {
              const I = ICONE_EVENTO[t.icone];
              return <SelectItem key={t.id} value={t.id}><I aria-hidden="true" />{t.nome}</SelectItem>;
            })}</SelectGroup></SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="ev-titulo">Título</FieldLabel>
          <Input id="ev-titulo" name="ev-titulo" maxLength={120} autoComplete="off" placeholder="Ex.: Treino de quinta…" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        </Field>
        <Field orientation="horizontal">
          <Switch id="ev-dia" checked={diaInteiro} onCheckedChange={setDiaInteiro} />
          <FieldLabel htmlFor="ev-dia">Dia inteiro</FieldLabel>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field><FieldLabel htmlFor="ev-dini">Começa em</FieldLabel><Input id="ev-dini" name="ev-dini" type="date" value={dIni} onChange={(e) => { setDIni(e.target.value); if (dFim < e.target.value) setDFim(e.target.value); }} /></Field>
          {!diaInteiro && <Field><FieldLabel htmlFor="ev-hini">Às</FieldLabel><Input id="ev-hini" name="ev-hini" type="time" value={hIni} onChange={(e) => setHIni(e.target.value)} /></Field>}
          <Field><FieldLabel htmlFor="ev-dfim">Termina em</FieldLabel><Input id="ev-dfim" name="ev-dfim" type="date" value={dFim} min={dIni} onChange={(e) => setDFim(e.target.value)} /></Field>
          {!diaInteiro && <Field><FieldLabel htmlFor="ev-hfim">Às</FieldLabel><Input id="ev-hfim" name="ev-hfim" type="time" value={hFim} onChange={(e) => setHFim(e.target.value)} /></Field>}
        </div>
        <Field>
          <FieldLabel htmlFor="ev-local">Local (opcional)</FieldLabel>
          <Input id="ev-local" name="ev-local" maxLength={160} autoComplete="off" placeholder="Ex.: Ginásio, quadra 2…" value={local} onChange={(e) => setLocal(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="ev-desc">Observações (opcional)</FieldLabel>
          <Textarea id="ev-desc" name="ev-desc" maxLength={2000} rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </Field>
        <FieldSet>
          <FieldLegend variant="label">Quem participa (opcional)</FieldLegend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(membros.data ?? []).filter((m) => m.ativo).map((m) => (
              <Field key={m.id} orientation="horizontal">
                <Checkbox id={`ev-p-${m.id}`} checked={participantes.includes(m.id)}
                  onCheckedChange={(v) => setParticipantes((ps) => (v ? [...ps, m.id] : ps.filter((x) => x !== m.id)))} />
                <FieldLabel htmlFor={`ev-p-${m.id}`} className="font-normal">{m.nome}</FieldLabel>
              </Field>
            ))}
          </div>
        </FieldSet>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

const CORES: CorEvento[] = ['azul', 'verde', 'laranja', 'vermelho', 'roxo', 'teal', 'indigo', 'cinza'];
const ICONES: IconeEvento[] = ['treino', 'jogo', 'trofeu', 'viagem', 'reuniao', 'assembleia', 'captacao', 'prazo', 'projeto', 'outro'];

function TiposDeEvento({ aoFechar }: { aoFechar: () => void }) {
  const perfil = usePerfil();
  const tipos = useTiposEvento();
  const salvar = useAcaoOrg('salvar_tipo_evento');
  const importar = useAcaoOrg<Record<string, never>, { criados: number }>('importar_tipos_evento');
  const [nome, setNome] = useState('');
  const [cor, setCor] = useState<CorEvento>('azul');
  const [icone, setIcone] = useState<IconeEvento>('outro');
  const [erro, setErro] = useState<string | null>(null);
  const podeEditar = pode(perfil, 'agenda', 'editar');
  async function criar() {
    setErro(null);
    try { await salvar.mutateAsync({ p: { id: crypto.randomUUID(), nome: nome.trim(), cor, icone } }); setNome(''); toast.success('Tipo criado'); }
    catch (e) { setErro(erroMsg(e)); }
  }
  async function usarLista() {
    try { const r = await importar.mutateAsync({}); toast.success(r.criados ? `${contar(r.criados, 'tipo adicionado', 'tipos adicionados')}` : 'Os tipos da lista já existiam'); }
    catch (e) { toast.error(erroMsg(e)); }
  }
  async function alternar(id: string, ativo: boolean) {
    const t = tipos.data?.find((x) => x.id === id);
    if (!t) return;
    try { await salvar.mutateAsync({ p: { id, nome: t.nome, cor: t.cor, icone: t.icone, ativo } }); }
    catch (e) { toast.error(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo="Tipos de evento" descricao="Cada tipo tem cor e ícone próprios na agenda.">
      <div className="flex flex-col gap-5 pb-2">
        <Grupo>
          {(tipos.data ?? []).length === 0 && <Linha titulo="Nenhum tipo ainda" />}
          {(tipos.data ?? []).map((t) => (
            <Linha key={t.id} icone={ICONE_EVENTO[t.icone]} cor={t.cor} titulo={t.nome} descricao={t.ativo ? undefined : 'Desativado'}
              valor={podeEditar ? <Switch aria-label={`${t.nome} ativo`} checked={t.ativo} onCheckedChange={(v) => void alternar(t.id, v)} /> : undefined} />
          ))}
        </Grupo>
        {podeEditar ? (
          <>
            <Button variant="secondary" disabled={importar.isPending} onClick={() => void usarLista()}>
              {importar.isPending && <Spinner data-icon="inline-start" />}Usar a lista do dossiê (treino, jogo, viagem…)
            </Button>
            <FieldSet>
              <FieldLegend variant="label">Novo tipo</FieldLegend>
              <FieldGroup>
                <Field><FieldLabel htmlFor="te-nome">Nome</FieldLabel><Input id="te-nome" name="te-nome" maxLength={60} autoComplete="off" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Classificação funcional…" /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field>
                    <FieldLabel htmlFor="te-cor">Cor</FieldLabel>
                    <Select value={cor} onValueChange={(v) => setCor(v as CorEvento)}>
                      <SelectTrigger id="te-cor"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectGroup>{CORES.map((c) => <SelectItem key={c} value={c}><span aria-hidden="true" className={cn('size-3 rounded-full', FUNDO_COR[c])} />{NOME_COR[c]}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="te-icone">Ícone</FieldLabel>
                    <Select value={icone} onValueChange={(v) => setIcone(v as IconeEvento)}>
                      <SelectTrigger id="te-icone"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectGroup>{ICONES.map((i) => { const I = ICONE_EVENTO[i]; return <SelectItem key={i} value={i}><I aria-hidden="true" />{NOME_ICONE[i]}</SelectItem>; })}</SelectGroup></SelectContent>
                    </Select>
                  </Field>
                </div>
                <div className="flex items-center gap-3"><IconeQuadrado icone={ICONE_EVENTO[icone]} cor={cor} /><span className="text-[15px]">{nome || 'Prévia'}</span></div>
                {erro && <FieldError role="alert">{erro}</FieldError>}
                <Button disabled={nome.trim().length < 2 || salvar.isPending} onClick={() => void criar()}>{salvar.isPending && <Spinner data-icon="inline-start" />}Criar tipo</Button>
              </FieldGroup>
            </FieldSet>
          </>
        ) : <p className="text-muted-foreground text-[15px]">Para criar ou mudar tipos, peça a quem tem a permissão de editar a agenda. <Link className="text-tint underline" to="/organizacao">Voltar</Link></p>}
      </div>
    </Folha>
  );
}
