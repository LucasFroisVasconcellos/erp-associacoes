// Bem comprado com recurso de projeto entra sozinho na relação de bens da prestação de contas.
import { Archive, Boxes, CalendarClock, HandHelping, Landmark, PackageCheck, Plus, Undo2, Wrench } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { BlocoErro, CarregandoLista, Vazio } from '@/components/app/estados';
import { Folha } from '@/components/app/folha';
import { Grupo, Linha } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { Valor } from '@/components/app/valor';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { usePerfil } from '@/app/sessao';
import { useAcaoF4, useBens, useEmprestimos, useManutencoes, usePessoas, useProjetos } from '@/dados/consultas';
import type { Bem, CategoriaBem, OrigemBem, SituacaoBem } from '@/dados/tipos';
import { pode } from '@/lib/acesso';
import { formatarData, hojeSP, somarDias } from '@/lib/datas';
import { formatarBRL, lerValorBRL, mascararValor, paraCampo, somar } from '@/lib/dinheiro';
import { erroMsg } from '@/telas/organizacao/comum';
import { COR_SITUACAO_BEM, NOME_CATEGORIA_BEM, NOME_ORIGEM_BEM, NOME_SITUACAO_BEM, menorDeIdade } from '@/telas/pessoas/comum';

const ORDEM: SituacaoBem[] = ['emprestado', 'manutencao', 'disponivel', 'baixado'];
const TITULO_GRUPO: Record<SituacaoBem, string> = { emprestado: 'Emprestados', manutencao: 'Em manutenção', disponivel: 'Disponíveis', baixado: 'Baixados' };
/** versão atual do texto do termo de responsabilidade (o texto fica com a secretaria) */
const TERMO_ATUAL = 'v1';

export function Patrimonio() {
  const perfil = usePerfil();
  const bens = useBens();
  const emp = useEmprestimos();
  const pessoas = usePessoas(pode(perfil, 'pessoas', 'ver'));
  const [novo, setNovo] = useState(false);
  const ativos = (bens.data ?? []).filter((b) => b.situacao !== 'baixado');
  const comQuem = (bem: string) => {
    const e = emp.data?.find((x) => x.bem_id === bem && !x.devolvido_em);
    return e ? pessoas.data?.find((p) => p.id === e.pessoa_id)?.nome ?? 'atleta' : null;
  };
  return (
    <Pagina titulo="Patrimônio" acoes={pode(perfil, 'patrimonio', 'criar') ? <Button size="icon" variant="ghost" aria-label="Cadastrar bem" onClick={() => setNovo(true)}><Plus aria-hidden="true" /></Button> : undefined}>
      {bens.isError ? <BlocoErro erro={bens.error} tentarDeNovo={() => void bens.refetch()} />
        : bens.isPending ? <CarregandoLista linhas={5} rotulo="Carregando o patrimônio…" />
          : (bens.data ?? []).length === 0 ? (
            <Vazio icone={Boxes} titulo="Nenhum bem cadastrado" descricao="Cadastre cadeiras de jogo, bolas e equipamentos com número de patrimônio e origem."
              acao={pode(perfil, 'patrimonio', 'criar') ? <Button onClick={() => setNovo(true)}><Plus data-icon="inline-start" aria-hidden="true" />Cadastrar bem</Button> : undefined} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-card rounded-[18px] p-4"><p className="text-muted-foreground text-[13px]">Bens em uso</p><p className="font-rounded numeros text-[22px] font-bold">{ativos.length}</p></div>
                <div className="bg-card rounded-[18px] p-4"><p className="text-muted-foreground text-[13px]">Valor registrado</p><Valor valor={somar(ativos.map((b) => b.valor ?? '0'))} className="font-rounded text-[22px] font-bold" /></div>
              </div>
              {ORDEM.map((s) => {
                const lista = (bens.data ?? []).filter((b) => b.situacao === s);
                if (!lista.length) return null;
                return (
                  <Grupo key={s} titulo={`${TITULO_GRUPO[s]} (${lista.length})`}>
                    {lista.map((b) => (
                      <Linha key={b.id} icone={Boxes} cor={COR_SITUACAO_BEM[b.situacao]} titulo={`${b.numero} — ${b.nome}`} para={`/patrimonio/${b.id}`}
                        descricao={[NOME_CATEGORIA_BEM[b.categoria], s === 'emprestado' && comQuem(b.id) && `com ${comQuem(b.id)}`, NOME_ORIGEM_BEM[b.origem]].filter(Boolean).join(' · ')}
                        valor={b.valor ? <Valor valor={b.valor} className="text-foreground text-[15px]" /> : undefined} />
                    ))}
                  </Grupo>
                );
              })}
            </>
          )}
      {novo && <FormBem bem={null} aoFechar={() => setNovo(false)} />}
    </Pagina>
  );
}

