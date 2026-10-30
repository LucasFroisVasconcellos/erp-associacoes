import { MODULOS, podeVerModulo } from '@/lib/modulos';
import { BotaoBusca } from '@/components/app/busca';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Bell, CalendarClock, CalendarPlus, Check, CheckCircle2, CircleDashed, CloudUpload, FileWarning, HandCoins, ListPlus, Lock, Settings, Wallet } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Grupo, Linha } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { BlocoErro, CarregandoLista, Vazio } from '@/components/app/estados';
import { Valor } from '@/components/app/valor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePerfil } from '@/app/sessao';
import { chaves, useCategorias, useConfigPix, useContas, useLista, useMembros, useNotificacoes, usePainel, usePessoas } from '@/dados/consultas';
import { fonte } from '@/dados/fonte';
import { pode } from '@/lib/acesso';
import { apagarRascunho, listarRascunhos, type Rascunho } from '@/lib/comprovante';
import { formatarData, mesPorExtenso, somarDias } from '@/lib/datas';
import { ErroApp } from '@/lib/erros';
import { contar } from '@/lib/texto';
import { useNovoLancamento } from '@/telas/dinheiro/novo-lancamento';
import { useLinhasFase4, useLinhasFase5 } from './fase4';
import { MinhasTarefas, ProximosEventos, useLinhaMural } from './organizacao';


function proporcao(livre: string | null, proj: string | null) {
  const l = Math.max(0, Number(livre ?? 0)); const p = Math.max(0, Number(proj ?? 0));
  return l + p > 0 ? (l / (l + p)) * 100 : 100;
}

function Saldo() {
  const painel = usePainel();
  if (painel.isPending) return <Card><CardContent className="flex flex-col gap-3"><Skeleton className="h-4 w-32" /><Skeleton className="h-12 w-56" /><Skeleton className="h-2 w-full" /></CardContent></Card>;
  if (painel.isError) return <BlocoErro erro={painel.error} tentarDeNovo={() => void painel.refetch()} />;
  const p = painel.data;
  if (p.saldo_total === null) {
    return (
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Lock aria-hidden="true" className="size-5" />Saldos da associação</CardTitle>
        <CardDescription>Seu acesso mostra só os lançamentos que você fez. Os saldos aparecem para quem acompanha todo o financeiro.</CardDescription></CardHeader></Card>
    );
  }
  const pct = proporcao(p.saldo_livre, p.saldo_projetos);
  return (
    <section aria-labelledby="titulo-saldo" className="bg-card rounded-[24px] p-5 shadow-[0_1px_3px_rgba(0,0,0,0.05)] sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 id="titulo-saldo" className="text-muted-foreground text-[15px] font-medium">Saldo da Associação Exemplo</h2>
        <Button asChild variant="link" size="xs"><Link to="/dinheiro/contas">Ver contas</Link></Button>
      </div>
      <Valor valor={p.saldo_total} className="font-rounded mt-1 block text-[44px] leading-none font-bold tracking-[-0.03em] sm:text-[52px]" />
      <div className="mt-5 flex h-2.5 overflow-hidden rounded-full bg-[var(--chart-4)]/25" aria-hidden="true">
        <div className="bg-primary h-full rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]" style={{ width: `${pct}%` }} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-[15px]">
        <div>
          <dt className="flex items-center gap-1.5"><span aria-hidden="true" className="bg-primary size-2.5 rounded-full" />Livre</dt>
          <dd><Valor valor={p.saldo_livre} className="text-[17px] font-semibold" /></dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-full bg-[var(--chart-4)]" />De projetos</dt>
          <dd><Valor valor={p.saldo_projetos} className="text-[17px] font-semibold" /></dd>
        </div>
      </dl>
      <p className="text-muted-foreground mt-3 text-[13px] text-pretty">Dinheiro de projetos só pode ser usado no que o projeto aprovou.</p>
    </section>
  );
}

