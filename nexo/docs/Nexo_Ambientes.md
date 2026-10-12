# Nexo — Ambientes e execução (Etapas 2 e 3)

Versão 0.4 · 12 de Outubro de 2026 (Etapa 3: migrações 0005–0008, registo com activação pendente, aplicação real com login, e-mail de recuperação, suporte; diagnóstico de ligações, secção 2.6b). Versão 0.3 · 6 de Outubro de 2026 (resultados do nexo-dev; credenciais na sessão; Ctrl+C; pasta limpa; actualização da PWA)

Guia para instalar, configurar e arrancar o Nexo em Windows (PowerShell). Os comandos partem da pasta `nexo`.

| Ambiente | Para quê | Estado |
|---|---|---|
| 1. Desenvolvimento local | Frontend, API e protótipo neste computador | Pronto e verificado; também numa pasta limpa (secção 6) |
| 2. Supabase nexo-dev | Base de dados de desenvolvimento: migrações e testes da base | 0001–0004 e `test:base` 12/12 pelo proprietário a 06/10/2026 (PostgreSQL 17.11). **0005–0008 aplicadas e catálogo OK** pelo proprietário a 11–12/10. `test:base` 54/57 (3 falhas de ligação) e repetição da concorrência 10/10; API com `versaoMigracao=0008` (`docs/Nexo_Entrega_Etapa_3.md`, secção 16) |
| 3. Testes | Testes automáticos | Ver secção 3 |
| 4. Produção | Futuro | **Não configurado** (secção 4) |
| 5. HTTPS para telemóvel | Testar PWA e Web Crypto num aparelho | **Pendente** (secção 5) |
| 8. Aplicação real local | Login, empresa, funcionários, auditoria (Etapa 3) | Verificada localmente com PostgreSQL 17 (secção 8) |
| 9. E-mail | Confirmação e recuperação do acesso do proprietário | Caixa de saída local verificada (também pelo proprietário contra o nexo-dev); **envio real (SMTP) adiado** por problemas na conta Google (secção 9) |

**Regras que valem em todos os ambientes:**

- Segredos só no backend, em `backend/.env` (ignorado pelo Git) ou em variáveis da sessão do terminal.
- Nada de segredos em `VITE_*`: essas variáveis vão para o navegador. O `vite.config.ts` recusa arrancar se encontrar uma com aspecto de segredo.
- A API liga-se **só** como `nexo_api`. Nunca `postgres` nem `service_role`: a API recusa arrancar com esses utilizadores (H-01, R3).
- As migrações usam uma ligação **administrativa** separada (`DATABASE_ADMIN_URL`), que a API nunca lê.
- Nunca usar produção para testes. Não há comandos de "reset" nem de apagar a base.

---

## 1. Desenvolvimento local

### Requisitos

- Node.js 22.4 ou posterior (testado com 22.14) e npm.
- Edge ou Chrome, para os testes da interface.

### Instalar

```powershell
cd frontend; npm install; cd ..
cd backend;  npm install; cd ..
```

### Configurar

```powershell
# Backend: copiar o exemplo (só se ainda não existir .env)
cd backend
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
cd ..
# Frontend: opcional (os valores por omissão servem para o desenvolvimento local)
cd frontend
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
cd ..
```

> Um `backend/.env` criado na Etapa 1 pode ter `FRONTEND_ORIGIN`. Essa variável deixou de ser lida: use `CORS_ORIGENS` (o valor por omissão, `http://localhost:5173`, serve para o desenvolvimento).

Sem `DATABASE_URL`, a API arranca sem base de dados. `GET /api/v1/saude/base` responde 503 com o motivo `nao_configurada`.

### Arrancar

Terminal 1 (API, recarrega ao gravar):

```powershell
cd backend
npm run dev
```

Terminal 2 (web):

```powershell
cd frontend
npm run dev
```

- Aplicação: `http://localhost:5173`, em **modo de demonstração** (dados fictícios, login simulado).
- Estado do sistema (API e base reais, só leitura): `http://localhost:5173/#/sistema`.
- API: `http://localhost:3001/api/v1/saude`, e `http://localhost:3001/api/v1/saude/base` para a base.
- Prova técnica de assinatura (só em desenvolvimento): `http://localhost:5173/prova-assinatura.html`.

