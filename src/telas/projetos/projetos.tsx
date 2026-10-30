import {
  AlertTriangle, CalendarClock, CircleCheck, FileDown, FileSpreadsheet, HandCoins, Landmark, Pencil, Plus, Receipt, Wallet,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { BlocoErro, CarregandoLista, Vazio } from '@/components/app/estados';
import { Folha } from '@/components/app/folha';
import { Grupo, Linha } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { Valor } from '@/components/app/valor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { usePerfil } from '@/app/sessao';
import { useAcaoF3, useContas, useMembros, usePainelProjeto, usePainelProjetos } from '@/dados/consultas';
import { fonte } from '@/dados/fonte';
import type { DadosPrestacao, Pendencia, ProjetoPainel, RubricaExecucao, SituacaoProjeto } from '@/dados/tipos';
import { pode } from '@/lib/acesso';
import { formatarData, hojeSP, somarDias } from '@/lib/datas';
import { formatarBRL, lerValorBRL, mascararValor, paraCampo } from '@/lib/dinheiro';
import { FORMAS_TEXTO } from '@/lib/formas';
import { contar } from '@/lib/texto';
import { SeletorPessoa, erroMsg, nomeDe } from '@/telas/organizacao/comum';
import {
  BarraRitmo, EditorRegras, JUSTIFICAVEIS, NOME_ALERTA, NOME_REGRA, NOME_SITUACAO_PROJETO, regrasCompletas,
} from './comum';

function Ritmo({ p }: { p: ProjetoPainel }) {
  return (
    <div className="flex flex-col gap-1.5">
      <BarraRitmo pct={p.pct_gasto} tempo={p.pct_tempo} rotulo={`Execução de ${p.nome}`} />
      <p className="text-muted-foreground text-[13px]">
        {p.pct_gasto === null ? 'Sem orçamento informado' : `${p.pct_gasto.toLocaleString('pt-BR')}% gasto`}
        {p.pct_tempo !== null && ` · ${p.pct_tempo.toLocaleString('pt-BR')}% do prazo`}
        {p.pendencias.abertas > 0 && ` · ${contar(p.pendencias.abertas, 'pendência', 'pendências')}`}
      </p>
    </div>
  );
}

export function Projetos() {
  const perfil = usePerfil();
  const projetos = usePainelProjetos();
  const [novo, setNovo] = useState(false);
  const podeCriar = pode(perfil, 'projetos', 'criar');
  const ativos = (projetos.data ?? []).filter((p) => p.ativo);
  const outros = (projetos.data ?? []).filter((p) => !p.ativo);
  return (
    <Pagina titulo="Projetos" acoes={podeCriar ? <Button variant="ghost" size="sm" onClick={() => setNovo(true)}><Plus data-icon="inline-start" aria-hidden="true" />Novo projeto</Button> : undefined}>
      {novo && <FormNovoProjeto aoFechar={() => setNovo(false)} />}
      {projetos.isError ? <BlocoErro erro={projetos.error} tentarDeNovo={() => void projetos.refetch()} />
        : projetos.isPending ? <CarregandoLista linhas={3} rotulo="Carregando os projetos…" />
          : (projetos.data ?? []).length === 0 ? (
            <Vazio icone={Landmark} titulo="Nenhum projeto ainda" descricao="Crie um projeto próprio da Associação Exemplo, ou formalize uma verba aprovada (edital, emenda, patrocínio) em Verbas."
              acao={<div className="flex flex-wrap justify-center gap-2">{podeCriar && <Button onClick={() => setNovo(true)}><Plus data-icon="inline-start" aria-hidden="true" />Novo projeto</Button>}<Button variant="secondary" asChild><Link to="/verbas">Ir para Verbas</Link></Button></div>} />
          ) : (
            <>
              {ativos.map((p) => (
                <Link key={p.id} to={`/projetos/${p.id}`} className="bg-card flex flex-col gap-3 rounded-[18px] p-4 transition-colors hover:bg-muted/60 focus-visible:ring-4 focus-visible:ring-ring/35">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-[17px] font-semibold text-pretty">{p.nome}</h2>
                      <p className="text-muted-foreground text-[13px]">{p.fonte ?? 'Sem fonte'} · até {formatarData(p.vigencia_fim)}</p>
                    </div>
                    <Badge variant={p.pendencias.abertas ? 'destructive' : 'secondary'}>{NOME_SITUACAO_PROJETO[p.situacao]}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[15px]">
                    <div><p className="text-muted-foreground text-[13px]">Gasto</p><Valor valor={p.gasto} className="font-semibold" /></div>
                    <div><p className="text-muted-foreground text-[13px]">Orçamento</p><Valor valor={p.orcamento} className="font-semibold" /></div>
                  </div>
                  <Ritmo p={p} />
                </Link>
              ))}
              {outros.length > 0 && (
                <Grupo titulo="Encerrados ou cancelados">
                  {outros.map((p) => <Linha key={p.id} icone={Landmark} cor="cinza" titulo={p.nome} descricao={NOME_SITUACAO_PROJETO[p.situacao]} para={`/projetos/${p.id}`} />)}
                </Grupo>
              )}
            </>
          )}
    </Pagina>
  );
}

const corAlerta = (a: RubricaExecucao['alerta']) => (a === 'estourada' ? 'vermelho' : a ? 'laranja' : 'verde');

export function DetalheProjeto() {
  const { id = '' } = useParams();
  const perfil = usePerfil();
  const membros = useMembros();
  const painel = usePainelProjeto(id);
  const classificar = useAcaoF3('classificar_lancamento');
  const [folha, setFolha] = useState<null | 'editar' | 'regras' | 'rubrica' | 'conta' | { rubrica: RubricaExecucao } | { justificar: Pendencia }>(null);
  const [exportando, setExportando] = useState<null | 'pdf' | 'csv'>(null);
  const voltar = { para: '/projetos', rotulo: 'Projetos' };
  if (painel.isError) return <Pagina titulo="Projeto" voltar={voltar}><BlocoErro erro={painel.error} tentarDeNovo={() => void painel.refetch()} /></Pagina>;
  if (painel.isPending) return <Pagina titulo="Projeto" voltar={voltar}><CarregandoLista linhas={5} /></Pagina>;
  const { projeto: p, lancamentos, parcelas } = painel.data;
  const editar = pode(perfil, 'projetos', 'editar') && !['encerrado', 'cancelado'].includes(p.situacao);
  const rubricasAtivas = p.rubricas.filter((r) => r.ativa);
  const naoJustificadas = (p.pendencias.itens ?? []).filter((x) => !x.justificada);

  async function exportar(tipo: 'pdf' | 'csv') {
    setExportando(tipo);
    try {
      const d = await fonte().rpc<DadosPrestacao>('dados_prestacao', { p_id: p.id }, { tempoLimiteMs: 60_000 });
      const m = await import('@/lib/prestacao');
      if (tipo === 'pdf') await m.exportarPdfPrestacao(d, perfil.membro.nome); else m.exportarCsvPrestacao(d);
      if (p.pendencias.abertas) toast.warning('O relatório foi gerado, mas ainda há pendências. Resolva antes de enviar.');
    } catch (e) { toast.error(erroMsg(e, 'Não foi possível gerar o relatório.')); } finally { setExportando(null); }
  }

  return (
    <Pagina titulo={p.nome} voltar={voltar} acoes={editar ? <Button variant="ghost" size="icon" aria-label="Editar projeto" onClick={() => setFolha('editar')}><Pencil aria-hidden="true" /></Button> : undefined}>
      <section aria-label="Resumo do projeto" className="bg-card flex flex-col gap-4 rounded-[24px] p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{NOME_SITUACAO_PROJETO[p.situacao]}</Badge>
          {p.fonte && <Badge variant="outline">{p.fonte}</Badge>}
        </div>
        <dl className="grid grid-cols-2 gap-3 text-[15px] sm:grid-cols-4">
          <div><dt className="text-muted-foreground text-[13px]">Orçamento</dt><dd><Valor valor={p.orcamento} className="font-semibold" /></dd></div>
          <div><dt className="text-muted-foreground text-[13px]">Entrou</dt><dd><Valor valor={p.entrou} tipo="entrada" className="font-semibold" /></dd></div>
          <div><dt className="text-muted-foreground text-[13px]">Gasto</dt><dd><Valor valor={p.gasto} tipo="saida" className="font-semibold" /></dd></div>
          <div><dt className="text-muted-foreground text-[13px]">Saldo</dt><dd><Valor valor={p.saldo} className="font-semibold" /></dd></div>
        </dl>
        <Ritmo p={p} />
        <p className="text-muted-foreground text-[13px]">A barra mostra quanto do orçamento foi gasto; o traço, quanto do prazo já passou.</p>
      </section>

      <Grupo>
        <Linha icone={CalendarClock} cor="laranja" titulo="Vigência" descricao={`${formatarData(p.vigencia_inicio)} a ${formatarData(p.vigencia_fim)}`} />
        <Linha icone={CalendarClock} cor="vermelho" titulo="Prestação de contas"
          descricao={`Final: ${formatarData(p.prazo_prestacao)}${p.prazo_prestacao_parcial ? ` · parcial: ${formatarData(p.prazo_prestacao_parcial)}` : ''}`} />
        <Linha icone={Wallet} cor="roxo" titulo="Conta do projeto" descricao={p.contas.map((c) => c.nome).join(', ') || 'Nenhuma vinculada'}
          aoTocar={pode(perfil, 'financeiro', 'administrar') ? () => setFolha('conta') : undefined} seta={pode(perfil, 'financeiro', 'administrar')} />
        <Linha icone={CircleCheck} cor="indigo" titulo="Responsável" descricao={nomeDe(membros.data, p.responsavel)} />
        {p.verba_id && <Linha icone={HandCoins} cor="verde" titulo="Verba de origem" para={`/verbas/${p.verba_id}`} />}
      </Grupo>

      <Grupo titulo="Rubricas (previsto x realizado)" acao={editar ? <Button variant="link" size="xs" onClick={() => setFolha('rubrica')}>Adicionar</Button> : undefined}
        rodape={p.regras.exige_rubricas ? 'Este projeto só aceita gastos em rubricas aprovadas.' : undefined}>
        {p.rubricas.length === 0 && <Linha titulo="Nenhuma rubrica" descricao="Cadastre as rubricas do plano de trabalho (transporte, hospedagem, uniformes…)." />}
        {p.rubricas.map((r) => (
          <button key={r.id} type="button" disabled={!editar} onClick={() => setFolha({ rubrica: r })}
            className="hover:bg-muted/70 flex w-full flex-col gap-2 px-4 py-3 text-left disabled:hover:bg-transparent focus-visible:ring-4 focus-visible:ring-ring/35 focus-visible:ring-inset">
            <span className="flex w-full items-center justify-between gap-3">
              <span className="text-[17px]">{r.nome}{!r.ativa && <span className="text-muted-foreground"> (desativada)</span>}</span>
              <span className="numeros text-muted-foreground text-[15px]">{formatarBRL(r.realizado)} de {formatarBRL(r.previsto)}</span>
            </span>
            <BarraRitmo pct={r.pct} tempo={p.pct_tempo} rotulo={r.nome} alerta={r.alerta} />
            {r.alerta && <span className={`text-[13px] font-medium ${corAlerta(r.alerta) === 'vermelho' ? 'text-destructive' : 'text-aviso'}`}><AlertTriangle aria-hidden="true" className="mr-1 inline size-3.5" />{NOME_ALERTA[r.alerta]}</span>}
          </button>
        ))}
      </Grupo>

      {p.pendencias.itens !== null && (
        <Grupo titulo={`Pendências de regra (${naoJustificadas.length})`} rodape="Regras não bloqueiam o pagamento, mas precisam ser resolvidas ou justificadas antes da prestação de contas.">
          {naoJustificadas.length === 0 && <Linha icone={CircleCheck} cor="verde" titulo="Nenhuma pendência" />}
          {naoJustificadas.map((x) => (
            <Linha key={`${x.lancamento_id}-${x.regra}`} icone={AlertTriangle} cor={x.regra === 'sem_comprovante' ? 'vermelho' : 'laranja'}
              titulo={`${NOME_REGRA[x.regra].titulo}: ${x.descricao}`} descricao={`${formatarData(x.data)} · ${formatarBRL(x.valor)} · ${NOME_REGRA[x.regra].acao}`}
              para={x.regra === 'sem_comprovante' ? `/dinheiro/lancamento/${x.lancamento_id}` : undefined}
              aoTocar={x.regra !== 'sem_comprovante' && x.regra !== 'sem_rubrica' && JUSTIFICAVEIS.includes(x.regra) && pode(perfil, 'projetos', 'editar') ? () => setFolha({ justificar: x }) : undefined}
              seta={x.regra !== 'sem_rubrica'} />
          ))}
          {p.pendencias.justificadas > 0 && <Linha titulo={contar(p.pendencias.justificadas, 'regra justificada', 'regras justificadas')} descricao="Aparecem no relatório de auditoria." />}
        </Grupo>
      )}

      {lancamentos && (
        <Grupo titulo={`Lançamentos do projeto (${lancamentos.length})`} rodape="Entram aqui os lançamentos marcados com este projeto e os feitos na conta do projeto.">
          {lancamentos.length === 0 && <Linha titulo="Nenhum lançamento ainda" />}
          {lancamentos.slice(0, 60).map((l) => (
            <div key={l.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
              <Link to={`/dinheiro/lancamento/${l.id}`} className="min-w-0 flex-1 rounded-[6px] focus-visible:ring-4 focus-visible:ring-ring/35">
                <span className="block truncate text-[17px]">{l.descricao}</span>
                <span className="text-muted-foreground block text-[13px]">{formatarData(l.data)} · {l.forma_pagamento ? FORMAS_TEXTO[l.forma_pagamento] : '—'}{l.tem_comprovante ? '' : ' · sem comprovante'}</span>
              </Link>
              <Valor valor={l.valor} tipo={l.tipo} className="text-[15px]" />
              {l.tipo === 'saida' && rubricasAtivas.length > 0 && (
                <Select value={l.rubrica_id ?? 'nenhuma'} disabled={!pode(perfil, 'projetos', 'editar')}
                  onValueChange={(v) => classificar.mutate({ p_lancamento: l.id, p_rubrica: v === 'nenhuma' ? null : v }, { onError: (e) => toast.error(erroMsg(e)) })}>
                  <SelectTrigger aria-label={`Rubrica de ${l.descricao}`} className="h-9 sm:w-44"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup><SelectItem value="nenhuma">Sem rubrica</SelectItem>{rubricasAtivas.map((r) => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              )}
            </div>
          ))}
        </Grupo>
      )}

      {parcelas.length > 0 && (
        <Grupo titulo="Parcelas da verba">
          {parcelas.map((x) => <Linha key={x.numero} icone={x.recebido_em ? CircleCheck : CalendarClock} cor={x.recebido_em ? 'verde' : 'cinza'} titulo={`Parcela ${x.numero}`}
            descricao={x.recebido_em ? `Recebida em ${formatarData(x.recebido_em)}` : `Prevista para ${formatarData(x.data_prevista)}`} valor={<Valor valor={x.valor_recebido ?? x.valor} className="text-foreground text-[15px]" />} />)}
        </Grupo>
      )}

      {pode(perfil, 'projetos', 'exportar') && pode(perfil, 'financeiro', 'ver') && (
        <Grupo titulo="Prestação de contas" rodape="Gerada a partir do que já foi lançado: execução por rubrica, relação de pagamentos, cronograma de atividades (eventos da agenda ligados ao projeto) e documentos. A geração fica registrada na auditoria.">
          <Linha icone={FileDown} cor="vermelho" titulo={exportando === 'pdf' ? 'Gerando…' : 'Relatório completo em PDF'} aoTocar={() => void exportar('pdf')} desabilitada={!!exportando} />
          <Linha icone={FileSpreadsheet} cor="verde" titulo={exportando === 'csv' ? 'Gerando…' : 'Planilhas (CSV): pagamentos e rubricas'} aoTocar={() => void exportar('csv')} desabilitada={!!exportando} />
        </Grupo>
      )}
      <Grupo>
        <Linha icone={Receipt} cor="cinza" titulo="Regras do projeto" descricao={[
          p.regras.conta_especifica && 'conta específica', p.regras.exige_rubricas && 'só rubricas aprovadas',
          p.regras.exige_transferencia && 'pagamento por transferência', !p.regras.aceita_dinheiro && 'sem dinheiro vivo',
          !p.regras.permite_reembolso && 'sem reembolso', `guardar por ${contar(p.regras.guarda_anos, 'ano', 'anos')}`].filter(Boolean).join(' · ')}
          aoTocar={editar ? () => setFolha('regras') : undefined} seta={editar} />
      </Grupo>

      {folha === 'editar' && <FormProjeto p={p} aoFechar={() => setFolha(null)} />}
      {folha === 'regras' && <FormRegrasProjeto p={p} aoFechar={() => setFolha(null)} />}
      {folha === 'conta' && <FormConta p={p} aoFechar={() => setFolha(null)} />}
      {(folha === 'rubrica' || (folha && typeof folha === 'object' && 'rubrica' in folha)) && (
        <FormRubrica projeto={p.id} rubrica={folha === 'rubrica' ? null : (folha as { rubrica: RubricaExecucao }).rubrica} aoFechar={() => setFolha(null)} />
      )}
      {folha && typeof folha === 'object' && 'justificar' in folha && <FormJustificar projeto={p.id} pendencia={folha.justificar} aoFechar={() => setFolha(null)} />}
    </Pagina>
  );
}

function FormRubrica({ projeto, rubrica, aoFechar }: { projeto: string; rubrica: RubricaExecucao | null; aoFechar: () => void }) {
  const salvar = useAcaoF3<Record<string, unknown>, { aviso?: string }>('salvar_rubrica');
  const [id] = useState(() => rubrica?.id ?? crypto.randomUUID());
  const [nome, setNome] = useState(rubrica?.nome ?? '');
  const [valor, setValor] = useState(paraCampo(rubrica?.previsto) ?? '');
  const [erro, setErro] = useState<string | null>(null);
  async function enviar(ativa = rubrica?.ativa ?? true) {
    setErro(null);
    const v = lerValorBRL(valor);
    if (!v) return setErro('Confira o valor previsto.');
    try {
      const r = await salvar.mutateAsync({ p_projeto: projeto, p: { id, nome: nome.trim(), valor_previsto: v, ativa } });
      if (r.aviso) toast.warning('A soma das rubricas passou do valor aprovado mais a contrapartida. Confira o plano de trabalho.');
      else toast.success('Rubrica salva');
      aoFechar();
    } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo={rubrica ? rubrica.nome : 'Nova rubrica'}
      rodape={<div className="flex w-full flex-col gap-2">
        <Button size="lg" disabled={nome.trim().length < 2 || !valor || salvar.isPending} onClick={() => void enviar()}>{salvar.isPending && <Spinner data-icon="inline-start" />}Salvar</Button>
        {rubrica && <Button size="lg" variant="ghost" onClick={() => void enviar(!rubrica.ativa)}>{rubrica.ativa ? 'Desativar rubrica' : 'Reativar rubrica'}</Button>}
      </div>}>
      <FieldGroup className="pb-2">
        <Field><FieldLabel htmlFor="rb-nome">Nome</FieldLabel><Input id="rb-nome" name="rb-nome" maxLength={80} autoComplete="off" placeholder="Ex.: Transporte…" value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
        <Field><FieldLabel htmlFor="rb-valor">Valor previsto (R$)</FieldLabel><Input id="rb-valor" name="rb-valor" inputMode="numeric" autoComplete="off" placeholder="0,00" value={valor} onChange={(e) => setValor(mascararValor(e.target.value))} />
          <FieldDescription>O sistema avisa quando o gasto chega a 90% e quando passa do previsto.</FieldDescription></Field>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

function FormJustificar({ projeto, pendencia, aoFechar }: { projeto: string; pendencia: Pendencia; aoFechar: () => void }) {
  const justificar = useAcaoF3('justificar_regra');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  async function enviar() {
    setErro(null);
    try { await justificar.mutateAsync({ p_lancamento: pendencia.lancamento_id, p_projeto: projeto, p_regra: pendencia.regra, p_motivo: motivo.trim() }); toast.success('Justificativa registrada'); aoFechar(); }
    catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo={NOME_REGRA[pendencia.regra].titulo} descricao={`${pendencia.descricao} · ${formatarBRL(pendencia.valor)}`}
      rodape={<Button size="lg" className="w-full" disabled={motivo.trim().length < 3 || justificar.isPending} onClick={() => void enviar()}>{justificar.isPending && <Spinner data-icon="inline-start" />}Registrar justificativa</Button>}>
      <FieldGroup className="pb-2">
        <Field>
          <FieldLabel htmlFor="js-motivo">Por que foi assim</FieldLabel>
          <Input id="js-motivo" name="js-motivo" maxLength={300} autoComplete="off" placeholder="Ex.: o fornecedor só aceitava espécie…" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <FieldDescription>A justificativa não pode ser alterada depois e fica na auditoria.</FieldDescription>
        </Field>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

function FormProjeto({ p, aoFechar }: { p: ProjetoPainel; aoFechar: () => void }) {
  const salvar = useAcaoF3('editar_projeto');
  const [nome, setNome] = useState(p.nome);
  const [fonteTxt, setFonte] = useState(p.fonte ?? '');
  const [ini, setIni] = useState(p.vigencia_inicio ?? '');
  const [fim, setFim] = useState(p.vigencia_fim ?? '');
  const [aprovado, setAprovado] = useState(paraCampo(p.valor_aprovado));
  const [contra, setContra] = useState(paraCampo(p.valor_contrapartida));
  const [prazo, setPrazo] = useState(p.prazo_prestacao ?? '');
  const [parcial, setParcial] = useState(p.prazo_prestacao_parcial ?? '');
  const [resp, setResp] = useState(p.responsavel ?? '');
  const [situacao, setSituacao] = useState<SituacaoProjeto>(p.situacao);
  const [erro, setErro] = useState<string | null>(null);
  async function enviar() {
    setErro(null);
    try {
      await salvar.mutateAsync({ p_id: p.id, p: { nome: nome.trim(), fonte: fonteTxt.trim() || null, vigencia_inicio: ini || null, vigencia_fim: fim || null,
        valor_aprovado: aprovado.trim() ? lerValorBRL(aprovado) : null, valor_contrapartida: lerValorBRL(contra || '0') ?? '0.00',
        prazo_prestacao: prazo || null, prazo_prestacao_parcial: parcial || null, responsavel: resp || null, situacao } });
      toast.success('Projeto atualizado'); aoFechar();
    } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo="Editar projeto" larga
      rodape={<Button size="lg" className="w-full" disabled={nome.trim().length < 2 || salvar.isPending} onClick={() => void enviar()}>{salvar.isPending && <Spinner data-icon="inline-start" />}Salvar</Button>}>
      <FieldGroup className="pb-2">
        <Field><FieldLabel htmlFor="pj-nome">Nome</FieldLabel><Input id="pj-nome" name="pj-nome" maxLength={120} autoComplete="off" value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
        <Field><FieldLabel htmlFor="pj-fonte">Fonte</FieldLabel><Input id="pj-fonte" name="pj-fonte" maxLength={120} autoComplete="off" placeholder="Ex.: Lei Paulista de Incentivo ao Esporte…" value={fonteTxt} onChange={(e) => setFonte(e.target.value)} /></Field>
        <FieldSet><FieldLegend variant="label">Vigência</FieldLegend>
          <div className="grid grid-cols-2 gap-3">
            <Field><FieldLabel htmlFor="pj-ini">Início</FieldLabel><Input id="pj-ini" name="pj-ini" type="date" value={ini} onChange={(e) => setIni(e.target.value)} /></Field>
            <Field><FieldLabel htmlFor="pj-fim">Fim</FieldLabel><Input id="pj-fim" name="pj-fim" type="date" min={ini} value={fim} onChange={(e) => setFim(e.target.value)} /></Field>
          </div>
        </FieldSet>
        <div className="grid grid-cols-2 gap-3">
          <Field><FieldLabel htmlFor="pj-aprov">Valor aprovado (R$)</FieldLabel><Input id="pj-aprov" name="pj-aprov" inputMode="numeric" autoComplete="off" value={aprovado} onChange={(e) => setAprovado(mascararValor(e.target.value))} /></Field>
          <Field><FieldLabel htmlFor="pj-contra">Contrapartida (R$)</FieldLabel><Input id="pj-contra" name="pj-contra" inputMode="numeric" autoComplete="off" value={contra} onChange={(e) => setContra(mascararValor(e.target.value))} /></Field>
          <Field><FieldLabel htmlFor="pj-prazo">Prestação final até</FieldLabel><Input id="pj-prazo" name="pj-prazo" type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="pj-parcial">Prestação parcial até</FieldLabel><Input id="pj-parcial" name="pj-parcial" type="date" value={parcial} onChange={(e) => setParcial(e.target.value)} /></Field>
        </div>
        <FieldDescription>Os prazos de prestação viram tarefas com lembrete para o responsável.</FieldDescription>
        <SeletorPessoa id="pj-resp" rotulo="Responsável" valor={resp} aoMudar={setResp} />
        <Field>
          <FieldLabel htmlFor="pj-sit">Situação</FieldLabel>
          <Select value={situacao} onValueChange={(v) => setSituacao(v as SituacaoProjeto)}>
            <SelectTrigger id="pj-sit"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{(Object.keys(NOME_SITUACAO_PROJETO) as SituacaoProjeto[]).map((s) => <SelectItem key={s} value={s}>{NOME_SITUACAO_PROJETO[s]}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
          {(situacao === 'encerrado' || situacao === 'cancelado') && <FieldDescription>Depois de encerrado, só um administrador altera o projeto.</FieldDescription>}
        </Field>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

function FormRegrasProjeto({ p, aoFechar }: { p: ProjetoPainel; aoFechar: () => void }) {
  const salvar = useAcaoF3('editar_projeto');
  const [regras, setRegras] = useState(() => regrasCompletas(p.regras));
  const [erro, setErro] = useState<string | null>(null);
  async function enviar() {
    setErro(null);
    try { await salvar.mutateAsync({ p_id: p.id, p: { regras } }); toast.success('Regras atualizadas'); aoFechar(); } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo="Regras do projeto" larga descricao="Valem para os próximos lançamentos e para conferir os que já existem."
      rodape={<Button size="lg" className="w-full" disabled={salvar.isPending} onClick={() => void enviar()}>{salvar.isPending && <Spinner data-icon="inline-start" />}Salvar regras</Button>}>
      <div className="pb-2"><EditorRegras prefixo="rp" valor={regras} aoMudar={setRegras} />{erro && <FieldError role="alert">{erro}</FieldError>}</div>
    </Folha>
  );
}

function FormConta({ p, aoFechar }: { p: ProjetoPainel; aoFechar: () => void }) {
  const contas = useContas();
  const vincular = useAcaoF3('vincular_conta_projeto');
  const livres = (contas.data ?? []).filter((c) => c.ativa && (!c.projeto_id || c.projeto_id === p.id));
  const mudar = (conta: string, sim: boolean) => vincular.mutate({ p_projeto: p.id, p_conta: conta, p_vincular: sim }, { onError: (e) => toast.error(erroMsg(e)) });
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo="Conta do projeto" descricao="Lançamentos feitos na conta vinculada entram neste projeto automaticamente.">
      <div className="flex flex-col gap-4 pb-2">
        <Grupo>
          {livres.length === 0 && <Linha titulo="Nenhuma conta disponível" descricao="Cadastre a conta específica em Dinheiro › Contas." />}
          {livres.map((c) => (
            <Linha key={c.id} icone={Wallet} cor={c.projeto_id === p.id ? 'roxo' : 'cinza'} titulo={c.nome} descricao={c.projeto_id === p.id ? 'Vinculada a este projeto' : undefined}
              valor={<Button size="sm" variant={c.projeto_id === p.id ? 'ghost' : 'secondary'} disabled={vincular.isPending} onClick={() => mudar(c.id, c.projeto_id !== p.id)}>
                {c.projeto_id === p.id ? 'Desvincular' : 'Vincular'}</Button>} />
          ))}
        </Grupo>
        <p className="text-muted-foreground text-[13px]">Contas já ligadas a outro projeto não aparecem. <Plus aria-hidden="true" className="inline size-3" /> Novas contas: Dinheiro › Contas.</p>
      </div>
    </Folha>
  );
}

function FormNovoProjeto({ aoFechar }: { aoFechar: () => void }) {
  const criar = useAcaoF3<Record<string, unknown>, { id: string }>('criar_projeto');
  const navegar = useNavigate();
  const [id] = useState(() => crypto.randomUUID());
  const [nome, setNome] = useState('');
  const [origem, setOrigem] = useState('Recursos próprios');
  const [ini, setIni] = useState(hojeSP());
  const [fim, setFim] = useState(somarDias(hojeSP(), 365));
  const [valor, setValor] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const valorOk = !valor.trim() || lerValorBRL(valor) !== null;
  async function enviar() {
    setErro(null);
    try {
      const r = await criar.mutateAsync({ p: { projeto_id: id, nome: nome.trim(), fonte: origem.trim(), vigencia_inicio: ini, vigencia_fim: fim,
        ...(valor.trim() ? { valor_aprovado: lerValorBRL(valor) } : {}) } });
      toast.success('Projeto criado. Agora cadastre as rubricas (as partes do orçamento).');
      aoFechar(); navegar(`/projetos/${r.id}`);
    } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && !criar.isPending && aoFechar()} titulo="Novo projeto" descricao="Projeto próprio da Associação Exemplo, com orçamento por rubrica e prestação de contas."
      rodape={<Button size="lg" className="w-full" disabled={nome.trim().length < 2 || !ini || !fim || fim < ini || !valorOk || criar.isPending} onClick={() => void enviar()}>{criar.isPending && <Spinner data-icon="inline-start" />}Criar projeto</Button>}>
      <FieldGroup className="pb-2">
        <Field><FieldLabel htmlFor="np-nome">Nome do projeto</FieldLabel><Input id="np-nome" name="np-nome" maxLength={120} autoComplete="off" placeholder="Ex.: Escolinha de bocha 2027" value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
        <Field><FieldLabel htmlFor="np-fonte">De onde vem o dinheiro</FieldLabel><Input id="np-fonte" name="np-fonte" maxLength={120} autoComplete="off" value={origem} onChange={(e) => setOrigem(e.target.value)} /></Field>
        <FieldSet>
          <FieldLegend variant="label">Vigência</FieldLegend>
          <div className="grid grid-cols-2 gap-3">
            <Field><FieldLabel htmlFor="np-ini">Início</FieldLabel><Input id="np-ini" name="np-ini" type="date" value={ini} onChange={(e) => setIni(e.target.value)} /></Field>
            <Field><FieldLabel htmlFor="np-fim">Fim</FieldLabel><Input id="np-fim" name="np-fim" type="date" min={ini} value={fim} onChange={(e) => setFim(e.target.value)} /></Field>
          </div>
        </FieldSet>
        <Field><FieldLabel htmlFor="np-valor">Valor total previsto (R$, opcional)</FieldLabel><Input id="np-valor" name="np-valor" inputMode="numeric" autoComplete="off" placeholder="0,00" value={valor} onChange={(e) => setValor(mascararValor(e.target.value))} /></Field>
        <FieldDescription>Veio de edital, emenda ou patrocínio? Use <Link className="text-tint underline" to="/verbas">Verbas › Formalizar como projeto</Link>: o projeto já herda as regras e os documentos exigidos.</FieldDescription>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}
