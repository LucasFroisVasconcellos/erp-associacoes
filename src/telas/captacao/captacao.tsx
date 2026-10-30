import { ASSOCIACAO } from '@/lib/associacao';
import { Building2, Check, FileDown, Handshake, MessageSquare, Plus, Receipt, Settings2, Ticket } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { AbrirDocumento, AnexarDocumento } from '@/components/app/arquivo-documento';
import { BlocoErro, CarregandoLista, Vazio } from '@/components/app/estados';
import { FormularioRpc, type Campo } from '@/components/app/formulario';
import { Grupo, Linha } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { Segmentado } from '@/components/app/segmentado';
import { Valor } from '@/components/app/valor';
import { Folha } from '@/components/app/folha';
import { Button } from '@/components/ui/button';
import { usePerfil } from '@/app/sessao';
import { useAcaoF5, useLancamentos, useLista, useMembros, useRpc, useVerbas } from '@/dados/consultas';
import type {
  AcaoCaptacao, ConfigEntidade, Contrapartida, EtapaFunil, Interacao, Oportunidade, PainelCaptacao, Recibo, TipoOportunidade, Vendedor,
} from '@/dados/tipos';
import { pode } from '@/lib/acesso';
import { formatarData, hojeSP, somarDias } from '@/lib/datas';
import { formatarBRL } from '@/lib/dinheiro';
import { contar } from '@/lib/texto';
import { erroMsg, nomeDe } from '@/telas/organizacao/comum';

export const NOME_ETAPA: Record<EtapaFunil, string> = {
  prospeccao: 'Prospecção', contato: 'Contato feito', proposta: 'Proposta enviada', fechado: 'Fechado', renovacao: 'Renovação', perdido: 'Perdido',
};
const NOME_TIPO: Record<TipoOportunidade, string> = { patrocinio: 'Patrocínio', doacao: 'Doação', incentivo_ir: 'Imposto de Renda (incentivo)', edital: 'Edital', outro: 'Outro' };
const opcoes = <T extends string>(r: Record<T, string>) => (Object.keys(r) as T[]).map((valor) => ({ valor, rotulo: r[valor] }));

const CAMPOS_OPORTUNIDADE: Campo[] = [
  { nome: 'nome', rotulo: 'Empresa ou pessoa', tipo: 'texto', obrigatorio: true },
  { nome: 'tipo', rotulo: 'Tipo', tipo: 'escolha', opcoes: opcoes(NOME_TIPO), obrigatorio: true, meia: true },
  { nome: 'etapa', rotulo: 'Etapa', tipo: 'escolha', opcoes: opcoes(NOME_ETAPA), obrigatorio: true, meia: true },
  { nome: 'contato', rotulo: 'Contato', tipo: 'texto', placeholder: 'Setor ou nome de quem atende', ajuda: 'Só o contato de trabalho. Nada de CPF aqui.' },
  { nome: 'valor_estimado', rotulo: 'Valor estimado (R$)', tipo: 'valor', meia: true },
  { nome: 'proximo_passo_em', rotulo: 'Data do próximo passo', tipo: 'data', meia: true },
  { nome: 'proximo_passo', rotulo: 'Próximo passo', tipo: 'texto', max: 200, ajuda: 'Aparece na agenda.' },
  { nome: 'responsavel', rotulo: 'Quem cuida', tipo: 'membro' },
];
type Aba = 'funil' | 'acoes' | 'recibos' | 'contrapartidas';
const ORDEM_ETAPAS: EtapaFunil[] = ['proposta', 'contato', 'prospeccao', 'renovacao', 'fechado', 'perdido'];

