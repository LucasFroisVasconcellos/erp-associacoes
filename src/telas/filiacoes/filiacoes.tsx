import { AlertTriangle, BookUser, CalendarClock, FileCheck2, HandCoins, Plus, Settings2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { BlocoErro, CarregandoLista, Vazio } from '@/components/app/estados';
import { Folha } from '@/components/app/folha';
import { Grupo, Linha } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { usePerfil } from '@/app/sessao';
import {
  useAcaoF4, useCategorias, useDocumentosFiliacao, useDocumentosInstitucionais, useFiliacoes, useMembros, usePainelFiliacoes, useTiposFiliacao, useVerbas,
} from '@/dados/consultas';
import type { Filiacao, Periodicidade, SituacaoFiliacao } from '@/dados/tipos';
import { pode } from '@/lib/acesso';
import { formatarData } from '@/lib/datas';
import { formatarBRL, lerValorBRL, mascararValor, paraCampo } from '@/lib/dinheiro';
import { contar } from '@/lib/texto';
import { SeletorPessoa, erroMsg, nomeDe } from '@/telas/organizacao/comum';
import { COR_SITUACAO_FILIACAO, NOME_PERIODICIDADE, NOME_SITUACAO_FILIACAO, estadoValidade } from '@/telas/pessoas/comum';

export function Filiacoes() {
  const perfil = usePerfil();
  const filiacoes = useFiliacoes();
  const tipos = useTiposFiliacao();
  const painel = usePainelFiliacoes();
  const [nova, setNova] = useState(false);
  const sit = (id: string) => painel.data?.find((x) => x.id === id);
  const ordem: SituacaoFiliacao[] = ['ativa', 'pendente', 'suspensa', 'preparacao', 'encerrada'];
  const lista = [...(filiacoes.data ?? [])].sort((a, b) => ordem.indexOf(a.situacao) - ordem.indexOf(b.situacao) || a.entidade.localeCompare(b.entidade));
  const riscos = (painel.data ?? []).filter((x) => (x.verbas_em_risco ?? []).length > 0);
  return (
    <Pagina titulo="Filiações" acoes={
      <>
        {pode(perfil, 'filiacoes', 'criar') && <Button size="icon" variant="ghost" aria-label="Nova filiação" onClick={() => setNova(true)}><Plus aria-hidden="true" /></Button>}
        {pode(perfil, 'filiacoes', 'editar') && <Button asChild size="icon" variant="ghost"><Link to="/filiacoes/tipos" aria-label="Tipos de vínculo"><Settings2 aria-hidden="true" /></Link></Button>}
      </>
    }>
      {filiacoes.isError ? <BlocoErro erro={filiacoes.error} tentarDeNovo={() => void filiacoes.refetch()} />
        : filiacoes.isPending ? <CarregandoLista rotulo="Carregando as filiações…" />
          : lista.length === 0 ? (
            <Vazio icone={BookUser} titulo="Nenhuma filiação cadastrada" descricao="Federações, confederações, conselhos e cadastros que a Associação Exemplo precisa manter em dia."
              acao={pode(perfil, 'filiacoes', 'criar') ? <Button onClick={() => setNova(true)}><Plus data-icon="inline-start" aria-hidden="true" />Nova filiação</Button> : undefined} />
          ) : (
            <>
              {riscos.length > 0 && (
                <Grupo titulo="Verbas em risco">
                  {riscos.flatMap((r) => (r.verbas_em_risco ?? []).map((v) => {
                    const f = filiacoes.data?.find((x) => x.id === r.id);
                    return <Linha key={`${r.id}-${v.id}`} icone={AlertTriangle} cor="vermelho" titulo={v.titulo} para={`/filiacoes/${r.id}`}
                      descricao={`Depende de ${f?.entidade ?? 'uma filiação'}, que está ${r.vencida ? 'vencida' : NOME_SITUACAO_FILIACAO[f?.situacao ?? 'pendente'].toLowerCase()}.`} />;
                  }))}
                </Grupo>
              )}
              <Grupo titulo={contar(lista.length, 'vínculo', 'vínculos')}>
                {lista.map((f) => {
                  const s = sit(f.id);
                  return (
                    <Linha key={f.id} icone={BookUser} cor={s?.vencida ? 'vermelho' : COR_SITUACAO_FILIACAO[f.situacao]} titulo={f.entidade} para={`/filiacoes/${f.id}`}
                      descricao={[tipos.data?.find((t) => t.id === f.tipo_id)?.nome, NOME_SITUACAO_FILIACAO[f.situacao], f.validade && `${s?.vencida ? 'venceu' : 'vale até'} ${formatarData(f.validade)}`,
                        s && s.documentos_pendentes > 0 && contar(s.documentos_pendentes, 'documento pendente', 'documentos pendentes')].filter(Boolean).join(' · ')}
                      valor={s?.vencida ? <Badge variant="destructive">Vencida</Badge> : s?.vence_em_breve ? <Badge variant="secondary">Vence logo</Badge> : undefined} />
                  );
                })}
              </Grupo>
            </>
          )}
      {nova && <FormFiliacao filiacao={null} aoFechar={() => setNova(false)} />}
    </Pagina>
  );
}

function FormFiliacao({ filiacao, aoFechar }: { filiacao: Filiacao | null; aoFechar: () => void }) {
  const tipos = useTiposFiliacao();
  const salvar = useAcaoF4('salvar_filiacao');
  const navegar = useNavigate();
  const [id] = useState(() => filiacao?.id ?? crypto.randomUUID());
  const [f, setF] = useState(() => ({
    entidade: filiacao?.entidade ?? '', tipo_id: filiacao?.tipo_id ?? '', categoria: filiacao?.categoria ?? '', situacao: filiacao?.situacao ?? 'preparacao' as SituacaoFiliacao,
    inicio: filiacao?.inicio ?? '', validade: filiacao?.validade ?? '', renovacao: filiacao?.renovacao ?? '',
    valor: paraCampo(filiacao?.contribuicao_valor), periodicidade: filiacao?.contribuicao_periodicidade ?? '' as Periodicidade | '',
    beneficios: filiacao?.beneficios ?? '', obrigacoes: filiacao?.obrigacoes ?? '', responsavel: filiacao?.responsavel ?? '',
  }));
  const [erro, setErro] = useState<string | null>(null);
  const muda = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  async function enviar() {
    setErro(null);
    const v = f.valor.trim() ? lerValorBRL(f.valor) : null;
    if (f.valor.trim() && !v) return setErro('Confira o valor da contribuição.');
    try {
      await salvar.mutateAsync({ p: { id, entidade: f.entidade.trim(), tipo_id: f.tipo_id, categoria: f.categoria.trim() || null, situacao: f.situacao,
        inicio: f.inicio || null, validade: f.validade || null, renovacao: f.renovacao || null, contribuicao_valor: v, contribuicao_periodicidade: f.periodicidade || null,
        beneficios: f.beneficios.trim() || null, obrigacoes: f.obrigacoes.trim() || null, responsavel: f.responsavel || null } });
      toast.success(filiacao ? 'Filiação atualizada' : 'Filiação cadastrada'); aoFechar();
      if (!filiacao) navegar(`/filiacoes/${id}`);
    } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo={filiacao ? 'Editar filiação' : 'Nova filiação'} larga
      rodape={<Button size="lg" className="w-full" disabled={f.entidade.trim().length < 2 || !f.tipo_id || salvar.isPending} onClick={() => void enviar()}>{salvar.isPending && <Spinner data-icon="inline-start" />}Salvar</Button>}>
      <FieldGroup className="pb-2">
        <Field><FieldLabel htmlFor="fl-ent">Entidade</FieldLabel><Input id="fl-ent" name="fl-ent" maxLength={160} autoComplete="off" placeholder="Ex.: Federação de…" value={f.entidade} onChange={(e) => muda({ entidade: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="fl-tipo">Tipo</FieldLabel>
            <Select value={f.tipo_id} onValueChange={(v) => muda({ tipo_id: v })}>
              <SelectTrigger id="fl-tipo"><SelectValue placeholder={(tipos.data ?? []).length ? 'Escolha' : 'Crie os tipos primeiro'} /></SelectTrigger>
              <SelectContent><SelectGroup>{(tipos.data ?? []).filter((t) => t.ativo || t.id === f.tipo_id).map((t) => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field><FieldLabel htmlFor="fl-cat">Categoria (opcional)</FieldLabel><Input id="fl-cat" name="fl-cat" maxLength={80} autoComplete="off" value={f.categoria} onChange={(e) => muda({ categoria: e.target.value })} /></Field>
          <Field>
            <FieldLabel htmlFor="fl-sit">Situação</FieldLabel>
            <Select value={f.situacao} onValueChange={(v) => muda({ situacao: v as SituacaoFiliacao })}>
              <SelectTrigger id="fl-sit"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{(Object.keys(NOME_SITUACAO_FILIACAO) as SituacaoFiliacao[]).map((s) => <SelectItem key={s} value={s}>{NOME_SITUACAO_FILIACAO[s]}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field><FieldLabel htmlFor="fl-ini">Início</FieldLabel><Input id="fl-ini" name="fl-ini" type="date" value={f.inicio} onChange={(e) => muda({ inicio: e.target.value })} /></Field>
          <Field><FieldLabel htmlFor="fl-val">Validade</FieldLabel><Input id="fl-val" name="fl-val" type="date" value={f.validade} onChange={(e) => muda({ validade: e.target.value })} /></Field>
          <Field><FieldLabel htmlFor="fl-ren">Renovação</FieldLabel><Input id="fl-ren" name="fl-ren" type="date" value={f.renovacao} onChange={(e) => muda({ renovacao: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field><FieldLabel htmlFor="fl-valor">Contribuição (R$)</FieldLabel><Input id="fl-valor" name="fl-valor" inputMode="numeric" autoComplete="off" placeholder="0,00" value={f.valor} onChange={(e) => muda({ valor: mascararValor(e.target.value) })} /></Field>
          <Field>
            <FieldLabel htmlFor="fl-per">Periodicidade</FieldLabel>
            <Select value={f.periodicidade || 'nenhuma'} onValueChange={(v) => muda({ periodicidade: v === 'nenhuma' ? '' : v as Periodicidade })}>
              <SelectTrigger id="fl-per"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value="nenhuma">Sem contribuição</SelectItem>{(Object.keys(NOME_PERIODICIDADE) as Periodicidade[]).map((p) => <SelectItem key={p} value={p}>{NOME_PERIODICIDADE[p]}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </Field>
        </div>
        <SeletorPessoa id="fl-resp" rotulo="Quem cuida" valor={f.responsavel} aoMudar={(v) => muda({ responsavel: v })} opcional />
        <Field><FieldLabel htmlFor="fl-ben">Benefícios (opcional)</FieldLabel><Textarea id="fl-ben" name="fl-ben" rows={2} maxLength={1000} value={f.beneficios} onChange={(e) => muda({ beneficios: e.target.value })} /></Field>
        <Field><FieldLabel htmlFor="fl-obr">Obrigações (opcional)</FieldLabel><Textarea id="fl-obr" name="fl-obr" rows={2} maxLength={1000} value={f.obrigacoes} onChange={(e) => muda({ obrigacoes: e.target.value })} /></Field>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

export function DetalheFiliacao() {
  const { id = '' } = useParams();
  const perfil = usePerfil();
  const filiacoes = useFiliacoes();
  const tipos = useTiposFiliacao();
  const membros = useMembros();
  const painel = usePainelFiliacoes();
  const docs = useDocumentosFiliacao(id);
  const inst = useDocumentosInstitucionais(pode(perfil, 'documentos', 'ver'));
  const verbas = useVerbas();
  const salvarDoc = useAcaoF4('salvar_documento_filiacao');
  const [folha, setFolha] = useState<null | 'editar' | 'contribuicao' | 'dependencia'>(null);
  const [novoDoc, setNovoDoc] = useState('');
  const f = filiacoes.data?.find((x) => x.id === id);
  const voltar = { para: '/filiacoes', rotulo: 'Filiações' };
  if (filiacoes.isPending) return <Pagina titulo="Filiação" voltar={voltar}><CarregandoLista /></Pagina>;
  if (!f) return <Pagina titulo="Filiação" voltar={voltar}><Vazio icone={BookUser} titulo="Filiação não encontrada" descricao="Ela pode não estar visível para você." /></Pagina>;
  const s = painel.data?.find((x) => x.id === f.id);
  const editar = pode(perfil, 'filiacoes', 'editar') || f.criado_por === perfil.membro.id;
  const dependentes = (verbas.data ?? []).filter((v) => v.filiacao_id === f.id);
  const vValidade = estadoValidade(f.validade);
  return (
    <Pagina titulo={f.entidade} voltar={voltar} acoes={editar ? <Button variant="ghost" size="sm" onClick={() => setFolha('editar')}>Editar</Button> : undefined}>
      <Grupo>
        <Linha icone={BookUser} cor={COR_SITUACAO_FILIACAO[f.situacao]} titulo={NOME_SITUACAO_FILIACAO[f.situacao]}
          descricao={[tipos.data?.find((t) => t.id === f.tipo_id)?.nome, f.categoria].filter(Boolean).join(' · ')} />
        <Linha icone={CalendarClock} cor={vValidade ? (vValidade === 'ok' ? 'verde' : vValidade === 'vence' ? 'laranja' : 'vermelho') : 'cinza'}
          titulo={f.validade ? `${vValidade === 'vencido' ? 'Venceu em' : 'Vale até'} ${formatarData(f.validade)}` : 'Sem validade cadastrada'}
          descricao={[f.renovacao && `renovar em ${formatarData(f.renovacao)}`, f.inicio && `filiada desde ${formatarData(f.inicio)}`].filter(Boolean).join(' · ') || undefined} />
        <Linha icone={Wallet} cor="teal" titulo="Contribuição"
          valor={f.contribuicao_valor ? `${formatarBRL(f.contribuicao_valor)}${f.contribuicao_periodicidade ? ` · ${NOME_PERIODICIDADE[f.contribuicao_periodicidade].toLowerCase()}` : ''}` : 'Sem contribuição'}
          descricao={f.recorrencia_id ? 'Já está nas contas a pagar (recorrente).' : undefined} />
        <Linha icone={BookUser} cor="cinza" titulo="Quem cuida" valor={nomeDe(membros.data, f.responsavel ?? f.criado_por)} />
      </Grupo>
      {(f.beneficios || f.obrigacoes) && (
        <section className="bg-card flex flex-col gap-3 rounded-[14px] p-4 text-[15px]">
          {f.beneficios && <div><h2 className="text-muted-foreground text-[13px] font-medium">Benefícios</h2><p className="whitespace-pre-wrap">{f.beneficios}</p></div>}
          {f.obrigacoes && <div><h2 className="text-muted-foreground text-[13px] font-medium">Obrigações</h2><p className="whitespace-pre-wrap">{f.obrigacoes}</p></div>}
        </section>
      )}
      {f.contribuicao_valor && f.contribuicao_periodicidade && f.situacao !== 'encerrada' && pode(perfil, 'financeiro', 'administrar') && (
        <Grupo rodape={f.contribuicao_periodicidade === 'mensal' ? 'Cria a conta recorrente no Dinheiro. Fazer de novo não duplica.' : 'Cria a conta a pagar na data da renovação. Fazer de novo não duplica.'}>
          <Linha icone={Wallet} cor="verde" titulo="Lançar no Dinheiro" aoTocar={() => setFolha('contribuicao')} seta />
        </Grupo>
      )}

      <Grupo titulo="Documentos exigidos" rodape="Ligue a certidão da Governança: se ela vencer, o documento volta a ficar pendente.">
        {(docs.data ?? []).length === 0 && <Linha icone={FileCheck2} cor="cinza" titulo="Nenhum documento exigido" />}
        {(docs.data ?? []).map((d) => {
          const ligado = inst.data?.find((i) => i.id === d.documento_institucional_id);
          const vencido = estadoValidade(ligado?.validade ?? null) === 'vencido';
          return (
            <div key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Checkbox id={`fd-${d.id}`} checked={!!d.entregue_em} disabled={!editar}
                onCheckedChange={(c) => salvarDoc.mutate({ p_filiacao: f.id, p: { id: d.id, entregue: c === true } }, { onError: (e) => toast.error(erroMsg(e)) })} />
              <label htmlFor={`fd-${d.id}`} className="min-w-0 flex-1 text-[17px]">{d.nome}
                <span className={vencido ? 'text-destructive block text-[13px]' : 'text-muted-foreground block text-[13px]'}>
                  {[d.entregue_em && `entregue em ${formatarData(d.entregue_em)}`, ligado && `${ligado.titulo}${ligado.validade ? ` (${vencido ? 'venceu' : 'vale até'} ${formatarData(ligado.validade)})` : ''}`].filter(Boolean).join(' · ') || 'pendente'}
                </span></label>
              {editar && (inst.data ?? []).length > 0 && (
                <Select value={d.documento_institucional_id ?? 'nenhum'} onValueChange={(v) => salvarDoc.mutate({ p_filiacao: f.id, p: { id: d.id, documento_institucional_id: v === 'nenhum' ? null : v } }, { onError: (e) => toast.error(erroMsg(e)) })}>
                  <SelectTrigger aria-label={`Documento da Governança para ${d.nome}`} className="h-9 w-auto max-w-48"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup><SelectItem value="nenhum">Sem ligação</SelectItem>{(inst.data ?? []).filter((i) => !i.arquivado_em).map((i) => <SelectItem key={i.id} value={i.id}>{i.titulo}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              )}
            </div>
          );
        })}
        {editar && (
          <form className="flex items-end gap-2 p-3" onSubmit={(e) => { e.preventDefault(); if (novoDoc.trim().length >= 2) salvarDoc.mutate({ p_filiacao: f.id, p: { id: crypto.randomUUID(), nome: novoDoc.trim() } }, { onSuccess: () => setNovoDoc(''), onError: (x) => toast.error(erroMsg(x)) }); }}>
            <Field className="flex-1"><FieldLabel htmlFor="fd-novo" className="sr-only">Novo documento exigido</FieldLabel>
              <Input id="fd-novo" name="fd-novo" maxLength={200} autoComplete="off" placeholder="Adicionar documento exigido…" value={novoDoc} onChange={(e) => setNovoDoc(e.target.value)} /></Field>
            <Button type="submit" size="icon" variant="secondary" aria-label="Adicionar documento exigido" disabled={novoDoc.trim().length < 2}><Plus aria-hidden="true" /></Button>
          </form>
        )}
      </Grupo>

      {pode(perfil, 'verbas', 'ver') && (
        <Grupo titulo="Verbas que dependem desta filiação" acao={pode(perfil, 'verbas', 'editar') ? <Button variant="link" size="xs" onClick={() => setFolha('dependencia')}>Ligar verba</Button> : undefined}
          rodape="Se a filiação ficar pendente, suspensa ou vencida, essas verbas aparecem em risco.">
          {dependentes.length === 0 && <Linha titulo="Nenhuma verba ligada" />}
          {dependentes.map((v) => {
            const risco = (s?.verbas_em_risco ?? []).some((x) => x.id === v.id);
            return <Linha key={v.id} icone={risco ? AlertTriangle : HandCoins} cor={risco ? 'vermelho' : 'laranja'} titulo={v.titulo} para={`/verbas/${v.id}`} descricao={risco ? 'Em risco' : undefined} />;
          })}
        </Grupo>
      )}

      {folha === 'editar' && <FormFiliacao filiacao={f} aoFechar={() => setFolha(null)} />}
      {folha === 'contribuicao' && <FormContribuicao filiacao={f} aoFechar={() => setFolha(null)} />}
      {folha === 'dependencia' && <FormDependencia filiacao={f} aoFechar={() => setFolha(null)} />}
    </Pagina>
  );
}

function FormContribuicao({ filiacao, aoFechar }: { filiacao: Filiacao; aoFechar: () => void }) {
  const categorias = useCategorias();
  const gerar = useAcaoF4('gerar_contribuicao');
  const [cat, setCat] = useState('');
  const [dia, setDia] = useState('10');
  const [erro, setErro] = useState<string | null>(null);
  const mensal = filiacao.contribuicao_periodicidade === 'mensal';
  async function enviar() {
    setErro(null);
    try { await gerar.mutateAsync({ p_filiacao: filiacao.id, p_categoria: cat, p_dia: Number(dia) }); toast.success(mensal ? 'Conta recorrente criada' : 'Conta a pagar criada'); aoFechar(); }
    catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo="Contribuição no Dinheiro"
      descricao={`${formatarBRL(filiacao.contribuicao_valor)} · ${mensal ? 'todo mês' : `na renovação (${formatarData(filiacao.renovacao)})`}`}
      rodape={<Button size="lg" className="w-full" disabled={!cat || gerar.isPending} onClick={() => void enviar()}>{gerar.isPending && <Spinner data-icon="inline-start" />}Lançar</Button>}>
      <FieldGroup className="pb-2">
        <Field>
          <FieldLabel htmlFor="ct-cat">Categoria da saída</FieldLabel>
          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger id="ct-cat"><SelectValue placeholder="Escolha" /></SelectTrigger>
            <SelectContent><SelectGroup>{(categorias.data ?? []).filter((c) => c.tipo === 'saida' && c.ativa).map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        </Field>
        {mensal && <Field><FieldLabel htmlFor="ct-dia">Dia do vencimento</FieldLabel><Input id="ct-dia" name="ct-dia" type="number" inputMode="numeric" min={1} max={28} value={dia} onChange={(e) => setDia(e.target.value)} /></Field>}
        {!mensal && !filiacao.renovacao && <FieldDescription>Cadastre a data de renovação da filiação antes.</FieldDescription>}
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

function FormDependencia({ filiacao, aoFechar }: { filiacao: Filiacao; aoFechar: () => void }) {
  const verbas = useVerbas();
  const definir = useAcaoF4('definir_dependencia_verba');
  const [verba, setVerba] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const candidatas = (verbas.data ?? []).filter((v) => v.filiacao_id !== filiacao.id && !['encerrado', 'negado', 'cancelado'].includes(v.situacao));
  async function enviar() {
    setErro(null);
    try { await definir.mutateAsync({ p_verba: verba, p_filiacao: filiacao.id }); toast.success('Verba ligada'); aoFechar(); } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo="Ligar verba" descricao="A verba só vale se esta filiação estiver em dia (ex.: emenda que exige filiação à federação)."
      rodape={<Button size="lg" className="w-full" disabled={!verba || definir.isPending} onClick={() => void enviar()}>{definir.isPending && <Spinner data-icon="inline-start" />}Ligar</Button>}>
      <FieldGroup className="pb-2">
        <Field>
          <FieldLabel htmlFor="dp-verba">Verba</FieldLabel>
          <Select value={verba} onValueChange={setVerba}>
            <SelectTrigger id="dp-verba"><SelectValue placeholder={candidatas.length ? 'Escolha a verba' : 'Nenhuma verba em andamento'} /></SelectTrigger>
            <SelectContent><SelectGroup>{candidatas.map((v) => <SelectItem key={v.id} value={v.id}>{v.titulo}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        </Field>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

export function TiposFiliacao() {
  const tipos = useTiposFiliacao();
  const importar = useAcaoF4<Record<string, never>, { criados: number }>('importar_tipos_filiacao');
  const salvar = useAcaoF4('salvar_tipo_filiacao');
  const [nome, setNome] = useState('');
  async function usarModelos() {
    try { const r = await importar.mutateAsync({}); toast.success(r.criados ? contar(r.criados, 'tipo adicionado', 'tipos adicionados') : 'Os tipos já estavam cadastrados'); }
    catch (e) { toast.error(erroMsg(e)); }
  }
  return (
    <Pagina titulo="Tipos de vínculo" voltar={{ para: '/filiacoes', rotulo: 'Filiações' }}>
      <Grupo rodape="Toque para ativar ou desativar.">
        {(tipos.data ?? []).length === 0 && <Linha titulo="Nenhum tipo ainda" />}
        {(tipos.data ?? []).map((t) => <Linha key={t.id} icone={BookUser} cor={t.ativo ? 'azul' : 'cinza'} titulo={t.nome} descricao={t.ativo ? undefined : 'Desativado'}
          aoTocar={() => salvar.mutate({ p: { id: t.id, nome: t.nome, ativo: !t.ativo } }, { onError: (e) => toast.error(erroMsg(e)) })} />)}
        <Linha icone={Settings2} cor="cinza" titulo={importar.isPending ? 'Adicionando…' : 'Usar os tipos do dossiê'} descricao="Confederação, federação, comitê, conselho, cadastro governamental e parceria."
          aoTocar={() => void usarModelos()} desabilitada={importar.isPending} />
      </Grupo>
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (nome.trim().length >= 2) salvar.mutate({ p: { id: crypto.randomUUID(), nome: nome.trim() } }, { onSuccess: () => setNome(''), onError: (x) => toast.error(erroMsg(x)) }); }}>
        <Field className="flex-1"><FieldLabel htmlFor="tf-nome">Novo tipo</FieldLabel><Input id="tf-nome" name="tf-nome" maxLength={60} autoComplete="off" value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
        <Button type="submit" variant="secondary" disabled={nome.trim().length < 2 || salvar.isPending}>Adicionar</Button>
      </form>
    </Pagina>
  );
}
