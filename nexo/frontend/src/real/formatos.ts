// Formatação comum dos ecrãs reais.

export function formatarDataHora(iso: string): string {
  return new Intl.DateTimeFormat('pt-MZ', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Maputo' }).format(new Date(iso))
}

/** Sugestão de código da empresa a partir do nome ("Loja do Bairro" → "loja-do-bairro"). */
export function sugerirCodigo(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20)
    .replace(/-+$/g, '')
}
