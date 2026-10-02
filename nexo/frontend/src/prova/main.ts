// Página da prova técnica H-23. Pode correr manualmente (botões) ou em modo
// automático: prova-assinatura.html?auto=gerar,encerrar,tempos&fechar=1
// Os resultados aparecem na tabela e são enviados ao servidor da prova
// (GET /api/prova-assinatura/resultados), para leitura sem interface gráfica.

import './prova.css'
import {
  apagarBase,
  api,
  assinar,
  criarVerificadorPin,
  derivarPin,
  gerarPar,
  guardarChave,
  iguais,
  lerChave,
  tentarExportarPrivada,
  type Envelope,
} from './cripto'

type Estado = 'ok' | 'falhou' | 'informativo'
interface Resultado {
  teste: string
  estado: Estado
  detalhe: string
}

const UTILIZADOR = 'u-ana'
const REGISTO = 'C01'
const PRINCIPAL = 'principal'

const resultados: Resultado[] = []
const tabela = document.querySelector<HTMLTableSectionElement>('#resultados')!
const json = document.querySelector<HTMLPreElement>('#resultado-json')!

function registar(teste: string, estado: Estado, detalhe: string) {
  resultados.push({ teste, estado, detalhe })
  const linha = document.createElement('tr')
  linha.className = `estado-${estado}`
  for (const texto of [teste, estado === 'ok' ? 'OK' : estado === 'falhou' ? 'FALHOU' : 'Informativo', detalhe]) {
    const celula = document.createElement('td')
    celula.textContent = texto
    linha.append(celula)
  }
  tabela.append(linha)
  json.textContent = JSON.stringify(resultados, null, 2)
}

async function passo(teste: string, fn: () => Promise<{ estado: Estado; detalhe: string }>) {
  try {
    const { estado, detalhe } = await fn()
    registar(teste, estado, detalhe)
  } catch (erro) {
    registar(teste, 'falhou', `${(erro as Error).name}: ${(erro as Error).message}`)
  }
}

let sequencia = Date.now() % 100000
function operacao(extra: object = {}) {
  sequencia += 1
  return {
    id: crypto.randomUUID(),
    versao: 1,
    tipo: 'venda',
    registo: REGISTO,
    autor: UTILIZADOR,
    sequencia,
    horaDeclarada: new Date().toISOString(),
    versaoPermissoes: 7,
    conteudo: { total: 162450, linhas: [{ produto: 'p-01', quantidade: 3 }] },
    ...extra,
  }
}

function contexto(): string {
  const partes = [
    `Contexto seguro: ${window.isSecureContext ? 'sim' : 'NÃO (a Web Crypto não está disponível fora de HTTPS/localhost)'}`,
    `crypto.subtle: ${typeof crypto !== 'undefined' && crypto.subtle ? 'disponível' : 'indisponível'}`,
    `Navegador: ${navigator.userAgent}`,
  ]
  return partes.join(' · ')
}

async function verificar(envelope: Envelope) {
  return api<{ aceite: boolean; motivo?: string; verificacaoMs: number }>('/verificar', envelope)
}

// --- Fases ---

