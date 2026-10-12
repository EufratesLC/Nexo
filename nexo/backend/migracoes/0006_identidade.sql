-- nexo:executar-como nexo_proprietario
--
-- 0006 — Identidade e administração da empresa (Etapa 3; H-02 aprovada em 08/10/2026).
--
-- - Contas por empresa: nome de utilizador único DENTRO da empresa; o mesmo nome pode existir
--   noutra empresa. A empresa escolhe-se pelo seu código (não é segredo; não concede acesso).
-- - Códigos secretos só como resumo scrypt, calculado na API. O resumo guardado nunca sai da
--   base: a comparação faz-se nas funções de nexo_autenticacao (0007).
-- - Sessões, credenciais, contactos e tokens de e-mail: NENHUM papel de execução tem privilégios
--   nessas tabelas; só nexo_autenticacao, através das suas funções.
-- - Registo de auditoria imutável (trigger + sem UPDATE/DELETE para ninguém).
-- - Tudo com ENABLE + FORCE RLS, empresa_id e chaves compostas (H-01).

-- ---------------------------------------------------------------------------------------------
-- 1. Empresa: código, telefone e endereço
-- ---------------------------------------------------------------------------------------------
ALTER TABLE nexo.empresas ADD COLUMN codigo text;
ALTER TABLE nexo.empresas ADD COLUMN telefone text CHECK (telefone ~ '^\+?[0-9 ]{7,20}$');
ALTER TABLE nexo.empresas ADD COLUMN endereco text CHECK (length(endereco) BETWEEN 1 AND 300);

-- Empresas que já existam (só dados de teste antigos) recebem um código derivado do identificador.
-- O dono está sujeito ao FORCE e não tem políticas: o FORCE sai só dentro desta transacção.
ALTER TABLE nexo.empresas NO FORCE ROW LEVEL SECURITY;
UPDATE nexo.empresas SET codigo = 'empresa-' || substr(replace(id::text, '-', ''), 1, 12) WHERE codigo IS NULL;
ALTER TABLE nexo.empresas FORCE ROW LEVEL SECURITY;

ALTER TABLE nexo.empresas ALTER COLUMN codigo SET NOT NULL;
ALTER TABLE nexo.empresas ADD CONSTRAINT empresas_codigo_formato CHECK (codigo ~ '^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$');
ALTER TABLE nexo.empresas ADD CONSTRAINT empresas_codigo_unico UNIQUE (codigo);

-- ---------------------------------------------------------------------------------------------
-- 2. Tabelas
-- ---------------------------------------------------------------------------------------------

-- Conta de utilizador de UMA empresa (H-02: sem e-mail obrigatório; criada pelo proprietário).
-- Junta o "utilizador" e o "membro" da arquitectura 0.5: com contas por empresa, a função vive aqui.
CREATE TABLE nexo.utilizadores (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES nexo.empresas (id),
  nome_utilizador text NOT NULL CHECK (nome_utilizador ~ '^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$'),
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 120),
  funcao text NOT NULL CHECK (funcao IN ('proprietario', 'gestor', 'operador')),
  estado text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'desactivado')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid,
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  desactivado_em timestamptz,
  PRIMARY KEY (id),
  UNIQUE (empresa_id, id),
  UNIQUE (empresa_id, nome_utilizador),
  FOREIGN KEY (empresa_id, criado_por) REFERENCES nexo.utilizadores (empresa_id, id),
  CHECK ((estado = 'desactivado') = (desactivado_em IS NOT NULL))
);

-- Filiais em que um gestor ou operador pode trabalhar. O proprietário tem todas (sem linhas).
CREATE TABLE nexo.utilizador_filiais (
  empresa_id uuid NOT NULL,
  utilizador_id uuid NOT NULL,
  filial_id uuid NOT NULL,
  atribuida_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, utilizador_id, filial_id),
  FOREIGN KEY (empresa_id, utilizador_id) REFERENCES nexo.utilizadores (empresa_id, id),
  FOREIGN KEY (empresa_id, filial_id) REFERENCES nexo.filiais (empresa_id, id)
);

