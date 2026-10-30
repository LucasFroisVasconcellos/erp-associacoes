// Na demonstração dentro de uma moldura, câmera e arquivos podem estar bloqueados: após ~1,2 s sem abrir, explica o motivo.
import { toast } from 'sonner';

export const emArtefato = import.meta.env.MODE === 'demo' && import.meta.env.VITE_ARTEFATO === '1';

export function abrirSeletor(input: HTMLInputElement | null) {
  if (!input) return;
  input.click();
  if (!emArtefato) return;
  let abriu = false;
  const marcar = () => { abriu = true; };
  window.addEventListener('blur', marcar, { once: true });
  input.addEventListener('change', marcar, { once: true });
  input.addEventListener('cancel', marcar, { once: true });
  setTimeout(() => {
    window.removeEventListener('blur', marcar);
    if (!abriu) toast.info('Neste link de demonstração o claude.ai não libera câmera nem arquivos. No sistema de verdade funciona normalmente. No lançamento, use "Usar cupom de exemplo" para ver o preenchimento automático.', { duration: 9000 });
  }, 1200);
}
