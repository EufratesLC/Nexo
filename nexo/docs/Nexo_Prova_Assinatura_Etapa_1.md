# Nexo — Prova técnica de autoria por assinatura (Etapa 1)

Versão 0.2 · 30 de Setembro de 2026 · Hipótese avaliada: **H-23** (especificação 0.4, D.12.4) · Estado: **H-23 pendente**

Versão anterior: `docs/versoes/Nexo_Prova_Assinatura_Etapa_1_v0.1.md`.

**Alterações da 0.2 (revisão da Etapa 1):** não foram feitos testes novos nem mudaram resultados. Acrescentou-se:

- a secção 5.1 com as limitações observadas, ditas de forma explícita;
- a secção 7.1, que distingue o que pode avançar com H-23 pendente do que depende da decisão;
- a correcção da opção D, que já não afirma que o modelo com duas opções resolve a questão.

Resultados brutos: `docs/Nexo_Prova_Assinatura_Etapa_1_resultados.json` (8 execuções guardadas pelo servidor da prova).

---

## 1. O que foi avaliado e o que não foi

A hipótese: cada utilizador tem, em cada dispositivo, uma chave privada **não exportável**. A aplicação só a usa depois do desbloqueio por PIN, e o servidor verifica a assinatura de cada operação com a chave pública registada.

Três coisas diferentes, que a prova mantém separadas:

| Camada | O que a prova mostra |
|---|---|
| **Identidade humana** | Nada. Nenhum teste prova quem estava ao balcão |
| **Desbloqueio por PIN** | É um controlo **da aplicação** (verificador PBKDF2 em memória). O servidor não o vê |
| **Uso da chave** | A assinatura prova que a operação foi assinada por código com acesso à chave naquele perfil de navegador. **Não prova que o PIN foi introduzido** (teste 8) |

## 2. Método

- **Algoritmos:** ECDSA P-256 com SHA-256 (Web Crypto API do navegador e `node:crypto` `webcrypto` no servidor) e PBKDF2-SHA-256 com 310 000 iterações para o verificador de PIN. APIs documentadas; nenhum algoritmo próprio.
- **Assinatura:** o navegador assina o **texto JSON exacto** da operação e envia esse texto. O servidor verifica esses bytes e só depois interpreta o JSON. Depois confirma que `autor` e `registo` são os da chave e que a sequência não é posterior a um encerramento.
- **Armazenamento:** o par de chaves (`CryptoKey`) é guardado no IndexedDB por clonagem estruturada, sem nunca exportar a privada.
- **Código:**
  - `frontend/prova-assinatura.html`, `frontend/src/prova/cripto.ts`, `frontend/src/prova/main.ts` (navegador);
  - `backend/src/prova/assinatura.ts` (servidor, rota `/api/prova-assinatura`, chaves em memória);
  - `backend/src/prova/assinatura.test.ts` (testes em Node).
- **Execução automática:** a página corre as fases pedidas no URL (`?auto=gerar,encerrar,tempos&fechar=1`) e envia os resultados ao servidor. Foi aberta sem interface gráfica (`--headless=new`) com um perfil de navegador próprio numa pasta temporária. Para "reiniciar", abriu-se um **novo processo** do navegador com o mesmo perfil.

## 3. Ambientes onde a prova correu

| Ambiente | Versão | Como |
|---|---|---|
| Microsoft Edge, sem interface | 154 (Chromium) | Windows 10 Pro, este computador |
| Google Chrome, sem interface | 122 | Windows 10 Pro, este computador |
| Node.js (servidor e testes) | 22.14.0 | Windows 10 Pro, este computador |

**Não correu** em: Android, iOS/Safari, Firefox, outro computador, nem em modo com interface gráfica. Ver secção 6.

## 4. Resultados

### 4.1 Navegador