-- Código secreto: só o resumo scrypt (parâmetros guardados com cada resumo, para poderem subir).
CREATE TABLE nexo.credenciais_acesso (
  empresa_id uuid NOT NULL,
  utilizador_id uuid NOT NULL,
  algoritmo text NOT NULL CHECK (algoritmo = 'scrypt'),
  parametros text NOT NULL CHECK (parametros ~ '^ln=[0-9]{1,2},r=[0-9]{1,2},p=[0-9]{1,2}$'),
  sal bytea NOT NULL CHECK (octet_length(sal) = 16),
  resumo bytea NOT NULL CHECK (octet_length(resumo) = 32),
  versao integer NOT NULL DEFAULT 1 CHECK (versao >= 1),
  origem text NOT NULL CHECK (origem IN ('registo', 'proprietario', 'proprio', 'recuperacao', 'suporte')),
  definido_em timestamptz NOT NULL DEFAULT now(),
  definido_por uuid,
  PRIMARY KEY (empresa_id, utilizador_id),
  FOREIGN KEY (empresa_id, utilizador_id) REFERENCES nexo.utilizadores (empresa_id, id),
  FOREIGN KEY (empresa_id, definido_por) REFERENCES nexo.utilizadores (empresa_id, id)
);

-- Sessões online: só o SHA-256 do token (o token tem 256 bits aleatórios e vive num cookie HttpOnly).
CREATE TABLE nexo.sessoes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  utilizador_id uuid NOT NULL,
  resumo_token bytea NOT NULL CHECK (octet_length(resumo_token) = 32),
  criada_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  inactividade interval NOT NULL,
  ultimo_uso_em timestamptz NOT NULL DEFAULT now(),
  revogada_em timestamptz,
  motivo_revogacao text CHECK (motivo_revogacao IN ('saida', 'desactivacao', 'codigo_redefinido', 'codigo_alterado', 'codigo_recuperado')),
  PRIMARY KEY (id),
  UNIQUE (empresa_id, id),
  UNIQUE (resumo_token),
  FOREIGN KEY (empresa_id, utilizador_id) REFERENCES nexo.utilizadores (empresa_id, id),
  CHECK ((revogada_em IS NULL) = (motivo_revogacao IS NULL))
);
CREATE INDEX sessoes_activas_por_utilizador ON nexo.sessoes (empresa_id, utilizador_id) WHERE revogada_em IS NULL;

-- E-mail de recuperação (só proprietários). "email" é o confirmado; "email_pendente" espera confirmação.
CREATE TABLE nexo.contactos_recuperacao (
  empresa_id uuid NOT NULL,
  utilizador_id uuid NOT NULL,
  email text CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254 AND email = lower(email)),
  confirmado_em timestamptz,
  email_pendente text CHECK (email_pendente ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email_pendente) <= 254 AND email_pendente = lower(email_pendente)),
  pendente_desde timestamptz,
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, utilizador_id),
  FOREIGN KEY (empresa_id, utilizador_id) REFERENCES nexo.utilizadores (empresa_id, id),
  CHECK ((email IS NULL) = (confirmado_em IS NULL)),
  CHECK ((email_pendente IS NULL) = (pendente_desde IS NULL))
);

-- Tokens de utilização única enviados por e-mail (ou entregues pelo suporte). Só o SHA-256.
CREATE TABLE nexo.tokens_email (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  utilizador_id uuid NOT NULL,
  finalidade text NOT NULL CHECK (finalidade IN ('confirmar_email', 'recuperar_acesso')),
  origem text NOT NULL DEFAULT 'email' CHECK (origem IN ('email', 'suporte')),
  resumo_token bytea NOT NULL CHECK (octet_length(resumo_token) = 32),
  email text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  usado_em timestamptz,
  invalidado_em timestamptz,
  PRIMARY KEY (id),
  UNIQUE (resumo_token),
  FOREIGN KEY (empresa_id, utilizador_id) REFERENCES nexo.utilizadores (empresa_id, id),
  CHECK ((origem = 'email') = (email IS NOT NULL)),
  CHECK (origem = 'email' OR finalidade = 'recuperar_acesso')
);
CREATE INDEX tokens_email_por_utilizador ON nexo.tokens_email (empresa_id, utilizador_id, finalidade) WHERE usado_em IS NULL AND invalidado_em IS NULL;

-- Actos administrativos (D.15.5). Identifica a CONTA usada, não a pessoa física. Sem segredos.
CREATE TABLE nexo.registo_auditoria (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES nexo.empresas (id),
  autor_id uuid,
  origem text NOT NULL CHECK (origem IN ('api', 'recuperacao', 'suporte')),
  accao text NOT NULL CHECK (accao ~ '^[a-z_]+\.[a-z_]+$'),
  entidade text NOT NULL CHECK (entidade IN ('empresa', 'filial', 'utilizador')),
  entidade_id uuid,
  antes jsonb,
  depois jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (empresa_id, autor_id) REFERENCES nexo.utilizadores (empresa_id, id),
  CHECK (origem = 'suporte' OR autor_id IS NOT NULL)
);
CREATE INDEX registo_auditoria_por_data ON nexo.registo_auditoria (empresa_id, criado_em DESC);

