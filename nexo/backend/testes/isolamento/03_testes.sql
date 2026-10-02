-- Teste de isolamento H-01 — testes na base de dados.
--
-- Executar LIGADO COMO nexo_iso_api (o papel de login da API), em modo autocommit: cada bloco DO
-- é uma transacção. Cada teste escreve "OK Tnn …" (NOTICE) ou "FALHOU Tnn …" (WARNING).
-- Nenhum teste deixa dados: as escritas aceites são desfeitas com um erro interno (P0099).
--
-- Empresas: A = aaaaaaaa-…-000000000001, B = bbbbbbbb-…-000000000001.
-- Registos: A/C01 = …c001, A/C02 = …c002, B/C01 = bbbbbbbb-…c001.

-- T01 — Papéis de execução sem BYPASSRLS; o login não herda privilégios.
DO $$
DECLARE
  n int;
BEGIN
  IF current_user <> 'nexo_iso_api' THEN
    RAISE WARNING 'FALHOU T01 os testes têm de correr ligados como nexo_iso_api (agora: %)', current_user;
    RETURN;
  END IF;
  SELECT count(*) INTO n FROM pg_roles WHERE rolname LIKE 'nexo\_iso\_%' AND (rolbypassrls OR rolsuper);
  IF n > 0 THEN RAISE WARNING 'FALHOU T01 % papel(éis) nexo_iso_* com BYPASSRLS ou superutilizador', n; RETURN; END IF;
  IF (SELECT rolinherit FROM pg_roles WHERE rolname = 'nexo_iso_api') THEN
    RAISE WARNING 'FALHOU T01 nexo_iso_api herda privilégios (devia ser NOINHERIT)'; RETURN;
  END IF;
  RAISE NOTICE 'OK T01 papéis sem BYPASSRLS; nexo_iso_api NOINHERIT';
END
$$;

-- T02 — Todas as tabelas com ENABLE e FORCE ROW LEVEL SECURITY.
DO $$
DECLARE
  faltam text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO faltam
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'nexo_iso' AND c.relkind = 'r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF faltam IS NOT NULL THEN RAISE WARNING 'FALHOU T02 sem ENABLE/FORCE: %', faltam; RETURN; END IF;
  RAISE NOTICE 'OK T02 todas as tabelas com ENABLE + FORCE ROW LEVEL SECURITY';
END
$$;

-- T03 — O login da API, sem SET ROLE, não lê nem escreve nenhuma tabela.
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM nexo_iso.produtos;
    RAISE WARNING 'FALHOU T03 nexo_iso_api leu produtos sem SET ROLE';
    RETURN;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM nexo_iso.registos_dispositivo;
    RAISE WARNING 'FALHOU T03 nexo_iso_api leu registos_dispositivo directamente';
    RETURN;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK T03 sem SET ROLE a API não acede às tabelas';
END
$$;

-- T04 — Pedido sem contexto: nenhuma linha visível, nenhuma escrita aceite.
DO $$
DECLARE
  n int;
BEGIN
  SET LOCAL ROLE nexo_iso_gestao;
  SELECT count(*) INTO n FROM nexo_iso.produtos;
  IF n <> 0 THEN RAISE WARNING 'FALHOU T04 gestão sem contexto viu % produto(s)', n; RETURN; END IF;
  SELECT count(*) INTO n FROM nexo_iso.custos_item_venda;
  IF n <> 0 THEN RAISE WARNING 'FALHOU T04 gestão sem contexto viu % custo(s)', n; RETURN; END IF;
  BEGIN
    INSERT INTO nexo_iso.produtos (id, empresa_id, nome, preco_venda)
    VALUES (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'Sem contexto', 100);
    RAISE WARNING 'FALHOU T04 escrita sem contexto aceite';
    RETURN;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK T04 sem contexto: 0 linhas e escrita recusada';
END
$$;

-- T05 — Contexto definido sem a marca da transacção (uso errado ou tentativa de contornar): nega tudo.
DO $$
DECLARE
  n int;
BEGIN
  SET LOCAL ROLE nexo_iso_gestao;
  PERFORM set_config('nexo.empresa_id', 'aaaaaaaa-0000-4000-8000-000000000001', true);
  SELECT count(*) INTO n FROM nexo_iso.produtos;
  IF n <> 0 THEN RAISE WARNING 'FALHOU T05 empresa definida sem nexo.inicio deu % linha(s)', n; RETURN; END IF;
  RAISE NOTICE 'OK T05 contexto sem marca da transacção é ignorado';
