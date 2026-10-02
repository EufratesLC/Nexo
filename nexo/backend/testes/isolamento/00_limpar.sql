-- Teste de isolamento H-01 — limpeza.
-- Apaga o esquema de teste nexo_iso e os papéis nexo_iso_*. Não toca em mais nada.
-- Executar como o utilizador administrador do projecto de DESENVOLVIMENTO (ligação directa).

DROP SCHEMA IF EXISTS nexo_iso CASCADE;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['nexo_iso_api', 'nexo_iso_operador', 'nexo_iso_gestao', 'nexo_iso_sinc', 'nexo_iso_autenticacao'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('DROP ROLE %I', r);
    END IF;
  END LOOP;
END
$$;
