# Nexo

Plataforma multiempresa de gestão comercial, financeira e de stock para pequenos estabelecimentos em Moçambique. O nome é provisório.

**Estado (12/10/2026):** Etapa 3 (autenticação e empresas) **implementada; verificada localmente e no Supabase nexo-dev pelo proprietário. Não concluída** (`docs/Nexo_Entrega_Etapa_3.md`, secção 16).

- **No nexo-dev** (pelo proprietário, 11–12/10): migrações 0005–0008 aplicadas, catálogo OK, `test:base` 54/57 (3 falhas de ligação) com a repetição da concorrência a 10/10, API com a migração 0008, e testes manuais do registo, da confirmação, do operador e da recuperação.
- **Falta:** envio real de e-mail (adiado por problemas na conta Google), commit e push. A Etapa 4 não foi iniciada.

- A **Etapa 2 continua formalmente não concluída**. Falta outro programador arrancar tudo pelo guia. O proprietário autorizou o início da Etapa 3 com essa pendência.
- Decisões aprovadas: **H-01** (02/10/2026) e **H-02**, com a autenticação e a recuperação do proprietário e o registo público (08/10/2026). As restantes propostas continuam em aberto. A Etapa 0 continua em validação.
- O modo de **demonstração** (Etapa 1) continua com dados fictícios e login simulado, separado da aplicação real.
- A aplicação real (`VITE_NEXO_MODO=api`) tem login, empresa, funcionários, empresa e filial, o meu acesso e auditoria. **Não tem** vendas, stock nem relatórios reais.

## Documentos

| Documento | Conteúdo |
|---|---|
| `docs/Nexo_Ambientes.md` | **Guia de execução**: desenvolvimento local, Supabase nexo-dev, testes, produção futura, HTTPS para telemóvel |
| `docs/Nexo_Entrega_Etapa_3.md` | Entrega da Etapa 3: autenticação, contas, permissões, migrações 0005–0008 (registo com activação pendente), testes, comandos para o nexo-dev |
| `docs/Nexo_Entrega_Etapa_2.md` | Entrega da Etapa 2: alterações, migrações, testes executados, limitações, critérios |
| `docs/Nexo_Especificacao_Etapa_0.md` | Especificação do MVP (versão 0.6, em validação; H-01 e H-02 aprovadas) |
| `docs/Nexo_Arquitectura_Etapa_1.md` | Arquitectura (versão 0.6, proposta; H-01 e H-02 aprovadas; autenticação própria, secção 3.8): modelo de dados, protecção dos custos, contratos da API, operações offline, alinhamento com o roteiro, decisões pendentes |
| `docs/Nexo_Prova_Assinatura_Etapa_1.md` | Prova técnica da autoria por assinatura (H-23, pendente): método, resultados, limitações e opções |
| `docs/Nexo_Teste_Isolamento_H01_2026-10-02.md` | Registo do teste de isolamento H-01 no Supabase de desenvolvimento |
| `docs/versoes/` | Versões anteriores da especificação, da arquitectura e da prova |

## Começar (PowerShell, na pasta `nexo`)

Requisitos: Node.js 22.4 ou posterior (testado com 22.14), npm, e Edge ou Chrome para os testes da interface.

```powershell
cd frontend; npm install; cd ..
cd backend; npm install; if (-not (Test-Path .env)) { Copy-Item .env.example .env }; cd ..
```

Terminal 1 (API):

```powershell
cd backend
npm run dev
```

Terminal 2 (web):

```powershell
cd frontend
npm run dev
```

- Protótipo (modo de demonstração): `http://localhost:5173`, escolher um perfil fictício.
- Estado do sistema (API e base reais, só leitura): `http://localhost:5173/#/sistema`.
- Aplicação real (login, funcionários; precisa de base com as migrações 0001–0008): `VITE_NEXO_MODO=api`, ver `docs/Nexo_Ambientes.md`, secção 8.
- API: `http://localhost:3001/api/v1/saude` e `http://localhost:3001/api/v1/saude/base`.
- Prova técnica de assinatura (só em desenvolvimento): `http://localhost:5173/prova-assinatura.html`.

Ligar ao Supabase nexo-dev, aplicar migrações e HTTPS para telemóvel: `docs/Nexo_Ambientes.md`.

### Fluxo demonstrável (dados fictícios)

1. Entrar como **Ana Chissano (Operador)**.
2. **Caixa** → abrir com 2 000,00.
3. **Balcão** → adicionar produtos e um desconto. Acima de 0% pede o PIN do gestor Carlos (1234). **Pagamento** → numerário com troco → **Concluir venda**.
4. Ver o comprovativo ("Documento interno · Este documento não é uma factura").
5. **Caixa** → **Fechar caixa**: registar a contagem (o esperado não aparece antes), depois ver o esperado e a diferença, e justificar. A contagem cega é uma proposta por validar (H-15).

