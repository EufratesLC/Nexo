# Nexo — Entrega da Etapa 2 (preparação do projecto)

Versão 0.4 · 6 de Outubro de 2026 · Estado: **Etapa 2 não concluída.** A base técnica está montada e verificada, incluindo no Supabase nexo-dev (resultados do proprietário de 06/10/2026, secção 14). Falta o critério do roteiro: **outro programador** arrancar aplicação, API e base de dados seguindo o guia (secção 18).

Roteiro, Etapa 2: *"Criar uma base executável e repetível. Criar repositório, frontend, backend, migrações, variáveis de ambiente de exemplo e guia de execução. Configurar qualidade de código, tratamento de erros, registo de eventos e ambientes de desenvolvimento. Preparar a PWA e a base local sem activar ainda todos os fluxos offline. Concluída quando: outro programador consegue iniciar aplicação, API e base de dados seguindo o guia."*

Ponto de partida, sem alterações:

- **H-01** foi aprovada pelo proprietário do projecto em 02/10/2026. A prova no Supabase de desenvolvimento deu 22/22 em PostgreSQL 17.11, e o registo já estava nos documentos.
- **Nenhuma outra decisão** foi marcada como aprovada.
- O protótipo da Etapa 1 foi **preservado**: ecrãs, fluxo e dados fictícios.
- **Não foi iniciada a Etapa 3**: não há autenticação real nem módulos comerciais.

Guia de execução: `docs/Nexo_Ambientes.md`.

**Como ler este documento:**

- As secções 1 a 11 descrevem a entrega de 03/10/2026, com o estado que tinha nessa data.
- As secções 12 e 13 são as correcções de 06/10/2026.
- As secções 14 a 19 têm o **estado actual**: resultados executados pelo proprietário do projecto no nexo-dev, testes executados por mim, critérios e o que falta.
- Onde uma secção antiga diz "não executado", há uma nota a apontar para o resultado actual.
- **Quem executou:** "proprietário" = resultados confirmados pelo proprietário do projecto no Supabase nexo-dev; "local" = testes executados por mim neste computador.

---

## 1. Alterações e motivos

### 1.1 Backend (`backend/`)

| Alteração | Ficheiros | Motivo |
|---|---|---|
| Configuração validada no arranque | `src/config/ambiente.ts` | Falha cedo, com mensagens sem valores. Recusa utilizadores administrativos na ligação da API (R3). Exige o certificado para servidores remotos e recusa `sslmode` que não valida |
| Aplicação separada do arranque | `src/app.ts`, `src/server.ts` | Testar as rotas sem abrir portas nem ligar à base |
| Rotas versionadas | `src/rotas/v1.ts` | `/api/v1/saude` (processo) e `/api/v1/saude/base` (base). A antiga `/api/health` foi retirada |
| Validação de pedidos | `src/http/validar.ts` | zod, erro `400 validacao` com os campos inválidos; aplicada às rotas da prova de assinatura |
| Erros centralizados | `src/http/erros.ts` | Formato único da arquitectura (6.1), com `pedidoId`. Os erros inesperados nunca mostram a mensagem interna |
| Identificação dos pedidos | `src/http/pedido.ts` | `X-Nexo-Pedido` em cada resposta e em cada linha de log. O valor do cliente só é aceite se for um UUID |
| Logs sem segredos | `src/registo/logger.ts`, `src/registo/sanitizar.ts` | JSON numa linha (pino). Apaga cabeçalhos de autorização e limpa ligações, JWT, credenciais `nd_` e `password=`. Regista só o caminho, sem a query |
| CORS por lista | `src/app.ts` | Só as origens de `CORS_ORIGENS`; as outras recebem `403 origem_nao_permitida` |
| Encerramento ordenado | `src/encerramento.ts` | Fecha primeiro o HTTP (e espera pelos pedidos em curso), depois as ligações à base. Termina à força ao fim de 10 s |
| Prova de assinatura | `src/app.ts`, `src/prova/assinatura.ts` | Só existe com `NEXO_AMBIENTE=desenvolvimento`. Leva o cabeçalho `X-Nexo-Aviso: prova-tecnica; nao-e-autenticacao` |
| Acesso à base | `src/base/acesso.ts`, `src/base/contexto.ts` | Secção 2 |
| Migrações e comandos `db:*` | `migracoes/`, `src/base/migracoes/` | Secção 3 |
| Linter | `.oxlintrc.json` | O backend não tinha. `console` só no CLI e nos testes |

### 1.2 Frontend (`frontend/`)

| Alteração | Ficheiros | Motivo |
|---|---|---|
| Configuração de ambiente | `src/config/ambiente.ts`, `.env.example` | `VITE_NEXO_MODO` (`demonstracao` / `api`), `VITE_NEXO_API_URL`, tempo limite |
| Cliente HTTP central | `src/servicos/http.ts` | Base da API, JSON, `X-Nexo-Pedido`, tempo limite. Erros convertidos em `ErroApi` com códigos estáveis (`sem_ligacao`, `tempo_esgotado`, códigos da API). **Recusa escritas no modo de demonstração** |
| Serviços reais | `src/servicos/saude.ts` | Só leitura; separados dos dados fictícios (`src/demo/`) |
| Estados comuns | `src/components/estados.tsx`, `src/lib/useRecurso.ts` | `Carregando`, `EstadoErro` (com "Tentar de novo" e o identificador do pedido); `EstadoVazio` já existia |
| Separação demonstração / infraestrutura | `src/App.tsx`, `src/app/ModoApi.tsx`, `src/app/menu.ts`, `src/app/Shell.tsx` | O modo escolhe a árvore inteira. O menu separa os ecrãs de demonstração da "Infraestrutura real" |
| Estado do sistema | `src/features/sistema/EstadoSistema.tsx` | Mostra a API e a base reais. Avisa que está fora da demonstração |
| PWA (preparação) | `public/manifest.webmanifest`, `public/sw.js`, `public/icone.svg`, `src/pwa/registar.ts`, `src/components/AvisoActualizacao.tsx` | Secção 4 |
| Base local e contratos (preparação) | `src/local/esquema.ts`, `src/local/baseLocal.ts`, `src/local/contratos.ts` | Secção 4 |
| `vite.config.ts` | — | Proxy configurável (`NEXO_API_PROXY`) e HTTPS opcional. **Recusa arrancar se um `VITE_*` tiver aspecto de segredo** |
| Rotas | `src/app/rotas.ts` | Mantido o encaminhamento por hash. Uma biblioteca de rotas só entra quando houver rotas reais com dados (Etapa 3+) |

### 1.3 Repositório e documentação

- `.gitignore`: acrescentados `certificados/`, `*.pem`, `*.key`, `*.crt` e `*.p12`. Confirmado que `backend/.env` e `frontend/.env.local` estão ignorados.
- Novos: `docs/Nexo_Ambientes.md` e este documento.
- Actualizados: `README.md`, a arquitectura (versão 0.5) e `frontend/testes/fluxo/README.md`.

---

## 2. Ligação ao PostgreSQL e transacções

`src/base/acesso.ts` é o **único** módulo que fala com a base na API. O pool não é exportado.

