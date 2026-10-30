// Ata aprovada fica congelada: o banco recusa qualquer mudança.
import { useQueryClient } from '@tanstack/react-query';
import { Archive, CalendarClock, Pencil, FileDown, FileText, Gavel, Landmark, Lock, Plus, ScrollText, Users, Vote } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { AbrirDocumento, AnexarDocumento, CampoArquivo, enviarDocumento } from '@/components/app/arquivo-documento';
import { BlocoErro, CarregandoLista, Vazio } from '@/components/app/estados';
import { Folha } from '@/components/app/folha';
import { Grupo, Linha } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { Segmentado } from '@/components/app/segmentado';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { usePerfil } from '@/app/sessao';
import {
  chavesF4, useAcaoF4, useDeliberacoes, useDocumentosInstitucionais, useMandatos, useMembros, usePainelGovernanca, usePresencas, useReunioes,
} from '@/dados/consultas';
import type { Deliberacao, DocumentoInstitucional, Mandato, OrgaoMandato, Reuniao, TipoDocumentoInstitucional, TipoReuniao } from '@/dados/tipos';
import { pode } from '@/lib/acesso';
import { diaPorExtenso, instanteSP } from '@/lib/agenda';
import { quorumAtingido } from '@/lib/ata';
import { formatarData, hojeSP } from '@/lib/datas';
import { contar } from '@/lib/texto';
import { erroMsg } from '@/telas/organizacao/comum';
import { COR_VALIDADE, NOME_DOC_INST, NOME_ORGAO, NOME_TIPO_REUNIAO, estadoValidade } from '@/telas/pessoas/comum';

type Aba = 'documentos' | 'mandatos' | 'reunioes';
const CERTIDOES: TipoDocumentoInstitucional[] = ['certidao_federal', 'certidao_estadual', 'certidao_municipal', 'certidao_fgts', 'certidao_trabalhista', 'alvara'];
const horaSP = (iso: string) => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(iso));
const dataSPde = (iso: string) => hojeSP(new Date(iso));

export function Governanca() {
  const perfil = usePerfil();
  const painel = usePainelGovernanca();
  const [params, setParams] = useSearchParams();
  const aba: Aba = (['mandatos', 'reunioes'].includes(params.get('aba') ?? '') ? params.get('aba') : 'documentos') as Aba;
  const setAba = (v: Aba) => setParams(v === 'documentos' ? {} : { aba: v }, { replace: true });
  const [nova, setNova] = useState<null | Aba>(null);
  const criar = aba === 'documentos' ? pode(perfil, 'documentos', 'criar') : aba === 'reunioes' ? pode(perfil, 'documentos', 'criar') : pode(perfil, 'documentos', 'editar');
  const p = painel.data;
  return (
    <Pagina titulo="Governança" voltar={pode(perfil, 'contador', 'ver') ? { para: '/documentos', rotulo: 'Documentos' } : undefined}
      acoes={criar ? <Button size="icon" variant="ghost" aria-label={aba === 'documentos' ? 'Novo documento' : aba === 'mandatos' ? 'Novo mandato' : 'Nova reunião'} onClick={() => setNova(aba)}><Plus aria-hidden="true" /></Button> : undefined}
      sob={<Segmentado rotulo="Ver" valor={aba} aoMudar={setAba} opcoes={[{ valor: 'documentos', rotulo: 'Documentos' }, { valor: 'mandatos', rotulo: 'Mandatos' }, { valor: 'reunioes', rotulo: 'Reuniões' }]} />}>
      {p && (p.vencendo.length > 0 || p.mandatos_acabando.length > 0 || p.atas_pendentes > 0) && (
        <Grupo titulo="Atenção">
          {p.vencendo.map((d) => <Linha key={d.id} icone={FileText} cor={d.validade < hojeSP() ? 'vermelho' : 'laranja'} titulo={d.titulo}
            descricao={`${d.validade < hojeSP() ? 'Venceu' : 'Vence'} em ${formatarData(d.validade)}`} aoTocar={() => setAba('documentos')} />)}
          {p.mandatos_acabando.map((m) => <Linha key={m.id} icone={Landmark} cor="laranja" titulo={`Mandato acaba: ${m.cargo}`} descricao={`${m.nome} · ${formatarData(m.fim)}`} aoTocar={() => setAba('mandatos')} />)}
          {p.atas_pendentes > 0 && <Linha icone={ScrollText} cor="laranja" titulo={contar(p.atas_pendentes, 'ata a aprovar', 'atas a aprovar')} aoTocar={() => setAba('reunioes')} />}
        </Grupo>
      )}
      {aba === 'documentos' && <ListaDocumentos />}
      {aba === 'mandatos' && <ListaMandatos />}
      {aba === 'reunioes' && <ListaReunioes />}
      {nova === 'documentos' && <FormDocumentoInst doc={null} aoFechar={() => setNova(null)} />}
      {nova === 'mandatos' && <FormMandato mandato={null} aoFechar={() => setNova(null)} />}
      {nova === 'reunioes' && <FormReuniao reuniao={null} aoFechar={() => setNova(null)} />}
    </Pagina>
  );
}

