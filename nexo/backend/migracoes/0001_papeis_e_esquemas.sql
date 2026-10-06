-- nexo:executar-como administrador
--
-- 0001 — Papéis e esquemas (H-01, aprovada em 02/10/2026). Exige PostgreSQL 16 ou posterior.
--
-- Papéis próprios, sem BYPASSRLS. A API liga-se só como nexo_api (NOINHERIT) e muda, em cada
-- transacção, para um dos papéis de execução. O dono dos objectos de negócio é
-- nexo_proprietario, que também está sujeito às políticas (FORCE ROW LEVEL SECURITY).
--
-- Corre com o administrador do Supabase, que NÃO é superutilizador (tem CREATEROLE). A partir do
-- PostgreSQL 16, esse administrador não pode indicar NOSUPERUSER, NOREPLICATION nem NOBYPASSRLS
-- num ALTER ROLE, nem sequer para confirmar o valor actual ("permission denied to alter role").
-- Por isso:
-- - papéis novos são criados só com LOGIN/NOLOGIN e INHERIT/NOINHERIT; os restantes atributos
--   ficam nos valores seguros por omissão (NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
--   NOBYPASSRLS);
-- - papéis já existentes são lidos no catálogo. Com um atributo perigoso, a migração PÁRA com
--   uma mensagem clara (não o aceita nem o tenta mudar). Só LOGIN e INHERIT são corrigidos, se
--   for preciso e o administrador tiver ADMIN OPTION sobre o papel.
-- A palavra-passe de nexo_api NÃO está aqui: define-se à parte (comando db senha-api).

DO $$
DECLARE
  papel record;
  r record;
  perigosos text[];
BEGIN
  FOR papel IN
    SELECT * FROM (VALUES
      ('nexo_proprietario',  false, true),   -- dono dos objectos; só migrações
      ('nexo_api',           true,  false),  -- login da API; NOINHERIT
      ('nexo_operador',      false, true),
      ('nexo_gestao',        false, true),
      ('nexo_sincronizacao', false, true),
      ('nexo_diagnostico',   false, true)    -- dono da função nexo.estado_base()
    ) AS t(nome, login, herda)
  LOOP
    SELECT * INTO r FROM pg_catalog.pg_roles WHERE rolname = papel.nome;

    IF NOT FOUND THEN
      EXECUTE format('CREATE ROLE %I %s %s', papel.nome,
        CASE WHEN papel.login THEN 'LOGIN' ELSE 'NOLOGIN' END,
        CASE WHEN papel.herda THEN 'INHERIT' ELSE 'NOINHERIT' END);
      CONTINUE;
    END IF;

    perigosos := array_remove(ARRAY[
      CASE WHEN r.rolsuper THEN 'SUPERUSER' END,
      CASE WHEN r.rolcreatedb THEN 'CREATEDB' END,
      CASE WHEN r.rolcreaterole THEN 'CREATEROLE' END,
      CASE WHEN r.rolreplication THEN 'REPLICATION' END,
      CASE WHEN r.rolbypassrls THEN 'BYPASSRLS' END
    ], NULL);
    IF cardinality(perigosos) > 0 THEN
      RAISE EXCEPTION 'o papel % já existe com atributos proibidos: %', papel.nome, array_to_string(perigosos, ', ')
        USING ERRCODE = 'insufficient_privilege',
              HINT = 'Nenhum papel do Nexo pode ter SUPERUSER, CREATEDB, CREATEROLE, REPLICATION ou BYPASSRLS. '
                     'Corrija o papel (ou apague-o, se não for usado) com um superutilizador e repita a migração.';
    END IF;

    IF r.rolcanlogin IS DISTINCT FROM papel.login OR r.rolinherit IS DISTINCT FROM papel.herda THEN
      BEGIN
        EXECUTE format('ALTER ROLE %I %s %s', papel.nome,
          CASE WHEN papel.login THEN 'LOGIN' ELSE 'NOLOGIN' END,
          CASE WHEN papel.herda THEN 'INHERIT' ELSE 'NOINHERIT' END);
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE EXCEPTION 'o papel % já existe com LOGIN/INHERIT diferentes do previsto e o administrador não o pode alterar', papel.nome
          USING ERRCODE = 'insufficient_privilege',
                HINT = 'O administrador precisa de ADMIN OPTION sobre o papel.';
      END;
    END IF;
  END LOOP;
END
$$;

-- A API só pode assumir os três papéis de execução: SET sim, herança não, ADMIN nunca.
GRANT nexo_operador, nexo_gestao, nexo_sincronizacao TO nexo_api WITH INHERIT FALSE, SET TRUE;