-- ---------------------------------------------------------------------------------------------
-- 3. Regras na base
-- ---------------------------------------------------------------------------------------------

-- Auditoria imutável: além de nenhum papel ter UPDATE/DELETE/TRUNCATE.
CREATE FUNCTION nexo.recusar_alteracao() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'os registos de % não podem ser alterados nem apagados', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END
$$;
CREATE TRIGGER registo_auditoria_imutavel BEFORE UPDATE OR DELETE ON nexo.registo_auditoria
  FOR EACH ROW EXECUTE FUNCTION nexo.recusar_alteracao();
CREATE TRIGGER registo_auditoria_sem_truncate BEFORE TRUNCATE ON nexo.registo_auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION nexo.recusar_alteracao();

-- D.1.3: a empresa tem sempre pelo menos um proprietário activo. O bloqueio consultivo por empresa
-- serializa alterações concorrentes (dois proprietários a desactivarem-se um ao outro).
CREATE FUNCTION nexo.garantir_proprietario_activo() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.funcao = 'proprietario' AND OLD.estado = 'activo'
     AND (NEW.funcao <> 'proprietario' OR NEW.estado <> 'activo') THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('nexo.proprietarios'), pg_catalog.hashtext(NEW.empresa_id::text));
    IF NOT EXISTS (
      SELECT 1 FROM nexo.utilizadores u
       WHERE u.empresa_id = NEW.empresa_id AND u.id <> NEW.id
         AND u.funcao = 'proprietario' AND u.estado = 'activo'
    ) THEN
      RAISE EXCEPTION 'a empresa ficaria sem proprietário activo'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'utilizadores_proprietario_activo';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER utilizadores_proprietario_activo BEFORE UPDATE OF funcao, estado ON nexo.utilizadores
  FOR EACH ROW EXECUTE FUNCTION nexo.garantir_proprietario_activo();

-- ---------------------------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------------------------
ALTER TABLE nexo.utilizadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexo.utilizadores FORCE ROW LEVEL SECURITY;
ALTER TABLE nexo.utilizador_filiais ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexo.utilizador_filiais FORCE ROW LEVEL SECURITY;
ALTER TABLE nexo.credenciais_acesso ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexo.credenciais_acesso FORCE ROW LEVEL SECURITY;
ALTER TABLE nexo.sessoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexo.sessoes FORCE ROW LEVEL SECURITY;
ALTER TABLE nexo.contactos_recuperacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexo.contactos_recuperacao FORCE ROW LEVEL SECURITY;
ALTER TABLE nexo.tokens_email ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexo.tokens_email FORCE ROW LEVEL SECURITY;
ALTER TABLE nexo.registo_auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexo.registo_auditoria FORCE ROW LEVEL SECURITY;

REVOKE ALL ON nexo.utilizadores, nexo.utilizador_filiais, nexo.credenciais_acesso, nexo.sessoes,
  nexo.contactos_recuperacao, nexo.tokens_email, nexo.registo_auditoria FROM PUBLIC;

-- ---------------------------------------------------------------------------------------------
-- 5. Papéis de execução (pedidos com sessão). Primeira barreira: privilégios; segunda: políticas.
--    As diferenças entre proprietário e gestor (ambos nexo_gestao) estão nas políticas, com a
--    função do contexto; a API verifica-as antes, e a base volta a verificá-las.
-- ---------------------------------------------------------------------------------------------

-- Empresa: o proprietário altera os dados (não o código).
GRANT UPDATE (nome, nuit, telefone, endereco) ON nexo.empresas TO nexo_gestao;
CREATE POLICY empresas_proprietario_alterar ON nexo.empresas FOR UPDATE TO nexo_gestao
  USING (id = nexo.empresa_actual() AND nexo.funcao_actual() = 'proprietario')
  WITH CHECK (id = nexo.empresa_actual());

-- Filial: o proprietário altera o nome (o piloto tem uma filial; criar filiais fica para depois).
GRANT UPDATE (nome) ON nexo.filiais TO nexo_gestao;
CREATE POLICY filiais_proprietario_alterar ON nexo.filiais FOR UPDATE TO nexo_gestao
  USING (empresa_id = nexo.empresa_actual() AND nexo.funcao_actual() = 'proprietario')
  WITH CHECK (empresa_id = nexo.empresa_actual());

