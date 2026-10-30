// O servidor garante: ninguém muda o próprio acesso, há sempre 2 administradores e tudo vai para a auditoria.
import { useQueryClient } from '@tanstack/react-query';
import { FileDown, FileSpreadsheet, History, Mail, ShieldAlert, ShieldCheck, Trash2, UserPlus, UserRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { BlocoErro, CarregandoLista } from '@/components/app/estados';
import { Folha } from '@/components/app/folha';
import { Grupo, Linha } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { usePerfil } from '@/app/sessao';
import { chaves, useAuditoria, useConvites, useMembros, useModelosPermissao, usePedidosAcesso, usePermissoesDe } from '@/dados/consultas';
import { fonte } from '@/dados/fonte';
import type { Membro, ModeloPermissao, PedidoAcesso, Permissao } from '@/dados/tipos';
import { CARGOS_ADMIN, NOME_CARGO, type Cargo } from '@/lib/acesso';
import { ACAO_AUD, LIMITE_PDF_AUDITORIA, TABELA_AUD, csvAuditoria, nomeArquivoAuditoria, pdfAuditoria, type ExportacaoAuditoria } from '@/lib/auditoria';
import { competencia, formatarData, hojeSP, mesAnterior, somarDias } from '@/lib/datas';
import { baixar } from '@/lib/exportar';
import { contar } from '@/lib/texto';
import { ErroApp } from '@/lib/erros';
import { CARGOS, FolhaModelo, FolhaPadraoCargo, GradePermissoes, SeletorPerfil, msgErro, paraLista, paraMapa, type Mapa } from './permissoes';

const ehAdmin = (c: Cargo) => CARGOS_ADMIN.includes(c);
const msg = msgErro;

export function Acessos() {
  const membros = useMembros();
  const convites = useConvites();
  const pedidos = usePedidosAcesso();
  const [convidar, setConvidar] = useState<boolean | PedidoAcesso>(false);
  const [pedido, setPedido] = useState<PedidoAcesso | null>(null);
  const modelos = useModelosPermissao();
  const [modelo, setModelo] = useState<ModeloPermissao | 'novo' | null>(null);
  const [padrao, setPadrao] = useState<Cargo | null>(null);
  const [cancelarConvite, setCancelarConvite] = useState<{ id: string; nome: string; email: string } | null>(null);
  const pendentes = (convites.data ?? []).filter((c) => !c.usado_em && !c.cancelado_em && c.expira_em > new Date().toISOString());
  return (
    <Pagina titulo="Acessos" acoes={<Button variant="ghost" size="sm" onClick={() => setConvidar(true)}><UserPlus data-icon="inline-start" aria-hidden="true" />Convidar</Button>}>
      {membros.isPending ? <CarregandoLista /> : membros.isError ? <BlocoErro erro={membros.error} tentarDeNovo={() => void membros.refetch()} /> : (
        <Grupo titulo="Diretoria no sistema" rodape="Presidente, vice-presidente, secretário e dev administram os acessos. O sistema sempre mantém pelo menos dois administradores.">
          {membros.data.map((m) => (
            <Linha key={m.id} icone={UserRound} cor={m.ativo ? (ehAdmin(m.cargo) ? 'indigo' : 'azul') : 'cinza'} titulo={m.nome}
              descricao={<span className="flex flex-wrap items-center gap-1.5">{NOME_CARGO[m.cargo]}{ehAdmin(m.cargo) && <Badge variant="secondary">Administrador</Badge>}{!m.ativo && <Badge variant="outline">Desativado</Badge>}{m.acesso_expira_em && <Badge variant="outline">Até {formatarData(m.acesso_expira_em)}</Badge>}</span>}
              para={`/acessos/membro/${m.id}`} />
          ))}
        </Grupo>
      )}
      {(pedidos.data ?? []).length > 0 && (
        <Grupo titulo="Pedidos de acesso" rodape="Pedidos feitos pela tela de entrada. Ninguém entra sem um administrador liberar.">
          {pedidos.data!.map((x) => <Linha key={x.id} icone={UserPlus} cor="verde" titulo={x.nome}
            descricao={`${x.email} · pediu em ${formatarData(x.criado_em)}`} aoTocar={() => setPedido(x)} seta />)}
        </Grupo>
      )}
      {pendentes.length > 0 && (
        <Grupo titulo="Convites aguardando">
          {pendentes.map((c) => <Linha key={c.id} icone={Mail} cor="laranja" titulo={c.nome} descricao={`${c.email} · vence em ${formatarData(c.expira_em)}`}
            aoTocar={() => setCancelarConvite(c)} seta />)}
        </Grupo>
      )}
      <Grupo titulo="Modelos de permissão" acao={<Button variant="link" size="xs" onClick={() => setModelo('novo')}>Novo modelo</Button>}
        rodape="Toque num modelo para editar. Cadastre conjuntos com nome (ex.: Comissão técnica) ou ajuste o padrão de um cargo. Mudar um modelo não muda quem já tem acesso: vale para os próximos convites e para “Perfil pronto”.">
        {CARGOS.map(([c, rot]) => {
          const m = modelos.data?.find((x) => x.cargo === c);
          return <Linha key={c} icone={ShieldCheck} cor={m ? 'indigo' : 'cinza'} titulo={`Padrão de ${rot}`} descricao={m ? `Modelo próprio: ${m.nome}` : 'Padrão de fábrica'}
            aoTocar={() => (m ? setModelo(m) : setPadrao(c))} seta />;
        })}
        {(modelos.data ?? []).filter((x) => !x.cargo).map((m) => <Linha key={m.id} icone={ShieldCheck} cor="azul" titulo={m.nome} descricao={contar(m.permissoes.length, 'permissão', 'permissões')} aoTocar={() => setModelo(m)} seta />)}
      </Grupo>
      <Grupo><Linha icone={History} cor="cinza" titulo="Trilha de auditoria" descricao="Quem criou, alterou, aprovou ou estornou cada coisa — e tentativas negadas." para="/acessos/auditoria" /></Grupo>
      {convidar && <Convidar pedido={typeof convidar === 'object' ? convidar : undefined} aoFechar={() => setConvidar(false)} />}
      {modelo && <FolhaModelo modelo={modelo === 'novo' ? undefined : modelo} aoFechar={() => setModelo(null)} />}
      {padrao && <FolhaPadraoCargo cargo={padrao} aoFechar={() => setPadrao(null)} />}
      {cancelarConvite && <FolhaCancelarConvite convite={cancelarConvite} aoFechar={() => setCancelarConvite(null)} />}
      {pedido && <FolhaPedido pedido={pedido} aoFechar={() => setPedido(null)} aoLiberar={() => { setConvidar(pedido); setPedido(null); }} />}
    </Pagina>
  );
}

function FolhaPedido({ pedido, aoFechar, aoLiberar }: { pedido: PedidoAcesso; aoFechar: () => void; aoLiberar: () => void }) {
  const qc = useQueryClient();
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  async function recusar() {
    setOcupado(true);
    try {
      await fonte().rpc('decidir_pedido_acesso', { p_id: pedido.id, p_decisao: 'recusado', p_motivo: motivo.trim() || null });
      toast.success('Pedido recusado. Nenhum e-mail é enviado à pessoa.');
      void qc.invalidateQueries({ queryKey: chaves.pedidosAcesso }); aoFechar();
    } catch (e) { toast.error(msg(e)); } finally { setOcupado(false); }
  }
  return (
    <>
      <Folha aberta aoMudar={(v) => !v && !ocupado && aoFechar()} titulo={pedido.nome} descricao={pedido.email}
        rodape={<div className="grid w-full grid-cols-2 gap-2.5">
          <Button size="lg" variant="secondary" disabled={ocupado} onClick={() => void recusar()}>{ocupado && <Spinner data-icon="inline-start" />}Recusar</Button>
          <Button size="lg" disabled={ocupado} onClick={aoLiberar}><UserPlus data-icon="inline-start" aria-hidden="true" />Liberar</Button>
        </div>}>
        <FieldGroup className="pb-2">
          <p className="text-muted-foreground text-[13px]">Confira se a pessoa é mesmo da Associação Exemplo antes de liberar. Liberar abre o convite: você escolhe o cargo e as permissões.</p>
          <Field><FieldLabel htmlFor="pd-motivo">Motivo, se recusar (opcional, só a diretoria vê)</FieldLabel>
            <Input id="pd-motivo" name="pd-motivo" maxLength={300} autoComplete="off" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Field>
        </FieldGroup>
      </Folha>
    </>
  );
}

function Convidar({ aoFechar, pedido }: { aoFechar: () => void; pedido?: PedidoAcesso }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState(pedido?.email ?? '');
  const [nome, setNome] = useState(pedido?.nome ?? '');
  const [cargo, setCargo] = useState<Cargo>('diretor');
  const [base, setBase] = useState('cargo');
  const modelos = useModelosPermissao();
  const comNome = (modelos.data ?? []).filter((m) => !m.cargo);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function enviar() {
    setEnviando(true); setErro(null);
    try {
      const escolhido = comNome.find((m) => m.id === base);
      const permissoes = escolhido ? escolhido.permissoes : (await fonte().rpc<{ permissoes: Permissao[] }>('modelo_permissoes', { p_cargo: cargo })).permissoes;
      const r = await fonte().convidar({ email: email.trim(), nome: nome.trim(), cargo, permissoes });
      if (pedido) await fonte().rpc('decidir_pedido_acesso', { p_id: pedido.id, p_decisao: 'aprovado' });
      toast.success(r.ja_tem_login ? 'Convite registrado. Como a pessoa já tem login, o acesso libera no próximo acesso dela.' : `Convite enviado para ${email.trim()}`);
      for (const k of [chaves.convites, chaves.pedidosAcesso]) void qc.invalidateQueries({ queryKey: k });
      aoFechar();
    } catch (e) { setErro(msg(e)); } finally { setEnviando(false); }
  }
  return (
    <>
      <Folha aberta aoMudar={(v) => !v && !enviando && aoFechar()} titulo="Convidar para a diretoria"
        descricao="A pessoa recebe um e-mail, cria a própria senha e ativa a verificação em duas etapas."
        rodape={<Button size="lg" className="w-full" disabled={enviando || !email.includes('@') || nome.trim().length < 2} onClick={() => void enviar()}>{enviando && <Spinner data-icon="inline-start" />}Enviar convite</Button>}>
        <FieldGroup className="pb-2">
          <Field><FieldLabel htmlFor="cv-nome">Nome</FieldLabel><Input name="cv-nome" id="cv-nome" autoComplete="off" maxLength={120} value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="cv-email">E-mail</FieldLabel><Input name="cv-email" id="cv-email" type="email" autoComplete="off" spellCheck={false} maxLength={254} value={email} readOnly={!!pedido} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field>
            <FieldLabel htmlFor="cv-cargo">Cargo</FieldLabel>
            <Select value={cargo} onValueChange={(v) => setCargo(v as Cargo)}>
              <SelectTrigger id="cv-cargo"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{CARGOS.map(([v, r]) => <SelectItem key={v} value={v}>{r}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="cv-base">Permissões iniciais</FieldLabel>
            <Select value={base} onValueChange={setBase}>
              <SelectTrigger id="cv-base"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value="cargo">Modelo do cargo escolhido</SelectItem>{comNome.map((m) => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
            <FieldDescription>Depois você ajusta na página da pessoa. Modelos novos se cadastram em Acessos → Modelos de permissão.</FieldDescription>
          </Field>
          {erro && <FieldError role="alert">{erro}</FieldError>}
        </FieldGroup>
      </Folha>
    </>
  );
}

export function Membro() {
  const { id = '' } = useParams();
  const eu = usePerfil();
  const navegar = useNavigate();
  const membros = useMembros();
  const m = membros.data?.find((x) => x.id === id);
  if (membros.isPending) return <Pagina titulo="Pessoa" voltar={{ para: '/acessos', rotulo: 'Acessos' }}><CarregandoLista /></Pagina>;
  if (!m) return <Pagina titulo="Pessoa" voltar={{ para: '/acessos', rotulo: 'Acessos' }}><BlocoErro erro={new ErroApp({ erro: 'nao_encontrado' })} tentarDeNovo={() => navegar('/acessos')} /></Pagina>;
  return (
    <Pagina titulo={m.nome} voltar={{ para: '/acessos', rotulo: 'Acessos' }}>
      {m.id === eu.membro.id ? (
        <Grupo><Linha icone={ShieldAlert} cor="laranja" titulo="Este é o seu acesso" descricao="Ninguém altera o próprio acesso. Peça a outro administrador." /></Grupo>
      ) : <EditarMembro m={m} />}
    </Pagina>
  );
}

function EditarMembro({ m }: { m: Membro }) {
  const qc = useQueryClient();
  const perms = usePermissoesDe(m.id);
  const [cargo, setCargo] = useState<Cargo>(m.cargo);
  const [ativo, setAtivo] = useState(m.ativo);
  const [prazo, setPrazo] = useState(m.acesso_expira_em?.slice(0, 10) ?? '');
  const [mapa, setMapa] = useState<Mapa>({});
  const [salvando, setSalvando] = useState(false);
  const [comoModelo, setComoModelo] = useState(false);
  const [apagar, setApagar] = useState(false);
  useEffect(() => { if (perms.data) setMapa(paraMapa(perms.data)); }, [perms.data]);
  const lista = useMemo(() => paraLista(mapa), [mapa]);
  function aplicar(calcular: (atual: Mapa) => Promise<Mapa>) {
    calcular(mapa).then((n) => { setMapa(n); toast.info('Aplicado na tela. Revise e toque em Salvar.'); }).catch((e) => toast.error(msg(e)));
  }

  async function salvar() {
    setSalvando(true);
    try {
      const expira = prazo ? new Date(`${prazo}T23:59:59-03:00`).toISOString() : null;
      if (cargo !== m.cargo || ativo !== m.ativo || expira?.slice(0, 10) !== m.acesso_expira_em?.slice(0, 10)) {
        await fonte().rpc('alterar_membro', { p_membro: m.id, p_cargo: cargo, p_ativo: ativo, p_acesso_expira_em: expira });
      }
      await fonte().rpc('definir_permissoes', { p_membro: m.id, p_permissoes: lista });
      toast.success('Acesso atualizado. A pessoa foi avisada.');
      for (const k of [chaves.membros, chaves.permissoes(m.id), chaves.auditoria]) void qc.invalidateQueries({ queryKey: k });
    } catch (e) { toast.error(msg(e)); } finally { setSalvando(false); }
  }
  const aplicarModelo = () => aplicar(async () => paraMapa((await fonte().rpc<{ permissoes: Permissao[] }>('modelo_permissoes', { p_cargo: cargo })).permissoes));
  return (
    <>
      <Grupo titulo="Cargo e situação">
        <div className="flex flex-col gap-4 px-4 py-3">
          <Field>
            <FieldLabel htmlFor="m-cargo">Cargo</FieldLabel>
            <Select value={cargo} onValueChange={(v) => setCargo(v as Cargo)}>
              <SelectTrigger id="m-cargo"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{CARGOS.map(([v, r]) => <SelectItem key={v} value={v}>{r}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field orientation="horizontal">
            <FieldContent><FieldLabel htmlFor="m-ativo">Acesso ativo</FieldLabel><FieldDescription>Desligado: a pessoa não entra mais.</FieldDescription></FieldContent>
            <Switch id="m-ativo" checked={ativo} onCheckedChange={setAtivo} />
          </Field>
          <Field>
            <FieldLabel htmlFor="m-prazo">Acesso até (opcional)</FieldLabel>
            <Input name="m-prazo" id="m-prazo" type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
            <FieldDescription>Para acesso temporário: termina sozinho no fim do dia escolhido.</FieldDescription>
          </Field>
        </div>
      </Grupo>
      <Grupo titulo="Permissões" acao={<Button variant="link" size="xs" onClick={() => void aplicarModelo()}>Usar modelo do cargo</Button>}
        rodape="“Só os próprios” em Ver faz a pessoa enxergar apenas o que ela mesma lançou. Dados de saúde só são marcados um a um, de propósito.">
        <div className="flex flex-col gap-1.5 px-4 py-3">
          <FieldLabel htmlFor="m-perfil">Perfil pronto</FieldLabel>
          <SeletorPerfil id="m-perfil" aoAplicar={aplicar} />
        </div>
        {perms.isPending ? <Linha titulo="Carregando…" /> : <GradePermissoes mapa={mapa} aoMudar={setMapa} prefixo="m" />}
        <div className="px-4 py-2"><Button variant="link" size="xs" className="px-0" onClick={() => setComoModelo(true)}>Salvar estas permissões como modelo</Button></div>
      </Grupo>
      <Button size="lg" disabled={salvando || perms.isPending} onClick={() => void salvar()}>{salvando && <Spinner data-icon="inline-start" />}{salvando ? 'Salvando…' : 'Salvar acesso'}</Button>
      <Button size="lg" variant="ghost" className="text-destructive" onClick={() => setApagar(true)}><Trash2 data-icon="inline-start" aria-hidden="true" />Apagar acesso</Button>
      {comoModelo && <FolhaModelo inicial={mapa} aoFechar={() => setComoModelo(false)} />}
      {apagar && <FolhaApagarMembro m={m} aoFechar={() => setApagar(false)} />}
    </>
  );
}

const FMT_HORA = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

export function Auditoria() {
  const a = useAuditoria();
  const [exportar, setExportar] = useState(false);
  const itens = a.data?.pages.flat() ?? [];
  return (
    <Pagina titulo="Auditoria" voltar={{ para: '/acessos', rotulo: 'Acessos' }}
      acoes={<Button variant="ghost" onClick={() => setExportar(true)}><FileDown data-icon="inline-start" aria-hidden="true" />Exportar</Button>}>
      <p className="text-muted-foreground -mt-2 text-[15px] text-pretty">Registro imutável: nem administradores conseguem alterar ou apagar. Exporte todo mês como backup.</p>
      <ExportarAuditoria aberta={exportar} aoMudar={setExportar} />
      {a.isPending ? <CarregandoLista linhas={8} /> : a.isError ? <BlocoErro erro={a.error} tentarDeNovo={() => void a.refetch()} /> : (
        <Grupo>
          {itens.map((i) => (
            <Linha key={i.id} icone={History} cor={i.acao === 'acesso_negado' ? 'vermelho' : 'cinza'}
              titulo={`${ACAO_AUD[i.acao] ?? i.acao}${i.tabela ? ` ${TABELA_AUD[i.tabela] ?? i.tabela}` : i.registro_id ? ` · ${i.registro_id}` : ''}`}
              descricao={`${i.autor ?? 'Sistema'} · ${FMT_HORA.format(new Date(i.em))}`} />
          ))}
        </Grupo>
      )}
      {a.hasNextPage && <Button variant="secondary" disabled={a.isFetchingNextPage} onClick={() => void a.fetchNextPage()}>{a.isFetchingNextPage && <Spinner data-icon="inline-start" />}Carregar mais</Button>}
    </Pagina>
  );
}

/** O servidor exige administrador com 2FA recente, limita o período a 1 ano e registra a própria exportação. */
function ExportarAuditoria({ aberta, aoMudar }: { aberta: boolean; aoMudar: (v: boolean) => void }) {
  const perfil = usePerfil();
  const membros = useMembros(aberta);
  const hoje = hojeSP();
  const [inicio, setInicio] = useState(() => mesAnterior(hoje));
  const [fim, setFim] = useState(() => somarDias(competencia(hoje), -1));
  const [pessoa, setPessoa] = useState('todas');
  const [ocupado, setOcupado] = useState<null | 'csv' | 'pdf'>(null);
  const [erro, setErro] = useState<string | null>(null);
  const nomePessoa = pessoa === 'todas' ? null : membros.data?.find((m) => m.id === pessoa)?.nome ?? null;

  async function baixarComo(tipo: 'csv' | 'pdf') {
    if (ocupado) return;
    if (!inicio || !fim || inicio > fim) { setErro('A data inicial precisa ser antes da final.'); return; }
    setErro(null); setOcupado(tipo);
    try {
      // período grande pode passar de 20 s: espera até 1 minuto (o servidor já limita a 20 mil linhas)
      const r = await fonte().rpc<ExportacaoAuditoria>('exportar_auditoria', {
        p_inicio: inicio, p_fim: fim, p_membro: pessoa === 'todas' ? null : pessoa,
      }, { tempoLimiteMs: 60_000 });
      const e = { ...r, inicio, fim };
      // PDF grande trava o celular: acima do limite, entrega o CSV (a exportação já foi contada)
      if (tipo === 'pdf' && e.linhas.length > LIMITE_PDF_AUDITORIA) {
        baixar(csvAuditoria(e.linhas), nomeArquivoAuditoria(e, 'csv', nomePessoa), 'text/csv;charset=utf-8');
        toast.info(`São ${contar(e.linhas.length, 'registro', 'registros')}: grande demais para PDF. Baixamos em CSV.`);
        return;
      }
      if (tipo === 'csv') baixar(csvAuditoria(e.linhas), nomeArquivoAuditoria(e, 'csv', nomePessoa), 'text/csv;charset=utf-8');
      else baixar(await pdfAuditoria(e, perfil.membro.nome, nomePessoa), nomeArquivoAuditoria(e, 'pdf', nomePessoa), 'application/pdf');
      if (e.truncado) toast.warning(`Saíram só os primeiros ${contar(e.linhas.length, 'registro', 'registros')}. Use um período menor.`);
      else toast.success(`Auditoria exportada: ${contar(e.linhas.length, 'registro', 'registros')}`);
    } catch (e) { setErro(e instanceof ErroApp ? e.message : 'Não foi possível exportar.'); }
    finally { setOcupado(null); }
  }

  return (
    <>
      <Folha aberta={aberta} aoMudar={aoMudar} titulo="Exportar auditoria"
        descricao="CSV completo para o backup do mês; PDF para entregar. A exportação também fica registrada.">
        <FieldGroup className="pb-6">
          <div className="grid grid-cols-2 gap-4">
            <Field><FieldLabel htmlFor="ea-ini">De</FieldLabel><Input name="ea-ini" id="ea-ini" type="date" value={inicio} max={fim} onChange={(e) => setInicio(e.target.value)} /></Field>
            <Field><FieldLabel htmlFor="ea-fim">Até</FieldLabel><Input name="ea-fim" id="ea-fim" type="date" value={fim} min={inicio} max={hoje} onChange={(e) => setFim(e.target.value)} /></Field>
          </div>
          <Field>
            <FieldLabel htmlFor="ea-pessoa">Pessoa</FieldLabel>
            <Select value={pessoa} onValueChange={setPessoa}>
              <SelectTrigger id="ea-pessoa"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="todas">Todas as pessoas</SelectItem>
                {membros.data?.map((m) => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
            <FieldDescription>Com uma pessoa escolhida, sai o que ela fez e o que fizeram sobre ela (útil para pedidos de dados pessoais).</FieldDescription>
          </Field>
          <FieldDescription>Período de até 1 ano, no horário de São Paulo. PDF até {LIMITE_PDF_AUDITORIA.toLocaleString('pt-BR')} registros; acima disso sai em CSV.</FieldDescription>
          {erro && <FieldError role="alert">{erro}</FieldError>}
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Button disabled={!!ocupado} onClick={() => void baixarComo('csv')}>{ocupado === 'csv' ? <Spinner data-icon="inline-start" /> : <FileSpreadsheet data-icon="inline-start" aria-hidden="true" />}Baixar CSV</Button>
            <Button variant="secondary" disabled={!!ocupado} onClick={() => void baixarComo('pdf')}>{ocupado === 'pdf' ? <Spinner data-icon="inline-start" /> : <FileDown data-icon="inline-start" aria-hidden="true" />}Baixar PDF</Button>
          </div>
        </FieldGroup>
      </Folha>
    </>
  );
}

function FolhaCancelarConvite({ convite, aoFechar }: { convite: { id: string; nome: string; email: string }; aoFechar: () => void }) {
  const qc = useQueryClient();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function cancelar() {
    setOcupado(true); setErro(null);
    try {
      await fonte().rpc('cancelar_convite', { p_convite: convite.id });
      toast.success('Convite cancelado');
      for (const k of [chaves.convites, chaves.auditoria]) void qc.invalidateQueries({ queryKey: k });
      aoFechar();
    } catch (e) { setErro(msgErro(e)); } finally { setOcupado(false); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && !ocupado && aoFechar()} titulo="Cancelar convite" descricao={`${convite.nome} · ${convite.email}`}
      rodape={<Button size="lg" variant="destructive" className="w-full" disabled={ocupado} onClick={() => void cancelar()}>{ocupado && <Spinner data-icon="inline-start" />}Cancelar convite</Button>}>
      <div className="flex flex-col gap-3 pb-2 text-[15px]">
        <p>O link que foi para o e-mail deixa de funcionar. Se precisar, é só convidar de novo.</p>
        {erro && <p role="alert" className="text-destructive">{erro}</p>}
      </div>
    </Folha>
  );
}

function FolhaApagarMembro({ m, aoFechar }: { m: Membro; aoFechar: () => void }) {
  const qc = useQueryClient();
  const navegar = useNavigate();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function apagar() {
    setOcupado(true); setErro(null);
    try {
      await fonte().rpc('apagar_membro', { p_membro: m.id });
      toast.success('Acesso apagado');
      for (const k of [chaves.membros, chaves.convites, chaves.auditoria]) void qc.invalidateQueries({ queryKey: k });
      navegar('/acessos', { replace: true });
    } catch (e) { setErro(msgErro(e)); setOcupado(false); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && !ocupado && aoFechar()} titulo="Apagar acesso" descricao={`${m.nome} · ${m.email}`}
      rodape={<Button size="lg" variant="destructive" className="w-full" disabled={ocupado} onClick={() => void apagar()}>{ocupado && <Spinner data-icon="inline-start" />}Apagar de vez</Button>}>
      <div className="flex flex-col gap-3 pb-2 text-[15px]">
        <p>A pessoa sai do sistema e o login dela é apagado. Não dá para desfazer; se precisar, é só convidar de novo.</p>
        <p className="text-muted-foreground text-[13px]">Só dá para apagar quem nunca registrou nada. Quem já tem histórico continua no sistema: nesse caso, desligue o "Acesso ativo".</p>
        {erro && <p role="alert" className="text-destructive">{erro}</p>}
      </div>
    </Folha>
  );
}