function Rascunhos() {
  const qc = useQueryClient();
  const perfil = usePerfil();
  const r = useQuery({ queryKey: ['rascunhos', perfil.membro.id], queryFn: () => listarRascunhos(perfil.membro.id) });
  const enviando = useRef(false);
  async function enviar(x: Rascunho) {
    if (enviando.current) return;
    enviando.current = true;
    try {
      if (!x.lancamentoSalvo) await fonte().rpc('criar_lancamento', { p: x.dados }); // idempotente pelo id
      for (const a of x.arquivos) {
        const fd = new FormData();
        fd.set('destino', 'comprovante'); fd.set('lancamento_id', x.id); fd.set('origem', a.origem); fd.set('arquivo', new File([a.blob], a.nome, { type: a.blob.type }));
        await fonte().enviarArquivo(fd);
      }
      await apagarRascunho(x.id);
      toast.success('Rascunho enviado.');
      for (const k of [['rascunhos'], chaves.painel, ['lancamentos']]) void qc.invalidateQueries({ queryKey: k });
    } catch (e) {
      toast.error(e instanceof ErroApp ? e.message : 'Não foi possível enviar agora.');
    } finally { enviando.current = false; }
  }
  if (!r.data?.length) return null;
  return (
    <Grupo titulo="Guardados neste aparelho" rodape="Foram salvos sem internet. Envie quando a conexão voltar.">
      {r.data.map((x) => (
        <Linha key={x.id} icone={CloudUpload} cor="laranja" titulo={String(x.dados.descricao ?? 'Lançamento')}
          descricao={`${contar(x.arquivos.length, 'comprovante', 'comprovantes')} · ${formatarData(String(x.dados.data ?? ''))}`}
          valor={<Button size="sm" onClick={() => void enviar(x)}>Enviar agora</Button>} />
      ))}
    </Grupo>
  );
}

function useLinhasAlertas() {
  const { data: p } = usePainel();
  if (!p) return [];
  const a = p.alertas;
  const linhas = [
    a.sem_comprovante > 0 && <Linha key="c" icone={FileWarning} cor="vermelho" titulo={contar(a.sem_comprovante, 'saída sem comprovante', 'saídas sem comprovante')} descricao="Anexe o comprovante ou justifique." para="/dinheiro?situacao=sem_comprovante" />,
    a.vencidas > 0 && <Linha key="v" icone={CalendarClock} cor="laranja" titulo={contar(a.vencidas, 'conta vencida', 'contas vencidas')} descricao="Dê baixa ou ajuste o vencimento." para="/dinheiro?aba=prever" />,
    a.reembolsos_pendentes > 0 && <Linha key="r" icone={HandCoins} cor="roxo" titulo={contar(a.reembolsos_pendentes, 'pedido de reembolso', 'pedidos de reembolso')} descricao="Aguardando decisão da tesouraria." para="/dinheiro?aba=reembolsos" />,
    a.mes_anterior_aberto && <Linha key="m" icone={AlertTriangle} cor="laranja" titulo="O mês passado ainda não foi fechado" descricao="Faça a conferência e envie ao contador." para="/dinheiro/fechamento" />,
  ].filter((x) => !!x);
  return linhas;
}

// O mais grave (vermelho) primeiro; mostra 4 e o resto em "Ver mais".
const PESO: Record<string, number> = { vermelho: 0, laranja: 1 };
function PrecisaDeVoce() {
  const n = useNotificacoes();
  const qc = useQueryClient();
  const [tudo, setTudo] = useState(false);
  const mural = useLinhaMural();
  const fin = useLinhasAlertas(), f4 = useLinhasFase4(), f5 = useLinhasFase5();
  const avisos = (n.data ?? []).filter((x) => !x.lida_em).slice(0, 2)
    .map((x) => <Linha key={`n${x.id}`} icone={Bell} cor="azul" titulo={x.texto} descricao={formatarData(x.criada_em)} />);
  const linhas = [...avisos, ...[mural, ...fin, ...f4, ...f5].filter((x) => !!x)
    .sort((a, b) => (PESO[(a.props as { cor?: string }).cor ?? ''] ?? 2) - (PESO[(b.props as { cor?: string }).cor ?? ''] ?? 2))];
  const visiveis = tudo ? linhas : linhas.slice(0, 4);
  return (
    <Grupo titulo={linhas.length ? `Precisa de você · ${linhas.length}` : 'Precisa de você'}
      acao={avisos.length ? <Button variant="link" size="xs" onClick={() => void fonte().rpc('marcar_avisos_lidos').then(() => qc.invalidateQueries({ queryKey: chaves.notificacoes }))}>Marcar avisos como lidos</Button> : undefined}>
      {linhas.length === 0 ? <Linha icone={CheckCircle2} cor="verde" titulo="Tudo em dia" descricao="Nada pedindo a sua atenção agora." /> : visiveis}
      {linhas.length > 4 && <Linha titulo={tudo ? 'Mostrar menos' : `Ver mais ${linhas.length - 4}`} aoTocar={() => setTudo(!tudo)} />}
    </Grupo>
  );
}

