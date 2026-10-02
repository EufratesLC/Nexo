-- Teste de isolamento H-01 — dados fictícios de duas empresas.
-- Executar como administrador, depois de 01_preparar.sql.
--
-- Os custos usam valores-sentinela fáceis de procurar (1234567, 7654321, 2222222) para o teste
-- que verifica que nenhum custo aparece nos dados legíveis pelo operador.
-- Os "segredos" das credenciais são textos de teste, públicos; não são credenciais reais.

-- O dono também está sujeito às políticas (FORCE). Para carregar os dados, retira-se o FORCE
-- durante este script e repõe-se no fim.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'nexo_iso' LOOP
    EXECUTE format('ALTER TABLE nexo_iso.%I NO FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

INSERT INTO nexo_iso.empresas (id, nome) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Empresa A (fictícia)'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'Empresa B (fictícia)');

INSERT INTO nexo_iso.membros (id, empresa_id, nome, funcao) VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'Gestor A', 'gestor'),
  ('bbbbbbbb-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-000000000001', 'Gestor B', 'gestor');

INSERT INTO nexo_iso.registos_dispositivo (id, empresa_id, filial_id, codigo, credencial_hash, estado) VALUES
  ('aaaaaaaa-0000-4000-8000-00000000c001', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-00000000f001', 'C01',
   sha256(convert_to('teste-isolamento-A-C01', 'UTF8')), 'activo'),
  ('aaaaaaaa-0000-4000-8000-00000000c002', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-00000000f001', 'C02',
   sha256(convert_to('teste-isolamento-A-C02', 'UTF8')), 'activo'),
  ('bbbbbbbb-0000-4000-8000-00000000c001', 'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-00000000f001', 'C01',
   sha256(convert_to('teste-isolamento-B-C01', 'UTF8')), 'activo');

INSERT INTO nexo_iso.produtos (id, empresa_id, nome, preco_venda) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000101', 'aaaaaaaa-0000-4000-8000-000000000001', 'Arroz A', 45000),
  ('bbbbbbbb-0000-4000-8000-000000000101', 'bbbbbbbb-0000-4000-8000-000000000001', 'Arroz B', 47000);

INSERT INTO nexo_iso.movimentos_stock (id, empresa_id, produto_id, tipo, quantidade) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000201', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000101', 'recepcao', 10),
  ('bbbbbbbb-0000-4000-8000-000000000201', 'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000101', 'recepcao', 20);

INSERT INTO nexo_iso.valorizacao_movimentos (movimento_id, empresa_id, custo_unitario, valor) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000201', 'aaaaaaaa-0000-4000-8000-000000000001', 1234567, 12345670),
  ('bbbbbbbb-0000-4000-8000-000000000201', 'bbbbbbbb-0000-4000-8000-000000000001', 7654321, 153086420);

INSERT INTO nexo_iso.vendas (id, empresa_id, registo_id, total) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000301', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-00000000c001', 90000),
  ('bbbbbbbb-0000-4000-8000-000000000301', 'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-00000000c001', 47000);

INSERT INTO nexo_iso.itens_venda (id, empresa_id, venda_id, produto_id, quantidade, liquido) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000401', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000301',
   'aaaaaaaa-0000-4000-8000-000000000101', 2, 90000),
  ('bbbbbbbb-0000-4000-8000-000000000401', 'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000301',
   'bbbbbbbb-0000-4000-8000-000000000101', 1, 47000);

INSERT INTO nexo_iso.custos_item_venda (item_venda_id, empresa_id, custo_registado) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000401', 'aaaaaaaa-0000-4000-8000-000000000001', 2222222),
  ('bbbbbbbb-0000-4000-8000-000000000401', 'bbbbbbbb-0000-4000-8000-000000000001', 7654321);

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'nexo_iso' LOOP
    EXECUTE format('ALTER TABLE nexo_iso.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;