**Ligação:**

- `DATABASE_URL` com o papel `nexo_api` pelo **Transaction pooler** (H-01).
- TLS com o certificado indicado em `DB_CA_CERT_FICHEIRO` e `rejectUnauthorized: true`.
- Em nenhum ponto do código há `rejectUnauthorized: false` (verificado por teste).

**`executarTransaccao({ papel, contexto }, trabalho)`:**

1. O papel é uma chave de uma **lista fixa** (`operador`, `gestao`, `sincronizacao` → `nexo_operador`, `nexo_gestao`, `nexo_sincronizacao`). Qualquer outro valor é recusado **antes** de pedir ligação.
2. O contexto tem de ser um `ContextoVerificado` (marcado com um símbolo interno) ou `SEM_CONTEXTO`. Nesta etapa **não existe nenhuma função que o crie a partir de um pedido**. O único criador, `contexto.testes.ts`, só funciona com `NEXO_AMBIENTE=teste`. Na Etapa 3, empresa, utilizador e função virão do JWT verificado e do membro lido na base.
3. A transacção corre assim: `BEGIN` → `SET LOCAL ROLE <papel>` → `SET LOCAL statement_timeout = '15s'` → `nexo.definir_contexto(…)` → trabalho → `COMMIT`.
4. Em erro, faz `ROLLBACK` e propaga o erro.
5. A ligação é libertada em todos os caminhos. Se o `ROLLBACK` falhar, é **destruída** em vez de voltar ao pool.
6. Dentro do trabalho, o cliente só aceita consultas comuns:
   - recusa `BEGIN`/`COMMIT`/`ROLLBACK`, `SET`/`RESET`, `SET ROLE`, `set_config`, `definir_contexto`, `DO` e `DISCARD`, entre outros;
   - usa o protocolo estendido, logo uma instrução por chamada;
   - deixa de funcionar quando a transacção termina.

**`diagnosticar()`:**

- corre como `nexo_api`, numa transacção só de leitura;
- confirma que o papel não é superutilizador, não tem BYPASSRLS e não herda privilégios;
- lê a versão das migrações por `nexo.estado_base()`.

No arranque, se o papel for inseguro, a API **recusa arrancar**.

**Limitação conhecida do guarda:** a recusa de `SET ROLE` procura o texto `set role`. Uma coluna chamada `role` num `UPDATE … SET role = …` seria recusada por engano. O modelo usa nomes em português (`funcao`), por isso não acontece hoje.

---

## 3. Migrações

Esquema do produto: **`nexo`**. Não reutiliza `nexo_iso`, e um teste confirma que nenhuma migração o refere. O controlo das migrações fica em `nexo_controlo`, sem acesso para a API.

| Versão | Corre como | Conteúdo |
|---|---|---|
| `0001_papeis_e_esquemas` | administrador | Papéis `nexo_proprietario` (dono), `nexo_api` (login, NOINHERIT), `nexo_operador`, `nexo_gestao`, `nexo_sincronizacao` e `nexo_diagnostico`, todos NOBYPASSRLS. Esquema `nexo` sem PUBLIC. Funções novas sem EXECUTE para PUBLIC. `anon`/`authenticated` sem acesso. Procedimento `nexo_controlo.transferir_dono_funcao` (R5: **`GRANT CREATE` temporário → `ALTER FUNCTION … OWNER` → `REVOKE CREATE`**) |
| `0002_contexto` | `nexo_proprietario` | `definir_contexto`, `empresa_actual`, `filial_actual`, `utilizador_actual`, `funcao_actual`, `registo_actual`, `contexto_valido` e `marca_transaccao`. EXECUTE só para os papéis de execução |
| `0003_empresas_e_filiais` | `nexo_proprietario` | `nexo.empresas` e `nexo.filiais`: ENABLE + FORCE RLS, só leitura para os papéis de execução, políticas por empresa. `UNIQUE (empresa_id, id)` em filiais, alvo das chaves compostas futuras |
| `0004_diagnostico` | administrador | `nexo.estado_base()` (SECURITY DEFINER, `search_path` fixo), com dono `nexo_diagnostico` transferido pelo procedimento de R5. EXECUTE só para `nexo_api` |

**O que NÃO foi criado, de propósito:**

- membros e utilizadores (H-02);
- produtos, stock e custos (H-04/H-21, H-29);
- registos de dispositivo e `autenticar_registo` (P-2, H-23);
- tudo o que é comercial.

Também não há escritas da API: a criação de empresa (C.1) é da Etapa 3.

**Verificação do catálogo** (`migracoes/verificacoes.sql`, `npx tsx src/base/migracoes/cli.ts verificar`, R1) — regras gerais, que se aplicam a todas as tabelas futuras do esquema `nexo`:

- papéis nexo_* sem privilégios administrativos nem BYPASSRLS, com `nexo_api` NOINHERIT;
- ENABLE + FORCE em todas as tabelas, todas com `empresa_id` (excepto `empresas`) e dono `nexo_proprietario`;
- chaves estrangeiras com `empresa_id`;
- nada para PUBLIC, `anon` ou `authenticated`;
- `nexo_api` sem privilégios directos nas tabelas;
- nenhum papel de execução com TRUNCATE;
- funções sem EXECUTE para PUBLIC;
- funções SECURITY DEFINER com `search_path` fixo e dono seguro;
- o dono de cada função sem CREATE no esquema depois da transferência;
- nenhuma coluna de custo legível pelo operador;
- `nexo_controlo` inacessível à API.

**Comandos** (`docs/Nexo_Ambientes.md`, secção 2; desde 06/10 com `npx tsx src/base/migracoes/cli.ts …`): `estado`, `migrar --confirmo <alvo>`, `verificar` e `senha-api --confirmo <alvo>`. Funcionam assim:

- cada migração corre numa transacção, com bloqueio para não haver dois executores;
- uma migração aplicada nunca é reaplicada, e se tiver sido alterada o executor pára;
- não há reset nem DROP;
- os comandos recusam o Transaction pooler e `NEXO_AMBIENTE=producao`.

A palavra-passe de `nexo_api` é enviada só como resumo SCRAM-SHA-256, como faz o `\password` do psql (conferido com o vector da RFC 7677).

**Estado de execução:**

| Onde | Estado |
|---|---|
| **Supabase nexo-dev** | 03/10: não executado (sem ligação neste computador). 06/10: primeira tentativa falhou na 0001 e foi revertida (secção 12); depois da correcção, **0001–0004 aplicadas pelo proprietário**, verificação do catálogo OK (secção 14) |
| PostgreSQL local de verificação (PGlite 0.5.8, PostgreSQL 18.3, servido por `@electric-sql/pglite-socket` numa pasta temporária, **fora do projecto**) | Executado com os comandos reais: 4 migrações aplicadas; segunda execução "Nada a aplicar"; `db:verificar` OK |

---

## 4. PWA e armazenamento local (preparação, sem activar fluxos offline)

