-- nexo:executar-como administrador
--
-- 0008 — Registo com activação pendente (revisão da Etapa 3, 08/10/2026).
--
-- O fluxo definido exige a confirmação do e-mail do proprietário ANTES de activar o acesso:
-- - toda a conta criada pelo serviço de identidade (registo público) nasce com estado 'pendente';
--   isto é imposto por um trigger na tabela, e vale também para a função registar_empresa da 0007;
-- - iniciar_sessao (substituída) não cria sessão para contas pendentes e diz 'pendente' só depois
--   de o código estar certo; validar_sessao (0007) já exige a conta activa;
-- - confirmar_email (substituída) activa a conta pendente na mesma transacção em que confirma o e-mail;
-- - funções novas: reenviar_activacao (sem código; resposta neutra na API; no máximo 5 links por
--   hora por conta, também na base) e corrigir_email_activacao (exige o código secreto);
-- - (revisão de 11/10/2026, antes de qualquer aplicação no Supabase) confirmação, reenvio e
--   correcção serializados por conta, com a mesma ordem de bloqueios; o limite mantém-se com pedidos
--   simultâneos; uma correcção recusada não altera nada; a confirmação nunca usa um endereço que
--   uma correcção ou um reenvio já substituiu.
--
-- Não altera 0001–0007 (já aplicadas nalgumas bases). As funções de nexo_autenticacao são
-- substituídas pelo próprio dono, com pertença e CREATE TEMPORÁRIOS (como no procedimento de R5),
-- retirados e verificados no fim.

-- 1. Estado 'pendente' e trigger (como dono das tabelas) -----------------------------------------
SET LOCAL ROLE nexo_proprietario;

ALTER TABLE nexo.utilizadores DROP CONSTRAINT utilizadores_estado_check;
ALTER TABLE nexo.utilizadores ADD CONSTRAINT utilizadores_estado_check CHECK (estado IN ('activo', 'pendente', 'desactivado'));

CREATE FUNCTION nexo.registo_fica_pendente() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  -- Contas criadas pelo serviço de identidade (registo público) só ficam activas com o e-mail confirmado.
  IF current_user = 'nexo_autenticacao' THEN
    NEW.estado := 'pendente';
    NEW.desactivado_em := NULL;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER utilizadores_registo_pendente BEFORE INSERT ON nexo.utilizadores
  FOR EACH ROW EXECUTE FUNCTION nexo.registo_fica_pendente();

-- A activação (pendente → activo) é feita por confirmar_email, como nexo_autenticacao.
GRANT UPDATE (estado, actualizado_em) ON nexo.utilizadores TO nexo_autenticacao;
CREATE POLICY utilizadores_autenticacao_activar ON nexo.utilizadores FOR UPDATE TO nexo_autenticacao
  USING (estado = 'pendente') WITH CHECK (estado = 'activo');

RESET ROLE;

-- 2. Funções de identidade, como o seu dono (temporário) ------------------------------------------
GRANT nexo_autenticacao TO current_user WITH INHERIT FALSE, SET TRUE;
GRANT CREATE ON SCHEMA nexo TO nexo_autenticacao;
SET LOCAL ROLE nexo_autenticacao;

CREATE OR REPLACE FUNCTION nexo.iniciar_sessao(
  p_empresa text, p_utilizador text, p_resumo bytea, p_resumo_token bytea,
  p_duracao interval, p_inactividade interval
) RETURNS TABLE (resultado text, sessao_id uuid, empresa_id uuid, utilizador_id uuid, funcao text, expira_em timestamptz)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v record;
  v_sessao uuid;
  v_expira timestamptz;
