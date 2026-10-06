# Nexo — Ambientes e execução (Etapa 2)

Versão 0.3 · 6 de Outubro de 2026 (resultados do nexo-dev; credenciais na sessão; Ctrl+C; arranque numa pasta limpa; actualização da PWA)

Guia para instalar, configurar e arrancar o Nexo em Windows (PowerShell). Os comandos partem da pasta `nexo`.

| Ambiente | Para quê | Estado |
|---|---|---|
| 1. Desenvolvimento local | Frontend, API e protótipo neste computador | Pronto e verificado; também numa pasta limpa (secção 6) |
| 2. Supabase nexo-dev | Base de dados de desenvolvimento: migrações e testes da base | **Migrações 0001–0004 aplicadas e `test:base` 12/12**, executados pelo proprietário a 06/10/2026 (PostgreSQL 17.11) |
| 3. Testes | Testes automáticos | Ver secção 3 |
| 4. Produção | Futuro | **Não configurado** (secção 4) |
| 5. HTTPS para telemóvel | Testar PWA e Web Crypto num aparelho | **Pendente** (secção 5) |

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
- `api`: só a infraestrutura real (estado do sistema). Ainda sem login real nem módulos comerciais.

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

**Não volte a aplicar nem a apagar nada:** `migrar` numa base já migrada responde "Nada a aplicar". Os passos abaixo servem para quem configura um computador novo contra o mesmo nexo-dev: ligações, certificado e verificação.

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
# esperado: estado = ok; base.papelSeguro = True; base.versaoMigracao = 0004
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

Esperado: **12 testes, 0 saltados, 0 falhas**. Resultado do proprietário a 06/10/2026: 12/12, sem saltados (`docs/Nexo_Entrega_Etapa_2.md`, secção 14).

O teste de concorrência corre 90 transacções com concorrência limitada: por omissão, o triplo do pool (`NEXO_TESTE_POOL_MAX`, omissão 4, logo 12 activas). Pode ajustar com `NEXO_TESTE_CONCORRENCIA`, que tem de ser maior do que o pool. Na saída aparecem, sem dados de ligação:

- a duração;
- a concorrência;
- o pool;
- os tempos por transacção;
- o estado do pool no fim.

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
| `npm test` | backend | — | 66 testes: configuração, HTTP, transacções (pool simulado), migrações (cliente simulado), SCRAM, encerramento, regras no código, assinatura (6), custo efectivo (11) |
| `npm run test:base` | backend | Base com as migrações (secção 2.6) | 12 testes contra PostgreSQL real; sem variáveis, são saltados |
| `npm run teste:fluxo` | frontend | `npm run dev` noutro terminal; a API é opcional | 38 passos no navegador (`frontend/testes/fluxo/README.md`) |
| `npm run teste:pwa` | frontend | — (constrói e serve sozinho) | 6 passos: manifesto, service worker, cache, abertura sem servidor |
| `npm run teste:pwa-actualizacao` | frontend | — (constrói duas versões e serve sozinho) | 4 passos: actualização real de A para B no mesmo endereço e perfil |
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