| Tema | Feito nesta etapa | Fica para a Etapa 7 |
|---|---|---|
| PWA e service worker | Manifesto e ícone. Service worker que guarda **só a aplicação** (index.html e `/assets/`), nunca `/api/` nem pedidos que não sejam GET. Abre sem rede depois da primeira visita. Uma versão nova fica à espera até o utilizador carregar em "Actualizar agora". Registado só nas builds de produção | Activar a actualização só sem venda em curso e depois de enviar a fila |
| IndexedDB | Esquema v1 com 17 lojas (arquitectura 5), migrações **aditivas**, nome por empresa e registo. **A aplicação não abre esta base**: só o teste automático, numa base de teste que depois apaga | Abrir a base do registo, gravar a referência e as operações |
| Fila persistente | Contratos (tipos) `EnvelopeOperacao`, `FilaOperacoes`, `ResultadoOperacao`, sem implementação | Gravação atómica venda + fila + sequências |
| Sincronização | Contrato `Sincronizador`, sem implementação | Envio, reenvio, estados reais |
| Autoria offline (H-23) | **Nada.** A loja `autorias` não foi criada e o envelope não define o formato da autoria | Depois da decisão H-23 |
| Custos no dispositivo (H-28) | **Nada** | Depois da decisão H-28 |

Os dados fictícios continuam em `localStorage` e **não** foram copiados para IndexedDB. Não são operações reais, e um teste confirma que não existe nenhuma base `nexo-*`.

---

## 5. Revisão da marca da transacção (antes de a generalizar)

**Na prova H-01**, a marca era `extract(epoch from now())`: o início da transacção, ao microssegundo.

**Na migração 0002 passa a ser** `pg_backend_pid() || ':' || extract(epoch from now())`, com mais três regras:

1. só é aceite quando corresponde à transacção actual;
2. `definir_contexto` recusa uma segunda definição na mesma transacção (`25000`);
3. `definir_contexto` recusa ser chamada fora de um papel de execução (`42501`) e recusa funções desconhecidas (`22023`).

**O que protege:**

- Valores de contexto que fiquem na **sessão** (`set_config(…, false)`, proibido no código) e passem, no pool, para a transacção de outro cliente. A marca não corresponde ao início dessa transacção, e as políticas negam tudo. A prova H-01 (P02) mostrou que o Transaction pooler **passa** estado de sessão entre clientes, por isso esta defesa é necessária.
- Contexto definido sem passar por `definir_contexto` (sem marca válida).
- Mudança de empresa a meio de uma transacção.

**O que NÃO protege (limites):**

- **Código com SQL livre dentro da API:** qualquer papel pode chamar `set_config` e reproduzir a marca. A defesa contra isso está no código (o guarda de `executarTransaccao` recusa `set_config` e `definir_contexto`, e os testes procuram `set_config(…, false)` e `SET ROLE` no código-fonte) e na revisão.
- **Uma API comprometida:** define o contexto que quiser (arquitectura 3.5).
- **Autorização dentro da mesma empresa** (funções, limites, filiais): é verificada na API, e os testes dessa parte são da Etapa 3 (R2).
- **Um papel residual de sessão** (`SET ROLE` sem `LOCAL`) não é coberto pela marca. Fica mitigado porque cada transacção faz `SET LOCAL ROLE` primeiro e o código não pode fazer `SET ROLE`.
- **Coincidência temporal:** duas transacções seguidas no mesmo processo só têm a mesma marca se começarem no mesmo microssegundo, o que exige o relógio do servidor a andar para trás.
- **Desempenho:** as funções das políticas têm `search_path` fixo, o que impede o PostgreSQL de as expandir em linha. O custo tem de ser medido com volumes reais (Etapa 10).

**Prova:** a prova H-01 (22/22) usou a marca **anterior**, no esquema `nexo_iso`. A marca nova foi testada **só no PostgreSQL local** de verificação, onde os testes T05/T20 equivalentes e o de mutação (secção 6.3) passaram. **Falta testá-la no nexo-dev pelo Transaction pooler**, com concorrência real (`npm run test:base`, secção 2.6 do guia). Os testes executados não provam todos os cenários.

---

## 6. Testes executados e resultados

Executados neste computador (Windows 10, Node 22.14, Edge 154 sem interface) em 03/10/2026.

### 6.1 Testes reais (código real, sem simulação)

| Teste | Resultado |
|---|---|
| Frontend `npm run lint` (oxlint) | Sem avisos |
| Frontend `npm run build` (`tsc -b` + Vite) | OK |
| Backend `npm run lint`, `npm run typecheck`, `npm run build` | OK |
| Backend `npm test` | **61/61**. Inclui: configuração e limpeza de segredos (8), HTTP com servidor real e base simulada (11), encerramento com servidor HTTP real (2), regras no código-fonte (5), migrações e SCRAM (7), assinatura (6), custo efectivo (11). O resto está em 6.2 |
| `npm run teste:fluxo` (38 passos, com a API a correr sem base) | **38/38** |
| `npm run teste:fluxo` (sem a API a correr) | **38/38**. O estado do sistema mostra o erro tratado |
| `npm run teste:pwa` (build de produção, servidor desligado a meio) | **6/6** |
| API construída (`node dist/server.js`), à mão | `/api/v1/saude` 200 com `X-Nexo-Pedido`; `/api/v1/saude/base` 503 `nao_configurada`; 404 no formato único. Com `DATABASE_URL` de `postgres`, recusa arrancar (código 1) sem mostrar a palavra-passe nem o servidor |
| `VITE_NEXO_DATABASE_URL=x npx vite build` | Recusado: "Variáveis VITE_* com aspecto de segredo" |

### 6.2 Testes simulados (sem base de dados)

| Teste | Resultado |
|---|---|
| Transacções com pool simulado (11 testes, dentro de `npm test`): ordem dos comandos, COMMIT/ROLLBACK, libertação e destruição da ligação, papel fora da lista, contexto forjado, comandos proibidos | 11/11 |
| Executor de migrações com cliente simulado (dentro de `npm test`) | OK |
| Cliente HTTP do frontend com `fetch` simulado, no navegador (um passo do fluxo) | OK |

### 6.3 Testes contra PostgreSQL local de verificação (motor real, **não é o Supabase**)

PGlite 0.5.8 (PostgreSQL 18.3), servido por `pglite-socket`, instalado só numa pasta temporária. O servidor multiplexa todas as ligações numa só sessão: é o caso mais desfavorável para estado residual. A API foi emulada com `SET SESSION AUTHORIZATION nexo_api` (`NEXO_TESTE_LOCAL=1`).

