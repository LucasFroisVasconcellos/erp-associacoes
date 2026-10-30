// LGPD: o cadastro pede o mínimo; saúde nunca aparece fora da área própria.
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, BadgeCheck, Baby, CalendarCheck2, FileText, HeartPulse, IdCard, Landmark, Mail, Phone, Plus, QrCode, Search, Settings2, ShieldCheck,
  Trash2, Undo2, UserRound, Users, Wallet,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { AbrirDocumento, AnexarDocumento, CampoArquivo, enviarDocumento } from '@/components/app/arquivo-documento';
import { BlocoErro, CarregandoLista, Vazio } from '@/components/app/estados';
import { Folha } from '@/components/app/folha';
import { Grupo, Linha } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { Pilulas, Segmentado } from '@/components/app/segmentado';
import { Valor } from '@/components/app/valor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { usePerfil } from '@/app/sessao';
import { fonte } from '@/dados/fonte';
import {
  chavesF4, useAcaoF4, useCategoriasSocio, useParcelasUnicas, useSalariosMinimos, useConfigPix, useConsentimentos, useDocumentosPessoa, useDocumentosSaude, useEmprestimos, useBens,
  useFrequencia, useLancamentos, useMensalidades, usePessoas, useResumoPessoas, useSaude,
  useCategorias, useContas,
} from '@/dados/consultas';
import type {
  CategoriaSocio, SalarioMinimo, Consentimento, FinalidadeConsentimento, Mensalidade, Pessoa, SituacaoPessoa, TipoDocumentoPessoa, TipoDocumentoSaude,
} from '@/dados/tipos';
import { pode } from '@/lib/acesso';
import { formatarData, hojeSP, mesPorExtenso, somarDias } from '@/lib/datas';
import { formatarBRL, lerValorBRL, mascararValor, paraCampo } from '@/lib/dinheiro';
import { DIAS_ANTECEDENCIA_AUMENTO, anoParcelaAberta, fimFevereiro, formatarPercentual, proximoVencimento, valorDaCategoria, valorParcelaUnica } from '@/lib/mensalidade';
import { contar } from '@/lib/texto';
import { erroMsg } from '@/telas/organizacao/comum';
import {
  COR_VALIDADE, formatarTelefone, NOME_DOC_PESSOA, NOME_DOC_SAUDE, NOME_SITUACAO_MENS, NOME_SITUACAO_PESSOA, estadoValidade, idade, menorDeIdade, ultimasCompetencias,
} from './comum';
import { CobrancaPix } from './pix';
import { CamposFicha, FichaEsportiva, FotoAtleta, enviarFoto, fichaInicial, fichaParaEnvio, fichaValida, fichaVazia } from './ficha-atleta';

/** "1% do salário mínimo · R$ 16,21" ou "R$ 30,00": valor do próximo vencimento (o servidor calcula o que é cobrado). */
function useRotuloCategoria() {
  const salarios = useSalariosMinimos();
  return (c: CategoriaSocio) => {
    if (c.percentual_salario_minimo == null) return Number(c.valor_mensalidade) > 0 ? formatarBRL(c.valor_mensalidade) : 'Isento';
    const v = valorDaCategoria(c, salarios.data ?? [], proximoVencimento(hojeSP(), c.dia_vencimento));
    return `${formatarPercentual(c.percentual_salario_minimo)} do salário mínimo${v ? ` · ${formatarBRL(v)}` : ''}`;
  };
}

const mesTitulo = (iso: string) => mesPorExtenso(iso).replace(/^./, (c) => c.toUpperCase());
type Aba = 'pessoas' | 'mensalidades';

export function Pessoas() {
  const perfil = usePerfil();
  // a aba fica no endereço (?aba=mensalidades): voltar e compartilhar funcionam
  const [params, setParams] = useSearchParams();
  const aba: Aba = params.get('aba') === 'mensalidades' ? 'mensalidades' : 'pessoas';
  const setAba = (v: Aba) => setParams(v === 'mensalidades' ? { aba: v } : {}, { replace: true });
  const [nova, setNova] = useState(false);
  return (
    <Pagina titulo="Pessoas" acoes={
      <>
        {pode(perfil, 'pessoas', 'criar') && <Button size="icon" variant="ghost" aria-label="Cadastrar pessoa" onClick={() => setNova(true)}><Plus aria-hidden="true" /></Button>}
        <Button asChild size="icon" variant="ghost"><Link to="/pessoas/cadastros" aria-label="Configurar mensalidade e Pix"><Settings2 aria-hidden="true" /></Link></Button>
      </>
    } sob={<Segmentado rotulo="Ver" valor={aba} aoMudar={setAba} opcoes={[{ valor: 'pessoas', rotulo: 'Cadastro' }, { valor: 'mensalidades', rotulo: 'Mensalidades' }]} />}>
      {aba === 'pessoas' ? <ListaPessoas aoNova={() => setNova(true)} /> : <PainelMensalidades />}
      {nova && <FormPessoa pessoa={null} aoFechar={() => setNova(false)} />}
    </Pagina>
  );
}

function ListaPessoas({ aoNova }: { aoNova: () => void }) {
  const perfil = usePerfil();
  const pessoas = usePessoas();
  const resumo = useResumoPessoas();
  const mens = useMensalidades();
  const [busca, setBusca] = useState('');
  const [situacao, setSituacao] = useState<SituacaoPessoa>('ativo');
  const hoje = hojeSP();
  const atrasados = useMemo(() => new Set((mens.data ?? []).filter((m) => m.situacao === 'aberta' && m.vencimento < hoje).map((m) => m.pessoa_id)), [mens.data, hoje]);
  const termo = busca.trim().toLocaleLowerCase('pt-BR');
  const lista = (pessoas.data ?? []).filter((p) => p.situacao === situacao && (!termo || p.nome.toLocaleLowerCase('pt-BR').includes(termo)));
  if (pessoas.isError) return <BlocoErro erro={pessoas.error} tentarDeNovo={() => void pessoas.refetch()} />;
  if (pessoas.isPending) return <CarregandoLista linhas={5} rotulo="Carregando o cadastro…" />;
  if ((pessoas.data ?? []).length === 0) {
    return <Vazio icone={Users} titulo="Nenhuma pessoa cadastrada" descricao="Cadastre atletas e associados com o mínimo necessário: nome, contato e, para menores, o responsável."
      acao={pode(perfil, 'pessoas', 'criar') ? <Button onClick={aoNova}><Plus data-icon="inline-start" aria-hidden="true" />Cadastrar pessoa</Button> : undefined} />;
  }
  const r = resumo.data;
  return (
    <>
      {r && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-card rounded-[18px] p-4"><p className="text-muted-foreground text-[13px]">Ativos</p>
            <p className="font-rounded numeros text-[22px] font-bold">{r.ativos}</p>
            <p className="text-muted-foreground text-[13px]">{contar(r.atletas, 'atleta', 'atletas')} · {contar(r.associados, 'associado', 'associados')}</p></div>
          <div className="bg-card rounded-[18px] p-4"><p className="text-muted-foreground text-[13px]">Mensalidades atrasadas</p>
            <Valor valor={r.valor_atrasado} className="font-rounded text-[22px] font-bold" />
            <p className="text-muted-foreground text-[13px]">{contar(r.mensalidades_atrasadas, 'cobrança', 'cobranças')}</p></div>
        </div>
      )}
      {r && (r.menores_sem_responsavel > 0 || r.documentos_vencendo.length > 0 || (r.saude_vencendo ?? 0) > 0) && (
        <Grupo titulo="Atenção">
          {r.menores_sem_responsavel > 0 && <Linha icone={Baby} cor="vermelho" titulo={contar(r.menores_sem_responsavel, 'menor sem responsável', 'menores sem responsável')} descricao="Complete o cadastro com o responsável legal." />}
          {r.documentos_vencendo.map((d) => (
            <Linha key={d.id} icone={IdCard} cor={d.validade < hojeSP() ? 'vermelho' : 'laranja'} titulo={`${NOME_DOC_PESSOA[d.tipo]} — ${d.pessoa}`}
              descricao={`${d.validade < hojeSP() ? 'Venceu' : 'Vence'} em ${formatarData(d.validade)}`} para={`/pessoas/${d.pessoa_id}`} />
          ))}
          {(r.saude_vencendo ?? 0) > 0 && <Linha icone={HeartPulse} cor="laranja" titulo={contar(r.saude_vencendo!, 'documento de saúde vence', 'documentos de saúde vencem')} descricao="Nos próximos 30 dias. Veja na ficha de cada atleta." />}
        </Grupo>
      )}
      <div className="flex flex-col gap-3">
        <InputGroup>
          <InputGroupInput aria-label="Buscar pelo nome" placeholder="Buscar pelo nome…" value={busca} onChange={(e) => setBusca(e.target.value)} name="busca-pessoa" autoComplete="off" />
          <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
        </InputGroup>
        <Pilulas rotulo="Situação" valor={situacao} aoMudar={setSituacao}
          opcoes={(['ativo', 'inativo', 'desligado'] as const).map((s) => ({ valor: s, rotulo: `${NOME_SITUACAO_PESSOA[s]}s` }))} />
      </div>
      <Grupo titulo={contar(lista.length, 'pessoa', 'pessoas')}>
        {lista.length === 0 && <Linha titulo="Ninguém encontrado" />}
        {lista.map((p) => {
          const i = idade(p.data_nascimento);
          return (
            <Linha key={p.id} icone={UserRound} cor={p.atleta ? 'azul' : 'teal'} titulo={p.nome} para={`/pessoas/${p.id}`}
              descricao={[p.atleta && 'Atleta', p.associado && 'Associado', i !== null && `${i} anos`, menorDeIdade(p.data_nascimento) && !p.responsavel_nome && 'sem responsável'].filter(Boolean).join(' · ')}
              valor={atrasados.has(p.id) ? <Badge variant="destructive">Atrasada</Badge> : undefined} />
          );
        })}
      </Grupo>
    </>
  );
}