function Proximos() {
  const { data: p } = usePainel();
  if (!p) return null;
  const itens = [...p.a_pagar, ...p.a_receber].sort((x, y) => x.data.localeCompare(y.data));
  return (
    <Grupo titulo="Próximos 15 dias" acao={<Button asChild variant="link" size="xs"><Link to="/dinheiro?aba=prever">Ver tudo</Link></Button>}>
      {itens.length === 0
        ? <Linha titulo="Nada a pagar ou receber nos próximos 15 dias" />
        : itens.slice(0, 4).map((i) => (
          <Linha key={i.id} titulo={i.descricao} descricao={`${i.tipo === 'saida' ? 'Pagar' : 'Receber'} até ${formatarData(i.data)}`}
            valor={<Valor valor={i.valor} tipo={i.tipo} className="text-foreground text-[15px] font-medium" />} valorNoTitulo para={`/dinheiro/lancamento/${i.id}`} />
        ))}
    </Grupo>
  );
}

export function Inicio() {
  const perfil = usePerfil();
  const verFin = pode(perfil, 'financeiro', 'ver');
  const painel = usePainel();
  const gerou = useRef(false);
  useEffect(() => {
    // gera as contas recorrentes previstas (idempotente no servidor)
    if (gerou.current || !verFin || !painel.data) return;
    gerou.current = true;
    void fonte().rpc('gerar_previstos', { p_ate: somarDias(painel.data.hoje, 45) }).catch(() => undefined);
  }, [verFin, painel.data]);
  const primeiroNome = perfil.membro.nome.split(' ')[0];
  return (
    <Pagina titulo={`Olá, ${primeiroNome}`} larga acoes={
      <>
        <BotaoBusca className="lg:hidden" />
        {podeVerModulo(perfil, MODULOS.find((m) => m.id === 'avisos')!) && <Button asChild variant="ghost" size="icon"><Link to="/avisos" aria-label="Avisos"><Bell aria-hidden="true" /></Link></Button>}
        <Button asChild variant="ghost" size="icon" className="lg:hidden"><Link to="/ajustes" aria-label="Ajustes"><Settings aria-hidden="true" /></Link></Button>
      </>
    }>
      {verFin ? (
        <div className="grid gap-7 lg:grid-cols-2 lg:items-start">
          <div className="flex flex-col gap-7">
            <Saldo />
            {painel.data && (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-card rounded-[18px] p-4">
                  <p className="text-muted-foreground text-[13px]">Entrou em {mesPorExtenso(painel.data.hoje).split(' de ')[0]}</p>
                  <Valor valor={painel.data.mes.entradas} tipo="entrada" className="font-rounded text-[22px] font-bold" />
                </div>
                <div className="bg-card rounded-[18px] p-4">
                  <p className="text-muted-foreground text-[13px]">Saiu em {mesPorExtenso(painel.data.hoje).split(' de ')[0]}</p>
                  <Valor valor={painel.data.mes.saidas} tipo="saida" className="font-rounded text-[22px] font-bold" />
                </div>
              </div>
            )}
            <AtalhosRapidos />
            <PrimeirosPassos />
            <Rascunhos />
          </div>
          <div className="flex flex-col gap-7">
            <PrecisaDeVoce />
            <MinhasTarefas />
            <ProximosEventos />
            {painel.isPending ? <CarregandoLista linhas={3} /> : <Proximos />}
          </div>
        </div>
      ) : (
        <>
          <PrecisaDeVoce />
          <MinhasTarefas />
          <ProximosEventos />
          <Vazio icone={Wallet} titulo="Bem-vindo(a) ao sistema da Associação Exemplo" descricao="Seu acesso ainda não inclui o financeiro. Use o menu para ver as áreas liberadas para você." />
        </>
      )}
    </Pagina>
  );
}