-- Utilizadores: a gestão lê os da empresa; o operador lê só a sua conta.
GRANT SELECT ON nexo.utilizadores TO nexo_gestao, nexo_operador;
CREATE POLICY utilizadores_ler_gestao ON nexo.utilizadores FOR SELECT TO nexo_gestao
  USING (empresa_id = nexo.empresa_actual());
CREATE POLICY utilizadores_ler_proprio ON nexo.utilizadores FOR SELECT TO nexo_operador
  USING (empresa_id = nexo.empresa_actual() AND id = nexo.utilizador_actual());

-- Só o proprietário cria contas (H-02) e altera perfis; nunca a SUA própria conta (impede a
-- auto-promoção e a auto-desactivação, também na base).
GRANT INSERT (id, empresa_id, nome_utilizador, nome, funcao, criado_por) ON nexo.utilizadores TO nexo_gestao;
CREATE POLICY utilizadores_proprietario_criar ON nexo.utilizadores FOR INSERT TO nexo_gestao
  WITH CHECK (empresa_id = nexo.empresa_actual() AND nexo.funcao_actual() = 'proprietario'
              AND criado_por = nexo.utilizador_actual());
GRANT UPDATE (nome, funcao, estado, desactivado_em, actualizado_em) ON nexo.utilizadores TO nexo_gestao;
CREATE POLICY utilizadores_proprietario_alterar ON nexo.utilizadores FOR UPDATE TO nexo_gestao
  USING (empresa_id = nexo.empresa_actual() AND nexo.funcao_actual() = 'proprietario'
         AND id <> nexo.utilizador_actual())
  WITH CHECK (empresa_id = nexo.empresa_actual() AND id <> nexo.utilizador_actual());

-- Filiais permitidas.
GRANT SELECT ON nexo.utilizador_filiais TO nexo_gestao, nexo_operador;
CREATE POLICY utilizador_filiais_ler_gestao ON nexo.utilizador_filiais FOR SELECT TO nexo_gestao
  USING (empresa_id = nexo.empresa_actual());
CREATE POLICY utilizador_filiais_ler_proprio ON nexo.utilizador_filiais FOR SELECT TO nexo_operador
  USING (empresa_id = nexo.empresa_actual() AND utilizador_id = nexo.utilizador_actual());
GRANT INSERT, DELETE ON nexo.utilizador_filiais TO nexo_gestao;
CREATE POLICY utilizador_filiais_proprietario_criar ON nexo.utilizador_filiais FOR INSERT TO nexo_gestao
  WITH CHECK (empresa_id = nexo.empresa_actual() AND nexo.funcao_actual() = 'proprietario'
              AND utilizador_id <> nexo.utilizador_actual());
CREATE POLICY utilizador_filiais_proprietario_apagar ON nexo.utilizador_filiais FOR DELETE TO nexo_gestao
  USING (empresa_id = nexo.empresa_actual() AND nexo.funcao_actual() = 'proprietario'
         AND utilizador_id <> nexo.utilizador_actual());

-- Contacto de recuperação: cada proprietário lê só o seu (as escritas passam pelas funções da 0007).
GRANT SELECT (empresa_id, utilizador_id, email, confirmado_em, email_pendente, pendente_desde) ON nexo.contactos_recuperacao TO nexo_gestao;
CREATE POLICY contactos_ler_proprio ON nexo.contactos_recuperacao FOR SELECT TO nexo_gestao
  USING (empresa_id = nexo.empresa_actual() AND utilizador_id = nexo.utilizador_actual());

-- Auditoria: a gestão regista os seus actos; só o proprietário consulta.
GRANT INSERT (empresa_id, autor_id, origem, accao, entidade, entidade_id, antes, depois) ON nexo.registo_auditoria TO nexo_gestao;
CREATE POLICY auditoria_registar ON nexo.registo_auditoria FOR INSERT TO nexo_gestao
  WITH CHECK (empresa_id = nexo.empresa_actual() AND autor_id = nexo.utilizador_actual() AND origem = 'api');
GRANT SELECT ON nexo.registo_auditoria TO nexo_gestao;
CREATE POLICY auditoria_ler_proprietario ON nexo.registo_auditoria FOR SELECT TO nexo_gestao
  USING (empresa_id = nexo.empresa_actual() AND nexo.funcao_actual() = 'proprietario');