**Modos do frontend** (`VITE_NEXO_MODO` em `frontend/.env.local`):

- `demonstracao` (omissão): o protótipo da Etapa 1. Os dados ficam em `localStorage` e nada é escrito na API.
- `api`: a aplicação real (Etapa 3): login, criação da empresa, funcionários, empresa e filial, o meu acesso, auditoria e estado do sistema. Precisa da API com base de dados (secção 8). Sem módulos comerciais.

### Encerrar

Ctrl+C em cada terminal. A API fecha o servidor HTTP, espera pelos pedidos em curso, fecha as ligações à base e termina. Se demorar mais de 10 segundos, termina à força.

**Execução directa da API (recomendada se o terminal fechar):**

```powershell
cd backend
npx tsx src/server.ts
```

Confirmado pelo proprietário a 06/10/2026: com Ctrl+C a API registou `"motivo":"SIGINT"` e `"a encerrar"`, depois `"encerrado"`, e o terminal voltou ao prompt. Não recarrega ao gravar: pare e arranque de novo depois de alterar o código.

**Problema conhecido, causa não confirmada:** com `npm run dev` (`tsx watch`), o terminal PowerShell do VS Code às vezes fecha depois de Ctrl+C, com código 2. Hipóteses em `docs/Nexo_Entrega_Etapa_2.md`, secção 17. Nenhuma correcção foi testada. Para trabalhar com recarregamento automático, pode experimentar `npx tsx watch src/server.ts`, que evita a camada do `npm`. Esta via **não foi testada**: se o terminal continuar a fechar, use a execução directa.

---

## 2. Supabase nexo-dev (base de desenvolvimento)

**Estado em 06/10/2026:** o proprietário aplicou as migrações 0001–0004 no nexo-dev (PostgreSQL 17.11). A verificação do catálogo deu OK, a palavra-passe de `nexo_api` foi definida e o `test:base` deu 12/12. A API ligou-se pelo Transaction pooler com TLS validado (`docs/Nexo_Entrega_Etapa_2.md`, secção 14).

**Etapa 3:** o proprietário aplicou as migrações 0005–0008 no nexo-dev a 11–12/10/2026; a verificação do catálogo deu OK. Não volte a aplicá-las: `migrar` responde "Nada a aplicar".

**Não apague nada:** `migrar` numa base já migrada responde "Nada a aplicar". Os passos abaixo servem para quem configura um computador novo contra o mesmo nexo-dev: ligações, certificado e verificação.

### 2.1 Obter as ligações e o certificado

No painel do projecto **nexo-dev**:

1. **Connect → Session pooler**: copie o URI (utilizador `postgres.<ref>`, porta **5432**). É a ligação administrativa das migrações.
2. **Connect → Transaction pooler**: anote o servidor (porta **6543**). A API liga-se por aqui como `nexo_api.<ref>`.
3. **Project Settings → Database → SSL Configuration → Download certificate**: guarde-o, por exemplo, em `nexo/certificados/supabase-ca.crt`. O proprietário usa `nexo/certificado/supabase-ca.crt` (no singular). Qualquer nome serve, desde que `DB_CA_CERT_FICHEIRO` aponte para ele: as pastas `certificado/` e `certificados/` e os ficheiros `*.crt` estão no `.gitignore`.

> A validação do certificado está sempre activa (`rejectUnauthorized: true`). Se a primeira ligação falhar com um erro de certificado, **não** a desactive: registe o erro e confirme o certificado a usar para o pooler.

### 2.2 Credenciais: só na sessão do terminal (recomendado)

As palavras-passe não ficam em ficheiros nem no histórico do PowerShell:

- leia-as com `Read-Host -AsSecureString`, que não mostra o que escreve e não fica no histórico;
- monte as variáveis da sessão a partir delas;
- apague as variáveis no fim.

