// O cache é limpo inteiro ao sair ou trocar de conta.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fonte } from './fonte';
import type { FiltroLancamentos, Painel } from './tipos';

export const chaves = {
  painel: ['painel'] as const,
  contas: ['contas'] as const,
  categorias: ['categorias'] as const,
  tiposGasto: ['tipos-gasto'] as const,
  recorrencias: ['recorrencias'] as const,
  lancamentos: (f: FiltroLancamentos) => ['lancamentos', f] as const,
  lancamento: (id: string) => ['lancamento', id] as const,
  comprovantes: (id: string) => ['comprovantes', id] as const,
  reembolsos: ['reembolsos'] as const,
  membros: ['membros'] as const,
  permissoes: (id: string) => ['permissoes', id] as const,
  convites: ['convites'] as const,
  pedidosAcesso: ['pedidos-acesso'] as const,
  modelosPermissao: ['modelos-permissao'] as const,
  auditoria: ['auditoria'] as const,
  contador: ['arquivos-contador'] as const,
  notificacoes: ['notificacoes'] as const,
  fechamentos: ['fechamentos'] as const,
  checklist: (c: string) => ['checklist', c] as const,
};

export const usePainel = () => useQuery({ queryKey: chaves.painel, queryFn: () => fonte().rpc<Painel>('painel_inicial') });
export const useContas = () => useQuery({ queryKey: chaves.contas, queryFn: () => fonte().contas() });
export const useCategorias = () => useQuery({ queryKey: chaves.categorias, queryFn: () => fonte().categorias() });
export const useTiposGasto = () => useQuery({ queryKey: chaves.tiposGasto, queryFn: () => fonte().tiposGasto() });
export const useRecorrencias = () => useQuery({ queryKey: chaves.recorrencias, queryFn: () => fonte().recorrencias() });
export const useLancamento = (id: string) => useQuery({ queryKey: chaves.lancamento(id), queryFn: () => fonte().lancamento(id) });
export const useComprovantes = (id: string) => useQuery({ queryKey: chaves.comprovantes(id), queryFn: () => fonte().comprovantes(id) });
export const useReembolsos = () => useQuery({ queryKey: chaves.reembolsos, queryFn: () => fonte().reembolsos() });
export const useMembros = (ativo = true) => useQuery({ queryKey: chaves.membros, queryFn: () => fonte().membros(), enabled: ativo });
export const usePermissoesDe = (id: string) => useQuery({ queryKey: chaves.permissoes(id), queryFn: () => fonte().permissoesDe(id) });
export const useConvites = () => useQuery({ queryKey: chaves.convites, queryFn: () => fonte().convites() });
export const useModelosPermissao = () => useQuery({ queryKey: chaves.modelosPermissao, queryFn: () => fonte().modelosPermissao() });
export const usePedidosAcesso = () => useQuery({ queryKey: chaves.pedidosAcesso, queryFn: () => fonte().pedidosAcesso() });
export const useArquivosContador = () => useQuery({ queryKey: chaves.contador, queryFn: () => fonte().arquivosContador() });
export const useNotificacoes = () => useQuery({ queryKey: chaves.notificacoes, queryFn: () => fonte().notificacoes() });
export const useFechamentos = () => useQuery({ queryKey: chaves.fechamentos, queryFn: () => fonte().fechamentos() });
export const useChecklist = (c: string) => useQuery({ queryKey: chaves.checklist(c), queryFn: () => fonte().rpc<import('./tipos').Checklist>('checklist_fechamento', { p_competencia: c }) });

export function useLancamentos(f: FiltroLancamentos) {
  return useInfiniteQuery({
    queryKey: chaves.lancamentos(f),
    initialPageParam: undefined as FiltroLancamentos['antesDe'],
    queryFn: ({ pageParam }) => fonte().lancamentos({ ...f, limite: 40, antesDe: pageParam }),
    getNextPageParam: (ultima) => (ultima.length < 40 ? undefined : { data: ultima.at(-1)!.data, criado_em: ultima.at(-1)!.criado_em }),
  });
}

export function useAuditoria() {
  return useInfiniteQuery({
    queryKey: chaves.auditoria,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => fonte().auditoria(pageParam),
    getNextPageParam: (ultima) => (ultima.length < 50 ? undefined : ultima.at(-1)!.id),
  });
}

export function useAcao<A extends Record<string, unknown>, R = Record<string, unknown>>(rpc: string, invalida: readonly (readonly unknown[])[] = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: A) => fonte().rpc<R>(rpc, args),
    onSuccess: () => {
      for (const k of [chaves.painel, ['lancamentos'], ['lancamento'], chaves.reembolsos, ...invalida]) void qc.invalidateQueries({ queryKey: k });
    },
  });
}

