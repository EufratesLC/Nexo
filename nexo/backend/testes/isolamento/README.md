# Teste de isolamento no Supabase (H-01)

**Estado: EXECUTADO no Supabase de desenvolvimento a 02/10/2026** pelo proprietário do projecto (região eu-west-1): **22/22 OK**, zero fugas; esquema e papéis de teste removidos no fim. PostgreSQL 17.11. Registo: `docs/Nexo_Teste_Isolamento_H01_2026-10-02.md`. Antes disso, verificação local em PGlite: 20/20.

**Cobre um esquema mínimo**, não todas as tabelas futuras nem a autorização da API.

Estes ficheiros **não são as migrações definitivas**. Usam um esquema separado (`nexo_iso`) e papéis de teste (`nexo_iso_*`) que se apagam no fim. O desenho que testam está em `docs/Nexo_Arquitectura_Etapa_1.md`, secções 3, 3.7 e 19.

## O que prova

| Pedido | Testes |
|---|---|
| Duas empresas com dados distintos | `02_dados.sql` |
| Leituras e escritas entre empresas recusadas | T06, T07 |
| Chaves estrangeiras entre empresas recusadas | T08; T09 é o controlo (uma chave simples aceitaria) |
| Pedidos sem contexto | T04, T05 |
| Sem fuga de contexto entre transacções | T19, T20 na mesma ligação; P01, P02 no pooler |
| Papéis de execução sem BYPASSRLS | T01, T02, T03 |
| Operador sem acesso a custos | T10–T14 |
| Sincronização limitada à empresa e ao registo | T15, T16 |
| `autenticar_registo` sem contexto e sem acesso genérico | T17, T18 |

## Requisitos

- Um projecto Supabase **de desenvolvimento**, criado para isto. **Nunca produção.**
- Node.js 22 e o pacote `pg`, instalado só para este teste: `npm install --no-save pg` (na pasta `backend`).
- Em alternativa ao Node, `psql` para os ficheiros `00` a `03` (sem os testes de pool).

## Preparar as ligações

No painel do projecto de desenvolvimento, em *Connect*:

| Variável | Ligação | Utilizador |
|---|---|---|
| `NEXO_ISO_ADMIN_URL` | Directa ou **Session pooler** (porta 5432) | `postgres` |
| `NEXO_ISO_API_URL` | Directa ou **Session pooler** (porta 5432) | `nexo_iso_api` (no pooler: `nexo_iso_api.<referência-do-projecto>`) |
| `NEXO_ISO_POOL_URL` | Pooler em **modo transacção** (porta 6543) | `nexo_iso_api.<referência-do-projecto>` |
| `NEXO_ISO_SENHA_API` | — | Palavra-passe que o script atribui a `nexo_iso_api`. Escolha uma nova, só para este teste |
| `NEXO_ISO_CONFIRMO_DESENVOLVIMENTO` | — | `sim` |

As palavras-passe vão **só em variáveis de ambiente** da sessão do terminal. Não as escreva em ficheiros do projecto.

```powershell
# PowerShell, na pasta backend (exemplo; substitua os valores)
$env:NEXO_ISO_CONFIRMO_DESENVOLVIMENTO = 'sim'
$env:NEXO_ISO_ADMIN_URL = 'postgresql://postgres:…@db.<ref>.supabase.co:5432/postgres'
$env:NEXO_ISO_SENHA_API = '…'
$env:NEXO_ISO_API_URL  = 'postgresql://nexo_iso_api:…@db.<ref>.supabase.co:5432/postgres'
$env:NEXO_ISO_POOL_URL = 'postgresql://nexo_iso_api.<ref>:…@aws-0-<região>.pooler.supabase.com:6543/postgres'
npm install --no-save pg
node testes/isolamento/executar.mjs --limpar-no-fim
```

Com `psql`, sem os testes de pool:

```powershell
psql $env:NEXO_ISO_ADMIN_URL -v ON_ERROR_STOP=1 -f testes/isolamento/00_limpar.sql -f testes/isolamento/01_preparar.sql
psql $env:NEXO_ISO_ADMIN_URL -c "\password nexo_iso_api"
psql $env:NEXO_ISO_ADMIN_URL -v ON_ERROR_STOP=1 -f testes/isolamento/02_dados.sql
psql $env:NEXO_ISO_API_URL -f testes/isolamento/03_testes.sql 2>&1 | Select-String "OK T|FALHOU"
psql $env:NEXO_ISO_ADMIN_URL -f testes/isolamento/00_limpar.sql
```

## Resultado esperado

- `executar.mjs`: 22 verificações OK (T01–T20, P01, P02) e código de saída 0.
- Com `psql`: 20 linhas `OK T01` a `OK T20` e nenhuma `FALHOU`.
- T09 diz "OK" quando a chave **simples** aceita o produto da outra empresa. É um controlo: mostra porque o modelo usa chaves compostas.
- P02 pode indicar que algumas transacções **herdaram** um valor residual de sessão. É o esperado: prova que o pool passa estado de sessão entre clientes, e que a marca da transacção o anula (nenhuma fuga).

Registe o resultado (data, região, versão do PostgreSQL do projecto, saída completa) em `docs/Nexo_Arquitectura_Etapa_1.md`, secção 19, e mude o estado para executado.

Na execução de 02/10/2026 usou-se o Session pooler (5432) para a preparação e T01–T20, e o Transaction pooler (6543) para P01 e P02.

**Correcção de 02/10/2026:** `01_preparar.sql` dá `CREATE` no esquema a `nexo_iso_autenticacao` só durante o `ALTER FUNCTION … OWNER`, e retira-o a seguir. Sem isso, a mudança de dono falha num utilizador que não seja superutilizador.

## Limitações

- Esquema **mínimo**: prova o mecanismo (papéis, contexto, políticas, chaves compostas, função de autenticação), não cada tabela do modelo. As migrações definitivas terão de repetir estes testes para todas as tabelas.
- O dono das tabelas de teste é o administrador que corre o script, para simplificar a limpeza. No desenho, o dono é um papel próprio de migrações. Os testes nunca correm como dono.
- Não testa a API: as verificações de função dentro da mesma empresa e os esquemas de resposta são testes da API (C-API-1 a 7, propostos).
- No PGlite (verificação local) não havia pooler, papéis do Supabase, nem utilizador `postgres` sem superutilizador. Por isso P01 e P02 não correram aí, e a falta de `CREATE` para o novo dono só apareceu no Supabase.
