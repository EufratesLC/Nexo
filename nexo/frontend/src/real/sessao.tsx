// Estado da sessão real (modo "api"). Ao abrir, pergunta à API se há sessão (o cookie HttpOnly vai
// sozinho). Nada da sessão é guardado no navegador além desse cookie, que o JavaScript não lê.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ErroApi, aoSessaoTerminar } from "../servicos/http";
import { obterSessao, sair as sairApi } from "../servicos/autenticacao";
import { Contexto, type ContextoSessao, type EstadoSessao } from "./useSessao";

function estadoDoErro(erro: unknown): EstadoSessao {
  return erro instanceof ErroApi && erro.estado === 401
    ? { tipo: "sem_sessao" }
    : { tipo: "erro", erro };
}

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoSessao>({ tipo: "a_verificar" });

  const actualizar = useCallback(async () => {
    try {
      setEstado({ tipo: "com_sessao", sessao: await obterSessao() });
    } catch (erro) {
      setEstado(estadoDoErro(erro));
    }
  }, []);

  // Ao abrir: há sessão? (o cookie HttpOnly vai sozinho no pedido)
  useEffect(() => {
    const controlo = new AbortController();
    obterSessao(controlo.signal).then(
      (sessao) => setEstado({ tipo: "com_sessao", sessao }),
      (erro: unknown) => {
        if (!controlo.signal.aborted) setEstado(estadoDoErro(erro));
      },
    );
    return () => controlo.abort();
  }, []);

  // Um pedido qualquer recebeu 401: a sessão expirou, foi revogada ou a conta foi desactivada.
  useEffect(
    () =>
      aoSessaoTerminar(() =>
        setEstado((anterior) =>
          anterior.tipo === "com_sessao"
            ? { tipo: "sem_sessao", motivo: "terminada" }
            : anterior,
        ),
      ),
    [],
  );

  const valor = useMemo<ContextoSessao>(
    () => ({
      estado,
      iniciar: (sessao) => setEstado({ tipo: "com_sessao", sessao }),
      sair: async () => {
        try {
          await sairApi();
        } finally {
          setEstado({ tipo: "sem_sessao", motivo: "saiu" });
        }
      },
      actualizar,
    }),
    [estado, actualizar],
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}