export const chavesOrg = {
  agenda: (ini: string, fim: string) => ['agenda', ini, fim] as const,
  tiposEvento: ['tipos-evento'] as const,
  tarefas: ['tarefas'] as const,
  tarefa: (id: string) => ['tarefa', id] as const,
  itens: (id: string) => ['tarefa-itens', id] as const,
  comentarios: (id: string) => ['tarefa-comentarios', id] as const,
  recorrentes: ['tarefas-recorrentes'] as const,
  modelos: ['modelos-tarefas'] as const,
  avisos: ['avisos'] as const,
  leituras: (id: string) => ['aviso-leituras', id] as const,
  resumo: ['resumo-organizacao'] as const,
  preferencias: ['preferencias-email'] as const,
};

export const useAgenda = (ini: string, fim: string) => useQuery({
  queryKey: chavesOrg.agenda(ini, fim),
  queryFn: () => fonte().rpc<import('./tipos').AgendaPeriodo>('agenda_periodo', { p_inicio: ini, p_fim: fim }),
  placeholderData: (anterior) => anterior,
});
export const useTiposEvento = () => useQuery({ queryKey: chavesOrg.tiposEvento, queryFn: () => fonte().tiposEvento() });
export const useTarefas = () => useQuery({ queryKey: chavesOrg.tarefas, queryFn: () => fonte().tarefas() });
export const useTarefa = (id: string) => useQuery({ queryKey: chavesOrg.tarefa(id), queryFn: () => fonte().tarefa(id) });
export const useItensTarefa = (id: string) => useQuery({ queryKey: chavesOrg.itens(id), queryFn: () => fonte().itensTarefa(id) });
export const useComentarios = (id: string) => useQuery({ queryKey: chavesOrg.comentarios(id), queryFn: () => fonte().comentariosTarefa(id) });
export const useRecorrentes = () => useQuery({ queryKey: chavesOrg.recorrentes, queryFn: () => fonte().tarefasRecorrentes() });
export const useModelos = () => useQuery({ queryKey: chavesOrg.modelos, queryFn: () => fonte().modelosTarefas() });
export const useAvisos = () => useQuery({ queryKey: chavesOrg.avisos, queryFn: () => fonte().avisos() });
export const useLeituras = (id: string, ativo: boolean) => useQuery({ queryKey: chavesOrg.leituras(id), queryFn: () => fonte().leiturasAviso(id), enabled: ativo });
export const useResumoOrganizacao = () => useQuery({ queryKey: chavesOrg.resumo, queryFn: () => fonte().rpc<import('./tipos').ResumoOrganizacao>('resumo_organizacao') });
export const usePreferenciasEmail = () => useQuery({ queryKey: chavesOrg.preferencias, queryFn: () => fonte().preferenciasEmail() });

export function useAcaoOrg<A extends Record<string, unknown>, R = Record<string, unknown>>(rpc: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: A) => fonte().rpc<R>(rpc, args),
    onSuccess: () => {
      for (const k of [['agenda'], ['tarefas'], ['tarefa'], ['tarefa-itens'], ['tarefa-comentarios'], chavesOrg.recorrentes,
        chavesOrg.modelos, chavesOrg.tiposEvento, chavesOrg.avisos, ['aviso-leituras'], chavesOrg.resumo, chavesOrg.preferencias, chaves.notificacoes]) {
        void qc.invalidateQueries({ queryKey: k });
      }
    },
  });
}

export const chavesFase3 = {
  tiposVerba: ['tipos-verba'] as const, origens: ['origens-verba'] as const, verbas: ['verbas'] as const,
  parcelas: (id: string) => ['verba-parcelas', id] as const, documentos: (id: string) => ['verba-documentos', id] as const,
  projetos: ['projetos'] as const, rubricas: ['rubricas'] as const,
  painelProjetos: ['painel-projetos'] as const, painelProjeto: (id: string) => ['painel-projeto', id] as const,
};
export const useTiposVerba = () => useQuery({ queryKey: chavesFase3.tiposVerba, queryFn: () => fonte().tiposVerba() });
export const useOrigensVerba = () => useQuery({ queryKey: chavesFase3.origens, queryFn: () => fonte().origensVerba() });
export const useVerbas = () => useQuery({ queryKey: chavesFase3.verbas, queryFn: () => fonte().verbas() });
export const useParcelasVerba = (id: string) => useQuery({ queryKey: chavesFase3.parcelas(id), queryFn: () => fonte().parcelasVerba(id) });
export const useDocumentosVerba = (id: string) => useQuery({ queryKey: chavesFase3.documentos(id), queryFn: () => fonte().documentosVerba(id) });
export const useProjetos = (ativo = true) => useQuery({ queryKey: chavesFase3.projetos, queryFn: () => fonte().projetos(), enabled: ativo });
export const useRubricas = (ativo = true) => useQuery({ queryKey: chavesFase3.rubricas, queryFn: () => fonte().rubricas(), enabled: ativo });
export const usePainelProjetos = () => useQuery({ queryKey: chavesFase3.painelProjetos,
  queryFn: () => fonte().rpc<{ projetos: import('./tipos').ProjetoPainel[] }>('painel_projetos').then((r) => r.projetos) });