O `dotenv` não substitui variáveis que já existam na sessão, por isso estas prevalecem sobre o `backend/.env`.

```powershell
# Exemplo para a ligação administrativa (repita o padrão para as outras ligações).
$segura = Read-Host 'Palavra-passe da base (postgres)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura)
$senha = [uri]::EscapeDataString([Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr))
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
$env:DATABASE_ADMIN_URL = "postgresql://postgres.<ref>:$senha@<servidor-do-pooler>:5432/postgres"
$env:DB_CA_CERT_FICHEIRO = '../certificado/supabase-ca.crt'
Remove-Variable senha, segura, bstr
# … no fim do trabalho:
Remove-Item Env:DATABASE_ADMIN_URL, Env:DATABASE_URL, Env:NEXO_TESTE_API_URL, Env:NEXO_TESTE_ADMIN_URL -ErrorAction SilentlyContinue
```

`EscapeDataString` codifica caracteres especiais da palavra-passe para o URL.

### 2.2b Alternativa: `backend/.env`

Fica no disco, ignorado pelo Git. Só num computador pessoal e protegido.

```dotenv
DATABASE_ADMIN_URL=postgresql://postgres.<ref>:<palavra-passe-da-base>@<servidor-do-pooler>:5432/postgres
DB_CA_CERT_FICHEIRO=../certificados/supabase-ca.crt
```

### 2.3 Aplicar as migrações

Use os comandos com `npx tsx` (na pasta `backend`). No PowerShell, `npm run db:migrar -- --confirmo <ref>` pode não entregar `--confirmo` ao script, porque o PowerShell trata `--` como fim de parâmetros. Foi o que aconteceu a 06/10/2026.

```powershell
cd backend
npx tsx src/base/migracoes/cli.ts estado                      # alvo, PostgreSQL, migrações, papéis e pertenças
npx tsx src/base/migracoes/cli.ts migrar --confirmo <ref>     # <ref> = identificador mostrado por "estado"
npx tsx src/base/migracoes/cli.ts verificar                   # verificação do catálogo (R1): tem de dizer "OK"
```

Em alternativa a `--confirmo`, pode definir `$env:NEXO_CONFIRMO = '<ref>'` na sessão do terminal.

- `migrar` só aplica migrações pendentes, cada uma na sua transacção.
- As migrações exigem **PostgreSQL 16 ou posterior** e funcionam com o administrador do Supabase, que **não** é superutilizador (correcção de 06/10/2026, secção 2.7).
- `estado` mostra os papéis `nexo_*` que já existam e as suas pertenças. Um atributo proibido aparece como `PROIBIDO`.
- Recusa continuar se uma migração aplicada tiver sido alterada.
- Recusa o Transaction pooler (6543) e `NEXO_AMBIENTE=producao`.

### 2.4 Palavra-passe de `nexo_api`

A palavra-passe é definida só na sessão do terminal. O comando envia ao servidor apenas o resumo SCRAM-SHA-256, nunca o texto.

```powershell
$env:NEXO_SENHA_API = '<palavra-passe nova, 16+ caracteres ASCII, sem espaços>'
npx tsx src/base/migracoes/cli.ts senha-api --confirmo <ref>
Remove-Item Env:NEXO_SENHA_API
```

### 2.5 Ligar a API ao nexo-dev

Em `backend/.env`:

```dotenv
DATABASE_URL=postgresql://nexo_api.<ref>:<palavra-passe-de-nexo_api>@<servidor-do-pooler>:6543/postgres
```

Arranque a API (`npm run dev`). No arranque, ela confirma que o papel não ignora as políticas; se ignorar, recusa arrancar. Verifique:

```powershell
Invoke-RestMethod http://localhost:3001/api/v1/saude/base
# esperado: estado = ok; base.papelSeguro = True; base.versaoMigracao = 0008 (0004 antes da secção 11)
```

### 2.6 Testes da base no nexo-dev

