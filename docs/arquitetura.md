# Arquitetura do app do motorista

Este documento explica como o `trajetto-mobile` é montado e por quê. Ele
reúne o que antes estava espalhado em `tema.md`, `pre-checagem-offline.md` e
nas decisões da fase final que valem para o app. Testes estão em
[testes.md](./testes.md), build e publicação em [deploy.md](./deploy.md) e
variáveis em [variaveis-de-ambiente.md](./variaveis-de-ambiente.md).

## Sumário

- [Visão geral](#visão-geral)
- [Stack](#stack)
- [Estrutura de pastas](#estrutura-de-pastas)
- [Princípios que guiam o código](#princípios-que-guiam-o-código)
- [Sessão, empresa e módulos](#sessão-empresa-e-módulos)
- [Comunicação com a API](#comunicação-com-a-api)
- [Offline: cache de leitura e fila de envios](#offline-cache-de-leitura-e-fila-de-envios)
- [Formulários: hooks compostos e regras puras](#formulários-hooks-compostos-e-regras-puras)
- [Fotos e uploads](#fotos-e-uploads)
- [Tempo real e push](#tempo-real-e-push)
- [Rastreamento de posição](#rastreamento-de-posição)
- [Versão do contrato e atualização obrigatória](#versão-do-contrato-e-atualização-obrigatória)
- [Pré-checagem das fotos no aparelho](#pré-checagem-das-fotos-no-aparelho)
- [Tema claro e escuro](#tema-claro-e-escuro)
- [Manifesto Android e permissões](#manifesto-android-e-permissões)
- [Telemetria e logs](#telemetria-e-logs)
- [Decisões registradas](#decisões-registradas)

## Visão geral

O Trajetto é uma plataforma B2B multiempresa para transportadoras, com dois
módulos contratados separadamente por empresa: **Frotas** e **Entregas**. São
três repositórios:

| Repositório | Papel |
| --- | --- |
| `trajetto-api` | API Fastify + Prisma + PostgreSQL + Redis, tempo real (socket.io), filas no Postgres, crons e o serviço local de IA (`infra/ai-ocr`) |
| `trajetto-ui` | site público, portal de documentação e painel web (Next.js) |
| `trajetto-mobile` (este) | app de campo do motorista, **só Android** |

O app é o cliente de campo: rota do dia, chegada, "a caminho", comprovante com
foto e assinatura, ocorrências (com formulário e autorização da torre),
pausas, chat por ticket com a central e, quando a empresa tem Frotas,
abastecimento e checklist do veículo. Ele precisa funcionar **sem sinal**
durante o laço do motorista.

```
 motorista (Android)
   │  HTTPS (REST + JSON)          socket.io (tempo real)
   ▼                               ▼
 trajetto-api ──── Postgres / Redis / storage R2 (fotos por URL pré-assinada)
   │
   └── Expo Push API ──► FCM ──► aparelho (notificações)
```

## Stack

- **Expo SDK 54** com **dev client** (não roda no Expo Go: há módulo nativo
  próprio), React Native 0.81 com a nova arquitetura, Hermes, React 19.1 e
  React Compiler (`experiments.reactCompiler` no `app.json`).
- **expo-router 6** (rotas por arquivo em `app/`, `typedRoutes`).
- **NativeWind 4** (Tailwind 3) para estilo, com tokens de tema.
- **@tanstack/react-query 5** com persistência em AsyncStorage (cache offline).
- **zustand 5** para sessão, conexão, fila de envios, tema e atualização
  obrigatória (`store/`).
- **react-hook-form + zod 3** nos formulários (esquemas espelhados da API em
  `schemas/`).
- **socket.io-client** para tempo real, **expo-notifications** para push.
- **expo-location** e **expo-task-manager** para posição; **expo-image-picker**
  e **expo-image-manipulator** para fotos; **expo-audio** para os áudios do
  chat; **react-native-signature-canvas** para a assinatura.
- **expo-updates** com runtime por *fingerprint* e OTA assinada.
- **expo-secure-store** para tokens; AsyncStorage para o resto.
- Módulo nativo próprio **`modules/text-reader`** (Kotlin, ML Kit Text
  Recognition v2 embutido) para a pré-checagem.

## Estrutura de pastas

```
app/                         rotas (expo-router)
  _layout.tsx                provedores, splash, tema, guardas globais
  index.tsx                  decide para onde a sessão vai ao abrir
  (auth)/                    login, two-factor, forgot-password
  (protected)/
    _layout.tsx              exige sessão; sincroniza fila, socket, rastreio
    (tabs)/                  vehicles (Início), deliveries, chat
    delivery-detail, delivery-proof, delivery-occurrence,
    fuel, checklist, notifications, pending-submissions, select-business
features/<assunto>/          regras puras (*-rules.ts) e hooks do assunto
  access/                    módulos contratados e superfícies do app
  ai-precheck/               pré-checagem das fotos no aparelho
  app-update/                regras da atualização obrigatória (426)
  submissions/               fila de envios (outbox), rascunhos, wizard
  offline/                   allowlist e regras do cache persistido
  deliveries, occurrences, pauses, chat, fuel, checklist, tracking,
  notifications, forms, media, catalog, legal, device, diagnostics …
components/                  telas e peças compartilhadas
  ui/                        botão, campo, select, modais, bottom sheet …
  screens/<tela>/            componentes de cada tela
hooks/                       hooks transversais (rede, sincronização, tema)
providers/                   auth, react-query, socket, tema, toast
store/                       zustand: auth, conexão, outbox, 2FA, tema, upgrade
schemas/                     esquemas zod (espelho dos contratos da API)
utils/                       cliente HTTP, URL da API, versão do contrato,
                             storage, telemetria, tokens de tema
modules/text-reader/         módulo nativo da pré-checagem (Kotlin)
plugins/                     config plugins do Expo (ABIs, uiMode)
tests/unitaires/             testes Vitest (regras puras, contratos, configs)
tests/fixtures/              textos OCR e casos de formulário
.maestro/                    fluxos E2E (Maestro)
scripts/e2e/                 scripts do E2E no emulador
app.json / app.config.js     configuração do Expo (estática / dinâmica)
eas.json                     perfis de build do EAS
```

O alias `@/` aponta para a raiz do repositório (`tsconfig.json` e
`vitest.config.ts`).

## Princípios que guiam o código

1. **Regra de negócio em função pura.** O que decide (o que vai para a fila,
   o que o motorista vê, se uma entrega pode ser comprovada) vive em
   `features/**/*-rules.ts` e arquivos irmãos **sem import de React nem de
   módulo nativo**, testados com Vitest em Node puro. Módulo que precisa de
   mock nativo para ser testado é módulo com regra no lugar errado.
2. **Telas finas.** As telas compõem hooks; os hooks chamam as regras. Não há
   contexto global de formulário (ver [Formulários](#formulários-hooks-compostos-e-regras-puras)).
3. **A API é o juiz.** O app só decide o que **oferece** (um módulo não
   contratado não aparece, um campo obrigatório é avisado antes do envio), e
   a API continua validando tudo.
4. **Nada do motorista se perde.** Rascunho salvo, fila durável, upload
   retomável, chave de idempotência por envio.
5. **Comentários em inglês, textos de tela em pt-BR com acento** (um teste
   varre as strings: `tests/unitaires/ptbr-accents.test.ts`).

## Sessão, empresa e módulos

- Login com e-mail e senha, verificação em duas etapas quando a conta exige
  (`app/(auth)/two-factor.tsx`), recuperação de senha.
- Tokens no **SecureStore** (`utils/storage.ts`); o resto (cache, fila,
  preferências) no AsyncStorage. O refresh é *single-flight*: várias
  requisições com token vencido disparam um único refresh.
- Usuário com mais de uma empresa escolhe em `select-business`.
- **Módulos** (`features/access/module-rules.ts`): `FLEET` e `DELIVERIES`. A
  mesma regra decide abas, cartão do veículo, telas de abastecimento e
  checklist, a tela de entrada pós-login e a fila. Motorista de empresa sem
  Frotas não vê veículo, abastecimento nem checklist. A API continua
  barrando com `403 MODULE_NOT_ENABLED`.
- Logout com envios pendentes avisa ("Sair com pendências?"); os itens da
  fila pertencem ao dono (`submission-owner.ts`) e nunca são enviados em nome
  de outro usuário no mesmo aparelho.
- Encerramento remoto da sessão (revogação na API) desloga e limpa os stores
  do motorista.

## Comunicação com a API

- Cliente HTTP em `utils/api.ts`. Base: `EXPO_PUBLIC_API_URL` (embutida no
  bundle em tempo de build).
- Todo pedido leva `x-trajetto-client-version` (ver
  [Versão do contrato](#versão-do-contrato-e-atualização-obrigatória)).
- Erros classificados em `utils/api-error.ts`: transitório (rede, 5xx, 429
  com `Retry-After`), permanente (regra de negócio), autenticação, contrato
  (426) e "API inacessível". A classificação decide se um envio vai para a
  fila.
- **URL segura em release** (`utils/api-url-rules.ts`): um bundle de release
  recusa `EXPO_PUBLIC_API_URL` sem HTTPS, com credenciais, query ou
  fragmento, ou apontando para rede local/privada. A falha vira "API
  inacessível": ninguém é deslogado e a fila continua guardada. O
  `app.config.js` repete a mesma regra no build e no `eas update` (um teste
  mantém as duas cópias iguais).

## Offline: cache de leitura e fila de envios

O laço do motorista (rota, chegada, comprovante, ocorrência, pausa,
abastecimento, checklist) funciona offline de verdade. Telas de consulta
mostram o que estiver em cache. Isso é deliberado: gestores são personas de
escritório; o motorista é a persona offline.

### Cache de leitura

- `providers/query-provider.tsx` persiste o react-query no AsyncStorage com
  `maxAge` de **7 dias**; o `gcTime` acompanha o `maxAge` (uma query coletada
  da memória não é desidratada, e um `gcTime` menor encolheria o cache).
- Só entra no cache a allowlist de `features/offline/offline-cache-rules.ts`
  (`OFFLINE_QUERY_KEYS`): `my-deliveries`, `vehicles`, `vehicle`,
  `branches`, `fuelTypes`, `drivers`, `businesses`, `business-entitlements`.
- Sem rede, o app abre com o último dia baixado.

### Fila de envios (outbox)

- Código em `features/submissions/` (`outbox.ts`, `outbox-rules.ts`,
  `submit-or-queue.ts`, `queue-decision.ts`, `kind-refusals.ts`,
  `pending-item-rules.ts`, `outbox-schema.ts`).
- Fila persistida no AsyncStorage; as fotos são **copiadas** para
  `Paths.document/trajetto-outbox/<itemId>/` (o rascunho apaga o próprio
  diretório ao ser limpo, e as duas vidas não podem depender uma da outra).
- Cada item tem um `client_submission_id`: reenviar nunca duplica no servidor.
- **Só vai para a fila o que falhou de forma transitória.** Sucesso segue o
  caminho normal; erro permanente (4xx de regra) fica na tela com o rascunho
  intacto para o motorista corrigir.
- **Upload retomável**: cada foto guarda a chave enviada assim que sobe; 20
  fotos numa conexão que cai não recomeçam do zero.
- Retentativa transitória infinita com backoff; erro permanente vira `failed`
  e espera o motorista em **Envios pendentes**, sem perder foto, assinatura,
  horário e local. Erro de autenticação pausa a fila sem contar tentativa.
- Recusa de contrato (426) marca o item como falha de contrato: ele fica
  visível e é reenviado sozinho depois que o app for atualizado.
- Gatilhos de envio (`hooks/use-outbox-sync.ts`): reconexão, volta ao
  primeiro plano, abertura do app e uma varredura a cada 30 s que só roda com
  item pendente.
- **Invariante:** "API parece inacessível" nunca bloqueia a fila; só o rádio
  desligado (`isDeviceOffline`) pausa. A fila é a própria sonda da API (um
  bug real de 15/08/2026 travava o envio automático por isso).
- O horário do fato (chegada, comprovante) é o do toque, enviado com o item,
  não o da sincronização.
- `OUTBOX_SCHEMA_VERSION` (em `utils/client-version.ts`) versiona o formato
  dos itens; mudou um campo, sobe o número e acrescenta um passo em
  `upcastOutboxItem`.

### Rascunhos

Formulários longos salvam o que foi digitado (`draft-store.ts`,
`use-draft-autosave.ts`). O `draft-store` nunca olha dentro do rascunho:
renomear um campo persistido faria o motorista perder o trabalho numa
atualização do app.

## Formulários: hooks compostos e regras puras

- Cada tela compõe hooks focados em vez de um hook gigante ou de um contexto.
  Exemplos compartilhados: `submit-or-queue`, `draft-store`,
  `use-draft-autosave`, `use-wizard-steps`, `use-discard-confirmation`,
  `use-image-capture`.
- **Contexto foi descartado de propósito**: ele re-renderiza todo consumidor
  a cada tecla, o que é lentidão real em Android de entrada.
- Domínio puro e testado: `checklist-rules.ts`, `fuel-rules.ts`,
  `delivery-rules.ts`, `occurrence-form-rules`, `pause-rules.ts` etc.
- **Validação ao vivo** (`features/forms/live-validation.ts`, decisão
  16.700, o mesmo padrão do web): o campo é conferido ao sair dele pela
  primeira vez e a cada mudança depois disso; a mensagem some na tecla que
  corrige; o envio confere tudo, para no primeiro inválido e o traz para a
  tela. Uma escolha (select, data, Sim/Não, foto) conta como sair do campo.
  `use-live-fields.ts` e `use-field-focus.ts` só ligam a regra à tela. O
  botão de criar continua habilitado; na edição, fica desabilitado enquanto
  nada mudou.
- Regras como "km menor que a última do veículo" aparecem na hora
  (`mileage-resolver.ts`, decisão 16.703).
- O rascunho só começa a ser salvo depois de uma edição do motorista; o que a
  tela preenche sozinha (motorista, combustível, filial, GPS) não cria
  rascunho (`draft-change-gate.ts`).

## Fotos e uploads

- Todas as fotos sobem por **URL pré-assinada** (PUT direto no storage); a
  API recebe só as chaves.
- `prepareUploadImage` vive dentro de `use-image-capture`: re-encodar é a
  única coisa que remove EXIF/GPS da foto, já que a API não toca nos bytes.
  Nunca transforme isso em atalho condicional.
- A foto do canhoto e do odômetro é só pela câmera; a galeria abre o seletor
  do sistema, que não exige permissão de armazenamento.

## Tempo real e push

- `providers/socket-provider.tsx` conecta o socket.io à mesma URL da API, com
  autenticação pelo token e reconexão com backoff. Na reconexão, as telas
  ressincronizam (rota, chat, catálogos, decisões de ocorrência).
- Eventos usados: mudança de rota/plano, decisão da torre sobre ocorrência,
  mensagens e leitura do chat, mudanças de catálogo e de acesso (módulos,
  sessão encerrada), retorno da IA sobre comprovantes.
- **Push**: o app registra o token Expo na API (`utils/push-token.ts`, com
  retentativa). A API envia pela Expo Push API, que repassa ao FCM com a
  credencial FCM do projeto EAS; a API não guarda segredo do Firebase. O
  `google-services.json` entra no build (ver [deploy.md](./deploy.md)).
- O toque na notificação abre a tela certa (`features/notifications`,
  `features/deep-links`); o esquema de deep link é `trajetto://`.

## Rastreamento de posição

- `features/tracking/`: `mode-rules.ts` decide entre `background`,
  `foreground` e `off` a partir de rota em andamento, permissões concedidas e
  se **este build** declara localização em segundo plano.
- Com o app aberto, a posição é enviada durante a rota em andamento e a torre
  mostra o veículo.
- **Segundo plano está pronto, testado e desligado** (decisão 7.3). A chave
  é `EXPO_PUBLIC_BACKGROUND_TRACKING`: com `true`, o `app.config.js` declara
  `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE` e
  `FOREGROUND_SERVICE_LOCATION` no manifesto e liga o serviço do
  `expo-location`. Só ligue depois da declaração aprovada no Play Console
  ([deploy.md](./deploy.md#localização-em-segundo-plano)). O web mostra o
  aviso equivalente pela variável `BACKGROUND_TRACKING` do `trajetto-ui`.
- Posições com mais de 5 minutos não valem para a chegada e com mais de
  1 minuto não valem para o abastecimento.

## Versão do contrato e atualização obrigatória

- `CLIENT_CONTRACT` (`utils/client-version.ts`, hoje **3**) é o contrato de
  API que este JavaScript fala. **Suba o número em todo release que mude o
  que o app envia** (rota, campo, formato de upload). Como vive no JS, uma OTA
  também o sobe.
- Todo pedido leva
  `x-trajetto-client-version: platform=android; version=…; build=…; runtime=<fingerprint>; update=<id da OTA|embedded>; contract=3; outbox=1`.
  A API registra esse valor em toda linha de log de requisição.
- Na API, `MIN_MOBILE_CONTRACT` (vazio = desligado) faz contratos abaixo dele
  receberem `426 CLIENT_UPGRADE_REQUIRED` (exceto login, 2FA, refresh e
  logout). `MOBILE_STORE_URL` (opcional, HTTPS) troca o link da loja.
- No app, o primeiro 426 abre a tela bloqueante
  (`components/upgrade-required-screen.tsx`, regras em
  `features/app-update/upgrade-rules.ts`): tenta uma OTA do mesmo runtime
  (`checkForUpdateAsync` → `fetchUpdateAsync` → `reloadAsync`) e, sem ela,
  abre a loja. A tentativa automática espera o app em primeiro plano. Um 426
  no `/user/me` da abertura não desloga.
- O runtime é calculado por **fingerprint** (`runtimeVersion.policy` no
  `app.json`): uma OTA só chega a binários com o mesmo código nativo.
- Procedimento de subir o mínimo: [deploy.md](./deploy.md#versão-do-contrato-e-gate-com-a-api).

## Pré-checagem das fotos no aparelho

(decisão 14.2; ADR 0010 §4 na API)

O app lê, no próprio celular e sem rede, o texto da foto do canhoto e do
odômetro e compara com o que já sabe: o número da NF da entrega, o dia da
comprovação e a km digitada. O resultado é uma **sugestão provisória**: viaja
com o envio, é confirmada pela leitura do servidor (serviço de IA da API) e
**nunca bloqueia** o motorista.

### Quando roda

- Só quando o `/user/me` traz `ai.precheck = true` (empresa com leitura
  automática contratada, servidor lendo e saldo no mês).
- O app guarda quando recebeu o sinal (`aiCheckedAt`) e confia nele por **7
  dias**, a janela do cache offline. Passou disso, fica desligada.
- Só num binário que tenha o módulo nativo; num build antigo ela não roda.

### O que o motorista vê

| Fluxo | Quando | Aviso | Ações |
| --- | --- | --- | --- |
| Comprovar entrega | logo depois da foto do canhoto | "O número da NF 123.456 não aparece na foto…" ou "A data de recebimento na foto não é a de hoje…" | "Tirar outra" / "Enviar assim" |
| Abastecimento | foto do odômetro + km digitada (espera 0,8 s sem mudança) | "A km 45.210 não aparece na foto do odômetro…" | "Corrigir km" / "Tirar outra" / "Enviar assim" |
| Checklist | foto do campo de km + km digitada | idem | idem |

Sem aviso, nada aparece. O envio nunca espera a pré-checagem (tempo-limite de
5 s). Enviar com aviso na tela grava `driver_overrode: true`.

### O que vai para a API

Só booleanos; **o texto lido nunca sai do celular**:

```json
"device_precheck": {
  "engine": "mlkit-text-v2-latin", "engine_version": "16.0.1", "rules_version": 1,
  "ran_at": "2026-10-05T13:20:00.000Z", "duration_ms": 412, "kind": "proof",
  "invoice_number_found": false, "date_out_of_window": null, "typed_mileage_found": null,
  "outcome": "warned", "driver_overrode": true
}
```

Vai no corpo da ocorrência de entrega, do abastecimento e do checklist; a API
grava uma vez, na mesma transação, e descarta se a empresa não contratou a
leitura. Não consome cota. Fica no rascunho com a foto; trocar a foto ou
redigitar a km descarta o resultado anterior.

### Regras

- **NF:** comparada sem pontos, espaços e zeros à esquerda; vale também o nNF
  dentro da chave de acesso de 44 dígitos. Entrega sem NF → `null`.
- **Data:** só a data de **recebimento** conta (perto do rótulo "DATA DE
  RECEBIMENTO", ou a única data num canhoto solto), no fuso da empresa
  (`journey.time_zone`). Sem data legível → `null`.
- **Km:** confere se algum número (fora da linha do TRIP) é a km digitada, ou
  ela seguida de um dígito de décimos. Número menor é dúvida (`null`).
- Dúvida é sempre `null`, e `null` nunca gera aviso.

### Onde está

| Peça | Arquivo |
| --- | --- |
| Módulo nativo (Kotlin, ML Kit v2 Latin embutido) | `modules/text-reader/` |
| Filtro de ABIs dos APKs | `plugins/with-preview-abis.js` |
| Sinal da sessão (`canPrecheck`, `stampAiFlag`) | `features/ai-precheck/precheck-gate.ts` |
| Regras do canhoto / do odômetro | `features/ai-precheck/proof-precheck-rules.ts`, `odometer-precheck-rules.ts` |
| Payload, avisos, tempo-limite | `features/ai-precheck/device-precheck.ts` |
| Orquestração com leitor injetável | `features/ai-precheck/evaluate-precheck.ts` |
| Hook das telas | `features/ai-precheck/use-photo-precheck.ts` |
| Esquema (espelho da API) | `schemas/device-precheck.ts` |

### Tamanho do binário

Medido nos artefatos do Maven (05/10/2026): `libmlkit_google_ocr_pipeline.so`
11,06 MB em arm64 (4,40 MB comprimido) e 6,78 MB em armeabi-v7a; modelos
1,49 MB; `classes.jar` ~1,8 MB antes do R8. Estimativa: **~6 MB a mais no
download arm64** do AAB (orçamento era 5 MB) e ~13 MB instalado. A
alternativa, se a medição no aparelho passar do orçamento, é a variante não
embutida (`play-services-mlkit-text-recognition`), que deixa de funcionar
offline até o Play Services baixar o modelo; a decisão é do dono.

Como medir: num worktree sem o módulo e neste código, `npx expo prebuild -p
android --clean` e `cd android && ./gradlew bundleRelease`; depois
`bundletool build-apks` e `bundletool get-size total --dimensions=ABI`; a
diferença da linha `arm64-v8a` é o custo. Num aparelho de 2 GB, meça PSS com
`adb shell dumpsys meminfo com.trajetto.fleetmanager` (meta < 90 MB a mais) e
a latência no log `ai precheck … durationMs` (meta ≤ 1,5 s).

Pendências do dono: essa medição; revisar o formulário de segurança de dados
do Play com a divulgação do ML Kit; o fluxo Maestro `proof-precheck.yaml`
(decisão 13.4) ainda não existe.

## Tema claro e escuro

O motorista escolhe em **Configurações → Tema: Claro · Escuro · Sistema**
(padrão Sistema). A escolha fica no aparelho (AsyncStorage, chave
`theme-preference`) e **não** é apagada no logout. A Política de Privacidade
e a de Cookies do web citam essa preferência (09/10/2026).

### Peças

| Peça | Onde | O que faz |
| --- | --- | --- |
| Paleta | `utils/theme-tokens.js` | Fonte única das cores, clara e escura (CommonJS: o `tailwind.config.js` também lê) |
| Variáveis CSS | `tailwind.config.js` (plugin) | Gera `:root { --color-* }` e `.dark:root { --color-* }` |
| Classes | `tailwind.config.js` (`colors`) | `bg-card`, `text-ink`… apontam para `rgb(var(--color-*) / <alpha-value>)` |
| Escolha | `store/theme-store.ts` | Zustand persistido; chama `colorScheme.set()` do NativeWind |
| Cromo | `providers/theme-provider.tsx` | Tema do React Navigation, fundo da raiz (expo-system-ui), barra de status |
| Valores em JS | `hooks/use-theme.ts` | `useThemeColors()` para props que não aceitam classe |
| Seletor | `components/ui/theme-selector.tsx` | Controle segmentado na gaveta de configurações |

A troca é instantânea e não remonta nada: navegação, formulários e rascunhos
ficam onde estavam. O `colorScheme.set` muda o modo noturno nativo, então
seletor de data e alertas acompanham. O splash nativo só some depois de ler a
escolha salva; o splash é azul da marca nos dois temas.

A `MainActivity` declara `uiMode` em `android:configChanges` (garantido por
`plugins/with-ui-mode-config-change.js`), então trocar de tema não recria a
Activity. **Nunca remova esse plugin do `app.json`.**

### Tokens

| Token | Classe | Uso | Claro | Escuro |
| --- | --- | --- | --- | --- |
| background | `bg-background` | Fundo da tela | `#f8f9fc` | `#0f1624` |
| surface | `bg-surface` | Cabeçalho fixo, barra de abas, bottom sheet | `#ffffff` | `#131b2a` |
| card | `bg-card` | Cartão, modal, item de lista | `#ffffff` | `#171f31` |
| subtle | `bg-subtle` | Chip, botão neutro, campo em repouso | `#f1f5f9` | `#1e293b` |
| ink | `text-ink` | Texto principal, títulos | `#020817` | `#f8fafc` |
| ink-soft | `text-ink-soft` | Rótulo de campo, texto de botão neutro | `#334155` | `#cbd5e1` |
| muted | `text-muted` | Descrição, legenda, placeholder, ícone apagado | `#506795` | `#94a3b8` |
| border | `border-border`, `bg-border` | Divisória, contorno, esqueleto | `#e2e8f0` | `#273449` |
| input | `border-input` | Contorno de campo | `#cbd5e1` | `#334155` |

Cores de estado e de módulo, em três formas (claro / escuro):

| Família | `text-X` / `border-X` | `bg-X` (texto branco) | `bg-X-soft` (com `text-X`) |
| --- | --- | --- | --- |
| primary (azul da marca) | `#2563eb` / `#60a5fa` | `#2563eb` / `#2563eb` | `#eff6ff` / `#172554` |
| destructive | `#c81e1e` / `#f36868` | `#c81e1e` / `#ce2222` | `#fef2f2` / `#3b1219` |
| success | `#15803d` / `#4ade80` | `#15803d` / `#15803d` | `#f0fdf4` / `#0d2b1c` |
| warning | `#b45309` / `#fbbf24` | `#b45309` / `#b45309` | `#fffbeb` / `#33210a` |
| deliveries (Entregas, rosa) | `#d81b60` / `#f36398` | `#d81b60` / `#d81b60` | `#fdf2f6` / `#3a1426` |
| fleet (Frotas, violeta) | `#6a3fe0` / `#9b7dff` | `#6a3fe0` / `#6a3fe0` | `#f4f0fe` / `#251a4a` |

Texto sobre `bg-primary`, `bg-destructive`, `bg-success` e `bg-warning`:
`text-primary-foreground`, `text-destructive-foreground` etc. (brancos). Os
neutros espelham o app logado do web (`trajetto-ui/src/app/globals.css`); os
acentos de módulo são os do site. Todo par passa de 4,5:1 (WCAG AA) nos dois
temas (`tests/unitaires/theme-tokens.test.ts`).

### Regras de uso

1. **Nada de cor numerada nem `bg-white`** (`gray-*`, `blue-*`,
   `primary-600`…): é o tema claro congelado. Use o token.
2. **`bg-X` é superfície, `text-X` é texto.** Não use `text-primary` em cima
   de `bg-primary`.
3. **Todo `<Text>` tem cor.** No Android, `Text` sem cor é preto, invisível no
   escuro (texto aninhado herda; emoji sozinho não precisa).
4. **Fundo da tela é `bg-background`, cartão é `bg-card`**, e cartão e modal
   levam `border border-border` (no escuro a sombra some).
5. **Props que não aceitam classe usam `useThemeColors()`** (`Ionicons color`,
   `placeholderTextColor`, `ActivityIndicator color`, `backgroundStyle` do
   bottom sheet, `selectionColor`). Nada de hex no código; só `shadowColor`
   pode ser literal.
6. **Placeholder é `colors.muted`** (já é o padrão do `Input`).
7. **Sem `bg-gradient-to-*`**: o NativeWind não desenha gradiente no nativo.
8. **`Animated.View` do Reanimated não aceita `className`**: estilize por
   `style` com `useThemeColors()`.
9. **Barra de status nunca `style="auto"`.** A raiz já acompanha o tema; uma
   tela sobre fundo escuro fixo declara `"light"` ou `"dark"`.
10. **Backdrop de modal continua `bg-black/50`** nos dois temas.
11. **Acentos de módulo só identificam o módulo** (Entregas rosa, Frotas
    violeta). Ação genérica usa primary.
12. **Componentes compartilhados primeiro** (`components/ui/**` já está em
    tokens).
13. Estados que mudam a mesma propriedade são classes exclusivas
    (`cond ? "bg-a" : "bg-b"`): o NativeWind decide pela ordem da folha, não
    pela ordem na string.
14. Toda `BottomSheetModal` usa `useCloseOnBack(visible, onClose)`, e bottom
    sheet com conteúdo que pode passar da altura usa `BottomSheetScrollView`
    com `enableDynamicSizing={false}`.
15. Tela com campo usa o `KeyboardAvoidingView` de
    `components/ui/keyboard-avoiding-view.tsx` (com `behavior="padding"`),
    nunca o do `react-native`.

Substituições rápidas: `bg-gray-50` → `bg-background`; `bg-white` →
`bg-card` (ou `bg-surface`); `bg-gray-100` → `bg-subtle`; `bg-gray-200` →
`bg-border`; `text-gray-900/800` → `text-ink`; `text-gray-700` →
`text-ink-soft`; `text-gray-600/500/400` → `text-muted`; `border-gray-100/200`
→ `border-border`; `border-gray-300` → `border-input`; `bg-blue-600` →
`bg-primary` + `text-primary-foreground`; `text-blue-700` → `text-primary`;
`bg-blue-50` → `bg-primary-soft`; vermelho → `destructive`; verde →
`success`; âmbar/amarelo → `warning`; `border-green-200` → `border-success/40`.

### Limites conhecidos

- Com Claro/Escuro escolhido à mão, oposto ao do telefone, a cor dos
  **botões** da barra de navegação do Android segue o modo do sistema
  (definida ao abrir a Activity, antes do JS). Corrigir exige
  `expo-navigation-bar`, que não está instalado (pendência do dono).
- Se o tema do sistema mudar com uma janela inferior aberta, a barra de status
  só atualiza quando ela fecha.

Conferido no emulador em 08/10/2026 (todas as telas principais, nos dois
temas, troca ao vivo, abertura a frio, gaveta em 360x640 com fonte 130%); os
defeitos achados viraram as decisões 16.980–16.985.

## Manifesto Android e permissões

- Permissões declaradas: câmera, localização precisa e aproximada e microfone
  (áudio do chat). `allowBackup: false`.
- O `app.config.js` **remove** o que bibliotecas colocam e o app não usa
  (`FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `FOREGROUND_SERVICE_MICROPHONE`,
  `SYSTEM_ALERT_WINDOW`, `READ_EXTERNAL_STORAGE`, os serviços de áudio em
  segundo plano do `expo-audio` e, com o rastreio em segundo plano desligado,
  `FOREGROUND_SERVICE`) e limita `WRITE_EXTERNAL_STORAGE` a
  `maxSdkVersion 28`. O Google revisa o manifesto, não o código.
- `compileSdkVersion`/`targetSdkVersion` 36, minify e shrink de recursos em
  release (`expo-build-properties`).
- O teste `tests/unitaires/android-manifest.test.ts` gera o manifesto real; uma
  pasta `android/` esquecida no disco o quebra (apague-a).

## Telemetria e logs

- `utils/telemetry.ts` é a única porta pela qual falhas saem do aparelho:
  eventos limpos de dados pessoais e com limite de frequência
  (`telemetry-rules.ts`). Até um destino ser configurado, ficam num buffer
  de 50 eventos lido pelo diagnóstico.
- `utils/logger.ts` escreve no console de desenvolvimento; posições e textos
  pessoais não vão para o log (`tracking-log-privacy.test.ts`).

## Decisões registradas

As decisões abaixo vêm do documento de decisões da fase final (fora deste
repositório) e valem para o app. Ficam aqui para quem só tem este repo.

| Decisão | O que ficou |
| --- | --- |
| 6.1 / 6.3 / 6.4 / 6.9 | Pausas, autorização de ocorrência pela torre, "a caminho" e retorno da IA sobre comprovantes seguem os contratos da API (`docs/contratos-app/*` no projeto) |
| 7.3 | Rastreamento em segundo plano pronto e desligado até a aprovação do Play Console |
| 12.2 | Staging é uma stack própria (API e hosts próprios); o app de staging aponta para ela pelo ambiente EAS `staging` |
| 13.1 | Cobertura medida de verdade e publicada; piso no baseline medido (MOB-30) |
| 13.4 | E2E do app com Maestro no emulador |
| 13.5 | Teste de mutação nas regras críticas, corte em 90 |
| 14.2 | Pré-checagem das fotos no aparelho, só sugestão |
| 14.3 / 14.4 | Comprovante é uma ocorrência da categoria entrega; pausas levam `occurrence_type_id` (contrato 3) |
| 16.700 | Validação ao vivo "recompensa cedo, pune tarde" |
| 16.980–16.985 | Correções do tema achadas no emulador |
| INFRA-16 / INFRA-21 | Cadeia de suprimentos (Dependabot, actions por SHA, audit-ci) e varredura de segredos (gitleaks) |
