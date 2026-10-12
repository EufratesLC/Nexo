// Dados de passagem entre ecrãs, só em memória (perdem-se ao recarregar). Não vão para o endereço
// nem para o armazenamento do navegador.

let mensagemRegisto: string | null = null

export function guardarMensagemRegisto(mensagem: string): void {
  mensagemRegisto = mensagem
}

export function lerMensagemRegisto(): string | null {
  return mensagemRegisto
}
