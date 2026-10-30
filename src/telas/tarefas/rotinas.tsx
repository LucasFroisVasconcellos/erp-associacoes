import { Download, LayoutTemplate, Plus, Repeat, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Folha } from '@/components/app/folha';
import { Grupo, Linha } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { Segmentado } from '@/components/app/segmentado';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { usePerfil } from '@/app/sessao';
import { useAcaoOrg, useMembros, useModelos, useRecorrentes, useTiposEvento } from '@/dados/consultas';
import type { TarefaRecorrente } from '@/dados/tipos';
import { pode } from '@/lib/acesso';
import { DIAS } from '@/lib/agenda';
import { hojeSP } from '@/lib/datas';
import { contar } from '@/lib/texto';
import { SeletorPessoa, erroMsg, nomeDe } from '@/telas/organizacao/comum';

const quando = (r: TarefaRecorrente) => (r.frequencia === 'mensal' ? `Todo dia ${r.dia}` : `Toda ${DIAS[r.dia]}`.replace('Toda sábado', 'Todo sábado').replace('Toda domingo', 'Todo domingo'));

export function Rotinas() {
  const perfil = usePerfil();
  const recorrentes = useRecorrentes();
  const modelos = useModelos();
  const membros = useMembros();
  const tipos = useTiposEvento();
  const salvarRec = useAcaoOrg('salvar_tarefa_recorrente');
  const importar = useAcaoOrg<Record<string, never>, { criados: number }>('importar_modelo_viagem');
  const [folha, setFolha] = useState<null | 'recorrente' | 'modelo'>(null);
  const podeEditar = pode(perfil, 'tarefas', 'editar');
  async function pausar(r: TarefaRecorrente, ativa: boolean) {
    try { await salvarRec.mutateAsync({ p: { id: r.id, titulo: r.titulo, descricao: r.descricao, responsavel: r.responsavel, frequencia: r.frequencia, dia: r.dia, inicio: r.inicio, fim: r.fim, lembrete_dias: r.lembrete_dias, ativa } }); }
    catch (e) { toast.error(erroMsg(e)); }
  }
  async function usarModeloViagem() {
    try { const r = await importar.mutateAsync({}); toast.success(r.criados ? 'Modelo “Viagem para competição” adicionado' : 'Esse modelo já existe'); }
    catch (e) { toast.error(erroMsg(e)); }
  }
  return (
    <Pagina titulo="Rotinas" voltar={{ para: '/tarefas', rotulo: 'Tarefas' }}>
      <Grupo titulo="Tarefas recorrentes" acao={podeEditar ? <Button variant="link" size="xs" onClick={() => setFolha('recorrente')}>Adicionar</Button> : undefined}
        rodape="O sistema cria cada ocorrência sozinho, até 5 semanas antes.">
        {(recorrentes.data ?? []).length === 0 && <Linha titulo="Nenhuma ainda" descricao="Ex.: “Conferir extrato todo dia 5”, “Enviar fechamento ao contador até o dia 10”." />}
        {(recorrentes.data ?? []).map((r) => (
          <Linha key={r.id} icone={Repeat} cor={r.ativa ? 'teal' : 'cinza'} titulo={r.titulo}
            descricao={`${quando(r)} · ${nomeDe(membros.data, r.responsavel)}${r.ativa ? '' : ' · pausada'}`}
            valor={podeEditar ? <Switch aria-label={`${r.titulo} ativa`} checked={r.ativa} onCheckedChange={(v) => void pausar(r, v)} /> : undefined} />
        ))}
      </Grupo>
      <Grupo titulo="Modelos de tarefas" acao={podeEditar ? <Button variant="link" size="xs" onClick={() => setFolha('modelo')}>Adicionar</Button> : undefined}
        rodape="Aplique um modelo a um evento da agenda e as tarefas nascem com os prazos contados a partir da data do evento.">
        {(modelos.data ?? []).map((m) => (
          <Linha key={m.id} icone={LayoutTemplate} cor="roxo" titulo={m.nome}
            descricao={`${contar(m.itens.length, 'tarefa', 'tarefas')}${m.tipo_evento_id ? ` · ${tipos.data?.find((t) => t.id === m.tipo_evento_id)?.nome ?? ''}` : ''}`} />
        ))}
        {podeEditar && <Linha icone={Download} cor="cinza" titulo={importar.isPending ? 'Adicionando…' : 'Usar o modelo “Viagem para competição”'}
          descricao="Inscrição, atletas, transporte e hospedagem acessíveis, cadeiras de jogo, acerto e relatório." aoTocar={() => void usarModeloViagem()} desabilitada={importar.isPending} />}
      </Grupo>
      {folha === 'recorrente' && <FormRecorrente aoFechar={() => setFolha(null)} />}
      {folha === 'modelo' && <FormModelo aoFechar={() => setFolha(null)} />}
    </Pagina>
  );
}

