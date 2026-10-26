# Trajetto — App do motorista

Aplicativo de campo do Trajetto, **só Android**, feito com Expo e React
Native. É o que o motorista usa no dia a dia: rota do dia, chegada, comprovante
de entrega com foto e assinatura, ocorrências, pausas, "a caminho", chat com a
central e, quando a empresa tem o módulo Frotas, abastecimentos e checklists do
veículo. Funciona sem sinal: o que o motorista registra fica no aparelho e é
enviado quando a rede volta.

> Software proprietário. Leia [Licença](#licença) antes de copiar qualquer coisa
> deste repositório.

## Sumário

- [Documentação](#documentação)
- [O Trajetto em 1 minuto](#o-trajetto-em-1-minuto)
- [O que o app faz](#o-que-o-app-faz)
- [Stack](#stack)
- [Como o código está organizado](#como-o-código-está-organizado)
- [Offline: cache e fila de envios](#offline-cache-e-fila-de-envios)
- [Rastreamento de posição](#rastreamento-de-posição)
- [Versão mínima e atualizações OTA](#versão-mínima-e-atualizações-ota)
- [Rodando localmente](#rodando-localmente)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Scripts](#scripts)
- [Testes](#testes)
- [Build, publicação e fluxo de branches](#build-publicação-e-fluxo-de-branches)
- [Solução de problemas](#solução-de-problemas)
- [Licença](#licença)

## Documentação

| Documento | O que tem |
| --- | --- |
| [`docs/arquitetura.md`](docs/arquitetura.md) | como o app é montado: offline (cache e fila), formulários, sessão e módulos, tempo real, rastreamento, contrato com a API, pré-checagem, tema, manifesto e decisões |
| [`docs/testes.md`](docs/testes.md) | suítes (Vitest, cobertura, mutação, Maestro no emulador), o que cada uma prova e as regras para escrever testes |
| [`docs/deploy.md`](docs/deploy.md) | perfis do EAS, staging e produção, pipeline, OTA assinada, Play Store, Firebase, rollback e checklist do primeiro release |
| [`docs/variaveis-de-ambiente.md`](docs/variaveis-de-ambiente.md) | cada variável, secret e credencial: para quê, formato, valor por ambiente e onde configurar |
| [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) | guia para agentes de código (e para quem chega agora): comandos, convenções e o que não fazer |

## O Trajetto em 1 minuto

O Trajetto é uma plataforma B2B (SaaS multiempresa) para transportadoras, com
dois módulos vendidos separadamente por empresa: **Frotas** (veículos,
abastecimentos, checklists, manutenção, multas, contas a pagar) e **Entregas**
(documentos, rotas, torre de controle, ocorrências, comprovantes, atendimento
com o motorista, integrações).

| Repositório no GitHub (pasta local) | O que é | Onde roda |
|---|---|---|
| `trajetto-api` | API (Fastify, Prisma, PostgreSQL, Redis), tempo real, filas, crons e o serviço local de IA/OCR | Dokploy, app Compose (Docker Stack) |
| `trajetto-ui` (`trajetto-ui`) | painel web e site público (Next.js) | Dokploy, Application |
| `trajetto-mobile` (`trajetto-mobile`, este) | app do motorista, só Android | EAS (APK interno e Play Store) |

## O que o app faz

O app mostra só o que o módulo contratado e o perfil do usuário permitem: um
motorista de empresa sem Frotas não vê veículo, abastecimento nem checklist.

### Entregas (módulo Entregas)

- **Dia do motorista:** as rotas liberadas ou em andamento e suas paradas, na
  ordem definida pela central.
- **Iniciar rota, chegada e "a caminho":** cada toque vira um evento da
  entrega, com horário e GPS; "a caminho" aparece na torre e pode avisar o
  cliente, se a empresa tiver mensagem ativa para isso.
- **Comprovante de entrega:** é o registro de uma ocorrência da categoria
  entrega. O tipo escolhido define o que é exigido: foto do canhoto (só pela
  câmera), assinatura na tela, fotos extras, formulário e quem recebeu.
- **Ocorrências** (não entrega): o tipo pode exigir foto, formulário com campos
  obrigatórios (validados no aparelho, inclusive offline) e autorização da
  torre. Enquanto a torre não responde, a entrega fica aguardando; a resposta
  chega em tempo real e por push.
- **Pausas** (refeição, descanso e outros tipos da empresa): só dentro de uma
  jornada, isto é, com rota liberada ou em andamento no dia.
- **Pré-checagem no aparelho:** quando a empresa contratou a IA, o app lê o
  canhoto e o odômetro no próprio celular (ML Kit, sem rede) e avisa se o
  número da NF, a data ou a km não batem. É só sugestão: o motorista pode
  enviar mesmo assim e o servidor faz a leitura oficial.

### Chat (atendimento)

Conversa com a central organizada por ticket: cada assunto (uma ocorrência,
uma entrega, uma rota ou um assunto geral) tem histórico e status. O app envia
texto, imagem e áudio gravado, e mostra quando a central leu.

### Frotas (módulo Frotas)

- **Abastecimento:** foto do odômetro, km, litros, valor e a posição no momento
  do envio.
- **Checklist veicular:** itens com fotos obrigatórias e a km do veículo.
- Valem para o veículo em que o motorista é responsável fixo e para o veículo
  da rota liberada ou em andamento.

### Conta

Login com verificação em duas etapas, escolha de empresa (quando o usuário tem
mais de uma), notificações, envios pendentes e links para Privacidade e Termos.

## Stack

- Expo SDK 54 com **dev client** (não roda no Expo Go: há módulos nativos
  próprios), React Native 0.81, `expo-router`.
- NativeWind (Tailwind) para estilo.
- `@tanstack/react-query` com persistência em AsyncStorage (cache offline).
- `zustand` para sessão, conexão, fila de envios e atualização obrigatória.
- `react-hook-form` + `zod` nos formulários (esquemas espelhados da API).
- `socket.io-client` para tempo real; `expo-notifications` para push.
- `expo-location` e `expo-task-manager` para posição; `expo-image-picker` para a
  câmera; `expo-audio` para os áudios do chat;
  `react-native-signature-canvas` para a assinatura.
- Módulo nativo próprio `modules/text-reader` (Kotlin, ML Kit Text Recognition
  embutido) para a pré-checagem.
- `expo-updates` com atualizações OTA assinadas.

## Como o código está organizado

```
app/
  (auth)/            login, verificação em duas etapas, esqueci a senha
  (protected)/
    (tabs)/          vehicles (Início), deliveries, chat
    delivery-detail, delivery-proof, delivery-occurrence,
    fuel, checklist, notifications, pending-submissions, select-business
features/<assunto>/  regras puras (*-rules.ts) e hooks compostos por assunto:
                     deliveries, occurrences, pauses, chat, fuel, checklist,
                     submissions (fila), offline, tracking, ai-precheck,
                     access, app-update, notifications, auth …
components/          telas e peças de interface compartilhadas
modules/text-reader/ módulo nativo da pré-checagem
plugins/             config plugins do Expo
providers/           auth, react-query (persistência), socket, toast
store/               auth, conexão, outbox, 2FA, atualização obrigatória
schemas/             esquemas zod
utils/               cliente HTTP, URL da API, versão do contrato, telemetria
tests/unitaires/     testes Vitest das regras puras
.maestro/            fluxos E2E (Maestro)
scripts/e2e/         scripts que sobem emulador, API e Metro para o E2E
```

As regras de negócio ficam em funções puras testadas (`features/**/**-rules.ts`)
e as telas usam hooks compostos. Não há um contexto global de formulário: cada
tela compõe os hooks de que precisa.

## Offline: cache e fila de envios

- **Cache de leitura:** o react-query persiste o dia do motorista e os
  catálogos por até 7 dias (`providers/query-provider.tsx`). Sem rede, o app
  abre com o último dia baixado.
- **Fila de envios (outbox):** chegada, comprovante, ocorrência, pausa,
  abastecimento e checklist vão para uma fila durável
  (`features/submissions/`). Cada item tem um `client_submission_id`, então
  reenviar nunca duplica no servidor. Fotos sobem direto para o armazenamento
  por URL pré-assinada, com upload retomável.
- **Rascunhos:** os formulários longos salvam o que foi digitado; se o app
  fechar ou o sinal cair, nada se perde.
- **Recusas:** um item que o servidor recusa por regra (formulário mudou, tipo
  desativado, app desatualizado) espera a revisão do motorista em "Envios
  pendentes", sem perder foto, assinatura, horário e local.
- O laço do motorista (rota, chegada, comprovante, ocorrência, pausa) é o que
  funciona offline de verdade. Telas de consulta mostram o que estiver em
  cache.

## Rastreamento de posição

- Com o app aberto, o app envia a posição do motorista durante a rota; a torre
  de controle mostra o veículo.
- Rastreamento com a tela desligada (segundo plano) está pronto e testado, mas
  **desligado**: depende da declaração de localização em segundo plano aprovada
  no Play Console. A chave é `EXPO_PUBLIC_BACKGROUND_TRACKING`: com `true`, o
  build declara `ACCESS_BACKGROUND_LOCATION` e o serviço em primeiro plano
  (`app.config.js`). Até lá, a torre só vê o motorista com o app aberto e diz
  isso na tela (variável `BACKGROUND_TRACKING` da web).
- Permissões do build padrão: câmera, localização precisa e aproximada e
  microfone (áudio do chat).

## Versão mínima e atualizações OTA

- Cada build envia o contrato que fala com a API (`CLIENT_CONTRACT` em
  `utils/client-version.ts`). Abaixo de `MIN_MOBILE_CONTRACT` (variável da
  API), a API responde `426 CLIENT_UPGRADE_REQUIRED` e o app mostra uma tela de
  atualização: tenta uma atualização OTA para o mesmo runtime e, sem ela, abre
  a loja (`features/app-update/upgrade-rules.ts`).
- O runtime é calculado por *fingerprint*: uma OTA só chega a builds com o
  mesmo código nativo.
- As atualizações OTA são assinadas assim que o certificado é commitado, e o
  app recusa bundle sem assinatura válida
  ([`docs/deploy.md`](docs/deploy.md#ota-assinada-code-signing)).
- Um build de release recusa `EXPO_PUBLIC_API_URL` sem HTTPS ou de rede local
  (`utils/api-url-rules.ts`).

## Rodando localmente

### Pré-requisitos

- Node.js 22 e npm (o repositório usa `package-lock.json`);
- conta no expo.dev com acesso ao projeto e `eas-cli` na versão de
  `eas.json` (`npm install -g eas-cli@21.7.0`);
- um aparelho Android ou um emulador do Android Studio;
- a API rodando (README do `trajetto-api`); para os testes de paridade, o
  `trajetto-api` clonado ao lado deste repositório.

### Passo a passo

```bash
# 1. Dependências
npm install

# 2. Variáveis locais (só o Metro lê este arquivo; o EAS não)
cp .env.example .env
#    num aparelho físico, troque localhost pelo IP da sua máquina na rede;
#    no emulador, http://10.0.2.2:3333 chega à API do computador

# 3. Instale o dev client uma vez (o Expo Go não serve)
npm run build:development     # gera o APK de desenvolvimento no EAS
#    ou localmente: npx expo prebuild --platform android && cd android && ./gradlew assembleDebug

# 4. Suba o Metro e abra o app de desenvolvimento no aparelho
npm start
```

Faça login com um usuário motorista criado no painel web (cadastro de
motorista vinculado a um usuário).

## Variáveis de ambiente

| Variável | Para quê |
|---|---|
| `EXPO_PUBLIC_API_URL` | URL da API (HTTPS em builds de release) |
| `EXPO_PUBLIC_WEB_APPLICATION_URL` | URL do painel web, base dos links de Privacidade e Termos |
| `EXPO_PUBLIC_BACKGROUND_TRACKING` | `false` até a aprovação no Play Console (veja acima) |
| `APP_ENV` | só nos ambientes do EAS: o nome do ambiente, para a checagem de URL ao publicar OTA |
| `GOOGLE_SERVICES_JSON` | só no EAS: variável do tipo arquivo com o `google-services.json` do Firebase (push) |

**O EAS não lê o `.env`.** `eas build` e `eas update` usam as variáveis do
ambiente EAS indicado no `eas.json` (`development`, `preview` ou
`production`; o perfil `staging` usa o `preview`), definidas no expo.dev ou com `eas env:create`. Tudo é embutido
em tempo de build: não há configuração em tempo de execução. A referência
completa (valores por ambiente, secrets do GitHub, credenciais do EAS) está em
[`docs/variaveis-de-ambiente.md`](docs/variaveis-de-ambiente.md).

## Scripts

| Script | O que faz |
|---|---|
| `npm start` | Metro (`expo start`) |
| `npm run android` | Metro e abre no Android |
| `npm run clear` | Metro limpando o cache |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `expo lint` |
| `npm test` | testes unitários (Vitest, `tests/unitaires`) |
| `npm run test:watch` | unitários em modo watch |
| `npm run test:coverage` | cobertura dos unitários |
| `npm run test:mutation` | teste de mutação (Stryker) |
| `npm run doctor` | `expo-doctor` |
| `npm run validate` | typecheck, testes, lint e doctor |
| `npm run build:development` / `build:preview` / `build:staging` / `build:production` | builds Android no EAS |
| `npm run submit:android` | envia o build de produção à Play Store (trilha `internal`) |
| `npm run update:preview` / `update:staging` / `update:production` | publica OTA no canal (passe a mensagem no fim) |
| `npm run codesigning:generate` | gera o par de chaves e o certificado das OTAs |
| `npm run eas:login` / `npm run expo:login` | login nas contas |

## Testes

| Suíte | Onde | Como rodar | Precisa de |
|---|---|---|---|
| Unitários (regras puras, hooks, contratos, configs) | `tests/unitaires` | `npm test` | só Node |
| Cobertura com piso | `vitest.config.ts` | `npm run test:coverage` | só Node |
| Mutação | `stryker.config.mjs` | `npm run test:mutation` | só Node (lento) |
| E2E no emulador (Maestro) | `.maestro/`, `scripts/e2e/` | [`docs/testes.md`](docs/testes.md#e2e-no-emulador-maestro) | emulador Android, Maestro, API e banco descartáveis |

O E2E dirige o app de verdade no emulador, contra uma API na porta 3335 e um
banco próprio: login → entregas → iniciar rota → chegada → comprovante com foto
e assinatura → ocorrência com formulário → modo avião (fila) → volta da rede →
abastecimento e checklist → logout → novo login → motorista sem Frotas → troca
de usuário com pendências → chat → duas etapas. Passo a passo, massa de dados
e armadilhas em [`docs/testes.md`](docs/testes.md).

## Build, publicação e fluxo de branches

```
branch de trabalho ──PR──► staging ──PR (merge commit)──► main
```

| Onde | O que acontece (`.github/workflows/`) |
|---|---|
| push numa branch de trabalho, PR para `staging` ou `main` | `ci.yml`: audit, lint, typecheck, unitários com piso de cobertura, `expo-doctor` e gitleaks |
| push em `staging` | `deploy.yml`: CI completo → OTA no canal `staging` e, se o lado nativo mudou, APK de staging no EAS |
| push em `main` | `deploy.yml`: CI completo → prova de que o commit ficou verde em `staging` → aprovação do ambiente `production` → OTA **assinada** no canal `production` e, se o lado nativo mudou, AAB de produção (enviado à trilha `internal` com `PLAY_SUBMIT_ENABLED=true`) |
| manual | `deploy.yml` (build de qualquer perfil) e `ota-rollback.yml` (republica um grupo de OTA anterior) |

| Perfil (`eas.json`) | Ambiente e canal | Artefato | Para quê |
|---|---|---|---|
| `development` | `development` | APK com dev client | desenvolvimento e E2E |
| `preview` | `preview` | APK | testes internos |
| `staging` | `staging` | APK | homologação contra a stack de staging |
| `production` | `production` | AAB, `versionCode` automático | Play Store |

- O app não vai para o Dokploy nem para o GHCR: é distribuído pelo EAS. Como
  as `EXPO_PUBLIC_*` são embutidas no build, o que se promove de staging para
  produção é o **commit**, não o artefato.
- Sem o secret `EXPO_TOKEN`, os jobs de publicação terminam com um aviso e
  não publicam nada.
- Guia completo (OTA assinada, Play Store, Firebase, gate de versão, rollback
  e checklist do primeiro release): [`docs/deploy.md`](docs/deploy.md). A
  seção "Os três repositórios juntos" (igual nos três repositórios) traz a
  ordem do primeiro deploy (API → web → app), a ordem de cada release e os
  valores que precisam casar com a API e a web.

## Solução de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| "There was a problem loading the project" no dev client | bundle frio ou Metro inacessível | espere o primeiro bundle; confira `adb reverse tcp:8081 tcp:8081` |
| App não chega à API no aparelho físico | `localhost` aponta para o próprio celular | use o IP da máquina na rede ou um túnel HTTPS |
| Build de release diz "API inacessível" | `EXPO_PUBLIC_API_URL` sem HTTPS ou de rede local | configure uma URL HTTPS pública no ambiente EAS |
| OTA publicada não chega ao app | runtime diferente (código nativo mudou) ou `google-services.json` local diferente do EAS | gere um build novo; mantenha os dois arquivos iguais |
| Tela de atualização obrigatória | build abaixo de `MIN_MOBILE_CONTRACT` | atualize pelo OTA oferecido ou pela loja |
| Itens presos em "Envios pendentes" | sem rede, ou recusa que espera revisão | abra o item e revise; com rede, a fila esvazia sozinha |
| Pré-checagem nunca aparece | empresa sem IA contratada, ou build sem o módulo nativo | é opcional; o envio funciona sem ela |
| `android-manifest.test.ts` falha depois do E2E | pasta `android/` gerada pelo prebuild ficou no disco | apague `android/` |

## Licença

Software proprietário da Trajetto, com todos os direitos reservados. O uso, a
cópia, a modificação e a distribuição dependem de autorização por escrito da
Trajetto. Os termos completos estão em [`LICENSE`](./LICENSE), os mesmos do
`trajetto-api`. O `package.json` declara `"license": "UNLICENSED"` e
`"private": true`.