export function Captacao() {
  const perfil = usePerfil();
  const [params, setParams] = useSearchParams();
  const aba = (['acoes', 'recibos', 'contrapartidas'].includes(params.get('aba') ?? '') ? params.get('aba') : 'funil') as Aba;
  const [nova, setNova] = useState(false);
  const podeRecibos = (pode(perfil, 'financeiro', 'ver') && perfil.permissoes.some((p) => p.modulo === 'financeiro' && p.acao === 'ver' && p.alcance === 'tudo')) || pode(perfil, 'captacao', 'editar');
  const abas = [{ valor: 'funil' as const, rotulo: 'Funil' }, { valor: 'acoes' as const, rotulo: 'Rifas' }, ...(podeRecibos ? [{ valor: 'recibos' as const, rotulo: 'Recibos' }] : []),
    { valor: 'contrapartidas' as const, rotulo: 'Contrapartidas' }];
  const podeCriar = aba === 'recibos' ? pode(perfil, 'financeiro', 'editar') : pode(perfil, 'captacao', 'criar');
  return (
    <Pagina titulo="Captação" acoes={podeCriar ? <Button size="icon" variant="ghost" aria-label="Adicionar" onClick={() => setNova(true)}><Plus aria-hidden="true" /></Button> : undefined}
      sob={<Segmentado rotulo="Ver" valor={aba} aoMudar={(v) => setParams(v === 'funil' ? {} : { aba: v }, { replace: true })} opcoes={abas} />}>
      {aba === 'funil' && <Funil nova={nova} aoFecharNova={() => setNova(false)} />}
      {aba === 'acoes' && <Acoes nova={nova} aoFecharNova={() => setNova(false)} />}
      {aba === 'recibos' && <Recibos nova={nova} aoFecharNova={() => setNova(false)} />}
      {aba === 'contrapartidas' && <Contrapartidas nova={nova} aoFecharNova={() => setNova(false)} />}
    </Pagina>
  );
}

function Funil({ nova, aoFecharNova }: { nova: boolean; aoFecharNova: () => void }) {
  const ops = useLista<Oportunidade>('oportunidades', { ordem: 'atualizado_em', desc: true });
  const painel = useRpc<PainelCaptacao>('painel_captacao');
  const hoje = hojeSP();
  if (ops.isError) return <BlocoErro erro={ops.error} tentarDeNovo={() => void ops.refetch()} />;
  if (ops.isPending) return <CarregandoLista />;
  const p = painel.data;
  return (
    <>
      {p && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-card rounded-[18px] p-4"><p className="text-muted-foreground text-[13px]">Em negociação</p>
            <Valor valor={(['contato', 'proposta', 'renovacao'] as const).reduce((s, e) => s + Number(p.etapas[e]?.valor ?? 0), 0).toFixed(2)} className="font-rounded text-[22px] font-bold" /></div>
          <div className="bg-card rounded-[18px] p-4"><p className="text-muted-foreground text-[13px]">Atrasados</p>
            <p className="font-rounded numeros text-[22px] font-bold">{p.passos_atrasados + p.contrapartidas_atrasadas}</p>
            <p className="text-muted-foreground text-[13px]">{contar(p.passos_atrasados, 'próximo passo', 'próximos passos')} · {contar(p.contrapartidas_atrasadas, 'contrapartida', 'contrapartidas')}</p></div>
        </div>
      )}
      {(ops.data ?? []).length === 0 && <Vazio icone={Handshake} titulo="Funil vazio" descricao="Cadastre empresas e apoiadores, com o próximo passo de cada um. O próximo passo aparece na agenda." />}
      {ORDEM_ETAPAS.map((e) => {
        const lista = (ops.data ?? []).filter((o) => o.etapa === e);
        if (!lista.length) return null;
        return (
          <Grupo key={e} titulo={`${NOME_ETAPA[e]} (${lista.length})`}>
            {lista.map((o) => (
              <Linha key={o.id} icone={Building2} cor={e === 'fechado' ? 'verde' : e === 'perdido' ? 'cinza' : o.proximo_passo_em && o.proximo_passo_em < hoje ? 'vermelho' : 'laranja'}
                titulo={o.nome} para={`/captacao/oportunidades/${o.id}`}
                descricao={[NOME_TIPO[o.tipo], o.proximo_passo && `${o.proximo_passo}${o.proximo_passo_em ? ` (${formatarData(o.proximo_passo_em)})` : ''}`].filter(Boolean).join(' · ')}
                valor={o.valor_estimado ? <Valor valor={o.valor_estimado} className="text-foreground text-[15px]" /> : undefined} />
            ))}
          </Grupo>
        );
      })}
      {nova && <FormularioRpc titulo="Novo contato no funil" rpc="salvar_oportunidade" campos={CAMPOS_OPORTUNIDADE} inicial={{ tipo: 'patrocinio', etapa: 'prospeccao' }}
        montar={(d, novo) => ({ p: { id: novo, ...d } })} sucesso="Cadastrado no funil" aoFechar={aoFecharNova} />}
    </>
  );
}

