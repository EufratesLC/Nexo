// Envio de e-mail (confirmação do e-mail de recuperação, link de recuperação, aviso de código
// alterado). Transportes:
//
// - smtp: envio REAL por um servidor SMTP (qualquer fornecedor), com TLS validado (STARTTLS
//   obrigatório na porta 587, ou TLS implícito na 465). Credenciais só no backend (.env ou sessão).
// - ficheiro: SÓ desenvolvimento e teste. Grava cada mensagem num ficheiro .txt numa pasta local
//   ignorada pelo Git (a "caixa de saída"), para seguir os links sem servidor de e-mail. A
//   configuração recusa este transporte em produção.
// - desactivado: não envia (a recuperação por e-mail fica indisponível).
// - memória: só para os testes automáticos.
//
// Nunca se regista o conteúdo das mensagens (têm links secretos) nem o endereço completo.

import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createTransport } from 'nodemailer'
import type { ConfiguracaoEmail } from '../config/ambiente.js'

export type FinalidadeEmail = 'confirmar_email' | 'recuperar_acesso' | 'aviso_codigo_alterado'

export interface MensagemEmail {
  para: string
  assunto: string
  texto: string
  finalidade: FinalidadeEmail
}

export interface EnvioEmail {
  readonly transporte: 'smtp' | 'ficheiro' | 'desactivado' | 'memoria'
  enviar(mensagem: MensagemEmail): Promise<void>
}

export class ErroEmailDesactivado extends Error {}

export function criarEnvioEmail(config: ConfiguracaoEmail): EnvioEmail {
  if (config.transporte === 'desactivado') {
    return {
      transporte: 'desactivado',
      enviar: async () => {
        throw new ErroEmailDesactivado('envio de e-mail desactivado (EMAIL_TRANSPORTE=desactivado)')
      },
    }
  }
  if (config.transporte === 'ficheiro') {
    return {
      transporte: 'ficheiro',
      enviar: async (m) => {
        await mkdir(config.pasta, { recursive: true })
        const nome = `${new Date().toISOString().replace(/[:.]/g, '-')}-${m.finalidade}-${randomBytes(3).toString('hex')}.txt`
        const conteudo = [
          'AVISO: caixa de saída de DESENVOLVIMENTO (nada foi enviado). Contém links secretos: não partilhar.',
          `Para: ${m.para}`,
          `Assunto: ${m.assunto}`,
          '',
          m.texto,
          '',
        ].join('\n')
        await writeFile(join(config.pasta, nome), conteudo, { encoding: 'utf8', mode: 0o600 })
      },
    }
  }
  const transporte = createTransport({
    host: config.servidor,
    port: config.porta,
    secure: config.tlsImplicito,
    // Sem TLS implícito, exige STARTTLS: nunca envia credenciais nem links em claro.
    requireTLS: !config.tlsImplicito,
    auth: config.autenticacao ? { user: config.autenticacao.utilizador, pass: config.autenticacao.senha } : undefined,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2', ...(config.ca ? { ca: config.ca } : {}) },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    logger: false,
    debug: false,
  })
  return {
    transporte: 'smtp',
    enviar: async (m) => {
      await transporte.sendMail({ from: config.remetente, to: m.para, subject: m.assunto, text: m.texto })
    },
  }
}

/** Para os testes: guarda as mensagens em memória. */
export function criarEnvioEmailMemoria(): EnvioEmail & { mensagens: MensagemEmail[]; esperar(n: number, ms?: number): Promise<MensagemEmail[]> } {
  const mensagens: MensagemEmail[] = []
  return {
    transporte: 'memoria',
    mensagens,
    enviar: async (m) => {
      mensagens.push(m)
    },
    async esperar(n, ms = 5000) {
      const fim = Date.now() + ms
      while (mensagens.length < n && Date.now() < fim) await new Promise((r) => setTimeout(r, 20))
      if (mensagens.length < n) throw new Error(`esperava ${n} e-mail(s), chegaram ${mensagens.length}`)
      return mensagens
    },
  }
}

/** Para logs: domínio sem o utilizador (nunca o endereço completo). */
export function dominioDe(email: string): string {
  return email.includes('@') ? `*@${email.split('@').pop()}` : '*'
}