export const usePainelProjeto = (id: string) => useQuery({ queryKey: chavesFase3.painelProjeto(id),
  queryFn: () => fonte().rpc<import('./tipos').DetalheProjeto>('painel_projeto', { p_id: id }) });

export function useAcaoF3<A extends Record<string, unknown>, R = Record<string, unknown>>(rpc: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: A) => fonte().rpc<R>(rpc, args),
    onSuccess: () => {
      for (const k of [['tipos-verba'], ['origens-verba'], ['verbas'], ['verba-parcelas'], ['verba-documentos'], ['projetos'], ['rubricas'],
        ['painel-projetos'], ['painel-projeto'], ['agenda'], ['tarefas'], chavesOrg.resumo, chaves.painel, ['lancamentos'], chaves.contas]) {
        void qc.invalidateQueries({ queryKey: k });
      }
    },
  });
}

export const chavesF4 = {
  pix: ['config-pix'] as const, categoriasSocio: ['categorias-socio'] as const, salariosMinimos: ['salarios-minimos'] as const, parcelasUnicas: (id: string) => ['parcelas-unicas', id] as const, pessoas: ['pessoas'] as const,
  mensalidades: (id?: string) => ['mensalidades', id ?? 'todas'] as const, resumoPessoas: ['resumo-pessoas'] as const,
  docsPessoa: (id: string) => ['documentos-pessoa', id] as const, consentimentos: (id: string) => ['consentimentos', id] as const,
  saude: (id: string) => ['saude', id] as const, docsSaude: (id: string) => ['documentos-saude', id] as const,
  bens: ['bens'] as const, emprestimos: ['emprestimos'] as const, manutencoes: (id: string) => ['manutencoes', id] as const,
  docsInst: ['documentos-institucionais'] as const, mandatos: ['mandatos'] as const, reunioes: ['reunioes'] as const,
  presencas: (id: string) => ['presencas', id] as const, deliberacoes: (id: string) => ['deliberacoes', id] as const,
  painelGov: ['painel-governanca'] as const, tiposFiliacao: ['tipos-filiacao'] as const, filiacoes: ['filiacoes'] as const,
  docsFiliacao: (id: string) => ['documentos-filiacao', id] as const, painelFiliacoes: ['painel-filiacoes'] as const,
  presencasEvento: (id: string) => ['presencas-evento', id] as const, frequencia: (ini: string, fim: string) => ['frequencia', ini, fim] as const,
};
export const useConfigPix = () => useQuery({ queryKey: chavesF4.pix, queryFn: () => fonte().configPix() });
export const useCategoriasSocio = () => useQuery({ queryKey: chavesF4.categoriasSocio, queryFn: () => fonte().categoriasSocio() });
export const useParcelasUnicas = (id: string) => useQuery({ queryKey: chavesF4.parcelasUnicas(id), queryFn: () => fonte().parcelasUnicas(id) });
export const useSalariosMinimos = () => useQuery({ queryKey: chavesF4.salariosMinimos, queryFn: () => fonte().salariosMinimos() });
export const usePessoas = (ativo = true) => useQuery({ queryKey: chavesF4.pessoas, queryFn: () => fonte().pessoas(), enabled: ativo });
export const useMensalidades = (pessoaId?: string) => useQuery({ queryKey: chavesF4.mensalidades(pessoaId), queryFn: () => fonte().mensalidades(pessoaId) });
export const useResumoPessoas = (ativo = true) => useQuery({ queryKey: chavesF4.resumoPessoas, enabled: ativo,
  queryFn: () => fonte().rpc<import('./tipos').ResumoPessoas>('resumo_pessoas') });
