// Datas apresentadas no fuso de referência da especificação.

const FUSO = 'Africa/Maputo'

const formatoDataHora = new Intl.DateTimeFormat('pt-PT', {
  timeZone: FUSO,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const formatoData = new Intl.DateTimeFormat('pt-PT', {
  timeZone: FUSO,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const formatoHora = new Intl.DateTimeFormat('pt-PT', {
  timeZone: FUSO,
  hour: '2-digit',
  minute: '2-digit',
})

const formatoChave = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function formatarDataHora(iso: string): string {
  return formatoDataHora.format(new Date(iso)).replace(',', '')
}

export function formatarData(iso: string): string {
  return formatoData.format(new Date(iso))
}

export function formatarHora(iso: string): string {
  return formatoHora.format(new Date(iso))
}

/** Chave AAAA-MM-DD do dia em Maputo. */
export function chaveDia(iso: string): string {
  return formatoChave.format(new Date(iso))
}

export function agoraIso(): string {
  return new Date().toISOString()
}
