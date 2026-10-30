import { describe, expect, test } from 'vitest';
import { mensagemErro } from './erros';
import { pode, alcance, type Perfil } from './acesso';
import { criarGeracao } from './geracao';
import { MODULOS, moduloPorRota } from './modulos';

describe('mensagens de erro', () => {
  test('cada código do servidor vira uma frase com o que fazer', () => {
    expect(mensagemErro({ erro: 'sem_permissao' })).toMatch(/permissão/i);
    expect(mensagemErro({ erro: 'mes_fechado' })).toMatch(/fechado.*ajuste/i);
    expect(mensagemErro({ erro: 'confirme_2fa' })).toMatch(/código/i);
    expect(mensagemErro({ erro: 'limite' })).toMatch(/aguarde|mais tarde/i);
  });
  test('campo inválido cita o nome do campo em português', () => {
    expect(mensagemErro({ erro: 'invalido', campo: 'valor' })).toMatch(/valor/i);
    expect(mensagemErro({ erro: 'invalido', campo: 'data' })).toMatch(/data/i);
  });
  test('código desconhecido não vaza texto técnico', () => {
    const m = mensagemErro({ erro: 'xyz_interno', mensagem: 'relation "public.x" does not exist' } as never);
    expect(m).not.toMatch(/relation|public/);
    expect(m.length).toBeGreaterThan(10);
  });
});

describe('permissões na interface (só esconde; quem decide é o servidor)', () => {
  const perfil: Perfil = {
    membro: { id: 'u', nome: 'Ana', email: 'a@b.c', cargo: 'diretor', admin: false, acesso_expira_em: null },
    permissoes: [{ modulo: 'financeiro', acao: 'ver', alcance: 'proprios' }, { modulo: 'financeiro', acao: 'criar', alcance: 'tudo' }],
    avisos_nao_lidos: 0,
  };
  test('pode() e alcance()', () => {
    expect(pode(perfil, 'financeiro', 'criar')).toBe(true);
    expect(pode(perfil, 'financeiro', 'aprovar')).toBe(false);
    expect(alcance(perfil, 'financeiro', 'ver')).toBe('proprios');
    expect(pode(null, 'financeiro', 'ver')).toBe(false);
  });
  test('"acessos" depende do cargo administrador, não de permissão', () => {
    expect(pode(perfil, 'acessos', 'administrar')).toBe(false);
    expect(pode({ ...perfil, membro: { ...perfil.membro, admin: true } }, 'acessos', 'administrar')).toBe(true);
  });
});

describe('geração da sessão (descarta resposta antiga)', () => {
  test('resposta que chega depois de sair ou trocar de conta é ignorada', async () => {
    const g = criarGeracao();
    let liberar!: (v: string) => void;
    const lenta = g.proteger(new Promise<string>((r) => { liberar = r; }));
    g.avancar(); // logout / troca de conta
    liberar('dados da conta antiga');
    await expect(lenta).rejects.toThrow(/obsoleta/);
  });
  test('resposta da sessão atual passa', async () => {
    const g = criarGeracao();
    await expect(g.proteger(Promise.resolve(42))).resolves.toBe(42);
  });
});

describe('módulos do sistema', () => {
  test('são os 15 do dossiê mais Previsão e análises (Fase 6) e Transparência (Fase 7), com rota única', () => {
    expect(MODULOS).toHaveLength(17);
    expect(new Set(MODULOS.map((m) => m.rota)).size).toBe(17);
    expect(MODULOS.filter((m) => m.fase === 1).map((m) => m.id).sort()).toEqual(['acessos', 'dinheiro', 'documentos', 'inicio', 'relatorios']);
  });
  test('moduloPorRota encontra o módulo de subrotas', () => {
    expect(moduloPorRota('/dinheiro/lancamento/abc')?.id).toBe('dinheiro');
    expect(moduloPorRota('/nada')).toBeUndefined();
  });
});
