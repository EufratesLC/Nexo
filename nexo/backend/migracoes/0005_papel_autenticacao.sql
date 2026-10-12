-- nexo:executar-como administrador
--
-- 0005 — Papel nexo_autenticacao (Etapa 3; arquitectura 3.1 e 3.4).
--
-- Dono das funções de identidade que correm ANTES de existir contexto de empresa (login,
-- validação de sessão, registo, recuperação). Não tem login nem membros: a única forma de agir
-- como este papel é chamar uma dessas funções (SECURITY DEFINER). Também está sujeito às
-- políticas (FORCE ROW LEVEL SECURITY) e não tem BYPASSRLS: lê e escreve só pelas políticas
-- explícitas criadas para ele na 0006.
--
-- Corre com o administrador do Supabase (não superutilizador; PostgreSQL 16+): o papel é criado só
-- com NOLOGIN e NOINHERIT, e os restantes atributos ficam nos valores seguros por omissão (ver 0001).

DO $$
DECLARE
  r record;
  perigosos text[];
BEGIN
  SELECT * INTO r FROM pg_catalog.pg_roles WHERE rolname = 'nexo_autenticacao';
  IF NOT FOUND THEN
    CREATE ROLE nexo_autenticacao NOLOGIN NOINHERIT;
    RETURN;
  END IF;
  perigosos := array_remove(ARRAY[
    CASE WHEN r.rolsuper THEN 'SUPERUSER' END,
    CASE WHEN r.rolcreatedb THEN 'CREATEDB' END,
    CASE WHEN r.rolcreaterole THEN 'CREATEROLE' END,
    CASE WHEN r.rolreplication THEN 'REPLICATION' END,
    CASE WHEN r.rolbypassrls THEN 'BYPASSRLS' END,
    CASE WHEN r.rolcanlogin THEN 'LOGIN' END
  ], NULL);
  IF cardinality(perigosos) > 0 THEN
    RAISE EXCEPTION 'o papel nexo_autenticacao já existe com atributos proibidos: %', array_to_string(perigosos, ', ')
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'nexo_autenticacao não pode ter LOGIN, SUPERUSER, CREATEDB, CREATEROLE, REPLICATION nem BYPASSRLS.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.roleid = r.oid AND (m.set_option OR m.inherit_option)) THEN
    RAISE EXCEPTION 'o papel nexo_autenticacao já existe e tem membros' USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;

-- Usa o esquema; os privilégios por tabela e as políticas vêm na 0006 (dono: nexo_proprietario).
GRANT USAGE ON SCHEMA nexo TO nexo_autenticacao;