| Teste (`npm run test:base`) | Resultado |
|---|---|
| Diagnóstico (papel seguro, migração 0004) | OK |
| Falta de contexto (gestão e operador) | OK |
| Separação entre duas empresas, mesmo pedindo o identificador da outra | OK |
| Contexto depois de sucesso, ligação reutilizada (pool de 1) | OK |
| Contexto depois de erro, ligação reutilizada | **Não executado localmente.** O emulador dessincroniza depois de um erro no protocolo estendido (reproduzido à parte; é um defeito do emulador). Correr no nexo-dev |
| Reutilização com transacções concorrentes (90) | **Não executado localmente.** O emulador corta ligações concorrentes. Correr no nexo-dev |
| Papéis sem BYPASSRLS; `current_user` = papel de execução, `session_user` = `nexo_api` | OK |
| Sem acesso administrativo dentro de `executarTransaccao` (42501 em `nexo_controlo`, INSERT, UPDATE, DELETE) | **Não executado localmente** (o mesmo defeito do emulador). Correr no nexo-dev |
| Sem acesso administrativo pela ligação `nexo_api` (SET ROLE `postgres`/`nexo_proprietario`/`nexo_diagnostico`, CREATE TABLE, leitura sem papel) | OK |
| `definir_contexto`: uma vez por transacção, só com papel de execução, função válida | OK |
| Marca: contexto sem marca e contexto residual de sessão não dão acesso | OK |
| Verificação do catálogo (R1) | OK |
| **Total local** | **9 OK, 3 não executados, 0 falhas** |
| **Mutação:** `contexto_valido()` alterada para devolver sempre verdadeiro | 5 testes falharam, como devia |

A limpeza dos dados de teste não corre no emulador: a identidade da sessão partilhada não volta ao administrador. Os dados ficam numa pasta descartável. Numa base real, a limpeza corre sempre.

### 6.4 Não executados (estado de 03/10/2026)

> **Actualização de 06/10/2026:**
> - O proprietário executou no nexo-dev as migrações, o `test:base` (12/12), a ligação TLS, a API contra a base e o Ctrl+C real (secção 14).
> - O teste real de actualização da PWA foi executado localmente (secção 15).
> - Continua por fazer: qualquer teste em telemóvel.

| Teste | Porquê |
|---|---|
| Migrações e `test:base` (12 testes) no **Supabase nexo-dev** | Sem ligação configurada. Passo manual na secção 9 |
| Ligação TLS ao Supabase com o certificado | Idem |
| Arranque da API contra o nexo-dev (`/api/v1/saude/base` = ok, 0004) | Idem |
| Encerramento por Ctrl+C real | No Windows, um sinal enviado por outro processo termina o Node sem correr o handler. A lógica foi testada directamente (`encerramento.test.ts`) |
| Aviso de actualização da PWA com uma versão nova real | Exige duas builds diferentes servidas em sequência; o fluxo foi revisto, não testado |
| Qualquer teste em telemóvel | HTTPS local pendente (`docs/Nexo_Ambientes.md`, secção 5) |

---

## 7. Dependências novas

| Pacote | Onde | Tipo | Para quê |
|---|---|---|---|
| `pg` 8.23 | backend | execução | Driver do PostgreSQL: pool de ligações, transacções, TLS |
| `zod` 4.6 | backend | execução | Validação da configuração no arranque e dos pedidos |
| `pino` 10.4 | backend | execução | Logs estruturados com remoção de campos sensíveis |
| `@types/pg` 8.23 | backend | desenvolvimento | Tipos do driver |
| `oxlint` 1.x | backend | desenvolvimento | Linter (o mesmo do frontend) |

Frontend: **nenhuma dependência nova.** O cliente HTTP, a PWA e a base local usam APIs do navegador.

Fora do projecto, só para verificação local: `@electric-sql/pglite` e `@electric-sql/pglite-socket`, numa pasta temporária. Não estão em nenhum `package.json`.

---

## 8. Comandos

Ver `docs/Nexo_Ambientes.md`. Resumo em PowerShell, a partir da pasta `nexo`:

```powershell
cd frontend; npm install; cd ..; cd backend; npm install; cd ..          # instalar
cd backend; npm run dev                                                   # API (terminal 1)
cd frontend; npm run dev                                                  # web (terminal 2)
cd backend; npm run lint; npm run typecheck; npm test                     # verificações do backend
cd frontend; npm run lint; npm run build; npm run teste:fluxo; npm run teste:pwa
cd backend; npx tsx src/base/migracoes/cli.ts estado; npx tsx src/base/migracoes/cli.ts migrar --confirmo <ref>; npx tsx src/base/migracoes/cli.ts verificar   # nexo-dev
cd backend; npm run test:base                                             # com as variáveis da secção 2.6
```

---

## 9. Passo manual no nexo-dev (executado pelo proprietário em 06/10/2026 — secção 14)

1. Descarregar o certificado do projecto para `nexo/certificados/supabase-ca.crt`.
2. Em `backend/.env`, definir `DATABASE_ADMIN_URL` (Session pooler, 5432, `postgres.<ref>`) e `DB_CA_CERT_FICHEIRO`.
3. Aplicar e verificar as migrações:

   ```powershell
   npx tsx src/base/migracoes/cli.ts estado
   npx tsx src/base/migracoes/cli.ts migrar --confirmo <ref>
   npx tsx src/base/migracoes/cli.ts verificar
   ```

4. Definir a palavra-passe de `nexo_api`:

   ```powershell
   $env:NEXO_SENHA_API = '…'
   npx tsx src/base/migracoes/cli.ts senha-api --confirmo <ref>
   Remove-Item Env:NEXO_SENHA_API
   ```

5. `DATABASE_URL` com `nexo_api.<ref>` pelo Transaction pooler (6543), depois `npm run dev`. Confirmar que `/api/v1/saude/base` devolve `ok` e `0004`.
6. Correr `npm run test:base` com as variáveis da secção 2.6 do guia. Esperado: 12/12, sem saltados.
7. Partilhar a saída (sem palavras-passe nem endereços). Este documento e a arquitectura passam a "executado".

---

## 10. Limitações e decisões pendentes

**Limitações:**

- Sem autenticação real nem módulos comerciais (Etapas 3+). O modo `api` mostra só o estado do sistema.
- O protótipo continua com dados fictícios em `localStorage`, login simulado e sincronização simulada.
- A marca da transacção (secção 5) tem limites. A versão nova ainda não foi testada no Supabase.
- O guarda de comandos pode recusar por engano uma coluna chamada `role` (secção 2).
- Não há integração contínua (CI) configurada. O repositório tem remoto no GitHub, mas os testes correm à mão.
- Sem formatador automático de código (só o linter).

**Decisões pendentes (nenhuma foi decidida nesta etapa):**

| Decisão | Bloqueia |
|---|---|
| H-02 Identidade dos operadores | Etapa 3 |
| H-04 / H-21 Custo médio e ordem de aplicação | Etapa 4 |
| H-29 Custo efectivo com correcções | Etapas 5 e 6 |
| H-23 Autoria offline | Etapa 7 (loja `autorias` e formato da autoria) |
| H-28 Custos no dispositivo | Etapa 7 |
| P-1, P-2 Propostas de ordem do roteiro | Etapa 6 |
| Alojamento de produção | Lançamento |
| Entrevista à loja piloto | Várias decisões H.2 |

---

## 11. Critérios do roteiro (estado de 03/10/2026; o estado actual está na secção 18)