```powershell
$env:NEXO_TESTE_API_URL   = '<URI do Transaction pooler com nexo_api.<ref>>'
$env:NEXO_TESTE_ADMIN_URL = '<URI do Session pooler com postgres.<ref>>'
$env:NEXO_TESTE_CONFIRMO  = '<ref>'
$env:DB_CA_CERT_FICHEIRO  = '../certificados/supabase-ca.crt'
npm run test:base
Remove-Item Env:NEXO_TESTE_API_URL, Env:NEXO_TESTE_ADMIN_URL
```

Esperado, depois das migrações 0005–0008: **57 testes, 0 saltados, 0 falhas**. São 12 de infraestrutura e isolamento, 21 de identidade na base (incluindo a activação pendente), 14 de autorização da API com a base real e 10 de concorrência na activação. Os de concorrência seguram por instantes um bloqueio consultivo na ligação administrativa para forçar as corridas. Resultado do proprietário a 06/10/2026, antes da Etapa 3: 12/12, sem saltados (`docs/Nexo_Entrega_Etapa_2.md`, secção 14). Execução de 11/10/2026 com 57 testes: falhou por ligação (secção 2.6b), sem validar nem invalidar a etapa. Depois de resolvida a ligação, o proprietário obteve **54/57** (3 falhas de ligação: uma `ENOTFOUND` e duas ao obter ligação do pool) e, na repetição de `activacao_concorrencia.test.ts`, **10/10**. Os 57 cenários foram aprovados em duas execuções, não numa só (`docs/Nexo_Entrega_Etapa_3.md`, secção 16).

Os testes da Etapa 3 criam empresas fictícias com códigos `t-…`. No fim apagam-nas pela ligação administrativa, como dono das tabelas, retirando o FORCE e o trigger de imutabilidade da auditoria **só dentro da transacção de limpeza**.

O teste de concorrência corre 90 transacções com concorrência limitada: por omissão, o triplo do pool (`NEXO_TESTE_POOL_MAX`, omissão 4, logo 12 activas). Pode ajustar com `NEXO_TESTE_CONCORRENCIA`, que tem de ser maior do que o pool. Na saída aparecem, sem dados de ligação:

- a duração;
- a concorrência;
- o pool;
- os tempos por transacção;
- o estado do pool no fim.

### 2.6b Diagnóstico das ligações (sem segredos) — 12/10/2026

Se o `test:base` ou a API falharem a ligar, **não repita a suite**. Cada execução abre dezenas de ligações. Com uma palavra-passe errada, o pooler do Supabase passa a bloquear o utilizador por excesso de falhas (`ECIRCUITBREAKER … too many authentication failures`), e então até as ligações certas falham durante algum tempo.

Na pasta `backend`, com as variáveis na sessão:

```powershell
npx tsx src/base/migracoes/ligacoes.ts            # só analisa os URLs; não se liga a nada
npx tsx src/base/migracoes/ligacoes.ts --testar   # depois: UMA tentativa por ligação
```

- **Sem `--testar`**, a ferramenta mostra servidor, porta, papel, ref, se há palavra-passe, os problemas de forma e a coerência entre variáveis. Os problemas de forma incluem: `@ # / ?`, espaço ou `%` por codificar na palavra-passe; falta de `.<ref>` no utilizador do pooler; porta e papel errados; `sslmode` no URL. A coerência indica se as variáveis apontam para o mesmo projecto, se as palavras-passe de `nexo_api` em `NEXO_TESTE_API_URL` e `DATABASE_URL` são iguais, e se o certificado é legível. **Nunca mostra palavras-passe nem URLs.**
- **Com `--testar`**, faz uma tentativa por URL distinto e diz se ligou (com as migrações aplicadas e a última vista pela API) ou a causa da falha: `palavra_passe_recusada`, `bloqueio_temporario_do_pooler`, `utilizador_ou_projecto_desconhecido`, `certificado`, `tempo_esgotado` ou `servidor_inacessivel`.
- Com `bloqueio_temporario_do_pooler`, espere que o bloqueio passe (o tempo exacto não está confirmado; conte com vários minutos) antes de qualquer nova tentativa, e corrija primeiro a causa.