BEGIN
  PERFORM nexo.validar_resumo_token(p_resumo_token);
  PERFORM nexo.validar_validade(p_duracao, interval '5 minutes', interval '24 hours');
  PERFORM nexo.validar_validade(p_inactividade, interval '5 minutes', p_duracao);
  SELECT u.empresa_id, u.id, u.funcao, u.estado, c.resumo INTO v
    FROM nexo.empresas e
    JOIN nexo.utilizadores u ON u.empresa_id = e.id
    JOIN nexo.credenciais_acesso c ON c.empresa_id = u.empresa_id AND c.utilizador_id = u.id
   WHERE e.codigo = nexo.normalizar_identificador(p_empresa)
     AND u.nome_utilizador = nexo.normalizar_identificador(p_utilizador);
  IF NOT FOUND OR p_resumo IS NULL OR v.resumo <> p_resumo THEN
    RETURN QUERY SELECT 'invalido'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  -- Só depois de o código estar certo se diz o estado; nunca se cria sessão sem a conta activa.
  IF v.estado <> 'activo' THEN
    RETURN QUERY SELECT CASE WHEN v.estado = 'pendente' THEN 'pendente' ELSE 'desactivado' END::text,
                        NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  v_expira := now() + p_duracao;
  INSERT INTO nexo.sessoes (empresa_id, utilizador_id, resumo_token, expira_em, inactividade)
  VALUES (v.empresa_id, v.id, p_resumo_token, v_expira, p_inactividade)
  RETURNING id INTO v_sessao;
  RETURN QUERY SELECT 'ok'::text, v_sessao, v.empresa_id, v.id, v.funcao, v_expira;
END
$$;

-- Serialização por conta (revisão de 11/10/2026). Confirmação, reenvio e correcção do e-mail de
-- uma conta correm um de cada vez, sempre com a MESMA ordem de bloqueios:
--   1. bloqueio consultivo da transacção para a conta (pg_advisory_xact_lock, chave 'nexo.activacao');
--   2. a linha de contactos_recuperacao da conta (FOR UPDATE), o que também serializa com as funções
--      com sessão da 0007 (definir_email_recuperacao bloqueia a mesma linha antes dos tokens);
--   3. só depois os tokens e a conta.
-- Depois de obter os bloqueios, cada função volta a ler tudo (cada instrução PL/pgSQL tem um
-- instantâneo novo em READ COMMITTED), por isso decide sempre sobre o estado já confirmado pelas
-- outras. O limite (5 links por hora) conta-se com o bloqueio na mão: pedidos simultâneos não o
-- ultrapassam. Os bloqueios duram até ao fim da transacção (a chamada à função, nesta API).
CREATE FUNCTION nexo.bloquear_activacao(p_empresa uuid, p_utilizador uuid) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('nexo.activacao'), pg_catalog.hashtext(p_utilizador::text));
  PERFORM 1 FROM nexo.contactos_recuperacao c
   WHERE c.empresa_id = p_empresa AND c.utilizador_id = p_utilizador
     FOR UPDATE;
END
$$;

