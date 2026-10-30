// A aba e a busca ficam no endereço (?aba=, ?busca=) para voltar e compartilhar.
import { ArrowDownLeft, ArrowUpRight, CalendarCheck, FileUp, FileWarning, GitCompareArrows, Globe, HandCoins, Landmark, LineChart, ListFilter, Target, PieChart, Search, Tags, X } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { BlocoErro, CarregandoLista, Vazio } from '@/components/app/estados';
import { Folha } from '@/components/app/folha';
import { Grupo, Linha } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { RolagemHorizontal } from '@/components/app/rolagem';
import { Segmentado } from '@/components/app/segmentado';
import { Valor } from '@/components/app/valor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { usePerfil } from '@/app/sessao';
import { useAcao, useContas, useLancamentos, useReembolsos } from '@/dados/consultas';
import type { Lancamento, Reembolso } from '@/dados/tipos';
import { alcance, pode } from '@/lib/acesso';
import { formatarData, hojeSP } from '@/lib/datas';
import { ErroApp } from '@/lib/erros';

type Aba = 'lancamentos' | 'prever' | 'reembolsos';
const FMT_DIA = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

function tituloDia(iso: string, hoje: string) {
  if (iso === hoje) return 'Hoje';
  const ontem = new Date(`${hoje}T12:00:00Z`); ontem.setUTCDate(ontem.getUTCDate() - 1);
  if (iso === ontem.toISOString().slice(0, 10)) return 'Ontem';
  const t = FMT_DIA.format(new Date(`${iso}T12:00:00Z`));
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function LinhaLancamento({ l }: { l: Lancamento }) {
  const pendente = l.tipo === 'saida' && l.situacao === 'realizada' && !l.estorno_de && !l.comprovantes && !l.sem_comprovante_motivo && !l.estornado;
  const detalhes = [l.categoria, l.conta, l.situacao === 'prevista' ? `vence ${formatarData(l.data)}` : null].filter(Boolean).join(' · ');
  return (
    <Linha
      icone={l.tipo === 'entrada' ? ArrowDownLeft : ArrowUpRight}
      cor={l.situacao === 'cancelada' || l.estornado ? 'cinza' : l.tipo === 'entrada' ? 'verde' : 'azul'}
      titulo={<>{l.descricao}{l.estornado && <span className="text-muted-foreground"> (estornado)</span>}</>}
      descricao={<span className="flex flex-col items-start gap-1"><span>{detalhes || 'Sem categoria'}</span>{pendente && <Badge variant="destructive"><FileWarning data-icon="inline-start" aria-hidden="true" />Sem comprovante</Badge>}</span>}
      valor={<Valor valor={l.valor} tipo={l.tipo} className={l.situacao === 'cancelada' || l.estornado ? 'text-muted-foreground line-through' : 'text-foreground text-[15px] font-medium'} />}
      valorNoTitulo
      para={`/dinheiro/lancamento/${l.id}`}
    />
  );
}

function Lancamentos({ busca, semComprovante }: { busca: string; semComprovante: boolean }) {
  const consulta = useLancamentos({ situacao: 'realizada', busca: busca || undefined });
  const hoje = hojeSP();
  const lista = useMemo(() => {
    const todos = consulta.data?.pages.flat() ?? [];
    return semComprovante ? todos.filter((l) => l.tipo === 'saida' && !l.estorno_de && !l.comprovantes && !l.sem_comprovante_motivo && !l.estornado) : todos;
  }, [consulta.data, semComprovante]);
  const porDia = useMemo(() => {
    const m = new Map<string, Lancamento[]>();
    for (const l of lista) m.set(l.data, [...(m.get(l.data) ?? []), l]);
    return [...m.entries()];
  }, [lista]);
  if (consulta.isPending) return <CarregandoLista linhas={6} />;
  if (consulta.isError) return <BlocoErro erro={consulta.error} tentarDeNovo={() => void consulta.refetch()} />;
  if (lista.length === 0) {
    return <Vazio icone={busca ? Search : ListFilter} titulo={busca ? 'Nada encontrado' : semComprovante ? 'Tudo com comprovante' : 'Nenhum lançamento ainda'}
      descricao={busca ? `Nenhum lançamento com “${busca}”. Tente outra palavra.` : semComprovante ? 'Todas as saídas têm comprovante ou justificativa.' : 'Use o botão + para registrar a primeira entrada ou saída.'} />;
  }
  return (
    <>
      {porDia.map(([dia, ls]) => <Grupo key={dia} titulo={tituloDia(dia, hoje)}>{ls.map((l) => <LinhaLancamento key={l.id} l={l} />)}</Grupo>)}
      {consulta.hasNextPage && (
        <Button variant="secondary" disabled={consulta.isFetchingNextPage} onClick={() => void consulta.fetchNextPage()}>
          {consulta.isFetchingNextPage && <Spinner data-icon="inline-start" />}Carregar mais
        </Button>
      )}
    </>
  );
}

function Previstos() {
  const consulta = useLancamentos({ situacao: 'prevista' });
  const hoje = hojeSP();
  const lista = useMemo(() => (consulta.data?.pages.flat() ?? []).sort((a, b) => a.data.localeCompare(b.data)), [consulta.data]);
  if (consulta.isPending) return <CarregandoLista />;
  if (consulta.isError) return <BlocoErro erro={consulta.error} tentarDeNovo={() => void consulta.refetch()} />;
  const vencidos = lista.filter((l) => l.data < hoje);
  const proximos = lista.filter((l) => l.data >= hoje);
  if (lista.length === 0) return <Vazio icone={CalendarCheck} titulo="Nada a pagar ou receber" descricao="Contas a pagar e a receber aparecem aqui. Registre desligando “Já foi pago” no novo lançamento." />;
  return (
    <>
      {vencidos.length > 0 && <Grupo titulo="Vencidos">{vencidos.map((l) => <LinhaLancamento key={l.id} l={l} />)}</Grupo>}
      {proximos.length > 0 && <Grupo titulo="A vencer">{proximos.map((l) => <LinhaLancamento key={l.id} l={l} />)}</Grupo>}
    </>
  );
}

function Reembolsos() {
  const perfil = usePerfil();
  const consulta = useReembolsos();
  const [decidindo, setDecidindo] = useState<Reembolso | null>(null);
  if (consulta.isPending) return <CarregandoLista />;
  if (consulta.isError) return <BlocoErro erro={consulta.error} tentarDeNovo={() => void consulta.refetch()} />;
  const abertos = consulta.data.filter((r) => r.situacao === 'solicitado');
  const decididos = consulta.data.filter((r) => r.situacao !== 'solicitado').slice(0, 20);
  const podeDecidir = pode(perfil, 'financeiro', 'aprovar');
  return (
    <>
      {consulta.data.length === 0 && <Vazio icone={HandCoins} titulo="Nenhum pedido de reembolso" descricao="Quem pagar do próprio bolso marca “Paguei do meu bolso” ao lançar." />}
      {abertos.length > 0 && (
        <Grupo titulo="Aguardando decisão" rodape={podeDecidir ? 'Ninguém decide o próprio reembolso: outra pessoa da diretoria precisa aprovar.' : undefined}>
          {abertos.map((r) => (
            <Linha key={r.lancamento_id} icone={HandCoins} cor="roxo" titulo={r.lancamento?.descricao ?? 'Reembolso'}
              descricao={`${r.nome_solicitante ?? '—'} · gasto em ${formatarData(r.lancamento?.data_documento ?? r.lancamento?.data)}`}
              valor={<span className="flex items-center gap-2"><Valor valor={r.lancamento?.valor} className="text-foreground text-[15px] font-medium" />
                {podeDecidir && r.solicitante !== perfil.membro.id && <Button size="sm" variant="secondary" onClick={() => setDecidindo(r)}>Decidir</Button>}</span>} />
          ))}
        </Grupo>
      )}
      {decididos.length > 0 && (
        <Grupo titulo="Decididos">
          {decididos.map((r) => (
            <Linha key={r.lancamento_id} titulo={r.lancamento?.descricao ?? 'Reembolso'} descricao={`${r.nome_solicitante ?? '—'} · ${r.situacao === 'pago' ? 'pago' : `negado${r.motivo ? `: ${r.motivo}` : ''}`}`}
              valor={<Valor valor={r.lancamento?.valor} className="text-muted-foreground text-[15px]" />} para={`/dinheiro/lancamento/${r.lancamento_id}`} />
          ))}
        </Grupo>
      )}
      {decidindo && <DecidirReembolso r={decidindo} aoFechar={() => setDecidindo(null)} />}
    </>
  );
}

function DecidirReembolso({ r, aoFechar }: { r: Reembolso; aoFechar: () => void }) {
  const contas = useContas();
  const acao = useAcao('decidir_reembolso');
  const [conta, setConta] = useState('');
  const [motivo, setMotivo] = useState('');
  async function decidir(aprovar: boolean) {
    try {
      await acao.mutateAsync({ p_id: r.lancamento_id, p_aprovar: aprovar, p_conta_id: aprovar ? conta : null, p_motivo: aprovar ? null : motivo.trim() });
      toast.success(aprovar ? 'Reembolso pago' : 'Reembolso negado');
      aoFechar();
    } catch (e) { toast.error(e instanceof ErroApp ? e.message : 'Não foi possível decidir agora.'); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo="Decidir reembolso" descricao={`${r.nome_solicitante ?? ''} — ${r.lancamento?.descricao ?? ''}`}>
      <FieldGroup className="pb-4">
        <Field>
          <FieldLabel htmlFor="conta-reemb">Pagar pela conta</FieldLabel>
          <Select value={conta} onValueChange={setConta}>
            <SelectTrigger id="conta-reemb"><SelectValue placeholder="Escolha a conta" /></SelectTrigger>
            <SelectContent><SelectGroup>{(contas.data ?? []).filter((c) => c.ativa).map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        </Field>
        <Button size="lg" disabled={!conta || acao.isPending} onClick={() => void decidir(true)}>{acao.isPending && <Spinner data-icon="inline-start" />}Aprovar e registrar pagamento</Button>
        <Field>
          <FieldLabel htmlFor="motivo-reemb">Motivo, se for negar</FieldLabel>
          <Textarea id="motivo-reemb" name="motivo" maxLength={300} placeholder="Ex.: sem nota fiscal do gasto…" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </Field>
        <Button variant="destructive" disabled={motivo.trim().length < 3 || acao.isPending} onClick={() => void decidir(false)}>Negar reembolso</Button>
      </FieldGroup>
    </Folha>
  );
}

export function Dinheiro() {
  const perfil = usePerfil();
  const [params, setParams] = useSearchParams();
  const aba = (['lancamentos', 'prever', 'reembolsos'].includes(params.get('aba') ?? '') ? params.get('aba') : 'lancamentos') as Aba;
  const busca = params.get('busca') ?? '';
  const [texto, setTexto] = useState(busca);
  const buscaAdiada = useDeferredValue(busca);
  const semComprovante = params.get('situacao') === 'sem_comprovante';
  const mudar = (k: string, v: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  const admFin = pode(perfil, 'financeiro', 'administrar');
  const verTudo = pode(perfil, 'financeiro', 'ver') && alcance(perfil, 'financeiro', 'ver') === 'tudo';
  return (
    <Pagina
      titulo="Dinheiro"
      sob={
        <div className="flex flex-col gap-3">
          <RolagemHorizontal rotulo="Atalhos do financeiro">
            {[
              verTudo && { para: '/dinheiro/conciliacao', icone: GitCompareArrows, nome: 'Conciliação e extrato' },
              verTudo && { para: '/dinheiro/orcamento', icone: Target, nome: 'Orçamento do ano' },
              verTudo && { para: '/analises', icone: LineChart, nome: 'Previsão e análises' },
              verTudo && { para: '/dinheiro/importar', icone: FileUp, nome: 'Importar e contador' },
              verTudo && { para: '/transparencia/gestao', icone: Globe, nome: 'Transparência' },
              { para: '/dinheiro/fechamento', icone: CalendarCheck, nome: 'Fechamento do mês' },
              { para: '/dinheiro/contas', icone: Landmark, nome: 'Contas' },
              pode(perfil, 'financeiro', 'exportar') && { para: '/relatorios', icone: PieChart, nome: 'Relatórios' },
              admFin && { para: '/dinheiro/cadastros', icone: Tags, nome: 'Categorias' },
            ].filter((x) => !!x).map((x) => (
              <Button key={x.para} asChild variant="secondary" size="sm" className="shrink-0">
                <Link to={x.para}><x.icone data-icon="inline-start" aria-hidden="true" />{x.nome}</Link>
              </Button>
            ))}
          </RolagemHorizontal>
          <Segmentado rotulo="O que mostrar" valor={aba} aoMudar={(v) => mudar('aba', v === 'lancamentos' ? null : v)}
            opcoes={[{ valor: 'lancamentos', rotulo: 'Lançamentos' }, { valor: 'prever', rotulo: 'A pagar e receber' }, { valor: 'reembolsos', rotulo: 'Reembolsos' }]} />
          {aba === 'lancamentos' && (
            <form role="search" onSubmit={(e) => { e.preventDefault(); mudar('busca', texto.trim() || null); }}>
              <InputGroup>
                <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
                <InputGroupInput type="search" name="busca" aria-label="Buscar lançamentos" placeholder="Buscar pela descrição…" autoComplete="off"
                  enterKeyHint="search" value={texto} onChange={(e) => { setTexto(e.target.value); if (!e.target.value) mudar('busca', null); }} />
                {(texto || semComprovante) && (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton aria-label="Limpar busca e filtros" onClick={() => { setTexto(''); setParams({}, { replace: true }); }}><X aria-hidden="true" /></InputGroupButton>
                  </InputGroupAddon>
                )}
              </InputGroup>
              {semComprovante && <p className="text-muted-foreground mt-2 px-1 text-[13px]">Mostrando só saídas sem comprovante.</p>}
            </form>
          )}
        </div>
      }
    >
      {aba === 'lancamentos' && <Lancamentos busca={buscaAdiada} semComprovante={semComprovante} />}
      {aba === 'prever' && <Previstos />}
      {aba === 'reembolsos' && <Reembolsos />}
    </Pagina>
  );
}
