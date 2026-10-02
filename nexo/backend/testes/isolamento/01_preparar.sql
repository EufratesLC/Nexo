-- Teste de isolamento H-01 (revisão da Etapa 1) — preparação.
--
-- NÃO são as migrações definitivas. É um esquema mínimo, separado (nexo_iso), só para provar
-- o desenho de docs/Nexo_Arquitectura_Etapa_1.md, secções 3 e 3.7.
-- Executar SÓ num projecto Supabase de DESENVOLVIMENTO, como administrador, pela ligação directa.
-- Não contém segredos: a palavra-passe do papel de login é definida à parte (ver README).
--
-- Diferença consciente em relação ao desenho: aqui o dono das tabelas é o administrador que corre
-- o script (para a limpeza ser simples). Os testes nunca correm como dono.

-- ---------------------------------------------------------------------------------------------
-- Papéis
-- ---------------------------------------------------------------------------------------------
-- Login da API: sem privilégios próprios; NOINHERIT obriga a SET ROLE explícito em cada transacção.
CREATE ROLE nexo_iso_api LOGIN NOINHERIT NOBYPASSRLS;
-- Papéis de execução (sem login, sem BYPASSRLS).
CREATE ROLE nexo_iso_operador NOLOGIN NOBYPASSRLS;
CREATE ROLE nexo_iso_gestao NOLOGIN NOBYPASSRLS;
CREATE ROLE nexo_iso_sinc NOLOGIN NOBYPASSRLS;
-- Dono da função de autenticação do registo. Sem login, sem membros: ninguém consegue SET ROLE para ele.
CREATE ROLE nexo_iso_autenticacao NOLOGIN NOBYPASSRLS;

GRANT nexo_iso_operador, nexo_iso_gestao, nexo_iso_sinc TO nexo_iso_api;
-- O administrador precisa de pertencer ao papel para lhe atribuir a função (ALTER FUNCTION OWNER).
GRANT nexo_iso_autenticacao TO current_user;

CREATE SCHEMA nexo_iso;
REVOKE ALL ON SCHEMA nexo_iso FROM PUBLIC;
GRANT USAGE ON SCHEMA nexo_iso TO nexo_iso_api, nexo_iso_operador, nexo_iso_gestao, nexo_iso_sinc, nexo_iso_autenticacao;

-- ---------------------------------------------------------------------------------------------
-- Contexto da transacção
-- ---------------------------------------------------------------------------------------------
-- O contexto só é válido se tiver sido definido NESTA transacção: nexo.inicio tem de ser igual ao
-- início da transacção actual. Um valor que tenha ficado na sessão (set_config(..., false), proibido
-- no código) não vale noutra transacção do mesmo backend do pool.
CREATE FUNCTION nexo_iso.contexto_valido() RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT coalesce(current_setting('nexo.inicio', true), '') = extract(epoch FROM now())::text
  $$;

CREATE FUNCTION nexo_iso.empresa_actual() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN nexo_iso.contexto_valido()
                THEN nullif(current_setting('nexo.empresa_id', true), '')::uuid END
  $$;

CREATE FUNCTION nexo_iso.registo_actual() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN nexo_iso.contexto_valido()
                THEN nullif(current_setting('nexo.registo_id', true), '')::uuid END
  $$;

-- Função que a API chama no início de cada transacção (depois de SET LOCAL ROLE).
CREATE FUNCTION nexo_iso.definir_contexto(p_empresa uuid, p_registo uuid DEFAULT NULL) RETURNS void
  LANGUAGE sql VOLATILE AS $$
    SELECT set_config('nexo.inicio', extract(epoch FROM now())::text, true),
           set_config('nexo.empresa_id', coalesce(p_empresa::text, ''), true),
           set_config('nexo.registo_id', coalesce(p_registo::text, ''), true)
  $$;

GRANT EXECUTE ON FUNCTION nexo_iso.contexto_valido(), nexo_iso.empresa_actual(), nexo_iso.registo_actual(),
  nexo_iso.definir_contexto(uuid, uuid) TO nexo_iso_operador, nexo_iso_gestao, nexo_iso_sinc;

-- ---------------------------------------------------------------------------------------------
-- Tabelas mínimas
-- ---------------------------------------------------------------------------------------------
CREATE TABLE nexo_iso.empresas (
  id uuid PRIMARY KEY,
  nome text NOT NULL
);

