// Rotas por hash: funcionam em hospedagem estática sem regra de reescrita.
// Guardas de rota só ESCONDEM telas; quem protege os dados é o banco (RLS + RPCs).
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createHashRouter, Navigate, Outlet } from 'react-router';
import { Spinner } from '@/components/ui/spinner';
import type { Acao, Modulo } from '@/lib/acesso';
import { pode } from '@/lib/acesso';
import { carregarComRecarga, depsNavegador } from '@/lib/sob-demanda';
import { ProvedorNovoLancamento } from '@/telas/dinheiro/novo-lancamento';
import {
  CadastrarDoisFatores, Entrar, LinkDoEmail, Recuperar, SemAcesso, VerificarDoisFatores,
} from '@/telas/entrar/telas-entrada';
import { Casca } from './casca';
import { useSessao } from './sessao';

// Cada área é baixada só quando aberta, para o login abrir mais rápido no celular.
function sobDemanda<M>(importar: () => Promise<M>, nome: keyof M) {
  return lazy(async () => ({ default: (await carregarComRecarga(importar, depsNavegador()))[nome] as ComponentType }));
}
const acessos = () => import('@/telas/acessos/acessos');
const mais = () => import('@/telas/mais/mais');
const Acessos = sobDemanda(acessos, 'Acessos');
const Auditoria = sobDemanda(acessos, 'Auditoria');
const Membro = sobDemanda(acessos, 'Membro');
const Cadastros = sobDemanda(() => import('@/telas/dinheiro/cadastros'), 'Cadastros');
const Contas = sobDemanda(() => import('@/telas/dinheiro/contas'), 'Contas');
const PedirAcesso = sobDemanda(() => import('@/telas/entrar/pedir-acesso'), 'PedirAcesso');
const DetalheLancamento = sobDemanda(() => import('@/telas/dinheiro/detalhe'), 'DetalheLancamento');
const Dinheiro = sobDemanda(() => import('@/telas/dinheiro/dinheiro'), 'Dinheiro');
const Fechamento = sobDemanda(() => import('@/telas/dinheiro/fechamento'), 'Fechamento');
const Documentos = sobDemanda(() => import('@/telas/documentos/documentos'), 'Documentos');
const Inicio = sobDemanda(() => import('@/telas/inicio/inicio'), 'Inicio');
const Mais = sobDemanda(mais, 'Mais');
const Ajustes = sobDemanda(mais, 'Ajustes');
const ModuloFuturo = sobDemanda(mais, 'ModuloFuturo');
const SemPermissao = sobDemanda(mais, 'SemPermissao');
const TelaGrupo = sobDemanda(() => import('@/telas/mais/grupo'), 'TelaGrupo');
const Relatorios = sobDemanda(() => import('@/telas/relatorios/relatorios'), 'Relatorios');
const Privacidade = sobDemanda(() => import('@/telas/privacidade/privacidade'), 'Privacidade');
const tarefas = () => import('@/telas/tarefas/tarefas');
const Agenda = sobDemanda(() => import('@/telas/agenda/agenda'), 'Agenda');
const Tarefas = sobDemanda(tarefas, 'Tarefas');
const DetalheTarefa = sobDemanda(() => import('@/telas/tarefas/detalhe'), 'DetalheTarefa');
const Rotinas = sobDemanda(() => import('@/telas/tarefas/rotinas'), 'Rotinas');
const Avisos = sobDemanda(() => import('@/telas/avisos/avisos'), 'Avisos');
const verbas = () => import('@/telas/verbas/verbas');
const projetos = () => import('@/telas/projetos/projetos');
const Verbas = sobDemanda(verbas, 'Verbas');
const DetalheVerba = sobDemanda(verbas, 'DetalheVerba');
const CadastrosVerbas = sobDemanda(verbas, 'CadastrosVerbas');
const Projetos = sobDemanda(projetos, 'Projetos');
const DetalheProjeto = sobDemanda(projetos, 'DetalheProjeto');
const pessoas = () => import('@/telas/pessoas/pessoas');
const Pessoas = sobDemanda(pessoas, 'Pessoas');
const DetalhePessoa = sobDemanda(pessoas, 'DetalhePessoa');
const CadastrosPessoas = sobDemanda(pessoas, 'CadastrosPessoas');
const patrimonio = () => import('@/telas/patrimonio/patrimonio');
const Patrimonio = sobDemanda(patrimonio, 'Patrimonio');
const DetalheBem = sobDemanda(patrimonio, 'DetalheBem');
const filiacoes = () => import('@/telas/filiacoes/filiacoes');
const Filiacoes = sobDemanda(filiacoes, 'Filiacoes');
const DetalheFiliacao = sobDemanda(filiacoes, 'DetalheFiliacao');
const TiposFiliacao = sobDemanda(filiacoes, 'TiposFiliacao');
const captacao = () => import('@/telas/captacao/captacao');
const Captacao = sobDemanda(captacao, 'Captacao');
const DetalheOportunidade = sobDemanda(captacao, 'DetalheOportunidade');
const DetalheAcao = sobDemanda(captacao, 'DetalheAcao');
const viagens = () => import('@/telas/viagens/viagens');
const Viagens = sobDemanda(viagens, 'Viagens');
const DetalheViagem = sobDemanda(viagens, 'DetalheViagem');
const Conciliacao = sobDemanda(() => import('@/telas/dinheiro/conciliacao'), 'Conciliacao');
const Importar = sobDemanda(() => import('@/telas/dinheiro/importar'), 'Importar');
const Orcamento = sobDemanda(() => import('@/telas/dinheiro/orcamento'), 'Orcamento');
const Analises = sobDemanda(() => import('@/telas/analises/analises'), 'Analises');
const TransparenciaPublica = sobDemanda(() => import('@/telas/transparencia/transparencia'), 'TransparenciaPublica');
const GestaoTransparencia = sobDemanda(() => import('@/telas/transparencia/transparencia'), 'GestaoTransparencia');
const governanca = () => import('@/telas/documentos/governanca');
const Governanca = sobDemanda(governanca, 'Governanca');
const DetalheReuniao = sobDemanda(governanca, 'DetalheReuniao');

