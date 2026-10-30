import { Ban, CalendarDays, Flag, MessageSquare, Pencil, Plus, Repeat, RotateCcw, Send, User } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { BlocoErro, CarregandoLista, Vazio } from '@/components/app/estados';
import { Grupo, Linha } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { Segmentado } from '@/components/app/segmentado';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { usePerfil } from '@/app/sessao';
import { useAcaoOrg, useComentarios, useItensTarefa, useMembros, useTarefa } from '@/dados/consultas';
import type { SituacaoTarefa } from '@/dados/tipos';
import { formatarData, hojeSP } from '@/lib/datas';
import { NOME_PRIORIDADE, NOME_SITUACAO, erroMsg, nomeDe } from '@/telas/organizacao/comum';
import { FormTarefa, Prazo, podeAndarTarefa, podeEditarTarefa } from './tarefas';

export function DetalheTarefa() {
  const { id = '' } = useParams();
  const perfil = usePerfil();
  const hoje = hojeSP();
  const tarefa = useTarefa(id);
  const itens = useItensTarefa(id);
  const comentarios = useComentarios(id);
  const membros = useMembros();
  const mudar = useAcaoOrg('mudar_situacao_tarefa');
  const salvarItem = useAcaoOrg('salvar_item_tarefa');
  const comentar = useAcaoOrg('comentar_tarefa');
  const [editando, setEditando] = useState(false);
  const [novoItem, setNovoItem] = useState('');
  const [texto, setTexto] = useState('');
  const [idComentario, setIdComentario] = useState(() => crypto.randomUUID());

  if (tarefa.isError) return <Pagina titulo="Tarefa" voltar={{ para: '/tarefas', rotulo: 'Tarefas' }}><BlocoErro erro={tarefa.error} tentarDeNovo={() => void tarefa.refetch()} /></Pagina>;
  if (tarefa.isPending) return <Pagina titulo="Tarefa" voltar={{ para: '/tarefas', rotulo: 'Tarefas' }}><CarregandoLista linhas={4} /></Pagina>;
  const t = tarefa.data;
  if (!t) return <Pagina titulo="Tarefa" voltar={{ para: '/tarefas', rotulo: 'Tarefas' }}><Vazio icone={Flag} titulo="Tarefa não encontrada" descricao="Ela pode não estar mais visível para você." /></Pagina>;

  const andar = podeAndarTarefa(perfil, t) && t.situacao !== 'cancelada';
  const editar = podeEditarTarefa(perfil, t);
  const ir = (s: SituacaoTarefa) => mudar.mutate({ p_id: t.id, p_situacao: s }, { onError: (e) => toast.error(erroMsg(e)) });
  async function adicionarItem() {
    try { await salvarItem.mutateAsync({ p_tarefa: t!.id, p: { id: crypto.randomUUID(), texto: novoItem.trim() } }); setNovoItem(''); }
    catch (e) { toast.error(erroMsg(e)); }
  }
  async function enviarComentario() {
    try {
      // o id fica o mesmo até dar certo: repetir o envio (rede ruim, clique duplo) não duplica
      await comentar.mutateAsync({ p_tarefa: t!.id, p_id: idComentario, p_texto: texto.trim() });
      setTexto(''); setIdComentario(crypto.randomUUID());
    } catch (e) { toast.error(erroMsg(e)); }
  }

  return (
    <Pagina titulo={t.titulo} voltar={{ para: '/tarefas', rotulo: 'Tarefas' }}
      acoes={editar && t.situacao !== 'cancelada' ? <Button variant="ghost" size="icon" aria-label="Editar tarefa" onClick={() => setEditando(true)}><Pencil aria-hidden="true" /></Button> : undefined}>
      {t.situacao === 'cancelada' ? (
        <div className="bg-card flex items-center justify-between gap-3 rounded-[14px] p-4">
          <span className="text-[15px]">Tarefa cancelada.</span>
          {editar && <Button variant="secondary" onClick={() => ir('a_fazer')}><RotateCcw data-icon="inline-start" aria-hidden="true" />Reabrir</Button>}
        </div>
      ) : andar ? (
        <Segmentado<SituacaoTarefa> rotulo="Situação da tarefa" valor={t.situacao} aoMudar={ir}
          opcoes={(['a_fazer', 'fazendo', 'feito'] as SituacaoTarefa[]).map((s) => ({ valor: s, rotulo: NOME_SITUACAO[s] }))} />
      ) : null}

      <Grupo>
        <Linha icone={Flag} cor={t.situacao === 'feito' ? 'verde' : 'azul'} titulo="Situação" valor={NOME_SITUACAO[t.situacao]} />
        <Linha icone={User} cor="indigo" titulo="Responsável" valor={nomeDe(membros.data, t.responsavel)} />
        <Linha icone={CalendarDays} cor="laranja" titulo="Prazo" valor={t.prazo ? <Prazo t={t} hoje={hoje} /> : 'Sem prazo'} />
        <Linha icone={Flag} cor={t.prioridade === 'alta' ? 'vermelho' : 'cinza'} titulo="Prioridade" valor={NOME_PRIORIDADE[t.prioridade]} />
        {t.recorrencia_id && <Linha icone={Repeat} cor="teal" titulo="Tarefa recorrente" descricao="Criada sozinha pela rotina." />}
        {t.evento_id && <Linha icone={CalendarDays} cor="teal" titulo="Ligada a um evento" para={`/tarefas?evento=${t.evento_id}`} descricao="Ver as outras tarefas do evento" />}
      </Grupo>
      {t.descricao && <p className="bg-card rounded-[14px] p-4 text-[15px] whitespace-pre-wrap">{t.descricao}</p>}

      <Grupo titulo={`Checklist${itens.data?.length ? ` (${itens.data.filter((i) => i.feito).length}/${itens.data.length})` : ''}`}>
        {(itens.data ?? []).map((i) => (
          <div key={i.id} className="flex items-center gap-3 px-4 py-3">
            <Checkbox id={`it-${i.id}`} checked={i.feito} disabled={!andar}
              onCheckedChange={(v) => salvarItem.mutate({ p_tarefa: t.id, p: { id: i.id, feito: v === true } }, { onError: (e) => toast.error(erroMsg(e)) })} />
            <label htmlFor={`it-${i.id}`} className={`flex-1 text-[17px] ${i.feito ? 'text-muted-foreground line-through' : ''}`}>{i.texto}</label>
            {andar && <Button size="icon-sm" variant="ghost" aria-label={`Remover o item ${i.texto}`}
              onClick={() => salvarItem.mutate({ p_tarefa: t.id, p: { id: i.id, remover: true } }, { onError: (e) => toast.error(erroMsg(e)) })}><Ban aria-hidden="true" /></Button>}
          </div>
        ))}
        {andar && (
          <form className="flex items-end gap-2 p-3" onSubmit={(e) => { e.preventDefault(); if (novoItem.trim()) void adicionarItem(); }}>
            <Field className="flex-1"><FieldLabel htmlFor="it-novo" className="sr-only">Novo item</FieldLabel>
              <Input id="it-novo" name="it-novo" maxLength={200} autoComplete="off" placeholder="Adicionar item…" value={novoItem} onChange={(e) => setNovoItem(e.target.value)} /></Field>
            <Button type="submit" size="icon" variant="secondary" aria-label="Adicionar item" disabled={!novoItem.trim() || salvarItem.isPending}><Plus aria-hidden="true" /></Button>
          </form>
        )}
        {!andar && !itens.data?.length && <Linha titulo="Sem itens" />}
      </Grupo>

      <Grupo titulo="Comentários">
        {(comentarios.data ?? []).length === 0 && <Linha icone={MessageSquare} cor="cinza" titulo="Nenhum comentário" />}
        {(comentarios.data ?? []).map((c) => (
          <div key={c.id} className="flex flex-col gap-1 px-4 py-3">
            <p className="text-muted-foreground text-[13px]">{nomeDe(membros.data, c.autor)} · {formatarData(c.criado_em)}</p>
            <p className="text-[15px] whitespace-pre-wrap">{c.texto}</p>
          </div>
        ))}
        <form className="flex flex-col gap-2 p-3" onSubmit={(e) => { e.preventDefault(); if (texto.trim()) void enviarComentario(); }}>
          <Field><FieldLabel htmlFor="tc-texto" className="sr-only">Novo comentário</FieldLabel>
            <Textarea id="tc-texto" name="tc-texto" rows={2} maxLength={2000} placeholder="Escreva um comentário…" value={texto} onChange={(e) => setTexto(e.target.value)} /></Field>
          <Button type="submit" className="self-end" disabled={!texto.trim() || comentar.isPending}>
            {comentar.isPending ? <Spinner data-icon="inline-start" /> : <Send data-icon="inline-start" aria-hidden="true" />}Comentar
          </Button>
        </form>
      </Grupo>

      {editar && t.situacao !== 'cancelada' && (
        <Grupo>
          <Linha icone={Ban} cor="vermelho" titulo="Cancelar tarefa" destrutiva aoTocar={() => ir('cancelada')}
            descricao="Ela não é apagada: some do quadro e pode ser reaberta." />
        </Grupo>
      )}
      {editando && <FormTarefa tarefa={t} aoFechar={() => setEditando(false)} />}
    </Pagina>
  );
}
