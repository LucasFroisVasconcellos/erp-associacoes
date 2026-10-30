# ADR 0011 — Formulário declarativo e leitura genérica (menos código)

**Situação:** aceita · **Data:** 2026-10-22

## Contexto
Até a Fase 4, cada formulário tinha o seu próprio estado (58 folhas, 387 `useState`) e cada tabela nova pedia um método na `Fonte`, na implementação real e na demonstração. Havia ainda quatro dependências instaladas e nunca usadas (`react-hook-form`, `@hookform/resolvers`, `zod`, `uuid`).

## Decisão
- **`FormularioRpc`** (`src/components/app/formulario.tsx`): a tela descreve os campos (tipo, rótulo, obrigatório) e a função do servidor. Ele converte valores (R$, número, vazio → null), mostra o erro do servidor no campo certo e **usa um id por abertura**, então repetir o envio não duplica. A validação continua no banco.
- **`fonte().lista(tabela, opções)`**: uma leitura com **lista fechada** de tabelas (`TABELAS_LEITURA`) e nomes de coluna conferidos por regex; a RLS decide as linhas. A demonstração usa um armazém genérico.
- **Removidas as 4 dependências sem uso** (menos superfície de cadeia de suprimentos). Nenhuma dependência nova.

## Alternativas
- **react-hook-form + zod:** bons, mas duplicariam no cliente a validação que já é do banco e exigem `Controller` para cada `Select` do Radix; o ganho de linhas seria menor.
- **Gerar tipos e cliente do banco:** útil depois; hoje as RPCs devolvem JSON e os tipos ficam em `src/dados/tipos.ts`.

## Consequências
- Telas da Fase 5 com bem menos código; as das fases anteriores continuam como estão (migrar só quando forem mexidas).
- Testes: `src/components/app/formulario.test.ts`; o e2e cobre os formulários novos com axe.