| # | Teste | Edge 154 | Chrome 122 |
|---|---|---|---|
| 1 | Gerar par ECDSA P-256 com a privada não exportável | OK (103,2 ms; `extractable = false`) | OK (71,3 ms) |
| 2 | Tentar exportar a chave privada (JWK e PKCS#8) | OK: ambas recusadas com `InvalidAccessError` | OK: idem |
| 3 | Registar só a chave pública no servidor | OK | OK |
| 4 | Guardar no IndexedDB e recuperar numa nova ligação | OK: `CryptoKey`, `extractable = false`, uso `sign` | OK |
| 5 | Assinar com a chave recuperada; o servidor verifica | OK: aceite | OK: aceite |
| 6 | Alterar o conteúdo depois de assinado | OK: recusada, `assinatura_invalida` | OK: idem |
| 7 | Operação com autor diferente do dono da chave | OK: recusada, `autor_ou_registo_diferente_da_chave` | OK: idem |
| 8 | **Assinar sem desbloqueio por PIN** (chamada directa à Web Crypto) | **Aceite pelo servidor**: confirma o limite | **Aceite**: idem |
| 9 | Encerramento da chave após a sequência 5 | OK: seq. 5 aceite; seq. 6 recusada `chave_encerrada`; seq. 4 recebida depois aceite | OK: idem |
| 10 | **Reiniciar o navegador** (novo processo, mesmo perfil) | OK: chave encontrada e aceite | OK: idem |
| 11 | Apagar a base IndexedDB pela aplicação | OK: chave desaparece; é preciso nova preparação | não repetido |
| 12 | Perfil vazio (equivale a limpar os dados do navegador) | Sem chave: é preciso nova preparação | não repetido |
| 13 | **Copiar a pasta do perfil** para outra pasta no mesmo computador, **na mesma conta do Windows**, e abrir com a cópia | **A chave continuou utilizável e o servidor aceitou a assinatura** | não repetido |
| 14 | Abrir a página por `http://172.30.208.1:5174` (IP de rede, sem HTTPS) | **Falhou**: contexto não seguro, `crypto.subtle` indisponível | não repetido |

### 4.2 Tempos

| Medida | Edge 154 | Chrome 122 | Node 22.14 |
|---|---|---|---|
| Gerar par | 103,2 ms | 71,3 ms | — |
| Assinar (200 operações, JSON + ECDSA) | média 0,299 ms · mediana 0,300 · p95 0,400 · máx. 4,700 | média 0,167 ms · mediana 0,200 · p95 0,300 · máx. 0,800 | média 0,27–0,43 ms · p95 0,34–0,78 (três execuções) |
| Verificar no servidor | 7,6 ms na primeira (arranque); ≈ 1 ms depois | 0,94 ms | média 0,35–0,48 ms · p95 0,46–1,03 (três execuções) |

Os navegadores arredondam o relógio a 0,1 ms, o que explica os valores redondos. **São tempos de um computador de secretária**; num telemóvel modesto têm de ser medidos (secção 6).

### 4.3 Testes do servidor (Node)

`npm test` em `backend/`: **6 testes, 6 passaram.**

1. A privada não exportável não se exporta.
2. Aceita a operação válida e recusa o conteúdo alterado.
3. Recusa a assinatura de outra chave e o autor diferente.
4. O encerramento aceita até N e recusa depois.
5. Recusa registar material de chave privada.
6. Mede os tempos.

## 5. Conclusões

1. **Funciona tecnicamente** em Edge e Chrome no Windows: gerar, guardar, recuperar depois do reinício, assinar, verificar, recusar alterações e encerrar chaves.
2. **"Não exportável" não impede o uso da chave por quem copie o perfil.** A cópia da pasta do perfil, no mesmo computador e na mesma conta do Windows, continuou a assinar operações aceites. O benefício "um segredo copiado sem a chave não produz operações com autor válido" (D.12.4.3) **não se verifica** contra quem copia o perfil inteiro. Falta saber se isto se mantém noutro computador ou noutra conta do Windows.
3. **A assinatura não prova o PIN** (teste 8), como já previa D.12.4.1.
4. **Limpar os dados apaga a chave**: é preciso nova preparação e novo registo, o que é coerente com D.5.3.
5. **Exige contexto seguro** (HTTPS ou `localhost`). Um telemóvel ligado por `http://IP` não consegue correr nem a prova nem a funcionalidade. O produto precisa de HTTPS também na rede local de desenvolvimento.
6. **O custo de desempenho é desprezável** num computador (menos de 1 ms por assinatura). Falta medir num telemóvel.

### 5.1 Limitações observadas (a conservar em qualquer decisão)

| Limitação | Evidência |
|---|---|
| A assinatura prova **o uso da chave** naquele perfil de navegador, e nada mais | Testes 5, 6, 7 e 9 |
| A assinatura **não prova que o PIN foi introduzido** | Teste 8: assinatura pedida sem desbloqueio, aceite pelo servidor |
| A assinatura **não prova a presença da pessoa** nem quem estava ao balcão | Camadas da secção 1; o PIN pode ser partilhado ou observado |
| A **cópia do perfil funcionou** na mesma máquina e na mesma conta do Windows | Teste 13 |
| O resultado da cópia **noutro computador** (ou noutra conta do Windows) **ainda não foi testado** | Secção 6 |
| Sem HTTPS (fora de `localhost`) a Web Crypto não está disponível | Teste 14 |

Nenhum texto do produto, da auditoria ou da documentação pode afirmar mais do que esta tabela (especificação G.2.11).

## 6. O que ainda precisa dos seus aparelhos

| Teste | Porquê | Como |
|---|---|---|
| Telemóvel Android (Chrome), e iOS/Safari se a loja o usar | Suporte e persistência das chaves no aparelho real; tempos num processador modesto | Secção 8.3 (precisa de HTTPS) |
| Reinício real do aparelho e modo de poupança de energia | O teste 10 foi um reinício do processo do navegador, não do sistema | Passos 1 e 2 da página, com o telemóvel reiniciado pelo meio |
| Limpar dados pelo menu do navegador | O teste 12 usou um perfil vazio | Definições do navegador → apagar dados do site → passo 2 |
| Cópia do perfil **para outro computador** ou outra conta do Windows | Decide a conclusão 2 | Copiar a pasta do perfil de teste e abrir com `--user-data-dir` noutro computador que aceda à mesma API |
| Firefox | Outro motor de armazenamento | Opcional, se a loja o usar |

## 7. Opções para decisão (H-23)

Não adoptei automaticamente nenhuma opção, **incluindo a alternativa de autoria declarada**. A decisão é do proprietário do projecto.

| Opção | O que é | A favor | Contra |
|---|---|---|---|
| **A. Adoptar a assinatura** (D.12.4.2) | Chave por utilizador e dispositivo; o servidor verifica cada operação | Autoria verificável no servidor; encerramento por utilizador; operações alteradas no caminho são recusadas; custo de desempenho baixo | Não impede o uso da chave por quem copie o perfil; não prova o PIN; mais código no dispositivo e no servidor; exige HTTPS em todo o lado |
| **B. Autoria declarada restrita** (D.12.4.5) | O servidor aceita o autor só se tiver sessão local activa no registo | Mais simples; suporte universal | Quem tiver a credencial do dispositivo pode atribuir operações a qualquer utilizador com sessão local nesse registo; sem prova de integridade por autor |
| **C. A + chave envolvida por uma chave derivada do PIN** | A privada fica cifrada com uma chave derivada do PIN (PBKDF2) e só é usável depois de o PIN ser introduzido | A assinatura passa a depender criptograficamente do PIN; a cópia do perfil sozinha não basta | Com um PIN de 6 dígitos, quem copiar os dados adivinha-o fora da aplicação (10⁶ tentativas); a chave teria de ser exportável para ser envolvida, o que muda o modelo; mais complexidade |
| **D. Adiar a decisão** | Correr primeiro os testes da secção 6 | Decide com dados dos aparelhos reais | Atrasa o fecho de H-23. O modelo de dados (`autorias_registo.tipo`) admite A e B, mas **isso não resolve a decisão**: só permite que a Etapa 2 avance sem ela (7.1) |

### 7.1 O que pode avançar com H-23 pendente

Detalhe em `docs/Nexo_Arquitectura_Etapa_1.md`, secção 18.

| Pode avançar | Depende da decisão |
|---|---|
| Toda a Etapa 2 (repositório, bases do frontend e do backend, qualidade, PWA e base local preparadas). A decisão H-01 é que bloqueia as migrações, não a H-23 | Etapa 7: formato final de `autoria` no envelope, verificação no servidor, ciclo de vida das chaves ou sessões locais, registo da autoria no dispositivo, textos de autoria na interface e na auditoria |
| Etapas 3 a 6, se for aceite a proposta P-1 (vendas online com a sessão online como autoria) | Etapa 10: protecção dos dados locais (H-11), que depende do que o dispositivo guarda |

**Proposta de classificação** (não é a decisão): H-23 passa a bloquear a **Etapa 7**, em vez da arquitectura. Continua **em aberto** até decisão explícita do proprietário do projecto.

## 8. Como testar

### 8.1 Testes do servidor

```powershell
cd nexo\backend
npm test
```

### 8.2 No navegador deste computador

```powershell
# Terminal 1
cd nexo\backend
npx tsx src/server.ts      # sem "watch": reiniciar apagaria as chaves em memória

# Terminal 2
cd nexo\frontend
npm run dev
```

1. Abrir `http://localhost:5173/prova-assinatura.html`.
2. Carregar nos passos 1 a 4. Fechar o navegador, voltar a abrir a página e carregar no passo 2 (reinício).
3. Testar o PIN (1234): "Assinar com desbloqueio" antes e depois de desbloquear, e "Assinar sem desbloqueio".
4. Resultados: na tabela da página, e em `http://localhost:3001/api/prova-assinatura/resultados`.

Modo automático, por exemplo: `http://localhost:5173/prova-assinatura.html?auto=gerar,encerrar,tempos`.

### 8.3 No telemóvel (precisa de HTTPS)

A Web Crypto não funciona em `http://IP`. Há duas vias; **nenhuma foi instalada nesta etapa**, porque ambas acrescentam dependências ou serviços externos:

- Certificado local para desenvolvimento (por exemplo, o *plugin* `@vitejs/plugin-basic-ssl` do Vite, ou `mkcert`). Depois: `npm run dev -- --host` e abrir `https://<IP-do-computador>:5173/prova-assinatura.html` no telemóvel, aceitando o aviso do certificado. O proxy do Vite encaminha `/api` para a API local.
- Um túnel HTTPS temporário para `localhost:5173`. Expõe a prova na internet enquanto estiver aberto: usar só com dados fictícios.