function AtalhosRapidos() {
  const perfil = usePerfil();
  const novo = useNovoLancamento();
  const itens = [
    pode(perfil, 'financeiro', 'criar') && { nome: 'Saiu dinheiro', icone: ArrowUpRight, acao: () => novo.abrir('saida') },
    pode(perfil, 'financeiro', 'criar') && { nome: 'Entrou dinheiro', icone: ArrowDownLeft, acao: () => novo.abrir('entrada') },
    pode(perfil, 'tarefas', 'criar') && { nome: 'Nova tarefa', icone: ListPlus, para: '/tarefas?nova=1' },
    pode(perfil, 'agenda', 'criar') && { nome: 'Novo evento', icone: CalendarPlus, para: '/agenda?novo=1' },
  ].filter((x) => !!x);
  if (!itens.length) return null;
  return (
    <nav aria-label="Atalhos" className="grid grid-cols-4 gap-2">
      {itens.map((x) => {
        const conteudo = <><span className="bg-tint/12 text-tint inline-flex size-11 items-center justify-center rounded-full"><x.icone aria-hidden="true" className="size-5" /></span><span className="text-center text-[12px] leading-tight">{x.nome}</span></>;
        const cls = 'flex flex-col items-center gap-1.5 rounded-[14px] py-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/35 active:opacity-70';
        return 'para' in x ? <Link key={x.nome} to={x.para!} className={cls}>{conteudo}</Link> : <button key={x.nome} type="button" className={cls} onClick={x.acao}>{conteudo}</button>;
      })}
    </nav>
  );
}

function PrimeirosPassos() {
  const perfil = usePerfil();
  const adm = perfil.membro.admin || pode(perfil, 'financeiro', 'administrar');
  const verPessoas = pode(perfil, 'pessoas', 'ver');
  const contas = useContas(); const categorias = useCategorias();
  const membros = useMembros(perfil.membro.admin);
  const plano = useLista<{ id: string }>('plano_contas', { limite: 1 }, adm);
  const entidade = useLista<{ chave: string }>('configuracoes', { onde: { chave: 'entidade' } }, adm);
  const pix = useConfigPix();
  const pessoas = usePessoas(verPessoas);
  const chaveOculto = `erp:primeiros-passos:${perfil.membro.id}`;
  const [oculto, setOculto] = useState(() => { try { return localStorage.getItem(chaveOculto) === '1'; } catch { return false; } });
  if (!adm || oculto) return null;
  const passos = [
    { feito: (contas.data ?? []).length > 0, titulo: 'Cadastrar as contas da Associação Exemplo', descricao: 'Banco, caixinha e contas de projeto, com o saldo inicial', para: '/dinheiro/contas' },
    { feito: (categorias.data ?? []).length > 0, titulo: 'Criar as categorias', descricao: 'Como o dinheiro é organizado (ex.: Transporte, Mensalidades)', para: '/dinheiro/cadastros' },
    { feito: (plano.data ?? []).length > 0, titulo: 'Importar o plano de contas do contador', descricao: 'E ligar cada categoria a uma conta dele', para: '/dinheiro/importar' },
    ...(perfil.membro.admin ? [{ feito: (membros.data ?? []).length > 1, titulo: 'Convidar a diretoria', descricao: 'Cada pessoa com o acesso que precisa', para: '/acessos' }] : []),
    { feito: (entidade.data ?? []).length > 0 && !!pix.data, titulo: 'Dados da Associação Exemplo e chave Pix', descricao: 'Nome e CNPJ nos recibos; Pix nas mensalidades', para: '/captacao?aba=recibos' },
    ...(verPessoas ? [{ feito: (pessoas.data ?? []).length > 0, titulo: 'Cadastrar atletas e associados', descricao: 'Ou importar depois, aos poucos', para: '/pessoas' }] : []),
  ];
  const carregando = contas.isPending || categorias.isPending;
  const feitos = passos.filter((p) => p.feito).length;
  if (carregando || feitos === passos.length) return null;
  return (
    <Grupo titulo={`Primeiros passos · ${feitos} de ${passos.length}`}
      acao={<Button variant="link" size="xs" onClick={() => { try { localStorage.setItem(chaveOculto, '1'); } catch { /* sem armazenamento */ } setOculto(true); }}>Ocultar</Button>}
      rodape="O sistema começa vazio: nenhum dado de exemplo vai para o sistema real. Siga a ordem e toque no (?) ao lado do título de cada tela se tiver dúvida.">
      {passos.map((p, i) => (
        <Linha key={p.titulo} icone={p.feito ? Check : CircleDashed} cor={p.feito ? 'verde' : 'azul'} titulo={`${i + 1}. ${p.titulo}`} descricao={p.descricao} para={p.feito ? undefined : p.para} />
      ))}
    </Grupo>
  );
}
