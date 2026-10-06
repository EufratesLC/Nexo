-- nexo:executar-como administrador
--
-- 0004 — Diagnóstico da base para a API (GET /api/v1/saude/base).
--
-- A API (nexo_api) precisa de saber a versão das migrações sem ler a tabela de controlo. A
-- função corre com o papel dedicado nexo_diagnostico (SECURITY DEFINER), que só pode ler essa
-- tabela. A transferência de dono usa o procedimento de 0001, com o CREATE temporário (R5).

GRANT USAGE ON SCHEMA nexo_controlo TO nexo_diagnostico;
GRANT SELECT ON nexo_controlo.migracoes TO nexo_diagnostico;

CREATE FUNCTION nexo.estado_base()
  RETURNS TABLE (versao text, aplicada_em timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT m.versao, m.aplicada_em FROM nexo_controlo.migracoes m ORDER BY m.versao DESC LIMIT 1
$$;

-- Privilégios ANTES de transferir o dono: depois da transferência o administrador já não é dono
-- e, sem ser superutilizador, um REVOKE seria ignorado só com um aviso (a função ficaria
-- executável por PUBLIC). Os privilégios acompanham a função na mudança de dono.
REVOKE ALL ON FUNCTION nexo.estado_base() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexo.estado_base() TO nexo_api;

CALL nexo_controlo.transferir_dono_funcao('nexo.estado_base()'::regprocedure, 'nexo_diagnostico');
