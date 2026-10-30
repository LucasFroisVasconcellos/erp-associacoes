import { FileLock, Laptop, LogOut, MonitorSmartphone, Moon, Settings, ShieldCheck, Sparkles, Sun } from 'lucide-react';
import { reverTutorial } from '@/components/app/ajuda';
import { useParams } from 'react-router';
import { Grupo, IconeQuadrado, Linha, type CorIcone } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { Vazio } from '@/components/app/estados';
import { Segmentado } from '@/components/app/segmentado';
import { Badge } from '@/components/ui/badge';
import { useSessao, usePerfil } from '@/app/sessao';
import { useTheme, type Tema } from '@/hooks/use-theme';
import { NOME_CARGO } from '@/lib/acesso';
import { FASE_ATUAL, GRUPOS, MODULOS, podeVerModulo } from '@/lib/modulos';

export const COR: Record<string, CorIcone> = {
  inicio: 'azul', dinheiro: 'verde', verbas: 'laranja', projetos: 'roxo', captacao: 'vermelho', agenda: 'vermelho', tarefas: 'azul',
  viagens: 'teal', pessoas: 'indigo', patrimonio: 'laranja', filiacoes: 'teal', documentos: 'cinza', relatorios: 'roxo', avisos: 'laranja', acessos: 'cinza',
};

export function Mais() {
  const perfil = usePerfil();
  const disponiveis = MODULOS.filter((m) => m.fase <= FASE_ATUAL && m.id !== 'inicio' && podeVerModulo(perfil, m));
  return (
    <Pagina titulo="Mais">
      <Grupo>
        <Linha icone={Settings} cor="cinza" titulo={perfil.membro.nome} descricao={`${NOME_CARGO[perfil.membro.cargo]} · Ajustes, tema e sair`} para="/ajustes" />
      </Grupo>
      {GRUPOS.map((g) => {
        const mods = g.modulos.map((id) => disponiveis.find((m) => m.id === id)).filter((m) => !!m);
        return mods.length ? (
          <Grupo key={g.id} titulo={g.nome}>
            {mods.map((m) => <Linha key={m.id} icone={m.icone} cor={COR[m.id]} titulo={m.nome} para={m.rota} />)}
          </Grupo>
        ) : null;
      })}
    </Pagina>
  );
}

export function Ajustes() {
  const perfil = usePerfil();
  const { sair } = useSessao();
  const { theme, setTheme } = useTheme();
  return (
    <Pagina titulo="Ajustes" voltar={{ para: '/organizacao', rotulo: 'Organização' }}>
      <Grupo titulo="Sua conta">
        <Linha titulo="Nome" valor={perfil.membro.nome} />
        <Linha titulo="E-mail" valor={<span className="max-w-[55vw] truncate">{perfil.membro.email}</span>} />
        <Linha titulo="Cargo" valor={NOME_CARGO[perfil.membro.cargo]} />
        <Linha icone={ShieldCheck} cor="verde" titulo="Verificação em duas etapas" valor="Ativa" />
      </Grupo>
      <Grupo titulo="Aparência" rodape="“Automático” acompanha o modo claro ou escuro do aparelho.">
        <div className="px-4 py-3">
          <Segmentado<Tema> rotulo="Tema" valor={theme} aoMudar={setTheme} opcoes={[
            { valor: 'system', rotulo: <><Laptop aria-hidden="true" />Automático</> },
            { valor: 'light', rotulo: <><Sun aria-hidden="true" />Claro</> },
            { valor: 'dark', rotulo: <><Moon aria-hidden="true" />Escuro</> },
          ]} />
        </div>
      </Grupo>
      <Grupo>
        <Linha icone={Sparkles} cor="azul" titulo="Ver o tutorial de novo" aoTocar={() => reverTutorial(perfil.membro.id)} />
        <Linha icone={FileLock} cor="cinza" titulo="Política de privacidade" para="/privacidade" />
      </Grupo>
      <Grupo rodape="Ao sair, os rascunhos guardados neste aparelho são apagados. Perdeu o celular ou entrou num computador emprestado? Use “Sair de todos os aparelhos”.">
        <Linha icone={LogOut} cor="vermelho" titulo="Sair" destrutiva aoTocar={() => void sair()} />
        <Linha icone={MonitorSmartphone} cor="vermelho" titulo="Sair de todos os aparelhos" destrutiva aoTocar={() => void sair(undefined, true)} />
      </Grupo>
    </Pagina>
  );
}

export function ModuloFuturo() {
  const { modulo = '' } = useParams();
  const m = MODULOS.find((x) => x.rota === `/${modulo}`);
  if (!m) return <Pagina titulo="Não encontrado" voltar={{ para: '/', rotulo: 'Início' }}><Vazio icone={Settings} titulo="Página não encontrada" descricao="Esse endereço não existe no sistema. Use o menu para navegar." /></Pagina>;
  return (
    <Pagina titulo={m.nome} acoes={<Badge variant="secondary">Fase {m.fase}</Badge>}>
      <section className="bg-card flex flex-col items-center gap-4 rounded-[24px] px-6 py-9 text-center">
        <IconeQuadrado icone={m.icone} cor={COR[m.id]} className="size-16 rounded-[18px] [&>svg]:size-9" />
        <p className="max-w-md text-[17px] text-pretty">{m.resumo}</p>
        <p className="text-muted-foreground text-[15px]">Este módulo chega na Fase {m.fase} do roteiro do dossiê.</p>
      </section>
      <Grupo titulo="O que vai ter aqui">
        {m.itens.map((i) => <Linha key={i} titulo={i} />)}
      </Grupo>
    </Pagina>
  );
}

export function SemPermissao() {
  return <Pagina titulo="Sem acesso"><Vazio icone={ShieldCheck} titulo="Você não tem acesso a esta área" descricao="Se precisar, peça a um administrador da diretoria para liberar." /></Pagina>;
}
