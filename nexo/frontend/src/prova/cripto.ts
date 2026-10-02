// Operações da prova técnica H-23, só com APIs documentadas do navegador:
// Web Crypto API (ECDSA P-256 / SHA-256, PBKDF2) e IndexedDB.
// Não é código do produto.

export const ALGORITMO_CHAVE: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' }
export const ALGORITMO_ASSINATURA: EcdsaParams = { name: 'ECDSA', hash: 'SHA-256' }

const BASE = 'nexo-prova-assinatura'
const LOJA = 'chaves'

export interface RegistoChave {
  nome: string
  privada: CryptoKey
  publica: CryptoKey
  chaveId?: string
  utilizador: string
  registo: string
  criadaEm: string
}

export interface Envelope {
  chaveId: string
  conteudo: string
  assinatura: string
}

export function paraBase64Url(bytes: ArrayBuffer): string {
  let binario = ''
  for (const b of new Uint8Array(bytes)) binario += String.fromCharCode(b)
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A chave privada é criada como não exportável (extractable = false). */
export function gerarPar(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ALGORITMO_CHAVE, false, ['sign', 'verify'])
}

export async function tentarExportarPrivada(privada: CryptoKey): Promise<string[]> {
  const recusas: string[] = []
  for (const formato of ['jwk', 'pkcs8'] as const) {
    try {
      await crypto.subtle.exportKey(formato, privada)
      recusas.push(`${formato}: EXPORTADA`)
    } catch (erro) {
      recusas.push(`${formato}: recusada (${(erro as Error).name})`)
    }
  }
  return recusas
}

/** Assina o texto exacto que é enviado; o servidor verifica esses mesmos bytes. */
export async function assinar(privada: CryptoKey, chaveId: string, operacao: object): Promise<Envelope> {
  const conteudo = JSON.stringify(operacao)
  const assinatura = await crypto.subtle.sign(ALGORITMO_ASSINATURA, privada, new TextEncoder().encode(conteudo))
  return { chaveId, conteudo, assinatura: paraBase64Url(assinatura) }
}

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const pedido = indexedDB.open(BASE, 1)
    pedido.onupgradeneeded = () => pedido.result.createObjectStore(LOJA, { keyPath: 'nome' })
    pedido.onsuccess = () => resolve(pedido.result)
    pedido.onerror = () => reject(pedido.error)
  })
}

export async function guardarChave(registo: RegistoChave): Promise<void> {
  const base = await abrir()
  await new Promise<void>((resolve, reject) => {
    const tx = base.transaction(LOJA, 'readwrite')
    tx.objectStore(LOJA).put(registo)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  base.close()
}

export async function lerChave(nome: string): Promise<RegistoChave | undefined> {
  const base = await abrir()
  const resultado = await new Promise<RegistoChave | undefined>((resolve, reject) => {
    const pedido = base.transaction(LOJA, 'readonly').objectStore(LOJA).get(nome)
    pedido.onsuccess = () => resolve(pedido.result as RegistoChave | undefined)
    pedido.onerror = () => reject(pedido.error)
  })
  base.close()
  return resultado
}

export function apagarBase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const pedido = indexedDB.deleteDatabase(BASE)
    pedido.onsuccess = () => resolve()
    pedido.onerror = () => reject(pedido.error)
    pedido.onblocked = () => reject(new Error('Base bloqueada por outro separador.'))
  })
}

/**
 * Desbloqueio por PIN da aplicação. Guarda um verificador PBKDF2 (só em memória
 * nesta prova). Serve para mostrar que é um controlo da aplicação: a chave não
 * depende dele e pode ser usada sem desbloqueio.
 */
export async function criarVerificadorPin(pin: string): Promise<{ sal: Uint8Array<ArrayBuffer>; derivado: ArrayBuffer; iteracoes: number }> {
  const sal = crypto.getRandomValues(new Uint8Array(16))
  const iteracoes = 310_000
  return { sal, derivado: await derivarPin(pin, sal, iteracoes), iteracoes }
}

export async function derivarPin(pin: string, sal: Uint8Array<ArrayBuffer>, iteracoes: number): Promise<ArrayBuffer> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteracoes }, material, 256)
}

export function iguais(a: ArrayBuffer, b: ArrayBuffer): boolean {
  const x = new Uint8Array(a)
  const y = new Uint8Array(b)
  if (x.length !== y.length) return false
  let diferenca = 0
  for (let i = 0; i < x.length; i++) diferenca |= x[i] ^ y[i]
  return diferenca === 0
}

export async function api<T>(caminho: string, corpo?: unknown): Promise<T> {
  const resposta = await fetch(`/api/prova-assinatura${caminho}`, {
    method: corpo === undefined ? 'GET' : 'POST',
    headers: corpo === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
  const json = (await resposta.json()) as T & { erro?: { mensagem: string } }
  if (!resposta.ok) throw new Error(json.erro?.mensagem ?? `HTTP ${resposta.status}`)
  return json
}