Desde 12/10 o `test:base` começa por uma **verificação prévia**: uma ligação administrativa e uma `nexo_api`. Se alguma falhar, cada ficheiro falha logo com a causa, sem executar testes, e os ficheiros seguintes não voltam a tentar.

### 2.7 Se a migração 0001 falhar com "permission denied to alter role"

Aconteceu a 06/10/2026 com a primeira versão da 0001, corrigida no mesmo dia.

**Causa:**
- O administrador do Supabase tem CREATEROLE mas não é superutilizador.
- A partir do PostgreSQL 16, esse administrador não pode indicar `NOSUPERUSER`, `NOREPLICATION` nem `NOBYPASSRLS` num `ALTER ROLE`, nem para confirmar o valor actual.

A versão corrigida já não o faz (`docs/Nexo_Entrega_Etapa_2.md`, secção 12).

**Antes de repetir:**

1. Correr `npx tsx src/base/migracoes/cli.ts estado`. Esperado depois da falha:
   - as quatro migrações aparecem `pendente`;
   - "nenhum papel nexo_* existe ainda".

   O executor desfez a transacção inteira. Fica só o esquema `nexo_controlo`, com a tabela de controlo vazia; é criado antes das migrações e é reutilizado.
2. Se `estado` mostrar papéis `nexo_*` com `PROIBIDO`, **não** os aceite: corrija-os ou apague-os com um superutilizador, se não forem usados, antes de repetir.
3. Não apague o esquema `nexo_controlo` nem o histórico para contornar a falha.

Os testes criam duas empresas fictícias ("TESTE AUTOMATICO A/B", com identificadores aleatórios) e apagam-nas no fim. Para isso, o dono retira o FORCE das duas tabelas **só dentro da transacção** de preparação e de limpeza.

---

## 3. Testes

| Comando | Pasta | Precisa de | O que cobre |
|---|---|---|---|
| `npm run lint` | frontend e backend | — | oxlint |
| `npm run build` | frontend e backend | — | `tsc` + build |
| `npm run typecheck` | backend | — | `tsc --noEmit` |
| `npm test` | backend | — | 95 testes: os 66 da Etapa 2 e mais 29 da Etapa 3 — diagnóstico de ligações, scrypt e regras do código, tokens, cookie, limitador, configuração, e-mail (ficheiro, memória, SMTP simulado), rotas com serviços simulados, regras no código |
| `npm run test:base` | backend | Base com as migrações (secção 2.6) | 57 testes contra PostgreSQL real; sem variáveis, são saltados |
| `npm run teste:fluxo` | frontend | `npm run dev` noutro terminal; a API é opcional | 38 passos no navegador (`frontend/testes/fluxo/README.md`) |
| `npm run teste:pwa` | frontend | — (constrói e serve sozinho) | 6 passos: manifesto, service worker, cache, abertura sem servidor |
| `npm run teste:pwa-actualizacao` | frontend | — (constrói duas versões e serve sozinho) | 4 passos: actualização real de A para B no mesmo endereço e perfil |
| `npm run teste:real -- --base … --api … --correio …` | frontend | API com base e `EMAIL_TRANSPORTE=ficheiro`, web em modo `api` (secção 8) | 18 passos no navegador: criar empresa (pendente), login recusado antes da confirmação, reenvio, confirmar e-mail, funcionário, auditoria, operador, desactivação, recuperação, telemóvel |
| `scripts\arranque-limpo.ps1` | nexo | — (ou `-ComBase` com as ligações na sessão) | Arranque numa pasta limpa (secção 6) |

---

## 4. Produção (futuro — não configurada)

Nada de produção foi criado nesta etapa. Quando houver:

- **Projecto Supabase separado**, nunca partilhado com o nexo-dev. As migrações têm de passar primeiro no nexo-dev.
- **Segredos** no gestor de segredos do alojamento, nunca em ficheiros do repositório. `DATABASE_URL` com `nexo_api` pelo Transaction pooler, e o certificado da base.
- **API:**
  - `NEXO_AMBIENTE=producao` (desliga a prova de assinatura e exige `DATABASE_URL`);
  - `CORS_ORIGENS` com o domínio real;
  - HTTPS obrigatório.