Estados de sincronização (simulados):

- mude o interruptor **Simulação** para **Offline**, faça uma venda (fica **Pendente**) e volte a **Online** (passa a **Confirmado**);
- em **Sincronização**, "Marcar conflito" numa operação pendente cria um **Conflito**, que o gestor resolve.

"Repor dados" (menu) recupera os dados fictícios iniciais.

## Verificar

```powershell
cd frontend
npm run lint         # oxlint
npm run build        # tsc -b + vite build
npm run teste:fluxo  # 38 passos no navegador; precisa de "npm run dev" noutro terminal
npm run teste:pwa    # 6 passos: service worker e abertura sem servidor (constrói e serve sozinho)
npm run teste:pwa-actualizacao  # 4 passos: actualização real da PWA entre duas builds
npm run teste:real   # 18 passos da aplicação real; precisa de API com base (docs/Nexo_Ambientes.md, secção 8)

cd ..\backend
npm run lint         # oxlint
npm run typecheck    # tsc --noEmit
npm test             # 95 testes (configuração, HTTP, transacções, migrações, autenticação, rotas simuladas, assinatura, custo)
npm run test:base    # 57 testes contra PostgreSQL real: isolamento, identidade, autorização da API, concorrência (docs/Nexo_Ambientes.md, 2.6)
```

- Teste da interface: `frontend/testes/fluxo/README.md`.
- Teste de isolamento H-01: `backend/testes/isolamento/README.md`. Executado a 02/10/2026 no Supabase de desenvolvimento, 22/22. Cobre um esquema mínimo. Nunca correr em produção.

## Estrutura

```text
nexo/
├── docs/                      Especificação, arquitectura, ambientes, entregas
├── frontend/
│   ├── index.html             Aplicação (protótipo em modo de demonstração)
│   ├── prova-assinatura.html  Prova técnica isolada (H-23)
│   ├── public/                Manifesto, ícone e service worker da PWA
│   ├── testes/fluxo/          Teste automático da interface (Chrome DevTools Protocol)
│   ├── testes/pwa/            Teste automático da PWA
│   ├── testes/real/           Teste da aplicação real no navegador (Etapa 3)
│   └── src/
│       ├── app/               Shell, menu, rotas, modo api
│       ├── components/        Componentes comuns (incluindo carregamento e erro)
│       ├── config/            Configuração do frontend (VITE_*, sem segredos)
│       ├── demo/              Dados fictícios, regras e estado da demonstração
│       ├── features/          Ecrãs do protótipo; sistema (estado real)
│       ├── lib/               Moeda, datas, identificadores, useRecurso
│       ├── local/             Base local IndexedDB e contratos da fila (preparação)
│       ├── prova/             Código da prova técnica
│       ├── pwa/               Registo do service worker
│       ├── real/              Aplicação real (Etapa 3): sessão, login, funcionários, empresa, auditoria
│       └── servicos/          Cliente HTTP e serviços reais
└── backend/
    ├── migracoes/             Migrações SQL versionadas e verificação do catálogo
    ├── src/
    │   ├── app.ts, server.ts, encerramento.ts
    │   ├── autenticacao/      Códigos secretos (scrypt), tokens, cookie, limites, protecção das rotas
    │   ├── email/             Envio de e-mail (SMTP, caixa de saída local) e mensagens
    │   ├── servicos/          Identidade (login, sessões, recuperação) e administração da empresa
    │   ├── base/              Acesso à base (transacções, papéis, contexto) e comandos db:*
    │   ├── config/            Configuração validada
    │   ├── http/              Erros, identificação de pedidos, validação
    │   ├── registo/           Logs e remoção de segredos
    │   ├── rotas/             Rotas /api/v1 (saúde, autenticação, administração)
    │   └── prova/             Prova técnica de assinatura (só em desenvolvimento)
    └── testes/
        ├── unidade/           Testes sem base de dados
        ├── base/              Testes contra PostgreSQL real
        ├── custo/             Verificação numérica do custo efectivo
        └── isolamento/        Teste de isolamento H-01 (executado a 02/10/2026)
```

## Próximos passos

1. **E-mail real:** resolver a conta de envio, configurar o SMTP e testar a confirmação e a recuperação com envio real (`docs/Nexo_Ambientes.md`, secção 9).
2. **Commit no GitHub** da Etapa 3, quando o proprietário do projecto o decidir.
3. **Etapa 2:** outro programador, noutro computador, segue o guia (critério ainda pendente).
4. Opcional: uma execução única do `test:base` no nexo-dev sem falhas de ligação, para referência.
5. Só depois disto, e com decisão do proprietário, a Etapa 4.
