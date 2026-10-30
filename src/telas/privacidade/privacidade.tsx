import { Grupo } from '@/components/app/lista';
import { Pagina } from '@/components/app/pagina';
import { SECOES, VERSAO_POLITICA } from './texto';

export function Privacidade() {
  return (
    <Pagina titulo="Privacidade" voltar={{ para: '/', rotulo: 'Voltar' }}>
      <p className="text-muted-foreground -mt-2 text-[15px] text-pretty">{VERSAO_POLITICA}. Como a Associação Exemplo trata os dados pessoais neste sistema, em linguagem simples.</p>
      {SECOES.map((s) => (
        <Grupo key={s.titulo} titulo={s.titulo}>
          <div className="flex flex-col gap-3 px-4 py-3.5 text-[15px] leading-relaxed text-pretty">
            {s.itens && (
              <ul className="flex list-disc flex-col gap-1.5 pl-5">
                {s.itens.map((i) => <li key={i}>{i}</li>)}
              </ul>
            )}
            {s.paragrafos?.map((p) => <p key={p}>{p}</p>)}
          </div>
        </Grupo>
      ))}
    </Pagina>
  );
}
