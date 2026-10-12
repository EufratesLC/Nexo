# Nexo — Entrega da Etapa 3 (autenticação e empresas)

Versão 0.4 · 12 de Outubro de 2026 · Estado: **implementada; verificada localmente e no Supabase nexo-dev pelo proprietário (secção 16). Etapa 3 não concluída.** Faltam o envio real de e-mail e o commit. A Etapa 2 continua com a pendência do outro programador.

**0.4 — resultados do proprietário no nexo-dev, 11 e 12/10/2026 (secção 16):** migrações 0005–0008 aplicadas; catálogo OK; `test:base` com 54/57 numa primeira execução (3 falhas de ligação) e 10/10 na repetição do ficheiro de concorrência; API com `versaoMigracao=0008`; testes manuais do registo, da confirmação, do operador e da recuperação. **Não foi uma execução única de 57/57.**

**0.3 — revisão da concorrência na migração 0008 (secção 14):** confirmação, reenvio e correcção do e-mail passam a ser serializados por conta; o limite de links aguenta pedidos simultâneos; uma correcção recusada não altera nada. **0008 ainda não foi aplicada em nenhum Supabase**, por isso foi corrigida no próprio ficheiro.

**0.2 — revisão do registo (secção 13):** o registo deixa a conta do proprietário **pendente** até à confirmação do e-mail e não emite sessão. A API e a base impedem o login antes da activação. Nova migração 0008. As contagens de testes desta versão já incluem a revisão.

Roteiro, Etapa 3: _"Garantir que cada cliente usa a mesma plataforma sem ver dados alheios. Criar empresa, utilizadores, associação de contas e funções de proprietário, gestor e operador. Implementar autorização no servidor e políticas de isolamento na base de dados. Preparar a escolha de filial para evolução futura e registar alterações administrativas. Concluída quando: tentativas de consultar ou modificar dados de outra empresa falham na API e na base de dados."_

Ponto de partida:

- Infraestrutura da Etapa 2 no commit `3bf9334`. No nexo-dev (PostgreSQL 17.11): 0001–0004 aplicadas, catálogo verificado, `test:base` 12/12.
- **A Etapa 2 continua formalmente não concluída** (falta outro programador seguir o guia). O proprietário autorizou o início da Etapa 3 com essa pendência (`docs/Nexo_Entrega_Etapa_2.md`, secção 20).
- Não foi iniciada a Etapa 4. Não foi feito commit nem push.

**Quem executou cada verificação** (secção 8):

- **local:** executada por mim neste computador;
- **simulado:** com serviços substituídos por simulações;
- **PostgreSQL local:** num PostgreSQL 17.10 real, mas local, que **não é o Supabase**;
- **por executar:** ainda ninguém a fez.

---

## 1. Decisões

### 1.1 Adoptadas (decisões do proprietário do projecto, 08/10/2026)

| Decisão                      | Conteúdo                                                                                                                                                                                                                                                                                                                                                                     | Onde                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **H-02**                     | Funcionários sem e-mail. Entram com **código da empresa + nome de utilizador + código secreto de acesso**. Conta criada pelo proprietário, que lhes dá o código. Sem código temporário nem mudança obrigatória no primeiro acesso. O código funciona como palavra-passe: não é um identificador público nem um PIN numérico curto                                            | Especificação 0.6: H.1, C.1.2, D.1.6–D.1.8 |
| Autenticação do proprietário | O mesmo mecanismo dos funcionários                                                                                                                                                                                                                                                                                                                                           | Especificação 0.6, C.1                     |
| Recuperação do proprietário  | E-mail de recuperação obrigatório e confirmado. Link de utilização única, com prazo, só para definir um código novo. A redefinição invalida o anterior e termina todas as sessões. Resposta que não revela a conta. Limites de tentativas; nada de códigos ou links nos logs. Sem e-mail: suporte, com identidade e vínculo confirmados, auditado e fora dos pedidos normais | Especificação 0.6, C.1.4                   |
| Registo de empresas          | Público e aberto, com limite de pedidos por IP                                                                                                                                                                                                                                                                                                                               | Especificação 0.6, C.1                     |
| Offline e PIN                | **Etapa 7.** O desbloqueio local, online e offline, usará o mesmo PIN. **Nada implementado nesta etapa**                                                                                                                                                                                                                                                                     | Especificação 0.6, D.13                    |

### 1.2 Escolhas desta implementação — propostas, ajustáveis

| #     | Escolha                                                                                                                                                                 | Motivo                                                                                     |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| P3-1  | O **código da empresa** é escolhido pelo proprietário no registo: 3 a 20 caracteres, letras minúsculas, algarismos e hífen; único; **não pode ser mudado**              | Fácil de dizer aos funcionários. Mudá-lo obrigaria a avisar todos                          |
| P3-2  | Regras do código secreto: 8 a 128 caracteres, qualquer carácter; recusa os triviais e os que contêm o nome de utilizador ou o código da empresa                         | Orientação NIST SP 800-63B (comprimento em vez de regras de composição). Não é um PIN      |
| P3-3  | Sessão: no máximo 12 h, termina com 4 h de inactividade                                                                                                                 | Um turno de loja. Configurável (`SESSAO_*`)                                                |
| P3-4  | Limites: 5 falhas por conta e 30 por IP em 15 min; 5 registos por IP por hora; 3 pedidos de recuperação por conta e 10 por IP em 15 min                                 | Contra tentativas repetidas, sem bloquear uma loja inteira                                 |
| P3-5  | Links: confirmação do e-mail válida 48 h; recuperação 30 min; suporte 24 h (1 a 48)                                                                                     | Prazos curtos para os links que dão acesso                                                 |
| P3-6  | **Só o proprietário** gere contas (H-02). O gestor não vê a lista de contas. A proposta da 0.5 de o gestor gerir operadores deixa de se aplicar                         | H-02 diz "conta criada pelo proprietário". Voltar a dar esse papel ao gestor exige decisão |
| P3-7  | Um proprietário pode criar outro proprietário. O código de um proprietário **não** é redefinido por outro proprietário: recupera-se pelo e-mail ou pelo suporte         | Evita que um co-proprietário tome a conta de outro                                         |
| P3-8  | Ninguém altera a própria função, filiais ou estado, nem por API nem na base                                                                                             | Impede a auto-promoção e a auto-desactivação                                               |
| P3-9  | Os funcionários podem mudar o próprio código (exige o actual). As outras sessões da conta terminam                                                                      | Matriz B.1 ("alterar o próprio…"). Não é obrigatório (H-02)                                |
| P3-10 | Filial: o pedido pode indicar `X-Nexo-Filial`, que a API valida contra as filiais permitidas. Nesta etapa o contexto usa a primeira filial permitida (no piloto há uma) | Preparação pedida pelo roteiro; nenhum dado da Etapa 3 depende da filial                   |

### 1.3 Pendentes

| Tema                                  | O que falta                                                                                                                  | Bloqueia                                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Fornecedor de e-mail                  | Escolher o fornecedor SMTP e o domínio do remetente; configurar e testar o envio real (secção 7.3)                           | A recuperação por e-mail em produção. No nexo-dev funciona com a caixa de saída local |
| Limpeza de dados de teste no nexo-dev | As empresas criadas à mão ou pelo `teste:real` ficam, porque a auditoria é imutável. Procedimento administrativo por definir | Nada; acumula dados `e2e-…`                                                           |
| Limites partilhados entre instâncias  | Os limites de tentativas estão em memória de um processo                                                                     | Mais de uma instância da API (Etapa 10)                                               |
| Restantes decisões                    | H-04, H-21, H-23, H-28, H-29 e as propostas da loja continuam em aberto                                                      | Etapas respectivas                                                                    |

---

## 2. Autenticação: escolha e justificação

**Não se usa o Supabase Auth.**

- O login com palavra-passe do Supabase Auth exige e-mail ou telefone, e os funcionários não têm (H-02).
- Suportá-los exigiria inventar endereços, o que está excluído, ou criar contas pela API administrativa do Supabase com a chave `service_role` na API, o que contraria H-01 (R3).
- Dois mecanismos de identidade (Supabase Auth para o proprietário e outro para os funcionários) duplicariam as sessões, a revogação e os testes.

