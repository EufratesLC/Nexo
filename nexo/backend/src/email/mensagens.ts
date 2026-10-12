// Textos dos e-mails (português). Os links levam o token no FRAGMENTO (#…): o navegador não o envia
// a nenhum servidor nem o inclui no Referer; a aplicação lê-o, envia-o à API no corpo de um POST e
// retira-o da barra de endereço.

import type { MensagemEmail } from './envio.js'

export function linkConfirmacao(urlAplicacao: string, token: string): string {
  return `${urlAplicacao}/#/confirmar-email?token=${token}`
}

export function linkRecuperacao(urlAplicacao: string, token: string): string {
  return `${urlAplicacao}/#/recuperar-acesso?token=${token}`
}

export function mensagemConfirmacao(para: string, link: string, validadeHoras: number): MensagemEmail {
  return {
    para,
    finalidade: 'confirmar_email',
    assunto: 'Nexo — confirme o seu e-mail de recuperação',
    texto: [
      'Olá,',
      '',
      'Este endereço foi indicado como e-mail de recuperação de uma conta de proprietário no Nexo.',
      'Para o confirmar, abra este link:',
      '',
      link,
      '',
      `O link é de utilização única e expira em ${validadeHoras} horas.`,
      'Só um e-mail confirmado pode receber links para redefinir o código de acesso.',
      '',
      'Se não foi você, ignore esta mensagem: nada muda sem a confirmação.',
    ].join('\n'),
  }
}

export function mensagemRecuperacao(para: string, link: string, validadeMinutos: number): MensagemEmail {
  return {
    para,
    finalidade: 'recuperar_acesso',
    assunto: 'Nexo — definir um novo código de acesso',
    texto: [
      'Olá,',
      '',
      'Recebemos um pedido para definir um novo código de acesso da sua conta de proprietário no Nexo.',
      'Para escolher o novo código, abra este link:',
      '',
      link,
      '',
      `O link é de utilização única e expira em ${validadeMinutos} minutos.`,
      'O código anterior não é mostrado em nenhum momento. Ao definir o novo, o anterior deixa de',
      'funcionar e todas as sessões abertas da conta terminam.',
      '',
      'Se não pediu isto, ignore esta mensagem: o seu código actual continua válido.',
    ].join('\n'),
  }
}

export function mensagemCodigoAlterado(para: string, quando: Date): MensagemEmail {
  return {
    para,
    finalidade: 'aviso_codigo_alterado',
    assunto: 'Nexo — o código de acesso foi alterado',
    texto: [
      'Olá,',
      '',
      `O código de acesso da sua conta de proprietário no Nexo foi redefinido em ${quando.toISOString()} (UTC),`,
      'através de um link de recuperação. Todas as sessões abertas foram terminadas.',
      '',
      'Se não foi você, contacte o suporte do Nexo de imediato.',
    ].join('\n'),
  }
}
