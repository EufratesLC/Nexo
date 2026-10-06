// Abertura da base local com migrações aditivas — PREPARAÇÃO da Etapa 2.
//
// A aplicação ainda não chama abrirBaseLocal(): é usada só pelo teste automático, que abre uma
// base de teste, confirma as lojas e apaga-a. Os dados fictícios do protótipo continuam em
// localStorage e NÃO são copiados para aqui (não são operações reais).

import { ESQUEMA_LOCAL, VERSAO_ACTUAL, type VersaoEsquema } from './esquema'

export function abrirBaseLocal(nome: string, esquema: VersaoEsquema[] = ESQUEMA_LOCAL): Promise<IDBDatabase> {
  const versaoFinal = esquema[esquema.length - 1]?.versao ?? VERSAO_ACTUAL
  return new Promise((resolver, rejeitar) => {
    if (typeof indexedDB === 'undefined') {
      rejeitar(new Error('Este navegador não tem IndexedDB'))
      return
    }
    const pedido = indexedDB.open(nome, versaoFinal)
    pedido.onupgradeneeded = (evento) => {
      const db = pedido.result
      const anterior = evento.oldVersion
      for (const versao of esquema) {
        if (versao.versao <= anterior) continue
        for (const loja of versao.novasLojas) {
          // Aditivo: uma loja existente nunca é apagada nem recriada (protege a fila).
          if (db.objectStoreNames.contains(loja.nome)) continue
          const criada = db.createObjectStore(loja.nome, { keyPath: loja.chave })
          for (const indice of loja.indices ?? []) criada.createIndex(indice.nome, indice.caminho, { unique: indice.unico ?? false })
        }
      }
    }
    pedido.onsuccess = () => resolver(pedido.result)
    pedido.onerror = () => rejeitar(pedido.error ?? new Error('Falha ao abrir a base local'))
    pedido.onblocked = () => rejeitar(new Error('Base local bloqueada por outro separador'))
  })
}

/** Só para testes: apaga uma base de teste. Nunca usado com bases de registos reais. */
export function apagarBaseDeTeste(nome: string): Promise<void> {
  if (!nome.startsWith('nexo-teste-')) return Promise.reject(new Error('só bases nexo-teste-* podem ser apagadas aqui'))
  return new Promise((resolver, rejeitar) => {
    const pedido = indexedDB.deleteDatabase(nome)
    pedido.onsuccess = () => resolver()
    pedido.onerror = () => rejeitar(pedido.error)
  })
}