function ListaDocumentos() {
  const perfil = usePerfil();
  const docs = useDocumentosInstitucionais();
  const [aberto, setAberto] = useState<DocumentoInstitucional | null>(null);
  if (docs.isError) return <BlocoErro erro={docs.error} tentarDeNovo={() => void docs.refetch()} />;
  if (docs.isPending) return <CarregandoLista />;
  const ativos = (docs.data ?? []).filter((d) => !d.arquivado_em);
  if (!ativos.length) return <Vazio icone={FileText} titulo="Nenhum documento" descricao="Guarde aqui o estatuto, o cartão CNPJ, as atas registradas e as certidões com validade." />;
  const grupos: [string, DocumentoInstitucional[]][] = [
    ['Certidões e alvarás', ativos.filter((d) => CERTIDOES.includes(d.tipo))],
    ['Estatuto, atas e registros', ativos.filter((d) => !CERTIDOES.includes(d.tipo))],
  ];
  const editar = pode(perfil, 'documentos', 'criar');
  return (
    <>
      {grupos.filter(([, l]) => l.length).map(([titulo, lista]) => (
        <Grupo key={titulo} titulo={titulo}>
          {lista.map((d) => {
            const v = estadoValidade(d.validade);
            return (
              <Linha key={d.id} icone={FileText} cor={v ? COR_VALIDADE[v] : 'teal'} titulo={d.titulo}
                descricao={[NOME_DOC_INST[d.tipo], d.validade ? `${v === 'vencido' ? 'venceu' : 'vale até'} ${formatarData(d.validade)}` : d.emitido_em && `emitido em ${formatarData(d.emitido_em)}`, !d.arquivo_caminho && 'sem arquivo'].filter(Boolean).join(' · ')}
                valor={<span className="flex items-center gap-1">
                  {d.arquivo_caminho && <AbrirDocumento area="institucional" caminho={d.arquivo_caminho} rotulo={d.titulo} />}
                  {editar && <AnexarDocumento area="institucional" documentoId={d.id} rotulo={d.titulo} temArquivo={!!d.arquivo_caminho} invalida={[chavesF4.docsInst]} />}
                  {pode(perfil, 'documentos', 'editar') && <Button size="icon-sm" variant="ghost" aria-label={`Editar: ${d.titulo}`} title="Editar" onClick={() => setAberto(d)}><Pencil aria-hidden="true" /></Button>}
                </span>} />
            );
          })}
        </Grupo>
      ))}
      {aberto && <FormDocumentoInst doc={aberto} aoFechar={() => setAberto(null)} />}
    </>
  );
}

