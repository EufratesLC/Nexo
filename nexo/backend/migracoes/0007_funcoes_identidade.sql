-- nexo:executar-como administrador
--
-- 0007 — Funções de identidade (Etapa 3). Todas SECURITY DEFINER com dono nexo_autenticacao
-- (transferido pelo procedimento de R5, com CREATE temporário), search_path fixo, nomes
-- qualificados e resposta mínima.
--
-- Porque existem: o login, a validação da sessão, o registo e a recuperação acontecem ANTES de
-- haver contexto de empresa, e todas as tabelas têm FORCE RLS. Em vez de dar leitura genérica de
-- credenciais ou de desligar o RLS, cada função faz uma única coisa e devolve o mínimo:
--
--   função                       quem executa   o que devolve
--   parametros_acesso            nexo_api       parâmetros e sal do scrypt (nunca o resumo)
--   iniciar_sessao               nexo_api       resultado (ok/invalido/desactivado) e ids
--   validar_sessao               nexo_api       ids, função, nome, filiais permitidas
--   terminar_sessao              nexo_api       se terminou
--   registar_empresa             nexo_api       ids da empresa, filial e proprietário
--   confirmar_email              nexo_api       resultado
--   pedir_recuperacao            nexo_api       e-mail confirmado (ou nada)
--   concluir_recuperacao         nexo_api       resultado e e-mail para o aviso
--   parametros_acesso_proprios   operador/gestão parâmetros e sal da própria conta
--   alterar_codigo_proprio       operador/gestão se o código actual estava certo
--   definir_codigo               gestão (proprietário)  definido/redefinido
--   revogar_sessoes              gestão (proprietário)  número de sessões revogadas
--   definir_email_recuperacao    gestão (proprietário)  se o código actual estava certo
--   reenviar_confirmacao_email   gestão (proprietário)  e-mail pendente (ou nada)
--   suporte_emitir_recuperacao   nexo_proprietario (só o administrador das migrações)
--
-- O resumo do código secreto NUNCA sai da base: a API calcula o resumo do código introduzido
-- com os parâmetros e o sal, e a função compara-o. Os tokens (sessão, e-mail) chegam como SHA-256.
-- As funções com contexto confirmam a conta e a função NA BASE, sem confiar só no contexto.

-- Normalização dos identificadores do login (código da empresa e nome de utilizador).
CREATE FUNCTION nexo.normalizar_identificador(p text) RETURNS text
  LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $$ SELECT lower(btrim(p)) $$;