-- O administrador das migrações pertence a nexo_proprietario (SET para criar objectos com esse
-- dono e correr as migrações seguintes com SET LOCAL ROLE; INHERIT para ALTER DEFAULT PRIVILEGES).
-- Nenhum papel do Nexo pertence a nexo_proprietario.
GRANT nexo_proprietario TO current_user WITH INHERIT TRUE, SET TRUE;

-- Esquema do produto. Não é exposto pela Data API do Supabase.
CREATE SCHEMA IF NOT EXISTS nexo AUTHORIZATION nexo_proprietario;
DO $$
BEGIN
  IF (SELECT pg_catalog.pg_get_userbyid(nspowner) FROM pg_catalog.pg_namespace WHERE nspname = 'nexo') <> 'nexo_proprietario' THEN
    RAISE EXCEPTION 'o esquema nexo já existe com outro dono; esperado nexo_proprietario' USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;
REVOKE ALL ON SCHEMA nexo FROM PUBLIC;
GRANT USAGE ON SCHEMA nexo TO nexo_api, nexo_operador, nexo_gestao, nexo_sincronizacao, nexo_diagnostico;

-- Funções novas de nexo_proprietario não ficam executáveis por PUBLIC (o PostgreSQL dá
-- EXECUTE a PUBLIC por omissão; a revogação tem de ser global, não por esquema).
ALTER DEFAULT PRIVILEGES FOR ROLE nexo_proprietario REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- No Supabase, anon e authenticated não têm nada neste esquema.
DO $$
DECLARE
  p text;
BEGIN
  FOREACH p IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = p) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA nexo FROM %I', p);
    END IF;
  END LOOP;
END
$$;

-- Transferência de propriedade de uma função para um papel dono dedicado (H-01, requisito R5).
-- Fora de superutilizador:
-- - quem transfere tem de poder fazer SET ROLE para o novo dono → pertença temporária (só SET);
-- - o novo dono tem de ter CREATE no esquema → dado só durante o ALTER … OWNER.
-- No fim confirma que a função mudou de dono, que o dono ficou sem CREATE e que o administrador
-- ficou sem SET sobre ele. Só o administrador das migrações a pode executar.
CREATE OR REPLACE PROCEDURE nexo_controlo.transferir_dono_funcao(p_funcao regprocedure, p_dono name)
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_esquema name;
  v_dono_actual name;
BEGIN
  IF p_dono NOT IN ('nexo_diagnostico', 'nexo_autenticacao') THEN
    RAISE EXCEPTION 'dono não previsto: %', p_dono;
  END IF;
  SELECT n.nspname, pg_catalog.pg_get_userbyid(f.proowner) INTO v_esquema, v_dono_actual
    FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace n ON n.oid = f.pronamespace
   WHERE f.oid = p_funcao;
  IF v_dono_actual = p_dono THEN
    RETURN; -- já transferida
  END IF;
  IF v_dono_actual <> current_user THEN
    RAISE EXCEPTION 'a função % pertence a %, não ao administrador que corre a migração', p_funcao, v_dono_actual;
  END IF;

  EXECUTE format('GRANT %I TO current_user WITH INHERIT FALSE, SET TRUE', p_dono);
  EXECUTE format('GRANT CREATE ON SCHEMA %I TO %I', v_esquema, p_dono);
  EXECUTE format('ALTER FUNCTION %s OWNER TO %I', p_funcao, p_dono);
  EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM %I', v_esquema, p_dono);
  EXECUTE format('REVOKE %I FROM current_user', p_dono);

  IF (SELECT pg_catalog.pg_get_userbyid(proowner) FROM pg_catalog.pg_proc WHERE oid = p_funcao) <> p_dono THEN
    RAISE EXCEPTION 'a transferência de dono de % não ficou registada', p_funcao;
  END IF;
  -- Os privilégios têm de ter sido definidos ANTES da transferência (depois dela, um REVOKE do
  -- administrador seria ignorado só com um aviso).
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc f WHERE f.oid = p_funcao
               AND (f.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(f.proacl) x WHERE x.grantee = 0))) THEN
    RAISE EXCEPTION 'a função % continua executável por PUBLIC: revogue antes de transferir o dono', p_funcao;
  END IF;
  IF pg_catalog.has_schema_privilege(p_dono, v_esquema, 'CREATE') THEN
    RAISE EXCEPTION '% ficou com CREATE no esquema %', p_dono, v_esquema;
  END IF;
  -- (Um superutilizador tem SET sobre todos os papéis; a verificação só faz sentido sem ele.)
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user)
     AND pg_catalog.pg_has_role(current_user, p_dono, 'SET') THEN
    RAISE EXCEPTION 'o administrador ficou com SET ROLE sobre %', p_dono;
  END IF;
END
$$;
REVOKE ALL ON PROCEDURE nexo_controlo.transferir_dono_funcao(regprocedure, name) FROM PUBLIC;