| Critério da Etapa 2 | Estado |
|---|---|
| Repositório | **Cumprido:** Git com remoto no GitHub (criado pelo proprietário do projecto) |
| Frontend | **Cumprido:** base organizada, protótipo preservado |
| Backend | **Cumprido** |
| Migrações | **Parcial:** criadas e verificadas localmente; **não aplicadas no nexo-dev** |
| Variáveis de ambiente de exemplo | **Cumprido:** `backend/.env.example`, `frontend/.env.example`, sem segredos |
| Guia de execução | **Cumprido:** `docs/Nexo_Ambientes.md`, para Windows/PowerShell |
| Qualidade de código | **Parcial:** linter e tipos estritos nos dois projectos, testes automáticos; sem CI nem formatador |
| Tratamento de erros | **Cumprido:** formato único na API; `ErroApi` e estados de erro no frontend |
| Registo de eventos | **Cumprido:** logs estruturados, com identificador de pedido e sem segredos |
| Ambientes de desenvolvimento | **Parcial:** local cumprido; nexo-dev por ligar; HTTPS para telemóvel pendente |
| PWA e base local, sem activar fluxos offline | **Cumprido** (preparação; secção 4) |
| **Concluída quando:** outro programador consegue iniciar aplicação, API e base de dados seguindo o guia | **Por cumprir:** a base de dados ainda não foi iniciada no nexo-dev pelo guia, e nenhum outro programador o seguiu |

A **Etapa 2 não está concluída**. Faltam o passo manual da secção 9 e uma execução do guia por outra pessoa, ou noutro computador limpo. A Etapa 3 não foi iniciada.

---

## 12. Correcção de 06/10/2026 — migração 0001 no nexo-dev

### 12.1 O que aconteceu

O proprietário do projecto correu `npx tsx src/base/migracoes/cli.ts migrar --confirmo lkikoxrrfvagfhgbbtrw` no nexo-dev (PostgreSQL 17.11). A migração `0001_papeis_e_esquemas.sql` falhou com `permission denied to alter role`.

**Causa:**

- O administrador do Supabase tem CREATEROLE, mas não é superutilizador.
- A partir do PostgreSQL 16, esse administrador **não pode indicar** `NOSUPERUSER`, `NOREPLICATION` nem `NOBYPASSRLS` num `ALTER ROLE`, nem sequer para confirmar o valor que já está. Só um superutilizador mexe em SUPERUSER, e REPLICATION/BYPASSRLS exigem que quem altera os tenha.
- A 0001 fazia sempre `ALTER ROLE … NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`.

Reproduzido localmente, com o mesmo erro, num PostgreSQL 18 (PGlite) com um administrador simulado (CREATEROLE e CREATEDB; sem SUPERUSER, REPLICATION nem BYPASSRLS):

| Opção em `ALTER ROLE` | Administrador sem superutilizador |
|---|---|
| `LOGIN` / `NOLOGIN`, `INHERIT` / `NOINHERIT`, `NOCREATEDB`, `NOCREATEROLE` | Permitido |
| `NOSUPERUSER`, `NOREPLICATION`, `NOBYPASSRLS` | **Recusado** |

Também se confirmou que o criador de um papel fica com **ADMIN OPTION, sem SET nem INHERIT** sobre ele. Isto obriga a dar SET explicitamente onde é preciso (abaixo).

### 12.2 A falha foi revertida por inteiro

O executor corre cada migração numa transacção e faz `ROLLBACK` em erro. Na reprodução local, depois da falha:

- 0 papéis `nexo_*`;
- nenhum esquema `nexo`;
- nenhuma migração registada.

Fica só o esquema `nexo_controlo`, com a tabela de controlo vazia. É criado pelo executor antes das migrações, é idempotente e é reutilizado. **Nada foi apagado** para contornar a falha.

No nexo-dev, confirme com `npx tsx src/base/migracoes/cli.ts estado`: as 4 migrações em `pendente` e "nenhum papel nexo_* existe ainda".

### 12.3 Correcções

**`migracoes/0001_papeis_e_esquemas.sql`** (nunca tinha sido aplicada, por isso pôde ser corrigida em vez de criar uma migração nova):

1. **Papéis novos:** `CREATE ROLE <nome> LOGIN|NOLOGIN INHERIT|NOINHERIT` e nada mais. Os outros atributos ficam nos valores seguros por omissão do PostgreSQL: NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION e NOBYPASSRLS.
2. **Papéis existentes:** lidos no catálogo.
   - Com SUPERUSER, CREATEDB, CREATEROLE, REPLICATION ou BYPASSRLS, a migração **pára** com "o papel X já existe com atributos proibidos: …" e uma indicação do que fazer. Não os aceita nem os tenta mudar.
   - Só LOGIN e INHERIT são corrigidos, quando diferem. Se o administrador não puder (sem ADMIN OPTION), pára com uma mensagem clara.
3. **`nexo_api`:** NOINHERIT, e pertença aos três papéis de execução `WITH INHERIT FALSE, SET TRUE`, sem ADMIN.
4. **Administrador em `nexo_proprietario`:** `WITH INHERIT TRUE, SET TRUE`.
   - SET serve para `CREATE SCHEMA … AUTHORIZATION` e para as migrações 0002/0003 (`SET LOCAL ROLE`).
   - INHERIT serve para `ALTER DEFAULT PRIVILEGES` e para criar a função da 0004 no esquema.
5. **Esquema `nexo`:** se já existir com outro dono, a migração pára.
6. **`transferir_dono_funcao` (R5):**
   - pertença temporária só com SET;
   - confirma que a função pertence ao administrador antes da transferência;
   - depois confirma que o dono mudou, que o novo dono ficou sem CREATE, que o administrador ficou sem SET sobre ele, e que a função não ficou executável por PUBLIC.

**`migracoes/0004_diagnostico.sql`:** o `REVOKE … FROM PUBLIC` e o `GRANT EXECUTE … TO nexo_api` passam para **antes** da transferência de dono.

- **Defeito encontrado ao testar com o administrador sem superutilizador:** depois da transferência, o administrador já não é dono. O `REVOKE` era ignorado só com um aviso, e `nexo.estado_base()` ficava **executável por PUBLIC**.
- Com um superutilizador, como no PGlite da verificação de 03/10, o defeito não aparecia.
- A verificação do catálogo (regra 11) detectou-o.

**`migracoes/verificacoes.sql`** — novas regras (16 a 20):

- nenhum papel do Nexo com ADMIN OPTION;
- `nexo_api` pertence só aos três papéis de execução, com SET e sem herança;
- os outros papéis do Nexo não pertencem a nenhum papel;
- ninguém tem SET sobre os donos de funções;
- nenhum papel do Nexo pode assumir `nexo_proprietario`;
- o dono do esquema e das funções é o esperado;
- as funções SECURITY DEFINER têm dono dedicado.

**Executor:** o guarda contra `BEGIN`/`COMMIT` nos ficheiros passou a ignorar os corpos `$$…$$`. O `END;` de um bloco PL/pgSQL era confundido com controlo de transacção.

**CLI e guia:**

- Os comandos passam a ser documentados como `npx tsx src/base/migracoes/cli.ts <comando>`.
- A confirmação aceita também `NEXO_CONFIRMO`, e a mensagem de erro mostra o comando exacto.
- `estado` mostra se o administrador é superutilizador, os papéis `nexo_*` com atributos proibidos e as pertenças.

