-- Verificação do catálogo depois das migrações (H-01, requisito R1).
-- Devolve uma linha por problema; nenhuma linha = tudo conforme.
-- Corre com a ligação administrativa (npx tsx src/base/migracoes/cli.ts verificar). Só lê o catálogo.
-- Exige PostgreSQL 16 ou posterior (colunas inherit_option e set_option de pg_auth_members).
-- Cresce com cada etapa: as regras são gerais e aplicam-se a todas as tabelas do esquema nexo.

WITH
papeis_execucao(nome) AS (VALUES ('nexo_operador'), ('nexo_gestao'), ('nexo_sincronizacao')),
papeis_nexo AS (SELECT r.* FROM pg_catalog.pg_roles r WHERE r.rolname LIKE 'nexo\_%'),
tabelas AS (
  SELECT c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_catalog.pg_get_userbyid(c.relowner) AS dono
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'nexo' AND c.relkind IN ('r', 'p')
),
funcoes AS (
  SELECT f.oid, f.oid::regprocedure::text AS nome, f.prosecdef, f.proconfig, f.proacl,
         pg_catalog.pg_get_userbyid(f.proowner) AS dono
    FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace n ON n.oid = f.pronamespace
   WHERE n.nspname = 'nexo'
)

-- 1. Papéis nexo_* sem privilégios administrativos nem BYPASSRLS.
SELECT 'papel_privilegiado' AS problema, rolname AS objecto
  FROM papeis_nexo WHERE rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication
UNION ALL
-- 2. A API não herda privilégios e é o único papel nexo_* com login.
SELECT 'nexo_api_herda_privilegios', rolname FROM papeis_nexo WHERE rolname = 'nexo_api' AND rolinherit
UNION ALL
SELECT 'papel_com_login_inesperado', rolname FROM papeis_nexo WHERE rolcanlogin AND rolname <> 'nexo_api'
UNION ALL
-- 3. A API não pertence ao dono dos objectos nem a papéis administrativos.
SELECT 'nexo_api_membro_de_papel_privilegiado', r.rolname
  FROM pg_catalog.pg_roles r
 WHERE r.rolname IN ('nexo_proprietario', 'nexo_diagnostico', 'postgres', 'service_role')
   AND pg_catalog.pg_has_role('nexo_api', r.oid, 'MEMBER')
UNION ALL
-- 4. Todas as tabelas do esquema nexo com ENABLE e FORCE ROW LEVEL SECURITY.
SELECT 'tabela_sem_rls_forcado', relname FROM tabelas WHERE NOT (relrowsecurity AND relforcerowsecurity)
UNION ALL
-- 5. Tabelas de negócio com empresa_id (a raiz nexo.empresas é a excepção).
SELECT 'tabela_sem_empresa_id', t.relname
  FROM tabelas t
 WHERE t.relname <> 'empresas'
   AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid = t.oid AND a.attname = 'empresa_id' AND NOT a.attisdropped)
UNION ALL
-- 6. Dono das tabelas: nexo_proprietario.
SELECT 'tabela_com_dono_inesperado', relname || ' (' || dono || ')' FROM tabelas WHERE dono <> 'nexo_proprietario'
UNION ALL
-- 7. Chaves estrangeiras entre tabelas com empresa_id têm de incluir empresa_id (compostas).
SELECT 'chave_estrangeira_sem_empresa', con.conname
  FROM pg_catalog.pg_constraint con
  JOIN pg_catalog.pg_namespace n ON n.oid = con.connamespace
 WHERE n.nspname = 'nexo' AND con.contype = 'f'
   AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid = con.confrelid AND a.attname = 'empresa_id' AND NOT a.attisdropped)
   AND NOT EXISTS (
     SELECT 1 FROM unnest(con.conkey) k(attnum)
       JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
      WHERE a.attname = 'empresa_id')
