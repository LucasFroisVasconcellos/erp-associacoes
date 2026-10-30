// Nada de saúde aqui: só presente ou não, e um motivo curto.
import { UserCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Folha } from '@/components/app/folha';
import { Grupo, Linha } from '@/components/app/lista';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldDescription, FieldError } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { useAcaoF4, usePessoas, usePresencasEvento } from '@/dados/consultas';
import type { Evento } from '@/dados/tipos';
import { contar } from '@/lib/texto';
import { erroMsg } from '@/telas/organizacao/comum';

export function PresencaAtletas({ evento, podeMarcar }: { evento: Evento; podeMarcar: boolean }) {
  const lista = usePresencasEvento(evento.id, true);
  const [aberta, setAberta] = useState(false);
  const comecou = new Date(evento.inicio).getTime() <= Date.now() + 86_400_000;
  const presentes = (lista.data ?? []).filter((p) => p.presente).length;
  const marcados = (lista.data ?? []).length;
  return (
    <Grupo titulo="Presença dos atletas" rodape={comecou ? undefined : 'A presença pode ser marcada a partir do dia do evento.'}>
      <Linha icone={UserCheck} cor={marcados ? 'verde' : 'cinza'} titulo={marcados ? `${contar(presentes, 'presente', 'presentes')} de ${marcados}` : 'Presença não marcada'}
        aoTocar={podeMarcar && comecou ? () => setAberta(true) : undefined} seta={podeMarcar && comecou} />
      {aberta && <FolhaPresenca evento={evento} atual={lista.data ?? []} aoFechar={() => setAberta(false)} />}
    </Grupo>
  );
}

function FolhaPresenca({ evento, atual, aoFechar }: { evento: Evento; atual: { pessoa_id: string; presente: boolean }[]; aoFechar: () => void }) {
  const pessoas = usePessoas();
  const salvar = useAcaoF4<Record<string, unknown>, { presentes: number }>('salvar_presenca_evento');
  const atletas = (pessoas.data ?? []).filter((p) => p.atleta && p.situacao === 'ativo');
  const [marcas, setMarcas] = useState<Record<string, boolean>>(() => Object.fromEntries(atual.map((a) => [a.pessoa_id, a.presente])));
  const [erro, setErro] = useState<string | null>(null);
  const n = atletas.filter((a) => marcas[a.id]).length;
  async function enviar() {
    setErro(null);
    try {
      const r = await salvar.mutateAsync({ p_evento: evento.id, p: atletas.map((a) => ({ pessoa_id: a.id, presente: !!marcas[a.id] })) });
      toast.success(`${contar(r.presentes, 'presente', 'presentes')} registrados`); aoFechar();
    } catch (e) { setErro(erroMsg(e)); }
  }
  return (
    <Folha aberta aoMudar={(v) => !v && aoFechar()} titulo="Lista de presença" descricao={evento.titulo}
      rodape={<Button size="lg" className="w-full" disabled={salvar.isPending || !atletas.length} onClick={() => void enviar()}>{salvar.isPending && <Spinner data-icon="inline-start" />}Salvar ({n} de {atletas.length})</Button>}>
      <div className="flex flex-col gap-2 pb-2">
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setMarcas(Object.fromEntries(atletas.map((a) => [a.id, true])))}>Todos presentes</Button>
          <Button size="sm" variant="ghost" onClick={() => setMarcas({})}>Limpar</Button>
        </div>
        {!atletas.length && <FieldDescription>Nenhum atleta ativo no cadastro de Pessoas.</FieldDescription>}
        <ul className="bg-card flex flex-col rounded-[14px]">
          {atletas.map((a) => (
            <li key={a.id} className="border-border/60 flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
              <Checkbox id={`pa-${a.id}`} checked={!!marcas[a.id]} onCheckedChange={(c) => setMarcas((m) => ({ ...m, [a.id]: c === true }))} />
              <label htmlFor={`pa-${a.id}`} className="flex-1 text-[17px]">{a.nome}</label>
            </li>
          ))}
        </ul>
        {erro && <FieldError role="alert">{erro}</FieldError>}
      </div>
    </Folha>
  );
}