No PowerShell, `npm run db:migrar -- --confirmo x` não entregou `--confirmo` ao script: o PowerShell trata `--` como fim de parâmetros.

Inalterado: RLS e FORCE RLS em todas as tabelas, e TLS com validação do certificado (`rejectUnauthorized: true`).

### 12.4 Testes depois da correcção

**Locais — executados (não são o Supabase):**

| Teste | Resultado |
|---|---|
| Migrações com administrador **simulado sem superutilizador** (PGlite 0.5.8 / PostgreSQL 18.3, executor real) — base vazia | 4 aplicadas; verificação do catálogo **OK** |
| Idem — repetir a 0001 sobre a base migrada | Sem erros (idempotente) |
| Idem — `nexo_api` já existente com BYPASSRLS | Pára com "atributos proibidos: BYPASSRLS"; ROLLBACK completo (sem esquema `nexo`, sem registo) |
| Idem — `nexo_gestao` já existente com CREATEDB | Pára com "atributos proibidos: CREATEDB"; ROLLBACK completo |
| Idem — `nexo_api` já existente com INHERIT | Corrigido para NOINHERIT; verificação OK |
| Pertenças depois das migrações | `nexo_api` → execução: SET, sem INHERIT nem ADMIN. Administrador: SET + INHERIT só em `nexo_proprietario`. O SET temporário sobre `nexo_diagnostico` foi retirado |
| A versão **anterior** da 0001 com o mesmo administrador | Falha com `permission denied to alter role` (reprodução) e ROLLBACK completo |
| CLI real (`npx tsx … migrar`, `estado`, `verificar`) contra PostgreSQL local por TCP | Sem confirmação: recusado. Com `--confirmo` e com `NEXO_CONFIRMO`: aplicado; repetição "Nada a aplicar"; verificação OK |
| `npm run test:base` local | 9 OK, 3 não executados (limites do emulador, secção 6.3), 0 falhas |
| Backend `npm test` | **64/64** (3 testes novos sobre a 0001, a 0004 e o guarda do executor); lint e tipos OK |

**Executado depois pelo proprietário:** ver a secção 14. O texto abaixo era o estado antes disso.

**Por executar no Supabase nexo-dev (na altura):**

- `migrar` com a 0001 corrigida, `verificar`, `senha-api` e `npm run test:base` (12 testes, sem saltados).
- **Limite da simulação:** os atributos exactos do administrador do Supabase (por exemplo, se tem REPLICATION ou BYPASSRLS) não foram confirmados. A simulação usou o caso mais restrito. Antes de migrar, `estado` mostra se o administrador é superutilizador.

### 12.5 Próximo comando no nexo-dev

Na pasta `backend`, com `DATABASE_ADMIN_URL` e `DB_CA_CERT_FICHEIRO` em `backend/.env`:

```powershell
npx tsx src/base/migracoes/cli.ts estado
npx tsx src/base/migracoes/cli.ts migrar --confirmo lkikoxrrfvagfhgbbtrw
npx tsx src/base/migracoes/cli.ts verificar
```

---

## 13. Correcção de 06/10/2026 — teste de concorrência no nexo-dev

### 13.1 O que aconteceu

No nexo-dev, o `npm run test:base` deu **11 OK e 1 falha**, sem testes saltados. Falhou "reutilização de ligações com transacções concorrentes", com `timeout exceeded when trying to connect` em `pool.connect()` (índice 21 do `Promise.all`).

O texto `SELECT1 FROM nexo.filiais` que apareceu na saída **não existe no ficheiro**: a linha é `SELECT 1 FROM nexo.filiais`. Terá sido um efeito da cópia.

### 13.2 Causa

- No `pg-pool`, `connectionTimeoutMillis` (10 s) conta **também a espera na fila** por uma ligação livre.
- O teste lançava as 90 transacções de uma vez com `Promise.all`, sobre um pool de 4. As últimas da fila esperavam mais de 10 s pela sua vez, sobretudo com a latência até eu-west-1.
- Não houve fuga de ligações: a falha foi de tempo na fila.

Além disso, com `Promise.all` a primeira rejeição terminava o teste enquanto as outras transacções **continuavam a correr**, em paralelo com os testes seguintes e com a limpeza dos dados.

### 13.3 Verificação da aquisição e libertação de ligações

O código liberta sempre a ligação, e destrói-a se o `ROLLBACK` falhar. Não há caminho que a deixe presa, e o teste novo confirma-o no fim (ver abaixo). Foram corrigidos dois problemas adicionais em `src/base/acesso.ts`:

1. **Idas ao servidor por transacção: 6 → 4.**
   - `BEGIN; SET LOCAL ROLE …; SET LOCAL statement_timeout = …` seguem numa só mensagem. O papel vem da lista fixa e o tempo é uma constante; nada vem do pedido.
   - Reduz o tempo de cada transacção e, com ele, a fila.
2. **Falta de ligação a tempo deixa de dar HTTP 500.**
   - Passa a `ErroBaseIndisponivel`, que a API responde como **503 `indisponivel`** (arquitectura 6.1).
   - O tempo limite (10 s) e o tamanho do pool **não foram alterados**.

### 13.4 Teste corrigido (`testes/base/integracao.test.ts`)

- Mantém **90 transacções**, empresas **A, B e sem contexto**, e os papéis **gestão e operador**.
- **Concorrência limitada mas real:** trabalhadores concorrentes, por omissão o triplo do pool (12 activos para 4 ligações). Há sempre espera pelo pool e reutilização de ligações; não é sequencial. A fila nunca passa do que cabe no tempo de aquisição.
- Espera por **todas** as tarefas (`Promise.allSettled`) antes de avaliar, mesmo quando alguma falha. Nada fica a correr durante os testes seguintes nem durante a limpeza.
- Junta **todas** as falhas, com índice, empresa, papel e erro, e **todas** as divergências de isolamento (marcadas `ISOLAMENTO`), e apresenta-as de uma vez.
- Verifica a **libertação**: no fim, nenhuma ligação presa, ninguém à espera, nunca acima do máximo do pool.
- Regista, sem segredos:
  - transacções, concorrência pedida e máxima observada;
  - pool e duração total;
  - mediana e máximo por transacção;
  - número de processos do servidor distintos;
  - estado do pool.

### 13.5 Verificações locais (não são o Supabase)

| Verificação | Resultado |
|---|---|
| Backend `npm test` | **66/66**, incluindo os novos testes: falta de ligação → `ErroBaseIndisponivel`, e HTTP 503 `indisponivel`. Tipos e lint OK |
| `test:base` no PostgreSQL local (PGlite), com o teste de concorrência forçado (`NEXO_TESTE_CONCORRENCIA_LOCAL=1`, pool 2, concorrência 6) | 10 OK, 2 não executados (limites do emulador), 0 falhas. Concorrência: 90 transacções em cerca de 0,8 s; máximo de 6 activas; pool no fim `{total 2, livres 2, em espera 0}` |
| **Mutação** (só no emulador): política de `empresas` sem filtro | O teste de concorrência falhou com **90 problemas** listados, todos `ISOLAMENTO`, e não só o primeiro |