function FormDocumentoInst({ doc, aoFechar }: { doc: DocumentoInstitucional | null; aoFechar: () => void }) {
  const salvar = useAcaoF4('salvar_documento_institucional');
  const [id] = useState(() => doc?.id ?? crypto.randomUUID());
  const [tipo, setTipo] = useState<TipoDocumentoInstitucional>(doc?.tipo ?? 'certidao_federal');
  const [titulo, setTitulo] = useState(doc?.titulo ?? '');
  const [emitido, setEmitido] = useState(doc?.emitido_em ?? '');
  const [validade, setValidade] = useState(doc?.validade ?? '');
  const [obs, setObs] = useState(doc?.observacao ?? '');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const qc = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);
  async function enviar(arquivar = false) {
    setErro(null);
    try {
      await salvar.mutateAsync({ p: { id, tipo, titulo: titulo.trim(), emitido_em: emitido || null, validade: validade || null, observacao: obs.trim() || null, arquivar } });
      if (arquivo && !arquivar) { await enviarDocumento('institucional', id, arquivo); void qc.invalidateQueries(); }
      toast.success(arquivar ? 'Documento arquivado' : doc ? 'Documento atualizado' : arquivo ? 'Documento registrado com o arquivo' : 'Documento registrado'); aoFechar();
    } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo={doc ? 'Editar documento' : 'Novo documento'}
      rodape={<div className="flex w-full flex-col gap-2">
        <Button size="lg" disabled={titulo.trim().length < 2 || salvar.isPending} onClick={() => void enviar()}>{salvar.isPending && <Spinner data-icon="inline-start" />}Salvar</Button>
        {doc && <Button size="lg" variant="ghost" className="text-destructive" disabled={salvar.isPending} onClick={() => void enviar(true)}><Archive data-icon="inline-start" aria-hidden="true" />Arquivar (substituído ou vencido)</Button>}
      </div>}>
      <FieldGroup className="pb-2">
        <Field>
          <FieldLabel htmlFor="di-tipo">Tipo</FieldLabel>
          <Select value={tipo} onValueChange={(v) => { setTipo(v as TipoDocumentoInstitucional); if (!titulo) setTitulo(NOME_DOC_INST[v as TipoDocumentoInstitucional]); }}>
            <SelectTrigger id="di-tipo"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{(Object.keys(NOME_DOC_INST) as TipoDocumentoInstitucional[]).map((t) => <SelectItem key={t} value={t}>{NOME_DOC_INST[t]}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        </Field>
        <Field><FieldLabel htmlFor="di-titulo">Título</FieldLabel><Input id="di-titulo" name="di-titulo" maxLength={160} autoComplete="off" value={titulo} onChange={(e) => setTitulo(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field><FieldLabel htmlFor="di-emit">Emitido em</FieldLabel><Input id="di-emit" name="di-emit" type="date" max={hojeSP()} value={emitido} onChange={(e) => setEmitido(e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="di-val">Validade</FieldLabel><Input id="di-val" name="di-val" type="date" value={validade} onChange={(e) => setValidade(e.target.value)} /></Field>
        </div>
        {CERTIDOES.includes(tipo) && <FieldDescription>A validade aparece na agenda e no alerta da Governança 45 dias antes.</FieldDescription>}
        <Field><FieldLabel htmlFor="di-obs">Observação (opcional)</FieldLabel><Input id="di-obs" name="di-obs" maxLength={300} autoComplete="off" value={obs} onChange={(e) => setObs(e.target.value)} /></Field>
        {!doc && <CampoArquivo id="di-arq" arquivo={arquivo} aoEscolher={setArquivo} />}
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

function ListaMandatos() {
  const perfil = usePerfil();
  const mandatos = useMandatos();
  const [aberto, setAberto] = useState<Mandato | null>(null);
  if (mandatos.isPending) return <CarregandoLista />;
  const hoje = hojeSP();
  const vigentes = (mandatos.data ?? []).filter((m) => m.fim >= hoje && m.inicio <= hoje);
  const outros = (mandatos.data ?? []).filter((m) => !vigentes.includes(m));
  const editar = pode(perfil, 'documentos', 'editar');
  return (
    <>
      <Grupo titulo="Mandatos vigentes" rodape="O fim do mandato aparece na agenda, para preparar a eleição a tempo.">
        {vigentes.length === 0 && <Linha titulo="Nenhum mandato vigente cadastrado" />}
        {vigentes.map((m) => <Linha key={m.id} icone={Landmark} cor={m.orgao === 'conselho_fiscal' ? 'indigo' : 'roxo'} titulo={`${m.cargo} — ${m.nome}`}
          descricao={`${NOME_ORGAO[m.orgao]} · ${formatarData(m.inicio)} a ${formatarData(m.fim)}`} aoTocar={editar ? () => setAberto(m) : undefined} seta={editar} />)}
      </Grupo>
      {outros.length > 0 && (
        <Grupo titulo="Anteriores e futuros">
          {outros.map((m) => <Linha key={m.id} icone={Landmark} cor="cinza" titulo={`${m.cargo} — ${m.nome}`} descricao={`${formatarData(m.inicio)} a ${formatarData(m.fim)}`}
            aoTocar={editar ? () => setAberto(m) : undefined} />)}
        </Grupo>
      )}
      {aberto && <FormMandato mandato={aberto} aoFechar={() => setAberto(null)} />}
    </>
  );
}

function FormMandato({ mandato, aoFechar }: { mandato: Mandato | null; aoFechar: () => void }) {
  const membros = useMembros();
  const salvar = useAcaoF4('salvar_mandato');
  const [id] = useState(() => mandato?.id ?? crypto.randomUUID());
  const [nome, setNome] = useState(mandato?.nome ?? '');
  const [membro, setMembro] = useState(mandato?.membro_id ?? '');
  const [cargo, setCargo] = useState(mandato?.cargo ?? '');
  const [orgao, setOrgao] = useState<OrgaoMandato>(mandato?.orgao ?? 'diretoria');
  const [inicio, setInicio] = useState(mandato?.inicio ?? '');
  const [fim, setFim] = useState(mandato?.fim ?? '');
  const [erro, setErro] = useState<string | null>(null);
  async function enviar() {
    setErro(null);
    try { await salvar.mutateAsync({ p: { id, nome: nome.trim(), membro_id: membro || null, cargo: cargo.trim(), orgao, inicio, fim } }); toast.success('Mandato salvo'); aoFechar(); }
    catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo={mandato ? 'Editar mandato' : 'Novo mandato'}
      rodape={<Button size="lg" className="w-full" disabled={nome.trim().length < 2 || cargo.trim().length < 2 || !inicio || !fim || salvar.isPending} onClick={() => void enviar()}>{salvar.isPending && <Spinner data-icon="inline-start" />}Salvar</Button>}>
      <FieldGroup className="pb-2">
        <Field>
          <FieldLabel htmlFor="md-membro">Quem (se usa o sistema)</FieldLabel>
          <Select value={membro || 'nenhum'} onValueChange={(v) => { const m = membros.data?.find((x) => x.id === v); setMembro(v === 'nenhum' ? '' : v); if (m && !nome) setNome(m.nome); }}>
            <SelectTrigger id="md-membro"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup><SelectItem value="nenhum">Não usa o sistema</SelectItem>{(membros.data ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        </Field>
        <Field><FieldLabel htmlFor="md-nome">Nome</FieldLabel><Input id="md-nome" name="md-nome" maxLength={120} autoComplete="off" value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field><FieldLabel htmlFor="md-cargo">Cargo</FieldLabel><Input id="md-cargo" name="md-cargo" maxLength={60} autoComplete="off" placeholder="Presidente…" value={cargo} onChange={(e) => setCargo(e.target.value)} /></Field>
          <Field>
            <FieldLabel htmlFor="md-orgao">Órgão</FieldLabel>
            <Select value={orgao} onValueChange={(v) => setOrgao(v as OrgaoMandato)}>
              <SelectTrigger id="md-orgao"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{(Object.keys(NOME_ORGAO) as OrgaoMandato[]).map((o) => <SelectItem key={o} value={o}>{NOME_ORGAO[o]}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field><FieldLabel htmlFor="md-ini">Início</FieldLabel><Input id="md-ini" name="md-ini" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="md-fim">Fim</FieldLabel><Input id="md-fim" name="md-fim" type="date" min={inicio} value={fim} onChange={(e) => setFim(e.target.value)} /></Field>
        </div>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

function ListaReunioes() {
  const reunioes = useReunioes();
  if (reunioes.isPending) return <CarregandoLista />;
  if (!(reunioes.data ?? []).length) return <Vazio icone={Gavel} titulo="Nenhuma reunião registrada" descricao="Convoque reuniões e assembleias, registre presença, votações e a ata." />;
  const agora = new Date().toISOString();
  const proximas = (reunioes.data ?? []).filter((r) => r.data >= agora && r.situacao === 'convocada').reverse();
  const passadas = (reunioes.data ?? []).filter((r) => !proximas.includes(r));
  const linha = (r: Reuniao) => (
    <Linha key={r.id} icone={r.ata_aprovada_em ? Lock : Gavel} cor={r.situacao === 'cancelada' ? 'cinza' : r.ata_aprovada_em ? 'verde' : r.situacao === 'realizada' ? 'laranja' : 'azul'}
      titulo={r.titulo} para={`/documentos/reunioes/${r.id}`}
      descricao={[`${formatarData(dataSPde(r.data))} às ${horaSP(r.data)}`, r.situacao === 'cancelada' ? 'cancelada' : r.ata_aprovada_em ? 'ata aprovada' : r.situacao === 'realizada' ? 'ata a aprovar' : 'convocada'].join(' · ')} />
  );
  return (
    <>
      {proximas.length > 0 && <Grupo titulo="Próximas">{proximas.map(linha)}</Grupo>}
      <Grupo titulo="Realizadas e anteriores">{passadas.length ? passadas.map(linha) : <Linha titulo="Nenhuma ainda" />}</Grupo>
    </>
  );
}

function FormReuniao({ reuniao, aoFechar }: { reuniao: Reuniao | null; aoFechar: () => void }) {
  const salvar = useAcaoF4('salvar_reuniao');
  const navegar = useNavigate();
  const [id] = useState(() => reuniao?.id ?? crypto.randomUUID());
  const [tipo, setTipo] = useState<TipoReuniao>(reuniao?.tipo ?? 'diretoria');
  const [titulo, setTitulo] = useState(reuniao?.titulo ?? NOME_TIPO_REUNIAO.diretoria);
  const [dia, setDia] = useState(reuniao ? dataSPde(reuniao.data) : hojeSP());
  const [hora, setHora] = useState(reuniao ? horaSP(reuniao.data) : '20:00');
  const [local, setLocal] = useState(reuniao?.local ?? '');
  const [pauta, setPauta] = useState(reuniao?.pauta ?? '');
  const [quorum, setQuorum] = useState(reuniao?.quorum_minimo ? String(reuniao.quorum_minimo) : '');
  const [situacao, setSituacao] = useState<Reuniao['situacao']>(reuniao?.situacao ?? 'convocada');
  const [erro, setErro] = useState<string | null>(null);
  async function enviar() {
    setErro(null);
    try {
      await salvar.mutateAsync({ p: { id, tipo, titulo: titulo.trim(), data: instanteSP(dia, hora), local: local.trim() || null, pauta: pauta.trim(),
        quorum_minimo: quorum ? Number(quorum) : null, situacao } });
      toast.success(reuniao ? 'Reunião atualizada' : 'Reunião registrada'); aoFechar();
      if (!reuniao) navegar(`/documentos/reunioes/${id}`);
    } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo={reuniao ? 'Editar reunião' : 'Nova reunião'} larga
      rodape={<Button size="lg" className="w-full" disabled={titulo.trim().length < 2 || pauta.trim().length < 2 || salvar.isPending} onClick={() => void enviar()}>{salvar.isPending && <Spinner data-icon="inline-start" />}Salvar</Button>}>
      <FieldGroup className="pb-2">
        <Field>
          <FieldLabel htmlFor="rn-tipo">Tipo</FieldLabel>
          <Select value={tipo} onValueChange={(v) => { if (titulo === NOME_TIPO_REUNIAO[tipo]) setTitulo(NOME_TIPO_REUNIAO[v as TipoReuniao]); setTipo(v as TipoReuniao); }}>
            <SelectTrigger id="rn-tipo"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{(Object.keys(NOME_TIPO_REUNIAO) as TipoReuniao[]).map((t) => <SelectItem key={t} value={t}>{NOME_TIPO_REUNIAO[t]}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        </Field>
        <Field><FieldLabel htmlFor="rn-titulo">Título</FieldLabel><Input id="rn-titulo" name="rn-titulo" maxLength={160} autoComplete="off" value={titulo} onChange={(e) => setTitulo(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field><FieldLabel htmlFor="rn-dia">Dia</FieldLabel><Input id="rn-dia" name="rn-dia" type="date" value={dia} onChange={(e) => setDia(e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="rn-hora">Hora</FieldLabel><Input id="rn-hora" name="rn-hora" type="time" value={hora} onChange={(e) => setHora(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field><FieldLabel htmlFor="rn-local">Local</FieldLabel><Input id="rn-local" name="rn-local" maxLength={160} autoComplete="off" placeholder="Sede, online…" value={local} onChange={(e) => setLocal(e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="rn-quorum">Quórum mínimo</FieldLabel><Input id="rn-quorum" name="rn-quorum" type="number" inputMode="numeric" min={1} max={1000} value={quorum} onChange={(e) => setQuorum(e.target.value)} /></Field>
        </div>
        <Field><FieldLabel htmlFor="rn-pauta">Pauta</FieldLabel><Textarea id="rn-pauta" name="rn-pauta" rows={4} maxLength={4000} placeholder={'1. …\n2. …'} value={pauta} onChange={(e) => setPauta(e.target.value)} />
          <FieldDescription>Confira no estatuto o prazo de convocação e o quórum de cada tipo de assembleia.</FieldDescription></Field>
        {reuniao && (
          <Field>
            <FieldLabel htmlFor="rn-sit">Situação</FieldLabel>
            <Select value={situacao} onValueChange={(v) => setSituacao(v as Reuniao['situacao'])}>
              <SelectTrigger id="rn-sit"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value="convocada">Convocada</SelectItem><SelectItem value="realizada">Realizada</SelectItem><SelectItem value="cancelada">Cancelada</SelectItem></SelectGroup></SelectContent>
            </Select>
          </Field>
        )}
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

export function DetalheReuniao() {
  const { id = '' } = useParams();
  const perfil = usePerfil();
  const reunioes = useReunioes();
  const presencas = usePresencas(id);
  const delib = useDeliberacoes(id);
  const [folha, setFolha] = useState<null | 'editar' | 'presenca' | 'ata' | 'aprovar' | { deliberacao: Deliberacao | null }>(null);
  const [gerando, setGerando] = useState(false);
  const r = reunioes.data?.find((x) => x.id === id);
  const voltar = { para: '/documentos/governanca?aba=reunioes', rotulo: 'Governança' };
  if (reunioes.isPending) return <Pagina titulo="Reunião" voltar={voltar}><CarregandoLista /></Pagina>;
  if (!r) return <Pagina titulo="Reunião" voltar={voltar}><Vazio icone={Gavel} titulo="Reunião não encontrada" descricao="Ela pode não estar visível para você." /></Pagina>;
  const congelada = !!r.ata_aprovada_em;
  const editar = pode(perfil, 'documentos', 'editar') && !congelada;
  const n = (presencas.data ?? []).length;
  async function pdf() {
    setGerando(true);
    try { const m = await import('@/lib/ata'); await m.exportarPdfAta(r!, presencas.data ?? [], delib.data ?? [], perfil.membro.nome); }
    catch { toast.error('Não foi possível gerar o PDF.'); } finally { setGerando(false); }
  }
  return (
    <Pagina titulo={r.titulo} voltar={voltar} acoes={editar ? <Button variant="ghost" size="sm" onClick={() => setFolha('editar')}>Editar</Button> : undefined}>
      <Grupo>
        <Linha icone={CalendarClock} cor="azul" titulo={diaPorExtenso(dataSPde(r.data))} descricao={[`às ${horaSP(r.data)}`, r.local].filter(Boolean).join(' · ')} />
        <Linha icone={Gavel} cor="indigo" titulo={NOME_TIPO_REUNIAO[r.tipo]} valor={r.situacao === 'convocada' ? 'Convocada' : r.situacao === 'realizada' ? 'Realizada' : 'Cancelada'} />
        {congelada && <Linha icone={Lock} cor="verde" titulo={`Ata aprovada em ${formatarData(r.ata_aprovada_em)}`} descricao="Nada desta reunião pode mais ser alterado." />}
      </Grupo>
      <section className="bg-card rounded-[14px] p-4"><h2 className="text-muted-foreground mb-1 text-[13px] font-medium">Pauta</h2><p className="text-[15px] whitespace-pre-wrap">{r.pauta}</p></section>

      <Grupo titulo="Presença" acao={editar && r.situacao !== 'cancelada' ? <Button variant="link" size="xs" onClick={() => setFolha('presenca')}>Registrar</Button> : undefined}>
        <Linha icone={Users} cor={quorumAtingido(r, n) ? 'verde' : 'vermelho'} titulo={contar(n, 'presente', 'presentes')}
          valor={r.quorum_minimo !== null ? <Badge variant={quorumAtingido(r, n) ? 'secondary' : 'destructive'}>{quorumAtingido(r, n) ? 'Quórum atingido' : `Quórum: ${r.quorum_minimo}`}</Badge> : undefined}
          descricao={n ? (presencas.data ?? []).map((p) => p.nome).join(', ') : undefined} />
      </Grupo>

      <Grupo titulo="Deliberações e votações" acao={editar && r.situacao === 'realizada' ? <Button variant="link" size="xs" onClick={() => setFolha({ deliberacao: null })}>Adicionar</Button> : undefined}>
        {(delib.data ?? []).length === 0 && <Linha titulo="Nenhuma deliberação registrada" />}
        {(delib.data ?? []).map((d) => (
          <Linha key={d.id} icone={Vote} cor={d.resultado === 'aprovada' ? 'verde' : d.resultado === 'rejeitada' ? 'vermelho' : 'cinza'} titulo={`${d.ordem}. ${d.texto}`}
            descricao={`${d.resultado === 'aprovada' ? 'Aprovada' : d.resultado === 'rejeitada' ? 'Rejeitada' : 'Retirada'} · ${d.votos_favor} a favor, ${d.votos_contra} contra, ${d.abstencoes} abstenções`}
            aoTocar={editar ? () => setFolha({ deliberacao: d }) : undefined} />
        ))}
      </Grupo>

      <Grupo titulo="Ata" rodape={congelada ? undefined : 'A ata fica em rascunho até ser aprovada. Depois de aprovada, nada desta reunião muda.'}>
        {r.ata ? <Linha icone={ScrollText} cor="teal" titulo={congelada ? 'Ata aprovada' : 'Rascunho da ata'} descricao={r.ata.slice(0, 160)} aoTocar={editar ? () => setFolha('ata') : undefined} seta={editar} />
          : <Linha icone={ScrollText} cor="cinza" titulo="Ata ainda não escrita" aoTocar={editar && r.situacao === 'realizada' ? () => setFolha('ata') : undefined} seta={editar && r.situacao === 'realizada'} />}
        {editar && r.ata && r.situacao === 'realizada' && <Linha icone={Lock} cor="verde" titulo="Aprovar a ata" descricao="Congela a reunião, a presença e as votações." aoTocar={() => setFolha('aprovar')} />}
        <Linha icone={FileDown} cor="azul" titulo={gerando ? 'Gerando o PDF…' : 'Baixar a ata em PDF'} aoTocar={() => void pdf()} desabilitada={gerando} />
      </Grupo>

      {folha === 'editar' && <FormReuniao reuniao={r} aoFechar={() => setFolha(null)} />}
      {folha === 'presenca' && <FormPresenca reuniao={r} atuais={(presencas.data ?? []).map((p) => p.nome)} aoFechar={() => setFolha(null)} />}
      {(folha === 'ata' || folha === 'aprovar') && <FormAta reuniao={r} aprovar={folha === 'aprovar'} aoFechar={() => setFolha(null)} />}
      {folha && typeof folha === 'object' && <FormDeliberacao reuniao={r} deliberacao={folha.deliberacao} proxima={Math.max(0, ...(delib.data ?? []).map((d) => d.ordem)) + 1} aoFechar={() => setFolha(null)} />}
    </Pagina>
  );
}

function FormPresenca({ reuniao, atuais, aoFechar }: { reuniao: Reuniao; atuais: string[]; aoFechar: () => void }) {
  const membros = useMembros();
  const salvar = useAcaoF4<Record<string, unknown>, { presentes: number; quorum_atingido: boolean }>('salvar_presencas');
  const [texto, setTexto] = useState(atuais.join('\n'));
  const [erro, setErro] = useState<string | null>(null);
  const nomes = [...new Set(texto.split('\n').map((x) => x.trim()).filter((x) => x.length >= 2))];
  function incluirDiretoria() {
    const atuaisSet = new Set(nomes.map((x) => x.toLowerCase()));
    const novos = (membros.data ?? []).filter((m) => m.ativo && !atuaisSet.has(m.nome.toLowerCase())).map((m) => m.nome);
    setTexto([...nomes, ...novos].join('\n'));
  }
  async function enviar() {
    setErro(null);
    const ids = new Map((membros.data ?? []).map((m) => [m.nome.toLowerCase(), m.id]));
    try {
      const r = await salvar.mutateAsync({ p_reuniao: reuniao.id, p: nomes.map((nome) => ({ nome, membro_id: ids.get(nome.toLowerCase()) ?? null })) });
      toast.success(`${contar(r.presentes, 'presente', 'presentes')}${r.quorum_atingido ? '' : ' · quórum não atingido'}`); aoFechar();
    } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo="Lista de presença" descricao="Um nome por linha."
      rodape={<Button size="lg" className="w-full" disabled={salvar.isPending} onClick={() => void enviar()}>{salvar.isPending && <Spinner data-icon="inline-start" />}Salvar ({nomes.length})</Button>}>
      <FieldGroup className="pb-2">
        <Button variant="secondary" onClick={incluirDiretoria}><Users data-icon="inline-start" aria-hidden="true" />Incluir a diretoria do sistema</Button>
        <Field><FieldLabel htmlFor="pr-nomes">Presentes</FieldLabel><Textarea id="pr-nomes" name="pr-nomes" rows={10} value={texto} onChange={(e) => setTexto(e.target.value)} />
          {reuniao.quorum_minimo !== null && <FieldDescription>Quórum mínimo: {reuniao.quorum_minimo}. {quorumAtingido(reuniao, nomes.length) ? 'Atingido.' : 'Ainda não atingido.'}</FieldDescription>}</Field>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

function FormDeliberacao({ reuniao, deliberacao, proxima, aoFechar }: { reuniao: Reuniao; deliberacao: Deliberacao | null; proxima: number; aoFechar: () => void }) {
  const salvar = useAcaoF4('salvar_deliberacao');
  const [id] = useState(() => deliberacao?.id ?? crypto.randomUUID());
  const [ordem, setOrdem] = useState(String(deliberacao?.ordem ?? proxima));
  const [texto, setTexto] = useState(deliberacao?.texto ?? '');
  const [favor, setFavor] = useState(String(deliberacao?.votos_favor ?? 0));
  const [contra, setContra] = useState(String(deliberacao?.votos_contra ?? 0));
  const [abst, setAbst] = useState(String(deliberacao?.abstencoes ?? 0));
  const [resultado, setResultado] = useState<Deliberacao['resultado']>(deliberacao?.resultado ?? 'aprovada');
  const [erro, setErro] = useState<string | null>(null);
  async function enviar() {
    setErro(null);
    try {
      await salvar.mutateAsync({ p_reuniao: reuniao.id, p: { id, ordem: Number(ordem), texto: texto.trim(), votos_favor: Number(favor) || 0, votos_contra: Number(contra) || 0, abstencoes: Number(abst) || 0, resultado } });
      toast.success('Deliberação salva'); aoFechar();
    } catch (e) { setErro(erroMsg(e)); }
  }
  const num = (idc: string, rotulo: string, v: string, set: (x: string) => void) => (
    <Field><FieldLabel htmlFor={idc}>{rotulo}</FieldLabel><Input id={idc} name={idc} type="number" inputMode="numeric" min={0} max={10000} value={v} onChange={(e) => set(e.target.value)} /></Field>
  );
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo={deliberacao ? 'Editar deliberação' : 'Nova deliberação'} descricao="Os votos não podem passar do número de presentes."
      rodape={<Button size="lg" className="w-full" disabled={texto.trim().length < 2 || salvar.isPending} onClick={() => void enviar()}>{salvar.isPending && <Spinner data-icon="inline-start" />}Salvar</Button>}>
      <FieldGroup className="pb-2">
        <div className="grid grid-cols-[5rem_1fr] gap-3">
          {num('dl-ordem', 'Item', ordem, setOrdem)}
          <Field><FieldLabel htmlFor="dl-texto">O que foi deliberado</FieldLabel><Input id="dl-texto" name="dl-texto" maxLength={1000} autoComplete="off" value={texto} onChange={(e) => setTexto(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">{num('dl-favor', 'A favor', favor, setFavor)}{num('dl-contra', 'Contra', contra, setContra)}{num('dl-abst', 'Abstenções', abst, setAbst)}</div>
        <Field>
          <FieldLabel htmlFor="dl-res">Resultado</FieldLabel>
          <Select value={resultado} onValueChange={(v) => setResultado(v as Deliberacao['resultado'])}>
            <SelectTrigger id="dl-res"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup><SelectItem value="aprovada">Aprovada</SelectItem><SelectItem value="rejeitada">Rejeitada</SelectItem><SelectItem value="retirada">Retirada de pauta</SelectItem></SelectGroup></SelectContent>
          </Select>
        </Field>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

function FormAta({ reuniao, aprovar, aoFechar }: { reuniao: Reuniao; aprovar: boolean; aoFechar: () => void }) {
  const salvar = useAcaoF4('salvar_ata');
  const [ata, setAta] = useState(reuniao.ata ?? '');
  const [aprovadaEm, setAprovadaEm] = useState(hojeSP());
  const [erro, setErro] = useState<string | null>(null);
  async function enviar() {
    setErro(null);
    try { await salvar.mutateAsync({ p_reuniao: reuniao.id, p_ata: ata.trim(), p_aprovada_em: aprovar ? aprovadaEm : null }); toast.success(aprovar ? 'Ata aprovada e congelada' : 'Rascunho salvo'); aoFechar(); }
    catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo={aprovar ? 'Aprovar a ata' : 'Texto da ata'} larga
      descricao={aprovar ? 'Depois de aprovada, nem a ata, nem a presença, nem as votações podem mudar.' : undefined}
      rodape={<Button size="lg" className="w-full" disabled={ata.trim().length < 2 || salvar.isPending} onClick={() => void enviar()}>
        {salvar.isPending && <Spinner data-icon="inline-start" />}{aprovar ? 'Aprovar e congelar' : 'Salvar rascunho'}</Button>}>
      <FieldGroup className="pb-2">
        <Field><FieldLabel htmlFor="at-texto">Ata</FieldLabel><Textarea id="at-texto" name="at-texto" rows={aprovar ? 6 : 14} maxLength={20000} value={ata} onChange={(e) => setAta(e.target.value)} readOnly={aprovar} /></Field>
        {aprovar && <Field><FieldLabel htmlFor="at-data">Aprovada em</FieldLabel><Input id="at-data" name="at-data" type="date" min={dataSPde(reuniao.data)} max={hojeSP()} value={aprovadaEm} onChange={(e) => setAprovadaEm(e.target.value)} />
          <FieldDescription>Normalmente, na reunião seguinte.</FieldDescription></Field>}
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}