- **Frontend:** `VITE_NEXO_MODO=api` quando existirem módulos reais.
- **Migrações:** o comando recusa `NEXO_AMBIENTE=producao` até existir um procedimento aprovado (quem aplica, cópia de segurança antes, verificação depois). As cópias de segurança e a monitorização são da Etapa 10.
- **Por decidir:** o alojamento da API e do frontend.

---

## 5. HTTPS para testar no telemóvel — **PENDENTE**

**Estado:** a configuração está preparada (`vite.config.ts` lê `NEXO_HTTPS_CERT` e `NEXO_HTTPS_CHAVE`), mas **não foi instalada nem testada em nenhum aparelho**.

**Porquê:** a Web Crypto e o service worker só funcionam em contexto seguro. Por `http://<IP>` não funcionam (confirmado na prova da Etapa 1).

**Opção recomendada:** certificados locais com **mkcert**.

1. Instalar o mkcert:

   ```powershell
   winget install FiloSottile.mkcert
   mkcert -install
   ```

   O segundo comando cria uma autoridade local e confia nela neste computador.
2. Gerar o certificado para o computador. Use o IP da rede local, que se vê com `ipconfig`:

   ```powershell
   New-Item -ItemType Directory -Force certificados | Out-Null
   cd certificados
   mkcert -cert-file nexo-dev.pem -key-file nexo-dev-key.pem localhost 127.0.0.1 <IP-do-computador>
   cd ..
   ```

3. Em `frontend/.env.local`:

   ```dotenv
   NEXO_HTTPS_CERT=../certificados/nexo-dev.pem
   NEXO_HTTPS_CHAVE=../certificados/nexo-dev-key.pem
   ```

4. Arrancar com acesso pela rede e abrir `https://<IP-do-computador>:5173` no telemóvel. O Windows pode pedir para permitir a porta 5173 na rede privada.

   ```powershell
   cd frontend
   npm run dev -- --host
   ```

5. **Confiar no certificado no telemóvel.** `mkcert -CAROOT` mostra a pasta da autoridade. Copie **só** o `rootCA.pem` para o telemóvel, por cabo ou por outro meio privado.
   - **Nunca** copie nem partilhe o `rootCA-key.pem`.
   - **Android:** Definições → Segurança → Encriptação e credenciais → Instalar um certificado → Certificado CA → escolher o ficheiro. Os nomes dos menus variam com o fabricante.
   - **iOS/iPadOS:** abrir o ficheiro para descarregar o perfil. Depois:
     - Definições → Perfil descarregado → Instalar;
     - Definições → Geral → Informações → Definições de confiança de certificados → activar a confiança total para essa autoridade.
6. Depois dos testes, retire a autoridade do telemóvel (Android: Credenciais do utilizador; iOS: Definições → Geral → VPN e gestão de dispositivos).

Testes a fazer no aparelho quando isto estiver configurado (nenhum foi feito):

- abrir a aplicação;
- instalar a PWA;
- abrir sem rede depois da primeira visita;
- a prova de assinatura (H-23, secção 6 do respectivo documento).

---

## 6. Arranque numa pasta limpa (verificação prévia)

`scripts\arranque-limpo.ps1` faz o que outro programador faria a partir do repositório:

1. copia para uma pasta nova **só** os ficheiros do repositório (`git ls-files`, incluídos e não ignorados). Não copia `node_modules`, `dist`, `.env`, `.env.local` nem certificados, e falha se algum aparecer;
2. instala as dependências com `npm ci`, exactamente pelo `package-lock.json`;
3. cria uma configuração **nova** a partir dos `.env.example`: API na porta 3101, web na 5273, sem base;
4. corre lint, tipos, builds e testes;
5. arranca a API (`npx tsx src/server.ts`) e a web, e corre o teste do fluxo;
6. só com `-ComBase`: corre `estado`, `verificar` e `test:base` contra o nexo-dev, usando as ligações **da sessão do terminal** (secção 2.2). Nunca as escreve em ficheiros. Não aplica migrações nem apaga nada.