O emulador local tem um só processo de servidor, por isso não reproduz a latência nem o Transaction pooler do Supabase.

**Executado depois pelo proprietário:** 12/12 (secção 14). Na altura: **por executar no nexo-dev:** `npm run test:base`, com as variáveis da secção 2.6 do guia. Esperado: 12/12, 0 saltados. Partilhe as linhas de diagnóstico (`# transacções=…`, `# por transacção…`, `# pool no fim…`).

---

## 14. Resultados no Supabase nexo-dev — executados pelo proprietário (06/10/2026)

Executados e confirmados pelo **proprietário do projecto** no projecto **nexo-dev** (PostgreSQL 17.11), depois das correcções das secções 12 e 13. Não foram executados por mim.

| Verificação | Resultado |
|---|---|
| Migrações 0001–0004 | Aplicadas |
| Verificação do catálogo (`verificar`) | OK, nenhum problema |
| Palavra-passe de `nexo_api` (`senha-api`) | Definida |
| `npm run test:base` | **12 OK, 0 falhas, 0 saltados**; duração total 90 429,8 ms |
| Concorrência (dentro do `test:base`) | 90 transacções, 12 activas, pool 4, 25 224 ms; por transacção: mediana 3 064 ms, máximo 5 654 ms; 4 processos do servidor distintos; pool no fim: total 4, livres 4, em espera 0 |
| Ligação da API | Transaction pooler (6543), TLS com validação do certificado |
| `GET /api/v1/saude` | `ok`, ambiente `desenvolvimento` |
| `GET /api/v1/saude/base` | `ok`; `disponivel=true`, `papelSeguro=true`, `versaoMigracao=0004` |
| Ctrl+C com `npx tsx src/server.ts` | `"motivo":"SIGINT"`, `"a encerrar"`, depois `"encerrado"`; o terminal voltou ao prompt |
| Frontend `/#/sistema` com a API ligada | API a responder, base pronta |
| Frontend com a API parada | "API indisponível" e base "Sem resposta" |
| Frontend depois de reiniciar a API | Os dois "Tentar de novo" recuperaram os estados **sem recarregar a página** |

**Configuração usada:**

- Certificado em `../certificado/supabase-ca.crt` (pasta `certificado`, no singular). O `.gitignore` passou a incluir também `certificado/`.
- Credenciais introduzidas com `Read-Host -AsSecureString` e guardadas em variáveis temporárias do terminal. Não ficaram em ficheiros nem no histórico. O guia descreve este método (`docs/Nexo_Ambientes.md`, secção 2.2).

**Observação sobre os tempos:**

- Cada transacção levou em média cerca de 3 s com 12 tarefas activas sobre 4 ligações. Isso inclui a espera pelo pool e a latência até eu-west-1.
- Ninguém excedeu o tempo de aquisição (10 s), e o pool terminou sem ligações presas.
- Os tempos com carga e volumes reais ficam para a Etapa 10 (desempenho e monitorização). Não são um critério da Etapa 2.

---

## 15. Teste real de actualização da PWA — executado localmente (06/10/2026)

**Defeito encontrado ao preparar o teste (e corrigido):**

1. O `sw.js` era **igual em todas as builds** (`VERSAO = 'nexo-app-v1'`). O navegador só detecta uma versão nova quando o `sw.js` muda, por isso **o aviso de actualização nunca apareceria**.
2. A navegação ia primeiro à rede, por isso um simples recarregar já trazia a versão nova sem o utilizador a aceitar. Isto contraria a regra da arquitectura (11.1).

**Correcções:**

- `vite.config.ts` carimba o `sw.js` de cada build com um resumo do `index.html` gerado (`nexo-app-<12 hex>`).
- O service worker serve a navegação a partir da cache **da sua versão** e só vai à rede se faltar.
- `registar.ts` pede uma verificação de versão ao registar.
- A versão da aplicação (`VITE_NEXO_VERSAO`, por omissão `local`) aparece em "Estado do sistema".

**Teste** (`npm run teste:pwa-actualizacao`; duas builds, mesmo endereço `http://localhost:4176`, mesmo perfil do Edge):

| Passo | Resultado |
|---|---|
| A instalada e a controlar a página | OK (cache `nexo-app-9f5f557518d6`) |
| B publicada no mesmo endereço: B à espera, página ainda em A, aviso visível | OK |
| Recarregar sem aceitar: continua em A | OK |
| "Actualizar agora": página em B, sem aviso, só a cache de B | OK (cache `nexo-app-0e675fdbef8e`) |
| **Total** | **4/4** |
| **Mutação:** `sw.js` de novo com versão fixa | 3 passos falharam ("o aviso de actualização não apareceu"). O teste detecta o defeito |

`npm run teste:pwa` (abertura sem servidor) continua 6/6 com o service worker novo.

**Não testado:**

- num telemóvel;
- com a PWA instalada no ecrã inicial;
- a regra da Etapa 7 de só activar sem venda em curso.

---

## 16. Arranque numa pasta limpa — executado localmente (06/10/2026)

Procedimento: `scripts\arranque-limpo.ps1` (`docs/Nexo_Ambientes.md`, secção 6). Execução sem `-ComBase`:

| Passo | Resultado |
|---|---|
| Cópia só dos ficheiros do repositório: 131, sem `node_modules`, `dist`, `.env` nem certificados | OK |
| `npm ci` no frontend (27 pacotes) e no backend (118) | OK |
| Configuração nova a partir dos `.env.example` (API 3101, web 5273, sem base) | OK |
| Backend: lint, tipos, build, `npm test` | OK |
| Frontend: lint, build | OK |
| API: `/api/v1/saude` `ok`; `/api/v1/saude/base` `nao_configurada` (esperado sem base) | OK |
| Web e teste do fluxo no navegador | OK, **38/38** |
| **Total** | **14/14** |

A primeira execução falhou na web (HTTP 403). A pasta estava no `%TEMP%`, que neste computador tem um nome curto (8.3), e o servidor do Vite recusa-o. O destino por omissão passou a `%USERPROFILE%`, com caminho longo e com espaços, e o script passou a ser gravado em UTF-8 com BOM, por causa dos acentos no PowerShell 5.1. A pasta de verificação foi apagada depois.

**Não executado por mim:** a parte `-ComBase` (precisa das ligações do proprietário na sessão).

**Limite:** é o mesmo computador, com o mesmo Node, a mesma cache do npm e o mesmo navegador. **Não cumpre** o critério "outro programador".

---

## 17. Ctrl+C com `npm run dev` (`tsx watch`) — causa não confirmada

**Observado pelo proprietário:** no terminal PowerShell do VS Code, com `npm run dev`, o terminal às vezes **fecha** depois de Ctrl+C, com código 2. Com `npx tsx src/server.ts` não fechou, e o encerramento ordenado foi registado (secção 14).

**Investigação** (leitura do código, sem reprodução: não consigo enviar um Ctrl+C de consola real a partir das ferramentas que uso):

