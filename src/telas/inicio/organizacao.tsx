import { CalendarDays, CircleDot, Megaphone } from 'lucide-react';
import { Link } from 'react-router';
import { Grupo, Linha } from '@/components/app/lista';
import { Button } from '@/components/ui/button';
import { usePerfil } from '@/app/sessao';
import { useResumoOrganizacao, useTiposEvento } from '@/dados/consultas';
import { pode } from '@/lib/acesso';
import { dataSP, diaPorExtenso, horaSP } from '@/lib/agenda';
import { formatarData, hojeSP } from '@/lib/datas';
import { contar } from '@/lib/texto';
import { ICONE_EVENTO, tipoDe } from '@/telas/organizacao/comum';

export function useLinhaMural() {
  const r = useResumoOrganizacao().data;
  if (!r || r.avisos_nao_lidos === 0) return null;
  return <Linha key="mural" icone={Megaphone} cor="laranja" para="/avisos" titulo={contar(r.avisos_nao_lidos, 'aviso novo no mural', 'avisos novos no mural')} descricao="Toque para ler e confirmar a leitura." />;
}

export function MinhasTarefas() {
  const perfil = usePerfil();
  const r = useResumoOrganizacao().data;
  const hoje = hojeSP();
  if (!r || !pode(perfil, 'tarefas', 'ver')) return null;
  return (
    <Grupo titulo={r.tarefas_atrasadas ? `Minhas tarefas · ${contar(r.tarefas_atrasadas, 'atrasada', 'atrasadas')}` : 'Minhas tarefas'}
      acao={<Button asChild variant="link" size="xs"><Link to="/tarefas">Ver todas</Link></Button>}>
      {r.minhas_tarefas.length === 0
        ? <Linha titulo="Nenhuma tarefa aberta com você" />
        : r.minhas_tarefas.slice(0, 3).map((t) => (
          <Linha key={t.id} icone={CircleDot} cor={t.atrasada ? 'vermelho' : t.situacao === 'fazendo' ? 'laranja' : 'azul'} titulo={t.titulo} para={`/tarefas/${t.id}`}
            descricao={t.prazo ? `${t.atrasada ? 'Atrasada · ' : ''}${t.prazo === hoje ? 'Hoje' : formatarData(t.prazo)}` : 'Sem prazo'} />
        ))}
    </Grupo>
  );
}

export function ProximosEventos() {
  const perfil = usePerfil();
  const r = useResumoOrganizacao().data;
  const tipos = useTiposEvento();
  if (!r || !pode(perfil, 'agenda', 'ver')) return null;
  return (
    <Grupo titulo="Próximos eventos" acao={<Button asChild variant="link" size="xs"><Link to="/agenda">Agenda</Link></Button>}>
      {r.proximos_eventos.length === 0
        ? <Linha icone={CalendarDays} cor="cinza" titulo="Nada marcado nos próximos 15 dias" />
        : r.proximos_eventos.slice(0, 3).map((e) => {
          const t = tipoDe(tipos.data, e.tipo_id);
          return <Linha key={e.id} icone={ICONE_EVENTO[t?.icone ?? 'outro']} cor={t?.cor ?? 'azul'} titulo={e.titulo} para="/agenda"
            descricao={[diaPorExtenso(dataSP(e.inicio)), e.dia_inteiro ? null : horaSP(e.inicio), e.local].filter(Boolean).join(' · ')} />;
        })}
    </Grupo>
  );
}