CREATE TABLE nexo_iso.membros (
  id uuid PRIMARY KEY,
  empresa_id uuid NOT NULL REFERENCES nexo_iso.empresas (id),
  nome text NOT NULL,
  funcao text NOT NULL CHECK (funcao IN ('proprietario', 'gestor', 'operador')),
  UNIQUE (empresa_id, id)
);

CREATE TABLE nexo_iso.registos_dispositivo (
  id uuid PRIMARY KEY,
  empresa_id uuid NOT NULL REFERENCES nexo_iso.empresas (id),
  filial_id uuid NOT NULL,
  codigo text NOT NULL,
  credencial_hash bytea NOT NULL UNIQUE,
  estado text NOT NULL CHECK (estado IN ('activo', 'suspenso', 'revogado')),
  UNIQUE (empresa_id, id)
);

CREATE TABLE nexo_iso.produtos (
  id uuid PRIMARY KEY,
  empresa_id uuid NOT NULL REFERENCES nexo_iso.empresas (id),
  nome text NOT NULL,
  preco_venda bigint NOT NULL CHECK (preco_venda > 0),
  UNIQUE (empresa_id, id)
);

-- Movimentos de stock SEM colunas de custo (arquitectura 3.7).
CREATE TABLE nexo_iso.movimentos_stock (
  id uuid PRIMARY KEY,
  empresa_id uuid NOT NULL,
  produto_id uuid NOT NULL,
  tipo text NOT NULL,
  quantidade numeric(14, 3) NOT NULL,
  UNIQUE (empresa_id, id),
  FOREIGN KEY (empresa_id, produto_id) REFERENCES nexo_iso.produtos (empresa_id, id)
);

-- Valor de cada movimento: tabela de custos, só gestão e sincronização.
CREATE TABLE nexo_iso.valorizacao_movimentos (
  movimento_id uuid PRIMARY KEY,
  empresa_id uuid NOT NULL,
  custo_unitario numeric(18, 4) NOT NULL,
  valor bigint NOT NULL,
  FOREIGN KEY (empresa_id, movimento_id) REFERENCES nexo_iso.movimentos_stock (empresa_id, id)
);

CREATE TABLE nexo_iso.vendas (
  id uuid PRIMARY KEY,
  empresa_id uuid NOT NULL,
  registo_id uuid NOT NULL,
  total bigint NOT NULL,
  UNIQUE (empresa_id, id),
  FOREIGN KEY (empresa_id, registo_id) REFERENCES nexo_iso.registos_dispositivo (empresa_id, id)
);

CREATE TABLE nexo_iso.itens_venda (
  id uuid PRIMARY KEY,
  empresa_id uuid NOT NULL,
  venda_id uuid NOT NULL,
  produto_id uuid NOT NULL,
  quantidade numeric(14, 3) NOT NULL,
  liquido bigint NOT NULL,
  UNIQUE (empresa_id, id),
  FOREIGN KEY (empresa_id, venda_id) REFERENCES nexo_iso.vendas (empresa_id, id),
  FOREIGN KEY (empresa_id, produto_id) REFERENCES nexo_iso.produtos (empresa_id, id)
);

CREATE TABLE nexo_iso.custos_item_venda (
  item_venda_id uuid PRIMARY KEY,
  empresa_id uuid NOT NULL,
  custo_registado bigint NOT NULL,
  FOREIGN KEY (empresa_id, item_venda_id) REFERENCES nexo_iso.itens_venda (empresa_id, id)
);

-- Factos de operações recebidas: imutáveis (arquitectura 4.3 e 8).
CREATE TABLE nexo_iso.operacoes_sync (
  id uuid NOT NULL,
  empresa_id uuid NOT NULL,
  registo_id uuid NOT NULL,
  sequencia bigint NOT NULL,
  conteudo_assinado text NOT NULL,
  PRIMARY KEY (empresa_id, id),
  FOREIGN KEY (empresa_id, registo_id) REFERENCES nexo_iso.registos_dispositivo (empresa_id, id)
);

-- Controlo negativo: chave estrangeira SIMPLES, para mostrar porque são precisas as compostas.
CREATE TABLE nexo_iso.controlo_fk_simples (
  id uuid PRIMARY KEY,
  empresa_id uuid NOT NULL,
  produto_id uuid NOT NULL REFERENCES nexo_iso.produtos (id)
);

