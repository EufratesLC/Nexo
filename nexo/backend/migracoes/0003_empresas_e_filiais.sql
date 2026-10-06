-- nexo:executar-como nexo_proprietario
--
-- 0003 — Raízes do isolamento: empresas e filiais.
--
-- Só os objectos mínimos de que as etapas seguintes dependem. Nada aqui depende de H-02
-- (identidade), H-04/H-21 (custo), H-23 (autoria), H-28 ou H-29. Membros, utilizadores,
-- dispositivos e tabelas comerciais entram nas etapas respectivas.
--
-- Nesta etapa a API só LÊ: a criação de empresa (C.1) é da Etapa 3, com o fluxo de identidade.

CREATE TABLE nexo.empresas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 200),
  nuit text CHECK (nuit ~ '^[0-9]{9}$'),
  tipo text NOT NULL DEFAULT 'loja' CHECK (tipo = 'loja'),
  moeda text NOT NULL DEFAULT 'MZN' CHECK (moeda = 'MZN'),
  fuso text NOT NULL DEFAULT 'Africa/Maputo',
  criada_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE nexo.filiais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES nexo.empresas (id),
  codigo text NOT NULL CHECK (codigo ~ '^F[0-9]{2,}$'),
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 200),
  criada_em timestamptz NOT NULL DEFAULT now(),
  -- Alvo das chaves estrangeiras compostas (empresa_id, filial_id) das tabelas futuras.
  UNIQUE (empresa_id, id),
  UNIQUE (empresa_id, codigo)
);

ALTER TABLE nexo.empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexo.empresas FORCE ROW LEVEL SECURITY;
ALTER TABLE nexo.filiais ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexo.filiais FORCE ROW LEVEL SECURITY;

-- Primeira barreira: privilégios. Só leitura nesta etapa.
REVOKE ALL ON nexo.empresas, nexo.filiais FROM PUBLIC;
GRANT SELECT ON nexo.empresas, nexo.filiais TO nexo_operador, nexo_gestao, nexo_sincronizacao;

-- Segunda barreira: linhas só da empresa do contexto.
CREATE POLICY empresas_ler ON nexo.empresas FOR SELECT
  TO nexo_operador, nexo_gestao, nexo_sincronizacao
  USING (id = nexo.empresa_actual());

CREATE POLICY filiais_ler ON nexo.filiais FOR SELECT
  TO nexo_operador, nexo_gestao, nexo_sincronizacao
  USING (empresa_id = nexo.empresa_actual());