```powershell
cd nexo
powershell -ExecutionPolicy Bypass -File scripts\arranque-limpo.ps1            # sem base
powershell -ExecutionPolicy Bypass -File scripts\arranque-limpo.ps1 -ComBase   # com as variáveis da secção 2.6 na sessão
```

A pasta é criada em `%USERPROFILE%\nexo-arranque-limpo-<data>`. Fica lá para inspecção, sem segredos, e pode ser apagada depois. Não se usa o `%TEMP%`: neste computador tem um nome curto (8.3), que o servidor do Vite recusa servir (HTTP 403).

**Limite:** corre no mesmo computador, com o mesmo Node, a mesma cache do npm e o mesmo navegador. Não substitui o critério do roteiro, "outro programador consegue iniciar aplicação, API e base de dados seguindo o guia".

---

## 7. Teste real de actualização da PWA

```powershell
cd frontend
npm run teste:pwa-actualizacao
```

O teste:

1. constrói duas versões, A e B, em pastas temporárias;
2. serve A em `http://localhost:4176` com um servidor próprio, e abre Edge ou Chrome sem interface num perfil temporário;
3. publica B **no mesmo endereço**, com o **mesmo perfil**. B instala-se e fica à espera; a página continua em A e mostra "Há uma versão nova…". Recarregar sem aceitar não muda de versão;
4. carrega em "Actualizar agora": a página passa para B, o aviso desaparece e a cache de A é apagada.

---

## 8. Aplicação real local (Etapa 3)

Precisa de uma base com as migrações 0001–0008: o nexo-dev depois da secção 11, ou um PostgreSQL local de desenvolvimento.

Terminal 1, API (na pasta `backend`; a ligação `nexo_api` está na sessão, secção 2.2):

```powershell
$env:DATABASE_URL = '<URI do Transaction pooler com nexo_api.<ref>>'
$env:DB_CA_CERT_FICHEIRO = '../certificado/supabase-ca.crt'
$env:EMAIL_TRANSPORTE = 'ficheiro'          # caixa de saída local (secção 9)
npx tsx src/server.ts
```

Terminal 2, web em modo real (na pasta `frontend`):

```powershell
$env:VITE_NEXO_MODO = 'api'
npm run dev
```

Abrir `http://localhost:5173`. Começa em "Entrar". Em "Criar uma empresa nova", crie uma empresa **de teste**. A conta fica **pendente**: não há sessão até confirmar o e-mail, e o ecrã "Confirme o seu e-mail" permite reenviar o link ou corrigir o e-mail. Os links de confirmação e de recuperação aparecem como ficheiros `.txt` em `backend/correio-dev/` (ignorada pelo Git): abra o link no navegador e depois entre.

- O código da empresa pode ficar lembrado no aparelho (não é segredo). O código secreto nunca fica guardado.
- O cookie da sessão é HttpOnly: não aparece em `document.cookie`.
- **Dados de teste no nexo-dev:** as empresas criadas à mão ou pelo `teste:real` ficam na base. A auditoria é imutável e não há comando de apagar. Use nomes e códigos que as identifiquem (`e2e-…`, "TESTE"). Limpá-las exige um procedimento administrativo, ainda por definir.

Teste automático no navegador (com a API e a web acima a correr; a API com `EMAIL_PASTA` conhecida):

```powershell
cd frontend
npm run teste:real -- --base http://localhost:5173/ --api http://localhost:3001 --correio ..\backend\correio-dev
```

No PowerShell, se `--` engolir os argumentos (secção 2.3), use `node testes/real/autenticacao-cdp.mjs --base … --api … --correio …`. O registo público tem um limite de 5 por hora por IP: para repetir o teste muitas vezes, reinicie a API, porque os limites ficam em memória.

## 9. E-mail (recuperação do acesso do proprietário)

