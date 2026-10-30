// Acessibilidade é da viagem, sem condição de saúde por pessoa.
import { Accessibility, Bus, CheckCircle2, Link2, Plane, Plus, Unlink, Users, Wallet } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { BlocoErro, CarregandoLista, Vazio } from '@/components/app/estados';
import { Folha } from '@/components/app/folha';
import { FormularioRpc, type Campo } from '@/components/app/formulario';
import { Grupo, Linha } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { Valor } from '@/components/app/valor';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldDescription, FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { usePerfil } from '@/app/sessao';
import { useAcaoF5, useLancamentos, useLista, usePessoas, useRpc, useVerbas } from '@/dados/consultas';
import { fonte } from '@/dados/fonte';
import type { LancamentoViagem, MembroDelegacao, NumerosViagem, Viagem } from '@/dados/tipos';
import { pode } from '@/lib/acesso';
import { formatarData, hojeSP, somarDias } from '@/lib/datas';
import { formatarBRL } from '@/lib/dinheiro';
import { contar } from '@/lib/texto';
import { erroMsg } from '@/telas/organizacao/comum';

const NOME_SITUACAO = { planejada: 'Planejada', em_andamento: 'Em andamento', encerrada: 'Encerrada (acerto feito)', cancelada: 'Cancelada' } as const;
const NOME_PAPEL = { adiantamento: 'Adiantamento', despesa: 'Despesa', devolucao: 'Devolução do que sobrou' } as const;