async function faseGerar() {
  let par: CryptoKeyPair | undefined
  await passo('Gerar par ECDSA P-256 com a chave privada não exportável', async () => {
    const t = performance.now()
    par = await gerarPar()
    return { estado: 'ok', detalhe: `gerado em ${(performance.now() - t).toFixed(1)} ms; extractable da privada = ${par.privateKey.extractable}` }
  })
  if (!par) return
  const chaves = par
  await passo('Tentar exportar a chave privada', async () => {
    const recusas = await tentarExportarPrivada(chaves.privateKey)
    const exportou = recusas.some((r) => r.includes('EXPORTADA'))
    return { estado: exportou ? 'falhou' : 'ok', detalhe: recusas.join('; ') }
  })

  let chaveId = ''
  await passo('Registar a chave pública no servidor', async () => {
    const jwk = await crypto.subtle.exportKey('jwk', chaves.publicKey)
    const r = await api<{ chaveId: string }>('/chaves', { jwk, utilizador: UTILIZADOR, registo: REGISTO })
    chaveId = r.chaveId
    return { estado: 'ok', detalhe: `chaveId ${chaveId}; só a parte pública saiu do navegador` }
  })

  await passo('Guardar a chave no IndexedDB e recuperá-la numa nova ligação', async () => {
    await guardarChave({
      nome: PRINCIPAL,
      privada: chaves.privateKey,
      publica: chaves.publicKey,
      chaveId,
      utilizador: UTILIZADOR,
      registo: REGISTO,
      criadaEm: new Date().toISOString(),
    })
    const lida = await lerChave(PRINCIPAL)
    if (!lida) return { estado: 'falhou', detalhe: 'nada lido do IndexedDB' }
    const ok = lida.privada instanceof CryptoKey && lida.privada.extractable === false && lida.privada.usages.includes('sign')
    return {
      estado: ok ? 'ok' : 'falhou',
      detalhe: `recuperada como CryptoKey=${lida.privada instanceof CryptoKey}, extractable=${lida.privada.extractable}, usos=${lida.privada.usages.join(',')}`,
    }
  })

  await passo('Assinar uma operação com a chave recuperada e verificar no servidor', async () => {
    const lida = await lerChave(PRINCIPAL)
    if (!lida?.chaveId) return { estado: 'falhou', detalhe: 'sem chave guardada' }
    const r = await verificar(await assinar(lida.privada, lida.chaveId, operacao()))
    return { estado: r.aceite ? 'ok' : 'falhou', detalhe: r.aceite ? `aceite; verificação no servidor ${r.verificacaoMs} ms` : `recusada: ${r.motivo}` }
  })

  await passo('Recusar conteúdo alterado depois de assinado', async () => {
    const lida = await lerChave(PRINCIPAL)
    if (!lida?.chaveId) return { estado: 'falhou', detalhe: 'sem chave guardada' }
    const env = await assinar(lida.privada, lida.chaveId, operacao())
    const alterado = { ...env, conteudo: env.conteudo.replace('162450', '100') }
    const r = await verificar(alterado)
    return { estado: r.aceite ? 'falhou' : 'ok', detalhe: r.aceite ? 'ACEITE (erro grave)' : `recusada: ${r.motivo}` }
  })

  await passo('Recusar operação com autor diferente do dono da chave', async () => {
    const lida = await lerChave(PRINCIPAL)
    if (!lida?.chaveId) return { estado: 'falhou', detalhe: 'sem chave guardada' }
    const r = await verificar(await assinar(lida.privada, lida.chaveId, operacao({ autor: 'u-carlos' })))
    return { estado: r.aceite ? 'falhou' : 'ok', detalhe: r.aceite ? 'ACEITE (erro grave)' : `recusada: ${r.motivo}` }
  })

  await passo('Assinar SEM desbloqueio por PIN (limite da hipótese)', async () => {
    const lida = await lerChave(PRINCIPAL)
    if (!lida?.chaveId) return { estado: 'falhou', detalhe: 'sem chave guardada' }
    // Chamada directa à Web Crypto, sem passar pelo ecrã de PIN.
    const r = await verificar(await assinar(lida.privada, lida.chaveId, operacao()))
    return {
      estado: 'informativo',
      detalhe: r.aceite
        ? 'O servidor ACEITOU uma operação assinada sem PIN: a assinatura prova o uso da chave, não o PIN nem a pessoa.'
        : `recusada (${r.motivo})`,
    }
  })
}

async function faseReiniciar() {
  await passo('Encontrar a chave no IndexedDB depois de reiniciar o navegador', async () => {
    const lida = await lerChave(PRINCIPAL)
    if (!lida) return { estado: 'informativo', detalhe: 'Sem chave: os dados locais não existem (limpos ou outro perfil). É preciso nova preparação.' }
    return { estado: 'ok', detalhe: `chave ${lida.chaveId} criada em ${lida.criadaEm}; extractable=${lida.privada.extractable}` }
  })
  const lida = await lerChave(PRINCIPAL).catch(() => undefined)
  if (!lida?.chaveId) return
  await passo('Assinar com a chave recuperada após reinício e verificar no servidor', async () => {
    const r = await verificar(await assinar(lida.privada, lida.chaveId!, operacao()))
    return {
      estado: r.aceite ? 'ok' : 'falhou',
      detalhe: r.aceite ? 'aceite' : `recusada: ${r.motivo}${r.motivo === 'chave_desconhecida' ? ' (o servidor da prova reiniciou e perdeu as chaves em memória?)' : ''}`,
    }
  })
}

async function faseEncerrar() {
  await passo('Encerramento de chave: aceitar até à sequência N, recusar depois', async () => {
    const par = await gerarPar()
    const jwk = await crypto.subtle.exportKey('jwk', par.publicKey)
    const { chaveId } = await api<{ chaveId: string }>('/chaves', { jwk, utilizador: UTILIZADOR, registo: REGISTO })
    const antes = await verificar(await assinar(par.privateKey, chaveId, operacao({ sequencia: 5 })))
    await api(`/chaves/${encodeURIComponent(chaveId)}/encerrar`, { aposSequencia: 5 })
    const depois = await verificar(await assinar(par.privateKey, chaveId, operacao({ sequencia: 6 })))
    const tardiaAntiga = await verificar(await assinar(par.privateKey, chaveId, operacao({ sequencia: 4 })))
    const ok = antes.aceite && !depois.aceite && depois.motivo === 'chave_encerrada' && tardiaAntiga.aceite
    return {
      estado: ok ? 'ok' : 'falhou',
      detalhe: `seq 5 antes do encerramento: ${antes.aceite ? 'aceite' : antes.motivo}; seq 6 depois: ${depois.aceite ? 'ACEITE' : depois.motivo}; seq 4 recebida depois: ${tardiaAntiga.aceite ? 'aceite' : tardiaAntiga.motivo}`,
    }
  })
}