function FormRecorrente({ aoFechar }: { aoFechar: () => void }) {
  const salvar = useAcaoOrg('salvar_tarefa_recorrente');
  const [titulo, setTitulo] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [frequencia, setFrequencia] = useState<'mensal' | 'semanal'>('mensal');
  const [dia, setDia] = useState('5');
  const [lembrete, setLembrete] = useState('1');
  const [erro, setErro] = useState<string | null>(null);
  async function enviar() {
    setErro(null);
    try {
      await salvar.mutateAsync({ p: { id: crypto.randomUUID(), titulo: titulo.trim(), responsavel, frequencia, dia: Number(dia), inicio: hojeSP(), lembrete_dias: Number(lembrete) } });
      toast.success('Tarefa recorrente criada');
      aoFechar();
    } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo="Nova tarefa recorrente"
      rodape={<Button size="lg" className="w-full" disabled={titulo.trim().length < 2 || !responsavel || salvar.isPending} onClick={() => void enviar()}>
        {salvar.isPending && <Spinner data-icon="inline-start" />}Criar</Button>}>
      <FieldGroup className="pb-2">
        <Field><FieldLabel htmlFor="rc-titulo">O que fazer</FieldLabel><Input id="rc-titulo" name="rc-titulo" maxLength={160} autoComplete="off" placeholder="Ex.: Conferir o extrato do mês…" value={titulo} onChange={(e) => setTitulo(e.target.value)} /></Field>
        <SeletorPessoa id="rc-resp" rotulo="Responsável" valor={responsavel} aoMudar={setResponsavel} />
        <Segmentado rotulo="Frequência" valor={frequencia} aoMudar={(v) => { setFrequencia(v); setDia(v === 'mensal' ? '5' : '1'); }}
          opcoes={[{ valor: 'mensal', rotulo: 'Todo mês' }, { valor: 'semanal', rotulo: 'Toda semana' }]} />
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="rc-dia">{frequencia === 'mensal' ? 'Dia do mês' : 'Dia da semana'}</FieldLabel>
            <Select value={dia} onValueChange={setDia}>
              <SelectTrigger id="rc-dia"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                {frequencia === 'mensal'
                  ? Array.from({ length: 28 }, (_, i) => <SelectItem key={i} value={String(i + 1)}>Dia {i + 1}</SelectItem>)
                  : DIAS.map((n, i) => <SelectItem key={n} value={String(i)}>{n}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
            {frequencia === 'mensal' && <FieldDescription>Até o dia 28, para valer em todos os meses.</FieldDescription>}
          </Field>
          <Field>
            <FieldLabel htmlFor="rc-lembrete">Lembrete</FieldLabel>
            <Select value={lembrete} onValueChange={setLembrete}>
              <SelectTrigger id="rc-lembrete"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="0">Só no dia</SelectItem><SelectItem value="1">1 dia antes</SelectItem>
                <SelectItem value="2">2 dias antes</SelectItem><SelectItem value="3">3 dias antes</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
          </Field>
        </div>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}

function FormModelo({ aoFechar }: { aoFechar: () => void }) {
  const salvar = useAcaoOrg('salvar_modelo_tarefas');
  const tipos = useTiposEvento();
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState('');
  const [itens, setItens] = useState([{ titulo: '', dias_antes: '7' }]);
  const [erro, setErro] = useState<string | null>(null);
  const muda = (i: number, p: Partial<{ titulo: string; dias_antes: string }>) => setItens((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)));
  async function enviar() {
    setErro(null);
    const prontos = itens.filter((i) => i.titulo.trim()).map((i) => ({ titulo: i.titulo.trim(), dias_antes: Math.max(0, Math.min(365, Number(i.dias_antes) || 0)) }));
    try { await salvar.mutateAsync({ p: { id: crypto.randomUUID(), nome: nome.trim(), tipo_evento_id: tipo || null, itens: prontos } }); toast.success('Modelo criado'); aoFechar(); }
    catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo="Novo modelo de tarefas" larga
      rodape={<Button size="lg" className="w-full" disabled={nome.trim().length < 2 || !itens.some((i) => i.titulo.trim()) || salvar.isPending} onClick={() => void enviar()}>
        {salvar.isPending && <Spinner data-icon="inline-start" />}Criar modelo</Button>}>
      <FieldGroup className="pb-2">
        <Field><FieldLabel htmlFor="md-nome">Nome</FieldLabel><Input id="md-nome" name="md-nome" maxLength={80} autoComplete="off" placeholder="Ex.: Jogo em casa…" value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
        <Field>
          <FieldLabel htmlFor="md-tipo">Para qual tipo de evento (opcional)</FieldLabel>
          <Select value={tipo || 'qualquer'} onValueChange={(v) => setTipo(v === 'qualquer' ? '' : v)}>
            <SelectTrigger id="md-tipo"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup><SelectItem value="qualquer">Qualquer</SelectItem>{(tipos.data ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        </Field>
        <FieldSet>
          <FieldLegend variant="label">Tarefas do modelo</FieldLegend>
          <FieldDescription>Para cada uma: quantos dias antes do evento ela precisa estar pronta (0 = no dia).</FieldDescription>
          <FieldGroup>
            {itens.map((it, i) => (
              <div key={i} className="bg-muted/60 grid grid-cols-[1fr_96px_auto] items-end gap-2 rounded-[14px] p-3">
                <Field><FieldLabel htmlFor={`md-t${i}`}>Tarefa</FieldLabel><Input id={`md-t${i}`} name="md-t" maxLength={160} autoComplete="off" value={it.titulo} onChange={(e) => muda(i, { titulo: e.target.value })} /></Field>
                <Field><FieldLabel htmlFor={`md-d${i}`}>Dias antes</FieldLabel><Input id={`md-d${i}`} name="md-d" type="number" inputMode="numeric" min={0} max={365} value={it.dias_antes} onChange={(e) => muda(i, { dias_antes: e.target.value })} /></Field>
                <Button variant="ghost" size="icon" aria-label={`Remover a tarefa ${it.titulo || i + 1}`} onClick={() => setItens((l) => l.filter((_, j) => j !== i))}><Trash2 aria-hidden="true" /></Button>
              </div>
            ))}
            {itens.length < 40 && <Button variant="secondary" onClick={() => setItens((l) => [...l, { titulo: '', dias_antes: '0' }])}><Plus data-icon="inline-start" aria-hidden="true" />Adicionar tarefa</Button>}
          </FieldGroup>
        </FieldSet>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </FieldGroup>
    </Folha>
  );
}