const camposViagem = (verbas: { valor: string; rotulo: string }[]): Campo[] => [
  { nome: 'titulo', rotulo: 'Viagem', tipo: 'texto', obrigatorio: true, placeholder: 'Ex.: Campeonato Brasileiro' },
  { nome: 'destino', rotulo: 'Destino', tipo: 'texto', obrigatorio: true, max: 120 },
  { nome: 'saida', rotulo: 'Saída', tipo: 'data', obrigatorio: true, meia: true },
  { nome: 'retorno', rotulo: 'Retorno', tipo: 'data', obrigatorio: true, meia: true },
  { nome: 'orcamento', rotulo: 'Orçamento (R$)', tipo: 'valor', meia: true },
  { nome: 'distancia_km', rotulo: 'Distância ida e volta (km)', tipo: 'numero', meia: true },
  { nome: 'situacao', rotulo: 'Situação', tipo: 'escolha', obrigatorio: true, opcoes: [{ valor: 'planejada', rotulo: 'Planejada' }, { valor: 'em_andamento', rotulo: 'Em andamento' }, { valor: 'cancelada', rotulo: 'Cancelada' }] },
  { nome: 'transporte_acessivel', rotulo: 'Transporte acessível confirmado', tipo: 'sim_nao' },
  { nome: 'quartos_adaptados', rotulo: 'Quartos adaptados', tipo: 'numero', meia: true },
  { nome: 'verba_id', rotulo: 'Verba que cobre a viagem', tipo: 'escolha', opcoes: verbas, nenhum: 'Nenhuma', meia: true },
  { nome: 'responsavel', rotulo: 'Quem coordena', tipo: 'membro' },
  { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea', max: 1000, ajuda: 'Logística e acessibilidade da viagem. Não escreva a condição de saúde de ninguém.' },
];

export function Viagens() {
  const perfil = usePerfil();
  const viagens = useLista<Viagem>('viagens', { ordem: 'saida', desc: true });
  const numeros = useRpc<{ viagens: NumerosViagem[] }>('painel_viagens');
  const verbas = useVerbas();
  const navegar = useNavigate();
  const [nova, setNova] = useState(false);
  const abrirNova = () => setNova(true);
  const num = (id: string) => numeros.data?.viagens.find((x) => x.id === id);
  const opVerbas = (verbas.data ?? []).filter((v) => !['encerrado', 'negado', 'cancelado'].includes(v.situacao)).map((v) => ({ valor: v.id, rotulo: v.titulo }));
  const lista = viagens.data ?? [];
  const grupos: [string, Viagem[]][] = [
    ['Próximas e em andamento', lista.filter((v) => ['planejada', 'em_andamento'].includes(v.situacao))],
    ['Encerradas e canceladas', lista.filter((v) => ['encerrada', 'cancelada'].includes(v.situacao))],
  ];
  return (
    <Pagina titulo="Viagens" acoes={pode(perfil, 'viagens', 'criar') ? <Button size="icon" variant="ghost" aria-label="Nova viagem" onClick={abrirNova}><Plus aria-hidden="true" /></Button> : undefined}>
      {viagens.isError ? <BlocoErro erro={viagens.error} tentarDeNovo={() => void viagens.refetch()} />
        : viagens.isPending ? <CarregandoLista />
          : lista.length === 0 ? <Vazio icone={Plane} titulo="Nenhuma viagem" descricao="Planeje orçamento, delegação e quartos; durante a viagem, ligue os gastos; na volta, faça o acerto."
            acao={pode(perfil, 'viagens', 'criar') ? <Button onClick={abrirNova}><Plus data-icon="inline-start" aria-hidden="true" />Nova viagem</Button> : undefined} />
            : grupos.filter(([, l]) => l.length).map(([t, l]) => (
              <Grupo key={t} titulo={t}>
                {l.map((v) => {
                  const n = num(v.id);
                  return <Linha key={v.id} icone={Plane} cor={v.situacao === 'encerrada' ? 'verde' : v.situacao === 'cancelada' ? 'cinza' : Number(n?.saldo_acerto ?? 0) > 0 && v.retorno < hojeSP() ? 'vermelho' : 'teal'}
                    titulo={v.titulo} para={`/viagens/${v.id}`}
                    descricao={`${v.destino} · ${formatarData(v.saida)}${v.retorno !== v.saida ? ` a ${formatarData(v.retorno)}` : ''}${n?.atletas ? ` · ${contar(n.atletas, 'atleta', 'atletas')}` : ''}`}
                    valor={<Valor valor={n?.gasto ?? null} className="text-foreground text-[15px]" />} />;
                })}
              </Grupo>
            ))}
      {nova && <FormularioRpc titulo="Nova viagem" rpc="salvar_viagem" campos={camposViagem(opVerbas)} larga
        inicial={{ situacao: 'planejada', saida: somarDias(hojeSP(), 30), retorno: somarDias(hojeSP(), 32), responsavel: perfil.membro.id }}
        montar={(d, novo) => ({ p: { id: novo, ...d } })} aoSalvar={(r) => navegar(`/viagens/${String(r.id)}`)} sucesso="Viagem criada" aoFechar={() => setNova(false)} />}
    </Pagina>
  );
}

export function DetalheViagem() {
  const { id = '' } = useParams();
  const perfil = usePerfil();
  const viagens = useLista<Viagem>('viagens', { onde: { id } });
  const del = useLista<MembroDelegacao>('viagem_delegacao', { onde: { viagem_id: id }, ordem: 'nome' });
  const vls = useLista<LancamentoViagem>('viagem_lancamentos', { onde: { viagem_id: id } });
  const numeros = useRpc<{ viagens: NumerosViagem[] }>('painel_viagens');
  const verbas = useVerbas();
  const encerrar = useAcaoF5('encerrar_viagem');
  const vincular = useAcaoF5('vincular_lancamento_viagem');
  const v = viagens.data?.[0];
  const filtro = useMemo(() => ({ situacao: 'realizada' as const, inicio: v ? somarDias(v.saida, -30) : undefined, fim: v ? somarDias(v.retorno, 30) : undefined }), [v]);
  const lancs = useLancamentos(filtro);
  // lançamentos ligados com data fora da janela de busca: lidos um a um pelo id
  const idsFora = (vls.data ?? []).map((x) => x.lancamento_id).filter((i) => !(lancs.data?.pages.flat() ?? []).some((l) => l.id === i));
  const fora = useQuery({ queryKey: ['lancamentos-viagem', idsFora], enabled: idsFora.length > 0 && !lancs.isPending,
    queryFn: () => Promise.all(idsFora.map((i) => fonte().lancamento(i))) });
  const [folha, setFolha] = useState<null | 'editar' | 'delegacao' | 'vincular'>(null);
  const voltar = { para: '/viagens', rotulo: 'Viagens' };
  if (viagens.isPending) return <Pagina titulo="Viagem" voltar={voltar}><CarregandoLista /></Pagina>;
  if (!v) return <Pagina titulo="Viagem" voltar={voltar}><Vazio icone={Plane} titulo="Viagem não encontrada" descricao="Ela pode não estar visível para você." /></Pagina>;
  const n = numeros.data?.viagens.find((x) => x.id === v.id);
  const aberta = ['planejada', 'em_andamento'].includes(v.situacao);
  const mexer = aberta && (pode(perfil, 'viagens', 'editar') || (pode(perfil, 'viagens', 'criar') && [v.criado_por, v.responsavel ?? v.criado_por].includes(perfil.membro.id)));
  const todos = lancs.data?.pages.flat() ?? [];
  const ligados = (vls.data ?? []).map((x) => ({ ...x, l: todos.find((l) => l.id === x.lancamento_id) ?? fora.data?.find((l) => l?.id === x.lancamento_id) ?? undefined }));
  const saldo = Number(n?.saldo_acerto ?? 0);
  async function fazerEncerrar() {
    try { await encerrar.mutateAsync({ p_id: v!.id }); toast.success('Viagem encerrada com o acerto feito'); } catch (e) { toast.error(erroMsg(e)); }
  }
  return (
    <Pagina titulo={v.titulo} voltar={voltar} acoes={mexer ? <Button variant="ghost" size="sm" onClick={() => setFolha('editar')}>Editar</Button> : undefined}>
      <div className="grid grid-cols-3 gap-3 text-center">
        {[['Orçamento', formatarBRL(v.orcamento)], ['Gasto', formatarBRL(n?.gasto ?? null)], ['Por atleta', formatarBRL(n?.custo_por_atleta ?? null)]].map(([t, x]) => (
          <div key={t} className="bg-card rounded-[18px] p-3"><p className="numeros text-[15px] font-bold whitespace-nowrap sm:text-[17px]">{x}</p><p className="text-muted-foreground text-[13px]">{t}</p></div>
        ))}
      </div>
      <Grupo>
        <Linha icone={Plane} cor="teal" titulo={v.destino} descricao={`${formatarData(v.saida)} a ${formatarData(v.retorno)} · ${NOME_SITUACAO[v.situacao]}`} />
        <Linha icone={Bus} cor={v.transporte_acessivel ? 'verde' : 'laranja'} titulo={v.transporte_acessivel ? 'Transporte acessível confirmado' : 'Transporte acessível a confirmar'}
          descricao={v.distancia_km ? `${v.distancia_km} km ida e volta · ${formatarBRL(n?.custo_por_km ?? null)} por km` : undefined} />
        <Linha icone={Accessibility} cor="indigo" titulo={v.quartos_adaptados ? contar(v.quartos_adaptados, 'quarto adaptado', 'quartos adaptados') : 'Quartos adaptados não informados'} />
        {v.verba_id && <Linha icone={Wallet} cor="laranja" titulo="Verba" descricao={verbas.data?.find((x) => x.id === v.verba_id)?.titulo} para={`/verbas/${v.verba_id}`} />}
      </Grupo>
      {v.observacoes && <p className="bg-card rounded-[14px] p-4 text-[15px] whitespace-pre-wrap">{v.observacoes}</p>}

      <Grupo titulo={`Delegação (${(del.data ?? []).length})`} acao={mexer ? <Button variant="link" size="xs" onClick={() => setFolha('delegacao')}>Montar</Button> : undefined}>
        {(del.data ?? []).length === 0 && <Linha titulo="Ninguém na delegação ainda" />}
        {(del.data ?? []).map((m) => <Linha key={m.id} icone={Users} cor={m.funcao === 'atleta' ? 'azul' : 'cinza'} titulo={m.nome}
          descricao={[m.funcao === 'atleta' ? 'Atleta' : m.funcao === 'tecnico' ? 'Técnico' : m.funcao === 'staff' ? 'Equipe' : m.funcao === 'acompanhante' ? 'Acompanhante' : 'Outro', m.quarto && `quarto ${m.quarto}`].filter(Boolean).join(' · ')} />)}
      </Grupo>

      <Grupo titulo="Dinheiro da viagem" acao={mexer ? <Button variant="link" size="xs" onClick={() => setFolha('vincular')}>Ligar lançamento</Button> : undefined}
        rodape="Lance cada gasto no Dinheiro (com comprovante) e ligue aqui. Adiantamento que sobrou volta como devolução.">
        {ligados.length === 0 && <Linha titulo="Nenhum lançamento ligado" />}
        {ligados.map((x) => (
          <Linha key={x.lancamento_id} icone={Wallet} cor={x.papel === 'despesa' ? 'vermelho' : x.papel === 'adiantamento' ? 'laranja' : 'verde'} titulo={x.l?.descricao ?? 'Lançamento'}
            descricao={`${NOME_PAPEL[x.papel]}${x.l ? ` · ${formatarData(x.l.data)}` : ''}`}
            valor={<span className="flex items-center gap-1"><Valor valor={x.l?.valor ?? null} className="text-foreground text-[15px]" />
              {mexer && <Button size="icon-sm" variant="ghost" aria-label={`Desligar: ${x.l?.descricao ?? 'lançamento'}`} disabled={vincular.isPending}
                onClick={() => vincular.mutate({ p_viagem: v.id, p_lancamento: x.lancamento_id, p_papel: null }, { onError: (e) => toast.error(erroMsg(e)) })}><Unlink aria-hidden="true" /></Button>}</span>} />
        ))}
      </Grupo>

      <Grupo titulo="Acerto">
        <Linha titulo="Adiantado" valor={formatarBRL(n?.adiantado ?? null)} />
        <Linha titulo="Gasto" valor={formatarBRL(n?.gasto ?? null)} />
        <Linha titulo="Devolvido" valor={formatarBRL(n?.devolvido ?? null)} />
        <Linha icone={saldo > 0 ? Wallet : CheckCircle2} cor={saldo > 0 ? 'vermelho' : 'verde'} titulo={saldo > 0 ? `Falta devolver ${formatarBRL(String(saldo))}` : 'Acerto em dia'}
          descricao={saldo < 0 ? 'O gasto passou do adiantado: o restante foi pago direto pela Associação Exemplo.' : undefined} />
        {aberta && pode(perfil, 'viagens', 'editar') && v.retorno <= hojeSP() && (
          <Linha icone={CheckCircle2} cor="verde" titulo={encerrar.isPending ? 'Encerrando…' : 'Encerrar a viagem'} aoTocar={() => void fazerEncerrar()} desabilitada={encerrar.isPending || saldo > 0} />
        )}
      </Grupo>

      {folha === 'editar' && <FormularioRpc titulo="Editar viagem" rpc="salvar_viagem" larga inicial={v as unknown as Record<string, unknown>}
        campos={camposViagem((verbas.data ?? []).map((x) => ({ valor: x.id, rotulo: x.titulo })))}
        montar={(d) => ({ p: { id: v.id, evento_id: v.evento_id, projeto_id: v.projeto_id, ...d } })} aoFechar={() => setFolha(null)} />}
      {folha === 'delegacao' && <FolhaDelegacao viagem={v} atual={del.data ?? []} aoFechar={() => setFolha(null)} />}
      {folha === 'vincular' && <FolhaVincular viagem={v} lancamentos={todos.filter((l) => !(vls.data ?? []).some((x) => x.lancamento_id === l.id) && !l.estorno_de && !l.estornado)} aoFechar={() => setFolha(null)} />}
    </Pagina>
  );
}

function FolhaDelegacao({ viagem, atual, aoFechar }: { viagem: Viagem; atual: MembroDelegacao[]; aoFechar: () => void }) {
  const pessoas = usePessoas();
  const salvar = useAcaoF5<Record<string, unknown>, { pessoas: number }>('salvar_delegacao');
  const atletas = (pessoas.data ?? []).filter((p) => p.atleta && p.situacao === 'ativo');
  const [marcados, setMarcados] = useState<Record<string, string>>(() => Object.fromEntries(atual.filter((m) => m.pessoa_id).map((m) => [m.pessoa_id!, m.quarto ?? ''])));
  const [equipe, setEquipe] = useState(() => atual.filter((m) => !m.pessoa_id).map((m) => `${m.nome}${m.quarto ? ` | ${m.quarto}` : ''}`).join('\n'));
  const [erro, setErro] = useState<string | null>(null);
  async function enviar() {
    setErro(null);
    const ids = new Map(atual.map((m) => [m.pessoa_id ?? m.nome, m.id]));
    const lista = [
      ...atletas.filter((a) => a.id in marcados).map((a) => ({ id: ids.get(a.id) ?? crypto.randomUUID(), pessoa_id: a.id, nome: a.nome, funcao: 'atleta', quarto: marcados[a.id]?.trim() || null })),
      ...equipe.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter(([n]) => (n ?? '').length >= 2)
        .map(([nome, quarto]) => ({ id: ids.get(nome!) ?? crypto.randomUUID(), nome: nome!, funcao: 'staff', quarto: quarto || null })),
    ];
    try { const r = await salvar.mutateAsync({ p_viagem: viagem.id, p: lista }); toast.success(`${contar(r.pessoas, 'pessoa', 'pessoas')} na delegação`); aoFechar(); }
    catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(x) => !x && aoFechar()} titulo="Delegação" descricao="Marque os atletas e anote o quarto. Necessidades de acessibilidade ficam no total da viagem." larga
      rodape={<Button size="lg" className="w-full" disabled={salvar.isPending} onClick={() => void enviar()}>{salvar.isPending && <Spinner data-icon="inline-start" />}Salvar</Button>}>
      <div className="flex flex-col gap-4 pb-2">
        <ul className="bg-card flex flex-col rounded-[14px]">
          {atletas.length === 0 && <li className="text-muted-foreground px-4 py-3 text-[15px]">Nenhum atleta ativo em Pessoas.</li>}
          {atletas.map((a) => (
            <li key={a.id} className="border-border/60 flex items-center gap-3 border-b px-4 py-2 last:border-b-0">
              <Checkbox id={`dl-${a.id}`} checked={a.id in marcados}
                onCheckedChange={(c) => setMarcados((m) => { const n = { ...m }; if (c === true) n[a.id] = n[a.id] ?? ''; else delete n[a.id]; return n; })} />
              <label htmlFor={`dl-${a.id}`} className="flex-1 text-[17px]">{a.nome}</label>
              {a.id in marcados && <Input aria-label={`Quarto de ${a.nome}`} className="h-9 w-24" maxLength={20} placeholder="Quarto" value={marcados[a.id]}
                onChange={(e) => setMarcados((m) => ({ ...m, [a.id]: e.target.value }))} />}
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="dl-equipe" className="text-[15px] font-medium">Equipe e acompanhantes</label>
          <Textarea id="dl-equipe" rows={4} value={equipe} onChange={(e) => setEquipe(e.target.value)} placeholder={'Técnico Fulano | 103\nMotorista Sicrano'} />
          <FieldDescription>Um nome por linha; o quarto depois de uma barra (|).</FieldDescription>
        </div>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </div>
    </Folha>
  );
}

function FolhaVincular({ viagem, lancamentos, aoFechar }: { viagem: Viagem; lancamentos: { id: string; data: string; valor: string; descricao: string; tipo: 'entrada' | 'saida' }[]; aoFechar: () => void }) {
  const vincular = useAcaoF5('vincular_lancamento_viagem');
  const [papel, setPapel] = useState<'despesa' | 'adiantamento' | 'devolucao'>('despesa');
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const lista = lancamentos.filter((l) => l.tipo === (papel === 'devolucao' ? 'entrada' : 'saida'));
  async function enviar() {
    setErro(null);
    try {
      for (const id of escolhidos) await vincular.mutateAsync({ p_viagem: viagem.id, p_lancamento: id, p_papel: papel });
      toast.success(`${contar(escolhidos.size, 'lançamento ligado', 'lançamentos ligados')}`); aoFechar();
    } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(x) => !x && aoFechar()} titulo="Ligar lançamentos" descricao="Lançamentos realizados de 30 dias antes a 30 dias depois da viagem."
      rodape={<Button size="lg" className="w-full" disabled={!escolhidos.size || vincular.isPending} onClick={() => void enviar()}>
        {vincular.isPending ? <Spinner data-icon="inline-start" /> : <Link2 data-icon="inline-start" aria-hidden="true" />}Ligar {escolhidos.size || ''}</Button>}>
      <div className="flex flex-col gap-3 pb-2">
        <Select value={papel} onValueChange={(x) => { setPapel(x as typeof papel); setEscolhidos(new Set()); }}>
          <SelectTrigger aria-label="Como ligar"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>{(Object.keys(NOME_PAPEL) as (keyof typeof NOME_PAPEL)[]).map((p) => <SelectItem key={p} value={p}>{NOME_PAPEL[p]}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
        <ul className="bg-card flex flex-col rounded-[14px]">
          {lista.length === 0 && <li className="text-muted-foreground px-4 py-3 text-[15px]">Nenhum lançamento nesse período. Lance no Dinheiro primeiro.</li>}
          {lista.map((l) => (
            <li key={l.id} className="border-border/60 flex items-center gap-3 border-b px-4 py-2 last:border-b-0">
              <Checkbox id={`vl-${l.id}`} checked={escolhidos.has(l.id)} onCheckedChange={(c) => setEscolhidos((s) => { const n = new Set(s); if (c === true) n.add(l.id); else n.delete(l.id); return n; })} />
              <label htmlFor={`vl-${l.id}`} className="min-w-0 flex-1 text-[15px]"><span className="block truncate">{l.descricao}</span><span className="text-muted-foreground text-[13px]">{formatarData(l.data)}</span></label>
              <Valor valor={l.valor} tipo={l.tipo} className="text-[15px]" />
            </li>
          ))}
        </ul>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </div>
    </Folha>
  );
}
