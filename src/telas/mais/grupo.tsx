// Só mostra o que a pessoa pode ver; o servidor confere de novo em cada tela.
import { FileLock, Settings } from 'lucide-react';
import { useLocation } from 'react-router';
import { Grupo, Linha } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { Badge } from '@/components/ui/badge';
import { usePerfil } from '@/app/sessao';
import { NOME_CARGO } from '@/lib/acesso';
import { FASE_ATUAL, GRUPOS, MODULOS, podeVerModulo } from '@/lib/modulos';
import { COR } from './mais';

export function TelaGrupo() {
  const { pathname } = useLocation();
  const perfil = usePerfil();
  const g = GRUPOS.find((x) => x.rota === pathname) ?? GRUPOS[4]!;
  const mods = g.modulos.map((id) => MODULOS.find((m) => m.id === id)!).filter((m) => podeVerModulo(perfil, m) || m.fase > FASE_ATUAL);
  return (
    <Pagina titulo={g.nome}>
      <Grupo rodape={mods.length ? undefined : 'Você ainda não tem acesso a nada deste grupo. Peça a um administrador.'}>
        {mods.map((m) => (
          <Linha key={m.id} icone={m.icone} cor={COR[m.id]} titulo={m.nome} descricao={m.resumo} para={m.rota}
            valor={m.fase > FASE_ATUAL ? <Badge variant="secondary">Fase {m.fase}</Badge> : undefined} />
        ))}
      </Grupo>
      {g.id === 'organizacao' && (
        <Grupo titulo="Sua conta">
          <Linha icone={Settings} cor="cinza" titulo={perfil.membro.nome} descricao={`${NOME_CARGO[perfil.membro.cargo]} · Ajustes, tema e sair`} para="/ajustes" />
          <Linha icone={FileLock} cor="cinza" titulo="Política de privacidade" para="/privacidade" />
        </Grupo>
      )}
    </Pagina>
  );
}
