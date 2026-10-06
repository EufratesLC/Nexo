-- nexo:executar-como nexo_proprietario
--
-- 0002 — Contexto local por transacção (H-01, arquitectura 3.2; requisito R4).
--
-- A API define o contexto com nexo.definir_contexto(…) logo a seguir a SET LOCAL ROLE. Os
-- valores ficam em parâmetros locais à transacção (set_config(…, true)) e são acompanhados de
-- uma MARCA: o identificador do processo do servidor e o instante de início da transacção.
-- As funções lidas pelas políticas só devolvem valores quando a marca corresponde à transacção
-- actual. Assim, um valor que tenha ficado na sessão (set_config(…, false), proibido no código)
-- não vale noutra transacção da mesma ligação do pool (testes T05, T20, P02 da prova H-01).
--
-- Limites (ver docs/Nexo_Entrega_Etapa_2.md, secção 5):
-- - Protege contra erros e estado residual, não contra código malicioso com SQL livre dentro da
--   API: qualquer papel pode chamar set_config e reproduzir a marca.
-- - Não protege consultas feitas fora de uma transacção explícita da API.
-- - Depende de now() (início da transacção, microssegundos) e de pg_backend_pid(): duas
--   transacções seguidas no mesmo processo teriam de começar no mesmo microssegundo para
--   coincidir, o que só acontece com o relógio do servidor a andar para trás.

CREATE FUNCTION nexo.marca_transaccao() RETURNS text
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
AS $$ SELECT pg_backend_pid()::text || ':' || extract(epoch FROM now())::text $$;

CREATE FUNCTION nexo.contexto_valido() RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
AS $$ SELECT coalesce(current_setting('nexo.marca', true), '') = nexo.marca_transaccao() $$;

CREATE FUNCTION nexo.empresa_actual() RETURNS uuid
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
AS $$ SELECT CASE WHEN nexo.contexto_valido() THEN nullif(current_setting('nexo.empresa_id', true), '')::uuid END $$;

CREATE FUNCTION nexo.filial_actual() RETURNS uuid
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
AS $$ SELECT CASE WHEN nexo.contexto_valido() THEN nullif(current_setting('nexo.filial_id', true), '')::uuid END $$;

CREATE FUNCTION nexo.utilizador_actual() RETURNS uuid
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
AS $$ SELECT CASE WHEN nexo.contexto_valido() THEN nullif(current_setting('nexo.utilizador_id', true), '')::uuid END $$;

CREATE FUNCTION nexo.funcao_actual() RETURNS text
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
AS $$ SELECT CASE WHEN nexo.contexto_valido() THEN nullif(current_setting('nexo.funcao', true), '') END $$;

CREATE FUNCTION nexo.registo_actual() RETURNS uuid
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
AS $$ SELECT CASE WHEN nexo.contexto_valido() THEN nullif(current_setting('nexo.registo_id', true), '')::uuid END $$;

-- Define o contexto uma única vez por transacção, e só dentro de um papel de execução.
CREATE FUNCTION nexo.definir_contexto(
  p_empresa uuid,
  p_filial uuid,
  p_utilizador uuid,
  p_funcao text,
  p_registo uuid
) RETURNS void
  LANGUAGE plpgsql VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('nexo_operador', 'nexo_gestao', 'nexo_sincronizacao') THEN
    RAISE EXCEPTION 'definir_contexto exige um papel de execução (actual: %)', current_user
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF nexo.contexto_valido() THEN
    RAISE EXCEPTION 'o contexto já foi definido nesta transacção' USING ERRCODE = 'invalid_transaction_state';
  END IF;
  IF p_empresa IS NULL THEN
    RAISE EXCEPTION 'contexto sem empresa' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_funcao IS NOT NULL AND p_funcao NOT IN ('proprietario', 'gestor', 'operador') THEN
    RAISE EXCEPTION 'função desconhecida: %', p_funcao USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM set_config('nexo.empresa_id', p_empresa::text, true);
  PERFORM set_config('nexo.filial_id', coalesce(p_filial::text, ''), true);
  PERFORM set_config('nexo.utilizador_id', coalesce(p_utilizador::text, ''), true);
  PERFORM set_config('nexo.funcao', coalesce(p_funcao, ''), true);
  PERFORM set_config('nexo.registo_id', coalesce(p_registo::text, ''), true);
  PERFORM set_config('nexo.marca', nexo.marca_transaccao(), true);
END
$$;

-- Execução só para os papéis de execução (as políticas correm com o papel de quem consulta).
REVOKE ALL ON FUNCTION nexo.marca_transaccao(), nexo.contexto_valido(), nexo.empresa_actual(), nexo.filial_actual(),
  nexo.utilizador_actual(), nexo.funcao_actual(), nexo.registo_actual(),
  nexo.definir_contexto(uuid, uuid, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexo.marca_transaccao(), nexo.contexto_valido(), nexo.empresa_actual(), nexo.filial_actual(),
  nexo.utilizador_actual(), nexo.funcao_actual(), nexo.registo_actual(),
  nexo.definir_contexto(uuid, uuid, uuid, text, uuid) TO nexo_operador, nexo_gestao, nexo_sincronizacao;