-- Conta da transacção actual, confirmada na base (activa). Usada pelas funções com contexto.
CREATE FUNCTION nexo.conta_do_contexto(OUT empresa_id uuid, OUT utilizador_id uuid, OUT funcao text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  SELECT u.empresa_id, u.id, u.funcao INTO empresa_id, utilizador_id, funcao
    FROM nexo.utilizadores u
   WHERE u.empresa_id = nexo.empresa_actual() AND u.id = nexo.utilizador_actual() AND u.estado = 'activo';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sem conta activa no contexto' USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;

CREATE FUNCTION nexo.validar_parametros_codigo(p_parametros text, p_sal bytea, p_resumo bytea) RETURNS void
  LANGUAGE plpgsql IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_parametros IS NULL OR p_parametros !~ '^ln=[0-9]{1,2},r=[0-9]{1,2},p=[0-9]{1,2}$'
     OR octet_length(p_sal) IS DISTINCT FROM 16 OR octet_length(p_resumo) IS DISTINCT FROM 32 THEN
    RAISE EXCEPTION 'resumo do código inválido' USING ERRCODE = 'invalid_parameter_value';
  END IF;
END
$$;

CREATE FUNCTION nexo.validar_resumo_token(p bytea) RETURNS void
  LANGUAGE plpgsql IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF octet_length(p) IS DISTINCT FROM 32 THEN
    RAISE EXCEPTION 'resumo de token inválido' USING ERRCODE = 'invalid_parameter_value';
  END IF;
END
$$;

CREATE FUNCTION nexo.validar_validade(p interval, p_min interval, p_max interval) RETURNS void
  LANGUAGE plpgsql IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p IS NULL OR p < p_min OR p > p_max THEN
    RAISE EXCEPTION 'validade fora dos limites (% a %)', p_min, p_max USING ERRCODE = 'invalid_parameter_value';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Sem contexto (nexo_api)
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION nexo.parametros_acesso(p_empresa text, p_utilizador text)
  RETURNS TABLE (parametros text, sal bytea)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT c.parametros, c.sal
    FROM nexo.empresas e
    JOIN nexo.utilizadores u ON u.empresa_id = e.id
    JOIN nexo.credenciais_acesso c ON c.empresa_id = u.empresa_id AND c.utilizador_id = u.id
   WHERE e.codigo = nexo.normalizar_identificador(p_empresa)
     AND u.nome_utilizador = nexo.normalizar_identificador(p_utilizador);
END
$$;

CREATE FUNCTION nexo.iniciar_sessao(
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
  -- Só depois de o código estar certo se diz que a conta está desactivada.
  IF v.estado <> 'activo' THEN
    RETURN QUERY SELECT 'desactivado'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  v_expira := now() + p_duracao;
  INSERT INTO nexo.sessoes (empresa_id, utilizador_id, resumo_token, expira_em, inactividade)
  VALUES (v.empresa_id, v.id, p_resumo_token, v_expira, p_inactividade)
  RETURNING id INTO v_sessao;
  RETURN QUERY SELECT 'ok'::text, v_sessao, v.empresa_id, v.id, v.funcao, v_expira;
END
$$;

CREATE FUNCTION nexo.validar_sessao(p_resumo_token bytea)
  RETURNS TABLE (sessao_id uuid, empresa_id uuid, utilizador_id uuid, funcao text, nome text,
                 nome_utilizador text, filiais uuid[], expira_em timestamptz)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  s record;
BEGIN
  PERFORM nexo.validar_resumo_token(p_resumo_token);
  SELECT x.id, x.empresa_id, x.utilizador_id, x.expira_em, x.ultimo_uso_em, u.funcao, u.nome, u.nome_utilizador INTO s
    FROM nexo.sessoes x
    JOIN nexo.utilizadores u ON u.empresa_id = x.empresa_id AND u.id = x.utilizador_id
   WHERE x.resumo_token = p_resumo_token
     AND x.revogada_em IS NULL
     AND x.expira_em > now()
     AND x.ultimo_uso_em + x.inactividade > now()
     AND u.estado = 'activo';
  IF NOT FOUND THEN
    RETURN;
  END IF;
  -- Marca o uso no máximo uma vez por minuto (menos escritas; a inactividade conta-se ao minuto).
  IF s.ultimo_uso_em < now() - interval '1 minute' THEN
    UPDATE nexo.sessoes SET ultimo_uso_em = now() WHERE id = s.id;
  END IF;
  RETURN QUERY
  SELECT s.id, s.empresa_id, s.utilizador_id, s.funcao, s.nome, s.nome_utilizador,
         CASE WHEN s.funcao = 'proprietario'
              THEN ARRAY(SELECT f.id FROM nexo.filiais f WHERE f.empresa_id = s.empresa_id ORDER BY f.codigo)
              ELSE ARRAY(SELECT uf.filial_id FROM nexo.utilizador_filiais uf
                          JOIN nexo.filiais f ON f.empresa_id = uf.empresa_id AND f.id = uf.filial_id
                         WHERE uf.empresa_id = s.empresa_id AND uf.utilizador_id = s.utilizador_id ORDER BY f.codigo)
         END,
         s.expira_em;
END
$$;

CREATE FUNCTION nexo.terminar_sessao(p_resumo_token bytea) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM nexo.validar_resumo_token(p_resumo_token);
  UPDATE nexo.sessoes SET revogada_em = now(), motivo_revogacao = 'saida'
   WHERE resumo_token = p_resumo_token AND revogada_em IS NULL;
  RETURN FOUND;
END
$$;

-- Registo público (decisão de 08/10/2026): empresa, filial F01, proprietário, código secreto,
-- e-mail de recuperação por confirmar e auditoria, numa única instrução (tudo ou nada).
CREATE FUNCTION nexo.registar_empresa(
  p_codigo text, p_nome_empresa text, p_nuit text, p_telefone text,
  p_nome text, p_nome_utilizador text, p_email text,
  p_parametros text, p_sal bytea, p_resumo bytea,
  p_resumo_token_email bytea, p_validade_email interval
) RETURNS TABLE (empresa_id uuid, filial_id uuid, utilizador_id uuid)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_empresa uuid;
  v_filial uuid;
  v_utilizador uuid;
  v_email text := lower(btrim(p_email));
BEGIN
  PERFORM nexo.validar_parametros_codigo(p_parametros, p_sal, p_resumo);
  PERFORM nexo.validar_resumo_token(p_resumo_token_email);
  PERFORM nexo.validar_validade(p_validade_email, interval '10 minutes', interval '7 days');
  INSERT INTO nexo.empresas (codigo, nome, nuit, telefone)
  VALUES (nexo.normalizar_identificador(p_codigo), btrim(p_nome_empresa), nullif(btrim(p_nuit), ''), nullif(btrim(p_telefone), ''))
  RETURNING id INTO v_empresa;
  INSERT INTO nexo.filiais (empresa_id, codigo, nome) VALUES (v_empresa, 'F01', 'Filial principal')
  RETURNING id INTO v_filial;
  INSERT INTO nexo.utilizadores (empresa_id, nome_utilizador, nome, funcao)
  VALUES (v_empresa, nexo.normalizar_identificador(p_nome_utilizador), btrim(p_nome), 'proprietario')
  RETURNING id INTO v_utilizador;
  INSERT INTO nexo.credenciais_acesso (empresa_id, utilizador_id, algoritmo, parametros, sal, resumo, origem, definido_por)
  VALUES (v_empresa, v_utilizador, 'scrypt', p_parametros, p_sal, p_resumo, 'registo', v_utilizador);
  INSERT INTO nexo.contactos_recuperacao (empresa_id, utilizador_id, email_pendente, pendente_desde)
  VALUES (v_empresa, v_utilizador, v_email, now());
  INSERT INTO nexo.tokens_email (empresa_id, utilizador_id, finalidade, resumo_token, email, expira_em)
  VALUES (v_empresa, v_utilizador, 'confirmar_email', p_resumo_token_email, v_email, now() + p_validade_email);
  INSERT INTO nexo.registo_auditoria (empresa_id, autor_id, origem, accao, entidade, entidade_id, depois)
  VALUES (v_empresa, v_utilizador, 'api', 'empresa.criada', 'empresa', v_empresa,
          jsonb_build_object('codigo', nexo.normalizar_identificador(p_codigo), 'nome', btrim(p_nome_empresa), 'filial', 'F01')),
         (v_empresa, v_utilizador, 'api', 'utilizador.criado', 'utilizador', v_utilizador,
          jsonb_build_object('nome_utilizador', nexo.normalizar_identificador(p_nome_utilizador), 'funcao', 'proprietario'));
  RETURN QUERY SELECT v_empresa, v_filial, v_utilizador;
END
$$;

CREATE FUNCTION nexo.confirmar_email(p_resumo_token bytea) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  t record;
BEGIN
  PERFORM nexo.validar_resumo_token(p_resumo_token);
  SELECT k.id, k.empresa_id, k.utilizador_id, k.email INTO t
    FROM nexo.tokens_email k
    JOIN nexo.utilizadores u ON u.empresa_id = k.empresa_id AND u.id = k.utilizador_id
    JOIN nexo.contactos_recuperacao c ON c.empresa_id = k.empresa_id AND c.utilizador_id = k.utilizador_id
   WHERE k.resumo_token = p_resumo_token AND k.finalidade = 'confirmar_email'
     AND k.usado_em IS NULL AND k.invalidado_em IS NULL AND k.expira_em > now()
     AND u.estado = 'activo' AND c.email_pendente = k.email
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
  RETURN 'ok';
END
$$;

-- "Esqueci o código": só proprietários activos com e-mail CONFIRMADO. Devolve o e-mail para onde
-- enviar, ou nada. A API responde sempre o mesmo, exista ou não a conta.
CREATE FUNCTION nexo.pedir_recuperacao(p_empresa text, p_utilizador text, p_resumo_token bytea, p_validade interval)
  RETURNS TABLE (email text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v record;
BEGIN
  PERFORM nexo.validar_resumo_token(p_resumo_token);
  PERFORM nexo.validar_validade(p_validade, interval '5 minutes', interval '2 hours');
  SELECT u.empresa_id, u.id, c.email AS email_confirmado INTO v
    FROM nexo.empresas e
    JOIN nexo.utilizadores u ON u.empresa_id = e.id
    JOIN nexo.contactos_recuperacao c ON c.empresa_id = u.empresa_id AND c.utilizador_id = u.id
   WHERE e.codigo = nexo.normalizar_identificador(p_empresa)
     AND u.nome_utilizador = nexo.normalizar_identificador(p_utilizador)
     AND u.funcao = 'proprietario' AND u.estado = 'activo' AND c.email IS NOT NULL;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  -- Só o link mais recente vale.
  UPDATE nexo.tokens_email SET invalidado_em = now()
   WHERE empresa_id = v.empresa_id AND utilizador_id = v.id AND finalidade = 'recuperar_acesso'
     AND usado_em IS NULL AND invalidado_em IS NULL;
  INSERT INTO nexo.tokens_email (empresa_id, utilizador_id, finalidade, resumo_token, email, expira_em)
  VALUES (v.empresa_id, v.id, 'recuperar_acesso', p_resumo_token, v.email_confirmado, now() + p_validade);
  INSERT INTO nexo.registo_auditoria (empresa_id, autor_id, origem, accao, entidade, entidade_id)
  VALUES (v.empresa_id, v.id, 'recuperacao', 'utilizador.recuperacao_pedida', 'utilizador', v.id);
  RETURN QUERY SELECT v.email_confirmado;
END
$$;

-- Conclui a recuperação: define o novo código (nunca mostra o antigo), gasta o token, invalida os
-- outros links e revoga TODAS as sessões da conta.
CREATE FUNCTION nexo.concluir_recuperacao(p_resumo_token bytea, p_parametros text, p_sal bytea, p_resumo bytea)
  RETURNS TABLE (resultado text, email text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  t record;
BEGIN
  PERFORM nexo.validar_resumo_token(p_resumo_token);
  PERFORM nexo.validar_parametros_codigo(p_parametros, p_sal, p_resumo);
  SELECT k.id, k.empresa_id, k.utilizador_id, k.origem, c.email AS email_confirmado INTO t
    FROM nexo.tokens_email k
    JOIN nexo.utilizadores u ON u.empresa_id = k.empresa_id AND u.id = k.utilizador_id
    LEFT JOIN nexo.contactos_recuperacao c ON c.empresa_id = k.empresa_id AND c.utilizador_id = k.utilizador_id
   WHERE k.resumo_token = p_resumo_token AND k.finalidade = 'recuperar_acesso'
     AND k.usado_em IS NULL AND k.invalidado_em IS NULL AND k.expira_em > now()
     AND u.estado = 'activo' AND u.funcao = 'proprietario'
     -- Um link por e-mail só vale enquanto esse e-mail continuar a ser o confirmado.
     AND (k.origem = 'suporte' OR k.email = c.email)
   FOR UPDATE OF k;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalido'::text, NULL::text;
    RETURN;
  END IF;
  UPDATE nexo.tokens_email SET usado_em = now() WHERE id = t.id;
  UPDATE nexo.tokens_email SET invalidado_em = now()
   WHERE empresa_id = t.empresa_id AND utilizador_id = t.utilizador_id AND finalidade = 'recuperar_acesso'
     AND usado_em IS NULL AND invalidado_em IS NULL;
  UPDATE nexo.credenciais_acesso
     SET parametros = p_parametros, sal = p_sal, resumo = p_resumo, versao = versao + 1,
         origem = CASE WHEN t.origem = 'suporte' THEN 'suporte' ELSE 'recuperacao' END,
         definido_em = now(), definido_por = t.utilizador_id
   WHERE empresa_id = t.empresa_id AND utilizador_id = t.utilizador_id;
  UPDATE nexo.sessoes SET revogada_em = now(), motivo_revogacao = 'codigo_recuperado'
   WHERE empresa_id = t.empresa_id AND utilizador_id = t.utilizador_id AND revogada_em IS NULL;
  INSERT INTO nexo.registo_auditoria (empresa_id, autor_id, origem, accao, entidade, entidade_id, depois)
  VALUES (t.empresa_id, t.utilizador_id, 'recuperacao', 'utilizador.codigo_recuperado', 'utilizador', t.utilizador_id,
          jsonb_build_object('via', t.origem));
  RETURN QUERY SELECT 'ok'::text, t.email_confirmado;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Com contexto (sessão válida; papel de execução)
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION nexo.parametros_acesso_proprios() RETURNS TABLE (parametros text, sal bytea)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v record;
BEGIN
  SELECT * INTO v FROM nexo.conta_do_contexto();
  RETURN QUERY SELECT c.parametros, c.sal FROM nexo.credenciais_acesso c
                WHERE c.empresa_id = v.empresa_id AND c.utilizador_id = v.utilizador_id;
END
$$;

-- O próprio muda o seu código (exige o actual). As outras sessões da conta são revogadas.
CREATE FUNCTION nexo.alterar_codigo_proprio(p_sessao uuid, p_resumo_actual bytea, p_parametros text, p_sal bytea, p_resumo_novo bytea)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v record;
BEGIN
  PERFORM nexo.validar_parametros_codigo(p_parametros, p_sal, p_resumo_novo);
  SELECT * INTO v FROM nexo.conta_do_contexto();
  UPDATE nexo.credenciais_acesso
     SET parametros = p_parametros, sal = p_sal, resumo = p_resumo_novo, versao = versao + 1,
         origem = 'proprio', definido_em = now(), definido_por = v.utilizador_id
   WHERE empresa_id = v.empresa_id AND utilizador_id = v.utilizador_id AND resumo = p_resumo_actual;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  UPDATE nexo.sessoes SET revogada_em = now(), motivo_revogacao = 'codigo_alterado'
   WHERE empresa_id = v.empresa_id AND utilizador_id = v.utilizador_id AND revogada_em IS NULL
     AND id IS DISTINCT FROM p_sessao;
  INSERT INTO nexo.registo_auditoria (empresa_id, autor_id, origem, accao, entidade, entidade_id)
  VALUES (v.empresa_id, v.utilizador_id, 'api', 'utilizador.codigo_alterado', 'utilizador', v.utilizador_id);
  RETURN true;
END
$$;

-- O proprietário define o código inicial de uma conta nova, ou redefine o de um gestor/operador
-- (H-02). Nunca o seu (usa alterar_codigo_proprio) nem o de outro proprietário (que recupera pelo
-- e-mail ou pelo suporte). Uma redefinição revoga as sessões dessa conta.
CREATE FUNCTION nexo.definir_codigo(p_utilizador uuid, p_parametros text, p_sal bytea, p_resumo bytea) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v record;
  alvo record;
BEGIN
  PERFORM nexo.validar_parametros_codigo(p_parametros, p_sal, p_resumo);
  SELECT * INTO v FROM nexo.conta_do_contexto();
  IF v.funcao <> 'proprietario' THEN
    RAISE EXCEPTION 'só o proprietário define códigos de acesso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_utilizador = v.utilizador_id THEN
    RAISE EXCEPTION 'use a alteração do próprio código' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT u.id, u.funcao, (c.utilizador_id IS NOT NULL) AS tem_codigo INTO alvo
    FROM nexo.utilizadores u
    LEFT JOIN nexo.credenciais_acesso c ON c.empresa_id = u.empresa_id AND c.utilizador_id = u.id
   WHERE u.empresa_id = v.empresa_id AND u.id = p_utilizador;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'utilizador inexistente nesta empresa' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT alvo.tem_codigo THEN
    INSERT INTO nexo.credenciais_acesso (empresa_id, utilizador_id, algoritmo, parametros, sal, resumo, origem, definido_por)
    VALUES (v.empresa_id, alvo.id, 'scrypt', p_parametros, p_sal, p_resumo, 'proprietario', v.utilizador_id);
    INSERT INTO nexo.registo_auditoria (empresa_id, autor_id, origem, accao, entidade, entidade_id)
    VALUES (v.empresa_id, v.utilizador_id, 'api', 'utilizador.codigo_definido', 'utilizador', alvo.id);
    RETURN 'definido';
  END IF;
  IF alvo.funcao = 'proprietario' THEN
    RAISE EXCEPTION 'o código de um proprietário recupera-se pelo e-mail confirmado ou pelo suporte'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE nexo.credenciais_acesso
     SET parametros = p_parametros, sal = p_sal, resumo = p_resumo, versao = versao + 1,
         origem = 'proprietario', definido_em = now(), definido_por = v.utilizador_id
   WHERE empresa_id = v.empresa_id AND utilizador_id = alvo.id;
  UPDATE nexo.sessoes SET revogada_em = now(), motivo_revogacao = 'codigo_redefinido'
   WHERE empresa_id = v.empresa_id AND utilizador_id = alvo.id AND revogada_em IS NULL;
  INSERT INTO nexo.registo_auditoria (empresa_id, autor_id, origem, accao, entidade, entidade_id)
  VALUES (v.empresa_id, v.utilizador_id, 'api', 'utilizador.codigo_redefinido', 'utilizador', alvo.id);
  RETURN 'redefinido';
END
$$;

-- Usada na desactivação (a validação da sessão também exige a conta activa; revogar evita que as
-- sessões antigas voltem a valer se a conta for reactivada).
CREATE FUNCTION nexo.revogar_sessoes(p_utilizador uuid, p_motivo text) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v record;
  n integer;
BEGIN
  SELECT * INTO v FROM nexo.conta_do_contexto();
  IF v.funcao <> 'proprietario' OR p_utilizador = v.utilizador_id THEN
    RAISE EXCEPTION 'só o proprietário revoga sessões de outra conta' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_motivo IS DISTINCT FROM 'desactivacao' THEN
    RAISE EXCEPTION 'motivo não previsto' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE nexo.sessoes SET revogada_em = now(), motivo_revogacao = p_motivo
   WHERE empresa_id = v.empresa_id AND utilizador_id = p_utilizador AND revogada_em IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

-- O proprietário regista (ou muda) o seu e-mail de recuperação: exige o código actual. O e-mail
-- fica pendente até ser confirmado pelo link; o anterior confirmado continua a valer até lá.
CREATE FUNCTION nexo.definir_email_recuperacao(p_resumo_actual bytea, p_email text, p_resumo_token bytea, p_validade interval)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v record;
  v_email text := lower(btrim(p_email));
BEGIN
  PERFORM nexo.validar_resumo_token(p_resumo_token);
  PERFORM nexo.validar_validade(p_validade, interval '10 minutes', interval '7 days');
  SELECT * INTO v FROM nexo.conta_do_contexto();
  IF v.funcao <> 'proprietario' THEN
    RAISE EXCEPTION 'só proprietários têm e-mail de recuperação' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM nexo.credenciais_acesso c
                  WHERE c.empresa_id = v.empresa_id AND c.utilizador_id = v.utilizador_id AND c.resumo = p_resumo_actual) THEN
    RETURN false;
  END IF;
  INSERT INTO nexo.contactos_recuperacao (empresa_id, utilizador_id, email_pendente, pendente_desde)
  VALUES (v.empresa_id, v.utilizador_id, v_email, now())
  ON CONFLICT ON CONSTRAINT contactos_recuperacao_pkey
  DO UPDATE SET email_pendente = excluded.email_pendente, pendente_desde = now(), actualizado_em = now();
  UPDATE nexo.tokens_email SET invalidado_em = now()
   WHERE empresa_id = v.empresa_id AND utilizador_id = v.utilizador_id AND finalidade = 'confirmar_email'
     AND usado_em IS NULL AND invalidado_em IS NULL;
  INSERT INTO nexo.tokens_email (empresa_id, utilizador_id, finalidade, resumo_token, email, expira_em)
  VALUES (v.empresa_id, v.utilizador_id, 'confirmar_email', p_resumo_token, v_email, now() + p_validade);
  INSERT INTO nexo.registo_auditoria (empresa_id, autor_id, origem, accao, entidade, entidade_id)
  VALUES (v.empresa_id, v.utilizador_id, 'api', 'utilizador.email_alterado', 'utilizador', v.utilizador_id);
  RETURN true;
END
$$;

CREATE FUNCTION nexo.reenviar_confirmacao_email(p_resumo_token bytea, p_validade interval) RETURNS TABLE (email text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v record;
  v_pendente text;
BEGIN
  PERFORM nexo.validar_resumo_token(p_resumo_token);
  PERFORM nexo.validar_validade(p_validade, interval '10 minutes', interval '7 days');
  SELECT * INTO v FROM nexo.conta_do_contexto();
  SELECT c.email_pendente INTO v_pendente FROM nexo.contactos_recuperacao c
   WHERE c.empresa_id = v.empresa_id AND c.utilizador_id = v.utilizador_id AND c.email_pendente IS NOT NULL;
  IF v.funcao <> 'proprietario' OR v_pendente IS NULL THEN
    RETURN;
  END IF;
  UPDATE nexo.tokens_email SET invalidado_em = now()
   WHERE empresa_id = v.empresa_id AND utilizador_id = v.utilizador_id AND finalidade = 'confirmar_email'
     AND usado_em IS NULL AND invalidado_em IS NULL;
  INSERT INTO nexo.tokens_email (empresa_id, utilizador_id, finalidade, resumo_token, email, expira_em)
  VALUES (v.empresa_id, v.utilizador_id, 'confirmar_email', p_resumo_token, v_pendente, now() + p_validade);
  RETURN QUERY SELECT v_pendente;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Suporte (fora dos pedidos da API): só nexo_proprietario, que só o administrador das migrações
-- pode assumir. Emite um link de recuperação de utilização única para um proprietário que perdeu
-- também o e-mail, depois de o suporte confirmar a identidade e o vínculo ao negócio.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION nexo.suporte_emitir_recuperacao(p_empresa text, p_utilizador text, p_resumo_token bytea, p_validade interval, p_motivo text)
  RETURNS TABLE (utilizador_id uuid, nome text, empresa text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v record;
BEGIN
  PERFORM nexo.validar_resumo_token(p_resumo_token);
  PERFORM nexo.validar_validade(p_validade, interval '10 minutes', interval '48 hours');
  IF p_motivo IS NULL OR length(btrim(p_motivo)) < 10 THEN
    RAISE EXCEPTION 'indique o motivo e como foi confirmada a identidade (10+ caracteres)' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT u.empresa_id, u.id, u.nome, e.nome AS nome_empresa INTO v
    FROM nexo.empresas e JOIN nexo.utilizadores u ON u.empresa_id = e.id
   WHERE e.codigo = nexo.normalizar_identificador(p_empresa)
     AND u.nome_utilizador = nexo.normalizar_identificador(p_utilizador)
     AND u.funcao = 'proprietario' AND u.estado = 'activo';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'não existe proprietário activo com esse código de empresa e nome de utilizador' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE nexo.tokens_email k SET invalidado_em = now()
   WHERE k.empresa_id = v.empresa_id AND k.utilizador_id = v.id AND k.finalidade = 'recuperar_acesso'
     AND k.usado_em IS NULL AND k.invalidado_em IS NULL;
  INSERT INTO nexo.tokens_email (empresa_id, utilizador_id, finalidade, origem, resumo_token, expira_em)
  VALUES (v.empresa_id, v.id, 'recuperar_acesso', 'suporte', p_resumo_token, now() + p_validade);
  INSERT INTO nexo.registo_auditoria (empresa_id, autor_id, origem, accao, entidade, entidade_id, depois)
  VALUES (v.empresa_id, NULL, 'suporte', 'utilizador.recuperacao_suporte', 'utilizador', v.id,
          jsonb_build_object('motivo', btrim(p_motivo), 'executado_por', session_user));
  RETURN QUERY SELECT v.id, v.nome, v.nome_empresa;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Privilégios ANTES da transferência de dono (depois dela, um REVOKE do administrador seria
-- ignorado só com um aviso). Os auxiliares sem SECURITY DEFINER ficam só para nexo_autenticacao.
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  nexo.normalizar_identificador(text),
  nexo.conta_do_contexto(),
  nexo.validar_parametros_codigo(text, bytea, bytea),
  nexo.validar_resumo_token(bytea),
  nexo.validar_validade(interval, interval, interval),
  nexo.parametros_acesso(text, text),
  nexo.iniciar_sessao(text, text, bytea, bytea, interval, interval),
  nexo.validar_sessao(bytea),
  nexo.terminar_sessao(bytea),
  nexo.registar_empresa(text, text, text, text, text, text, text, text, bytea, bytea, bytea, interval),
  nexo.confirmar_email(bytea),
  nexo.pedir_recuperacao(text, text, bytea, interval),
  nexo.concluir_recuperacao(bytea, text, bytea, bytea),
  nexo.parametros_acesso_proprios(),
  nexo.alterar_codigo_proprio(uuid, bytea, text, bytea, bytea),
  nexo.definir_codigo(uuid, text, bytea, bytea),
  nexo.revogar_sessoes(uuid, text),
  nexo.definir_email_recuperacao(bytea, text, bytea, interval),
  nexo.reenviar_confirmacao_email(bytea, interval),
  nexo.suporte_emitir_recuperacao(text, text, bytea, interval, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  nexo.normalizar_identificador(text),
  nexo.conta_do_contexto(),
  nexo.validar_parametros_codigo(text, bytea, bytea),
  nexo.validar_resumo_token(bytea),
  nexo.validar_validade(interval, interval, interval)
TO nexo_autenticacao;

GRANT EXECUTE ON FUNCTION
  nexo.parametros_acesso(text, text),
  nexo.iniciar_sessao(text, text, bytea, bytea, interval, interval),
  nexo.validar_sessao(bytea),
  nexo.terminar_sessao(bytea),
  nexo.registar_empresa(text, text, text, text, text, text, text, text, bytea, bytea, bytea, interval),
  nexo.confirmar_email(bytea),
  nexo.pedir_recuperacao(text, text, bytea, interval),
  nexo.concluir_recuperacao(bytea, text, bytea, bytea)
TO nexo_api;

GRANT EXECUTE ON FUNCTION
  nexo.parametros_acesso_proprios(),
  nexo.alterar_codigo_proprio(uuid, bytea, text, bytea, bytea)
TO nexo_operador, nexo_gestao;

GRANT EXECUTE ON FUNCTION
  nexo.definir_codigo(uuid, text, bytea, bytea),
  nexo.revogar_sessoes(uuid, text),
  nexo.definir_email_recuperacao(bytea, text, bytea, interval),
  nexo.reenviar_confirmacao_email(bytea, interval)
TO nexo_gestao;

GRANT EXECUTE ON FUNCTION nexo.suporte_emitir_recuperacao(text, text, bytea, interval, text) TO nexo_proprietario;

-- Transferência de dono (R5: CREATE temporário → ALTER … OWNER → REVOKE CREATE; verificações no fim).
DO $$
DECLARE
  f regprocedure;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'nexo.normalizar_identificador(text)',
    'nexo.conta_do_contexto()',
    'nexo.validar_parametros_codigo(text, bytea, bytea)',
    'nexo.validar_resumo_token(bytea)',
    'nexo.validar_validade(interval, interval, interval)',
    'nexo.parametros_acesso(text, text)',
    'nexo.iniciar_sessao(text, text, bytea, bytea, interval, interval)',
    'nexo.validar_sessao(bytea)',
    'nexo.terminar_sessao(bytea)',
    'nexo.registar_empresa(text, text, text, text, text, text, text, text, bytea, bytea, bytea, interval)',
    'nexo.confirmar_email(bytea)',
    'nexo.pedir_recuperacao(text, text, bytea, interval)',
    'nexo.concluir_recuperacao(bytea, text, bytea, bytea)',
    'nexo.parametros_acesso_proprios()',
    'nexo.alterar_codigo_proprio(uuid, bytea, text, bytea, bytea)',
    'nexo.definir_codigo(uuid, text, bytea, bytea)',
    'nexo.revogar_sessoes(uuid, text)',
    'nexo.definir_email_recuperacao(bytea, text, bytea, interval)',
    'nexo.reenviar_confirmacao_email(bytea, interval)',
    'nexo.suporte_emitir_recuperacao(text, text, bytea, interval, text)'
  ]::regprocedure[] LOOP
    CALL nexo_controlo.transferir_dono_funcao(f, 'nexo_autenticacao');
  END LOOP;
END
$$;