export function DetalheOportunidade() {
  const { id = '' } = useParams();
  const perfil = usePerfil();
  const ops = useLista<Oportunidade>('oportunidades', { onde: { id } });
  const hist = useLista<Interacao>('oportunidade_interacoes', { onde: { oportunidade_id: id }, ordem: 'data', desc: true });
  const membros = useMembros();
  const [folha, setFolha] = useState<null | 'editar' | 'conversa'>(null);
  const o = ops.data?.[0];
  const voltar = { para: '/captacao', rotulo: 'Captação' };
  if (ops.isPending) return <Pagina titulo="Contato" voltar={voltar}><CarregandoLista /></Pagina>;
  if (!o) return <Pagina titulo="Contato" voltar={voltar}><Vazio icone={Building2} titulo="Não encontrado" descricao="Pode não estar visível para você." /></Pagina>;
  const editar = pode(perfil, 'captacao', 'editar') || [o.criado_por, o.responsavel].includes(perfil.membro.id);
  return (
    <Pagina titulo={o.nome} voltar={voltar} acoes={editar ? <Button variant="ghost" size="sm" onClick={() => setFolha('editar')}>Editar</Button> : undefined}>
      <Grupo>
        <Linha icone={Handshake} cor="laranja" titulo={NOME_ETAPA[o.etapa]} descricao={NOME_TIPO[o.tipo]} valor={o.valor_estimado ? formatarBRL(o.valor_estimado) : undefined} />
        {o.proximo_passo && <Linha icone={Ticket} cor="azul" titulo={o.proximo_passo} descricao={o.proximo_passo_em ? formatarData(o.proximo_passo_em) : undefined} />}
        {o.contato && <Linha titulo="Contato" descricao={o.contato} />}
        <Linha titulo="Quem cuida" valor={nomeDe(membros.data, o.responsavel ?? o.criado_por)} />
        {o.verba_id && <Linha titulo="Verba ligada" para={`/verbas/${o.verba_id}`} seta />}
      </Grupo>
      <Grupo titulo="Histórico de conversas" acao={pode(perfil, 'captacao', 'criar') ? <Button variant="link" size="xs" onClick={() => setFolha('conversa')}>Registrar</Button> : undefined}>
        {(hist.data ?? []).length === 0 && <Linha titulo="Nenhuma conversa registrada" />}
        {(hist.data ?? []).map((h) => <Linha key={h.id} icone={MessageSquare} cor="cinza" titulo={formatarData(h.data)} descricao={`${h.texto} — ${nomeDe(membros.data, h.autor)}`} />)}
      </Grupo>
      {folha === 'editar' && <FormularioRpc titulo="Editar" rpc="salvar_oportunidade" campos={CAMPOS_OPORTUNIDADE} inicial={o as unknown as Record<string, unknown>}
        montar={(d) => ({ p: { id: o.id, verba_id: o.verba_id, ...d } })} aoFechar={() => setFolha(null)} />}
      {folha === 'conversa' && <FormularioRpc titulo="Registrar conversa" rpc="registrar_interacao" sucesso="Registrado" inicial={{ data: hojeSP() }}
        campos={[{ nome: 'data', rotulo: 'Quando', tipo: 'data', obrigatorio: true }, { nome: 'texto', rotulo: 'O que foi conversado', tipo: 'textarea', obrigatorio: true, max: 1000 }]}
        montar={(d, novo) => ({ p_oportunidade: o.id, p: { id: novo, ...d } })} aoFechar={() => setFolha(null)} />}
    </Pagina>
  );
}