END
$$;

-- T06 — Leitura entre empresas recusada (gestão da empresa A).
DO $$
DECLARE
  n int;
BEGIN
  SET LOCAL ROLE nexo_iso_gestao;
  PERFORM nexo_iso.definir_contexto('aaaaaaaa-0000-4000-8000-000000000001');
  SELECT count(*) INTO n FROM nexo_iso.produtos WHERE id = 'bbbbbbbb-0000-4000-8000-000000000101';
  IF n <> 0 THEN RAISE WARNING 'FALHOU T06 A leu o produto de B pelo identificador'; RETURN; END IF;
  SELECT count(*) INTO n FROM nexo_iso.produtos WHERE empresa_id <> 'aaaaaaaa-0000-4000-8000-000000000001';
  IF n <> 0 THEN RAISE WARNING 'FALHOU T06 A viu % produto(s) de outra empresa', n; RETURN; END IF;
  SELECT count(*) INTO n FROM nexo_iso.custos_item_venda WHERE empresa_id <> 'aaaaaaaa-0000-4000-8000-000000000001';
  IF n <> 0 THEN RAISE WARNING 'FALHOU T06 A viu custos de outra empresa'; RETURN; END IF;
  SELECT count(*) INTO n FROM nexo_iso.produtos;
  IF n <> 1 THEN RAISE WARNING 'FALHOU T06 A devia ver exactamente o seu produto (viu %)', n; RETURN; END IF;
  RAISE NOTICE 'OK T06 leitura limitada à empresa do contexto, mesmo com o identificador de B';
END
$$;

-- T07 — Escrita entre empresas recusada (gestão da empresa A).
DO $$
DECLARE
  n int;
BEGIN
  SET LOCAL ROLE nexo_iso_gestao;
  PERFORM nexo_iso.definir_contexto('aaaaaaaa-0000-4000-8000-000000000001');
  BEGIN
    INSERT INTO nexo_iso.produtos (id, empresa_id, nome, preco_venda)
    VALUES (gen_random_uuid(), 'bbbbbbbb-0000-4000-8000-000000000001', 'Intruso', 100);
    RAISE WARNING 'FALHOU T07 A inseriu um produto na empresa B';
    RETURN;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE nexo_iso.produtos SET nome = 'Alterado por A' WHERE id = 'bbbbbbbb-0000-4000-8000-000000000101';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE WARNING 'FALHOU T07 A alterou % produto(s) de B', n; RETURN; END IF;
  BEGIN
    UPDATE nexo_iso.produtos SET empresa_id = 'bbbbbbbb-0000-4000-8000-000000000001'
     WHERE id = 'aaaaaaaa-0000-4000-8000-000000000101';
    RAISE WARNING 'FALHOU T07 A moveu um produto para B';
    RETURN;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK T07 inserir, alterar e mover para outra empresa recusados';
END
$$;