A autenticação passa a ser **da própria API**, sem dependências novas para a identidade:

| Tema                    | Solução                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Códigos secretos        | **scrypt** (no Node), N = 2^15, r = 8, p = 3 (32 MiB por cálculo), sal aleatório de 16 bytes, resumo de 32 bytes. É o mínimo recomendado pela OWASP para scrypt. Parâmetros guardados com cada resumo (`ln=15,r=8,p=3`), para poderem subir. Normalização Unicode NFC. Cerca de 0,5 s por cálculo no computador de desenvolvimento. **Nunca se guarda nem devolve o código** |
| Onde se compara         | A API calcula o resumo do código introduzido; **a base compara-o** (`iniciar_sessao`). O resumo guardado nunca sai da base                                                                                                                                                                                                                                                   |
| Sessões                 | Token aleatório de 256 bits (`ns_…`) num cookie **HttpOnly, SameSite=Strict, Path=/**. Com `Secure`, o nome tem o prefixo `__Host-` (sempre em produção). A base guarda só o SHA-256. Validado **na base em cada pedido**: não revogado, não expirado, sem inactividade excessiva, conta activa                                                                              |
| Revogação               | Ao sair; ao desactivar a conta; quando o proprietário redefine o código; na recuperação; ao alterar o próprio código (as outras sessões). Reactivar uma conta não faz voltar as sessões antigas                                                                                                                                                                              |
| Pedidos forjados (CSRF) | Cookie `SameSite=Strict`. Além disso, os pedidos que alteram dados exigem `X-Nexo-Cliente: web`, que outro site não consegue enviar sem autorização CORS. CORS só para `CORS_ORIGENS`                                                                                                                                                                                        |
| Navegador               | Nada secreto no armazenamento. Só o **código da empresa** pode ficar em `localStorage`, por escolha do utilizador (não é segredo). O JavaScript não lê o cookie                                                                                                                                                                                                              |
| Mensagens               | Empresa inexistente, conta inexistente e código errado dão **a mesma** resposta. Para uma conta inexistente faz-se o mesmo cálculo scrypt e as mesmas chamadas à base, para o tempo não a revelar. "Conta desactivada" só aparece depois de o código estar certo                                                                                                             |
| Tentativas repetidas    | Limites por IP e por conta. Valem também para contas inexistentes, para o 429 não revelar nada                                                                                                                                                                                                                                                                               |
| Links de e-mail         | Token `ne_…` de 256 bits, guardado só como SHA-256, de utilização única, com prazo. Vai no **fragmento** do link (`#/recuperar-acesso?token=…`), que o navegador não envia a nenhum servidor nem inclui no Referer. A aplicação lê-o, retira-o do endereço e envia-o à API no corpo de um POST                                                                               |
| Logs                    | Sem corpos de pedidos, cookies, cabeçalhos de autorização, códigos, tokens (`ns_`, `ne_`) nem endereços de e-mail completos (só `*@dominio`). Verificado nos testes (secção 8)                                                                                                                                                                                               |
| Credencial privilegiada | Nenhuma nos pedidos. As funções de identidade pertencem a `nexo_autenticacao`: sem login, sem membros, sem BYPASSRLS, com políticas explícitas, e só acessível pelas suas funções. A recuperação assistida usa a ligação **administrativa** das migrações, num comando à parte, fora da API                                                                                  |

**Identificação nos registos.** Os registos e a auditoria identificam a **conta** usada. Como o proprietário conhece o código que definiu para cada funcionário, não provam qual pessoa física o introduziu. Isto está dito na interface ("Funcionários" e "Auditoria") e na especificação (C.1.2).

---

## 3. Fluxos implementados

| Fluxo                              | Passos                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registo (público) — revisto na 0.2 | Empresa (nome, código, NUIT e telefone opcionais), filial `F01`, conta de proprietário **pendente**, código, e-mail de recuperação por confirmar, token de confirmação e auditoria, **numa só função**: tudo ou nada. **Sem sessão.** Ecrã "Confirme o seu e-mail", com reenvio do link e correcção do e-mail. A conta fica activa quando o link é aberto; depois, login normal (secção 13) |
| Login                              | Código da empresa + nome de utilizador + código secreto                                                                                                                                                                                                                                                                                                                                     |
| Funcionários (proprietário)        | Criar (função, filiais, código), alterar nome, função e filiais, desactivar, reactivar, novo código. Cada acto é auditado na mesma transacção                                                                                                                                                                                                                                               |
| O meu acesso                       | Alterar o próprio código. Proprietário: registar, mudar e reenviar o e-mail de recuperação (mudar exige o código actual)                                                                                                                                                                                                                                                                    |
| Confirmar e-mail                   | Link de utilização única. O e-mail pendente passa a confirmado. O anterior confirmado vale até lá. **Se a conta estiver pendente, fica activa na mesma transacção** (0.2)                                                                                                                                                                                                                   |
| Recuperação                        | "Esqueci o código" → resposta igual sempre → link, se a conta for de um proprietário activo com e-mail confirmado → código novo → sessões revogadas, outros links invalidados, aviso por e-mail. Um link por e-mail só vale enquanto esse e-mail continuar a ser o confirmado                                                                                                               |
| Suporte                            | `cli.ts suporte-recuperacao` (ligação administrativa): link de utilização única mostrado uma vez, auditado com o motivo (origem "suporte")                                                                                                                                                                                                                                                  |

---

## 4. Base de dados: migrações 0005–0008

**0001–0004 não foram alteradas** (confirmado com `git diff`; o executor recusaria uma migração aplicada alterada).

| Versão                          | Corre como          | Conteúdo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0005_papel_autenticacao`       | administrador       | Cria `nexo_autenticacao` NOLOGIN NOINHERIT (sem atributos que exijam superutilizador). Se já existir com atributos perigosos ou com membros, pára. `USAGE` no esquema                                                                                                                                                                                                                                                                                                                                                              |
| `0006_identidade`               | `nexo_proprietario` | `empresas` + `codigo` (único), `telefone`, `endereco`. Tabelas `utilizadores` (conta por empresa, com a função), `utilizador_filiais`, `credenciais_acesso`, `sessoes`, `contactos_recuperacao`, `tokens_email` e `registo_auditoria`. ENABLE + FORCE RLS, `empresa_id` e chaves compostas em todas. Trigger de **auditoria imutável** (UPDATE, DELETE e TRUNCATE). Trigger do **último proprietário activo**, com bloqueio por empresa contra a corrida de dois proprietários a desactivarem-se. Privilégios e políticas (abaixo) |
| `0007_funcoes_identidade`       | administrador       | 15 funções `SECURITY DEFINER` e 5 auxiliares, todas com `search_path` fixo e nomes qualificados. Privilégios definidos **antes** da transferência de dono para `nexo_autenticacao`, pelo procedimento de R5 (CREATE temporário)                                                                                                                                                                                                                                                                                                    |
| `0008_activacao_pendente` (0.2) | administrador       | Estado `pendente`. Trigger que põe **pendente** toda a conta criada pelo serviço de identidade (vale também para a `registar_empresa` da 0007). `iniciar_sessao` e `confirmar_email` substituídas pelo próprio dono, com pertença e CREATE temporários, retirados e verificados no fim. Funções novas `reenviar_activacao` e `corrigir_email_activacao`, com limite na base (5 links por hora por conta) (secção 13)                                                                                                               |

**Quem pode o quê na base** (primeira barreira: privilégios; segunda: políticas):

| Tabela                                          | operador                   | gestão (proprietário e gestor)                                                            | nexo_autenticacao    |
| ----------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------- | -------------------- |
| `empresas`, `filiais`                           | ler a sua                  | ler a sua; alterar nome/dados **só com função proprietário**                              | ler, criar (registo) |
| `utilizadores`                                  | ler **só a própria conta** | ler as da empresa; criar e alterar **só proprietário e nunca a própria**                  | ler, criar (registo) |
| `utilizador_filiais`                            | ler as suas                | ler; criar e apagar só proprietário, nunca as suas                                        | ler                  |
| `credenciais_acesso`, `sessoes`, `tokens_email` | **nada**                   | **nada**                                                                                  | pelas funções        |
| `contactos_recuperacao`                         | nada                       | ler **só a própria linha**                                                                | pelas funções        |
| `registo_auditoria`                             | nada                       | inserir como autor = conta do contexto; ler só proprietário; **ninguém altera nem apaga** | inserir              |

**Funções** (resposta mínima; quem executa é verificado no catálogo, regra 25):

- **`nexo_api`, sem contexto:** `parametros_acesso` (parâmetros e sal, **nunca o resumo**), `iniciar_sessao`, `validar_sessao`, `terminar_sessao`, `registar_empresa`, `confirmar_email`, `pedir_recuperacao`, `concluir_recuperacao`.
- **Operador e gestão, com contexto:** `parametros_acesso_proprios`, `alterar_codigo_proprio`.
- **Gestão, com contexto:** `definir_codigo`, `revogar_sessoes`, `definir_email_recuperacao`, `reenviar_confirmacao_email`. Confirmam a conta e a função de proprietário **na base**, não só no contexto.
- **`nexo_proprietario`** (só o administrador das migrações o assume): `suporte_emitir_recuperacao`.

**Verificação do catálogo:** novas regras 21–29, gerais para as tabelas futuras.

- 21: credenciais, sessões e tokens sem privilégios (nem por coluna) para a API e os papéis de execução.
- 22: contactos só lidos pela gestão.
- 23: auditoria imutável (privilégios e trigger activo).
- 24: `nexo_autenticacao` sem membros com SET ou herança.
- 25: matriz exacta de quem executa cada função de identidade.
- 26: a sincronização não toca na identidade.
- 27: o operador não escreve em identidade.
- 28: toda a escrita da gestão em tabelas de identidade tem política que exige o proprietário.
- 29 (0.2): o trigger que deixa pendentes as contas do registo existe e está activo.

**H-01 preservada:**

| Requisito                                      | Como                                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API como `nexo_api`, sem BYPASSRLS             | Inalterado; a API recusa arrancar com papel inseguro                                                                                                          |
| Papéis de execução da lista fixa               | Inalterado. `nexo_autenticacao` não é papel de execução: ninguém faz `SET ROLE` para ele (testado)                                                            |
| Contexto por transacção                        | Inalterado. O `ContextoVerificado` passa a nascer só de `contextoDaSessao(SessaoValidada)`, e a `SessaoValidada` só de `nexo.validar_sessao` (teste estático) |
| ENABLE + FORCE, chaves compostas               | Em todas as tabelas novas (regras 4, 5 e 7)                                                                                                                   |
| Mínimo de privilégios; custos fora do operador | Regras 1–29 OK. Nenhuma coluna de custo nova                                                                                                                  |
| Credencial de serviço nunca nos pedidos        | Inalterado. O suporte usa a ligação administrativa num comando separado                                                                                       |

---

## 5. API

| Rota                                                                                                                  | Quem                                                    |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `POST /api/v1/autenticacao/registo`                                                                                   | Público                                                 |
| `POST /autenticacao/entrar` · `POST /autenticacao/sair` · `GET /autenticacao/sessao`                                  | Público · público · com sessão                          |
| `POST /autenticacao/codigo`                                                                                           | Com sessão (qualquer função)                            |
| `POST /autenticacao/email` · `POST /autenticacao/email/reenviar`                                                      | Proprietário                                            |
| `POST /autenticacao/email/confirmar` · `POST /autenticacao/recuperacao` · `POST /autenticacao/recuperacao/concluir`   | Público (com limites)                                   |
| `POST /autenticacao/activacao/reenviar` · `POST /autenticacao/activacao/email` (0.2)                                  | Público (com limites; o segundo exige o código secreto) |
| `GET /empresa`                                                                                                        | Qualquer função                                         |
| `PATCH /empresa` · `PATCH /filiais/{id}`                                                                              | Proprietário                                            |
| `GET/POST /utilizadores` · `GET/PATCH /utilizadores/{id}` · `POST …/desactivar` · `POST …/reactivar` · `PUT …/codigo` | Proprietário; nunca a própria conta                     |
| `GET /auditoria?limite=&antes=`                                                                                       | Proprietário                                            |

- Corpos validados com esquemas **estritos**: um campo como `empresaId` no corpo dá `400 validacao`.
- Erros novos: `401 nao_autenticado | sessao_terminada | credenciais_invalidas`; `403 permissao_negada | empresa_nao_permitida | filial_nao_permitida | conta_desactivada | propria_conta | codigo_de_proprietario | pedido_nao_confiavel`; `409 codigo_empresa_indisponivel | nome_utilizador_indisponivel | ultimo_proprietario | estado_invalido`; `400 link_invalido | codigo_actual_incorrecto`; `422 filial_invalida | referencia_invalida`; `429 demasiadas_tentativas`.
- Recursos de outra empresa respondem `404` (nunca se revela que existem).

---

## 6. Frontend

O modo `api` (`VITE_NEXO_MODO=api`) passa a ser a **aplicação real** (`src/real/`). O modo de **demonstração** fica intacto e separado: é outra árvore, e o fluxo de 38 passos passou.

| Ecrã                                                        | Acesso                           | Notas                                                                                                                         |
| ----------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Entrar                                                      | Público                          | Código da empresa (pode ficar lembrado), nome de utilizador, código secreto com "Mostrar"                                     |
| Criar empresa                                               | Público                          | Validação no formulário; código da empresa sugerido a partir do nome                                                          |
| Recuperar o acesso / Definir novo código / Confirmar e-mail | Público                          | O token sai do endereço logo que é lido                                                                                       |
| Sessão terminada                                            | —                                | Volta ao login com "A sua sessão terminou" (expirou, foi revogada, o código mudou ou a conta foi desactivada)                 |
| Início                                                      | Todos                            | A sua conta, empresa e filial. Aviso para confirmar o e-mail (proprietário). Diz claramente que ainda não há dados comerciais |
| Funcionários (lista, nova conta, ficha)                     | Proprietário                     | O código não volta a aparecer. Aviso de que os registos identificam a conta, não a pessoa                                     |
| Empresa e filial                                            | Todos (só o proprietário altera) | O código da empresa não se altera                                                                                             |
| O meu acesso                                                | Todos                            | Alterar código; e-mail de recuperação (proprietário)                                                                          |
| Auditoria                                                   | Proprietário                     | Conta usada, acção, alvo; paginação                                                                                           |
| Acesso negado                                               | —                                | Quando a função não tem acesso. O servidor recusa de qualquer modo                                                            |
| Estado do sistema                                           | Público                          | O ecrã da Etapa 2                                                                                                             |

- Estados de carregamento, erro (com "Tentar de novo") e vazio, e mensagens em português.
- Adaptação a telemóvel, verificada a 390 px sem deslocamento horizontal.
- Vendas, stock e relatórios reais **não** foram activados, e não há dados fictícios no modo real.

---

## 7. Dependências e configuração

### 7.1 Dependência nova

| Pacote       | Versão                                             | Onde    | Porquê                                                                                                                                                                                                                                                                                        |
| ------------ | -------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nodemailer` | 10.0.16 (MIT-0, sem dependências; tipos incluídos) | backend | Envio SMTP para a confirmação e a recuperação do proprietário. SMTP serve qualquer fornecedor (não fica preso a uma API comercial). Implementar SMTP com STARTTLS de raiz seria mais arriscado. É configurado com TLS validado (`rejectUnauthorized: true`, TLS ≥ 1.2) e STARTTLS obrigatório |

O scrypt, os tokens, o cookie e os limites usam só o Node.

### 7.2 Variáveis novas (backend; nenhuma em `VITE_*`)

- **Sessão e rede:** `SESSAO_DURACAO_HORAS`, `SESSAO_INACTIVIDADE_MINUTOS`, `SESSAO_COOKIE_SEGURO` (sempre "sim" em produção), `NEXO_PROXIES_CONFIAVEIS`, `NEXO_URL_APLICACAO` (https em produção).
- **E-mail:** `EMAIL_TRANSPORTE` (`ficheiro` fora de produção; **só `smtp` em produção**), `EMAIL_PASTA`, `EMAIL_REMETENTE`, `SMTP_SERVIDOR`, `SMTP_PORTA`, `SMTP_TLS_IMPLICITO`, `SMTP_UTILIZADOR`, `SMTP_SENHA` (só na sessão ou no gestor de segredos), `SMTP_CA_FICHEIRO`.

Exemplos sem valores secretos em `backend/.env.example`. `correio-dev/` está no `.gitignore`.

### 7.3 E-mail: simulado vs real

| Verificação                                                                                         | Estado                                                                                                     |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Mensagens e links gerados, entregues ao transporte em memória e em ficheiro                         | **Executado** (testes locais e PostgreSQL local; navegador com a caixa de saída)                           |
| SMTP contra um servidor **simulado** sem STARTTLS: recusa enviar, sem mandar credenciais nem o link | **Executado** (simulado)                                                                                   |
| Envio **real** por um fornecedor SMTP e recepção na caixa de correio                                | **Por executar.** Precisa do fornecedor, do domínio e das credenciais (`docs/Nexo_Ambientes.md`, secção 9) |

**A recuperação por e-mail não está validada com envio real.** Gerar o link e segui-lo a partir da caixa de saída local não prova a entrega.

---

## 8. Testes e resultados

### 8.1 Executados (local)

| Conjunto                                    | Tipo                                                                                                                                                              | Resultado                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backend `npm test`                          | Local (sem base); inclui serviços **simulados**                                                                                                                   | **91/91**: os 66 anteriores e mais 25 novos                                                                                                                                                                                                                                                                                                                                                            |
| `testes/unidade/autenticacao.test.ts`       | Local                                                                                                                                                             | 10/10: scrypt (determinismo, NFC, sal, limites dos parâmetros), regras do código, tokens, cookie, limitador, configuração de produção, e-mail ficheiro/memória, SMTP simulado sem STARTTLS, logs                                                                                                                                                                                                       |
| `testes/unidade/rotas.test.ts`              | **Simulado** (serviços falsos, base que falha se for usada)                                                                                                       | 12/12 (2 da revisão 0.2: registo 201 sem cookie; login pendente 403 `activacao_pendente`; reenvio neutro e limitado). O servidor recusa o operador e o gestor **sem chamar o serviço**. Também: empresa e filial pedidas, campos desconhecidos, CSRF, origem fora da lista, 429 igual para contas existentes e inexistentes, mensagens iguais, recuperação neutra, cookie `__Host-`, logs sem segredos |
| Testes estáticos                            | Local                                                                                                                                                             | `SessaoValidada` só no serviço de identidade e só a partir de `validar_sessao`; o contexto nunca vem do corpo ou da consulta                                                                                                                                                                                                                                                                           |
| `npm run test:base`                         | **PostgreSQL 17.10 local**, administrador **não** superutilizador (como no Supabase), papéis `anon`, `authenticated` e `postgres` sem login. **Não é o Supabase** | **57/57, 0 saltados**: 12 de infraestrutura e isolamento (anteriores), 21 de identidade, 14 de API, 10 de concorrência na activação (secção 14)                                                                                                                                                                                                                                                        |
| `identidade.test.ts` (21)                   | PostgreSQL local                                                                                                                                                  | Detalhe abaixo                                                                                                                                                                                                                                                                                                                                                                                         |
| `api.test.ts` (14)                          | PostgreSQL local, aplicação completa por HTTP                                                                                                                     | Detalhe abaixo                                                                                                                                                                                                                                                                                                                                                                                         |
| Migrações                                   | PostgreSQL local                                                                                                                                                  | 0005–0007 sobre uma base com 0001–0004 (o caso do nexo-dev): OK. 0001–0007 numa base nova: OK. **0008 sobre as duas: OK.** Segunda execução: "Nada a aplicar". Catálogo OK                                                                                                                                                                                                                             |
| Comando de suporte                          | PostgreSQL local                                                                                                                                                  | Link emitido, código definido pelo link, login com o código novo. Recusa um motivo com menos de 10 caracteres. Auditoria com origem "suporte"                                                                                                                                                                                                                                                          |
| Navegador, aplicação real (`teste:real`)    | Local: Edge sem interface, API e PostgreSQL locais, caixa de saída em ficheiro                                                                                    | **18/18** em duas execuções seguidas depois da revisão 0.2 (secção 8.3). Antes da revisão, 15/15; uma das cinco execuções falhou um passo, sem registo de qual. Causa provável, não confirmada: a caixa de saída era lida a tempo fixo (500 ms) depois do envio assíncrono. Passou a esperar pelo ficheiro até 10 s, e as execuções seguintes passaram                                                 |
| Demonstração (`teste:fluxo`)                | Local                                                                                                                                                             | **38/38** (sem regressão)                                                                                                                                                                                                                                                                                                                                                                              |
| PWA (`teste:pwa`, `teste:pwa-actualizacao`) | Local                                                                                                                                                             | **6/6** e **4/4**                                                                                                                                                                                                                                                                                                                                                                                      |
| Lint, tipos, build                          | Local                                                                                                                                                             | Backend: `oxlint` limpo, `tsc --noEmit` OK. Frontend: `oxlint` limpo, `tsc -b` e `vite build` OK                                                                                                                                                                                                                                                                                                       |
| Log real da API durante o navegador         | Local                                                                                                                                                             | 166 linhas sem tokens, códigos, cookies nem e-mails completos                                                                                                                                                                                                                                                                                                                                          |

**`identidade.test.ts` (base real, pelos serviços e por SQL directo):**

- Registo completo: só o resumo, e-mail pendente, auditoria.
- **Sem registos parciais:** código repetido dá 409; uma falha na 3.ª inserção dentro de `registar_empresa` não deixa a empresa.
- O mesmo nome de utilizador em duas empresas, sem cruzamento.
- Sessão:
  - só o SHA-256 do token na base;
  - terminar, expirar e inactividade invalidam a sessão;
  - desactivar termina as sessões, e reactivar não as faz voltar.
- Códigos:
  - a redefinição revoga as sessões e o código antigo deixa de servir;
  - a auditoria não guarda o segredo;
  - quem altera o próprio código mantém a sessão actual e perde as outras.
- Operador: `permission denied` ao criar contas, mudar a função, chamar `definir_codigo`, ler credenciais, sessões, auditoria ou contactos. Vê só a própria conta.
- Gestor: as políticas não deixam criar contas, alterar outras, auto-promover-se, definir códigos, ver a auditoria nem alterar a empresa.
- Proprietário: não altera a própria conta na base.
- **Isolamento A/B:** leituras e escritas de B com identificadores certos dão 0 linhas ou `42501`; a filial de B numa conta de A é recusada pela chave composta; `definir_codigo` de uma conta de B dá "não encontrado"; pelo serviço, as contas de B "não existem".
- **Último proprietário:** dois proprietários a desactivarem-se em simultâneo; só um consegue. O trigger recusa também como dono das tabelas.
- E-mail: confirmação de utilização única.
- Recuperação:
  - nada é enviado sem e-mail confirmado, para conta inexistente ou para operador;
  - o segundo link invalida o primeiro;
  - utilização única, prazo, revogação das sessões, aviso por e-mail.
- Suporte: `nexo_api` não executa a função; só `nexo_proprietario` o faz.
- `nexo_api` sem contexto não lê nada de identidade e não assume `nexo_autenticacao`; `parametros_acesso` não devolve o resumo.
- Auditoria imutável.
- **Verificação do catálogo:** OK, e **detecta** quatro mutações revertidas (SELECT da gestão nas credenciais, UPDATE do operador, trigger desligado, `nexo_api` membro de `nexo_autenticacao`).

**`api.test.ts` (HTTP com a base real):**

- Cookie HttpOnly/SameSite e corpos sem segredos.
- CSRF.
- Mensagens de login iguais.
- O mesmo nome em duas empresas.
- 401 sem sessão e com sessão terminada.
- **Operador e gestor recebem 403 em todas as funções do proprietário, e nada muda.**
- **Escolher outra empresa ou filial pelo pedido é recusado**; `empresaId` no corpo é recusado.
- **Proprietário de A contra recursos de B: 404 em ler, alterar, desactivar, redefinir código e alterar filial; a filial de B dá 422; B fica intacta.**
- Sem auto-promoção nem auto-desactivação; o código de outro proprietário não é redefinido.
- Desactivação e redefinição terminam as sessões existentes.
- Recuperação neutra, link no fragmento, código fraco recusado, link de utilização única.
- 429 igual para contas existentes e inexistentes.
- A auditoria tem os actos e nenhum segredo.
- **Os logs da API não contêm** códigos, tokens de sessão ou de e-mail, cookies nem endereços completos.

### 8.2 Mutação

Desliguei temporariamente a verificação da função na API (`exigirFuncao`). O `api.test.ts` falhou no teste do operador e gestor, como devia, e a alteração foi revertida.

As quatro mutações do catálogo (8.1) também foram detectadas.

### 8.3 Passos do teste no navegador (`frontend/testes/real/autenticacao-cdp.mjs`)

1. Sem sessão abre em "Entrar", sem perfis fictícios.
2. Criar empresa (validação no formulário, depois registo): ecrã "Confirme o seu e-mail" e **sem sessão** (`/sessao` dá 401).
3. Antes da confirmação, o login com o código certo é recusado ("ainda não está activa") e não cria sessão.
4. Reenviar a confirmação: resposta neutra; o link anterior deixa de valer.
5. Confirmação válida: "Conta activada", o token sai do endereço; abrir o mesmo link outra vez é recusado.
6. Login normal do proprietário depois da confirmação.
7. Criar um operador; o código não volta a aparecer.
8. A auditoria mostra os actos e a conta usada.
9. Nada secreto no navegador: `document.cookie` vazio, sem códigos ou tokens no armazenamento.
10. Sair.
11. Código errado: mensagem neutra.
12. Operador: menu reduzido e "Sem acesso" em Funcionários.
13. O proprietário desactiva o operador pela API; a sessão aberta no navegador termina.
14. Login: "desactivada".
15. Recuperação do proprietário pelo link.
16. O código antigo falha e o novo entra.
17. Telemóvel a 390 px sem deslocamento horizontal (início, funcionários, o meu acesso, empresa).
18. Sem erros de JavaScript na consola.

### 8.4 Por executar

| Verificação                                                             | Porquê                                                                                                                                            | Comando                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| ~~Migrações 0005–0008, catálogo e `test:base` 57 no Supabase nexo-dev~~ | **Executado pelo proprietário a 11 e 12/10** (secção 16): 54/57 numa primeira execução e 10/10 na repetição da concorrência                       | —                                  |
| API e aplicação real ligadas ao nexo-dev                                | API verificada e fluxos testados **manualmente** pelo proprietário (secção 16). O teste automático `teste:real` não foi corrido contra o nexo-dev | Secção 10, passo 4 (opcional)      |
| **Envio real de e-mail** (confirmação, recuperação, aviso)              | Falta escolher e configurar o SMTP                                                                                                                | `docs/Nexo_Ambientes.md`, secção 9 |
| Telemóvel real com HTTPS                                                | Pendente desde a Etapa 2                                                                                                                          | `docs/Nexo_Ambientes.md`, secção 5 |
| Carga e várias instâncias da API                                        | Etapa 10                                                                                                                                          | —                                  |

---

## 9. Limitações conhecidas

1. **Limites de tentativas em memória** de um processo: um reinício limpa-os e várias instâncias não os partilham. Atrás de um proxy é preciso `NEXO_PROXIES_CONFIAVEIS`, senão todos os pedidos parecem vir do mesmo IP.
2. **Bloqueio temporário de contas por terceiros:** quem souber o código da empresa e um nome de utilizador pode provocar 15 min de bloqueio dessa conta. É o custo de limitar por conta. A mensagem é igual para todas as contas.
3. **Custo do scrypt:** cerca de 0,5 s por cálculo neste computador; 8 em paralelo levaram 2,2 s. O registo faz dois cálculos. Os limites protegem contra abuso, mas é preciso medir no servidor real.
4. **A API valida a sessão na base em cada pedido:** uma ida a mais à base por pedido. Simples e revogável de imediato; rever com carga real.
5. **Dados de teste no nexo-dev:** os testes automáticos de base apagam os seus. O `teste:real` e os testes manuais deixam empresas `e2e-…` ou "TESTE", porque a auditoria é imutável e não há comando de apagar.
6. **Sessões expiradas** ficam na tabela (revogadas ou fora de prazo). A limpeza periódica fica para a Etapa 10.
7. **Contexto de filial:** validado, mas o contexto usa a primeira filial permitida (P3-10).
8. **O código da empresa não se altera** (P3-1).
9. **A recuperação por e-mail não está validada com envio real** (7.3).
10. **A conta identifica-se, a pessoa não:** limite assumido por H-02 (secção 2).

---

## 10. Comandos manuais para o nexo-dev

PowerShell, na pasta `nexo\backend`, com as ligações **só na sessão do terminal** (`docs/Nexo_Ambientes.md`, secções 2.2 e 2.6). Nenhum comando apaga ou reinicia a base.

```powershell
# 1. Estado: 0001–0004 aplicadas; 0005, 0006, 0007 e 0008 pendentes
npx tsx src/base/migracoes/cli.ts estado

# 2. Aplicar só as pendentes (cada uma na sua transacção)
npx tsx src/base/migracoes/cli.ts migrar --confirmo <ref>

# 3. Verificação do catálogo: tem de dizer "OK" (regras 1–29)
npx tsx src/base/migracoes/cli.ts verificar

# 4. Testes contra o nexo-dev: esperado 57 testes, 0 saltados, 0 falhas
npm run test:base
```

A seguir, arranque a API e confirme `/api/v1/saude/base` com `versaoMigracao = 0008`. Opcionalmente, verifique a aplicação real no navegador (`docs/Nexo_Ambientes.md`, secção 8; o `teste:real` cria uma empresa `e2e-…` que fica no nexo-dev).

Registe para esta entrega: a saída de `estado` e de `verificar`, o resumo do `test:base` (testes, falhas, saltados) e qualquer mensagem de erro completa.

---

## 11. Critérios de aceitação

### 11.1 Roteiro, Etapa 3

| Critério                                                                                                  | Estado                                                                       | Evidência                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Criar empresa                                                                                             | Feito                                                                        | Registo atómico, com activação pendente até confirmar o e-mail (C.1, revisão 0.2); testes locais e no navegador                                                                                                                                                                                                                         |
| Utilizadores, associação de contas, funções P/G/O                                                         | Feito                                                                        | Contas por empresa (H-02), função e filiais; matriz no servidor e na base                                                                                                                                                                                                                                                               |
| Autorização no servidor                                                                                   | Feito                                                                        | `exigirSessao` e `exigirFuncao`; 403 sem chamar o serviço (simulado); 403/404 com a base real                                                                                                                                                                                                                                           |
| Políticas de isolamento na base                                                                           | Feito (PostgreSQL local)                                                     | ENABLE + FORCE, políticas por empresa e função, chaves compostas; 21 testes de identidade e 12 de infraestrutura                                                                                                                                                                                                                        |
| Preparar a escolha de filial                                                                              | Feito (preparação)                                                           | `utilizador_filiais`; `X-Nexo-Filial` validado; filiais permitidas na sessão                                                                                                                                                                                                                                                            |
| Registar alterações administrativas                                                                       | Feito                                                                        | `registo_auditoria` imutável; ecrã do proprietário                                                                                                                                                                                                                                                                                      |
| **Concluída quando: tentativas de consultar ou modificar dados de outra empresa falham na API e na base** | **Cumprido localmente e no nexo-dev** (resultado do proprietário, secção 16) | API: `api.test.ts` (404/403/422, B intacta). Base: `identidade.test.ts` (0 linhas, `42501`, `23503`, `P0002`) e `integracao.test.ts`. Executados contra PostgreSQL 17.10 local e, pelo proprietário, contra o Supabase nexo-dev (PostgreSQL 17.11) na execução de 54/57, em que as 3 falhas foram de ligação e nenhuma destes ficheiros |

Antes de avançar, o roteiro pede também **um commit no GitHub**. Fica pendente, por decisão do proprietário.

### 11.2 Especificação G.1

| #     | Critério                                                              | Estado                                                                                                       |
| ----- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| G.1.1 | Registo e assistente: empresa, filial, numerário activo, proprietário | Parcial: empresa, filial e proprietário sim. Os métodos de pagamento (numerário) não fazem parte desta etapa |
| G.1.2 | Utilizador de A pede dados de B pela API: nada de B                   | Cumprido localmente (`api.test.ts`)                                                                          |
| G.1.3 | Acesso directo à base com a identidade de A: só linhas de A           | Cumprido localmente (`identidade.test.ts`, `integracao.test.ts`)                                             |
| G.1.4 | Gestor tenta criar uma conta ou alterar uma função: recusado          | Cumprido localmente (API e base)                                                                             |
| G.1.5 | O último proprietário não pode ser desactivado                        | Cumprido localmente (trigger, incluindo concorrência; a API recusa a própria conta)                          |
| G.1.6 | Códigos de registo de dispositivo                                     | Etapa 7                                                                                                      |

### 11.3 H-01, requisito R2 ("testar a autorização da API na Etapa 3")

Feito localmente: `api.test.ts` (base real) e `rotas.test.ts` (simulado). **Executado também no nexo-dev pelo proprietário** (secção 16).

---

## 12. Ficheiros

**Backend, novos:**

- `migracoes/0005_papel_autenticacao.sql`, `0006_identidade.sql`, `0007_funcoes_identidade.sql`, `0008_activacao_pendente.sql` (0.2);
- `src/autenticacao/` (`codigoSecreto.ts`, `tokens.ts`, `cookies.ts`, `limitador.ts`, `middleware.ts`);
- `src/servicos/` (`identidade.ts`, `administracao.ts`);
- `src/email/` (`envio.ts`, `mensagens.ts`);
- `src/rotas/autenticacao.ts`, `src/rotas/administracao.ts`, `src/http/errosBase.ts`;
- testes: `testes/unidade/autenticacao.test.ts`, `testes/unidade/rotas.test.ts`, `testes/base/ajuda.ts`, `testes/base/identidade.test.ts`, `testes/base/api.test.ts`.

**Backend, alterados:**

- `src/app.ts`, `src/rotas/v1.ts`, `src/base/acesso.ts`, `src/base/contexto.ts`, `src/config/ambiente.ts`, `src/registo/sanitizar.ts`;
- `src/base/migracoes/cli.ts` (`suporte-recuperacao`);
- `migracoes/verificacoes.sql` (regras 21–29);
- `package.json` (`nodemailer`; `test:base` com `--test-concurrency=1`), `.env.example`;
- testes adaptados: `integracao.test.ts` (código da empresa, última migração), `migracoes.test.ts`, `configuracao.test.ts`, `app.test.ts`, `encerramento.test.ts`, `estatico.test.ts`.

**Frontend:**

- novos: `src/real/` (aplicação real e ecrãs; na 0.2, `ecras/RegistoPendente.tsx` e `memoria.ts`), `src/servicos/autenticacao.ts`, `src/servicos/administracao.ts`, `testes/real/autenticacao-cdp.mjs`;
- alterados: `src/servicos/http.ts` (cookie da mesma origem, `X-Nexo-Cliente`, aviso de sessão terminada, erros por campo), `src/app/ModoApi.tsx`, `src/App.css`, `package.json` (`teste:real`), `.env.example`.

**Documentação e repositório:**

- este documento;
- especificação 0.6, arquitectura 0.6, guia 0.4, README;
- `Nexo_Entrega_Etapa_2.md` (secção 20);
- cópias das versões 0.5 em `docs/versoes/`;
- `.gitignore` (`correio-dev/`).

---

## 13. Revisão de 08/10/2026: registo com activação pendente

**Problema.** O fluxo definido exige a confirmação do e-mail do proprietário **antes** de activar o acesso. A versão 0.1 criava a conta activa: o registo enviava o e-mail e chamava logo o login, devolvendo uma sessão.

**Correcção (versão 0.2):**

1. **Criação atómica, activação pendente.** A empresa, a filial e o proprietário continuam a ser criados numa só função (tudo ou nada). Mas a conta nasce com o estado `pendente`. Quem o impõe é um **trigger na base** (`utilizadores_registo_pendente`, migração 0008), para toda a conta criada pelo serviço de identidade. Assim vale também para a `registar_empresa` da 0007, mesmo chamada directamente.
2. **Sem sessão no registo.** `POST /autenticacao/registo` responde `201 { activacaoPendente: true, … }` sem `Set-Cookie`; `/autenticacao/sessao` continua a dar 401.
3. **Ecrã "Confirme o seu e-mail"** (`#/registo-pendente`):
   - instruções;
   - "Reenviar o e-mail": resposta neutra; limites na API (3 por conta e 10 por IP em 15 min) e na base (5 links por hora por conta); cada reenvio invalida os links anteriores;
   - "Enganou-se no e-mail?": exige o código secreto e conta como tentativa de login.
   - A mensagem com o e-mail fica só em memória, nunca no endereço nem no armazenamento.
4. **Login antes da activação recusado na API e na base.**
   - A `iniciar_sessao` substituída devolve `pendente` (só depois de o código estar certo) e **não cria sessão**.
   - A API responde `403 activacao_pendente`, com ligação ao reenvio.
   - A `validar_sessao` já exigia a conta activa. A recuperação por e-mail não serve contas pendentes.
5. **Depois da confirmação, login normal.** A `confirmar_email` substituída confirma o e-mail e activa a conta **na mesma transacção**, e audita `utilizador.activado`. A API devolve `contaActivada: true` e o ecrã diz "Conta activada".
6. **Ecrãs dos links:** a chave do componente passa a ser o token. Abrir outro link no mesmo separador recria o ecrã; antes ficava com o token anterior (defeito encontrado pelo teste no navegador).

**Substituição das funções da 0007 sem alterar a 0007.** A 0008 dá ao administrador, temporariamente, `SET` sobre `nexo_autenticacao` e `CREATE` no esquema, para o dono substituir as funções. No fim retira ambos e verifica: dono, sem `PUBLIC`, sem `SET`, sem `CREATE`. É o mesmo padrão de R5. As funções novas só são executáveis por `nexo_api` (regra 25), e o trigger é verificado pela regra 29.

**Testes da revisão:**

| Teste                                                                                                                                                                                                                                                                                  | Tipo                   | Resultado                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------- |
| Conta nasce pendente e sem sessão; login (pelo serviço e por SQL directo como `nexo_api`, com o resumo certo) não cria sessão; código errado não revela o estado; `registar_empresa` chamada directamente também fica pendente; recuperação não serve contas pendentes                 | PostgreSQL local       | OK                         |
| Confirmação **expirada** não activa; **reenvio** invalida o link anterior; confirmação **válida** activa; **repetida** recusa; depois o login funciona; reenvio para conta activa ou inexistente não envia nada; auditoria `utilizador.activado`                                       | PostgreSQL local       | OK                         |
| Limite na base: registo + 4 reenvios, os seguintes recusados; correcção do e-mail recusada com código errado, recusada enquanto dura o limite e aceite depois; o novo e-mail recebe o link e fica confirmado                                                                           | PostgreSQL local       | OK                         |
| HTTP: registo sem cookie; `/sessao` 401; login antes da confirmação dá 403 `activacao_pendente` sem cookie; reenvio com resposta igual para conta pendente e inexistente; link antigo inválido; confirmação válida `contaActivada: true`; repetida inválida; login com cookie HttpOnly | PostgreSQL local, HTTP | OK                         |
| Rotas com serviços simulados: registo 201 sem cookie; login pendente 403; reenvio neutro e 429 ao 4.º pedido da mesma conta                                                                                                                                                            | Simulado               | OK                         |
| Navegador: passos 2 a 6 da secção 8.3                                                                                                                                                                                                                                                  | Local                  | OK (18/18, duas execuções) |
| **Mutação:** trigger da 0008 desligado → a verificação do catálogo acusa `registo_sem_activacao_pendente` e os testes de identidade falham; trigger reposto → OK                                                                                                                       | PostgreSQL local       | Detectado                  |

**Totais depois da revisão:** `npm test` 90/90; `test:base` 47/47, 0 saltados; navegador 18/18; demonstração 38/38; PWA 6/6 e 4/4; lint, tipos e build OK.

**Limitações da revisão:**

- Um registo nunca confirmado fica pendente e reserva o código da empresa. A expiração ou limpeza de registos pendentes está por definir.
- O suporte só emite recuperação para proprietários activos: um registo pendente sem acesso ao e-mail pode corrigir o e-mail com o código secreto, mas não tem outra via.
- O envio real de e-mail continua por testar (7.3).

**A Etapa 3 continua não concluída:** falta a verificação no nexo-dev (secção 10), o envio real de e-mail e o commit.

---

## 14. Revisão de 11/10/2026: concorrência na migração 0008

Revisão pedida antes de aplicar a 0008 no Supabase. **A 0008 ainda não foi aplicada em nenhuma base Supabase.** Por isso foi corrigida no próprio ficheiro, e não com uma 0009. As bases locais onde estava aplicada foram recriadas.

### 14.1 Problemas confirmados

1. `emitir_link_activacao` contava os links da última hora e inseria um novo **sem serializar** os pedidos da mesma conta. Pedidos simultâneos podiam ler todos a mesma contagem e ultrapassar o limite de 5.
2. `corrigir_email_activacao` alterava `email_pendente` **antes** de verificar o limite. Com o limite atingido, a função terminava sem erro: o endereço novo ficava gravado, sem link, sem envio e sem auditoria, e os links do endereço anterior deixavam de valer (a confirmação exige `email_pendente = email do link`).

### 14.2 Correcção

- **Um único bloqueio por conta, sempre pela mesma ordem**, nas três funções (`confirmar_email`, `reenviar_activacao`, `corrigir_email_activacao`), através de `nexo.bloquear_activacao`:
  1. bloqueio consultivo da transacção (`pg_advisory_xact_lock`, chave `nexo.activacao` + conta);
  2. a linha da conta em `contactos_recuperacao` (`FOR UPDATE`), o que serializa também com as funções com sessão da 0007, que bloqueiam essa linha antes dos tokens;
  3. só depois os tokens e a conta.

  Ninguém pede estes bloqueios por outra ordem, por isso não há impasses entre estas funções.

- **Releitura depois do bloqueio.** Antes do bloqueio, cada função só descobre a que conta se refere. Depois relê tudo (em READ COMMITTED, cada instrução PL/pgSQL tem um instantâneo novo) e decide sobre o estado já gravado pelas outras.
- **O limite conta-se com o bloqueio na mão** (`nexo.limite_activacao_atingido`). Pedidos simultâneos são atendidos um a um e o sexto link na mesma hora nunca é emitido.
- **Correcção tudo ou nada:** verifica o estado pendente, o código e o limite **antes** de qualquer alteração. Se for recusada, o endereço anterior e os seus links ficam exactamente como estavam. Se for aceite, o endereço, a invalidação dos links antigos, o link novo e a auditoria mudam na mesma transacção (uma só chamada à função).
- **A confirmação nunca usa um endereço desactualizado.** Com o bloqueio na mão, só aceita um token por usar, não invalidado, dentro do prazo e cujo endereço seja o **pendente nesse momento**. Uma correcção ou um reenvio que tenha ganho a corrida já invalidou o link antigo. Se a confirmação ganhar, a conta fica activa com o endereço pendente nesse instante, e a correcção ou o reenvio que chega depois encontra a conta activa e não faz nada.
- **Dois usos do mesmo link:** serializados; o segundo encontra o token usado.
- A verificação final da 0008 inclui as funções novas: dono `nexo_autenticacao`, sem `PUBLIC`. As auxiliares (`bloquear_activacao`, `limite_activacao_atingido`, `emitir_link_activacao`) não são executáveis por nenhum outro papel.

### 14.3 Testes de concorrência (`testes/base/activacao_concorrencia.test.ts`)

**Método:**

- O teste segura o bloqueio consultivo da conta numa ligação administrativa e lança os pedidos, cada um na sua ligação do pool, como na API.
- Espera até estarem **todos à espera desse bloqueio na base** (`pg_locks`) e só então o liberta. Assim as corridas acontecem de facto.
- Nos cenários com ordem, cada pedido só é lançado depois de o anterior estar na fila. O PostgreSQL atende-os por ordem de chegada, por isso cada resultado é determinístico e cada ordem é testada à parte.

| Cenário                                                                                                | Resultado esperado e verificado                                                                                                                            |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6 reenvios simultâneos com 4 links já emitidos                                                         | 5 links no total, 1 envio a mais, 1 link válido                                                                                                            |
| 10 reenvios simultâneos logo após o registo                                                            | 5 links no total (4 novos), 5 envios, 1 link válido                                                                                                        |
| Correcção com o limite atingido                                                                        | Recusada; fotografia antes e depois **igual** (contacto, links e auditoria); nada enviado para o endereço novo; o link anterior continua a activar a conta |
| Correcção e reenvio simultâneos no último link permitido                                               | Só a correcção (primeira na fila) passa; o reenvio não emite nem envia; uma única auditoria `email_alterado`                                               |
| Confirmação antes da correcção                                                                         | `activada` com o endereço inicial; correcção recusada; sem alterações de endereço nem auditoria                                                            |
| Correcção antes da confirmação                                                                         | Correcção aceite; a confirmação com o link antigo dá `invalido`; a conta continua pendente; o link do endereço novo activa-a                               |
| Confirmação antes do reenvio                                                                           | `activada`; o reenvio não emite nem envia nada                                                                                                             |
| Reenvio antes da confirmação                                                                           | O link antigo fica invalidado e dá `invalido`; o novo activa                                                                                               |
| Duas confirmações simultâneas com o mesmo link                                                         | Uma `activada`, uma `invalido`; uma única auditoria `activado` e `email_confirmado`                                                                        |
| Sem barreira: 6 confirmações em paralelo com o mesmo link; 2 recuperações em paralelo com o mesmo link | Uma só passa em cada caso                                                                                                                                  |

**Resultados (local, PostgreSQL 17.10, não Supabase):**

- 10/10, repetido 3 vezes seguidas sem falhas.
- **Mutações:** a versão com (1) o limite do reenvio contado antes do bloqueio e (2) a correcção a gravar o endereço antes de verificar o limite falhou **4 dos 10** testes, exactamente os que tocam no limite e na correcção recusada. Os 6 de confirmação passaram, porque essas mutações não lhes tocam. A base de dados com a mutação foi apagada.

### 14.4 Sessão antes da confirmação (confirmado)

- `registar()` no serviço não chama `entrar()` nem cria tokens de sessão. A rota de registo não emite `Set-Cookie`. O ecrã `CriarEmpresa` não usa o estado de sessão. Os três pontos são verificados por um teste estático novo.
- Comportamento: `api.test.ts` (registo sem cookie, `/sessao` 401, login 403 `activacao_pendente`) e o teste no navegador (passos 2 e 3: `/sessao` 401 depois do registo e depois do login recusado).

### 14.5 Migrações e totais

- 0008 aplicada localmente **sobre uma base com 0001–0007** (o caminho que o nexo-dev vai seguir) e **numa base nova** com 0001–0008. Segunda execução: "Nada a aplicar". Catálogo OK nas duas.
- `npm test` **91/91**; `test:base` **57/57**, 0 saltados; navegador **18/18**; lint, tipos e build OK.

### 14.6 Local vs Supabase

| Verificação                                      | Local (PostgreSQL 17.10)   | Supabase nexo-dev                                                            |
| ------------------------------------------------ | -------------------------- | ---------------------------------------------------------------------------- |
| 0005–0008 aplicadas, catálogo OK                 | Executado                  | **Executado pelo proprietário a 11–12/10** (secção 16)                       |
| `test:base` 57 (incluindo os 10 de concorrência) | 57/57                      | **54/57 + repetição da concorrência 10/10** (secção 16)                      |
| Teste no navegador contra a base                 | 18/18                      | Teste automático não corrido; fluxos verificados **manualmente** (secção 16) |
| Envio real de e-mail                             | Não (caixa de saída local) | **Adiado** (problemas na conta Google)                                       |

**Notas para o nexo-dev:**

- Os testes de concorrência usam `pg_locks`, que qualquer papel pode ler, e um bloqueio consultivo na ligação administrativa (Session pooler). As ligações `nexo_api` do teste passam pelo Transaction pooler; os bloqueios usados são de transacção, compatíveis com esse modo.
- A latência ao Supabase torna o teste mais lento, mas não muda o resultado esperado.

A Etapa 3 **continua não concluída**: falta a verificação no nexo-dev, o envio real de e-mail e o commit.

---

## 15. 12/10/2026: falha do `test:base` no nexo-dev e diagnóstico de ligações

**O que foi reportado (11/10):** execução do `test:base` contra o nexo-dev com 57 testes: 0 aprovados, 22 falhas, 35 cancelados. Mensagens: `sem ligação à base dentro do tempo limite` e `(ECIRCUITBREAKER) too many authentication failures, new connections are temporarily blocked`. **Esta execução não valida nem invalida a Etapa 3:** nenhum teste chegou a correr contra a base.

**Interpretação (não confirmada):**

- `ECIRCUITBREAKER` é o pooler do Supabase a bloquear novas ligações de um utilizador depois de muitas autenticações falhadas.
- A suite abre muitas ligações (pools de 4 a 12, um cliente administrativo por teste). Por isso uma credencial errada multiplica as falhas em segundos e provoca o bloqueio.
- A causa inicial, provavelmente uma palavra-passe recusada ou um URL mal formado, **ainda não está identificada**.
- Não é um defeito de RLS nem da lógica de negócio: os testes nem chegaram a ligar.
- Também não se sabe se as migrações 0005–0008 foram aplicadas no nexo-dev.

**Alterações (só ferramentas de diagnóstico e testes; a autenticação do Nexo e as migrações não mudaram):**

- `src/base/migracoes/ligacoes.ts` e `diagnosticoLigacoes.ts`: diagnóstico das ligações sem segredos (guia, secção 2.6b).
- `testes/base/verificacaoPrevia.ts`, importada pelos 4 ficheiros de `testes/base`: uma ligação de cada tipo antes da suite. Se falhar, os ficheiros falham com a causa e não se repetem tentativas na mesma execução.
- `testes/unidade/ligacoes.test.ts` (4 testes): forma dos URLs, comparação de palavras-passe sem as revelar, classificação dos erros, incluindo `ECIRCUITBREAKER`.

**Verificado localmente** (PostgreSQL 17.10; não é o Supabase):

- o diagnóstico liga com credenciais certas e lista as migrações 0001–0008;
- com a palavra-passe de `nexo_api` errada classifica `palavra_passe_recusada` (28P01). Nessa execução do `test:base` houve **uma única** tentativa falhada de `nexo_api` (mais uma administrativa bem sucedida): os 4 ficheiros falharam com a causa e os seguintes não voltaram a tentar;
- detecta `@` por codificar, falta de `.<ref>`, `sslmode` no URL e certificado em falta (só análise, sem rede);
- `npm test` 95/95; `test:base` 57/57, 0 saltados; lint e tipos OK.

**Guia danificado e reconstruído:** a 12/10, `docs/Nexo_Ambientes.md` tinha o cabeçalho e as secções 1 a 3 substituídos por uma única linha (`$senhaCodificada = [Uri]::EscapeDataString($senhaTexto)`), aparentemente uma colagem acidental depois de 11/10. Essa parte foi reconstruída a partir da versão do commit `3bf9334` mais as alterações da Etapa 3, e o resto do ficheiro foi mantido. Há uma cópia do ficheiro danificado fora do repositório (pasta temporária da sessão).

**Por executar no nexo-dev:** o diagnóstico (primeiro sem `--testar`, depois uma vez com `--testar`), o estado das migrações e só depois o `test:base`.

_(Actualização: a ligação foi resolvida e o proprietário executou as migrações e os testes a 11–12/10. Resultados na secção 16.)_

---

## 16. Resultados no Supabase nexo-dev — executados pelo proprietário (11 e 12/10/2026)

**Quem executou:** o proprietário do projecto, no Supabase nexo-dev (PostgreSQL 17.11). Os resultados das secções 8, 13, 14 e 15 marcados "local" foram executados por mim num PostgreSQL 17.10 local e **não** são estes.

### 16.1 Base e API

| Verificação                                   | Resultado no nexo-dev                                                                                                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migrações 0005–0008                           | **Aplicadas**                                                                                                                                                                 |
| Verificação do catálogo                       | **OK**                                                                                                                                                                        |
| `test:base`, 1.ª execução (57 testes)         | **54/57 aprovados; 3 falhas de ligação:** uma `ENOTFOUND` (o nome do servidor não foi resolvido) e duas falhas ao obter uma ligação do pool. Nenhuma foi uma asserção falhada |
| Repetição de `activacao_concorrencia.test.ts` | **10/10 aprovados**, sem falhas, cancelamentos nem testes saltados                                                                                                            |
| API (`/api/v1/saude/base`)                    | Disponível, `papelSeguro=true`, `versaoMigracao=0008`                                                                                                                         |

**Como ler o `test:base`:**

- Os 57 cenários foram todos aprovados, mas **em duas execuções**: 54 na primeira e os da concorrência na repetição do seu ficheiro.
- **Não houve uma execução única de 57/57** no nexo-dev.
- As 3 falhas foram de ligação, não de asserção. A causa não está confirmada; as hipóteses são rede ou DNS momentâneos e o tempo de espera do pool com a latência ao Supabase. Os testes de concorrência abrem até 12 ligações em simultâneo e seguram um bloqueio de propósito.
- Uma execução completa sem falhas de ligação continua a ser útil para referência. **Não é tratada como requisito cumprido.**

**Critério do roteiro** ("tentativas de consultar ou modificar dados de outra empresa falham na API e na base"):

- os ficheiros que o testam (`api.test.ts`, `identidade.test.ts` e `integracao.test.ts`) passaram no nexo-dev na primeira execução;
- as 3 falhas de ligação não foram nesses ficheiros.

### 16.2 Testes manuais no nexo-dev (proprietário)

O e-mail usou o transporte `ficheiro`: os links foram lidos na caixa de saída local `backend/correio-dev/`, ignorada pelo Git. Não houve envio real.

| Fluxo                                                                    | Resultado                                                             |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Login do proprietário **antes** de confirmar o e-mail                    | Recusado                                                              |
| Confirmação pelo link guardado em ficheiro local e login do proprietário | Confirmado; login aceite                                              |
| Criação de um operador e login com essa conta                            | Login aceite; **sem acesso** à gestão de funcionários nem à auditoria |
| Recuperação pelo link local                                              | Novo código aceite; o código antigo recusado                          |

O teste automático no navegador (`teste:real`, 18 passos) **não** foi corrido contra o nexo-dev; só localmente (secção 8.3).

### 16.3 Pendências

| Pendência                                           | Situação                                                                                                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Envio real de e-mail (SMTP)                         | **Adiado** por problemas na conta Google. A recuperação e a confirmação só foram verificadas com a caixa de saída local; a entrega real não está validada (7.3) |
| Etapa 2                                             | Outro programador ainda não verificou o arranque pelo guia; a Etapa 2 continua formalmente não concluída                                                        |
| Commit e push                                       | Não realizados. O último commit continua a ser o `3bf9334` (Etapa 2)                                                                                            |
| Execução única do `test:base` sem falhas de ligação | Opcional, para referência (16.1)                                                                                                                                |
| Etapa 4                                             | **Não iniciada**                                                                                                                                                |

**A Etapa 3 continua não concluída.** Os resultados no nexo-dev são favoráveis, mas faltam o envio real de e-mail e o commit no GitHub que o roteiro pede antes de avançar.
