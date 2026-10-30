import {
  BadgeCheck, BookUser, Building2, CalendarClock, Check, ClipboardList, FileCheck2, HandCoins, Landmark, Plus, Settings2, Undo2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { BlocoErro, CarregandoLista, Vazio } from '@/components/app/estados';
import { Folha } from '@/components/app/folha';
import { Grupo, Linha } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { Valor } from '@/components/app/valor';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { usePerfil } from '@/app/sessao';
import {
  useAcaoF3, useDocumentosVerba, useFiliacoes, useLancamentos, useMembros, useOrigensVerba, useParcelasVerba, useProjetos, useTiposVerba, useVerbas,
} from '@/dados/consultas';
import type { CategoriaOrigem, FormaRecebimento, ParcelaVerba, SituacaoVerba, Verba } from '@/dados/tipos';
import { pode } from '@/lib/acesso';
import { formatarData, hojeSP, somarDias } from '@/lib/datas';
import { formatarBRL, lerValorBRL, mascararValor, paraCampo, somar } from '@/lib/dinheiro';
import { contar } from '@/lib/texto';
import { SeletorPessoa, erroMsg, nomeDe } from '@/telas/organizacao/comum';
import {
  EditorRegras, FINAIS, NOME_CATEGORIA, NOME_FORMA, NOME_SITUACAO_VERBA, SITUACOES_VERBA, regrasCompletas,
} from '@/telas/projetos/comum';

const GRUPOS: { titulo: string; situacoes: SituacaoVerba[] }[] = [
  { titulo: 'Em preparação', situacoes: ['ideia', 'pedido_enviado', 'em_analise'] },
  { titulo: 'Aprovadas', situacoes: ['aprovado', 'formalizado', 'recebido_parcial', 'recebido'] },
  { titulo: 'Em execução e prestação de contas', situacoes: ['em_execucao', 'prestacao_contas'] },
  { titulo: 'Encerradas, negadas ou canceladas', situacoes: ['encerrado', 'negado', 'cancelado'] },
];

export function Verbas() {
  const perfil = usePerfil();
  const verbas = useVerbas();
  const origens = useOrigensVerba();
  const [nova, setNova] = useState(false);
  const ativas = (verbas.data ?? []).filter((v) => !FINAIS.includes(v.situacao));
  const totalPedido = somar(ativas.filter((v) => ['ideia', 'pedido_enviado', 'em_analise'].includes(v.situacao)).map((v) => v.valor_pedido ?? '0'));
  const totalAprovado = somar(ativas.filter((v) => !['ideia', 'pedido_enviado', 'em_analise'].includes(v.situacao)).map((v) => v.valor_aprovado ?? v.valor_pedido ?? '0'));
  return (
    <Pagina titulo="Verbas" acoes={
      <>
        {pode(perfil, 'verbas', 'criar') && <Button size="icon" variant="ghost" aria-label="Nova verba" onClick={() => setNova(true)}><Plus aria-hidden="true" /></Button>}
        <Button asChild size="icon" variant="ghost"><Link to="/verbas/cadastros" aria-label="Tipos de verba e origens"><Settings2 aria-hidden="true" /></Link></Button>
      </>
    }>
      {verbas.isError ? <BlocoErro erro={verbas.error} tentarDeNovo={() => void verbas.refetch()} />
        : verbas.isPending ? <CarregandoLista linhas={4} rotulo="Carregando as verbas…" />
          : (verbas.data ?? []).length === 0 ? (
            <Vazio icone={HandCoins} titulo="Nenhuma verba prevista ainda" descricao="Cadastre emendas, editais, patrocínios e doações antes de chegarem, com as regras de cada um."
              acao={pode(perfil, 'verbas', 'criar') ? <Button onClick={() => setNova(true)}><Plus data-icon="inline-start" aria-hidden="true" />Nova verba</Button> : undefined} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-card rounded-[18px] p-4"><p className="text-muted-foreground text-[13px]">Pedido, ainda sem resposta</p><Valor valor={totalPedido} className="font-rounded text-[22px] font-bold" /></div>
                <div className="bg-card rounded-[18px] p-4"><p className="text-muted-foreground text-[13px]">Aprovado ou em andamento</p><Valor valor={totalAprovado} className="font-rounded text-[22px] font-bold" /></div>
              </div>
              {GRUPOS.map((g) => {
                const lista = (verbas.data ?? []).filter((v) => g.situacoes.includes(v.situacao));
                if (!lista.length) return null;
                return (
                  <Grupo key={g.titulo} titulo={`${g.titulo} (${lista.length})`}>
                    {lista.map((v) => (
                      <Linha key={v.id} icone={HandCoins} cor={FINAIS.includes(v.situacao) ? 'cinza' : g.titulo === 'Em preparação' ? 'laranja' : 'verde'}
                        titulo={v.titulo} para={`/verbas/${v.id}`}
                        descricao={[NOME_SITUACAO_VERBA[v.situacao], origens.data?.find((o) => o.id === v.origem_id)?.nome, v.prazo_pedido && `prazo ${formatarData(v.prazo_pedido)}`].filter(Boolean).join(' · ')}
                        valor={<Valor valor={v.valor_aprovado ?? v.valor_pedido ?? null} className="text-foreground text-[15px]" />} />
                    ))}
                  </Grupo>
                );
              })}
            </>
          )}
      {nova && <FormVerba verba={null} aoFechar={() => setNova(false)} />}
    </Pagina>
  );
}

export function FormVerba({ verba, aoFechar }: { verba: Verba | null; aoFechar: () => void }) {
  const tipos = useTiposVerba();
  const origens = useOrigensVerba();
  const salvar = useAcaoF3('salvar_verba');
  const navegar = useNavigate();
  const [id] = useState(() => verba?.id ?? crypto.randomUUID());
  const [titulo, setTitulo] = useState(verba?.titulo ?? '');
  const [tipo, setTipo] = useState(verba?.tipo_id ?? '');
  const [origem, setOrigem] = useState(verba?.origem_id ?? '');
  const [forma, setForma] = useState<FormaRecebimento>(verba?.forma_recebimento ?? 'caixa_livre');
  const [pedido, setPedido] = useState(paraCampo(verba?.valor_pedido));
  const [aprovado, setAprovado] = useState(paraCampo(verba?.valor_aprovado));
  const [prazo, setPrazo] = useState(verba?.prazo_pedido ?? '');
  const [responsavel, setResponsavel] = useState(verba?.responsavel ?? '');
  const [descricao, setDescricao] = useState(verba?.descricao ?? '');
  const [novaOrigem, setNovaOrigem] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function enviar() {
    setErro(null);
    const vp = pedido.trim() ? lerValorBRL(pedido) : null, va = aprovado.trim() ? lerValorBRL(aprovado) : null;
    if (pedido.trim() && !vp) return setErro('Confira o valor pedido.');
    if (aprovado.trim() && !va) return setErro('Confira o valor aprovado.');
    try {
      await salvar.mutateAsync({ p: { id, titulo: titulo.trim(), tipo_id: tipo, origem_id: origem, forma_recebimento: forma, valor_pedido: vp, valor_aprovado: va,
        prazo_pedido: prazo || null, responsavel: responsavel || null, descricao: descricao.trim() || null } });
      toast.success(verba ? 'Verba atualizada' : 'Verba cadastrada');
      aoFechar();
      if (!verba) navegar(`/verbas/${id}`);
    } catch (e) { setErro(erroMsg(e)); }
  }
  const tiposAtivos = (tipos.data ?? []).filter((t) => t.ativo || t.id === verba?.tipo_id);
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo={verba ? 'Editar verba' : 'Nova verba'} larga
      descricao="O que é, de quem vem, como chega, quanto e quando."
      rodape={<Button size="lg" className="w-full" disabled={titulo.trim().length < 2 || !tipo || !origem || salvar.isPending} onClick={() => void enviar()}>
        {salvar.isPending && <Spinner data-icon="inline-start" />}{verba ? 'Salvar mudanças' : 'Cadastrar verba'}</Button>}>
      <FieldGroup className="pb-2">
        <Field><FieldLabel htmlFor="vb-titulo">Nome da verba</FieldLabel>
          <Input id="vb-titulo" name="vb-titulo" maxLength={160} autoComplete="off" placeholder="Ex.: Emenda para cadeiras de jogo…" value={titulo} onChange={(e) => setTitulo(e.target.value)} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="vb-tipo">O que é</FieldLabel>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger id="vb-tipo"><SelectValue placeholder={tiposAtivos.length ? 'Escolha o tipo' : 'Crie os tipos em Cadastros'} /></SelectTrigger>
              <SelectContent><SelectGroup>{tiposAtivos.map((t) => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
            {!verba && <FieldDescription>As regras do tipo são copiadas e podem ser ajustadas depois.</FieldDescription>}
          </Field>
          <Field>
            <FieldLabel htmlFor="vb-origem">De quem vem</FieldLabel>
            <Select value={origem} onValueChange={(v) => (v === 'nova' ? setNovaOrigem(true) : setOrigem(v))}>
              <SelectTrigger id="vb-origem"><SelectValue placeholder="Escolha a origem" /></SelectTrigger>
              <SelectContent><SelectGroup>
                {(origens.data ?? []).filter((o) => o.ativa || o.id === origem).map((o) => <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>)}
                <SelectItem value="nova">+ Nova origem…</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="vb-forma">Como chega</FieldLabel>
          <Select value={forma} onValueChange={(v) => setForma(v as FormaRecebimento)}>
            <SelectTrigger id="vb-forma"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{(Object.keys(NOME_FORMA) as FormaRecebimento[]).map((f) => <SelectItem key={f} value={f}>{NOME_FORMA[f]}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
          {(forma === 'pago_pela_origem' || forma === 'bens') && <FieldDescription>O dinheiro não passa pelo caixa: o sistema guarda o valor estimado à parte.</FieldDescription>}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field><FieldLabel htmlFor="vb-pedido">Valor pedido (R$)</FieldLabel><Input id="vb-pedido" name="vb-pedido" inputMode="numeric" autoComplete="off" placeholder="0,00" value={pedido} onChange={(e) => setPedido(mascararValor(e.target.value))} /></Field>
          <Field><FieldLabel htmlFor="vb-aprovado">Valor aprovado (R$)</FieldLabel><Input id="vb-aprovado" name="vb-aprovado" inputMode="numeric" autoComplete="off" placeholder="0,00" value={aprovado} onChange={(e) => setAprovado(mascararValor(e.target.value))} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field><FieldLabel htmlFor="vb-prazo">Prazo do pedido (opcional)</FieldLabel><Input id="vb-prazo" name="vb-prazo" type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} /></Field>
          <SeletorPessoa id="vb-resp" rotulo="Quem cuida" valor={responsavel} aoMudar={setResponsavel} opcional />
        </div>
        <Field><FieldLabel htmlFor="vb-desc">Observações (opcional)</FieldLabel><Textarea id="vb-desc" name="vb-desc" rows={3} maxLength={2000} value={descricao} onChange={(e) => setDescricao(e.target.value)} /></Field>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
      {novaOrigem && <FormOrigem aoFechar={(nova) => { setNovaOrigem(false); if (nova) setOrigem(nova); }} />}
    </Folha>
  );
}

function FormOrigem({ aoFechar }: { aoFechar: (id?: string) => void }) {
  const salvar = useAcaoF3('salvar_origem_verba');
  const [id] = useState(() => crypto.randomUUID());
  const [nome, setNome] = useState('');
  const [categoria, setCategoria] = useState<CategoriaOrigem>('empresa');
  const [contato, setContato] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  async function enviar() {
    setErro(null);
    try { await salvar.mutateAsync({ p: { id, nome: nome.trim(), categoria, contato: contato.trim() || null } }); toast.success('Origem cadastrada'); aoFechar(id); }
    catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo="Nova origem" descricao="Quem dá a verba. Fica cadastrada para as próximas."
      rodape={<Button size="lg" className="w-full" disabled={nome.trim().length < 2 || salvar.isPending} onClick={() => void enviar()}>{salvar.isPending && <Spinner data-icon="inline-start" />}Cadastrar</Button>}>
      <FieldGroup className="pb-2">
        <Field><FieldLabel htmlFor="og-nome">Nome</FieldLabel><Input id="og-nome" name="og-nome" maxLength={120} autoComplete="off" value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
        <Field>
          <FieldLabel htmlFor="og-cat">Categoria</FieldLabel>
          <Select value={categoria} onValueChange={(v) => setCategoria(v as CategoriaOrigem)}>
            <SelectTrigger id="og-cat"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{(Object.keys(NOME_CATEGORIA) as CategoriaOrigem[]).map((c) => <SelectItem key={c} value={c}>{NOME_CATEGORIA[c]}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
          {categoria === 'pessoa_fisica' && <FieldDescription>Para pessoa física, guarde só o nome. O CPF vai no recibo, quando houver (Fase 5).</FieldDescription>}
        </Field>
        <Field><FieldLabel htmlFor="og-contato">Contato (opcional)</FieldLabel><Input id="og-contato" name="og-contato" maxLength={160} autoComplete="off" placeholder="Ex.: gabinete, setor de patrocínio…" value={contato} onChange={(e) => setContato(e.target.value)} /></Field>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

export function DetalheVerba() {
  const { id = '' } = useParams();
  const perfil = usePerfil();
  const verbas = useVerbas();
  const tipos = useTiposVerba();
  const origens = useOrigensVerba();
  const membros = useMembros();
  const projetos = useProjetos();
  const parcelas = useParcelasVerba(id);
  const documentos = useDocumentosVerba(id);
  const situacao = useAcaoF3('mudar_situacao_verba');
  const doc = useAcaoF3('salvar_documento_verba');
  const [folha, setFolha] = useState<null | 'editar' | 'parcelas' | 'regras' | 'formalizar' | { receber: ParcelaVerba }>(null);
  const [novoDoc, setNovoDoc] = useState('');
  const v = verbas.data?.find((x) => x.id === id);
  const voltar = { para: '/verbas', rotulo: 'Verbas' };
  if (verbas.isPending) return <Pagina titulo="Verba" voltar={voltar}><CarregandoLista linhas={4} /></Pagina>;
  if (!v) return <Pagina titulo="Verba" voltar={voltar}><Vazio icone={HandCoins} titulo="Verba não encontrada" descricao="Ela pode não estar visível para você." /></Pagina>;
  const editar = pode(perfil, 'verbas', 'editar') || v.criado_por === perfil.membro.id;
  const final = FINAIS.includes(v.situacao);
  const regras = regrasCompletas(v.regras);
  const projeto = projetos.data?.find((p) => p.verba_id === v.id);
  const recebido = somar((parcelas.data ?? []).filter((x) => x.valor_recebido).map((x) => x.valor_recebido!));
  const cuida = pode(perfil, 'verbas', 'editar') || [v.criado_por, v.responsavel ?? v.criado_por].includes(perfil.membro.id);
  return (
    <Pagina titulo={v.titulo} voltar={voltar}
      acoes={editar && !final ? <Button variant="ghost" size="sm" onClick={() => setFolha('editar')}>Editar</Button> : undefined}>
      <Grupo>
        <Linha icone={BadgeCheck} cor={final ? 'cinza' : 'verde'} titulo="Situação" valor={
          pode(perfil, 'verbas', 'editar') && (!final || perfil.membro.admin) ? (
            <Select value={v.situacao} onValueChange={(s) => situacao.mutate({ p_id: v.id, p_situacao: s }, { onError: (e) => toast.error(erroMsg(e)) })}>
              <SelectTrigger aria-label="Mudar a situação da verba" className="h-9 w-auto min-w-40"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{SITUACOES_VERBA.map((s) => <SelectItem key={s} value={s}>{NOME_SITUACAO_VERBA[s]}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          ) : NOME_SITUACAO_VERBA[v.situacao]} />
        <Linha icone={ClipboardList} cor="laranja" titulo="O que é" valor={tipos.data?.find((t) => t.id === v.tipo_id)?.nome} />
        <Linha icone={Building2} cor="indigo" titulo="De quem vem" valor={origens.data?.find((o) => o.id === v.origem_id)?.nome} />
        <Linha icone={HandCoins} cor="teal" titulo="Como chega" valor={NOME_FORMA[v.forma_recebimento]} />
        <Linha icone={HandCoins} cor="verde" titulo="Pedido · aprovado · recebido"
          valor={<span className="numeros text-[15px]">{formatarBRL(v.valor_pedido)} · {formatarBRL(v.valor_aprovado)} · {formatarBRL(recebido)}</span>} />
        {v.prazo_pedido && <Linha icone={CalendarClock} cor="vermelho" titulo="Prazo do pedido" valor={formatarData(v.prazo_pedido)} />}
        <Linha icone={BadgeCheck} cor="cinza" titulo="Quem cuida" valor={nomeDe(membros.data, v.responsavel ?? v.criado_por)} />
        {v.filiacao_id && <DependeDeFiliacao filiacao={v.filiacao_id} />}
      </Grupo>
      {v.descricao && <p className="bg-card rounded-[14px] p-4 text-[15px] whitespace-pre-wrap">{v.descricao}</p>}

      {projeto ? (
        <Grupo><Linha icone={Landmark} cor="roxo" titulo="Projeto desta verba" descricao={projeto.nome} para={`/projetos/${projeto.id}`} /></Grupo>
      ) : !final && pode(perfil, 'projetos', 'criar') && pode(perfil, 'verbas', 'editar') && (
        <Grupo rodape="Quando a verba é formalizada, vira projeto com orçamento por rubrica e acompanhamento da execução.">
          <Linha icone={Landmark} cor="roxo" titulo="Formalizar como projeto" aoTocar={() => setFolha('formalizar')} seta />
        </Grupo>
      )}

      <Grupo titulo="Parcelas" acao={pode(perfil, 'verbas', 'editar') && !final ? <Button variant="link" size="xs" onClick={() => setFolha('parcelas')}>Planejar</Button> : undefined}>
        {(parcelas.data ?? []).length === 0 && <Linha titulo="Nenhuma parcela prevista" descricao="Planeje quando o dinheiro (ou o apoio) deve chegar." />}
        {(parcelas.data ?? []).map((x) => (
          <Linha key={x.id} icone={x.recebido_em ? Check : CalendarClock} cor={x.recebido_em ? 'verde' : x.data_prevista < hojeSP() ? 'vermelho' : 'cinza'}
            titulo={`Parcela ${x.numero}`}
            descricao={x.recebido_em ? `Recebida em ${formatarData(x.recebido_em)}` : `Prevista para ${formatarData(x.data_prevista)}${x.data_prevista < hojeSP() ? ' · atrasada' : ''}`}
            valor={<span className="flex items-center gap-2"><Valor valor={x.valor_recebido ?? x.valor} className="text-foreground text-[15px]" />
              {pode(perfil, 'verbas', 'editar') && !final && (x.recebido_em
                ? <DesfazerRecebimento parcela={x.id} />
                : <Button size="sm" variant="secondary" onClick={() => setFolha({ receber: x })}>Recebi</Button>)}</span>} />
        ))}
      </Grupo>

      <Grupo titulo="Documentos" rodape="Marque o que já foi entregue.">
        {(['antes', 'depois'] as const).flatMap((m) => (documentos.data ?? []).filter((d) => d.momento === m).map((d) => (
          <div key={d.id} className="flex items-center gap-3 px-4 py-3">
            <Checkbox id={`dv-${d.id}`} checked={!!d.entregue_em} disabled={!cuida || final}
              onCheckedChange={(c) => doc.mutate({ p_verba: v.id, p: { id: d.id, entregue: c === true } }, { onError: (e) => toast.error(erroMsg(e)) })} />
            <label htmlFor={`dv-${d.id}`} className="flex-1 text-[17px]">{d.nome}<span className="text-muted-foreground block text-[13px]">{m === 'antes' ? 'Antes do pedido' : 'Depois do recebimento'}{d.entregue_em ? ` · entregue em ${formatarData(d.entregue_em)}` : ''}</span></label>
          </div>
        )))}
        {(documentos.data ?? []).length === 0 && <Linha icone={FileCheck2} cor="cinza" titulo="Nenhum documento exigido" />}
        {cuida && !final && (
          <form className="flex items-end gap-2 p-3" onSubmit={(e) => { e.preventDefault(); if (novoDoc.trim().length >= 2) doc.mutate({ p_verba: v.id, p: { id: crypto.randomUUID(), momento: 'depois', nome: novoDoc.trim() } }, { onSuccess: () => setNovoDoc(''), onError: (x) => toast.error(erroMsg(x)) }); }}>
            <Field className="flex-1"><FieldLabel htmlFor="dv-novo" className="sr-only">Novo documento</FieldLabel>
              <Input id="dv-novo" name="dv-novo" maxLength={200} autoComplete="off" placeholder="Adicionar documento…" value={novoDoc} onChange={(e) => setNovoDoc(e.target.value)} /></Field>
            <Button type="submit" size="icon" variant="secondary" aria-label="Adicionar documento" disabled={novoDoc.trim().length < 2}><Plus aria-hidden="true" /></Button>
          </form>
        )}
      </Grupo>

      <Grupo titulo="Regras desta verba" acao={pode(perfil, 'verbas', 'editar') && !final ? <Button variant="link" size="xs" onClick={() => setFolha('regras')}>Ajustar</Button> : undefined}>
        <Linha titulo="Conta específica" valor={regras.conta_especifica ? 'Sim' : 'Não'} />
        <Linha titulo="Só em rubricas aprovadas" valor={regras.exige_rubricas ? 'Sim' : 'Não'} />
        <Linha titulo="Pagamento" valor={regras.exige_transferencia ? 'Só transferência' : regras.aceita_dinheiro ? 'Qualquer forma' : 'Sem dinheiro vivo'} />
        <Linha titulo="Prestação de contas" valor={`${regras.prestacao_parcial ? 'Parcial e final' : 'Final'} · ${contar(regras.prazo_prestacao_dias, 'dia', 'dias')}`} />
        <Linha titulo="Guardar documentos" valor={contar(regras.guarda_anos, 'ano', 'anos')} />
        {regras.contrapartidas.length > 0 && <Linha titulo="Contrapartidas" descricao={regras.contrapartidas.join(' · ')} />}
      </Grupo>

      {folha === 'editar' && <FormVerba verba={v} aoFechar={() => setFolha(null)} />}
      {folha === 'parcelas' && <FormParcelas verba={v} parcelas={parcelas.data ?? []} aoFechar={() => setFolha(null)} />}
      {folha === 'regras' && <FormRegrasVerba verba={v} aoFechar={() => setFolha(null)} />}
      {folha === 'formalizar' && <FormFormalizar verba={v} aoFechar={() => setFolha(null)} />}
      {folha && typeof folha === 'object' && <FormRecebimento verba={v} parcela={folha.receber} aoFechar={() => setFolha(null)} />}
    </Pagina>
  );
}

function DependeDeFiliacao({ filiacao }: { filiacao: string }) {
  const perfil = usePerfil();
  const filiacoes = useFiliacoes(pode(perfil, 'filiacoes', 'ver'));
  const f = filiacoes.data?.find((x) => x.id === filiacao);
  if (!pode(perfil, 'filiacoes', 'ver')) return <Linha icone={BookUser} cor="cinza" titulo="Depende de uma filiação" />;
  const risco = !!f && (['pendente', 'suspensa', 'encerrada'].includes(f.situacao) || (!!f.validade && f.validade < hojeSP()));
  return <Linha icone={BookUser} cor={risco ? 'vermelho' : 'azul'} titulo={`Depende de: ${f?.entidade ?? 'filiação'}`} para={`/filiacoes/${filiacao}`}
    descricao={risco ? 'Em risco: a filiação não está em dia.' : 'Filiação em dia.'} />;
}

function DesfazerRecebimento({ parcela }: { parcela: string }) {
  const desfazer = useAcaoF3('desfazer_recebimento');
  return <Button size="icon-sm" variant="ghost" aria-label="Desfazer o recebimento" disabled={desfazer.isPending}
    onClick={() => desfazer.mutate({ p_parcela: parcela }, { onError: (e) => toast.error(erroMsg(e)) })}><Undo2 aria-hidden="true" /></Button>;
}

function FormParcelas({ verba, parcelas, aoFechar }: { verba: Verba; parcelas: ParcelaVerba[]; aoFechar: () => void }) {
  const salvar = useAcaoF3('salvar_parcelas');
  const recebidas = parcelas.filter((x) => x.recebido_em);
  const [linhas, setLinhas] = useState(() => {
    const abertas = parcelas.filter((x) => !x.recebido_em).map((x) => ({ id: x.id, valor: paraCampo(x.valor), data: x.data_prevista }));
    return abertas.length ? abertas : [{ id: crypto.randomUUID(), valor: paraCampo(verba.valor_aprovado ?? verba.valor_pedido), data: somarDias(hojeSP(), 30) }];
  });
  const [erro, setErro] = useState<string | null>(null);
  const muda = (i: number, p: Partial<{ valor: string; data: string }>) => setLinhas((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)));
  async function enviar() {
    setErro(null);
    const p = linhas.map((x) => ({ id: x.id, valor: lerValorBRL(x.valor), data_prevista: x.data }));
    if (p.some((x) => !x.valor || !x.data_prevista)) return setErro('Confira valor e data de cada parcela.');
    try { await salvar.mutateAsync({ p_verba: verba.id, p }); toast.success('Parcelas salvas'); aoFechar(); } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo="Parcelas previstas" descricao={recebidas.length ? `${contar(recebidas.length, 'parcela já recebida fica', 'parcelas já recebidas ficam')} como está.` : 'Quando cada parte deve chegar.'}
      rodape={<Button size="lg" className="w-full" disabled={salvar.isPending} onClick={() => void enviar()}>{salvar.isPending && <Spinner data-icon="inline-start" />}Salvar parcelas</Button>}>
      <FieldGroup className="pb-2">
        {linhas.map((x, i) => (
          <div key={x.id} className="bg-muted/60 grid grid-cols-[1fr_1fr_auto] items-end gap-2 rounded-[14px] p-3">
            <Field><FieldLabel htmlFor={`pc-v${i}`}>Valor (R$)</FieldLabel><Input id={`pc-v${i}`} name="pc-v" inputMode="numeric" autoComplete="off" value={x.valor} onChange={(e) => muda(i, { valor: mascararValor(e.target.value) })} /></Field>
            <Field><FieldLabel htmlFor={`pc-d${i}`}>Previsão</FieldLabel><Input id={`pc-d${i}`} name="pc-d" type="date" value={x.data} onChange={(e) => muda(i, { data: e.target.value })} /></Field>
            <Button variant="ghost" size="icon" aria-label={`Remover a parcela ${i + 1}`} onClick={() => setLinhas((l) => l.filter((_, j) => j !== i))}><Undo2 aria-hidden="true" /></Button>
          </div>
        ))}
        <Button variant="secondary" onClick={() => setLinhas((l) => [...l, { id: crypto.randomUUID(), valor: '', data: somarDias(l.at(-1)?.data ?? hojeSP(), 30) }])}><Plus data-icon="inline-start" aria-hidden="true" />Adicionar parcela</Button>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

function FormRecebimento({ verba, parcela, aoFechar }: { verba: Verba; parcela: ParcelaVerba; aoFechar: () => void }) {
  const registrar = useAcaoF3('registrar_recebimento');
  const emDinheiro = verba.forma_recebimento === 'caixa_livre' || verba.forma_recebimento === 'conta_especifica';
  const filtro = useMemo(() => ({ tipo: 'entrada' as const, situacao: 'realizada' as const, inicio: somarDias(hojeSP(), -365) }), []);
  const entradas = useLancamentos(filtro);
  const [lanc, setLanc] = useState('');
  const [data, setData] = useState(hojeSP());
  const [valor, setValor] = useState(paraCampo(parcela.valor));
  const [erro, setErro] = useState<string | null>(null);
  const lista = (entradas.data?.pages.flat() ?? []).filter((l) => !l.estorno_de && !l.estornado);
  async function enviar() {
    setErro(null);
    try {
      await registrar.mutateAsync({ p_parcela: parcela.id, p: emDinheiro ? { lancamento_id: lanc } : { data, valor: lerValorBRL(valor) } });
      toast.success('Recebimento registrado'); aoFechar();
    } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo={`Recebi a parcela ${parcela.numero}`}
      descricao={emDinheiro ? 'Escolha a entrada já lançada no Dinheiro.' : 'O valor não passa pelo caixa: informe o valor estimado.'}
      rodape={<Button size="lg" className="w-full" disabled={(emDinheiro ? !lanc : !valor) || registrar.isPending} onClick={() => void enviar()}>{registrar.isPending && <Spinner data-icon="inline-start" />}Registrar</Button>}>
      <FieldGroup className="pb-2">
        {emDinheiro ? (
          <Field>
            <FieldLabel htmlFor="rc-lanc">Entrada no Dinheiro</FieldLabel>
            <Select value={lanc} onValueChange={setLanc}>
              <SelectTrigger id="rc-lanc"><SelectValue placeholder={lista.length ? 'Escolha a entrada' : 'Lance a entrada no Dinheiro primeiro'} /></SelectTrigger>
              <SelectContent><SelectGroup>{lista.slice(0, 80).map((l) => <SelectItem key={l.id} value={l.id}>{formatarData(l.data)} · {formatarBRL(l.valor)} · {l.descricao.slice(0, 40)}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
            {regrasCompletas(verba.regras).conta_especifica && <FieldDescription>Esta verba exige conta específica: a entrada precisa estar na conta do projeto.</FieldDescription>}
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field><FieldLabel htmlFor="rc-data">Data</FieldLabel><Input id="rc-data" name="rc-data" type="date" max={hojeSP()} value={data} onChange={(e) => setData(e.target.value)} /></Field>
            <Field><FieldLabel htmlFor="rc-valor">Valor estimado (R$)</FieldLabel><Input id="rc-valor" name="rc-valor" inputMode="numeric" autoComplete="off" value={valor} onChange={(e) => setValor(mascararValor(e.target.value))} /></Field>
          </div>
        )}
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

function FormRegrasVerba({ verba, aoFechar }: { verba: Verba; aoFechar: () => void }) {
  const salvar = useAcaoF3('salvar_verba');
  const [regras, setRegras] = useState(() => regrasCompletas(verba.regras));
  const [erro, setErro] = useState<string | null>(null);
  async function enviar() {
    setErro(null);
    try {
      await salvar.mutateAsync({ p: { id: verba.id, titulo: verba.titulo, tipo_id: verba.tipo_id, origem_id: verba.origem_id, forma_recebimento: verba.forma_recebimento,
        valor_pedido: verba.valor_pedido, valor_aprovado: verba.valor_aprovado, prazo_pedido: verba.prazo_pedido, responsavel: verba.responsavel, descricao: verba.descricao, regras } });
      toast.success('Regras atualizadas'); aoFechar();
    } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo="Regras desta verba" larga descricao="Ajuste caso a caso. Documentos novos entram pelo checklist da verba."
      rodape={<Button size="lg" className="w-full" disabled={salvar.isPending} onClick={() => void enviar()}>{salvar.isPending && <Spinner data-icon="inline-start" />}Salvar regras</Button>}>
      <div className="pb-2"><EditorRegras prefixo="rv" valor={regras} aoMudar={setRegras} />{erro && <FieldError role="alert">{erro}</FieldError>}</div>
    </Folha>
  );
}

function FormFormalizar({ verba, aoFechar }: { verba: Verba; aoFechar: () => void }) {
  const formalizar = useAcaoF3<Record<string, unknown>, { id: string }>('formalizar_verba');
  const navegar = useNavigate();
  const [projetoId] = useState(() => crypto.randomUUID());
  const [nome, setNome] = useState(verba.titulo.slice(0, 120));
  const [ini, setIni] = useState(hojeSP());
  const [fim, setFim] = useState(somarDias(hojeSP(), 365));
  const [contra, setContra] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const regras = regrasCompletas(verba.regras);
  async function enviar() {
    setErro(null);
    try {
      const r = await formalizar.mutateAsync({ p_verba: verba.id, p: { projeto_id: projetoId, nome: nome.trim(), vigencia_inicio: ini, vigencia_fim: fim,
        ...(contra.trim() ? { valor_contrapartida: lerValorBRL(contra) } : {}) } });
      toast.success('Projeto criado. Cadastre as rubricas do plano de trabalho.');
      aoFechar(); navegar(`/projetos/${r.id}`);
    } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo="Formalizar como projeto" descricao="O projeto herda as regras da verba e ganha uma tarefa de prestação de contas."
      rodape={<Button size="lg" className="w-full" disabled={nome.trim().length < 2 || !ini || !fim || formalizar.isPending} onClick={() => void enviar()}>{formalizar.isPending && <Spinner data-icon="inline-start" />}Criar projeto</Button>}>
      <FieldGroup className="pb-2">
        <Field><FieldLabel htmlFor="fz-nome">Nome do projeto</FieldLabel><Input id="fz-nome" name="fz-nome" maxLength={120} autoComplete="off" value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
        <FieldSet>
          <FieldLegend variant="label">Vigência</FieldLegend>
          <div className="grid grid-cols-2 gap-3">
            <Field><FieldLabel htmlFor="fz-ini">Início</FieldLabel><Input id="fz-ini" name="fz-ini" type="date" value={ini} onChange={(e) => setIni(e.target.value)} /></Field>
            <Field><FieldLabel htmlFor="fz-fim">Fim</FieldLabel><Input id="fz-fim" name="fz-fim" type="date" min={ini} value={fim} onChange={(e) => setFim(e.target.value)} /></Field>
          </div>
          <FieldDescription>Prestação de contas até {formatarData(somarDias(fim, regras.prazo_prestacao_dias))} ({contar(regras.prazo_prestacao_dias, 'dia', 'dias')} depois do fim).</FieldDescription>
        </FieldSet>
        <Field><FieldLabel htmlFor="fz-contra">Contrapartida da Associação Exemplo (R$, opcional)</FieldLabel><Input id="fz-contra" name="fz-contra" inputMode="numeric" autoComplete="off" placeholder="0,00" value={contra} onChange={(e) => setContra(mascararValor(e.target.value))} /></Field>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

export function CadastrosVerbas() {
  const perfil = usePerfil();
  const tipos = useTiposVerba();
  const origens = useOrigensVerba();
  const importar = useAcaoF3<Record<string, never>, { criados: number }>('importar_modelos_verba');
  const [tipoAberto, setTipoAberto] = useState<string | 'novo' | null>(null);
  const [novaOrigem, setNovaOrigem] = useState(false);
  const podeEditar = pode(perfil, 'verbas', 'editar');
  async function usarModelos() {
    try { const r = await importar.mutateAsync({}); toast.success(r.criados ? `${contar(r.criados, 'modelo adicionado', 'modelos adicionados')}` : 'Os modelos já estavam cadastrados'); }
    catch (e) { toast.error(erroMsg(e)); }
  }
  return (
    <Pagina titulo="Cadastros de verbas" voltar={{ para: '/verbas', rotulo: 'Verbas' }}>
      <Grupo titulo="Tipos de verba" acao={podeEditar ? <Button variant="link" size="xs" onClick={() => setTipoAberto('novo')}>Adicionar</Button> : undefined}
        rodape="Cada tipo traz um modelo de regras, copiado para cada verba nova.">
        {(tipos.data ?? []).length === 0 && <Linha titulo="Nenhum tipo ainda" />}
        {(tipos.data ?? []).map((t) => <Linha key={t.id} icone={ClipboardList} cor={t.ativo ? 'laranja' : 'cinza'} titulo={t.nome} descricao={t.ativo ? undefined : 'Desativado'}
          aoTocar={podeEditar ? () => setTipoAberto(t.id) : undefined} seta={podeEditar} />)}
        {podeEditar && <Linha icone={Settings2} cor="cinza" titulo={importar.isPending ? 'Adicionando…' : 'Usar os modelos do dossiê'}
          descricao="Emenda parlamentar, lei de incentivo, edital de entidade, patrocínio e doação." aoTocar={() => void usarModelos()} desabilitada={importar.isPending} />}
      </Grupo>
      <Grupo titulo="Origens" acao={pode(perfil, 'verbas', 'criar') ? <Button variant="link" size="xs" onClick={() => setNovaOrigem(true)}>Adicionar</Button> : undefined}>
        {(origens.data ?? []).length === 0 && <Linha titulo="Nenhuma origem ainda" />}
        {(origens.data ?? []).map((o) => <Linha key={o.id} icone={Building2} cor="indigo" titulo={o.nome} descricao={[NOME_CATEGORIA[o.categoria], o.contato].filter(Boolean).join(' · ')} />)}
      </Grupo>
      {tipoAberto && <FormTipoVerba id={tipoAberto} aoFechar={() => setTipoAberto(null)} />}
      {novaOrigem && <FormOrigem aoFechar={() => setNovaOrigem(false)} />}
    </Pagina>
  );
}

function FormTipoVerba({ id, aoFechar }: { id: string; aoFechar: () => void }) {
  const tipos = useTiposVerba();
  const salvar = useAcaoF3('salvar_tipo_verba');
  const atual = tipos.data?.find((t) => t.id === id);
  const [novoId] = useState(() => crypto.randomUUID());
  const [nome, setNome] = useState(atual?.nome ?? '');
  const [regras, setRegras] = useState(() => regrasCompletas(atual?.regras));
  const [erro, setErro] = useState<string | null>(null);
  async function enviar() {
    setErro(null);
    try { await salvar.mutateAsync({ p: { id: atual?.id ?? novoId, nome: nome.trim(), regras, ativo: atual?.ativo ?? true } }); toast.success('Tipo salvo'); aoFechar(); }
    catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo={atual ? atual.nome : 'Novo tipo de verba'} larga
      rodape={<Button size="lg" className="w-full" disabled={nome.trim().length < 2 || salvar.isPending} onClick={() => void enviar()}>{salvar.isPending && <Spinner data-icon="inline-start" />}Salvar</Button>}>
      <FieldGroup className="pb-2">
        <Field><FieldLabel htmlFor="tv-nome">Nome</FieldLabel><Input id="tv-nome" name="tv-nome" maxLength={80} autoComplete="off" placeholder="Ex.: Convênio municipal…" value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
        <EditorRegras prefixo="tv" valor={regras} aoMudar={setRegras} />
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}