CREATE FUNCTION nexo_iso.recusar_alteracao() RETURNS trigger
  LANGUAGE plpgsql AS $$
  BEGIN
    RAISE EXCEPTION 'tabela imutável: % em %', TG_OP, TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END
  $$;
CREATE TRIGGER operacoes_sync_imutavel BEFORE UPDATE OR DELETE ON nexo_iso.operacoes_sync
  FOR EACH ROW EXECUTE FUNCTION nexo_iso.recusar_alteracao();

-- ---------------------------------------------------------------------------------------------
-- RLS: ENABLE + FORCE em todas as tabelas
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'nexo_iso' LOOP
    EXECUTE format('ALTER TABLE nexo_iso.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE nexo_iso.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Privilégios (primeira barreira: o que cada papel pode tocar) e políticas (segunda: que linhas)
-- ---------------------------------------------------------------------------------------------
-- Operador: sem nenhuma tabela de custos, sem membros, sem registos, sem operações.
GRANT SELECT ON nexo_iso.empresas, nexo_iso.produtos, nexo_iso.movimentos_stock, nexo_iso.vendas, nexo_iso.itens_venda
  TO nexo_iso_operador;
-- Gestão: lê tudo da empresa, incluindo custos; escreve catálogo e movimentos.
GRANT SELECT ON ALL TABLES IN SCHEMA nexo_iso TO nexo_iso_gestao;
GRANT INSERT, UPDATE ON nexo_iso.produtos TO nexo_iso_gestao;
GRANT INSERT ON nexo_iso.movimentos_stock, nexo_iso.valorizacao_movimentos TO nexo_iso_gestao;
-- Sincronização: lê o catálogo, insere factos de balcão e os respectivos custos. Não lê membros.
GRANT SELECT ON nexo_iso.produtos, nexo_iso.vendas, nexo_iso.itens_venda, nexo_iso.movimentos_stock,
  nexo_iso.operacoes_sync TO nexo_iso_sinc;
GRANT INSERT ON nexo_iso.vendas, nexo_iso.itens_venda, nexo_iso.custos_item_venda, nexo_iso.movimentos_stock,
  nexo_iso.valorizacao_movimentos, nexo_iso.operacoes_sync TO nexo_iso_sinc;
-- Tabela de controlo: escrita por gestão, para o teste da chave simples.
GRANT INSERT ON nexo_iso.controlo_fk_simples TO nexo_iso_gestao;
-- Autenticação do registo: só as colunas necessárias.
GRANT SELECT (id, empresa_id, filial_id, estado, credencial_hash) ON nexo_iso.registos_dispositivo TO nexo_iso_autenticacao;

-- Políticas por empresa. Uma política por tabela e papel, para ficar legível.
CREATE POLICY empresas_ler ON nexo_iso.empresas FOR SELECT TO nexo_iso_operador, nexo_iso_gestao
  USING (id = nexo_iso.empresa_actual());

CREATE POLICY membros_gestao ON nexo_iso.membros FOR SELECT TO nexo_iso_gestao
  USING (empresa_id = nexo_iso.empresa_actual());

CREATE POLICY registos_gestao ON nexo_iso.registos_dispositivo FOR SELECT TO nexo_iso_gestao
  USING (empresa_id = nexo_iso.empresa_actual());
-- Autenticação antes de existir contexto (arquitectura 3.4): política explícita para o papel dono da
-- função. FORCE RLS continua activo; não há BYPASSRLS. Ninguém pode assumir este papel.
CREATE POLICY registos_autenticacao ON nexo_iso.registos_dispositivo FOR SELECT TO nexo_iso_autenticacao
  USING (true);

CREATE POLICY produtos_ler ON nexo_iso.produtos FOR SELECT TO nexo_iso_operador, nexo_iso_gestao, nexo_iso_sinc
  USING (empresa_id = nexo_iso.empresa_actual());
CREATE POLICY produtos_gestao_inserir ON nexo_iso.produtos FOR INSERT TO nexo_iso_gestao
  WITH CHECK (empresa_id = nexo_iso.empresa_actual());
CREATE POLICY produtos_gestao_alterar ON nexo_iso.produtos FOR UPDATE TO nexo_iso_gestao
  USING (empresa_id = nexo_iso.empresa_actual()) WITH CHECK (empresa_id = nexo_iso.empresa_actual());

CREATE POLICY movimentos_ler ON nexo_iso.movimentos_stock FOR SELECT TO nexo_iso_operador, nexo_iso_gestao, nexo_iso_sinc
  USING (empresa_id = nexo_iso.empresa_actual());
CREATE POLICY movimentos_inserir ON nexo_iso.movimentos_stock FOR INSERT TO nexo_iso_gestao, nexo_iso_sinc
  WITH CHECK (empresa_id = nexo_iso.empresa_actual());

CREATE POLICY valorizacao_ler ON nexo_iso.valorizacao_movimentos FOR SELECT TO nexo_iso_gestao
  USING (empresa_id = nexo_iso.empresa_actual());
CREATE POLICY valorizacao_inserir ON nexo_iso.valorizacao_movimentos FOR INSERT TO nexo_iso_gestao, nexo_iso_sinc
  WITH CHECK (empresa_id = nexo_iso.empresa_actual());

CREATE POLICY vendas_ler ON nexo_iso.vendas FOR SELECT TO nexo_iso_operador, nexo_iso_gestao, nexo_iso_sinc
  USING (empresa_id = nexo_iso.empresa_actual());
CREATE POLICY vendas_sinc_inserir ON nexo_iso.vendas FOR INSERT TO nexo_iso_sinc
  WITH CHECK (empresa_id = nexo_iso.empresa_actual() AND registo_id = nexo_iso.registo_actual());

CREATE POLICY itens_ler ON nexo_iso.itens_venda FOR SELECT TO nexo_iso_operador, nexo_iso_gestao, nexo_iso_sinc
  USING (empresa_id = nexo_iso.empresa_actual());
CREATE POLICY itens_sinc_inserir ON nexo_iso.itens_venda FOR INSERT TO nexo_iso_sinc
  WITH CHECK (empresa_id = nexo_iso.empresa_actual());

CREATE POLICY custos_gestao_ler ON nexo_iso.custos_item_venda FOR SELECT TO nexo_iso_gestao
  USING (empresa_id = nexo_iso.empresa_actual());
CREATE POLICY custos_sinc_inserir ON nexo_iso.custos_item_venda FOR INSERT TO nexo_iso_sinc
  WITH CHECK (empresa_id = nexo_iso.empresa_actual());

CREATE POLICY operacoes_ler ON nexo_iso.operacoes_sync FOR SELECT TO nexo_iso_gestao, nexo_iso_sinc
  USING (empresa_id = nexo_iso.empresa_actual());
CREATE POLICY operacoes_sinc_inserir ON nexo_iso.operacoes_sync FOR INSERT TO nexo_iso_sinc
  WITH CHECK (empresa_id = nexo_iso.empresa_actual() AND registo_id = nexo_iso.registo_actual());

CREATE POLICY controlo_gestao ON nexo_iso.controlo_fk_simples FOR INSERT TO nexo_iso_gestao
  WITH CHECK (empresa_id = nexo_iso.empresa_actual());

-- ---------------------------------------------------------------------------------------------
-- Autenticação do registo antes de existir contexto (arquitectura 3.4)
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION nexo_iso.autenticar_registo(p_hash bytea)
  RETURNS TABLE (registo_id uuid, empresa_id uuid, filial_id uuid, estado text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT r.id, r.empresa_id, r.filial_id, r.estado
      FROM nexo_iso.registos_dispositivo r
     WHERE r.credencial_hash = p_hash
       AND octet_length(p_hash) = 32
  $$;
-- Correcção de 02/10/2026 (execução no Supabase): fora de superutilizador, o novo dono de um
-- objecto tem de ter CREATE no esquema. O privilégio é dado só durante a mudança de dono.
GRANT CREATE ON SCHEMA nexo_iso TO nexo_iso_autenticacao;

ALTER FUNCTION nexo_iso.autenticar_registo(bytea)
  OWNER TO nexo_iso_autenticacao;

REVOKE CREATE ON SCHEMA nexo_iso FROM nexo_iso_autenticacao;
REVOKE ALL ON FUNCTION nexo_iso.autenticar_registo(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nexo_iso.autenticar_registo(bytea) TO nexo_iso_api;
-- O administrador deixa de pertencer ao papel depois de lhe dar a função.
REVOKE nexo_iso_autenticacao FROM current_user;

-- No Supabase, os papéis anon e authenticated não podem ver este esquema.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA nexo_iso FROM anon';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA nexo_iso FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA nexo_iso FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA nexo_iso FROM authenticated';
  END IF;
END
$$;
