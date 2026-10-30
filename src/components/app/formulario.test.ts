import { expect, test } from 'vitest';
import { converter, paraTela, type Campo } from './formulario';

const campos: Campo[] = [
  { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
  { nome: 'valor', rotulo: 'Valor', tipo: 'valor' },
  { nome: 'qtd', rotulo: 'Quantidade', tipo: 'numero' },
  { nome: 'ok', rotulo: 'Ok', tipo: 'sim_nao' },
  { nome: 'tipo', rotulo: 'Tipo', tipo: 'escolha', opcoes: [{ valor: 'a', rotulo: 'A' }] },
];

test('converte valores da tela para o servidor', () => {
  expect(converter(campos, { nome: '  Rifa ', valor: '1.234,50', qtd: '10', ok: true, tipo: '' }))
    .toEqual({ dados: { nome: 'Rifa', valor: '1234.50', qtd: 10, ok: true, tipo: null } });
});

test('aponta o campo com problema (obrigatório, valor ou número inválido)', () => {
  expect(converter(campos, { nome: '' })).toEqual({ erro: 'nome' });
  expect(converter(campos, { nome: 'X', valor: 'abc' })).toEqual({ erro: 'valor' });
  expect(converter(campos, { nome: 'X', qtd: '1.5' })).toEqual({ erro: 'qtd' });
});

test('valor do servidor volta para a tela', () => {
  expect(paraTela(campos, { nome: 'Rifa', valor: '12.30', qtd: 5, ok: true, tipo: null }))
    .toEqual({ nome: 'Rifa', valor: '12,30', qtd: '5', ok: true, tipo: '' });
  expect(paraTela(campos, null)).toEqual({ nome: '', valor: '', qtd: '', ok: false, tipo: '' });
});