UNION ALL
-- 8. PUBLIC, anon e authenticated sem privilégios em tabelas do esquema nexo.
SELECT 'tabela_acessivel_a_' || g.nome, t.relname
  FROM tabelas t
 CROSS JOIN (VALUES ('public'), ('anon'), ('authenticated')) g(nome)
 WHERE (g.nome = 'public' AND EXISTS (
          SELECT 1 FROM pg_catalog.pg_class c, aclexplode(c.relacl) x WHERE c.oid = t.oid AND x.grantee = 0))
    OR (g.nome <> 'public' AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = g.nome)
        AND (pg_catalog.has_table_privilege(g.nome, t.oid, 'SELECT') OR pg_catalog.has_table_privilege(g.nome, t.oid, 'INSERT')))
UNION ALL
-- 9. A API (sem SET ROLE) não tem privilégios directos em tabelas.
SELECT 'nexo_api_com_privilegio_directo', t.relname
  FROM tabelas t
 WHERE pg_catalog.has_table_privilege('nexo_api', t.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
UNION ALL
-- 10. Nenhum papel de execução pode TRUNCATE nem ser dono.
SELECT 'papel_execucao_com_truncate', p.nome || ' em ' || t.relname
  FROM tabelas t CROSS JOIN papeis_execucao p
 WHERE pg_catalog.has_table_privilege(p.nome, t.oid, 'TRUNCATE')
UNION ALL
-- 11. Funções do esquema nexo não executáveis por PUBLIC (proacl nulo = EXECUTE para PUBLIC).
SELECT 'funcao_executavel_por_public', nome
  FROM funcoes f
 WHERE f.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(f.proacl) x WHERE x.grantee = 0 AND x.privilege_type = 'EXECUTE')
UNION ALL
-- 12. Funções SECURITY DEFINER com search_path fixo e dono que não é papel de execução nem a API.
SELECT 'funcao_definer_sem_search_path', nome
  FROM funcoes WHERE prosecdef AND NOT coalesce(EXISTS (SELECT 1 FROM unnest(proconfig) c WHERE c LIKE 'search_path=%'), false)
UNION ALL
SELECT 'funcao_definer_com_dono_inseguro', nome || ' (' || dono || ')'
  FROM funcoes WHERE prosecdef AND dono IN ('nexo_api', 'nexo_operador', 'nexo_gestao', 'nexo_sincronizacao', 'nexo_proprietario', 'postgres')
UNION ALL
-- 13. O dono da função de diagnóstico não ficou com CREATE no esquema (R5: o CREATE é temporário).
SELECT 'dono_de_funcao_com_create', r.rolname
  FROM pg_catalog.pg_roles r
 WHERE r.rolname IN ('nexo_diagnostico', 'nexo_autenticacao')
   AND pg_catalog.has_schema_privilege(r.oid, 'nexo', 'CREATE')
UNION ALL
-- 14. Nenhuma coluna com nome de custo legível pelo operador (arquitectura 3.7.2).
SELECT 'coluna_de_custo_legivel_pelo_operador', t.relname || '.' || a.attname
  FROM tabelas t JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid
 WHERE a.attnum > 0 AND NOT a.attisdropped
   AND a.attname ~ '(custo|margem|cmv|valor_stock|valorizacao)'
   AND pg_catalog.has_column_privilege('nexo_operador', t.oid, a.attnum, 'SELECT')
UNION ALL
-- 15. O esquema de controlo das migrações não é acessível à API nem aos papéis de execução.
SELECT 'controlo_acessivel', p.nome
  FROM (VALUES ('nexo_api'), ('nexo_operador'), ('nexo_gestao'), ('nexo_sincronizacao')) p(nome)
 WHERE pg_catalog.has_schema_privilege(p.nome, 'nexo_controlo', 'USAGE')
UNION ALL
-- 16. Nenhum papel do Nexo tem ADMIN OPTION sobre outro papel (não pode distribuir pertenças).
SELECT 'papel_nexo_com_admin_option', u.rolname || ' sobre ' || r.rolname
  FROM pg_catalog.pg_auth_members m
  JOIN pg_catalog.pg_roles r ON r.oid = m.roleid
  JOIN pg_catalog.pg_roles u ON u.oid = m.member
 WHERE u.rolname LIKE 'nexo\_%' AND m.admin_option