function AbrindoTela() {
  return <div role="status" className="text-muted-foreground flex min-h-[60svh] items-center justify-center gap-2 text-[15px]"><Spinner />Abrindo…</div>;
}
const t = (el: ReactNode) => <Suspense fallback={<AbrindoTela />}>{el}</Suspense>;

function Carregando() {
  return <div role="status" className="flex min-h-svh items-center justify-center gap-2 text-[15px]"><Spinner />Abrindo…</div>;
}

function Portao() {
  const { estado } = useSessao();
  switch (estado.tipo) {
    case 'carregando': return <Carregando />;
    case 'fora': return <Navigate to="/entrar" replace />;
    case 'cadastrar_2fa': return <CadastrarDoisFatores />;
    case 'precisa_2fa': return <VerificarDoisFatores fatorId={estado.fatorId} />;
    case 'sem_acesso': return <SemAcesso email={estado.email} />;
    case 'dentro': return <ProvedorNovoLancamento><Casca /></ProvedorNovoLancamento>;
  }
}

function SoFora() {
  const { estado } = useSessao();
  if (estado.tipo === 'carregando') return <Carregando />;
  if (estado.tipo !== 'fora') return <Navigate to="/" replace />;
  return <Outlet />;
}

function Requer({ m, a, ou, children }: { m: Modulo; a: Acao; ou?: [Modulo, Acao]; children: React.ReactNode }) {
  const { perfil } = useSessao();
  return pode(perfil, m, a) || (ou && pode(perfil, ou[0], ou[1])) ? <>{children}</> : <SemPermissao />;
}