| `EMAIL_TRANSPORTE` | Quando | O que faz |
|---|---|---|
| `ficheiro` (omissão fora de produção) | Desenvolvimento | Grava cada mensagem em `EMAIL_PASTA` (omissão `correio-dev`). **Nada é enviado.** A pasta contém links secretos: não a partilhe |
| `smtp` (obrigatório em produção) | nexo-dev com envio real; produção | Envia por um servidor SMTP, com TLS validado: STARTTLS obrigatório na 587, ou TLS implícito na 465 com `SMTP_TLS_IMPLICITO=sim` |
| `desactivado` | — | Não envia; a recuperação por e-mail fica indisponível |

**Envio real ainda não configurado nem testado.** Para o configurar, escolha um fornecedor de envio com SMTP e um domínio de remetente verificado nesse fornecedor. Depois, só na sessão do terminal ou no gestor de segredos:

```powershell
$env:EMAIL_TRANSPORTE = 'smtp'
$env:EMAIL_REMETENTE = 'Nexo <nao-responder@o-seu-dominio>'
$env:SMTP_SERVIDOR = '<servidor SMTP do fornecedor>'
$env:SMTP_PORTA = '587'
$env:SMTP_UTILIZADOR = '<utilizador SMTP>'
$segura = Read-Host 'Palavra-passe SMTP' -AsSecureString
$env:SMTP_SENHA = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura))
$env:NEXO_URL_APLICACAO = 'http://localhost:5173'   # base dos links
```

Verificação real a fazer (por registar):

1. Criar uma empresa de teste com um e-mail seu.
2. Receber o e-mail de confirmação e abrir o link.
3. Pedir "Esqueci o código de acesso", receber o link e definir um código novo.
4. Receber o aviso "o código de acesso foi alterado".
5. Ver que o link usado já não funciona.

Os logs da API registam só a finalidade e o domínio do destinatário (`*@dominio`), nunca o endereço completo, os links ou o conteúdo.

## 10. Recuperação assistida pelo suporte

Para um proprietário que perdeu o código **e** o acesso ao e-mail. Antes de correr o comando, o suporte confirma a identidade e o vínculo ao negócio (por exemplo, presencialmente, com documento e prova de que gere a empresa).

O comando corre com a ligação **administrativa** (secção 2.2), fora dos pedidos da API:

```powershell
cd backend
$env:NEXO_URL_APLICACAO = 'http://localhost:5173'   # endereço da aplicação que o proprietário vai abrir
npx tsx src/base/migracoes/cli.ts suporte-recuperacao --empresa <código-da-empresa> --utilizador <nome> --motivo "<como foi confirmada a identidade e o vínculo>" --confirmo <ref>
```

- Mostra **uma vez** um link de utilização única, válido 24 h (`NEXO_VALIDADE_SUPORTE_HORAS`, de 1 a 48). Entregue-o só pelo canal confirmado, nunca para um e-mail não verificado.
- Fica registado na auditoria da empresa (origem "suporte", com o motivo).
- O proprietário define o código novo pelo link. Todas as sessões terminam, e deve registar um e-mail novo.
- O suporte nunca vê nem define o código.

## 11. Aplicar as migrações da Etapa 3 no nexo-dev

**Estado:** já aplicadas pelo proprietário a 11–12/10/2026 (0005–0008, catálogo OK). Os comandos ficam como referência para outras bases de desenvolvimento.

Com as ligações administrativa e de teste na sessão (secções 2.2 e 2.6), na pasta `backend`:

```powershell
npx tsx src/base/migracoes/cli.ts estado                      # 0001–0004 aplicadas; 0005, 0006, 0007, 0008 pendentes
npx tsx src/base/migracoes/cli.ts migrar --confirmo <ref>     # aplica só 0005–0008, cada uma na sua transacção
npx tsx src/base/migracoes/cli.ts verificar                   # tem de dizer "OK" (regras 1–29)
npm run test:base                                             # 57 testes, 0 saltados
```

- Não apaga nada.
- A 0006 acrescenta o código às empresas que já existam (só dados de teste antigos, `empresa-…`).
- Depois arranque a API e confirme `versaoMigracao = 0008` em `/api/v1/saude/base`.
- Se alguma falhar, registe a mensagem completa. O executor desfaz a migração que falhou, e as anteriores ficam aplicadas.