export const useDocumentosPessoa = (id: string) => useQuery({ queryKey: chavesF4.docsPessoa(id), queryFn: () => fonte().documentosPessoa(id) });
export const useConsentimentos = (id: string) => useQuery({ queryKey: chavesF4.consentimentos(id), queryFn: () => fonte().consentimentos(id) });
export const useSaude = (id: string, ativo: boolean) => useQuery({ queryKey: chavesF4.saude(id), queryFn: () => fonte().saude(id), enabled: ativo });
export const useDocumentosSaude = (id: string, ativo: boolean) => useQuery({ queryKey: chavesF4.docsSaude(id), queryFn: () => fonte().documentosSaude(id), enabled: ativo });
export const useBens = () => useQuery({ queryKey: chavesF4.bens, queryFn: () => fonte().bens() });
export const useEmprestimos = () => useQuery({ queryKey: chavesF4.emprestimos, queryFn: () => fonte().emprestimos() });
export const useManutencoes = (id: string) => useQuery({ queryKey: chavesF4.manutencoes(id), queryFn: () => fonte().manutencoes(id) });
export const useDocumentosInstitucionais = (ativo = true) => useQuery({ queryKey: chavesF4.docsInst, queryFn: () => fonte().documentosInstitucionais(), enabled: ativo });
export const useMandatos = () => useQuery({ queryKey: chavesF4.mandatos, queryFn: () => fonte().mandatos() });
export const useReunioes = () => useQuery({ queryKey: chavesF4.reunioes, queryFn: () => fonte().reunioes() });
export const usePresencas = (id: string) => useQuery({ queryKey: chavesF4.presencas(id), queryFn: () => fonte().presencas(id) });
export const useDeliberacoes = (id: string) => useQuery({ queryKey: chavesF4.deliberacoes(id), queryFn: () => fonte().deliberacoes(id) });
export const usePainelGovernanca = (ativo = true) => useQuery({ queryKey: chavesF4.painelGov, enabled: ativo,
  queryFn: () => fonte().rpc<import('./tipos').PainelGovernanca>('painel_governanca') });
export const useTiposFiliacao = () => useQuery({ queryKey: chavesF4.tiposFiliacao, queryFn: () => fonte().tiposFiliacao() });
export const useFiliacoes = (ativo = true) => useQuery({ queryKey: chavesF4.filiacoes, queryFn: () => fonte().filiacoes(), enabled: ativo });
export const useDocumentosFiliacao = (id: string) => useQuery({ queryKey: chavesF4.docsFiliacao(id), queryFn: () => fonte().documentosFiliacao(id) });
export const usePainelFiliacoes = (ativo = true) => useQuery({ queryKey: chavesF4.painelFiliacoes, enabled: ativo,
  queryFn: () => fonte().rpc<{ filiacoes: import('./tipos').SituacaoPainelFiliacao[] }>('painel_filiacoes').then((r) => r.filiacoes) });

export const usePresencasEvento = (id: string, ativo: boolean) => useQuery({ queryKey: chavesF4.presencasEvento(id), queryFn: () => fonte().presencasEvento(id), enabled: ativo });
export const useFrequencia = (ini: string, fim: string, ativo = true) => useQuery({ queryKey: chavesF4.frequencia(ini, fim), enabled: ativo,
  queryFn: () => fonte().rpc<{ atletas: import('./tipos').FrequenciaAtleta[] }>('frequencia_atletas', { p_inicio: ini, p_fim: fim }).then((r) => r.atletas) });

export function useAcaoF4<A extends Record<string, unknown>, R = Record<string, unknown>>(rpc: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: A) => fonte().rpc<R>(rpc, args),
    onSuccess: () => {
      for (const k of [chavesF4.pix, chavesF4.categoriasSocio, chavesF4.salariosMinimos, ['parcelas-unicas'], chavesF4.pessoas, ['mensalidades'], chavesF4.resumoPessoas, ['documentos-pessoa'],
        ['consentimentos'], ['saude'], ['documentos-saude'], chavesF4.bens, chavesF4.emprestimos, ['manutencoes'], chavesF4.docsInst, chavesF4.mandatos,
        chavesF4.reunioes, ['presencas'], ['deliberacoes'], chavesF4.painelGov, chavesF4.tiposFiliacao, chavesF4.filiacoes, ['documentos-filiacao'],
        chavesF4.painelFiliacoes, ['presencas-evento'], ['frequencia'], ['agenda'], ['verbas'], chaves.painel, ['lancamentos'], chaves.recorrencias]) {
        void qc.invalidateQueries({ queryKey: k });
      }
    },
  });
}

export const useLista = <T,>(tabela: import('./fonte').TabelaLeitura, opcoes?: import('./fonte').OpcoesLista, ativo = true) =>
  useQuery({ queryKey: ['lista', tabela, opcoes ?? {}], queryFn: () => fonte().lista<T>(tabela, opcoes), enabled: ativo });
export const useRpc = <T,>(nome: string, args: Record<string, unknown> = {}, ativo = true) =>
  useQuery({ queryKey: ['rpc', nome, args], queryFn: () => fonte().rpc<T>(nome, args), enabled: ativo, placeholderData: (a) => a });

export function useAcaoF5<A extends Record<string, unknown>, R = Record<string, unknown>>(rpc: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (args: A) => fonte().rpc<R>(rpc, args), onSuccess: () => void qc.invalidateQueries() });
}