export const roteador = createHashRouter([
  { path: '/entrar/link', element: <LinkDoEmail /> },
  { path: '/privacidade', element: t(<Privacidade />) }, // pública: com ou sem login
  { path: '/transparencia', element: t(<TransparenciaPublica />) }, // pública: só fotografias publicadas, sem login
  { element: <SoFora />, children: [
    { path: '/entrar', element: <Entrar /> },
    { path: '/entrar/recuperar', element: <Recuperar /> },
    { path: '/entrar/pedir', element: t(<PedirAcesso />) },
  ] },
  { path: '/', element: <Portao />, children: [
    { index: true, element: t(<Inicio />) },
    { path: 'dinheiro', element: t(<Requer m="financeiro" a="ver"><Dinheiro /></Requer>) },
    { path: 'dinheiro/lancamento/:id', element: t(<Requer m="financeiro" a="ver"><DetalheLancamento /></Requer>) },
    { path: 'dinheiro/contas', element: t(<Requer m="financeiro" a="ver"><Contas /></Requer>) },
    { path: 'dinheiro/cadastros', element: t(<Requer m="financeiro" a="administrar"><Cadastros /></Requer>) },
    { path: 'dinheiro/fechamento', element: t(<Requer m="financeiro" a="ver"><Fechamento /></Requer>) },
    { path: 'documentos', element: t(<Requer m="contador" a="ver" ou={['documentos', 'ver']}><Documentos /></Requer>) },
    { path: 'documentos/governanca', element: t(<Requer m="documentos" a="ver"><Governanca /></Requer>) },
    { path: 'documentos/reunioes/:id', element: t(<Requer m="documentos" a="ver"><DetalheReuniao /></Requer>) },
    { path: 'relatorios', element: t(<Requer m="financeiro" a="exportar"><Relatorios /></Requer>) },
    { path: 'acessos', element: t(<Requer m="acessos" a="administrar"><Acessos /></Requer>) },
    { path: 'acessos/membro/:id', element: t(<Requer m="acessos" a="administrar"><Membro /></Requer>) },
    { path: 'acessos/auditoria', element: t(<Requer m="acessos" a="administrar"><Auditoria /></Requer>) },
    { path: 'agenda', element: t(<Requer m="agenda" a="ver"><Agenda /></Requer>) },
    { path: 'tarefas', element: t(<Requer m="tarefas" a="ver"><Tarefas /></Requer>) },
    { path: 'tarefas/rotinas', element: t(<Requer m="tarefas" a="ver"><Rotinas /></Requer>) },
    { path: 'tarefas/:id', element: t(<Requer m="tarefas" a="ver"><DetalheTarefa /></Requer>) },
    { path: 'avisos', element: t(<Requer m="avisos" a="ver"><Avisos /></Requer>) },
    { path: 'verbas', element: t(<Requer m="verbas" a="ver"><Verbas /></Requer>) },
    { path: 'verbas/cadastros', element: t(<Requer m="verbas" a="ver"><CadastrosVerbas /></Requer>) },
    { path: 'verbas/:id', element: t(<Requer m="verbas" a="ver"><DetalheVerba /></Requer>) },
    { path: 'projetos', element: t(<Requer m="projetos" a="ver"><Projetos /></Requer>) },
    { path: 'projetos/:id', element: t(<Requer m="projetos" a="ver"><DetalheProjeto /></Requer>) },
    { path: 'pessoas', element: t(<Requer m="pessoas" a="ver"><Pessoas /></Requer>) },
    { path: 'pessoas/cadastros', element: t(<Requer m="pessoas" a="ver"><CadastrosPessoas /></Requer>) },
    { path: 'pessoas/:id', element: t(<Requer m="pessoas" a="ver"><DetalhePessoa /></Requer>) },
    { path: 'patrimonio', element: t(<Requer m="patrimonio" a="ver"><Patrimonio /></Requer>) },
    { path: 'patrimonio/:id', element: t(<Requer m="patrimonio" a="ver"><DetalheBem /></Requer>) },
    { path: 'filiacoes', element: t(<Requer m="filiacoes" a="ver"><Filiacoes /></Requer>) },
    { path: 'filiacoes/tipos', element: t(<Requer m="filiacoes" a="editar"><TiposFiliacao /></Requer>) },
    { path: 'filiacoes/:id', element: t(<Requer m="filiacoes" a="ver"><DetalheFiliacao /></Requer>) },
    { path: 'dinheiro/conciliacao', element: t(<Requer m="financeiro" a="ver"><Conciliacao /></Requer>) },
    { path: 'dinheiro/importar', element: t(<Requer m="financeiro" a="ver"><Importar /></Requer>) },
    { path: 'dinheiro/orcamento', element: t(<Requer m="financeiro" a="ver"><Orcamento /></Requer>) },
    { path: 'analises', element: t(<Requer m="financeiro" a="ver"><Analises /></Requer>) },
    { path: 'transparencia/gestao', element: t(<Requer m="financeiro" a="ver"><GestaoTransparencia /></Requer>) },
    { path: 'captacao', element: t(<Requer m="captacao" a="ver"><Captacao /></Requer>) },
    { path: 'captacao/oportunidades/:id', element: t(<Requer m="captacao" a="ver"><DetalheOportunidade /></Requer>) },
    { path: 'captacao/acoes/:id', element: t(<Requer m="captacao" a="ver"><DetalheAcao /></Requer>) },
    { path: 'viagens', element: t(<Requer m="viagens" a="ver"><Viagens /></Requer>) },
    { path: 'viagens/:id', element: t(<Requer m="viagens" a="ver"><DetalheViagem /></Requer>) },
    { path: 'mais', element: t(<Mais />) },
    ...['recursos', 'equipe', 'organizacao'].map((path) => ({ path, element: t(<TelaGrupo />) })),
    { path: 'ajustes', element: t(<Ajustes />) },
    { path: ':modulo', element: t(<ModuloFuturo />) },
  ] },
  { path: '*', element: <Navigate to="/" replace /> },
]);