async function faseTempos() {
  await passo('Tempo de assinatura (200 operações, JSON + ECDSA P-256)', async () => {
    const lida = await lerChave(PRINCIPAL)
    const chave = lida?.privada ?? (await gerarPar()).privateKey
    const tempos: number[] = []
    for (let i = 0; i < 200; i++) {
      const t = performance.now()
      await assinar(chave, lida?.chaveId ?? 'sem-registo', operacao())
      tempos.push(performance.now() - t)
    }
    tempos.sort((a, b) => a - b)
    const media = tempos.reduce((a, b) => a + b, 0) / tempos.length
    return {
      estado: 'informativo',
      detalhe: `média ${media.toFixed(3)} ms; mediana ${tempos[100].toFixed(3)} ms; p95 ${tempos[190].toFixed(3)} ms; máx ${tempos[199].toFixed(3)} ms`,
    }
  })
}

async function faseLimpar() {
  await passo('Apagar a base IndexedDB da prova e confirmar que a chave desapareceu', async () => {
    await apagarBase()
    const lida = await lerChave(PRINCIPAL)
    return {
      estado: lida ? 'falhou' : 'ok',
      detalhe: lida ? 'a chave continua lá' : 'chave apagada: o dispositivo teria de ser preparado de novo (novo registo, D.5.3)',
    }
  })
}

const FASES: Record<string, () => Promise<void>> = {
  gerar: faseGerar,
  reiniciar: faseReiniciar,
  encerrar: faseEncerrar,
  tempos: faseTempos,
  limpar: faseLimpar,
}

// --- Demonstração manual do PIN (controlo da aplicação, não da chave) ---

let verificador: Awaited<ReturnType<typeof criarVerificadorPin>> | null = null
let desbloqueado = false

async function prepararPin() {
  verificador = await criarVerificadorPin('1234')
}

document.querySelector('#b-desbloquear')?.addEventListener('click', async () => {
  const pin = document.querySelector<HTMLInputElement>('#pin')?.value ?? ''
  if (!verificador) await prepararPin()
  const v = verificador!
  const t = performance.now()
  desbloqueado = iguais(await derivarPin(pin, v.sal, v.iteracoes), v.derivado)
  registar('Desbloqueio por PIN (PBKDF2, 310 000 iterações)', desbloqueado ? 'ok' : 'informativo', `${desbloqueado ? 'desbloqueado' : 'PIN errado'} em ${(performance.now() - t).toFixed(0)} ms`)
})

document.querySelector('#b-assinar-pin')?.addEventListener('click', async () => {
  if (!desbloqueado) {
    registar('Assinar com desbloqueio', 'informativo', 'A aplicação recusou: introduza o PIN primeiro.')
    return
  }
  const lida = await lerChave(PRINCIPAL)
  if (!lida?.chaveId) return registar('Assinar com desbloqueio', 'falhou', 'Gere a chave primeiro (passo 1).')
  const r = await verificar(await assinar(lida.privada, lida.chaveId, operacao()))
  registar('Assinar com desbloqueio', r.aceite ? 'ok' : 'falhou', r.aceite ? 'aceite' : String(r.motivo))
})

document.querySelector('#b-assinar-sem-pin')?.addEventListener('click', async () => {
  const lida = await lerChave(PRINCIPAL)
  if (!lida?.chaveId) return registar('Assinar sem desbloqueio', 'falhou', 'Gere a chave primeiro (passo 1).')
  const r = await verificar(await assinar(lida.privada, lida.chaveId, operacao()))
  registar(
    'Assinar sem desbloqueio',
    'informativo',
    r.aceite ? 'Aceite pelo servidor sem PIN: a assinatura não prova que o PIN foi introduzido.' : String(r.motivo),
  )
})

const botoes: [string, string][] = [
  ['#b-gerar', 'gerar'],
  ['#b-reiniciar', 'reiniciar'],
  ['#b-encerrar', 'encerrar'],
  ['#b-tempos', 'tempos'],
  ['#b-limpar', 'limpar'],
]
for (const [seletor, fase] of botoes) {
  document.querySelector(seletor)?.addEventListener('click', () => void FASES[fase]())
}

// --- Arranque ---

document.querySelector('#contexto')!.textContent = contexto()

const parametros = new URLSearchParams(window.location.search)
const auto = parametros.get('auto')
if (auto) {
  void (async () => {
    const fases = auto.split(',').filter((f) => f in FASES)
    for (const fase of fases) await FASES[fase]()
    try {
      await api('/resultados', { fases, rotulo: parametros.get('rotulo') ?? '', contexto: contexto(), resultados })
    } catch (erro) {
      registar('Enviar resultados ao servidor da prova', 'falhou', (erro as Error).message)
    }
    document.body.dataset.terminado = 'sim'
    if (parametros.get('fechar') === '1') window.close()
  })()
}
