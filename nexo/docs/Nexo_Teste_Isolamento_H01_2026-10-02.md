# Nexo — Teste de isolamento H-01 no Supabase (02/10/2026)

Registo da execução de `backend/testes/isolamento/`. Análise e recomendação: `docs/Nexo_Arquitectura_Etapa_1.md`, secção 19.

| Item | Valor |
|---|---|
| Data | 02/10/2026 |
| Executado por | Proprietário do projecto |
| Ambiente | Projecto Supabase de **desenvolvimento** |
| Região | eu-west-1 |
| Versão do PostgreSQL | PostgreSQL 17.11 (confirmada no SQL Editor do projecto nexo-dev) |
| Preparação e T01–T20 | Session pooler, porta 5432 |
| P01 e P02 | Transaction pooler, porta 6543 |
| Correcção aplicada | `GRANT CREATE` temporário a `nexo_iso_autenticacao` antes de `ALTER FUNCTION … OWNER`, seguido de `REVOKE CREATE` (`01_preparar.sql`) |
| Resultado | **22/22 OK**, zero fugas (saída completa abaixo) |
| Limpeza | Esquema `nexo_iso` e papéis `nexo_iso_*` removidos |
| Decisão | **H-01 aprovada** pelo proprietário do projecto em 02/10/2026, com requisitos (arquitectura, 19.7) |

## Verificações

Conferido com a saída completa: os 22 estados coincidem.

| Teste | O que verifica | Estado |
|---|---|---|
| T01 | Papéis sem BYPASSRLS; `nexo_iso_api` NOINHERIT | OK |
| T02 | ENABLE + FORCE em todas as tabelas | OK |
| T03 | Sem SET ROLE a API não acede às tabelas | OK |
| T04 | Sem contexto: 0 linhas, escrita recusada | OK |
| T05 | Contexto sem marca da transacção ignorado | OK |
| T06 | Leitura limitada à empresa, mesmo com o identificador de B | OK |
| T07 | Inserir, alterar e mover para outra empresa recusados | OK |
| T08 | Chaves compostas recusam referências a outra empresa | OK |
| T09 | Controlo: a chave simples aceitaria o produto de B | OK |
| T10 | Operador sem acesso às tabelas de custos, também por junção | OK |
| T11 | `movimentos_stock` sem colunas de custo | OK |
| T12 | Nenhuma coluna de custo legível pelo operador | OK |
| T13 | Nenhum valor-sentinela de custo legível pelo operador | OK |
| T14 | Gestão lê só os custos da própria empresa | OK |
| T15 | Sincronização só escreve na empresa e no registo da credencial | OK |
| T16 | Sincronização sem acesso administrativo; `operacoes_sync` sem UPDATE/DELETE | OK |
| T17 | `autenticar_registo` devolve só o registo da credencial, sem contexto | OK |
| T18 | Nenhum papel da API pertence ao dono da função; o operador não a executa | OK |
| T19 | Contexto local não passa para a transacção seguinte | OK |
| T20 | Contexto de sessão residual ignorado pela marca da transacção | OK |
| P01 | Transaction pooler: 600 transacções concorrentes (A, B, sem contexto), zero fugas | OK |
| P02 | Transaction pooler: contexto de sessão residual não dá acesso, zero fugas | OK |

## Saída completa

Fornecida pelo proprietário do projecto e colada sem alterações. Não contém palavras-passe nem endereços de ligação.

```text
PS C:\Users\X1 CARBON\OneDrive\Documents\Projectos React\Nexo\nexo\backend> node testes/isolamento/executar.mjs --limpar-no-fim
Preparação concluída (esquema nexo_iso e papéis nexo_iso_*).
Esquema e papéis de teste removidos.
OK     T01 papéis sem BYPASSRLS; nexo_iso_api NOINHERIT
OK     T02 todas as tabelas com ENABLE + FORCE ROW LEVEL SECURITY
OK     T03 sem SET ROLE a API não acede às tabelas
OK     T04 sem contexto: 0 linhas e escrita recusada
OK     T05 contexto sem marca da transacção é ignorado
OK     T06 leitura limitada à empresa do contexto, mesmo com o identificador de B
OK     T07 inserir, alterar e mover para outra empresa recusados
OK     T08 chaves compostas recusam referências a outra empresa
OK     T09 controlo: a chave simples aceita o produto de B (as políticas não verificam a referência)
OK     T10 operador sem acesso às tabelas de custos (também por junção)
OK     T11 movimentos_stock sem custo_unitario nem valor
OK     T12 nenhuma coluna de custo legível pelo operador
OK     T13 nenhum valor-sentinela de custo nas linhas legíveis pelo operador
OK     T14 gestão lê os custos da própria empresa
OK     T15 sincronização só escreve na empresa e no registo da credencial
OK     T16 sincronização sem acesso administrativo; operacoes_sync sem UPDATE/DELETE
OK     T17 autenticar_registo devolve só o registo da credencial, sem contexto
OK     T18 nenhum papel da API pertence ao dono da função; a API executa-a, o operador não
OK     T19 contexto local não passa para a transacção seguinte
OK     T20 contexto de sessão herdado (empresa_id="aaaaaaaa-0000-4000-8000-000000000001") é ignorado pela marca da transacção
OK     P01 pooler: 600 transacções concorrentes (A, B, sem contexto), 0 com fuga
OK     P02 pooler: contexto de sessão residual não dá acesso (0 fugas em 300) — 200 transacções herdaram o valor residual; a marca da transacção anulou-o

22/22 verificações OK
PS C:\Users\X1 CARBON\OneDrive\Documents\Projectos React\Nexo\nexo\backend>
```

**Observações**

- A linha "Esquema e papéis de teste removidos." aparece antes dos resultados porque o script só os imprime no fim; a limpeza foi feita depois dos testes.
- **P02:** 200 das 300 transacções sem contexto herdaram o valor residual de sessão (`nexo.empresa_id`) deixado noutras transacções. Isto confirma que o Transaction pooler **passa estado de sessão entre clientes**. A marca da transacção anulou-o em todas: zero fugas. Por isso o contexto de sessão continua proibido no código, e a marca é uma defesa necessária, não redundante.
- **P01:** sem nenhuma transacção com fuga nas 600 concorrentes. Não indicou valores residuais, porque correu antes da contaminação deliberada de P02.

## Limites

O teste cobre um **esquema mínimo** (9 tabelas de teste). Não cobre as tabelas futuras nem a autorização da API (funções dentro da mesma empresa, limites, esquemas de resposta). Ver a arquitectura, 19.4.