function FormBem({ bem, aoFechar }: { bem: Bem | null; aoFechar: () => void }) {
  const projetos = useProjetos();
  const salvar = useAcaoF4('salvar_bem');
  const navegar = useNavigate();
  const [id] = useState(() => bem?.id ?? crypto.randomUUID());
  const [numero, setNumero] = useState(bem?.numero ?? '');
  const [nome, setNome] = useState(bem?.nome ?? '');
  const [categoria, setCategoria] = useState<CategoriaBem>(bem?.categoria ?? 'cadeira_jogo');
  const [origem, setOrigem] = useState<OrigemBem>(bem?.origem ?? 'compra');
  const [projeto, setProjeto] = useState(bem?.projeto_id ?? '');
  const [valor, setValor] = useState(paraCampo(bem?.valor));
  const [data, setData] = useState(bem?.data_aquisicao ?? '');
  const [obs, setObs] = useState(bem?.observacao ?? '');
  const [erro, setErro] = useState<string | null>(null);
  async function enviar() {
    setErro(null);
    const v = valor.trim() ? lerValorBRL(valor) : null;
    if (valor.trim() && !v) return setErro('Confira o valor.');
    try {
      await salvar.mutateAsync({ p: { id, numero: numero.trim().toUpperCase(), nome: nome.trim(), categoria, origem, projeto_id: projeto || null, valor: v,
        data_aquisicao: data || null, observacao: obs.trim() || null } });
      toast.success(bem ? 'Bem atualizado' : 'Bem cadastrado'); aoFechar();
      if (!bem) navegar(`/patrimonio/${id}`);
    } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo={bem ? 'Editar bem' : 'Cadastrar bem'} larga
      rodape={<Button size="lg" className="w-full" disabled={!numero.trim() || nome.trim().length < 2 || (origem === 'projeto' && !projeto) || salvar.isPending} onClick={() => void enviar()}>
        {salvar.isPending && <Spinner data-icon="inline-start" />}{bem ? 'Salvar mudanças' : 'Cadastrar'}</Button>}>
      <FieldGroup className="pb-2">
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <Field><FieldLabel htmlFor="bm-num">Nº patrimônio</FieldLabel>
            <Input id="bm-num" name="bm-num" maxLength={20} autoComplete="off" autoCapitalize="characters" placeholder="CAD-001" value={numero} onChange={(e) => setNumero(e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="bm-nome">Nome</FieldLabel><Input id="bm-nome" name="bm-nome" maxLength={120} autoComplete="off" value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="bm-cat">Categoria</FieldLabel>
            <Select value={categoria} onValueChange={(v) => setCategoria(v as CategoriaBem)}>
              <SelectTrigger id="bm-cat"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{(Object.keys(NOME_CATEGORIA_BEM) as CategoriaBem[]).map((c) => <SelectItem key={c} value={c}>{NOME_CATEGORIA_BEM[c]}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="bm-orig">Origem</FieldLabel>
            <Select value={origem} onValueChange={(v) => setOrigem(v as OrigemBem)}>
              <SelectTrigger id="bm-orig"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{(Object.keys(NOME_ORIGEM_BEM) as OrigemBem[]).map((c) => <SelectItem key={c} value={c}>{NOME_ORIGEM_BEM[c]}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </Field>
        </div>
        {(origem === 'projeto' || projeto) && (
          <Field>
            <FieldLabel htmlFor="bm-proj">Projeto</FieldLabel>
            <Select value={projeto} onValueChange={setProjeto}>
              <SelectTrigger id="bm-proj"><SelectValue placeholder="Escolha o projeto" /></SelectTrigger>
              <SelectContent><SelectGroup>{(projetos.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
            <FieldDescription>O bem entra na relação de bens da prestação de contas deste projeto.</FieldDescription>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field><FieldLabel htmlFor="bm-valor">Valor (R$, opcional)</FieldLabel><Input id="bm-valor" name="bm-valor" inputMode="numeric" autoComplete="off" placeholder="0,00" value={valor} onChange={(e) => setValor(mascararValor(e.target.value))} /></Field>
          <Field><FieldLabel htmlFor="bm-data">Aquisição</FieldLabel><Input id="bm-data" name="bm-data" type="date" max={hojeSP()} value={data} onChange={(e) => setData(e.target.value)} /></Field>
        </div>
        <Field><FieldLabel htmlFor="bm-obs">Observação (opcional)</FieldLabel><Textarea id="bm-obs" name="bm-obs" rows={2} maxLength={500} value={obs} onChange={(e) => setObs(e.target.value)} /></Field>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

export function DetalheBem() {
  const { id = '' } = useParams();
  const perfil = usePerfil();
  const bens = useBens();
  const emp = useEmprestimos();
  const manut = useManutencoes(id);
  const pessoas = usePessoas(pode(perfil, 'pessoas', 'ver'));
  const projetos = useProjetos(pode(perfil, 'projetos', 'ver'));
  const devolver = useAcaoF4('devolver_bem');
  const [folha, setFolha] = useState<null | 'editar' | 'emprestar' | 'manutencao' | 'baixar'>(null);
  const b = bens.data?.find((x) => x.id === id);
  const voltar = { para: '/patrimonio', rotulo: 'Patrimônio' };
  if (bens.isPending) return <Pagina titulo="Bem" voltar={voltar}><CarregandoLista /></Pagina>;
  if (!b) return <Pagina titulo="Bem" voltar={voltar}><Vazio icone={Boxes} titulo="Bem não encontrado" descricao="Ele pode não estar visível para você." /></Pagina>;
  const editar = pode(perfil, 'patrimonio', 'editar') && b.situacao !== 'baixado';
  const historico = (emp.data ?? []).filter((e) => e.bem_id === b.id);
  const aberto = historico.find((e) => !e.devolvido_em);
  const nomePessoa = (pid: string) => pessoas.data?.find((p) => p.id === pid)?.nome ?? 'Atleta';
  const projeto = projetos.data?.find((p) => p.id === b.projeto_id);
  return (
    <Pagina titulo={`${b.numero} — ${b.nome}`} voltar={voltar} acoes={editar ? <Button variant="ghost" size="sm" onClick={() => setFolha('editar')}>Editar</Button> : undefined}>
      <Grupo>
        <Linha icone={PackageCheck} cor={COR_SITUACAO_BEM[b.situacao]} titulo={NOME_SITUACAO_BEM[b.situacao]} descricao={b.baixa_motivo ?? undefined} />
        <Linha icone={Boxes} cor="indigo" titulo="Categoria" valor={NOME_CATEGORIA_BEM[b.categoria]} />
        <Linha icone={Landmark} cor="roxo" titulo="Origem" valor={NOME_ORIGEM_BEM[b.origem]} descricao={projeto?.nome} para={projeto ? `/projetos/${projeto.id}` : undefined} />
        <Linha icone={CalendarClock} cor="teal" titulo="Valor · aquisição" valor={<span className="numeros text-[15px]">{formatarBRL(b.valor)} · {formatarData(b.data_aquisicao)}</span>} />
      </Grupo>
      {b.observacao && <p className="bg-card rounded-[14px] p-4 text-[15px] whitespace-pre-wrap">{b.observacao}</p>}

      <Grupo titulo="Empréstimo" rodape="O termo de responsabilidade fica registrado: versão do texto, quem aceitou e quando.">
        {aberto ? (
          <Linha icone={HandHelping} cor="azul" titulo={`Com ${nomePessoa(aberto.pessoa_id)}`}
            descricao={`Desde ${formatarData(aberto.inicio)} · termo ${aberto.termo_versao} aceito por ${aberto.termo_aceito_por}${aberto.previsao_devolucao ? ` · devolver até ${formatarData(aberto.previsao_devolucao)}` : ''}`}
            valor={editar ? <Button size="sm" variant="secondary" disabled={devolver.isPending}
              onClick={() => devolver.mutate({ p_emprestimo: aberto.id, p_data: hojeSP(), p_observacao: null }, { onSuccess: () => toast.success('Devolução registrada'), onError: (e) => toast.error(erroMsg(e)) })}>
              <Undo2 data-icon="inline-start" aria-hidden="true" />Devolvido</Button> : undefined} />
        ) : <Linha icone={HandHelping} cor="cinza" titulo="Não está emprestado" />}
        {editar && b.situacao === 'disponivel' && pode(perfil, 'pessoas', 'ver') && <Linha icone={Plus} cor="cinza" titulo="Emprestar a um atleta" aoTocar={() => setFolha('emprestar')} seta />}
        {historico.filter((e) => e.devolvido_em).slice(0, 10).map((e) => (
          <Linha key={e.id} titulo={nomePessoa(e.pessoa_id)} descricao={`${formatarData(e.inicio)} a ${formatarData(e.devolvido_em)}${e.observacao ? ` · ${e.observacao}` : ''}`} />
        ))}
      </Grupo>

      <Grupo titulo="Manutenção" acao={editar ? <Button variant="link" size="xs" onClick={() => setFolha('manutencao')}>Registrar</Button> : undefined}>
        {(manut.data ?? []).length === 0 && <Linha titulo="Nenhuma manutenção registrada" />}
        {(manut.data ?? []).map((m) => (
          <Linha key={m.id} icone={Wrench} cor="laranja" titulo={m.descricao}
            descricao={[formatarData(m.data), m.proxima_em && `próxima em ${formatarData(m.proxima_em)}`].filter(Boolean).join(' · ')}
            valor={m.custo ? <Valor valor={m.custo} className="text-foreground text-[15px]" /> : undefined} />
        ))}
      </Grupo>

      {editar && b.situacao !== 'emprestado' && (
        <Grupo><Linha icone={Archive} destrutiva titulo="Dar baixa no bem" descricao="Perdido, quebrado sem conserto, doado ou vendido. O registro fica no histórico." aoTocar={() => setFolha('baixar')} /></Grupo>
      )}

      {folha === 'editar' && <FormBem bem={b} aoFechar={() => setFolha(null)} />}
      {folha === 'emprestar' && <FormEmprestimo bem={b} aoFechar={() => setFolha(null)} />}
      {folha === 'manutencao' && <FormManutencao bem={b} aoFechar={() => setFolha(null)} />}
      {folha === 'baixar' && <FormBaixa bem={b} aoFechar={() => setFolha(null)} />}
    </Pagina>
  );
}

function FormEmprestimo({ bem, aoFechar }: { bem: Bem; aoFechar: () => void }) {
  const pessoas = usePessoas();
  const emprestar = useAcaoF4('emprestar_bem');
  const [id] = useState(() => crypto.randomUUID());
  const [pessoa, setPessoa] = useState('');
  const [previsao, setPrevisao] = useState(somarDias(hojeSP(), 90));
  const [aceito, setAceito] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const atletas = (pessoas.data ?? []).filter((p) => p.atleta && p.situacao === 'ativo');
  const p = atletas.find((x) => x.id === pessoa);
  const menor = !!p && menorDeIdade(p.data_nascimento);
  const quemAceita = p ? (menor ? p.responsavel_nome ?? '' : p.nome) : '';
  async function enviar() {
    setErro(null);
    try {
      await emprestar.mutateAsync({ p: { id, bem_id: bem.id, pessoa_id: pessoa, inicio: hojeSP(), previsao_devolucao: previsao || null,
        termo_versao: TERMO_ATUAL, termo_aceito_por: quemAceita, termo_aceito_em: hojeSP() } });
      toast.success('Empréstimo registrado'); aoFechar();
    } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo={`Emprestar ${bem.numero}`} descricao="Com termo de responsabilidade assinado."
      rodape={<Button size="lg" className="w-full" disabled={!pessoa || !aceito || !quemAceita || emprestar.isPending} onClick={() => void enviar()}>{emprestar.isPending && <Spinner data-icon="inline-start" />}Registrar empréstimo</Button>}>
      <FieldGroup className="pb-2">
        <Field>
          <FieldLabel htmlFor="em-pessoa">Atleta</FieldLabel>
          <Select value={pessoa} onValueChange={setPessoa}>
            <SelectTrigger id="em-pessoa"><SelectValue placeholder="Escolha o atleta" /></SelectTrigger>
            <SelectContent><SelectGroup>{atletas.map((a) => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        </Field>
        <Field><FieldLabel htmlFor="em-prev">Devolver até</FieldLabel><Input id="em-prev" name="em-prev" type="date" min={hojeSP()} value={previsao} onChange={(e) => setPrevisao(e.target.value)} /></Field>
        {p && (menor && !p.responsavel_nome
          ? <FieldError role="alert">Menor de idade sem responsável no cadastro. Complete o cadastro antes.</FieldError>
          : (
            <label className="bg-muted/60 flex items-start gap-3 rounded-[14px] p-3 text-[15px]">
              <Checkbox checked={aceito} onCheckedChange={(c) => setAceito(c === true)} className="mt-0.5" />
              <span><b>{quemAceita}</b>{menor ? ' (responsável)' : ''} leu e assinou o termo de responsabilidade ({TERMO_ATUAL}) hoje.</span>
            </label>
          ))}
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

function FormManutencao({ bem, aoFechar }: { bem: Bem; aoFechar: () => void }) {
  const registrar = useAcaoF4('registrar_manutencao');
  const [id] = useState(() => crypto.randomUUID());
  const [data, setData] = useState(hojeSP());
  const [descricao, setDescricao] = useState('');
  const [custo, setCusto] = useState('');
  const [proxima, setProxima] = useState('');
  const [parado, setParado] = useState(bem.situacao === 'manutencao');
  const [erro, setErro] = useState<string | null>(null);
  async function enviar() {
    setErro(null);
    const c = custo.trim() ? lerValorBRL(custo) : null;
    if (custo.trim() && !c) return setErro('Confira o custo.');
    try {
      await registrar.mutateAsync({ p: { id, bem_id: bem.id, data, descricao: descricao.trim(), custo: c, proxima_em: proxima || null,
        ...(bem.situacao !== 'emprestado' ? { em_manutencao: parado } : {}) } });
      toast.success('Manutenção registrada'); aoFechar();
    } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo="Registrar manutenção" descricao="O gasto em dinheiro é lançado no Dinheiro, como sempre."
      rodape={<Button size="lg" className="w-full" disabled={descricao.trim().length < 2 || registrar.isPending} onClick={() => void enviar()}>{registrar.isPending && <Spinner data-icon="inline-start" />}Registrar</Button>}>
      <FieldGroup className="pb-2">
        <Field><FieldLabel htmlFor="mt-desc">O que foi feito</FieldLabel><Input id="mt-desc" name="mt-desc" maxLength={300} autoComplete="off" placeholder="Ex.: troca de pneus…" value={descricao} onChange={(e) => setDescricao(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field><FieldLabel htmlFor="mt-data">Data</FieldLabel><Input id="mt-data" name="mt-data" type="date" max={hojeSP()} value={data} onChange={(e) => setData(e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="mt-custo">Custo (R$)</FieldLabel><Input id="mt-custo" name="mt-custo" inputMode="numeric" autoComplete="off" placeholder="0,00" value={custo} onChange={(e) => setCusto(mascararValor(e.target.value))} /></Field>
        </div>
        <Field><FieldLabel htmlFor="mt-prox">Próxima manutenção (opcional)</FieldLabel><Input id="mt-prox" name="mt-prox" type="date" min={somarDias(data, 1)} value={proxima} onChange={(e) => setProxima(e.target.value)} />
          <FieldDescription>Aparece na agenda.</FieldDescription></Field>
        {bem.situacao !== 'emprestado' && <label className="flex items-center gap-2 text-[17px]"><Checkbox checked={parado} onCheckedChange={(c) => setParado(c === true)} />Bem continua parado na manutenção</label>}
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

function FormBaixa({ bem, aoFechar }: { bem: Bem; aoFechar: () => void }) {
  const baixar = useAcaoF4('baixar_bem');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  async function enviar() {
    setErro(null);
    try { await baixar.mutateAsync({ p_id: bem.id, p_motivo: motivo.trim() }); toast.success('Baixa registrada'); aoFechar(); } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo={`Baixa de ${bem.numero}`} descricao="Depois da baixa o bem não pode mais ser editado nem emprestado."
      rodape={<Button size="lg" variant="destructive" className="w-full" disabled={motivo.trim().length < 3 || baixar.isPending} onClick={() => void enviar()}>{baixar.isPending && <Spinner data-icon="inline-start" />}Dar baixa</Button>}>
      <FieldGroup className="pb-2">
        <Field><FieldLabel htmlFor="bx-motivo">Motivo</FieldLabel><Input id="bx-motivo" name="bx-motivo" maxLength={300} autoComplete="off" placeholder="Ex.: quadro quebrado sem conserto…" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Field>
        {bem.projeto_id && <FieldDescription>Bem de projeto: confira se o termo do projeto exige autorização para a baixa.</FieldDescription>}
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

