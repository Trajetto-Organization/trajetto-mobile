# Testes do app do motorista

Como os testes do `trajetto-mobile` estão organizados, como rodar cada suíte,
o que cada uma prova e as regras para escrever um teste novo. Este documento
absorveu o antigo `e2e.md`.

## Sumário

- [Resumo das suítes](#resumo-das-suítes)
- [Testes unitários (Vitest)](#testes-unitários-vitest)
- [Cobertura e o piso](#cobertura-e-o-piso)
- [Teste de mutação (Stryker)](#teste-de-mutação-stryker)
- [E2E no emulador (Maestro)](#e2e-no-emulador-maestro)
- [O que roda no CI](#o-que-roda-no-ci)
- [Regras para escrever testes](#regras-para-escrever-testes)
- [Problemas comuns](#problemas-comuns)

## Resumo das suítes

| Suíte | Onde | Comando | Precisa de | Roda no CI? |
| --- | --- | --- | --- | --- |
| Unitários | `tests/unitaires/*.test.ts` | `npm test` | só Node 22 | sim, em todo push e PR |
| Unitários com cobertura (com piso) | idem | `npm run test:coverage` | só Node | sim (`ci.yml`) |
| Mutação | `stryker.config.mjs` | `npm run test:mutation` | só Node (lento) | não, manual |
| Typecheck | todo o projeto | `npm run typecheck` | só Node | sim |
| E2E no emulador | `.maestro/` + `scripts/e2e/` | `bash scripts/e2e/run.sh <rodada>` | emulador Android, Maestro, Docker, `../trajetto-api` | não (estação de trabalho) |

`npm run validate` roda typecheck, testes, lint e `expo-doctor` em sequência.

## Testes unitários (Vitest)

- **Vitest 1.6.0** (a mesma versão da API), ambiente `node` puro
  (`vitest.config.ts`). Não há renderizador de React Native: o que vale testar
  é o que **decide**, e isso vive em funções puras sem import de React nem de
  módulo nativo. Um módulo que só é testável com mock nativo está com regra
  no lugar errado.
- `npm test` = `vitest run --dir tests/unitaires`. O `include` do config é
  relativo (`**/*.test.ts`) de propósito, para continuar funcionando com
  `--dir`.
- Um arquivo: `npx vitest run tests/unitaires/outbox-rules.test.ts`. Modo
  watch: `npm run test:watch`.
- Alias `@/` aponta para a raiz, como no app.

### Famílias de teste (194 arquivos)

| Família | Exemplos | O que prova |
| --- | --- | --- |
| Fila offline e rascunhos | `outbox-*.test.ts`, `submit-or-queue*.test.ts`, `queue-decision.test.ts`, `pending-*.test.ts`, `submission-*.test.ts` | o que vai para a fila, quando é reenviado, de quem é, quando é descartado; upload retomável; horário do fato |
| Regras de domínio | `delivery-rules*.test.ts`, `occurrence-*.test.ts`, `pause-rules*.test.ts`, `on-the-way-*.test.ts`, `fuel-rules.test.ts`, `checklist-rules.test.ts` | estados de entrega, ocorrência, autorização da torre, pausas, abastecimento e checklist |
| Formulários | `live-validation-*.test.ts`, `form-hooks.test.ts`, `draft-change-gate.test.ts`, `km-reading-locale.test.ts` | validação ao vivo, hooks compostos (com `tests/unitaires/support/hook-runtime.ts`), km |
| Sessão e acesso | `session-modules.test.ts`, `app-access.test.ts`, `module-rules-edges.test.ts`, `logout-*.test.ts`, `remote-logout.test.ts`, `refresh-single-flight.test.ts`, `two-factor-*.test.ts` | módulos contratados, logout com pendências, refresh único, 2FA |
| API e contrato | `api-*.test.ts`, `client-version-header.test.ts`, `upgrade-required-*.test.ts`, `app-upgrade-rules.test.ts` | classificação de erro, `Retry-After`, cabeçalho de versão, gate 426 |
| Tempo real e push | `socket-*.test.ts`, `*-realtime*.test.ts`, `push-*.test.ts`, `notification-*.test.ts` | reconexão, ressincronização, eventos, toque na notificação |
| Rastreamento | `tracking-*.test.ts`, `position-rules.test.ts`, `location-capture-bounded.test.ts` | modo de rastreio, envio, privacidade do log |
| Pré-checagem | `ai-precheck-*.test.ts` (com `tests/fixtures/ai-precheck-ocr-2026-10.json`) | regras de NF, data e km sobre textos reais do benchmark de 05/10 |
| Tema e contraste | `theme-*.test.ts`, `shared-ui-tokens.test.ts`, `driver-screens-tokens.test.ts`, `screen-tokens-fleet-chat.test.ts`, `ui-contrast.test.ts`, `app-theme.test.ts` | contraste AA dos pares nos dois temas, compilação real pelo NativeWind, telas só com tokens, plugin de `uiMode` |
| Configuração e build | `app-config-release.test.ts`, `eas-build-config.test.ts`, `android-manifest.test.ts`, `api-url-rules.test.ts`, `permissions.test.ts`, `app-dependencies.test.ts` | URL segura em release, perfis do EAS, `.easignore` = `.gitignore` menos o `google-services.json`, manifesto gerado, OTA assinada |
| Pipeline, higiene e docs | `ci-workflows.test.ts`, `secrets-hygiene.test.ts`, `supply-chain.test.ts`, `coverage-measured.test.ts`, `mutation-threshold.test.ts`, `vitest-config.test.ts`, `docs-index.test.ts` | o fluxo staging → main, CI antes de qualquer EAS, OTA de produção sempre assinada, actions por SHA, gitleaks, piso de cobertura; os quatro docs existem, links locais resolvem, nenhum caminho de doc antigo sobrou, `CLAUDE.md` = `AGENTS.md` nas regras |
| Textos | `ptbr-accents.test.ts`, `legal-links.test.ts` | pt-BR com acento em tudo que o motorista lê; links de Privacidade e Termos |
| E2E (fiação) | `maestro-suite-wiring.test.ts`, `maestro-checklist-flow.test.ts` | ordem dos fluxos em `config.yaml` e todo `testID` tocado existe no app |

### Paridade com a API

Alguns testes leem `../trajetto-api` (regras de formulário de ocorrência,
autorização, "a caminho", requisitos do comprovante, motivos de segurança) e
os testes de socket usam o `socket.io` (servidor) das dependências da API.
Sem o repositório irmão ao lado, eles se pulam (`describe.skipIf`). No CI, o
checkout da API depende do secret `API_REPO_READ_TOKEN` (ver
[variaveis-de-ambiente.md](./variaveis-de-ambiente.md#github-actions)).

## Cobertura e o piso

- Provedor v8 da **mesma** versão do Vitest (`@vitest/coverage-v8` 1.6.0).
- `all: true` e todas as pastas de código do app contam (`app`, `components`,
  `features`, `hooks`, `modules`, `providers`, `schemas`, `store`, `types`,
  `utils`), inclusive telas que nenhum unitário renderiza. Só os próprios
  testes e `*.d.ts` ficam de fora.
- **Piso** (`vitest.config.ts`, baseline de 07/10/2026, MOB-30):
  statements 52, branches 87, functions 81, lines 52. Abaixo disso a execução
  com cobertura falha. Linhas baixas com branches altos é o formato deste app:
  as decisões vivem em regras puras testadas, o grosso das linhas em telas.
  **Suba o piso quando a cobertura subir**; o teste `coverage-measured.test.ts`
  guarda os números.
- `npm run test:coverage` gera `coverage/` (ignorado pelo git e pelo EAS). No
  CI o relatório é publicado como artefato `coverage-<sha>` por 14 dias.

## Teste de mutação (Stryker)

- `npm run test:mutation` (Stryker 8.7.1 com o runner do Vitest; 8.7 é a
  última linha que aceita Vitest 1.x).
- Muta as regras críticas listadas em `stryker.config.mjs`: fila offline e
  cache (`outbox-rules`, `outbox`, `pending-item-rules`, `submission-id`,
  `submission-owner`, `logout-rules`, `queue-decision`, `submit-or-queue`,
  `kind-refusals`, `offline-cache-rules`), gate de módulos e regras de estado
  de entrega, rascunho, autorização, fila de ocorrência e pausas.
- **Corte em 90** (`thresholds.break`; a rodada de 06/10/2026 marcou 97,16).
- Rodada curta num arquivo:
  `MUTATION_TESTS=tests/unitaires/outbox-rules.test.ts npm run test:mutation -- --mutate features/submissions/outbox-rules.ts`.
- `vitest.mutation.config.ts` deixa de fora dois testes que são verdes no
  repositório e vermelhos no sandbox por motivo alheio ao código mutado
  (`secrets-hygiene` e `notification-chime-foreground`).
- Relatórios em `reports/mutation/` (ignorado). Concorrência 6 para caber em
  ~4 GB.

## E2E no emulador (Maestro)

Suíte de ponta a ponta que dirige o app de verdade no emulador local, contra
uma API e um banco descartáveis. Cobre o dia do motorista em ordem: login →
entregas → iniciar rota → chegada → comprovante (foto + assinatura) →
ocorrência com formulário → modo avião (fila) → volta da rede → abastecimento
e checklist → logout → novo login → motorista sem Frotas → troca de usuário
com pendências → chat → login com duas etapas.

### O que roda onde

| Peça | Onde | Observação |
| --- | --- | --- |
| Postgres | container `trajetto-itest-pg`, porta 54321 | o descartável dos testes da API; banco próprio `mobile_e2e` |
| Redis | container `trajetto-test-redis`, porta 63790 | database 5, separado do E2E web |
| API | `node` na porta **3335** | o E2E web usa `load_test` na 3334 ao mesmo tempo |
| Metro | porta 8081 | chega ao emulador por `adb reverse` |
| Emulador | AVD `Medium_Phone_API_36.1`, headless | câmera traseira = cena virtual |
| Maestro | `~/.maestro/bin/maestro` | instalador oficial, no perfil do usuário |

Nada sobe nas portas do ambiente de desenvolvimento (3333, 5432). O `api.sh`
recusa apontar para outro banco. Os scripts rodam no **Git Bash** (Windows) e
leem as configurações de `scripts/e2e/env.sh` (todas sobrescrevíveis por
variável: `E2E_API_ROOT`, `E2E_DB_NAME`, `E2E_PG_PORT`, `E2E_API_PORT`,
`E2E_AVD`, `E2E_DRIVER_PASSWORD`, `E2E_OUT`…).

### Pré-requisitos (uma vez)

1. **JDK 17** (`C:/Program Files/Microsoft/jdk-17*`); o `env.sh` acha sozinho.
2. **Android SDK** em `C:/Android/Sdk`, com o AVD `Medium_Phone_API_36.1` e
   aceleração WHPX (`emulator -accel-check`).
3. **Maestro CLI**: `curl -fsSL "https://get.maestro.mobile.dev" | bash`.
4. Os containers descartáveis da API (`trajetto-itest-pg`,
   `trajetto-test-redis`) de pé e o `trajetto-api` ao lado deste repositório.
5. **Build de desenvolvimento** instalado no emulador (com ele já de pé):

   ```bash
   bash scripts/e2e/build-apk.sh install
   ```

   O script roda `expo prebuild`, devolve o `package.json` como estava,
   compila só o ABI x86_64 com heap limitado, guarda o APK em
   `$TMPDIR/trajetto-mobile-e2e/app-debug.apk` e **apaga o `android/`**. Só é
   preciso de novo quando o lado nativo muda (dependência nativa,
   `app.config.js`, plugin); mudança de JS chega pelo Metro. O Gradle precisa
   de uns 5 GB livres.

   Por que debug + Metro e não release: o bundle de release recusa de
   propósito uma API local em HTTP (`utils/api-url-rules.ts`). A URL da API é
   embutida pelo Metro (`scripts/e2e/metro.sh`).

### Rodando

Em quatro terminais, na raiz do `trajetto-mobile`:

```bash
bash scripts/e2e/emulator.sh start      # 1: emulador headless (primeiro plano)
bash scripts/e2e/emulator.sh wait       # 2: espera o boot, desliga animações, adb reverse, GPS na Paulista
bash scripts/e2e/api.sh reset           # 2: recria e semeia o banco mobile_e2e
bash scripts/e2e/api.sh start           # 3: API na 3335 (primeiro plano)
bash scripts/e2e/metro.sh               # 4: Metro com EXPO_PUBLIC_API_URL=http://10.0.2.2:3335
bash scripts/e2e/run.sh minha-rodada    # 2: aquece o bundle e roda a suíte
bash scripts/e2e/check-db.sh            # 2: confere no banco o que a suíte gravou
```

- O `reset` vem antes de **toda** rodada: os fluxos iniciam a rota e entregam
  as paradas, então uma segunda rodada no mesmo banco não teria o que fazer.
- O `run.sh` roda um fluxo por vez, na ordem do `flowsOrder` de
  `.maestro/config.yaml`, e para no primeiro que falhar. Para retomar:
  `E2E_FROM=04-frota-abastecimento bash scripts/e2e/run.sh r2`. No fim ele
  sempre desliga o modo avião.
- O `check-db.sh` prova o lado do servidor: os 2 comprovantes com foto,
  assinatura e recebedor, a ocorrência, o abastecimento (50120 km, 40 L, foto
  do hodômetro), o checklist (50200 km, 3 fotos), a chegada da troca de
  usuário registrada **pelo motorista dono** e a mensagem de chat. Sai com 1
  na primeira expectativa que falhar.
- Validar a sintaxe sem dispositivo:
  `for f in .maestro/*.yaml .maestro/subflows/*.yaml; do [ "$(basename "$f")" = config.yaml ] || ~/.maestro/bin/maestro check-syntax "$f"; done`.

### Massa de dados

`trajetto-api/tests/load/seed.ts` com `LOAD_MOBILE_E2E=1` cria:

- **E2E Frota** (Frotas + Entregas): `motorista.e2e@trajetto.test`, veículo
  `E2E1A23`, rota 101 liberada com 3 paradas e o tipo de ocorrência "Avaria
  na carga" com formulário (texto obrigatório + Sim/Não).
- **E2E Sem Frota** (só Entregas): `motorista.semfrota@trajetto.test`, rota
  101 com 1 parada.
- **E2E Dois Fatores** (só Entregas): `motorista.2fa@trajetto.test` com 2FA
  ligado, rota 101 com 1 parada.

A senha das três contas é a de teste documentada em `scripts/e2e/env.sh`
(banco descartável; sobrescreva com `E2E_DRIVER_PASSWORD`). Os ids ficam em
`trajetto-api/tests/load/fixtures/mobile-e2e.json` (ignorado pelo git).

### Fluxos (`.maestro/`)

| Arquivo | O que prova |
| --- | --- |
| `00-login` | instalação limpa, login pelo formulário, abas de quem tem Frotas |
| `01-rota-chegada-comprovante` | iniciar a rota, chegada, comprovante com foto da câmera, assinatura e recebedor; a entrega sai da lista |
| `02-ocorrencia-com-formulario` | sem o campo obrigatório o envio é recusado no aparelho; preenchido, a ocorrência é registrada com as respostas |
| `03-offline-fila-sincronizacao` | modo avião; chegada e comprovante na fila ("2 envios pendentes"); com a rede de volta a fila esvazia sozinha |
| `04-frota-abastecimento` | abastecimento com foto do hodômetro e GPS do emulador |
| `04b-frota-checklist` | checklist com todos os itens OK: só as 3 fotos que todo checklist exige |
| `05-logout-e-novo-login` | logout pelo menu e novo login; as paradas resolvidas não voltam |
| `06-modulo-frota-desligado` | motorista sem Frotas: abre nas entregas; "Início" só tem a conta |
| `07-troca-de-usuario-com-pendencias` | aparelho compartilhado: a chegada pendente de um motorista nunca é enviada pelo outro; volta e sai sozinha com o dono |
| `08-chat-mensagem-de-texto` | mensagem de texto: aparece na conversa e o relógio vira o visto |
| `09-dois-fatores-login` | conta com duas etapas: a senha leva à tela do código |
| `09b-dois-fatores-codigo` | código errado é recusado; o certo abre as entregas |

`subflows/` guarda o que se repete: `launch`, `login`, `logout`,
`take-photo`, `signature`, `checklist-answer`, `checklist-photo`, `gps` e
`system-dialogs`.

**Seletores** são `testID` (viram `resource-id` no Android). `ConfirmModal`
gera `<testID>-confirm` / `<testID>-cancel`, `Select` gera `<testID>-option`,
os campos de ocorrência usam `occurrence-field-<chave>` (e `-yes` / `-no`), e
o checklist usa `checklist-<campo>`, `checklist-photo-<campo>` e
`checklist-submit`. Renomeou um `testID`? O `maestro-suite-wiring.test.ts`
falha no unitário antes de alguém subir o emulador.

**Código das duas etapas:** a API guarda só um HMAC do código e o e-mail vai
para uma caixa Ethereal que a suíte não lê. Antes do `09b`, o `run.sh` chama
`api.sh two-factor-code <e-mail>`, que troca o código pendente pelo hash
bcrypt de um código conhecido e o passa ao fluxo (`TWO_FACTOR_CODE`,
`TWO_FACTOR_WRONG_CODE`). O `09b` só roda logo depois do `09`. O envio do
e-mail precisa de internet.

### Resultados

Cada rodada grava em `$TMPDIR/trajetto-mobile-e2e/<rodada>/`: `junit.xml`,
`maestro.txt` e, por fluxo, `screenshots/`, `screen-hierarchy/` e `logs/`
(maestro.log e logcat). Nada disso vai para o repositório.

### Armadilhas conhecidas

- **Bundle frio:** o primeiro bundle leva minutos; o `run.sh` aquece antes, e
  o `launch` reabre a frio quando aparece "There was a problem loading the
  project.". Não use o "Reload" da tela de erro (travou o app).
- **Deep link com o app parado** foi ignorado; o `launch` para o app antes.
- **Permissões:** o `clearState` também as zera; o `launchApp` com
  `permissions: all: allow` concede antes do deep link.
- **Modo avião** corta o 10.0.2.2 (a API), não o túnel do `adb reverse` (o
  Metro).
- **GPS do emulador** só informa posição quando alguém manda; o app recusa
  posição com mais de 5 min na chegada e 1 min no abastecimento. O
  `subflows/gps.yaml` roda antes de cada passo que pede localização.
- **Recorte da foto:** telas de foto quadrada abrem o recortador; o
  `take-photo` toca em "CROP".
- **Elemento na borda de baixo:** os subfluxos do checklist rolam com
  `centerElement: true` para o toque não cair no rodapé fixo.
- **Toast de sucesso** dura segundos; o `04b` confere o que fica (a km do
  checklist na tela do veículo, dado do servidor).
- **Teclado:** com edge-to-edge quem afasta o teclado é o
  `KeyboardAvoidingView` com `behavior="padding"` (achado pelo fluxo 08).
- **Host carregado:** emulador é pesado; os tempos de espera já são
  generosos (até 5 min no carregamento).

### Desmontando

```bash
bash scripts/e2e/api.sh stop
bash scripts/e2e/emulator.sh stop
# Ctrl+C no Metro
docker exec trajetto-itest-pg psql -U trajetto -d postgres -c 'DROP DATABASE IF EXISTS "mobile_e2e" WITH (FORCE)'
rm -rf android   # se sobrou de um build manual; deixado no disco, quebra o android-manifest.test.ts
```

## O que roda no CI

`.github/workflows/ci.yml` (detalhes em [deploy.md](./deploy.md#pipeline)):

- **Em todo push de branch de trabalho, em todo PR para `staging` ou `main` e
  antes de qualquer publicação** (chamado pelo `deploy.yml`): `npm ci`,
  `audit-ci` (advisory CRITICAL em dependência de produção falha), lint,
  typecheck, unitários com cobertura e piso, publicação do relatório,
  `expo-doctor` e gitleaks no histórico inteiro.
- O E2E Maestro **não** roda no CI: ele precisa de emulador com aceleração,
  API e banco locais. Rode-o antes de um release que mexa no laço do
  motorista e registre a rodada no PR.
- A mutação também é manual (lenta); rode quando mexer nas regras listadas.

## Regras para escrever testes

1. **Títulos em inglês**, descrevendo o comportamento (`it("keeps the item
   when the API refuses it for a business rule")`). Comentários do teste
   também em inglês; textos de tela citados ficam em pt-BR.
2. **Vermelho antes de verde.** Ao corrigir um defeito, escreva o teste que
   falha com o código antigo, veja-o falhar, e só então corrija.
3. **Caminhos reais.** Teste a função que o app usa, importada pelo caminho
   real (`@/features/...`), não uma cópia. Quando o teste precisa ler um
   arquivo de configuração (workflow, `eas.json`, `app.config.js`), leia o
   arquivo de verdade.
4. **Regra nova vai para função pura** em `features/**` e ganha teste em
   `tests/unitaires/<assunto>.test.ts`. Se só desse para testar com mock
   nativo, mova a decisão para fora do componente.
5. **Hooks compostos** usam `tests/unitaires/support/hook-runtime.ts` com
   `vi.mock("react", () => reactShim)`; não adicione renderizador de React.
6. **Teste que guarda configuração** (workflow, manifesto, perfis do EAS)
   prova o fato, não o texto: se mudar a forma e o fato continuar, ajuste o
   teste para guardar o mesmo fato.
7. **Nada de rede real** em unitário (exceto o servidor socket.io local dos
   testes de socket). Nada de segredo em fixture: o gitleaks só silencia a
   regra genérica em `tests/`.
8. **Mudou o contrato com a API?** Suba `CLIENT_CONTRACT`, ajuste o teste do
   cabeçalho e confira os testes de paridade com `../trajetto-api` presente.
9. **Mudou um `testID` usado pelo Maestro?** Ajuste o fluxo junto; o teste de
   fiação acusa.
10. **Subiu a cobertura?** Suba o piso em `vitest.config.ts` e em
    `coverage-measured.test.ts`.

## Problemas comuns

| Sintoma | Causa | O que fazer |
| --- | --- | --- |
| `android-manifest.test.ts` falha depois do E2E | pasta `android/` do prebuild ficou no disco | apague `android/` |
| Testes de paridade "skipped" | `../trajetto-api` ausente | clone a API ao lado, ou aceite o pulo localmente |
| Cobertura falha com todos os testes verdes | número abaixo do piso | escreva os testes que faltam; não baixe o piso |
| `secrets-hygiene.test.ts` falha fora de um repositório git | ele usa `git check-ignore` | rode dentro do clone |
| Stryker reclama de versão do Vitest | Stryker 9 exige Vitest 2 | mantenha 8.7.1 enquanto o Vitest for 1.6 |
