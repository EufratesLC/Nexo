# Nexo

Plataforma multiempresa de gestão comercial, financeira e de stock para pequenos estabelecimentos em Moçambique. O nome é provisório.

**Estado:** Etapa 1 (protótipo e arquitectura), revista. A arquitectura é uma **proposta não aprovada**, e a Etapa 0 continua em validação. O protótipo usa **dados fictícios**, não tem servidor, nem autenticação real, nem sincronização real. Vendas reais, Supabase e funcionamento offline chegam nas etapas seguintes do roteiro.

## Documentos

| Documento | Conteúdo |
|---|---|
| `docs/Nexo_Especificacao_Etapa_0.md` | Especificação do MVP (versão 0.5, em validação; H-01 aprovada) |
| `docs/Nexo_Arquitectura_Etapa_1.md` | Arquitectura (versão 0.4, proposta; H-01 aprovada): modelo de dados, protecção dos custos, contratos da API, operações offline, alinhamento com o roteiro, decisões pendentes |
| `docs/Nexo_Prova_Assinatura_Etapa_1.md` | Prova técnica da autoria por assinatura (H-23, pendente): método, resultados, limitações e opções |
| `docs/Nexo_Teste_Isolamento_H01_2026-10-02.md` | Registo do teste de isolamento H-01 no Supabase de desenvolvimento |
| `docs/versoes/` | Versões anteriores da especificação, da arquitectura e da prova |

## Requisitos

Node.js 22 (testado com 22.14) e npm. No Windows, Edge ou Chrome para a prova técnica.

## Instalar

Na pasta `nexo`, em PowerShell:

```powershell
cd frontend; npm install; cd ..
cd backend; npm install; if (-not (Test-Path .env)) { Copy-Item .env.example .env }; cd ..
```

Não há dependências novas nesta etapa.

## Executar

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

- Protótipo: `http://localhost:5173`, escolher um perfil fictício.
- Prova técnica: `http://localhost:5173/prova-assinatura.html`. Precisa da API; para testar o reinício, arrancar a API com `npx tsx src/server.ts` (sem *watch*), porque as chaves da prova ficam em memória.
- API: `http://localhost:3001/api/health`.

### Fluxo demonstrável

1. Entrar como **Ana Chissano (Operador)**.
2. **Caixa** → abrir com 2 000,00.
3. **Balcão** → adicionar produtos, desconto (acima de 0% pede o PIN do gestor Carlos: 1234), **Pagamento** → numerário com troco → **Concluir venda**.
4. Ver o comprovativo ("Documento interno · Este documento não é uma factura").
5. **Caixa** → **Fechar caixa**: registar a contagem (o esperado não aparece antes), depois ver esperado e diferença, e justificar. A contagem cega é uma proposta por validar (H-15).

Para ver os estados de sincronização:

- mude o interruptor **Simulação** para **Offline**, faça uma venda (fica **Pendente**) e volte a **Online** (passa a **Confirmado**);
- em **Sincronização**, "Marcar conflito" numa operação pendente cria um **Conflito**, que o gestor resolve.

"Repor dados" (menu) recupera os dados fictícios iniciais.

## Verificar

```powershell
cd frontend
npm run lint        # oxlint
npm run build       # tsc -b + vite build (protótipo e página da prova)
npm run teste:fluxo # 32 passos no navegador; precisa de "npm run dev" noutro terminal

cd ..\backend
npm run typecheck   # tsc --noEmit
npm test            # assinaturas (6) e custo efectivo (11), com node:test
```

- Teste da interface: `frontend/testes/fluxo/README.md`.
- Teste de isolamento no Supabase (H-01): `backend/testes/isolamento/README.md`. **Executado a 02/10/2026** num projecto de desenvolvimento: 22/22 (registo em `docs/Nexo_Teste_Isolamento_H01_2026-10-02.md`). Cobre um esquema mínimo. Nunca correr em produção.

## Estrutura

```text
nexo/
├── docs/                     Especificação, arquitectura, prova técnica
├── frontend/
│   ├── index.html            Protótipo
│   ├── prova-assinatura.html Prova técnica isolada (H-23)
│   ├── testes/fluxo/         Teste automático da interface (Chrome DevTools Protocol)
│   └── src/
│       ├── app/              Shell, menu, rotas
│       ├── components/       Componentes reutilizáveis
│       ├── demo/             Dados fictícios, regras e estado da demonstração
│       ├── features/         auth, painel, produtos, vendas, caixa, compras, despesas, relatorios, sincronizacao
│       ├── lib/              Moeda (centavos), datas (Africa/Maputo), identificadores
│       └── prova/            Código da prova técnica
└── backend/
    ├── src/
    │   ├── server.ts
    │   └── prova/            Verificação de assinaturas da prova técnica e testes
    └── testes/
        ├── custo/            Verificação numérica do custo efectivo (especificação D.3.11)
        └── isolamento/       Teste de isolamento para o Supabase (H-01), executado a 02/10/2026
```

## Próxima etapa

A Etapa 2 **não foi iniciada**. O que cada decisão pendente impede está em `docs/Nexo_Arquitectura_Etapa_1.md`, secção 18.2. Em resumo:

- **H-01 aprovada em 02/10/2026** (teste 22/22). As migrações têm de cumprir os seus requisitos (arquitectura, 19.7), mas a Etapa 2 só começa por indicação do proprietário do projecto;
- o projecto ainda não está em git;
- H-23 fica pendente e bloqueia a Etapa 7 (proposta de classificação);
- a entrevista à loja piloto continua por fazer.
