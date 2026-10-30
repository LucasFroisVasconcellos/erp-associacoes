// Ao sair ou trocar de conta a geração avança, e respostas pedidas antes são descartadas.

export class RespostaObsoleta extends Error {
  constructor() { super('resposta obsoleta descartada'); this.name = 'RespostaObsoleta'; }
}

export function criarGeracao() {
  let atual = 0;
  return {
    get valor() { return atual; },
    avancar() { atual += 1; },
    async proteger<T>(p: Promise<T>): Promise<T> {
      const pedida = atual;
      const r = await p;
      if (pedida !== atual) throw new RespostaObsoleta();
      return r;
    },
  };
}

export const geracao = criarGeracao();
