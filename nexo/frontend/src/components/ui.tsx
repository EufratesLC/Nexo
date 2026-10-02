import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { EstadoSync } from '../demo/tipos'

type VarianteBotao = 'primario' | 'secundario' | 'perigo' | 'discreto'

export function Botao({
  variante = 'primario',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: VarianteBotao }) {
  return <button type="button" className={`botao botao-${variante} ${className}`} {...props} />
}

export function Cartao({ titulo, accao, children, className = '' }: { titulo?: string; accao?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`cartao ${className}`}>
      {(titulo || accao) && (
        <header className="cartao-cabecalho">
          {titulo && <h2>{titulo}</h2>}
          {accao}
        </header>
      )}
      {children}
    </section>
  )
}

export function CabecalhoPagina({ titulo, descricao, accoes }: { titulo: string; descricao?: string; accoes?: ReactNode }) {
  return (
    <header className="cabecalho-pagina">
      <div>
        <h1>{titulo}</h1>
        {descricao && <p>{descricao}</p>}
      </div>
      {accoes && <div className="cabecalho-accoes">{accoes}</div>}
    </header>
  )
}

type Tom = 'neutro' | 'sucesso' | 'aviso' | 'perigo' | 'info'

export function Etiqueta({ tom = 'neutro', children }: { tom?: Tom; children: ReactNode }) {
  return <span className={`etiqueta etiqueta-${tom}`}>{children}</span>
}

const SYNC: Record<EstadoSync, { tom: Tom; texto: string }> = {
  pendente: { tom: 'aviso', texto: 'Pendente' },
  confirmado: { tom: 'sucesso', texto: 'Confirmado' },
  conflito: { tom: 'perigo', texto: 'Conflito' },
  anulada: { tom: 'neutro', texto: 'Anulada pelo gestor' },
}

export function EtiquetaSync({ estado }: { estado: EstadoSync | undefined }) {
  if (!estado) return <Etiqueta>Sem operação</Etiqueta>
  const { tom, texto } = SYNC[estado]
  return <Etiqueta tom={tom}>{texto}</Etiqueta>
}

export function Aviso({ tom = 'info', titulo, children }: { tom?: Tom; titulo?: string; children: ReactNode }) {
  return (
    <div className={`aviso aviso-${tom}`} role={tom === 'perigo' ? 'alert' : 'status'}>
      {titulo && <strong>{titulo}</strong>}
      <div>{children}</div>
    </div>
  )
}

export function EstadoVazio({ titulo, children, accao }: { titulo: string; children?: ReactNode; accao?: ReactNode }) {
  return (
    <div className="estado-vazio">
      <p className="estado-vazio-titulo">{titulo}</p>
      {children && <p>{children}</p>}
      {accao}
    </div>
  )
}

export function Campo({
  rotulo,
  erro,
  ajuda,
  children,
}: {
  rotulo: string
  erro?: string
  ajuda?: string
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode
}) {
  const id = useId()
  const descricao = erro ? `${id}-erro` : ajuda ? `${id}-ajuda` : undefined
  return (
    <div className={`campo ${erro ? 'campo-erro' : ''}`}>
      <label htmlFor={id}>{rotulo}</label>
      {children({ id, 'aria-invalid': Boolean(erro), 'aria-describedby': descricao })}
      {erro ? (
        <p className="campo-mensagem" id={`${id}-erro`}>
          {erro}
        </p>
      ) : ajuda ? (
        <p className="campo-ajuda" id={`${id}-ajuda`}>
          {ajuda}
        </p>
      ) : null}
    </div>
  )
}

export function Indicador({ rotulo, valor, detalhe, tom }: { rotulo: string; valor: string; detalhe?: string; tom?: Tom }) {
  return (
    <div className={`indicador ${tom ? `indicador-${tom}` : ''}`}>
      <span className="indicador-rotulo">{rotulo}</span>
      <strong className="indicador-valor">{valor}</strong>
      {detalhe && <span className="indicador-detalhe">{detalhe}</span>}
    </div>
  )
}

export function Modal({ titulo, aoFechar, children }: { titulo: string; aoFechar: () => void; children: ReactNode }) {
  const caixa = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null
    caixa.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus()
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') aoFechar()
    }
    window.addEventListener('keydown', tecla)
    return () => {
      window.removeEventListener('keydown', tecla)
      anterior?.focus()
    }
  }, [aoFechar])
  return (
    <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo} ref={caixa}>
        <header className="modal-cabecalho">
          <h2>{titulo}</h2>
          <button type="button" className="modal-fechar" onClick={aoFechar} aria-label="Fechar">
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}

export function Tabela({ children }: { children: ReactNode }) {
  return (
    <div className="tabela-contentor">
      <table className="tabela">{children}</table>
    </div>
  )
}

export function MarcaDemo({ children = 'Valores demonstrativos' }: { children?: ReactNode }) {
  return <span className="marca-demo">{children}</span>
}