function PainelMensalidades() {
  const perfil = usePerfil();
  const pessoas = usePessoas();
  const mens = useMensalidades();
  const gerar = useAcaoF4<Record<string, unknown>, { criadas: number }>('gerar_mensalidades');
  const competencias = useMemo(() => ultimasCompetencias(13), []);
  const [comp, setComp] = useState(competencias[0]!);
  const [aberta, setAberta] = useState<Mensalidade | null>(null);
  const doMes = (mens.data ?? []).filter((m) => m.competencia === comp);
  const nome = (id: string) => pessoas.data?.find((p) => p.id === id)?.nome ?? 'Pessoa';
  const total = (s: Mensalidade['situacao']) => doMes.filter((m) => m.situacao === s).reduce((t, m) => t + Number(m.valor), 0).toFixed(2);
  async function gerarMes() {
    try { const r = await gerar.mutateAsync({ p_competencia: comp }); toast.success(r.criadas ? `${contar(r.criadas, 'mensalidade criada', 'mensalidades criadas')}` : 'As mensalidades deste mês já existiam'); }
    catch (e) { toast.error(erroMsg(e)); }
  }
  return (
    <>
      {pode(perfil, 'pessoas', 'ver') && (
        <Grupo>
          <Linha icone={Settings2} cor="teal" titulo="Configurar a mensalidade" descricao="Valor por categoria, % do salário mínimo, parcela única e chave Pix" para="/pessoas/cadastros" />
        </Grupo>
      )}
      <Field>
        <FieldLabel htmlFor="mn-mes">Mês</FieldLabel>
        <Select value={comp} onValueChange={setComp}>
          <SelectTrigger id="mn-mes"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>{competencias.map((c) => <SelectItem key={c} value={c}>{mesTitulo(c)}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-card rounded-[18px] p-4"><p className="text-muted-foreground text-[13px]">Recebido</p><Valor valor={total('paga')} className="font-rounded text-[22px] font-bold" /></div>
        <div className="bg-card rounded-[18px] p-4"><p className="text-muted-foreground text-[13px]">Em aberto</p><Valor valor={total('aberta')} className="font-rounded text-[22px] font-bold" /></div>
      </div>
      {mens.isPending ? <CarregandoLista /> : mens.isError ? <BlocoErro erro={mens.error} tentarDeNovo={() => void mens.refetch()} /> : (
        <Grupo titulo={contar(doMes.length, 'mensalidade', 'mensalidades')}
          rodape="A mensalidade é criada para quem está ativo e tem categoria com valor. Gerar de novo não duplica.">
          {doMes.length === 0 && <Linha titulo="Nenhuma mensalidade neste mês" />}
          {doMes.sort((a, b) => nome(a.pessoa_id).localeCompare(nome(b.pessoa_id))).map((m) => (
            <Linha key={m.id} icone={Wallet} cor={corMensalidade(m)} titulo={nome(m.pessoa_id)} aoTocar={() => setAberta(m)} seta
              descricao={`${NOME_SITUACAO_MENS[m.situacao]}${m.situacao === 'aberta' ? ` · vence ${formatarData(m.vencimento)}` : m.pago_em ? ` · ${formatarData(m.pago_em)}` : ''}`}
              valor={<Valor valor={m.valor} className="text-foreground text-[15px]" />} />
          ))}
          {pode(perfil, 'pessoas', 'editar') && <Linha icone={Plus} cor="cinza" titulo={gerar.isPending ? 'Gerando…' : 'Gerar as mensalidades deste mês'} aoTocar={() => void gerarMes()} desabilitada={gerar.isPending} />}
        </Grupo>
      )}
      {aberta && <FolhaMensalidade mensalidade={aberta} nome={nome(aberta.pessoa_id)} aoFechar={() => setAberta(null)} />}
    </>
  );
}

function ParcelaUnicaDaPessoa({ pessoa, categoria }: { pessoa: Pessoa; categoria: CategoriaSocio }) {
  const perfil = usePerfil();
  const parcelas = useParcelasUnicas(pessoa.id);
  const salarios = useSalariosMinimos();
  const mens = useMensalidades(pessoa.id);
  const [aberta, setAberta] = useState(false);
  const hoje = hojeSP();
  const ano = anoParcelaAberta(hoje);
  const anoMostrado = ano ?? Number(hoje.slice(0, 4));
  const paga = (parcelas.data ?? []).find((u) => u.ano === anoMostrado);
  const valor = valorParcelaUnica(categoria, salarios.data ?? [], anoMostrado);
  const mensalPaga = (mens.data ?? []).some((m) => m.situacao === 'paga' && m.competencia.startsWith(String(anoMostrado)));
  const podeReceber = ano !== null && !paga && !mensalPaga && valor !== null && pode(perfil, 'financeiro', 'editar') && pode(perfil, 'financeiro', 'criar') && pessoa.situacao === 'ativo';
  const descricao = paga ? `Paga em ${formatarData(paga.pago_em)} · quita ${anoMostrado}`
    : ano === null ? `Recebida de dezembro até o fim de fevereiro`
    : mensalPaga ? `Já tem mensalidade de ${anoMostrado} paga: segue no mensal`
    : `Aberta até ${formatarData(fimFevereiro(ano))}`;
  return (
    <Grupo titulo="Parcela única anual">
      <Linha icone={CalendarCheck2} cor={paga ? 'verde' : ano !== null && !mensalPaga ? 'laranja' : 'cinza'} titulo={`Parcela única ${anoMostrado}`} descricao={descricao}
        valor={valor || paga ? <Valor valor={paga?.valor ?? valor!} className="text-foreground text-[15px]" /> : undefined}
        aoTocar={podeReceber ? () => setAberta(true) : undefined} seta={podeReceber} />
      {aberta && ano !== null && valor && <FolhaParcelaUnica pessoa={pessoa} ano={ano} valor={valor} aoFechar={() => setAberta(false)} />}
    </Grupo>
  );
}

function FolhaParcelaUnica({ pessoa, ano, valor, aoFechar }: { pessoa: Pessoa; ano: number; valor: string; aoFechar: () => void }) {
  const receber = useAcaoF4('receber_parcela_unica');
  const contas = useContas(); const categorias = useCategorias();
  const contasAtivas = (contas.data ?? []).filter((c) => c.ativa);
  const catsEntrada = (categorias.data ?? []).filter((c) => c.ativa && c.tipo === 'entrada');
  const [rec, setRec] = useState({ conta: '', forma: 'pix', data: hojeSP(), categoria: '' });
  const [ids] = useState(() => ({ id: crypto.randomUUID(), lancamento: crypto.randomUUID() })); // repetir o toque não duplica
  const [erro, setErro] = useState<string | null>(null);
  const contaRec = rec.conta || contasAtivas[0]?.id || '';
  const catRec = rec.categoria || catsEntrada.find((c) => /mensalidade|contribui/i.test(c.nome))?.id || '';
  async function enviar() {
    setErro(null);
    try {
      await receber.mutateAsync({ p_id: ids.id, p_pessoa: pessoa.id, p_ano: ano, p_lancamento: ids.lancamento, p_conta: contaRec, p_data: rec.data, p_forma: rec.forma, p_categoria: catRec });
      toast.success(`Parcela única de ${ano} recebida e lançada no Dinheiro`); aoFechar();
    } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo={`Parcela única ${ano}`} descricao={`${pessoa.nome} · ${formatarBRL(valor)}`}
      rodape={<Button size="lg" className="w-full" disabled={!contaRec || !catRec || !rec.data || receber.isPending} onClick={() => void enviar()}>{receber.isPending && <Spinner data-icon="inline-start" />}Recebi a parcela única</Button>}>
      <FieldGroup className="pb-2">
        <div className="grid grid-cols-2 gap-3">
          <Field><FieldLabel htmlFor="pu-conta">Conta</FieldLabel>
            <Select value={contaRec} onValueChange={(v) => setRec((x) => ({ ...x, conta: v }))}><SelectTrigger id="pu-conta"><SelectValue placeholder="Escolha" /></SelectTrigger>
              <SelectContent><SelectGroup>{contasAtivas.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
          <Field><FieldLabel htmlFor="pu-forma">Forma</FieldLabel>
            <Select value={rec.forma} onValueChange={(v) => setRec((x) => ({ ...x, forma: v }))}><SelectTrigger id="pu-forma"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{[['pix', 'Pix'], ['dinheiro', 'Dinheiro'], ['transferencia', 'Transferência'], ['boleto', 'Boleto'], ['cartao_debito', 'Cartão de débito']].map(([v, n]) => <SelectItem key={v} value={v!}>{n}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
          <Field><FieldLabel htmlFor="pu-data">Data</FieldLabel><Input id="pu-data" type="date" min={`${ano - 1}-12-01`} max={hojeSP() < fimFevereiro(ano) ? hojeSP() : fimFevereiro(ano)} value={rec.data} onChange={(e) => setRec((x) => ({ ...x, data: e.target.value }))} /></Field>
          <Field><FieldLabel htmlFor="pu-cat">Categoria</FieldLabel>
            <Select value={catRec} onValueChange={(v) => setRec((x) => ({ ...x, categoria: v }))}><SelectTrigger id="pu-cat"><SelectValue placeholder="Escolha" /></SelectTrigger>
              <SelectContent><SelectGroup>{catsEntrada.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
        </div>
        <FieldDescription>Lança a entrada de {formatarBRL(valor)} no Dinheiro e dispensa as mensalidades de {ano} que já tinham sido geradas. As próximas não são criadas. O valor é conferido de novo no servidor.</FieldDescription>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

const corMensalidade = (m: Mensalidade) => (m.situacao === 'paga' ? 'verde' : m.situacao === 'aberta' ? (m.vencimento < hojeSP() ? 'vermelho' : 'laranja') : 'cinza');

function FolhaMensalidade({ mensalidade: m0, nome, aoFechar }: { mensalidade: Mensalidade; nome: string; aoFechar: () => void }) {
  const perfil = usePerfil();
  const pix = useConfigPix();
  const mens = useMensalidades();
  const m = mens.data?.find((x) => x.id === m0.id) ?? m0;
  const baixa = useAcaoF4('registrar_pagamento_mensalidade');
  const receber = useAcaoF4('receber_mensalidade');
  const contas = useContas(); const categorias = useCategorias();
  const [jeito, setJeito] = useState<'agora' | 'ligar'>('agora');
  const contasAtivas = (contas.data ?? []).filter((c) => c.ativa);
  const catsEntrada = (categorias.data ?? []).filter((c) => c.ativa && c.tipo === 'entrada');
  const [rec, setRec] = useState({ conta: '', forma: 'pix', data: hojeSP(), categoria: '' });
  const [idNovo] = useState(() => crypto.randomUUID()); // repetir o toque não duplica a entrada
  const contaRec = rec.conta || contasAtivas[0]?.id || '';
  const catRec = rec.categoria || catsEntrada.find((c) => /mensalidade|contribui/i.test(c.nome))?.id || '';
  const mudar = useAcaoF4('mudar_mensalidade');
  const [modo, setModo] = useState<'pix' | 'baixa' | 'dispensar'>('pix');
  const filtro = useMemo(() => ({ tipo: 'entrada' as const, situacao: 'realizada' as const, inicio: somarDias(hojeSP(), -120) }), []);
  const entradas = useLancamentos(filtro);
  const [lanc, setLanc] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const usadas = new Set((mens.data ?? []).map((x) => x.lancamento_id).filter(Boolean));
  const lista = (entradas.data?.pages.flat() ?? []).filter((l) => !l.estorno_de && !l.estornado && !usadas.has(l.id));
  const podeBaixa = pode(perfil, 'financeiro', 'editar');
  async function darBaixa() {
    setErro(null);
    try { await baixa.mutateAsync({ p_id: m.id, p_lancamento: lanc }); toast.success('Mensalidade paga'); aoFechar(); } catch (e) { setErro(erroMsg(e)); }
  }
  async function receberAgora() {
    setErro(null);
    try {
      await receber.mutateAsync({ p_id: m.id, p_lancamento: idNovo, p_conta: contaRec, p_data: rec.data, p_forma: rec.forma, p_categoria: catRec });
      toast.success('Mensalidade paga e entrada lançada no Dinheiro'); aoFechar();
    } catch (e) { setErro(erroMsg(e)); }
  }
  async function mudarPara(s: 'aberta' | 'dispensada' | 'cancelada') {
    setErro(null);
    try { await mudar.mutateAsync({ p_id: m.id, p_situacao: s, p_motivo: s === 'aberta' ? null : motivo.trim() }); toast.success(s === 'aberta' ? 'Mensalidade reaberta' : 'Mensalidade atualizada'); aoFechar(); }
    catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo={`${nome} — ${mesTitulo(m.competencia)}`}
      descricao={`${NOME_SITUACAO_MENS[m.situacao]} · ${formatarBRL(m.valor)} · vencimento ${formatarData(m.vencimento)}`}>
      <div className="flex flex-col gap-5 pb-4">
        {m.situacao === 'aberta' && (
          <Segmentado rotulo="O que fazer" valor={modo} aoMudar={setModo} opcoes={[
            { valor: 'pix', rotulo: 'Cobrar' },
            ...(podeBaixa ? [{ valor: 'baixa' as const, rotulo: 'Dar baixa' }] : []),
            ...(pode(perfil, 'pessoas', 'editar') ? [{ valor: 'dispensar' as const, rotulo: 'Dispensar' }] : []),
          ]} />
        )}
        {m.situacao === 'aberta' && modo === 'pix' && (pix.data
          ? <CobrancaPix config={pix.data} valor={m.valor} txid={m.txid} descricao={`Mensalidade ${mesTitulo(m.competencia)}`} />
          : <Vazio icone={QrCode} titulo="Chave Pix não cadastrada" descricao="A tesouraria cadastra a chave Pix da Associação Exemplo em Pessoas › Mensalidades › Configurar a mensalidade." />)}
        {m.situacao === 'aberta' && modo === 'baixa' && (
          <Segmentado rotulo="Como dar baixa" valor={jeito} aoMudar={setJeito} opcoes={[{ valor: 'agora', rotulo: 'Recebi agora' }, { valor: 'ligar', rotulo: 'Já está no Dinheiro' }]} />
        )}
        {m.situacao === 'aberta' && modo === 'baixa' && jeito === 'agora' && (
          <FieldGroup>
            <div className="grid grid-cols-2 gap-3">
              <Field><FieldLabel htmlFor="mn-conta">Conta</FieldLabel>
                <Select value={contaRec} onValueChange={(v) => setRec((x) => ({ ...x, conta: v }))}><SelectTrigger id="mn-conta"><SelectValue placeholder="Escolha" /></SelectTrigger>
                  <SelectContent><SelectGroup>{contasAtivas.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
              <Field><FieldLabel htmlFor="mn-forma">Forma</FieldLabel>
                <Select value={rec.forma} onValueChange={(v) => setRec((x) => ({ ...x, forma: v }))}><SelectTrigger id="mn-forma"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>{[['pix', 'Pix'], ['dinheiro', 'Dinheiro'], ['transferencia', 'Transferência'], ['boleto', 'Boleto'], ['cartao_debito', 'Cartão de débito']].map(([v, n]) => <SelectItem key={v} value={v!}>{n}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
              <Field><FieldLabel htmlFor="mn-data">Data</FieldLabel><Input id="mn-data" type="date" max={hojeSP()} value={rec.data} onChange={(e) => setRec((x) => ({ ...x, data: e.target.value }))} /></Field>
              <Field><FieldLabel htmlFor="mn-cat">Categoria</FieldLabel>
                <Select value={catRec} onValueChange={(v) => setRec((x) => ({ ...x, categoria: v }))}><SelectTrigger id="mn-cat"><SelectValue placeholder="Escolha" /></SelectTrigger>
                  <SelectContent><SelectGroup>{catsEntrada.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
            </div>
            <FieldDescription>O sistema lança a entrada de {formatarBRL(m.valor)} no Dinheiro e marca a mensalidade como paga, numa ação só.</FieldDescription>
            <Button size="lg" disabled={!contaRec || !catRec || !rec.data || receber.isPending} onClick={() => void receberAgora()}>{receber.isPending && <Spinner data-icon="inline-start" />}Marcar como paga</Button>
          </FieldGroup>
        )}
        {m.situacao === 'aberta' && modo === 'baixa' && jeito === 'ligar' && (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="mn-lanc">Entrada no Dinheiro</FieldLabel>
              <Select value={lanc} onValueChange={setLanc}>
                <SelectTrigger id="mn-lanc"><SelectValue placeholder={lista.length ? 'Escolha a entrada' : 'Lance a entrada no Dinheiro primeiro'} /></SelectTrigger>
                <SelectContent><SelectGroup>{lista.slice(0, 80).map((l) => <SelectItem key={l.id} value={l.id}>{formatarData(l.data)} · {formatarBRL(l.valor)} · {l.descricao.slice(0, 40)}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
              <FieldDescription>Use quando a entrada já veio do extrato do banco ou foi lançada antes. Uma entrada paga uma mensalidade só.</FieldDescription>
            </Field>
            <Button size="lg" disabled={!lanc || baixa.isPending} onClick={() => void darBaixa()}>{baixa.isPending && <Spinner data-icon="inline-start" />}Dar baixa</Button>
          </FieldGroup>
        )}
        {m.situacao === 'aberta' && modo === 'dispensar' && (
          <FieldGroup>
            <Field><FieldLabel htmlFor="mn-motivo">Motivo</FieldLabel>
              <Input id="mn-motivo" name="mn-motivo" maxLength={300} autoComplete="off" placeholder="Ex.: atleta bolsista neste mês…" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={motivo.trim().length < 3 || mudar.isPending} onClick={() => void mudarPara('dispensada')}>Dispensar</Button>
              <Button variant="secondary" className="text-destructive" disabled={motivo.trim().length < 3 || mudar.isPending} onClick={() => void mudarPara('cancelada')}>Cancelar cobrança</Button>
            </div>
          </FieldGroup>
        )}
        {m.situacao !== 'aberta' && (
          <Grupo>
            <Linha icone={BadgeCheck} cor={corMensalidade(m)} titulo={NOME_SITUACAO_MENS[m.situacao]} descricao={m.pago_em ? `Paga em ${formatarData(m.pago_em)}` : m.motivo ?? undefined} />
            {m.lancamento_id && pode(perfil, 'financeiro', 'ver') && <Linha icone={Wallet} cor="verde" titulo="Ver a entrada no Dinheiro" para={`/dinheiro/lancamento/${m.lancamento_id}`} />}
            {(m.situacao !== 'paga' ? pode(perfil, 'pessoas', 'editar') : podeBaixa) && (
              <Linha icone={Undo2} cor="cinza" titulo="Reabrir a mensalidade" descricao={m.situacao === 'paga' ? 'Desfaz a baixa; a entrada continua no Dinheiro.' : undefined}
                aoTocar={() => void mudarPara('aberta')} desabilitada={mudar.isPending} />
            )}
          </Grupo>
        )}
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </div>
    </Folha>
  );
}

export function FormPessoa({ pessoa, aoFechar }: { pessoa: Pessoa | null; aoFechar: () => void }) {
  const categorias = useCategoriasSocio();
  const rotuloCat = useRotuloCategoria();
  const salvar = useAcaoF4('salvar_pessoa');
  const navegar = useNavigate();
  const [id] = useState(() => pessoa?.id ?? crypto.randomUUID());
  const [f, setF] = useState(() => ({
    nome: pessoa?.nome ?? '', atleta: pessoa?.atleta ?? true, associado: pessoa?.associado ?? false, categoria_id: pessoa?.categoria_id ?? '',
    situacao: pessoa?.situacao ?? 'ativo' as SituacaoPessoa, data_nascimento: pessoa?.data_nascimento ?? '', email: pessoa?.email ?? '', telefone: pessoa?.telefone ?? '',
    responsavel_nome: pessoa?.responsavel_nome ?? '', responsavel_contato: pessoa?.responsavel_contato ?? '', responsavel_parentesco: pessoa?.responsavel_parentesco ?? '',
    observacao: pessoa?.observacao ?? '',
  }));
  const [erro, setErro] = useState<string | null>(null);
  // só no cadastro novo de atleta: ficha e foto 3x4 (a foto pede a autorização de imagem)
  const [ficha, setFicha] = useState(() => fichaInicial());
  const [foto, setFoto] = useState<File | null>(null);
  const [autorizou, setAutorizou] = useState(false);
  const qc = useQueryClient();
  const muda = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const menor = menorDeIdade(f.data_nascimento || null);
  const extras = !pessoa && f.atleta;
  async function enviar() {
    setErro(null);
    const t = (v: string) => v.trim() || null;
    try {
      await salvar.mutateAsync({ p: { id, nome: f.nome.trim(), atleta: f.atleta, associado: f.associado, categoria_id: f.categoria_id || null, situacao: f.situacao,
        data_nascimento: f.data_nascimento || null, email: t(f.email)?.toLowerCase() ?? null, telefone: t(f.telefone), responsavel_nome: t(f.responsavel_nome),
        responsavel_contato: t(f.responsavel_contato), responsavel_parentesco: t(f.responsavel_parentesco), observacao: t(f.observacao) } });
      if (extras) {
        const falhas: string[] = [];
        if (!fichaVazia(ficha)) await fonte().rpc('salvar_ficha_atleta', { p_pessoa: id, p: fichaParaEnvio(ficha) }).catch(() => falhas.push('a ficha'));
        if (foto && autorizou) {
          await fonte().rpc('registrar_consentimento', { p: { id: crypto.randomUUID(), pessoa_id: id, finalidade: 'imagem', base_legal: 'consentimento',
            concedido_por: menor ? 'responsavel' : 'titular', nome_concedente: menor ? f.responsavel_nome.trim() : f.nome.trim(), concedido_em: hojeSP() } })
            .then(() => enviarFoto(id, foto)).catch(() => falhas.push('a foto'));
        }
        void qc.invalidateQueries({ queryKey: chavesF4.pessoas }); void qc.invalidateQueries({ queryKey: ['consentimentos'] });
        if (falhas.length) toast.error(`Pessoa cadastrada, mas não deu para salvar ${falhas.join(' e ')}. Tente de novo na página dela.`);
      }
      toast.success(pessoa ? 'Cadastro atualizado' : 'Pessoa cadastrada');
      aoFechar();
      if (!pessoa) navegar(`/pessoas/${id}`);
    } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo={pessoa ? 'Editar cadastro' : 'Cadastrar pessoa'} larga
      descricao="Só o necessário. Dados de saúde ficam na área própria, nunca aqui."
      rodape={<Button size="lg" className="w-full" disabled={f.nome.trim().length < 2 || (!f.atleta && !f.associado) || salvar.isPending || (extras && (!fichaValida(ficha) || (!!foto && !autorizou)))} onClick={() => void enviar()}>
        {salvar.isPending && <Spinner data-icon="inline-start" />}{pessoa ? 'Salvar mudanças' : 'Cadastrar'}</Button>}>
      <FieldGroup className="pb-2">
        <Field><FieldLabel htmlFor="ps-nome">Nome completo</FieldLabel>
          <Input id="ps-nome" name="ps-nome" maxLength={120} autoComplete="off" value={f.nome} onChange={(e) => muda({ nome: e.target.value })} /></Field>
        <FieldSet>
          <FieldLegend variant="label">Vínculo</FieldLegend>
          <div className="flex flex-wrap gap-5">
            <label className="flex items-center gap-2 text-[17px]"><Checkbox checked={f.atleta} onCheckedChange={(c) => muda({ atleta: c === true })} />Atleta</label>
            <label className="flex items-center gap-2 text-[17px]"><Checkbox checked={f.associado} onCheckedChange={(c) => muda({ associado: c === true })} />Associado</label>
          </div>
        </FieldSet>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="ps-cat">Categoria (mensalidade)</FieldLabel>
            <Select value={f.categoria_id || 'nenhuma'} onValueChange={(v) => muda({ categoria_id: v === 'nenhuma' ? '' : v })}>
              <SelectTrigger id="ps-cat"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="nenhuma">Sem mensalidade</SelectItem>
                {(categorias.data ?? []).filter((c) => c.ativa || c.id === f.categoria_id).map((c) => <SelectItem key={c.id} value={c.id}>{c.nome} · {rotuloCat(c)}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field><FieldLabel htmlFor="ps-nasc">Nascimento</FieldLabel>
            <Input id="ps-nasc" name="ps-nasc" type="date" max={hojeSP()} value={f.data_nascimento} onChange={(e) => muda({ data_nascimento: e.target.value })} /></Field>
        </div>
        {pessoa && (
          <Field>
            <FieldLabel htmlFor="ps-sit">Situação</FieldLabel>
            <Select value={f.situacao} onValueChange={(v) => muda({ situacao: v as SituacaoPessoa })}>
              <SelectTrigger id="ps-sit"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{(['ativo', 'inativo', 'desligado'] as const).map((s) => <SelectItem key={s} value={s}>{NOME_SITUACAO_PESSOA[s]}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
            {f.situacao === 'desligado' && pessoa.situacao !== 'desligado' && <FieldDescription>Desligar cancela as mensalidades em aberto que ainda não venceram. Os contatos são apagados depois do prazo de guarda.</FieldDescription>}
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field><FieldLabel htmlFor="ps-tel">Telefone (opcional)</FieldLabel>
            <Input id="ps-tel" name="ps-tel" type="tel" inputMode="tel" autoComplete="off" maxLength={20} placeholder="(11) 90000-0000" value={f.telefone} onChange={(e) => muda({ telefone: e.target.value })} /></Field>
          <Field><FieldLabel htmlFor="ps-email">E-mail (opcional)</FieldLabel>
            <Input id="ps-email" name="ps-email" type="email" autoComplete="off" spellCheck={false} maxLength={254} value={f.email} onChange={(e) => muda({ email: e.target.value })} /></Field>
        </div>
        <FieldSet>
          <FieldLegend variant="label">Responsável legal {menor ? '(obrigatório: menor de idade)' : '(se houver)'}</FieldLegend>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field><FieldLabel htmlFor="ps-rn">Nome</FieldLabel><Input id="ps-rn" name="ps-rn" maxLength={120} autoComplete="off" value={f.responsavel_nome} onChange={(e) => muda({ responsavel_nome: e.target.value })} /></Field>
            <Field><FieldLabel htmlFor="ps-rc">Contato</FieldLabel><Input id="ps-rc" name="ps-rc" maxLength={120} autoComplete="off" value={f.responsavel_contato} onChange={(e) => muda({ responsavel_contato: e.target.value })} /></Field>
            <Field><FieldLabel htmlFor="ps-rp">Parentesco</FieldLabel><Input id="ps-rp" name="ps-rp" maxLength={40} autoComplete="off" placeholder="mãe, pai, tutor…" value={f.responsavel_parentesco} onChange={(e) => muda({ responsavel_parentesco: e.target.value })} /></Field>
          </div>
          {menor && <FieldDescription>Para menores de 18 anos, autorizações (imagem, saúde, termo de equipamento) são dadas pelo responsável.</FieldDescription>}
        </FieldSet>
        {extras && (
          <FieldSet>
            <FieldLegend variant="label">Ficha do atleta (opcional)</FieldLegend>
            <CamposFicha f={ficha} muda={(x) => setFicha((v) => ({ ...v, ...x }))} />
          </FieldSet>
        )}
        {extras && (
          <FieldSet>
            <FieldLegend variant="label">Foto 3x4 (opcional)</FieldLegend>
            <CampoArquivo arquivo={foto} aoEscolher={setFoto} id="ps-foto" somenteImagem rotulo="Escolher ou tirar foto" />
            {foto && (
              <label htmlFor="ps-autoriza" className="flex min-h-11 cursor-pointer items-start gap-3 text-[15px]">
                <Checkbox id="ps-autoriza" className="mt-0.5" checked={autorizou} onCheckedChange={(v) => setAutorizou(v === true)} />
                <span>{menor ? 'O responsável' : 'O atleta'} autorizou o uso da imagem no cadastro<span className="text-muted-foreground block text-[13px]">Fica registrado em Autorizações e pode ser revogado; revogou, a foto é apagada.</span></span>
              </label>
            )}
          </FieldSet>
        )}
        <Field><FieldLabel htmlFor="ps-obs">Observação (opcional)</FieldLabel>
          <Textarea id="ps-obs" name="ps-obs" rows={2} maxLength={500} value={f.observacao} onChange={(e) => muda({ observacao: e.target.value })} />
          <FieldDescription>Não escreva aqui informação de saúde ou deficiência.</FieldDescription></Field>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

export function DetalhePessoa() {
  const { id = '' } = useParams();
  const perfil = usePerfil();
  const pessoas = usePessoas();
  const categorias = useCategoriasSocio();
  const rotuloCat = useRotuloCategoria();
  const mens = useMensalidades(id);
  const [folha, setFolha] = useState<null | 'editar' | { mensalidade: Mensalidade }>(null);
  const p = pessoas.data?.find((x) => x.id === id);
  const voltar = { para: '/pessoas', rotulo: 'Pessoas' };
  if (pessoas.isPending) return <Pagina titulo="Pessoa" voltar={voltar}><CarregandoLista /></Pagina>;
  if (!p) return <Pagina titulo="Pessoa" voltar={voltar}><Vazio icone={UserRound} titulo="Cadastro não encontrado" descricao="Ele pode não estar visível para você." /></Pagina>;
  const i = idade(p.data_nascimento);
  const cat = categorias.data?.find((c) => c.id === p.categoria_id);
  const menor = menorDeIdade(p.data_nascimento);
  return (
    <Pagina titulo={p.nome} voltar={voltar} acoes={pode(perfil, 'pessoas', 'editar') ? <Button variant="ghost" size="sm" onClick={() => setFolha('editar')}>Editar</Button> : undefined}>
      <Grupo>
        <Linha icone={BadgeCheck} cor={p.situacao === 'ativo' ? 'verde' : 'cinza'} titulo={[p.atleta && 'Atleta', p.associado && 'Associado'].filter(Boolean).join(' e ')}
          descricao={[NOME_SITUACAO_PESSOA[p.situacao], p.desligado_em && `desde ${formatarData(p.desligado_em)}`].filter(Boolean).join(' ')} />
        {i !== null && <Linha icone={CalendarCheck2} cor="indigo" titulo={`${i} anos`} descricao={`Nascimento em ${formatarData(p.data_nascimento)}`} />}
        <Linha icone={Wallet} cor="teal" titulo={cat ? cat.nome : 'Categoria'} descricao={cat ? rotuloCat(cat) : 'Sem mensalidade'} />
        {p.telefone && <Linha icone={Phone} cor="verde" titulo={formatarTelefone(p.telefone)} />}
        {p.email && <Linha icone={Mail} cor="azul" titulo={p.email} />}
        {(p.responsavel_nome || menor) && (
          <Linha icone={Baby} cor={p.responsavel_nome ? 'laranja' : 'vermelho'} titulo={p.responsavel_nome ? `Responsável: ${p.responsavel_nome}` : 'Menor de idade sem responsável'}
            descricao={[p.responsavel_parentesco, p.responsavel_contato].filter(Boolean).join(' · ') || undefined} />
        )}
      </Grupo>
      {p.observacao && <p className="bg-card rounded-[14px] p-4 text-[15px] whitespace-pre-wrap">{p.observacao}</p>}
      {p.atleta && <FotoAtleta pessoa={p} />}
      {p.atleta && <FichaEsportiva pessoa={p} />}

      <Grupo titulo="Mensalidades">
        {(mens.data ?? []).length === 0 && <Linha titulo="Nenhuma mensalidade" descricao={cat ? 'São criadas em Pessoas → Mensalidades.' : 'Escolha uma categoria para cobrar mensalidade.'} />}
        {(mens.data ?? []).slice(0, 12).map((m) => (
          <Linha key={m.id} icone={Wallet} cor={corMensalidade(m)} titulo={mesTitulo(m.competencia)} aoTocar={() => setFolha({ mensalidade: m })} seta
            descricao={NOME_SITUACAO_MENS[m.situacao] + (m.situacao === 'aberta' ? ` · vence ${formatarData(m.vencimento)}` : '')}
            valor={<Valor valor={m.valor} className="text-foreground text-[15px]" />} />
        ))}
      </Grupo>

      {cat?.percentual_parcela_unica != null && p.associado && <ParcelaUnicaDaPessoa pessoa={p} categoria={cat} />}
      {p.atleta && pode(perfil, 'agenda', 'ver') && <Frequencia pessoa={p.id} />}
      <DocumentosDaPessoa pessoa={p} />
      <Autorizacoes pessoa={p} />
      {pode(perfil, 'saude', 'ver') && p.atleta && <AreaSaude pessoa={p} />}
      {pode(perfil, 'patrimonio', 'ver') && <BensComAPessoa pessoa={p.id} />}

      {folha === 'editar' && <FormPessoa pessoa={p} aoFechar={() => setFolha(null)} />}
      {folha && typeof folha === 'object' && <FolhaMensalidade mensalidade={folha.mensalidade} nome={p.nome} aoFechar={() => setFolha(null)} />}
    </Pagina>
  );
}

function Frequencia({ pessoa }: { pessoa: string }) {
  const fim = hojeSP(), ini = somarDias(fim, -90);
  const f = useFrequencia(ini, fim);
  const meu = f.data?.find((x) => x.pessoa_id === pessoa);
  if (!f.data) return null;
  return (
    <Grupo titulo="Presença nos últimos 90 dias" rodape="Marcada na agenda, no treino ou jogo.">
      <Linha icone={CalendarCheck2} cor="azul" titulo={meu ? `${meu.presentes} de ${meu.marcados}` : 'Nenhuma presença marcada'}
        valor={meu && meu.marcados > 0 ? `${Math.round((meu.presentes / meu.marcados) * 100)}%` : undefined} />
    </Grupo>
  );
}

function BensComAPessoa({ pessoa }: { pessoa: string }) {
  const emp = useEmprestimos();
  const bens = useBens();
  const abertos = (emp.data ?? []).filter((e) => e.pessoa_id === pessoa && !e.devolvido_em);
  if (!abertos.length) return null;
  return (
    <Grupo titulo="Bens emprestados">
      {abertos.map((e) => { const b = bens.data?.find((x) => x.id === e.bem_id); return (
        <Linha key={e.id} icone={FileText} cor="azul" titulo={b ? `${b.numero} — ${b.nome}` : 'Bem'} para={`/patrimonio/${e.bem_id}`}
          descricao={`Desde ${formatarData(e.inicio)}${e.previsao_devolucao ? ` · devolver até ${formatarData(e.previsao_devolucao)}` : ''}`} />
      ); })}
    </Grupo>
  );
}

function DocumentosDaPessoa({ pessoa }: { pessoa: Pessoa }) {
  const perfil = usePerfil();
  const docs = useDocumentosPessoa(pessoa.id);
  const salvar = useAcaoF4('salvar_documento_pessoa');
  const [novo, setNovo] = useState(false);
  const editar = pode(perfil, 'pessoas', 'editar');
  const ativos = (docs.data ?? []).filter((d) => !d.arquivado_em);
  return (
    <Grupo titulo="Documentos" acao={editar ? <Button variant="link" size="xs" onClick={() => setNovo(true)}>Adicionar</Button> : undefined}
      rodape="Autorização de imagem, termo de equipamento e outros. Fotos são enviadas sem localização (GPS).">
      {ativos.length === 0 && <Linha titulo="Nenhum documento" />}
      {ativos.map((d) => {
        const v = estadoValidade(d.validade);
        const rotulo = d.descricao ?? NOME_DOC_PESSOA[d.tipo];
        return (
          <Linha key={d.id} icone={IdCard} cor={v ? COR_VALIDADE[v] : 'teal'} titulo={rotulo}
            descricao={[d.validade && `${v === 'vencido' ? 'venceu' : 'vale até'} ${formatarData(d.validade)}`, d.entregue_em && `entregue em ${formatarData(d.entregue_em)}`, !d.arquivo_caminho && 'sem arquivo'].filter(Boolean).join(' · ') || undefined}
            valor={<span className="flex items-center gap-1">
              {d.arquivo_caminho && <AbrirDocumento area="pessoa" caminho={d.arquivo_caminho} rotulo={rotulo} />}
              {editar && <AnexarDocumento area="pessoa" documentoId={d.id} rotulo={rotulo} temArquivo={!!d.arquivo_caminho} invalida={[chavesF4.docsPessoa(pessoa.id)]} />}
              {editar && <Button size="icon-sm" variant="ghost" aria-label={`Arquivar: ${rotulo}`} disabled={salvar.isPending}
                onClick={() => salvar.mutate({ p: { id: d.id, pessoa_id: d.pessoa_id, tipo: d.tipo, descricao: d.descricao, validade: d.validade, entregue_em: d.entregue_em, arquivar: true } },
                  { onSuccess: () => toast.success('Documento arquivado'), onError: (e) => toast.error(erroMsg(e)) })}><Trash2 aria-hidden="true" /></Button>}
            </span>} />
        );
      })}
      {novo && <FormDocumentoPessoa pessoa={pessoa.id} aoFechar={() => setNovo(false)} />}
    </Grupo>
  );
}

function FormDocumentoPessoa({ pessoa, aoFechar }: { pessoa: string; aoFechar: () => void }) {
  const qc = useQueryClient();
  const salvar = useAcaoF4('salvar_documento_pessoa');
  const [id] = useState(() => crypto.randomUUID());
  const [tipo, setTipo] = useState<TipoDocumentoPessoa>('autorizacao_imagem');
  const [descricao, setDescricao] = useState('');
  const [validade, setValidade] = useState('');
  const [entregue, setEntregue] = useState(hojeSP());
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  async function enviar() {
    setErro(null);
    try {
      await salvar.mutateAsync({ p: { id, pessoa_id: pessoa, tipo, descricao: descricao.trim() || null, validade: validade || null, entregue_em: entregue || null } });
      if (arquivo) await enviarDocumento('pessoa', id, arquivo).then(() => qc.invalidateQueries({ queryKey: chavesF4.docsPessoa(pessoa) }));
      toast.success(arquivo ? 'Documento registrado com o arquivo' : 'Documento registrado'); aoFechar();
    } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo="Novo documento"
      rodape={<Button size="lg" className="w-full" disabled={salvar.isPending} onClick={() => void enviar()}>{salvar.isPending && <Spinner data-icon="inline-start" />}Registrar</Button>}>
      <FieldGroup className="pb-2">
        <Field>
          <FieldLabel htmlFor="dp-tipo">Tipo</FieldLabel>
          <Select value={tipo} onValueChange={(v) => setTipo(v as TipoDocumentoPessoa)}>
            <SelectTrigger id="dp-tipo"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{(Object.keys(NOME_DOC_PESSOA) as TipoDocumentoPessoa[]).filter((t) => t !== 'registro_federacao').map((t) => <SelectItem key={t} value={t}>{NOME_DOC_PESSOA[t]}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        </Field>
        <Field><FieldLabel htmlFor="dp-desc">Descrição (opcional)</FieldLabel><Input id="dp-desc" name="dp-desc" maxLength={200} autoComplete="off" value={descricao} onChange={(e) => setDescricao(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field><FieldLabel htmlFor="dp-val">Validade (opcional)</FieldLabel><Input id="dp-val" name="dp-val" type="date" value={validade} onChange={(e) => setValidade(e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="dp-ent">Entregue em</FieldLabel><Input id="dp-ent" name="dp-ent" type="date" max={hojeSP()} value={entregue} onChange={(e) => setEntregue(e.target.value)} /></Field>
        </div>
        <CampoArquivo id="dp-arq" arquivo={arquivo} aoEscolher={setArquivo} />
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

const NOME_FINALIDADE: Record<FinalidadeConsentimento, string> = { imagem: 'Uso de imagem', saude: 'Dados de saúde' };

function Autorizacoes({ pessoa }: { pessoa: Pessoa }) {
  const perfil = usePerfil();
  const lista = useConsentimentos(pessoa.id);
  const revogar = useAcaoF4('revogar_consentimento');
  const [nova, setNova] = useState(false);
  const veSaude = pode(perfil, 'saude', 'ver');
  const itens = (lista.data ?? []).filter((c) => c.finalidade !== 'saude' || veSaude);
  const podeRegistrar = pode(perfil, 'pessoas', 'editar');
  async function revogarUma(c: Consentimento) {
    try { await revogar.mutateAsync({ p_id: c.id }); toast.success(c.finalidade === 'saude' && c.base_legal === 'consentimento' ? 'Autorização revogada. Os dados de saúde foram apagados.' : 'Autorização revogada'); }
    catch (e) { toast.error(erroMsg(e)); }
  }
  return (
    <Grupo titulo="Autorizações (LGPD)" acao={podeRegistrar ? <Button variant="link" size="xs" onClick={() => setNova(true)}>Registrar</Button> : undefined}
      rodape="Revogar a autorização de saúde apaga os dados de saúde guardados (quando a base é o consentimento).">
      {itens.length === 0 && <Linha titulo="Nenhuma autorização registrada" />}
      {itens.map((c) => (
        <Linha key={c.id} icone={ShieldCheck} cor={c.revogado_em ? 'cinza' : 'verde'} titulo={NOME_FINALIDADE[c.finalidade]}
          descricao={c.revogado_em ? `Revogada em ${formatarData(c.revogado_em)}`
            : `${c.base_legal === 'exigencia_esportiva' ? 'Exigência esportiva' : 'Consentimento'} de ${c.nome_concedente}${c.concedido_por === 'responsavel' ? ' (responsável)' : ''} · ${formatarData(c.concedido_em)}`}
          valor={!c.revogado_em && podeRegistrar && (c.finalidade !== 'saude' || pode(perfil, 'saude', 'editar'))
            ? <Button size="sm" variant="ghost" className="text-destructive" disabled={revogar.isPending} onClick={() => void revogarUma(c)}>Revogar</Button> : undefined} />
      ))}
      {nova && <FormAutorizacao pessoa={pessoa} aoFechar={() => setNova(false)} />}
    </Grupo>
  );
}

function FormAutorizacao({ pessoa, aoFechar }: { pessoa: Pessoa; aoFechar: () => void }) {
  const perfil = usePerfil();
  const registrar = useAcaoF4('registrar_consentimento');
  const menor = menorDeIdade(pessoa.data_nascimento);
  const [id] = useState(() => crypto.randomUUID());
  const [finalidade, setFinalidade] = useState<FinalidadeConsentimento>('imagem');
  const [base, setBase] = useState<'consentimento' | 'exigencia_esportiva'>('consentimento');
  const [nome, setNome] = useState(menor ? pessoa.responsavel_nome ?? '' : pessoa.nome);
  const [data, setData] = useState(hojeSP());
  const [erro, setErro] = useState<string | null>(null);
  const podeSaude = pode(perfil, 'saude', 'editar');
  async function enviar() {
    setErro(null);
    try {
      await registrar.mutateAsync({ p: { id, pessoa_id: pessoa.id, finalidade, base_legal: finalidade === 'imagem' ? 'consentimento' : base,
        concedido_por: menor ? 'responsavel' : 'titular', nome_concedente: nome.trim(), concedido_em: data } });
      toast.success('Autorização registrada'); aoFechar();
    } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo="Registrar autorização"
      descricao={menor ? 'Menor de idade: quem autoriza é o responsável legal.' : 'Guarde o papel assinado como documento da pessoa.'}
      rodape={<Button size="lg" className="w-full" disabled={nome.trim().length < 2 || !data || registrar.isPending} onClick={() => void enviar()}>{registrar.isPending && <Spinner data-icon="inline-start" />}Registrar</Button>}>
      <FieldGroup className="pb-2">
        <Field>
          <FieldLabel htmlFor="au-fin">Para quê</FieldLabel>
          <Select value={finalidade} onValueChange={(v) => setFinalidade(v as FinalidadeConsentimento)}>
            <SelectTrigger id="au-fin"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>
              <SelectItem value="imagem">{NOME_FINALIDADE.imagem}</SelectItem>
              {podeSaude && <SelectItem value="saude">{NOME_FINALIDADE.saude}</SelectItem>}
            </SelectGroup></SelectContent>
          </Select>
          {!podeSaude && <FieldDescription>Autorização de saúde só é registrada por quem cuida da área de saúde.</FieldDescription>}
        </Field>
        {finalidade === 'saude' && (
          <Field>
            <FieldLabel htmlFor="au-base">Base legal</FieldLabel>
            <Select value={base} onValueChange={(v) => setBase(v as typeof base)}>
              <SelectTrigger id="au-base"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="consentimento">Consentimento específico</SelectItem>
                <SelectItem value="exigencia_esportiva">Exigência da entidade esportiva (classificação, laudo)</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
            <FieldDescription>⚖️ Confirme com a assessoria jurídica qual base vale para cada documento.</FieldDescription>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field><FieldLabel htmlFor="au-nome">{menor ? 'Nome do responsável' : 'Nome de quem autoriza'}</FieldLabel>
            <Input id="au-nome" name="au-nome" maxLength={120} autoComplete="off" value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="au-data">Data</FieldLabel><Input id="au-data" name="au-data" type="date" max={hojeSP()} value={data} onChange={(e) => setData(e.target.value)} /></Field>
        </div>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

/** Área de saúde: só aparece com o módulo "saude"; sem autorização ativa o banco recusa gravar. */
function AreaSaude({ pessoa }: { pessoa: Pessoa }) {
  const perfil = usePerfil();
  const consent = useConsentimentos(pessoa.id);
  const ativo = (consent.data ?? []).some((c) => c.finalidade === 'saude' && !c.revogado_em);
  const saude = useSaude(pessoa.id, ativo);
  const docs = useDocumentosSaude(pessoa.id, ativo);
  const remover = useAcaoF4('salvar_documento_saude');
  const [folha, setFolha] = useState<null | 'dados' | 'doc'>(null);
  const editar = pode(perfil, 'saude', 'editar');
  if (consent.isPending) return null;
  return (
    <Grupo titulo="Área de saúde (restrita)" acao={ativo && editar ? <Button variant="link" size="xs" onClick={() => setFolha('dados')}>Editar</Button> : undefined}
      rodape="Só quem tem o módulo de saúde vê esta parte. Nada daqui vai para a agenda, avisos ou e-mails.">
      {!ativo ? <Linha icone={HeartPulse} cor="cinza" titulo="Sem autorização de saúde" descricao="Registre a autorização em “Autorizações” para guardar dados de saúde." />
        : (
          <>
            <Linha icone={HeartPulse} cor="vermelho" titulo={saude.data?.classe_funcional ? `Classe funcional ${saude.data.classe_funcional}` : 'Classe funcional não informada'}
              descricao={saude.data?.deficiencia ?? undefined} />
            {saude.data?.observacoes && <Linha titulo="Observações" descricao={saude.data.observacoes} />}
            {(docs.data ?? []).map((d) => {
              const v = estadoValidade(d.validade);
              return (
                <Linha key={d.id} icone={FileText} cor={v ? COR_VALIDADE[v] : 'cinza'} titulo={NOME_DOC_SAUDE[d.tipo]}
                  descricao={[d.emitido_em && `emitido em ${formatarData(d.emitido_em)}`, d.validade && `vale até ${formatarData(d.validade)}`].filter(Boolean).join(' · ') || undefined}
                  valor={<span className="flex items-center gap-1">
                    {d.arquivo_caminho && <AbrirDocumento area="saude" caminho={d.arquivo_caminho} rotulo={NOME_DOC_SAUDE[d.tipo]} />}
                    {editar && <AnexarDocumento area="saude" documentoId={d.id} rotulo={NOME_DOC_SAUDE[d.tipo]} temArquivo={!!d.arquivo_caminho} invalida={[chavesF4.docsSaude(pessoa.id)]} />}
                    {editar && <Button size="icon-sm" variant="ghost" aria-label={`Apagar: ${NOME_DOC_SAUDE[d.tipo]}`} disabled={remover.isPending}
                      onClick={() => remover.mutate({ p: { id: d.id, pessoa_id: pessoa.id, remover: true } }, { onSuccess: () => toast.success('Documento apagado'), onError: (e) => toast.error(erroMsg(e)) })}>
                      <Trash2 aria-hidden="true" /></Button>}
                  </span>} />
              );
            })}
            {editar && <Linha icone={Plus} cor="cinza" titulo="Adicionar documento de saúde" aoTocar={() => setFolha('doc')} />}
          </>
        )}
      {folha === 'dados' && <FormSaude pessoa={pessoa.id} atual={saude.data ?? null} aoFechar={() => setFolha(null)} />}
      {folha === 'doc' && <FormDocumentoSaude pessoa={pessoa.id} aoFechar={() => setFolha(null)} />}
    </Grupo>
  );
}

function FormSaude({ pessoa, atual, aoFechar }: { pessoa: string; atual: { deficiencia: string | null; classe_funcional: string | null; observacoes: string | null } | null; aoFechar: () => void }) {
  const salvar = useAcaoF4('salvar_saude');
  const [def, setDef] = useState(atual?.deficiencia ?? '');
  const [classe, setClasse] = useState(atual?.classe_funcional ?? '');
  const [obs, setObs] = useState(atual?.observacoes ?? '');
  const [erro, setErro] = useState<string | null>(null);
  async function enviar() {
    setErro(null);
    try { await salvar.mutateAsync({ p_pessoa: pessoa, p: { deficiencia: def.trim() || null, classe_funcional: classe.trim() || null, observacoes: obs.trim() || null } }); toast.success('Dados de saúde salvos'); aoFechar(); }
    catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo="Dados de saúde" descricao="Só o que a modalidade exige."
      rodape={<Button size="lg" className="w-full" disabled={salvar.isPending} onClick={() => void enviar()}>{salvar.isPending && <Spinner data-icon="inline-start" />}Salvar</Button>}>
      <FieldGroup className="pb-2">
        <Field><FieldLabel htmlFor="sd-classe">Classe funcional</FieldLabel><Input id="sd-classe" name="sd-classe" maxLength={20} autoComplete="off" placeholder="Ex.: 2.5" value={classe} onChange={(e) => setClasse(e.target.value)} /></Field>
        <Field><FieldLabel htmlFor="sd-def">Deficiência (opcional)</FieldLabel><Input id="sd-def" name="sd-def" maxLength={300} autoComplete="off" value={def} onChange={(e) => setDef(e.target.value)} /></Field>
        <Field><FieldLabel htmlFor="sd-obs">Observações para o treino (opcional)</FieldLabel><Textarea id="sd-obs" name="sd-obs" rows={3} maxLength={1000} value={obs} onChange={(e) => setObs(e.target.value)} /></Field>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

function FormDocumentoSaude({ pessoa, aoFechar }: { pessoa: string; aoFechar: () => void }) {
  const qc = useQueryClient();
  const salvar = useAcaoF4('salvar_documento_saude');
  const [id] = useState(() => crypto.randomUUID());
  const [tipo, setTipo] = useState<TipoDocumentoSaude>('classificacao_funcional');
  const [emitido, setEmitido] = useState('');
  const [validade, setValidade] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  async function enviar() {
    setErro(null);
    try {
      await salvar.mutateAsync({ p: { id, pessoa_id: pessoa, tipo, emitido_em: emitido || null, validade: validade || null } });
      if (arquivo) await enviarDocumento('saude', id, arquivo).then(() => qc.invalidateQueries({ queryKey: chavesF4.docsSaude(pessoa) }));
      toast.success(arquivo ? 'Documento de saúde registrado com o arquivo' : 'Documento de saúde registrado'); aoFechar();
    } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo="Documento de saúde"
      rodape={<Button size="lg" className="w-full" disabled={salvar.isPending} onClick={() => void enviar()}>{salvar.isPending && <Spinner data-icon="inline-start" />}Registrar</Button>}>
      <FieldGroup className="pb-2">
        <Field>
          <FieldLabel htmlFor="ds-tipo">Tipo</FieldLabel>
          <Select value={tipo} onValueChange={(v) => setTipo(v as TipoDocumentoSaude)}>
            <SelectTrigger id="ds-tipo"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{(Object.keys(NOME_DOC_SAUDE) as TipoDocumentoSaude[]).map((t) => <SelectItem key={t} value={t}>{NOME_DOC_SAUDE[t]}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field><FieldLabel htmlFor="ds-emit">Emitido em</FieldLabel><Input id="ds-emit" name="ds-emit" type="date" max={hojeSP()} value={emitido} onChange={(e) => setEmitido(e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="ds-val">Validade</FieldLabel><Input id="ds-val" name="ds-val" type="date" value={validade} onChange={(e) => setValidade(e.target.value)} /></Field>
        </div>
        <CampoArquivo id="ds-arq" arquivo={arquivo} aoEscolher={setArquivo} />
        <FieldDescription>Laudo, atestado ou classificação em PDF ou foto. Fica na área de saúde, só para quem tem permissão.</FieldDescription>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

export function CadastrosPessoas() {
  const perfil = usePerfil();
  const categorias = useCategoriasSocio();
  const salarios = useSalariosMinimos();
  const rotuloCat = useRotuloCategoria();
  const pix = useConfigPix();
  const [cat, setCat] = useState<CategoriaSocio | 'nova' | null>(null);
  const [salario, setSalario] = useState<SalarioMinimo | 'novo' | null>(null);
  const [editarPix, setEditarPix] = useState(false);
  const podeCat = pode(perfil, 'pessoas', 'editar');
  const hoje = hojeSP();
  return (
    <Pagina titulo="Mensalidade e Pix" voltar={{ para: '/pessoas?aba=mensalidades', rotulo: 'Pessoas' }}>
      <Grupo titulo="Categorias e mensalidade" acao={podeCat ? <Button variant="link" size="xs" onClick={() => setCat('nova')}>Adicionar</Button> : undefined}
        rodape="Vale para as mensalidades geradas daqui para a frente. As já geradas não mudam.">
        {(categorias.data ?? []).length === 0 && <Linha titulo="Nenhuma categoria" descricao="Ex.: Associado (1% do salário mínimo), Isento." />}
        {(categorias.data ?? []).map((c) => <Linha key={c.id} icone={Wallet} cor={c.ativa ? 'teal' : 'cinza'} titulo={c.nome}
          descricao={`${rotuloCat(c)} · vence dia ${c.dia_vencimento}${c.percentual_parcela_unica != null ? ` · parcela única ${formatarPercentual(c.percentual_parcela_unica)}` : ''}${c.ativa ? '' : ' · desativada'}`} aoTocar={podeCat ? () => setCat(c) : undefined} seta={podeCat} />)}
      </Grupo>
      <Grupo titulo="Salário mínimo" acao={podeCat ? <Button variant="link" size="xs" onClick={() => setSalario('novo')}>Novo reajuste</Button> : undefined}
        rodape={`Atualiza sozinho pela série oficial do Banco Central (o sistema confere o valor antes de gravar). Pelo estatuto, o aumento só entra na cobrança que vence ${DIAS_ANTECEDENCIA_AUMENTO} dias ou mais depois do reajuste.`}>
        {salarios.isPending ? <CarregandoLista /> : (salarios.data ?? []).length === 0
          ? <Linha icone={AlertTriangle} cor="laranja" titulo="Nenhum salário mínimo cadastrado" descricao="Sem ele, as categorias em porcentagem não geram mensalidade." />
          : (salarios.data ?? []).slice(0, 4).map((x) => (
            <Linha key={x.vigente_desde} icone={Landmark} cor={x.vigente_desde <= hoje ? 'verde' : 'cinza'} titulo={formatarBRL(x.valor)}
              descricao={`${x.vigente_desde <= hoje ? 'Vigente desde' : 'A partir de'} ${formatarData(x.vigente_desde)}`} aoTocar={podeCat ? () => setSalario(x) : undefined} seta={podeCat} />
          ))}
      </Grupo>
      <Grupo titulo="Chave Pix da Associação Exemplo" acao={pode(perfil, 'financeiro', 'administrar') ? <Button variant="link" size="xs" onClick={() => setEditarPix(true)}>{pix.data ? 'Trocar' : 'Cadastrar'}</Button> : undefined}
        rodape="Usada para gerar o “copia e cola” das mensalidades. Só a tesouraria muda; a mudança fica na auditoria.">
        {pix.data ? (
          <>
            <Linha icone={QrCode} cor="verde" titulo={pix.data.chave} descricao={`${pix.data.nome} · ${pix.data.cidade}`} />
          </>
        ) : <Linha icone={AlertTriangle} cor="laranja" titulo="Nenhuma chave cadastrada" />}
      </Grupo>
      {cat && <FormCategoria categoria={cat === 'nova' ? null : cat} aoFechar={() => setCat(null)} />}
      {salario && <FormSalarioMinimo atual={salario === 'novo' ? null : salario} aoFechar={() => setSalario(null)} />}
      {editarPix && <FormPix aoFechar={() => setEditarPix(false)} />}
    </Pagina>
  );
}

type ModoCategoria = 'percentual' | 'fixo';

function FormCategoria({ categoria, aoFechar }: { categoria: CategoriaSocio | null; aoFechar: () => void }) {
  const salvar = useAcaoF4('salvar_categoria_socio');
  const apagar = useAcaoF4('apagar_categoria_socio');
  async function excluir() {
    if (!categoria) return;
    setErro(null);
    try { await apagar.mutateAsync({ p_id: categoria.id }); toast.success('Categoria apagada'); aoFechar(); }
    catch (e) { setErro(erroMsg(e)); }
  }
  const salarios = useSalariosMinimos();
  const [id] = useState(() => categoria?.id ?? crypto.randomUUID());
  const [nome, setNome] = useState(categoria?.nome ?? '');
  // categoria nova já vem com 1% do salário mínimo
  const [modo, setModo] = useState<ModoCategoria>(categoria && categoria.percentual_salario_minimo == null ? 'fixo' : 'percentual');
  const [pct, setPct] = useState(categoria?.percentual_salario_minimo != null ? Number(categoria.percentual_salario_minimo).toLocaleString('pt-BR') : '1');
  const [valor, setValor] = useState(paraCampo(categoria?.valor_mensalidade) ?? '');
  // e com a parcela única de 10%; vazio = sem a opção
  const [pu, setPu] = useState(categoria ? (categoria.percentual_parcela_unica != null ? Number(categoria.percentual_parcela_unica).toLocaleString('pt-BR') : '') : '10');
  const [dia, setDia] = useState(String(categoria?.dia_vencimento ?? 10));
  const [ativa, setAtiva] = useState(categoria?.ativa ?? true);
  const [erro, setErro] = useState<string | null>(null);
  const pctNum = /^\d{1,3}([.,]\d{1,2})?$/.test(pct.trim()) ? Number(pct.trim().replace(',', '.')) : NaN;
  const diaNum = Math.min(28, Math.max(1, Number(dia) || 10));
  const previa = modo === 'percentual' && pctNum >= 0.01 && pctNum <= 100
    ? valorDaCategoria({ valor_mensalidade: '0', percentual_salario_minimo: pctNum.toFixed(2) }, salarios.data ?? [], proximoVencimento(hojeSP(), diaNum))
    : null;
  async function enviar() {
    setErro(null);
    let p: Record<string, unknown>;
    if (modo === 'percentual') {
      if (!(pctNum >= 0.01 && pctNum <= 100)) return setErro('Confira a porcentagem (de 0,01 a 100).');
      const puNum = pu.trim() === '' ? null : (/^\d{1,4}([.,]\d{1,2})?$/.test(pu.trim()) ? Number(pu.trim().replace(',', '.')) : NaN);
      if (puNum !== null && !(puNum >= 0.01 && puNum <= pctNum * 12)) return setErro('Confira a parcela única: precisa ser menor que 12 mensalidades.');
      p = { percentual_salario_minimo: pctNum.toFixed(2), ...(puNum !== null ? { percentual_parcela_unica: puNum.toFixed(2) } : {}) };
    } else {
      const v = valor.trim() === '' || valor.trim() === '0' || valor.trim() === '0,00' ? '0.00' : lerValorBRL(valor);
      if (!v) return setErro('Confira o valor.');
      p = { valor_mensalidade: v };
    }
    try { await salvar.mutateAsync({ p: { id, nome: nome.trim(), ...p, dia_vencimento: Number(dia), ativa } }); toast.success('Categoria salva'); aoFechar(); }
    catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo={categoria ? categoria.nome : 'Nova categoria'}
      rodape={<div className="flex w-full gap-2">
        {categoria && <Button size="lg" variant="secondary" aria-label="Apagar categoria" disabled={apagar.isPending || salvar.isPending} onClick={() => void excluir()}>{apagar.isPending ? <Spinner /> : <Trash2 aria-hidden="true" />}</Button>}
        <Button size="lg" className="flex-1" disabled={nome.trim().length < 2 || salvar.isPending} onClick={() => void enviar()}>{salvar.isPending && <Spinner data-icon="inline-start" />}Salvar</Button>
      </div>}>
      <FieldGroup className="pb-2">
        <Field><FieldLabel htmlFor="ct-nome">Nome</FieldLabel><Input id="ct-nome" name="ct-nome" maxLength={60} autoComplete="off" value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
        <Field>
          <FieldLabel>Como calcular a mensalidade</FieldLabel>
          <Segmentado rotulo="Como calcular a mensalidade" valor={modo} aoMudar={setModo}
            opcoes={[{ valor: 'percentual', rotulo: '% do salário mínimo' }, { valor: 'fixo', rotulo: 'Valor fixo' }]} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {modo === 'percentual' ? (
            <Field>
              <FieldLabel htmlFor="ct-pct">Porcentagem</FieldLabel>
              <InputGroup>
                <InputGroupInput id="ct-pct" name="ct-pct" inputMode="decimal" autoComplete="off" value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d,.]/g, '').slice(0, 6))} />
                <InputGroupAddon align="inline-end">%</InputGroupAddon>
              </InputGroup>
            </Field>
          ) : (
            <Field><FieldLabel htmlFor="ct-valor">Mensalidade (R$)</FieldLabel><Input id="ct-valor" name="ct-valor" inputMode="numeric" autoComplete="off" placeholder="0,00" value={valor} onChange={(e) => setValor(mascararValor(e.target.value))} /></Field>
          )}
          <Field><FieldLabel htmlFor="ct-dia">Vence no dia</FieldLabel><Input id="ct-dia" name="ct-dia" type="number" inputMode="numeric" min={1} max={28} value={dia} onChange={(e) => setDia(e.target.value)} /></Field>
        </div>
        {modo === 'percentual' && (
          <FieldDescription>
            {previa ? <>Próxima cobrança: <strong className="text-foreground">{formatarBRL(previa)}</strong>. Muda sozinha quando o salário mínimo for reajustado.</>
              : 'Cadastre o salário mínimo vigente para ver o valor.'}
            {' '}Exemplo: 1%.
          </FieldDescription>
        )}
        {modo === 'fixo' && <FieldDescription>Zero = isento (não gera mensalidade).</FieldDescription>}
        {modo === 'percentual' && (
          <Field>
            <FieldLabel htmlFor="ct-pu">Parcela única no ano (opcional)</FieldLabel>
            <InputGroup>
              <InputGroupInput id="ct-pu" name="ct-pu" inputMode="decimal" autoComplete="off" placeholder="Sem parcela única" value={pu} onChange={(e) => setPu(e.target.value.replace(/[^\d,.]/g, '').slice(0, 7))} />
              <InputGroupAddon align="inline-end">% do salário mínimo</InputGroupAddon>
            </InputGroup>
            <FieldDescription>Paga de dezembro até o fim de fevereiro, quita o ano todo. Exemplo: 10% (desconto de duas mensalidades). Deixe vazio para não oferecer.</FieldDescription>
          </Field>
        )}
        {categoria && <label className="flex items-center gap-2 text-[17px]"><Checkbox checked={ativa} onCheckedChange={(c) => setAtiva(c === true)} />Categoria ativa</label>}
        {categoria && <FieldDescription>A lixeira apaga só categoria que nunca foi usada por ninguém. Se já foi usada, desmarque “Categoria ativa”.</FieldDescription>}
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

function FormSalarioMinimo({ atual, aoFechar }: { atual: SalarioMinimo | null; aoFechar: () => void }) {
  const salvar = useAcaoF4('salvar_salario_minimo');
  const [desde, setDesde] = useState(atual?.vigente_desde ?? `${Number(hojeSP().slice(0, 4)) + 1}-01-01`);
  const [valor, setValor] = useState(paraCampo(atual?.valor) ?? '');
  const [erro, setErro] = useState<string | null>(null);
  async function enviar() {
    setErro(null);
    const v = lerValorBRL(valor);
    if (!v || Number(v) < 100) return setErro('Confira o valor.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) return setErro('Confira a data.');
    try { await salvar.mutateAsync({ p_vigente_desde: desde, p_valor: v }); toast.success('Salário mínimo salvo'); aoFechar(); }
    catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo={atual ? 'Salário mínimo' : 'Novo reajuste'}
      rodape={<Button size="lg" className="w-full" disabled={salvar.isPending} onClick={() => void enviar()}>{salvar.isPending && <Spinner data-icon="inline-start" />}Salvar</Button>}>
      <FieldGroup className="pb-2">
        <div className="grid grid-cols-2 gap-3">
          <Field><FieldLabel htmlFor="sm-valor">Valor (R$)</FieldLabel><Input id="sm-valor" name="sm-valor" inputMode="numeric" autoComplete="off" placeholder="0,00" value={valor} onChange={(e) => setValor(mascararValor(e.target.value))} /></Field>
          <Field><FieldLabel htmlFor="sm-desde">Vale a partir de</FieldLabel><Input id="sm-desde" name="sm-desde" type="date" value={desde} disabled={!!atual} onChange={(e) => setDesde(e.target.value)} /></Field>
        </div>
        <FieldDescription>Normalmente não precisa: o sistema busca o valor no Banco Central. Use só se ele não aparecer até janeiro. Mensalidades já geradas não mudam.</FieldDescription>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

function FormPix({ aoFechar }: { aoFechar: () => void }) {
  const pix = useConfigPix();
  const salvar = useAcaoF4('salvar_config_pix');
  const [chave, setChave] = useState(pix.data?.chave ?? '');
  const [nome, setNome] = useState(pix.data?.nome ?? '');
  const [cidade, setCidade] = useState(pix.data?.cidade ?? '');
  const [erro, setErro] = useState<string | null>(null);
  async function enviar() {
    setErro(null);
    try { await salvar.mutateAsync({ p: { chave: chave.trim(), nome: nome.trim(), cidade: cidade.trim() } }); toast.success('Chave Pix salva'); aoFechar(); }
    catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo="Chave Pix da Associação Exemplo" descricao="Confira no app do banco da Associação Exemplo. Um erro aqui manda o dinheiro para outra conta."
      rodape={<Button size="lg" className="w-full" disabled={!chave.trim() || salvar.isPending} onClick={() => void enviar()}>{salvar.isPending && <Spinner data-icon="inline-start" />}Salvar</Button>}>
      <FieldGroup className="pb-2">
        <Field><FieldLabel htmlFor="px-chave">Chave</FieldLabel><Input id="px-chave" name="px-chave" maxLength={77} autoComplete="off" spellCheck={false} value={chave} onChange={(e) => setChave(e.target.value)} />
          <FieldDescription>CNPJ (só números), e-mail, telefone (+55…) ou chave aleatória.</FieldDescription></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field><FieldLabel htmlFor="px-nome">Nome do recebedor</FieldLabel><Input id="px-nome" name="px-nome" maxLength={25} autoComplete="off" value={nome} onChange={(e) => setNome(e.target.value)} />
            <FieldDescription>Sem acento, até 25 letras.</FieldDescription></Field>
          <Field><FieldLabel htmlFor="px-cidade">Cidade</FieldLabel><Input id="px-cidade" name="px-cidade" maxLength={15} autoComplete="off" value={cidade} onChange={(e) => setCidade(e.target.value)} />
            <FieldDescription>Sem acento, até 15 letras.</FieldDescription></Field>
        </div>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