- No `tsx` 4.23.15, o modo `watch` apanha SIGINT, reenvia-o ao processo filho e termina com o código de saída do filho.
- No Windows, segundo a documentação do Node, enviar SIGINT a outro processo **termina-o à força**, sem correr os seus handlers. Em modo `watch`, o encerramento ordenado da API pode por isso não chegar a correr; com execução directa, a própria API recebe o Ctrl+C.
- O `npm run` acrescenta camadas (o atalho `npm` do PowerShell e o `cmd.exe`, com o seu "Terminate batch job (Y/N)?"). A forma como estas camadas reagem ao Ctrl+C pode explicar o terminal fechar e o código 2.

**Nada disto está confirmado.** Não foi aplicada nem declarada nenhuma correcção.

**Alternativas documentadas** (`docs/Nexo_Ambientes.md`, secção 1, "Encerrar"):

- **execução directa** `npx tsx src/server.ts` — confirmada pelo proprietário;
- `npx tsx watch src/server.ts`, sem o `npm` — **não testada**.

---

## 18. Critérios do roteiro (estado actual)

Texto exacto do roteiro (`Documentos/Nexo_Etapas_de_Desenvolvimento.docx`, Etapa 2):

> *Criar repositório, frontend, backend, migrações, variáveis de ambiente de exemplo e guia de execução. Configurar qualidade de código, tratamento de erros, registo de eventos e ambientes de desenvolvimento. Preparar a PWA e a base local sem activar ainda todos os fluxos offline.* **Concluída quando:** *outro programador consegue iniciar aplicação, API e base de dados seguindo o guia.*

Na secção "Como conduzir cada etapa", o roteiro acrescenta: *"Só avançar depois de verificar os critérios de aceitação e guardar um commit no GitHub."*

### 18.1 Requisitos de fecho

| Requisito | Estado | Evidência |
|---|---|---|
| Repositório | Concluído | Git com remoto no GitHub (`origin`) |
| Frontend | Concluído | Base organizada; protótipo preservado; fluxo 38/38 |
| Backend | Concluído | `npm test` 66/66; API verificada pelo proprietário (secção 14) |
| Migrações | Concluído | 0001–0004 aplicadas no nexo-dev; verificação do catálogo OK; `test:base` 12/12 (proprietário) |
| Variáveis de ambiente de exemplo | Concluído | `backend/.env.example`, `frontend/.env.example`, sem segredos |
| Guia de execução | Concluído | `docs/Nexo_Ambientes.md` 0.3 |
| Qualidade de código | Concluído | Linter e TypeScript estrito nos dois projectos; testes automáticos (backend 66, base 12, fluxo 38, PWA 6 + 4) |
| Tratamento de erros | Concluído | Formato único na API (incluindo 503 `indisponivel`); estados de erro e recuperação no frontend (secção 14) |
| Registo de eventos | Concluído | Logs estruturados com identificador de pedido e sem segredos |
| Ambientes de desenvolvimento | Concluído | Local e nexo-dev verificados |
| PWA e base local, sem activar fluxos offline | Concluído | Service worker, actualização real 4/4, abertura sem servidor 6/6; esquema IndexedDB testado; fila sem implementação |
| **Outro programador** inicia aplicação, API e base de dados seguindo o guia | **Pendente** | Pasta limpa no mesmo computador 14/14 (secção 16): é só uma verificação prévia. **Ninguém além do proprietário e de mim seguiu o guia, nem noutro computador** |
| Commit no GitHub antes de avançar | **Pendente** | Decisão e acção do proprietário (não fiz commit) |

### 18.2 Melhorias (não exigidas pelo roteiro para fechar a Etapa 2)

| Melhoria | Nota |
|---|---|
| Integração contínua (CI) | O roteiro pede "qualidade de código", não CI. Não foi adicionada |
| Formatador automático | Idem |
| Causa do fecho do terminal com `tsx watch` | Secção 17; contornado com a execução directa |
| Tempos de transacção com o pooler remoto | Secção 14; medir com carga real na Etapa 10 |

### 18.3 Pendências futuras (de outras etapas)

| Pendência | Etapa |
|---|---|
| HTTPS local e testes em telemóvel (PWA instalada, prova H-23 nos aparelhos) | Antes da decisão H-23 e da Etapa 7 |
| Decisões H-02 (Etapa 3), H-04/H-21 (4), H-29 (5–6), H-23 e H-28 (7), P-1/P-2 (6) | Respectivas etapas |
| Testes da API sobre custos e autorização (C-API, R2) | Etapa 3 em diante |
| Procedimento de migrações em produção | Antes do lançamento |

**A Etapa 2 não está concluída.** Falta que outro programador arranque tudo pelo guia, e o commit. A Etapa 3 não foi iniciada.

---

## 19. Comandos manuais que faltam

**A. Para o critério de fecho**, feito por **outro programador, noutro computador**, a partir do GitHub, depois do commit:

```powershell
git clone https://github.com/EufratesLC/Nexo.git
cd Nexo\nexo
# Seguir docs/Nexo_Ambientes.md: secção 1 (instalar e arrancar), 2.1–2.2 (certificado e ligações na
# sessão, com credenciais próprias ou cedidas por canal seguro) e 2.6 (test:base).
# Verificação rápida do mesmo procedimento:
powershell -ExecutionPolicy Bypass -File scripts\arranque-limpo.ps1 -ComBase
```

O resultado (passos OK, versão do Node, sistema operativo, problemas encontrados no guia) fica registado nesta entrega.

**B. Opcional, no seu computador**: a parte da base da pasta limpa. Com as variáveis da secção 2.6 do guia na sessão (por `Read-Host -AsSecureString`):

```powershell
cd nexo
powershell -ExecutionPolicy Bypass -File scripts\arranque-limpo.ps1 -ComBase
```

**C. Commit**: quando decidir, com as alterações revistas (lista no fim da resposta desta revisão).

### Resumo

| Item | Estado | Evidência |
|---|---|---|
| Migrações no nexo-dev | Concluído | Proprietário, 06/10: 0001–0004, verificação OK |
| `test:base` no nexo-dev | Concluído | Proprietário, 06/10: 12/12, 0 saltados |
| API com TLS pelo Transaction pooler | Concluído | Proprietário, 06/10: `/saude/base` ok, 0004, `papelSeguro=true` |
| Encerramento com Ctrl+C (execução directa) | Concluído | Proprietário, 06/10: "a encerrar" → "encerrado" |
| Estados de erro e recuperação no frontend | Concluído | Proprietário, 06/10 |
| Actualização real da PWA | Concluído | Local, 06/10: 4/4, mais a mutação |
| Arranque numa pasta limpa (mesmo computador) | Concluído (verificação prévia) | Local, 06/10: 14/14, sem base |
| Pasta limpa com a base (`-ComBase`) | Pendente | Precisa das suas ligações (B) |
| Outro programador segue o guia | **Pendente — requisito de fecho** | — (A) |
| Commit no GitHub | Pendente | — (C) |
| Fecho do terminal com `tsx watch` | Pendente (causa não confirmada) | Secção 17 |
| HTTPS e testes em telemóvel | Pendente (etapa futura) | `docs/Nexo_Ambientes.md`, secção 5 |