const CAMPOS_ACAO: Campo[] = [
  { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
  { nome: 'tipo', rotulo: 'Tipo', tipo: 'escolha', opcoes: [{ valor: 'rifa', rotulo: 'Rifa ou sorteio' }, { valor: 'evento', rotulo: 'Evento' }], obrigatorio: true, meia: true },
  { nome: 'data', rotulo: 'Data (sorteio ou evento)', tipo: 'data', obrigatorio: true, meia: true },
  { nome: 'preco_unitario', rotulo: 'Preço do bilhete ou ingresso', tipo: 'valor', meia: true },
  { nome: 'quantidade', rotulo: 'Total de bilhetes', tipo: 'numero', meia: true },
  { nome: 'custo', rotulo: 'Custo (prêmio, comida, local)', tipo: 'valor' },
  { nome: 'situacao', rotulo: 'Situação', tipo: 'escolha', opcoes: [{ valor: 'planejada', rotulo: 'Planejada' }, { valor: 'em_andamento', rotulo: 'Em andamento' },
    { valor: 'encerrada', rotulo: 'Encerrada' }, { valor: 'cancelada', rotulo: 'Cancelada' }], obrigatorio: true },
  { nome: 'autorizacao', rotulo: 'Regra legal conferida', tipo: 'texto', max: 300, ajuda: '⚖️ Rifas e sorteios têm regras próprias: anote onde está a autorização ou o parecer do contador.' },
];

function Acoes({ nova, aoFecharNova }: { nova: boolean; aoFecharNova: () => void }) {
  const acoes = useLista<AcaoCaptacao>('acoes_captacao', { ordem: 'data', desc: true });
  const painel = useRpc<PainelCaptacao>('painel_captacao');
  if (acoes.isPending) return <CarregandoLista />;
  const res = (id: string) => painel.data?.acoes.find((a) => a.id === id);
  return (
    <>
      {(acoes.data ?? []).length === 0 && <Vazio icone={Ticket} titulo="Nenhuma rifa ou evento" descricao="Controle bilhetes, vendedores, o que foi arrecadado, o custo e o resultado." />}
      {(acoes.data ?? []).length > 0 && (
        <Grupo>
          {(acoes.data ?? []).map((a) => (
            <Linha key={a.id} icone={Ticket} cor={a.situacao === 'encerrada' ? 'verde' : a.situacao === 'cancelada' ? 'cinza' : 'laranja'} titulo={a.nome} para={`/captacao/acoes/${a.id}`}
              descricao={`${a.tipo === 'rifa' ? 'Rifa' : 'Evento'} · ${formatarData(a.data)} · resultado ${formatarBRL(res(a.id)?.resultado ?? null)}`}
              valor={<Valor valor={res(a.id)?.arrecadado ?? null} className="text-foreground text-[15px]" />} />
          ))}
        </Grupo>
      )}
      {nova && <FormularioRpc titulo="Nova rifa ou evento" rpc="salvar_acao_captacao" campos={CAMPOS_ACAO} inicial={{ tipo: 'rifa', situacao: 'planejada', data: somarDias(hojeSP(), 30) }}
        montar={(d, novo) => ({ p: { id: novo, ...d, custo: d.custo ?? '0.00' } })} aoFechar={aoFecharNova} />}
    </>
  );
}

export function DetalheAcao() {
  const { id = '' } = useParams();
  const perfil = usePerfil();
  const acoes = useLista<AcaoCaptacao>('acoes_captacao', { onde: { id } });
  const vend = useLista<Vendedor>('acao_vendedores', { onde: { acao_id: id }, ordem: 'nome' });
  const painel = useRpc<PainelCaptacao>('painel_captacao');
  const filtro = useMemo(() => ({ tipo: 'entrada' as const, situacao: 'realizada' as const, inicio: somarDias(hojeSP(), -180) }), []);
  const entradas = useLancamentos(filtro);
  const [folha, setFolha] = useState<null | 'editar' | { vendedor: Vendedor | null }>(null);
  const a = acoes.data?.[0];
  const voltar = { para: '/captacao?aba=acoes', rotulo: 'Captação' };
  if (acoes.isPending) return <Pagina titulo="Ação" voltar={voltar}><CarregandoLista /></Pagina>;
  if (!a) return <Pagina titulo="Ação" voltar={voltar}><Vazio icone={Ticket} titulo="Não encontrada" descricao="Pode não estar visível para você." /></Pagina>;
  const r = painel.data?.acoes.find((x) => x.id === a.id);
  const editar = pode(perfil, 'captacao', 'editar') || a.criado_por === perfil.membro.id;
  const aberta = !['encerrada', 'cancelada'].includes(a.situacao);
  const opcoesEntrada = (entradas.data?.pages.flat() ?? []).filter((l) => !l.estorno_de && !l.estornado).slice(0, 80)
    .map((l) => ({ valor: l.id, rotulo: `${formatarData(l.data)} · ${formatarBRL(l.valor)} · ${l.descricao.slice(0, 30)}` }));
  return (
    <Pagina titulo={a.nome} voltar={voltar} acoes={editar ? <Button variant="ghost" size="sm" onClick={() => setFolha('editar')}>Editar</Button> : undefined}>
      <div className="grid grid-cols-3 gap-3 text-center">
        {[['Arrecadado', formatarBRL(r?.arrecadado ?? null)], ['Custo', formatarBRL(a.custo)], ['Resultado', formatarBRL(r?.resultado ?? null)]].map(([t, v]) => (
          <div key={t} className="bg-card rounded-[18px] p-3"><p className="numeros text-[15px] font-bold whitespace-nowrap sm:text-[17px]">{v}</p><p className="text-muted-foreground text-[13px]">{t}</p></div>
        ))}
      </div>
      <Grupo>
        <Linha titulo={a.tipo === 'rifa' ? 'Sorteio' : 'Data'} valor={formatarData(a.data)} />
        {a.quantidade && <Linha titulo="Bilhetes vendidos" valor={`${r?.vendidos ?? 0} de ${a.quantidade}`} />}
        <Linha titulo="Regra legal" descricao={a.autorizacao ?? 'Não registrada — confirme com o contador antes de vender.'} />
      </Grupo>
      <Grupo titulo="Vendedores e prestação de contas" acao={aberta && pode(perfil, 'captacao', 'criar') ? <Button variant="link" size="xs" onClick={() => setFolha({ vendedor: null })}>Adicionar</Button> : undefined}
        rodape="Ligue a entrada lançada no Dinheiro quando o vendedor prestar contas.">
        {(vend.data ?? []).length === 0 && <Linha titulo="Nenhum vendedor" />}
        {(vend.data ?? []).map((v) => (
          <Linha key={v.id} titulo={v.nome} descricao={`${v.vendidos} de ${v.bilhetes} vendidos${v.lancamento_id ? ' · entrada ligada' : ''}`}
            valor={<Valor valor={v.valor_prestado} className="text-foreground text-[15px]" />} aoTocar={aberta ? () => setFolha({ vendedor: v }) : undefined} seta={aberta} />
        ))}
      </Grupo>
      {folha === 'editar' && <FormularioRpc titulo="Editar" rpc="salvar_acao_captacao" campos={CAMPOS_ACAO} inicial={a as unknown as Record<string, unknown>}
        montar={(d) => ({ p: { id: a.id, evento_id: a.evento_id, ...d, custo: d.custo ?? '0.00' } })} aoFechar={() => setFolha(null)} />}
      {folha && typeof folha === 'object' && (
        <FormularioRpc titulo={folha.vendedor ? folha.vendedor.nome : 'Novo vendedor'} rpc="salvar_vendedor" inicial={folha.vendedor as unknown as Record<string, unknown> ?? { bilhetes: '0', vendidos: '0' }}
          campos={[
            { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true, max: 120 },
            { nome: 'bilhetes', rotulo: 'Bilhetes recebidos', tipo: 'numero', meia: true }, { nome: 'vendidos', rotulo: 'Vendidos', tipo: 'numero', meia: true },
            { nome: 'valor_prestado', rotulo: 'Valor entregue (R$)', tipo: 'valor' },
            { nome: 'lancamento_id', rotulo: 'Entrada no Dinheiro', tipo: 'escolha', opcoes: opcoesEntrada, nenhum: 'Ainda não lançada' },
          ]}
          montar={(d, novo) => ({ p_acao: a.id, p: { id: folha.vendedor?.id ?? novo, membro_id: folha.vendedor?.membro_id ?? null, ...d,
            bilhetes: d.bilhetes ?? 0, vendidos: d.vendidos ?? 0, valor_prestado: d.valor_prestado ?? '0.00' } })} aoFechar={() => setFolha(null)} />
      )}
    </Pagina>
  );
}

function Recibos({ nova, aoFecharNova }: { nova: boolean; aoFecharNova: () => void }) {
  const perfil = usePerfil();
  const recibos = useLista<Recibo>('recibos', { ordem: 'emitido_em', desc: true });
  const entidade = useLista<{ valor: ConfigEntidade }>('configuracoes', { onde: { chave: 'entidade' } });
  const filtro = useMemo(() => ({ tipo: 'entrada' as const, situacao: 'realizada' as const, inicio: somarDias(hojeSP(), -365) }), []);
  const entradas = useLancamentos(filtro);
  const [cancelar, setCancelar] = useState<Recibo | null>(null);
  const [aberto, setAberto] = useState<Recibo | null>(null);
  const [dados, setDados] = useState(false);
  const ent = entidade.data?.[0]?.valor ?? null;
  async function pdf(r: Recibo) {
    try { const m = await import('@/lib/recibo'); await m.exportarPdfRecibo(r, ent); } catch { toast.error('Não foi possível gerar o PDF.'); }
  }
  const usados = new Set((recibos.data ?? []).map((r) => r.lancamento_id));
  const opcoesEntrada = (entradas.data?.pages.flat() ?? []).filter((l) => !l.estorno_de && !l.estornado && !usados.has(l.id)).slice(0, 80)
    .map((l) => ({ valor: l.id, rotulo: `${formatarData(l.data)} · ${formatarBRL(l.valor)} · ${l.descricao.slice(0, 30)}` }));
  if (recibos.isPending) return <CarregandoLista />;
  return (
    <>
      {pode(perfil, 'financeiro', 'administrar') && (
        <Grupo><Linha icone={Settings2} cor="cinza" titulo="Dados da Associação Exemplo no recibo" descricao={ent ? `${ent.nome} · CNPJ cadastrado` : 'CNPJ e endereço ainda não cadastrados'} aoTocar={() => setDados(true)} seta /></Grupo>
      )}
      {(recibos.data ?? []).length === 0 ? <Vazio icone={Receipt} titulo="Nenhum recibo emitido" descricao="Recibos de doação saem numerados, com o valor por extenso, em PDF." /> : (
        <Grupo rodape="Toque para baixar o PDF. Recibo não se apaga: cancelar mantém o número marcado como cancelado.">
          {(recibos.data ?? []).map((r) => (
            <Linha key={r.id} icone={FileDown} cor={r.cancelado_em ? 'cinza' : 'verde'} titulo={`Nº ${r.numero}/${r.ano} — ${r.doador_nome}`} aoTocar={() => setAberto(r)} seta
              descricao={`${formatarData(r.data)} · ${r.forma === 'dinheiro' ? 'dinheiro' : r.forma === 'bens' ? 'bens' : 'serviços'}${r.cancelado_em ? ` · cancelado: ${r.motivo_cancelamento}` : ''}`}
              valor={<Valor valor={r.valor} className="text-foreground text-[15px]" />} />
          ))}
        </Grupo>
      )}
      {nova && <FormularioRpc titulo="Emitir recibo de doação" descricao="O número é dado pelo sistema, em sequência, sem buraco." rpc="emitir_recibo" sucesso="Recibo emitido"
        inicial={{ forma: 'dinheiro', data: hojeSP() }}
        campos={[
          { nome: 'doador_nome', rotulo: 'Doador', tipo: 'texto', obrigatorio: true },
          { nome: 'doador_documento', rotulo: 'CPF ou CNPJ', tipo: 'texto', max: 18, ajuda: 'Necessário para o doador abater no Imposto de Renda, quando couber.' },
          { nome: 'forma', rotulo: 'Doação em', tipo: 'escolha', opcoes: [{ valor: 'dinheiro', rotulo: 'Dinheiro' }, { valor: 'bens', rotulo: 'Bens' }, { valor: 'servicos', rotulo: 'Serviços' }], obrigatorio: true, meia: true },
          { nome: 'data', rotulo: 'Data', tipo: 'data', obrigatorio: true, meia: true },
          { nome: 'valor', rotulo: 'Valor (R$)', tipo: 'valor', obrigatorio: true, ajuda: 'Em bens ou serviços, o valor estimado.' },
          { nome: 'lancamento_id', rotulo: 'Entrada no Dinheiro (doação em dinheiro)', tipo: 'escolha', opcoes: opcoesEntrada, nenhum: 'Não é em dinheiro' },
          { nome: 'descricao', rotulo: 'O que foi doado / finalidade', tipo: 'texto', max: 300, ajuda: 'Obrigatório para bens e serviços.' },
        ]}
        montar={(d, novo) => ({ p: { id: novo, ...d } })}
        aoSalvar={(r) => toast.success(`Recibo nº ${String(r.numero)} emitido. Toque nele para baixar o PDF.`)} aoFechar={aoFecharNova} />}
      {aberto && (
        <Folha aberta aoMudar={(v) => !v && setAberto(null)} titulo={`Recibo nº ${aberto.numero}/${aberto.ano}`} descricao={`${aberto.doador_nome} · ${formatarBRL(aberto.valor)}`}>
          <div className="flex flex-col gap-2 pb-4">
            <Button size="lg" onClick={() => void pdf(aberto)}><FileDown data-icon="inline-start" aria-hidden="true" />Baixar o PDF</Button>
            {!aberto.cancelado_em && pode(perfil, 'financeiro', 'editar') && (
              <Button size="lg" variant="ghost" className="text-destructive" onClick={() => { setCancelar(aberto); setAberto(null); }}>Cancelar o recibo</Button>
            )}
          </div>
        </Folha>
      )}
      {cancelar && <FormularioRpc titulo={`Cancelar o recibo nº ${cancelar.numero}/${cancelar.ano}`} rpc="cancelar_recibo" botao="Cancelar recibo" sucesso="Recibo cancelado"
        campos={[{ nome: 'motivo', rotulo: 'Motivo', tipo: 'texto', obrigatorio: true, max: 300 }]} montar={(d) => ({ p_id: cancelar.id, p_motivo: d.motivo })} aoFechar={() => setCancelar(null)} />}
      {dados && <FormularioRpc titulo="Dados da Associação Exemplo no recibo" rpc="salvar_config_entidade" inicial={(ent ?? { nome: ASSOCIACAO.nome, cnpj: ASSOCIACAO.cnpj }) as unknown as Record<string, unknown>}
        campos={[{ nome: 'nome', rotulo: 'Nome da associação', tipo: 'texto', obrigatorio: true }, { nome: 'cnpj', rotulo: 'CNPJ', tipo: 'texto', obrigatorio: true, max: 18 },
          { nome: 'endereco', rotulo: 'Endereço', tipo: 'texto', obrigatorio: true, max: 200 }]}
        montar={(d) => ({ p: d })} aoFechar={() => setDados(false)} />}
    </>
  );
}

function Contrapartidas({ nova, aoFecharNova }: { nova: boolean; aoFecharNova: () => void }) {
  const perfil = usePerfil();
  const lista = useLista<Contrapartida>('contrapartidas', { ordem: 'prazo' });
  const verbas = useVerbas();
  const salvar = useAcaoF5('salvar_contrapartida');
  const dadosEntrega = (c: Contrapartida) => ({ p: { id: c.id, verba_id: c.verba_id, descricao: c.descricao, prazo: c.prazo, entregue_em: c.entregue_em ? null : hojeSP(), observacao: c.observacao } });
  if (lista.isPending) return <CarregandoLista />;
  const hoje = hojeSP();
  const porVerba = new Map<string, Contrapartida[]>();
  for (const c of lista.data ?? []) porVerba.set(c.verba_id, [...(porVerba.get(c.verba_id) ?? []), c]);
  const editar = pode(perfil, 'captacao', 'criar');
  return (
    <>
      {porVerba.size === 0 && <Vazio icone={Handshake} titulo="Nenhuma contrapartida" descricao="O que a Associação Exemplo prometeu ao patrocinador (marca no uniforme, posts, placa), com prazo e foto da entrega." />}
      {[...porVerba.entries()].map(([verba, cs]) => (
        <Grupo key={verba} titulo={verbas.data?.find((v) => v.id === verba)?.titulo ?? 'Verba'} acao={<Button asChild variant="link" size="xs"><Link to={`/verbas/${verba}`}>Ver verba</Link></Button>}>
          {cs.map((c) => (
            <Linha key={c.id} icone={Handshake} cor={c.entregue_em ? 'verde' : c.prazo && c.prazo < hoje ? 'vermelho' : 'laranja'} titulo={c.descricao}
              descricao={c.entregue_em ? `Entregue em ${formatarData(c.entregue_em)}${c.arquivo_caminho ? ' · com foto' : ''}` : c.prazo ? `Prazo ${formatarData(c.prazo)}` : 'Sem prazo'}
              valor={<span className="flex items-center gap-1">
                {editar && <Button size="icon-sm" variant={c.entregue_em ? 'ghost' : 'secondary'} aria-label={`${c.entregue_em ? 'Desmarcar entrega' : 'Marcar como entregue'}: ${c.descricao}`}
                  title={c.entregue_em ? 'Desmarcar entrega' : 'Marcar como entregue'} disabled={salvar.isPending}
                  onClick={() => salvar.mutate(dadosEntrega(c), { onSuccess: () => toast.success(c.entregue_em ? 'Entrega desmarcada' : 'Marcada como entregue'), onError: (e) => toast.error(erroMsg(e)) })}>
                  <Check aria-hidden="true" /></Button>}
                {c.arquivo_caminho && <AbrirDocumento area="contrapartida" caminho={c.arquivo_caminho} rotulo={c.descricao} />}
                {editar && <AnexarDocumento area="contrapartida" documentoId={c.id} rotulo={c.descricao} temArquivo={!!c.arquivo_caminho} invalida={[['lista']]} />}
              </span>} />
          ))}
        </Grupo>
      ))}
      {nova && <FormularioRpc titulo="Nova contrapartida" rpc="salvar_contrapartida"
        campos={[
          { nome: 'verba_id', rotulo: 'Verba (patrocínio)', tipo: 'escolha', obrigatorio: true, opcoes: (verbas.data ?? []).filter((v) => !['encerrado', 'negado', 'cancelado'].includes(v.situacao)).map((v) => ({ valor: v.id, rotulo: v.titulo })) },
          { nome: 'descricao', rotulo: 'O que foi prometido', tipo: 'texto', obrigatorio: true, max: 200 },
          { nome: 'prazo', rotulo: 'Prazo', tipo: 'data' },
        ]}
        montar={(d, novo) => ({ p: { id: novo, ...d } })} aoFechar={aoFecharNova} />}
    </>
  );
}

