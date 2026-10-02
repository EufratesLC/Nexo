# Teste automático do fluxo do protótipo

`fluxo-cdp.mjs` percorre o protótipo num navegador Chromium sem interface, através do Chrome DevTools Protocol, e verifica 32 passos.

**Origem:** é o script usado na verificação da Etapa 1 (27 passos), recuperado e alargado na revisão com as correcções da contagem cega, dos custos visíveis ao operador e da pausa de contagem. Não foi recriado: o original existia e foi copiado para o projecto.

## Requisitos

- Node.js **22.4 ou posterior** (usa o `WebSocket` global). Testado com 22.14.
- Microsoft Edge ou Google Chrome instalado. O script procura-os nos locais habituais do Windows, macOS e Linux. Outro caminho: `--navegador <caminho>` ou a variável `NEXO_NAVEGADOR`.
- Nenhuma dependência nova.

## Como executar

Terminal 1, arrancar o protótipo:

```powershell
cd nexo\frontend
npm run dev
```

Terminal 2, correr o teste:

```powershell
cd nexo\frontend
npm run teste:fluxo
```

Opções: `--base http://localhost:5173/` (ou `NEXO_BASE`), `--capturas <pasta>` (ou `NEXO_CAPTURAS`; por omissão, uma pasta temporária do sistema).

## Dados fictícios

O teste prepara os dados sozinho. Abre um **perfil de navegador novo** numa pasta temporária, apaga o `localStorage` do protótipo e recarrega a página. A aplicação volta aos dados fictícios iniciais (`src/demo/dadosIniciais.ts`). O perfil temporário é apagado no fim. Os dados do seu navegador habitual não são tocados.

## Resultado esperado

```text
OK     Login demonstrativo mostra o aviso e os 3 perfis
…
OK     Sem erros na consola durante o fluxo

32/32 passos OK
```

O código de saída é 0 se todos passarem e 1 se algum falhar. Guarda capturas de ecrã (login, balcão, comprovativo, venda pendente, conflito, fecho, relatórios, telemóvel) na pasta de capturas.

| Grupo | Passos |
|---|---|
| Login e permissões | Aviso de login demonstrativo; operadora sem relatórios nem compras; operadora sem "custo" nem "margem" em produtos, painel e comprovativo |
| Caixa | Abertura com validação; painel da operadora sem o esperado |
| Venda | Desconto de 5% com PIN do gestor (errado e certo), troco 474,00, comprovativo interno; confirmação simulada |
| Offline simulado | Venda pendente e confirmada ao voltar a online; conflito simulado, preservado, sem botão "Resolver" para a operadora |
| Contagem cega (proposta H-15) | O esperado não está no documento antes de registar a contagem; esperado 3 136,00 e falta de 136,00 depois; justificação obrigatória; recontagem guarda a primeira; o gestor vê as duas; com a janela de fecho aberta, o gestor também não vê o esperado por trás |
| Gestão | Relatórios provisórios com os três indicadores; conflito anulado com nota; validação de produto e código de barras duplicado; recepção que aumenta o stock uma única vez (8 → 23) |
| Pausa de contagem | Bloqueia o balcão; sem rede não retoma; retoma só pelo servidor; confirmações de pausa e de retoma na lista de operações; nenhuma acção de retoma local |
| Telemóvel | 11 ecrãs a 390 px sem deslocamento horizontal |
| Consola | Sem erros |

## Limitações

- Testa **só a interface do protótipo**, que não tem servidor: a sincronização, os estados e as permissões são simulados no navegador. Não testa a API, a base de dados nem o funcionamento offline real.
- As verificações de "sem custos para o operador" confirmam só o que o ecrã mostra. No protótipo todos os dados fictícios, incluindo custos, estão no `localStorage`.
- Corre sem interface gráfica, em Chromium, neste tipo de computador. Não substitui testes em telemóveis reais nem noutros navegadores.
- As esperas são fixas (centenas de milissegundos). Numa máquina muito lenta podem ser curtas.
- Se a porta 5173 estiver ocupada por outro servidor, o teste corre contra esse servidor.