-- T08 — Chave estrangeira composta: um item da empresa A não pode apontar para um produto de B.
DO $$
BEGIN
  SET LOCAL ROLE nexo_iso_sinc;
  PERFORM nexo_iso.definir_contexto('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-00000000c001');
  BEGIN
    INSERT INTO nexo_iso.itens_venda (id, empresa_id, venda_id, produto_id, quantidade, liquido)
    VALUES (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000301',
            'bbbbbbbb-0000-4000-8000-000000000101', 1, 100);
    RAISE WARNING 'FALHOU T08 item de A aceite com produto de B';
    RETURN;
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO nexo_iso.movimentos_stock (id, empresa_id, produto_id, tipo, quantidade)
    VALUES (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000101', 'venda', -1);
    RAISE WARNING 'FALHOU T08 movimento de A aceite com produto de B';
    RETURN;
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  RAISE NOTICE 'OK T08 chaves compostas recusam referências a outra empresa';
END
$$;

-- T09 — Controlo negativo: uma chave estrangeira SIMPLES aceitaria o produto de B.
-- Resultado esperado: a inserção é aceite (e desfeita). Mostra porque o modelo usa chaves compostas.
DO $$
DECLARE
  aceite boolean := false;
BEGIN
  SET LOCAL ROLE nexo_iso_gestao;
  PERFORM nexo_iso.definir_contexto('aaaaaaaa-0000-4000-8000-000000000001');
  BEGIN
    INSERT INTO nexo_iso.controlo_fk_simples (id, empresa_id, produto_id)
    VALUES (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000101');
    aceite := true;
    RAISE EXCEPTION 'desfazer' USING ERRCODE = 'P0099';
  EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
  END;
  IF aceite THEN
    RAISE NOTICE 'OK T09 controlo: a chave simples aceita o produto de B (as políticas não verificam a referência)';
  ELSE
    RAISE WARNING 'FALHOU T09 controlo não se comportou como esperado';
  END IF;
END
$$;

-- T10 — Operador sem acesso às tabelas de custos (privilégio, não só política).
DO $$
BEGIN
  SET LOCAL ROLE nexo_iso_operador;
  PERFORM nexo_iso.definir_contexto('aaaaaaaa-0000-4000-8000-000000000001');
  BEGIN
    PERFORM 1 FROM nexo_iso.custos_item_venda;
    RAISE WARNING 'FALHOU T10 operador leu custos_item_venda';
    RETURN;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM nexo_iso.valorizacao_movimentos;
    RAISE WARNING 'FALHOU T10 operador leu valorizacao_movimentos';
    RETURN;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM i.id FROM nexo_iso.itens_venda i JOIN nexo_iso.custos_item_venda c ON c.item_venda_id = i.id;
    RAISE WARNING 'FALHOU T10 operador obteve custos por junção';
    RETURN;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK T10 operador sem acesso às tabelas de custos (também por junção)';
END
$$;

-- T11 — Os movimentos de stock não têm colunas de custo.
DO $$
BEGIN
  SET LOCAL ROLE nexo_iso_operador;
  PERFORM nexo_iso.definir_contexto('aaaaaaaa-0000-4000-8000-000000000001');
  BEGIN
    EXECUTE 'SELECT custo_unitario FROM nexo_iso.movimentos_stock';
    RAISE WARNING 'FALHOU T11 movimentos_stock tem custo_unitario';
    RETURN;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
  BEGIN
    EXECUTE 'SELECT valor FROM nexo_iso.movimentos_stock';
    RAISE WARNING 'FALHOU T11 movimentos_stock tem valor';
    RETURN;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
  RAISE NOTICE 'OK T11 movimentos_stock sem custo_unitario nem valor';
END
$$;

-- T12 — Catálogo: nenhuma coluna legível pelo operador tem nome de custo.
DO $$
DECLARE
  achadas text;
BEGIN
  SELECT string_agg(c.relname || '.' || a.attname, ', ') INTO achadas
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'nexo_iso' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname ~ '(custo|valor|margem|cmv)'
     AND has_column_privilege('nexo_iso_operador', c.oid, a.attnum, 'SELECT');
  IF achadas IS NOT NULL THEN RAISE WARNING 'FALHOU T12 colunas de custo legíveis pelo operador: %', achadas; RETURN; END IF;
  RAISE NOTICE 'OK T12 nenhuma coluna de custo legível pelo operador';
END
$$;

-- T13 — Sentinela: nenhum valor de custo aparece em nenhuma linha legível pelo operador.
DO $$
DECLARE
  t text;
  n int;
  total int := 0;
BEGIN
  SET LOCAL ROLE nexo_iso_operador;
  PERFORM nexo_iso.definir_contexto('aaaaaaaa-0000-4000-8000-000000000001');
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'nexo_iso' AND c.relkind = 'r' AND has_table_privilege('nexo_iso_operador', c.oid, 'SELECT')
  LOOP
    EXECUTE format($q$SELECT count(*) FROM nexo_iso.%I x WHERE to_jsonb(x)::text ~ '(1234567|2222222|7654321)'$q$, t) INTO n;
    total := total + n;
  END LOOP;
  IF total > 0 THEN RAISE WARNING 'FALHOU T13 % linha(s) legíveis pelo operador contêm um valor de custo', total; RETURN; END IF;
  RAISE NOTICE 'OK T13 nenhum valor-sentinela de custo nas linhas legíveis pelo operador';
END
$$;

-- T14 — Gestão lê os custos da sua empresa, e só esses.
DO $$
DECLARE
  v bigint;
  n int;
BEGIN
  SET LOCAL ROLE nexo_iso_gestao;
  PERFORM nexo_iso.definir_contexto('aaaaaaaa-0000-4000-8000-000000000001');
  SELECT count(*), max(custo_registado) INTO n, v FROM nexo_iso.custos_item_venda;
  IF n <> 1 OR v <> 2222222 THEN RAISE WARNING 'FALHOU T14 gestão de A: % linha(s), custo %', n, v; RETURN; END IF;
  RAISE NOTICE 'OK T14 gestão lê os custos da própria empresa';
END
$$;

-- T15 — Sincronização limitada à empresa e ao registo da credencial.
DO $$
DECLARE
  aceite boolean := false;
BEGIN
  SET LOCAL ROLE nexo_iso_sinc;
  PERFORM nexo_iso.definir_contexto('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-00000000c001');
  BEGIN
    INSERT INTO nexo_iso.vendas (id, empresa_id, registo_id, total)
    VALUES (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-00000000c002', 100);
    RAISE WARNING 'FALHOU T15 venda aceite com outro registo da mesma empresa';
    RETURN;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO nexo_iso.vendas (id, empresa_id, registo_id, total)
    VALUES (gen_random_uuid(), 'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-00000000c001', 100);
    RAISE WARNING 'FALHOU T15 venda aceite na empresa B';
    RETURN;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO nexo_iso.operacoes_sync (id, empresa_id, registo_id, sequencia, conteudo_assinado)
    VALUES (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-00000000c002', 1, '{}');
    RAISE WARNING 'FALHOU T15 operação aceite com outro registo';
    RETURN;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO nexo_iso.vendas (id, empresa_id, registo_id, total)
    VALUES (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-00000000c001', 100);
    aceite := true;
    RAISE EXCEPTION 'desfazer' USING ERRCODE = 'P0099';
  EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
  END;
  IF NOT aceite THEN RAISE WARNING 'FALHOU T15 venda válida do próprio registo recusada'; RETURN; END IF;
  RAISE NOTICE 'OK T15 sincronização só escreve na empresa e no registo da credencial';
END
$$;

-- T16 — Sincronização não lê tabelas administrativas; ninguém altera nem apaga operações recebidas.
DO $$
DECLARE
  papel text;
BEGIN
  SET LOCAL ROLE nexo_iso_sinc;
  PERFORM nexo_iso.definir_contexto('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-00000000c001');
  BEGIN
    PERFORM 1 FROM nexo_iso.membros;
    RAISE WARNING 'FALHOU T16 sincronização leu membros';
    RETURN;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM nexo_iso.registos_dispositivo;
    RAISE WARNING 'FALHOU T16 sincronização leu registos_dispositivo';
    RETURN;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  FOREACH papel IN ARRAY ARRAY['nexo_iso_operador', 'nexo_iso_gestao', 'nexo_iso_sinc', 'nexo_iso_api'] LOOP
    IF has_table_privilege(papel, 'nexo_iso.operacoes_sync', 'UPDATE')
       OR has_table_privilege(papel, 'nexo_iso.operacoes_sync', 'DELETE') THEN
      RAISE WARNING 'FALHOU T16 % pode alterar ou apagar operacoes_sync', papel;
      RETURN;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK T16 sincronização sem acesso administrativo; operacoes_sync sem UPDATE/DELETE';
END
$$;

-- T17 — autenticar_registo funciona antes de existir contexto e devolve só o registo da credencial.
DO $$
DECLARE
  r record;
  n int;
BEGIN
  SELECT count(*) INTO n FROM nexo_iso.autenticar_registo(sha256(convert_to('teste-isolamento-A-C01', 'UTF8')));
  IF n <> 1 THEN RAISE WARNING 'FALHOU T17 credencial válida devolveu % linha(s)', n; RETURN; END IF;
  SELECT * INTO r FROM nexo_iso.autenticar_registo(sha256(convert_to('teste-isolamento-A-C01', 'UTF8')));
  IF r.empresa_id <> 'aaaaaaaa-0000-4000-8000-000000000001' OR r.registo_id <> 'aaaaaaaa-0000-4000-8000-00000000c001' THEN
    RAISE WARNING 'FALHOU T17 registo errado: %', r; RETURN;
  END IF;
  SELECT count(*) INTO n FROM nexo_iso.autenticar_registo(sha256(convert_to('credencial-desconhecida', 'UTF8')));
  IF n <> 0 THEN RAISE WARNING 'FALHOU T17 credencial desconhecida devolveu linhas'; RETURN; END IF;
  SELECT count(*) INTO n FROM nexo_iso.autenticar_registo('\x00'::bytea);
  IF n <> 0 THEN RAISE WARNING 'FALHOU T17 resumo com tamanho errado devolveu linhas'; RETURN; END IF;
  RAISE NOTICE 'OK T17 autenticar_registo devolve só o registo da credencial, sem contexto';
END
$$;

-- T18 — A função não abre acesso genérico.
DO $$
BEGIN
  BEGIN
    SET LOCAL ROLE nexo_iso_autenticacao;
    RAISE WARNING 'FALHOU T18 a API conseguiu assumir o papel dono da função';
    RETURN;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    SET LOCAL ROLE nexo_iso_operador;
    PERFORM * FROM nexo_iso.autenticar_registo(sha256(convert_to('teste-isolamento-A-C01', 'UTF8')));
    RAISE WARNING 'FALHOU T18 o operador executou autenticar_registo';
    RETURN;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'nexo_iso.autenticar_registo(bytea)'::regprocedure) IS NOT TRUE
     OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = 'nexo_iso.autenticar_registo(bytea)'::regprocedure) <> 'nexo_iso_autenticacao'
     OR pg_has_role('nexo_iso_api', 'nexo_iso_autenticacao', 'MEMBER')
     OR pg_has_role('nexo_iso_operador', 'nexo_iso_autenticacao', 'MEMBER')
     OR pg_has_role('nexo_iso_gestao', 'nexo_iso_autenticacao', 'MEMBER')
     OR pg_has_role('nexo_iso_sinc', 'nexo_iso_autenticacao', 'MEMBER') THEN
    RAISE WARNING 'FALHOU T18 dono, SECURITY DEFINER ou membros do papel de autenticação não são os esperados';
    RETURN;
  END IF;
  RAISE NOTICE 'OK T18 nenhum papel da API pertence ao dono da função; a API executa-a, o operador não';
END
$$;

-- T19 e T20 — O contexto não passa de uma transacção para a seguinte na mesma ligação.
-- T19a: transacção com contexto A (local), terminada.
DO $$
BEGIN
  SET LOCAL ROLE nexo_iso_gestao;
  PERFORM nexo_iso.definir_contexto('aaaaaaaa-0000-4000-8000-000000000001');
END
$$;
-- T19b: transacção seguinte sem contexto.
DO $$
DECLARE
  n int;
BEGIN
  SET LOCAL ROLE nexo_iso_gestao;
  SELECT count(*) INTO n FROM nexo_iso.produtos;
  IF n <> 0 THEN RAISE WARNING 'FALHOU T19 o contexto da transacção anterior passou (% linha(s))', n; RETURN; END IF;
  RAISE NOTICE 'OK T19 contexto local não passa para a transacção seguinte';
END
$$;
-- T20a: erro proibido no código — contexto de SESSÃO (is_local = false), incluindo a marca.
SELECT set_config('nexo.empresa_id', 'aaaaaaaa-0000-4000-8000-000000000001', false),
       set_config('nexo.inicio', extract(epoch FROM now())::text, false);
-- T20b: a transacção seguinte herda os valores de sessão, mas a marca não corresponde: nega tudo.
DO $$
DECLARE
  n int;
  herdado text;
BEGIN
  herdado := current_setting('nexo.empresa_id', true);
  SET LOCAL ROLE nexo_iso_gestao;
  SELECT count(*) INTO n FROM nexo_iso.produtos;
  IF n <> 0 THEN RAISE WARNING 'FALHOU T20 contexto de sessão herdado deu acesso a % linha(s)', n; RETURN; END IF;
  RAISE NOTICE 'OK T20 contexto de sessão herdado (empresa_id="%") é ignorado pela marca da transacção', herdado;
END
$$;
SELECT set_config('nexo.empresa_id', '', false), set_config('nexo.inicio', '', false);