UNION ALL
-- 17. nexo_api pertence exactamente aos três papéis de execução, com SET e sem herança.
SELECT 'nexo_api_pertenca_inesperada', r.rolname
  FROM pg_catalog.pg_auth_members m
  JOIN pg_catalog.pg_roles r ON r.oid = m.roleid
  JOIN pg_catalog.pg_roles u ON u.oid = m.member
 WHERE u.rolname = 'nexo_api' AND r.rolname NOT IN ('nexo_operador', 'nexo_gestao', 'nexo_sincronizacao')
UNION ALL
SELECT 'nexo_api_pertenca_com_heranca_ou_sem_set', r.rolname
  FROM pg_catalog.pg_auth_members m
  JOIN pg_catalog.pg_roles r ON r.oid = m.roleid
  JOIN pg_catalog.pg_roles u ON u.oid = m.member
 WHERE u.rolname = 'nexo_api' AND (m.inherit_option OR NOT m.set_option)
UNION ALL
SELECT 'nexo_api_sem_papel_de_execucao', p.nome
  FROM papeis_execucao p
 WHERE NOT pg_catalog.pg_has_role('nexo_api', p.nome, 'SET')
UNION ALL
-- 18. Os outros papéis do Nexo não pertencem a nenhum papel (sem cadeias de herança).
SELECT 'papel_nexo_com_pertenca', u.rolname || ' em ' || r.rolname
  FROM pg_catalog.pg_auth_members m
  JOIN pg_catalog.pg_roles r ON r.oid = m.roleid
  JOIN pg_catalog.pg_roles u ON u.oid = m.member
 WHERE u.rolname LIKE 'nexo\_%' AND u.rolname <> 'nexo_api'
UNION ALL
-- 19. SET ROLE para os donos: ninguém tem SET sobre os donos de funções (a pertença usada na
--     transferência é temporária), e nenhum papel do Nexo pode assumir nexo_proprietario.
SELECT 'set_role_sobre_dono_de_funcao', u.rolname || ' sobre ' || r.rolname
  FROM pg_catalog.pg_auth_members m
  JOIN pg_catalog.pg_roles r ON r.oid = m.roleid
  JOIN pg_catalog.pg_roles u ON u.oid = m.member
 WHERE r.rolname IN ('nexo_diagnostico', 'nexo_autenticacao') AND m.set_option
UNION ALL
SELECT 'papel_nexo_pode_assumir_proprietario', u.rolname
  FROM pg_catalog.pg_roles u
 WHERE u.rolname LIKE 'nexo\_%' AND u.rolname <> 'nexo_proprietario'
   AND pg_catalog.pg_has_role(u.oid, 'nexo_proprietario', 'SET')
UNION ALL
-- 20. Propriedade: o esquema nexo é de nexo_proprietario; as funções são de nexo_proprietario
--     ou de um dono dedicado, e as SECURITY DEFINER têm sempre dono dedicado.
SELECT 'esquema_nexo_com_dono_inesperado', pg_catalog.pg_get_userbyid(nspowner)
  FROM pg_catalog.pg_namespace WHERE nspname = 'nexo' AND pg_catalog.pg_get_userbyid(nspowner) <> 'nexo_proprietario'
UNION ALL
SELECT 'funcao_com_dono_inesperado', nome || ' (' || dono || ')'
  FROM funcoes WHERE dono NOT IN ('nexo_proprietario', 'nexo_diagnostico', 'nexo_autenticacao')
UNION ALL
SELECT 'funcao_definer_sem_dono_dedicado', nome || ' (' || dono || ')'
  FROM funcoes WHERE prosecdef AND dono NOT IN ('nexo_diagnostico', 'nexo_autenticacao')
ORDER BY 1, 2;