-- credenciais_acesso, sessoes e tokens_email: NENHUM privilégio para os papéis de execução.

-- ---------------------------------------------------------------------------------------------
-- 6. nexo_autenticacao (dono das funções de identidade da 0007). Políticas explícitas, visíveis
--    em pg_policies. O papel não tem login nem membros: só age dentro dessas funções.
-- ---------------------------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION nexo.marca_transaccao(), nexo.contexto_valido(), nexo.empresa_actual(),
  nexo.utilizador_actual(), nexo.funcao_actual() TO nexo_autenticacao;

GRANT SELECT, INSERT ON nexo.empresas, nexo.filiais, nexo.utilizadores TO nexo_autenticacao;
GRANT SELECT ON nexo.utilizador_filiais TO nexo_autenticacao;
GRANT SELECT, INSERT, UPDATE ON nexo.credenciais_acesso, nexo.contactos_recuperacao TO nexo_autenticacao;
GRANT SELECT, INSERT ON nexo.sessoes, nexo.tokens_email TO nexo_autenticacao;
GRANT UPDATE (ultimo_uso_em, revogada_em, motivo_revogacao) ON nexo.sessoes TO nexo_autenticacao;
GRANT UPDATE (usado_em, invalidado_em) ON nexo.tokens_email TO nexo_autenticacao;
GRANT INSERT ON nexo.registo_auditoria TO nexo_autenticacao;

CREATE POLICY empresas_autenticacao_ler ON nexo.empresas FOR SELECT TO nexo_autenticacao USING (true);
CREATE POLICY empresas_autenticacao_criar ON nexo.empresas FOR INSERT TO nexo_autenticacao WITH CHECK (true);
CREATE POLICY filiais_autenticacao_ler ON nexo.filiais FOR SELECT TO nexo_autenticacao USING (true);
CREATE POLICY filiais_autenticacao_criar ON nexo.filiais FOR INSERT TO nexo_autenticacao WITH CHECK (true);
CREATE POLICY utilizadores_autenticacao_ler ON nexo.utilizadores FOR SELECT TO nexo_autenticacao USING (true);
CREATE POLICY utilizadores_autenticacao_criar ON nexo.utilizadores FOR INSERT TO nexo_autenticacao WITH CHECK (true);
CREATE POLICY utilizador_filiais_autenticacao_ler ON nexo.utilizador_filiais FOR SELECT TO nexo_autenticacao USING (true);
CREATE POLICY credenciais_autenticacao_ler ON nexo.credenciais_acesso FOR SELECT TO nexo_autenticacao USING (true);
CREATE POLICY credenciais_autenticacao_criar ON nexo.credenciais_acesso FOR INSERT TO nexo_autenticacao WITH CHECK (true);
CREATE POLICY credenciais_autenticacao_alterar ON nexo.credenciais_acesso FOR UPDATE TO nexo_autenticacao USING (true) WITH CHECK (true);
CREATE POLICY sessoes_autenticacao_ler ON nexo.sessoes FOR SELECT TO nexo_autenticacao USING (true);
CREATE POLICY sessoes_autenticacao_criar ON nexo.sessoes FOR INSERT TO nexo_autenticacao WITH CHECK (true);
CREATE POLICY sessoes_autenticacao_alterar ON nexo.sessoes FOR UPDATE TO nexo_autenticacao USING (true) WITH CHECK (true);
CREATE POLICY contactos_autenticacao_ler ON nexo.contactos_recuperacao FOR SELECT TO nexo_autenticacao USING (true);
CREATE POLICY contactos_autenticacao_criar ON nexo.contactos_recuperacao FOR INSERT TO nexo_autenticacao WITH CHECK (true);
CREATE POLICY contactos_autenticacao_alterar ON nexo.contactos_recuperacao FOR UPDATE TO nexo_autenticacao USING (true) WITH CHECK (true);
CREATE POLICY tokens_autenticacao_ler ON nexo.tokens_email FOR SELECT TO nexo_autenticacao USING (true);
CREATE POLICY tokens_autenticacao_criar ON nexo.tokens_email FOR INSERT TO nexo_autenticacao WITH CHECK (true);
CREATE POLICY tokens_autenticacao_alterar ON nexo.tokens_email FOR UPDATE TO nexo_autenticacao USING (true) WITH CHECK (true);
CREATE POLICY auditoria_autenticacao_registar ON nexo.registo_auditoria FOR INSERT TO nexo_autenticacao WITH CHECK (true);
