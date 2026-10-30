// Só esconde o que a pessoa não pode usar; quem decide é o banco (RLS + RPCs).

export type Modulo = 'financeiro' | 'contador' | 'relatorios' | 'verbas' | 'projetos' | 'captacao' | 'agenda'
  | 'tarefas' | 'viagens' | 'pessoas' | 'patrimonio' | 'filiacoes' | 'documentos' | 'avisos' | 'saude' | 'acessos';
export type Acao = 'ver' | 'criar' | 'editar' | 'aprovar' | 'exportar' | 'administrar';
export type Cargo = 'presidente' | 'vice_presidente' | 'secretario' | 'tesoureiro' | 'diretor' | 'dev' | 'representante_atletas' | 'conselho_fiscal';

export interface Permissao { modulo: Modulo; acao: Acao; alcance: 'tudo' | 'proprios' }
export interface Perfil {
  membro: { id: string; nome: string; email: string; cargo: Cargo; admin: boolean; acesso_expira_em: string | null };
  permissoes: Permissao[];
  avisos_nao_lidos: number;
}

export const NOME_CARGO: Record<Cargo, string> = {
  presidente: 'Presidente', vice_presidente: 'Vice-presidente', secretario: 'Secretário(a)',
  tesoureiro: 'Tesoureiro(a)', diretor: 'Diretor(a)', representante_atletas: 'Representante dos Atletas',
  conselho_fiscal: 'Conselho Fiscal (só consulta)', dev: 'Dev (acesso total)',
};
export const CARGOS_ADMIN: Cargo[] = ['presidente', 'vice_presidente', 'secretario', 'dev'];

export function pode(perfil: Perfil | null | undefined, modulo: Modulo, acao: Acao): boolean {
  if (!perfil) return false;
  if (modulo === 'acessos') return perfil.membro.admin;
  return perfil.permissoes.some((p) => p.modulo === modulo && p.acao === acao);
}

export function alcance(perfil: Perfil | null | undefined, modulo: Modulo, acao: Acao): 'tudo' | 'proprios' | null {
  return perfil?.permissoes.find((p) => p.modulo === modulo && p.acao === acao)?.alcance ?? null;
}