-- Com o bloqueio da conta na mão: já foram emitidos 5 links de confirmação na última hora?
CREATE FUNCTION nexo.limite_activacao_atingido(p_empresa uuid, p_utilizador uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT count(*) >= 5 FROM nexo.tokens_email k
   WHERE k.empresa_id = p_empresa AND k.utilizador_id = p_utilizador AND k.finalidade = 'confirmar_email'
     AND k.criado_em > now() - interval '1 hour'
$$;

-- Com o bloqueio da conta na mão e o limite já verificado: invalida os links pendentes e emite um novo.
CREATE FUNCTION nexo.emitir_link_activacao(p_empresa uuid, p_utilizador uuid, p_email text, p_resumo_token bytea, p_validade interval)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  UPDATE nexo.tokens_email k SET invalidado_em = now()
   WHERE k.empresa_id = p_empresa AND k.utilizador_id = p_utilizador AND k.finalidade = 'confirmar_email'
     AND k.usado_em IS NULL AND k.invalidado_em IS NULL;
  INSERT INTO nexo.tokens_email (empresa_id, utilizador_id, finalidade, resumo_token, email, expira_em)
  VALUES (p_empresa, p_utilizador, 'confirmar_email', p_resumo_token, p_email, now() + p_validade);
END
$$;

-- Confirma o e-mail e, se a conta estiver pendente, activa-a (devolve 'activada'). Só aceita o token
-- se, DEPOIS do bloqueio, continuar por usar, válido e com o endereço que está pendente nesse momento:
-- uma correcção ou um reenvio que tenha ganho a corrida já o invalidou.
CREATE OR REPLACE FUNCTION nexo.confirmar_email(p_resumo_token bytea) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  a record;
  t record;
BEGIN
  PERFORM nexo.validar_resumo_token(p_resumo_token);
  -- A que conta pertence o token (sem decidir nada ainda).
  SELECT k.empresa_id, k.utilizador_id INTO a
    FROM nexo.tokens_email k
   WHERE k.resumo_token = p_resumo_token AND k.finalidade = 'confirmar_email';
  IF NOT FOUND THEN
    RETURN 'invalido';
  END IF;
  PERFORM nexo.bloquear_activacao(a.empresa_id, a.utilizador_id);
  -- Releitura com os bloqueios na mão.
  SELECT k.id, k.empresa_id, k.utilizador_id, k.email, u.estado INTO t
    FROM nexo.tokens_email k
    JOIN nexo.utilizadores u ON u.empresa_id = k.empresa_id AND u.id = k.utilizador_id
    JOIN nexo.contactos_recuperacao c ON c.empresa_id = k.empresa_id AND c.utilizador_id = k.utilizador_id
   WHERE k.resumo_token = p_resumo_token AND k.finalidade = 'confirmar_email'
     AND k.usado_em IS NULL AND k.invalidado_em IS NULL AND k.expira_em > now()
     AND u.estado IN ('activo', 'pendente') AND c.email_pendente = k.email
   FOR UPDATE OF k;
  IF NOT FOUND THEN
    RETURN 'invalido';
  END IF;
  UPDATE nexo.tokens_email SET usado_em = now() WHERE id = t.id;
  UPDATE nexo.contactos_recuperacao
     SET email = email_pendente, confirmado_em = now(), email_pendente = NULL, pendente_desde = NULL, actualizado_em = now()
   WHERE empresa_id = t.empresa_id AND utilizador_id = t.utilizador_id;
  INSERT INTO nexo.registo_auditoria (empresa_id, autor_id, origem, accao, entidade, entidade_id)
  VALUES (t.empresa_id, t.utilizador_id, 'api', 'utilizador.email_confirmado', 'utilizador', t.utilizador_id);
  IF t.estado = 'pendente' THEN
    UPDATE nexo.utilizadores SET estado = 'activo', actualizado_em = now()
     WHERE empresa_id = t.empresa_id AND id = t.utilizador_id AND estado = 'pendente';
    INSERT INTO nexo.registo_auditoria (empresa_id, autor_id, origem, accao, entidade, entidade_id, antes, depois)
    VALUES (t.empresa_id, t.utilizador_id, 'api', 'utilizador.activado', 'utilizador', t.utilizador_id,
            jsonb_build_object('estado', 'pendente'), jsonb_build_object('estado', 'activo'));
    RETURN 'activada';
  END IF;
  RETURN 'ok';
END
$$;

-- Reenviar a confirmação de um registo pendente. Sem código: a API responde sempre o mesmo e o
-- link só vai para o e-mail pendente nesse momento. Contas activas ou inexistentes, ou limite
-- atingido: nada (nem alterações).
CREATE FUNCTION nexo.reenviar_activacao(p_empresa text, p_utilizador text, p_resumo_token bytea, p_validade interval)
  RETURNS TABLE (email text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  a record;
  v_email text;
BEGIN
  PERFORM nexo.validar_resumo_token(p_resumo_token);
  PERFORM nexo.validar_validade(p_validade, interval '10 minutes', interval '7 days');
  SELECT u.empresa_id, u.id INTO a
    FROM nexo.empresas e JOIN nexo.utilizadores u ON u.empresa_id = e.id
   WHERE e.codigo = nexo.normalizar_identificador(p_empresa)
     AND u.nome_utilizador = nexo.normalizar_identificador(p_utilizador);
  IF NOT FOUND THEN
    RETURN;
  END IF;
  PERFORM nexo.bloquear_activacao(a.empresa_id, a.id);
  -- Releitura com os bloqueios na mão: a conta ainda está pendente? que endereço está pendente agora?
  SELECT c.email_pendente INTO v_email
    FROM nexo.utilizadores u
    JOIN nexo.contactos_recuperacao c ON c.empresa_id = u.empresa_id AND c.utilizador_id = u.id
   WHERE u.empresa_id = a.empresa_id AND u.id = a.id AND u.estado = 'pendente' AND c.email_pendente IS NOT NULL;
  IF NOT FOUND OR nexo.limite_activacao_atingido(a.empresa_id, a.id) THEN
    RETURN;
  END IF;
  PERFORM nexo.emitir_link_activacao(a.empresa_id, a.id, v_email, p_resumo_token, p_validade);
  RETURN QUERY SELECT v_email;
END
$$;

-- Corrigir o e-mail de um registo pendente (ex.: engano ao escrever). Exige o código secreto.
-- Tudo ou nada: o limite verifica-se ANTES de qualquer alteração; se for recusada, o endereço
-- anterior e os seus links ficam como estavam. Endereço, links e auditoria mudam juntos.
CREATE FUNCTION nexo.corrigir_email_activacao(p_empresa text, p_utilizador text, p_resumo bytea, p_email text, p_resumo_token bytea, p_validade interval)
  RETURNS TABLE (email text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  a record;
  v_email text := lower(btrim(p_email));
BEGIN
  PERFORM nexo.validar_resumo_token(p_resumo_token);
  PERFORM nexo.validar_validade(p_validade, interval '10 minutes', interval '7 days');
  IF p_resumo IS NULL OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254 THEN
    RETURN;
  END IF;
  SELECT u.empresa_id, u.id INTO a
    FROM nexo.empresas e JOIN nexo.utilizadores u ON u.empresa_id = e.id
   WHERE e.codigo = nexo.normalizar_identificador(p_empresa)
     AND u.nome_utilizador = nexo.normalizar_identificador(p_utilizador);
  IF NOT FOUND THEN
    RETURN;
  END IF;
  PERFORM nexo.bloquear_activacao(a.empresa_id, a.id);
  -- Releitura com os bloqueios na mão: pendente, código certo, limite por atingir.
  PERFORM 1
    FROM nexo.utilizadores u
    JOIN nexo.credenciais_acesso c ON c.empresa_id = u.empresa_id AND c.utilizador_id = u.id
   WHERE u.empresa_id = a.empresa_id AND u.id = a.id AND u.estado = 'pendente' AND c.resumo = p_resumo;
  IF NOT FOUND OR nexo.limite_activacao_atingido(a.empresa_id, a.id) THEN
    RETURN;
  END IF;
  UPDATE nexo.contactos_recuperacao
     SET email_pendente = v_email, pendente_desde = now(), actualizado_em = now()
   WHERE empresa_id = a.empresa_id AND utilizador_id = a.id;
  PERFORM nexo.emitir_link_activacao(a.empresa_id, a.id, v_email, p_resumo_token, p_validade);
  INSERT INTO nexo.registo_auditoria (empresa_id, autor_id, origem, accao, entidade, entidade_id)
  VALUES (a.empresa_id, a.id, 'api', 'utilizador.email_alterado', 'utilizador', a.id);
  RETURN QUERY SELECT v_email;
END
$$;

REVOKE ALL ON FUNCTION nexo.bloquear_activacao(uuid, uuid),
  nexo.limite_activacao_atingido(uuid, uuid),
  nexo.emitir_link_activacao(uuid, uuid, text, bytea, interval),
  nexo.reenviar_activacao(text, text, bytea, interval),
  nexo.corrigir_email_activacao(text, text, bytea, text, bytea, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexo.reenviar_activacao(text, text, bytea, interval),
  nexo.corrigir_email_activacao(text, text, bytea, text, bytea, interval) TO nexo_api;

RESET ROLE;
REVOKE CREATE ON SCHEMA nexo FROM nexo_autenticacao;
REVOKE nexo_autenticacao FROM current_user;

-- 3. Verificações: nada temporário ficou ----------------------------------------------------------
DO $$
BEGIN
  IF pg_catalog.has_schema_privilege('nexo_autenticacao', 'nexo', 'CREATE') THEN
    RAISE EXCEPTION 'nexo_autenticacao ficou com CREATE no esquema nexo';
  END IF;
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user)
     AND pg_catalog.pg_has_role(current_user, 'nexo_autenticacao', 'SET') THEN
    RAISE EXCEPTION 'o administrador ficou com SET ROLE sobre nexo_autenticacao';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc f
              WHERE f.pronamespace = 'nexo'::regnamespace
                AND f.proname IN ('iniciar_sessao', 'confirmar_email', 'bloquear_activacao', 'limite_activacao_atingido',
                                   'emitir_link_activacao', 'reenviar_activacao', 'corrigir_email_activacao')
                AND (pg_catalog.pg_get_userbyid(f.proowner) <> 'nexo_autenticacao' OR f.proacl IS NULL
                     OR EXISTS (SELECT 1 FROM aclexplode(f.proacl) x WHERE x.grantee = 0))) THEN
    RAISE EXCEPTION 'funções de identidade com dono ou privilégios inesperados';
  END IF;
END
$$;
