// Foto 3x4 recortada no centro e reduzida; redesenhar no canvas descarta o EXIF (inclusive a localização).
export async function prepararFoto3x4(f: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(f.type)) throw new Error('tipo_nao_permitido');
  const img = await createImageBitmap(f);
  try {
    const alvo = 3 / 4;
    let w = img.width, h = img.height;
    if (w / h > alvo) w = Math.round(h * alvo); else h = Math.round(w / alvo);
    const x = Math.round((img.width - w) / 2), y = Math.round((img.height - h) / 2);
    const saidaL = Math.min(600, w), saidaA = Math.round(saidaL / alvo);
    const c = document.createElement('canvas'); c.width = saidaL; c.height = saidaA;
    c.getContext('2d')!.drawImage(img, x, y, w, h, 0, 0, saidaL, saidaA);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.85));
    if (!blob) throw new Error('foto_invalida');
    return new File([blob], 'foto-3x4.jpg', { type: 'image/jpeg' });
  } finally { img.close(); }
}

export const soTelefone = (t: string) => t.trim().replace(/(?!^\+)[^\d]/g, '');
