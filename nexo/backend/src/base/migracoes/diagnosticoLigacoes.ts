// Diagnóstico das ligações à base SEM mostrar segredos (ferramenta administrativa, fora da API).
//
// Analisa os URLs de ligação da sessão do terminal e diz o que está mal na FORMA (utilizador,
// referência do projecto, porta, TLS, caracteres por codificar na palavra-passe), sem nunca
// imprimir a palavra-passe nem partes dela. As palavras-passe só são comparadas entre si
// (ex.: DATABASE_URL e NEXO_TESTE_API_URL têm a mesma palavra-passe de nexo_api?).
// A tentativa real de ligação (uma só por URL) e a classificação do erro estão em ligacoes.ts.

export interface AnaliseLigacao {
  variavel: string
  definida: boolean
  /** Só servidor:porta. */
  destino?: string
  papel?: string
  /** Referência do projecto no utilizador do pooler (postgres.<ref>, nexo_api.<ref>). */
  ref?: string
  porta?: number
  temPalavraPasse?: boolean
  problemas: string[]
  avisos: string[]
}

/** Palavra-passe descodificada (só para comparar; nunca sai deste módulo). */
const palavrasPasse = new Map<string, string>()

const HEX2 = /^[0-9A-Fa-f]{2}$/

/** Problemas na parte "utilizador:palavra-passe" do URL bruto, antes de o interpretar. */
function problemasDaCredencial(bruto: string): string[] {
  const problemas: string[] = []
  const inicio = bruto.indexOf('://')
  if (inicio === -1) return problemas
  const resto = bruto.slice(inicio + 3)
  const arrobas = [...resto].filter((c) => c === '@').length
  if (arrobas > 1) problemas.push('há mais de um "@": a palavra-passe tem "@" sem codificação (use %40)')
  const credencial = resto.slice(0, resto.lastIndexOf('@'))
  const passe = credencial.includes(':') ? credencial.slice(credencial.indexOf(':') + 1) : ''
  for (const [c, cod] of [['/', '%2F'], ['?', '%3F'], ['#', '%23'], [' ', '%20']] as const) {
    if (passe.includes(c)) problemas.push(`a palavra-passe tem "${c === ' ' ? 'espaço' : c}" sem codificação (use ${cod})`)
  }
  for (let i = passe.indexOf('%'); i !== -1; i = passe.indexOf('%', i + 1)) {
    if (!HEX2.test(passe.slice(i + 1, i + 3))) {
      problemas.push('a palavra-passe tem "%" que não é uma codificação válida (use %25 para o próprio "%")')
      break
    }
  }
  return problemas
}

export function analisarLigacao(variavel: string, texto: string | undefined, esperado: { papel: string; porta?: number }): AnaliseLigacao {
  const a: AnaliseLigacao = { variavel, definida: Boolean(texto), problemas: [], avisos: [] }
  if (!texto) return a
  a.problemas.push(...problemasDaCredencial(texto))
  let u: URL
  try {
    u = new URL(texto)
  } catch {
    a.problemas.push('não é um URL válido (verifique caracteres especiais na palavra-passe)')
    return a
  }
  if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') a.problemas.push('tem de começar por postgresql://')
  let utilizador = ''
  let passe = ''
  try {
    utilizador = decodeURIComponent(u.username)
    passe = decodeURIComponent(u.password)
  } catch {
    a.problemas.push('codificação % inválida no utilizador ou na palavra-passe')
  }
  const [papel, ...refPartes] = utilizador.split('.')
  a.papel = papel
  a.ref = refPartes.join('.') || undefined
  a.porta = Number(u.port || 5432)
  a.destino = `${u.hostname}:${a.porta}`
  a.temPalavraPasse = passe.length > 0
  if (passe) palavrasPasse.set(variavel, passe)

  if (papel !== esperado.papel) a.problemas.push(`o utilizador devia ser ${esperado.papel}${u.hostname.includes('pooler') ? '.<ref>' : ''}, é ${papel || '(vazio)'}`)
  if (u.hostname.includes('pooler.supabase.com') && !a.ref) {
    a.problemas.push(`no pooler do Supabase o utilizador leva a referência do projecto: ${esperado.papel}.<ref>`)
  }
  if (!a.temPalavraPasse) a.problemas.push('sem palavra-passe no URL')
  if (esperado.porta && a.porta !== esperado.porta) {
    a.avisos.push(`porta ${a.porta}; o previsto é ${esperado.porta} (${esperado.porta === 6543 ? 'Transaction pooler' : 'Session pooler'})`)
  }
  for (const p of ['sslmode', 'sslrootcert', 'ssl']) {
    if (u.searchParams.has(p)) a.avisos.push(`tem "${p}" no URL: retire-o e use DB_CA_CERT_FICHEIRO (pode substituir a validação do certificado)`)
  }
  return a
}

/** Compara as palavras-passe de duas variáveis já analisadas, sem as revelar. */
export function mesmaPalavraPasse(v1: string, v2: string): boolean | undefined {
  const p1 = palavrasPasse.get(v1)
  const p2 = palavrasPasse.get(v2)
  return p1 === undefined || p2 === undefined ? undefined : p1 === p2
}

export type CausaFalha =
  | 'palavra_passe_recusada'
  | 'bloqueio_temporario_do_pooler'
  | 'utilizador_ou_projecto_desconhecido'
  | 'certificado'
  | 'tempo_esgotado'
  | 'servidor_inacessivel'
  | 'outra'

/** Classifica um erro de ligação (mensagem já sem segredos, porque o driver não as inclui). */
export function classificarFalha(erro: unknown): { causa: CausaFalha; explicacao: string } {
  const e = erro as { code?: string; message?: string }
  const m = `${e?.code ?? ''} ${e?.message ?? ''}`
  if (/ECIRCUITBREAKER|too many authentication failures/i.test(m)) {
    return {
      causa: 'bloqueio_temporario_do_pooler',
      explicacao: 'O pooler do Supabase bloqueou novas ligações deste utilizador depois de muitas autenticações falhadas. Não insista: espere que o bloqueio passe e corrija primeiro a palavra-passe.',
    }
  }
  if (e?.code === '28P01' || /password authentication failed/i.test(m)) {
    return { causa: 'palavra_passe_recusada', explicacao: 'A base recusou a palavra-passe deste utilizador.' }
  }
  if (/Tenant or user not found|role .* does not exist/i.test(m)) {
    return { causa: 'utilizador_ou_projecto_desconhecido', explicacao: 'O utilizador ou a referência do projecto não existem (formato <papel>.<ref> no pooler; o papel foi criado pelas migrações?).' }
  }
  if (/certificate|self[- ]signed|SSL|TLS/i.test(m)) {
    return { causa: 'certificado', explicacao: 'Falhou a validação TLS: confirme DB_CA_CERT_FICHEIRO (certificado do projecto).' }
  }
  if (/timeout|ETIMEDOUT|timed out/i.test(m)) return { causa: 'tempo_esgotado', explicacao: 'Sem resposta dentro do tempo limite (rede, firewall ou servidor).' }
  if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ECONNRESET/i.test(m)) return { causa: 'servidor_inacessivel', explicacao: 'O servidor não foi encontrado ou recusou a ligação.' }
  return { causa: 'outra', explicacao: 'Erro não classificado (código mostrado abaixo).' }
}
