# Deploy do app do motorista (staging e produção)

Como o app sai deste repositório e chega ao celular do motorista: perfis do
EAS, ambientes de staging e produção, o pipeline do GitHub Actions,
atualizações OTA assinadas, Play Store, Firebase, o gate de versão com a API,
rollback e o checklist do primeiro release. Este documento absorveu os
antigos `DEPLOY.md` e `ota-code-signing.md`.

Variáveis citadas aqui estão detalhadas em
[variaveis-de-ambiente.md](./variaveis-de-ambiente.md).

## Sumário

- [Visão geral](#visão-geral)
- [Por que o app não promove o mesmo artefato](#por-que-o-app-não-promove-o-mesmo-artefato)
- [Pré-requisitos](#pré-requisitos)
- [Perfis de build (`eas.json`)](#perfis-de-build-easjson)
- [Canais, branches e runtime](#canais-branches-e-runtime)
- [Versionamento](#versionamento)
- [Ambientes: staging e produção](#ambientes-staging-e-produção)
- [Pipeline](#pipeline)
- [Proteção das branches e dos ambientes no GitHub](#proteção-das-branches-e-dos-ambientes-no-github)
- [OTA assinada (code signing)](#ota-assinada-code-signing)
- [Publicação manual](#publicação-manual)
- [Versão do contrato e gate com a API](#versão-do-contrato-e-gate-com-a-api)
- [Firebase e push (FCM)](#firebase-e-push-fcm)
- [Play Store](#play-store)
- [Localização em segundo plano](#localização-em-segundo-plano)
- [Rollback](#rollback)
- [Checklist do primeiro release](#checklist-do-primeiro-release)
- [Rotina de cada release](#rotina-de-cada-release)
- [Problemas comuns](#problemas-comuns)
- [Os três repositórios juntos](#os-três-repositórios-juntos)

## Visão geral

O app é **só Android** e é gerado e distribuído pelo **EAS** (Expo
Application Services). Ele **não** roda no Dokploy nem vira imagem no GHCR:
quem fica no Dokploy é a API e o web, e o app só precisa que a API de cada
ambiente esteja no ar, com HTTPS público e WebSocket liberado.

```
 work branch ──PR──► staging ──PR (merge commit)──► main
                        │                                            │
               CI completo (ci.yml)                         CI completo (ci.yml)
                        │                                  + prova de que o commit
                        │                                    ficou verde em staging
                        ▼                                            ▼
        OTA no canal "staging"                     (aprovação do ambiente production)
        + APK interno de staging                   OTA assinada no canal "production"
          quando o lado nativo muda                + AAB de produção quando o lado
                        │                            nativo muda (→ Play internal,
                        ▼                            com PLAY_SUBMIT_ENABLED)
        testadores com o APK de staging                       │
        (aponta para a API de staging)                        ▼
                                                   motoristas (aponta para a API
                                                   de produção)
```

Dois jeitos de o código chegar ao aparelho:

| Meio | O que leva | Quando |
| --- | --- | --- |
| **OTA** (EAS Update) | só JavaScript e assets | na próxima abertura do app, para binários do **mesmo runtime** |
| **Binário** (EAS Build) | código nativo + JS embutido | instalação do APK (staging) ou atualização pela Play Store (produção) |

## Por que o app não promove o mesmo artefato

A API e o web seguem "build uma vez, promove por digest": a mesma imagem
validada em staging vira produção, com a configuração entrando em tempo de
execução. O app não pode fazer isso: as `EXPO_PUBLIC_*` (a URL da API, acima
de tudo) são **embutidas** no bundle e no binário em tempo de build. Um APK ou
uma OTA de staging falam com a API de staging para sempre.

O que o app promove é o **commit**: o `deploy.yml` só publica em produção um
commit cuja execução em `staging` terminou verde (o segundo pai do merge
commit, ou o próprio commit num fast-forward). Os artefatos de produção saem
**dessa mesma árvore**, com o ambiente EAS `production`. Por isso o merge de
`staging` em `main` deve ser **merge commit**. Squash e o "Rebase and merge"
do GitHub criam commits novos (SHAs diferentes) que staging nunca validou, e o
workflow recusa. Um fast-forward de verdade (feito fora da interface do PR)
também passa, mas o push direto em `main` fica bloqueado; use merge commit.

## Pré-requisitos

- Conta no [expo.dev](https://expo.dev) com acesso ao projeto
  `trajetto/trajetto-fleet-manager-mobile` (`owner: trajetto`,
  `projectId` em `app.json` → `extra.eas.projectId`).
- EAS CLI na versão fixada em `eas.json` (`cli.version`):

  ```bash
  npm install -g eas-cli@21.7.0
  eas login
  ```

- Node.js 22 (a mesma do CI) e `npm ci`.
- Para a loja: conta no Google Play Console com o app
  `com.trajetto.fleetmanager`.
- Para push: projeto no Firebase com o app Android `com.trajetto.fleetmanager`.
- A stack de staging (API e web) no ar antes do primeiro build de staging.

## Perfis de build (`eas.json`)

| Perfil | Ambiente EAS | Canal OTA | Artefato | Distribuição | Para quê |
| --- | --- | --- | --- | --- | --- |
| `development` | `development` | `development` | APK com dev client | interna | desenvolvimento local e E2E |
| `preview` | `preview` | `preview` | **APK** | interna | testes internos avulsos |
| `staging` | `staging` | `staging` | **APK** (herda o `preview`) | interna | homologação contra a stack de staging |
| `production` | `production` | `production` | **AAB** | loja | Play Store; `versionCode` incrementado pelo EAS (`autoIncrement`) |

- Os APKs de `preview` e `staging` levam só `arm64-v8a` e `armeabi-v7a`
  (`plugins/with-preview-abis.js`): o modelo do ML Kit tem código nativo por
  ABI e x86 não roda em celular. O AAB não precisa (a loja entrega um ABI por
  aparelho); o build do emulador (E2E) mantém x86_64.
- `submit.production.android.track = internal`: o `eas submit` publica na
  trilha de testes internos, nunca direto em produção.
- Comandos (todos `--platform android`): `npm run build:development`,
  `build:preview`, `build:staging`, `build:production`.
- O teste `tests/unitaires/eas-build-config.test.ts` guarda os perfis: APK nos
  internos, AAB na loja, staging com canal e ambiente próprios e sem URL
  escrita no `eas.json`.

## Canais, branches e runtime

- Cada binário escuta **um canal** (o `channel` do perfil). No EAS Update, o
  canal aponta para uma **branch** de mesmo nome (`staging` → `staging`,
  `production` → `production`). Os scripts `update:*` publicam na branch do
  canal com as variáveis do ambiente correspondente.
- O **runtime** é calculado por fingerprint (`runtimeVersion.policy:
  "fingerprint"` no `app.json`): hash do código nativo e da configuração
  nativa. Uma OTA só chega a binários com o mesmo runtime. Mudou dependência
  nativa, `app.json`, `app.config.js`, plugin, ícone ou o certificado de OTA?
  O runtime muda e só um binário novo leva a mudança.
- O `deploy.yml` usa uma heurística para decidir se o push pede binário novo:
  mudanças em `package.json`, `package-lock.json`, `app.json`,
  `app.config.js`, `eas.json`, `plugins/`, `modules/`, `assets/` ou `certs/`
  enfileiram um build; o resto só publica OTA. Na dúvida, rode o build manual.

## Versionamento

| Número | Onde | Quem muda |
| --- | --- | --- |
| `version` (ex.: 1.0.0) | `app.json` → `expo.version` | à mão, a cada release de loja (1.0.0 → 1.1.0) |
| `versionCode` | remoto no EAS (`appVersionSource: "remote"`) | o EAS, a cada build de produção (`autoIncrement`) |
| Runtime | fingerprint | automático |
| `CLIENT_CONTRACT` | `utils/client-version.ts` (hoje 3) | à mão, em todo release que muda o que o app envia à API |
| `OUTBOX_SCHEMA_VERSION` | `utils/client-version.ts` (hoje 1) | à mão, quando muda o formato dos itens da fila |

Para consultar ou acertar o `versionCode` remoto: `eas build:version:get -p
android` e `eas build:version:set -p android`.

## Ambientes: staging e produção

| | Staging | Produção |
| --- | --- | --- |
| Branch git | `staging` | `main` |
| Perfil / ambiente EAS / canal | `staging` | `production` |
| Artefato | APK instalado à mão pelos testadores (link no expo.dev) | AAB na Play Store |
| API | a API de staging (stack própria, decisão 12.2), ex. `https://trajettoapi-staging.thorsolucoes.com.br` | `https://trajettoapi.thorsolucoes.com.br` |
| Web (links legais) | o web de staging, ex. `https://staging.intrajetto.com` | `https://www.intrajetto.com` |
| OTA pelo CI | a cada push com mudança de app; assinada quando há chave | a cada merge com mudança de app; **sempre assinada**, após aprovação |
| Binário pelo CI | quando o lado nativo muda | quando o lado nativo muda (+ envio à trilha internal com `PLAY_SUBMIT_ENABLED=true`) |
| Aprovação | não | revisores do ambiente `production` |

Como o app aponta para cada API: a URL vem do ambiente EAS do perfil
(`EXPO_PUBLIC_API_URL`), cadastrada uma vez por ambiente (passo a passo em
[variaveis-de-ambiente.md](./variaveis-de-ambiente.md#como-cadastrar-no-eas-passo-a-passo)).
O APK de staging e o de produção podem ficar no mesmo celular? Não: os dois
usam o mesmo pacote `com.trajetto.fleetmanager`, então um substitui o outro.
Use um aparelho de teste para staging.

O ambiente `staging` é um ambiente personalizado do EAS (os padrões são
`development`, `preview` e `production`). Confirme em expo.dev → Environment
variables que ele existe no plano da conta antes do primeiro build.

## Pipeline

Três workflows em `.github/workflows/`, todos com actions fixadas por SHA
(Dependabot as atualiza), `permissions: contents: read` por padrão e Node 22.

### `ci.yml` — a validação

| Gatilho | Quando |
| --- | --- |
| `push` | qualquer branch exceto `staging`, `main` e `master` (branches de trabalho) |
| `pull_request` | PR para `staging`, `main` ou `master` |
| `workflow_call` | chamado pelo `deploy.yml` antes de qualquer publicação |
| `workflow_dispatch` | manual |

Jobs:

- **validate**: `npm ci`; `audit-ci` (advisory CRITICAL em dependência de
  produção falha; exceções datadas em `audit-ci.jsonc`); lint; typecheck;
  unitários **com cobertura e piso** (abaixo do piso falha); relatório
  `coverage-<sha>` publicado por 14 dias; `expo-doctor`. Com o secret
  `API_REPO_READ_TOKEN`, faz checkout da API (mesma branch, se existir) para
  os testes de paridade e de socket.
- **secrets**: gitleaks em **todo o histórico**, imagem fixada por digest,
  `--redact`.

Concorrência: um push novo na mesma branch de trabalho ou PR cancela o
anterior; em `staging`/`main` nada é cancelado.

O E2E Maestro não roda no CI (precisa de emulador e API locais; ver
[testes.md](./testes.md#e2e-no-emulador-maestro)).

### `deploy.yml` — Release (EAS)

| Job | Quando | O que faz |
| --- | --- | --- |
| `checks` | todo gatilho | chama o `ci.yml` inteiro; nada abaixo roda sem ele |
| `plan` | push | classifica o diff desde o **último release verde desta branch** (ou, sem ele, desde o push anterior): `app` (algo além de docs/testes/CI/E2E) e `native` (algo que muda o runtime) |
| `staging-evidence` | push em `main` | acha o commit de staging (2º pai do merge ou o próprio commit) e exige uma execução verde deste workflow em `staging` para ele; num merge commit, exige também que a árvore do merge seja idêntica à do commit de staging (`git diff --quiet HEAD^2 HEAD`); senão falha com a explicação |
| `staging` | push em `staging` com `app=true` | ambiente `staging`: OTA no canal `staging`; build `staging` (APK, `--no-wait`) se `native=true` |
| `production` | push em `main` com `app=true` | ambiente `production` (espera aprovação): OTA **assinada** no canal `production`; build `production` (AAB, `--no-wait`) se `native=true`, com auto-submit à trilha internal quando `PLAY_SUBMIT_ENABLED=true` (`--auto-submit-with-profile production`; não combinar com `--auto-submit`, as duas flags se excluem) |
| `manual-build` | `workflow_dispatch` | build do perfil escolhido (development, preview, staging, production) depois do CI; produção usa o ambiente `production` |

Comportamento sem configuração: sem `EXPO_TOKEN`, os jobs `staging` e
`production` terminam verdes com um aviso ("EXPO_TOKEN ausente: nada foi
publicado no EAS"). Assim o pipeline funciona antes de o robot user existir.
O build manual falha explicitamente sem o token.

Regras de assinatura no CI:

| Situação | Staging | Produção |
| --- | --- | --- |
| `EXPO_UPDATE_PRIVATE_KEY` no ambiente | OTA assinada | OTA assinada (se `certs/certificate.pem` existe) |
| certificado no repo, sem chave no ambiente | OTA pulada com aviso | OTA pulada com aviso |
| sem certificado no repo | OTA sem assinatura (com aviso) | **OTA pulada** (produção nunca publica sem assinatura) |

A chave vira um arquivo `0600` em `$RUNNER_TEMP/ota-signing/` e é apagada no
fim do job, falhe ou não.

`--no-wait` nos builds: verde no GitHub significa "enfileirado". O resultado
fica em expo.dev → Builds (e o EAS envia e-mail em falha, se configurado).

Concorrência: execuções da mesma branch rodam uma de cada vez e nunca são
canceladas no meio (uma OTA pela metade é pior que esperar). O GitHub ainda
descarta uma execução **pendente** quando chega outro push no mesmo grupo; por
isso o `plan` compara com o último release verde da branch, e não com o push
anterior: uma mudança nativa do push descartado entra no diff do seguinte e o
binário é enfileirado. Se ainda assim houver dúvida (por exemplo, o release
anterior ficou verde só porque o `EXPO_TOKEN` não existia), dispare o build
manual do perfil da branch.

**Regra de ouro: a árvore do merge em `main` é a árvore que rodou verde em
`staging`.** Nenhum commit, hotfix ou revert é feito direto em `main`; tudo
passa por `staging` (PR, verde, depois PR `staging` → `main` com merge
commit). Os merge commits de releases anteriores existem só em `main` e isso
não é problema: eles não trazem mudança própria, então a árvore do próximo
merge continua igual à de `staging`, sem precisar trazer `main` de volta para
`staging`. Se `main` tiver uma mudança que `staging` não tem (ou se o PR
resolver conflito no merge), as árvores diferem e o `staging-evidence` recusa
o release. Para um hotfix urgente: PR para `staging`, espere o verde, PR para
`main`.

### `ota-rollback.yml` — volta de OTA

Manual (`workflow_dispatch`), com o canal (`staging` ou `production`) e o ID
do grupo de atualização. Roda no ambiente do canal (produção espera
aprovação). Antes de republicar, lê a branch do grupo (`eas update:view
<id> --json`) e **recusa** se ela não for o canal escolhido: o `republish`
grava na branch do próprio grupo, então escolher `staging` com um grupo de
produção pularia os revisores de produção. Depois executa `eas
update:republish --group <id>`, reassinando quando há chave. Detalhes em
[Rollback](#rollback).

### Secrets e variáveis do pipeline

| Nome | Onde | Obrigatório |
| --- | --- | --- |
| `EXPO_TOKEN` | secret do repositório (ou dos ambientes) | para publicar |
| `EXPO_UPDATE_PRIVATE_KEY` | secret dos **ambientes** `staging` e `production` | para OTA assinada pelo CI |
| `API_REPO_READ_TOKEN` | secret do repositório | não (testes de paridade) |
| `PLAY_SUBMIT_ENABLED` | variável do repositório | não (padrão: não envia à loja) |

Não há webhook de Dokploy neste repositório: o app não é hospedado lá.

## Proteção das branches e dos ambientes no GitHub

Configure em Settings do repositório `trajetto-fleet-manager-mobile`:

1. **Branches** (Rules → Rulesets, ou Branch protection):
   - `staging`: bloquear force push. PR é opcional: o dono pode fazer push
     direto (como na API e na web), e todo push em `staging` roda o CI
     completo pelo `deploy.yml` antes de publicar qualquer coisa. Quem
     preferir exigir PR também em `staging` marca os checks
     `Lint, type-check, unit tests and Expo doctor` e
     `Secret scan (gitleaks)` (do `ci.yml`).
   - `main`: o mesmo, mais revisão aprovada; em Settings → General → Pull
     Requests, deixe ligado **só "Allow merge commits"** e desligue "Allow
     squash merging" e "Allow rebase merging" (o rebase do GitHub reescreve
     os commits com SHAs novos, que não têm execução verde em staging, e o
     `staging-evidence` recusa); bloquear push direto (só PR vindo de
     `staging`), para que a árvore de `main` seja sempre a de `staging`.
2. **Environments**:
   - `staging`: sem revisores; secret `EXPO_UPDATE_PRIVATE_KEY` (opcional).
   - `production`: **Required reviewers** (o dono e mais uma pessoa,
     "Prevent self-review" ligado), **Deployment branches: `main`**, secret
     `EXPO_UPDATE_PRIVATE_KEY`.
3. **Actions → General**: "Workflow permissions" em *Read repository
   contents*; os jobs pedem só o que precisam (`actions: read` na prova de
   staging e no `plan`, que consulta o último release verde).

## OTA assinada (code signing)

### Por quê

O app aplica, na próxima abertura, qualquer bundle publicado no seu canal.
Sem assinatura, quem tiver o `EXPO_TOKEN` (máquina comprometida, secret
vazado) publica um bundle que roda em todos os celulares, lê o SecureStore
(tokens do motorista) e fala com qualquer API. Com code signing, o binário
carrega um certificado e **recusa** atualização não assinada pela chave
privada correspondente.

### O que já está no repositório

- `app.config.js` embute `updates.codeSigningCertificate` e
  `codeSigningMetadata` (`keyid: main`, `alg: rsa-v1_5-sha256`) **assim que**
  `certs/certificate.pem` existir. Enquanto não existir, nada muda (hoje não
  existe).
- `.gitignore` deixa passar `certs/certificate.pem` (público; o EAS Build só
  vê o que o git vê) e ignora `keys/`.
- `npm run codesigning:generate` gera o par e o certificado (10 anos, CN
  Trajetto).
- O bundle recusa em release uma `EXPO_PUBLIC_API_URL` insegura, e o
  `app.config.js` repete a checagem ao publicar OTA quando `APP_ENV` está no
  ambiente EAS.

### Passo a passo (dono do projeto)

1. **Gerar o par de chaves** numa máquina confiável:
   `npm run codesigning:generate` → `keys/private-key.pem`,
   `keys/public-key.pem` e `certs/certificate.pem`.
2. **Guardar a chave privada** fora do repositório: cofre de senhas ou mídia
   offline, com cópia. Perder a chave significa que nenhum celular com o
   binário novo aceita mais OTA até sair outro binário com outro certificado.
3. **Confirmar o plano**: em expo.dev, verifique que o plano da conta inclui
   code signing de ponta a ponta do EAS Update (a Expo documenta o recurso
   para planos pagos). Valide numa branch: build `preview` com o certificado e
   `npm run update:preview -- "teste" --private-key-path <caminho>/private-key.pem`,
   conferindo que o aparelho aplicou a atualização.
4. **Commitar `certs/certificate.pem`** e conferir:
   `npx expo config --type public | grep codeSigning`.
5. **Gerar e publicar binários novos** (staging e produção). O certificado vai
   dentro do binário; não chega por OTA. O fingerprint inclui a seção
   `updates`, então o commit do certificado **muda o runtime**: toda OTA
   publicada a partir dele só chega ao binário novo, e os antigos deixam de
   receber correções por OTA até atualizarem pela loja. Planeje a troca (e,
   se preciso, uma atualização obrigatória) antes de depender de OTA para um
   hotfix. Binários antigos continuam aceitando atualização sem assinatura
   até serem substituídos: acompanhe a adoção.
6. **Definir `APP_ENV`** nos ambientes EAS `preview`, `staging` e
   `production`, para a checagem de HTTPS rodar também no `eas update`.
7. **Decidir onde a chave assina:**
   - **só manual** (padrão mais fechado): não cadastre
     `EXPO_UPDATE_PRIVATE_KEY`; o CI pula a OTA e você publica com
     `npm run update:production -- "mensagem" --private-key-path <caminho>`;
   - **pelo CI**: cadastre o conteúdo PEM da chave como secret
     `EXPO_UPDATE_PRIVATE_KEY` **nos ambientes** `staging` e `production`
     (nunca como secret de repositório). Produção fica atrás dos revisores
     obrigatórios. O risco aceito é a chave existir no GitHub; o ganho é OTA
     reprodutível a partir do commit validado.
8. **Rotacionar o `EXPO_TOKEN`**: revogue em expo.dev o token que estiver em
   arquivos locais (o `.env.production` antigo guardava um), apague essa linha,
   crie um token de **robot user** com o menor papel possível e guarde-o
   **só** como secret `EXPO_TOKEN` do GitHub.

### Rotação do certificado

Gere um par novo, publique binários com o certificado novo e, depois que a
frota migrar, passe a assinar só com a chave nova (atualize o secret dos
ambientes). Atualização assinada com uma chave que o binário não conhece é
recusada.

## Publicação manual

```bash
# Builds (enfileira no EAS; acompanhe em expo.dev)
npm run build:staging
npm run build:production

# OTA (mensagem no fim; com certificado, acrescente --private-key-path)
npm run update:staging -- "corrige o texto do comprovante"
npm run update:production -- "corrige o texto do comprovante" --private-key-path <caminho>/private-key.pem

# Envio do último build de produção à trilha internal
npm run submit:android
```

Pelo GitHub: Actions → **Release (EAS)** → Run workflow → perfil.

Cada `update:*` publica na branch do canal de mesmo nome com as variáveis do
ambiente EAS correspondente (`--environment`), então o bundle sai com a URL
certa mesmo que o `.env` local aponte para outro lugar.

## Versão do contrato e gate com a API

Fluxo para um release que muda o que o app envia (rota, campo, formato):

1. Suba `CLIENT_CONTRACT` em `utils/client-version.ts` no mesmo PR.
2. A API precisa aceitar o formato novo **antes** de o app usá-lo, e continuar
   aceitando o antigo: os contratos que a fila alimenta só crescem (campo novo
   opcional ou com default; formato só alarga). Suba a API primeiro.
3. Publique o app (OTA se só JS; binário se nativo).
4. Só se for preciso barrar os antigos: confira nas linhas `incoming request`
   da API (`req.client`, todas as réplicas) que os `contract` abaixo do novo
   pararam de aparecer, publique a OTA (ou binário) com o contrato novo, e só
   então defina `MIN_MOBILE_CONTRACT` na API (de preferência fora do turno: a
   tela bloqueante interrompe o que estiver aberto; rascunhos de checklist e
   abastecimento sobrevivem, uma comprovação em preenchimento não).
5. `MOBILE_STORE_URL` (API) troca o link da loja sem publicar outro build.

Sem a OTA publicada antes de subir o mínimo, a tela não acha atualização,
manda para a loja e o motorista fica parado até a versão aparecer lá.

## Firebase e push (FCM)

1. No Firebase, registre o app Android `com.trajetto.fleetmanager` e baixe o
   `google-services.json`.
2. Cadastre-o como variável de **arquivo** secreta `GOOGLE_SERVICES_JSON` nos
   ambientes EAS `preview`, `staging` e `production`
   ([passo a passo](./variaveis-de-ambiente.md#como-cadastrar-no-eas-passo-a-passo)).
   Um build de release sem ela para no worker do EAS.
3. Guarde a mesma cópia na raiz local (gitignored; o `.easignore` deixa ir no
   `eas build` local). Mantenha-as **idênticas** (o fingerprint usa o
   arquivo).
4. Gere a chave de conta de serviço **FCM V1** (Firebase → Contas de serviço)
   e cadastre em `eas credentials` → Android → Push Notifications (FCM V1). A
   API envia pela Expo Push API, que usa essa credencial; a API não guarda
   segredo do Firebase.
5. A chave do Admin SDK do Firebase nunca entra no repositório (o
   `.gitignore` e o gitleaks barram `*firebase-adminsdk*.json`).

## Play Store

1. **Primeiro AAB à mão**: o Google exige que o primeiro upload seja feito no
   Play Console. Gere com `npm run build:production` (ou o build manual do
   workflow), baixe o AAB do expo.dev e envie na trilha de testes internos.
   Ative o Play App Signing (o EAS guarda a upload key; faça backup dela).
2. **Service account**: Play Console → Configuração → Acesso à API → crie a
   service account com permissão de releases; cadastre o JSON em
   `eas credentials` → Android → Google Service Account. Nunca no repositório.
3. **Automação**: com a service account no EAS, defina a variável de
   repositório `PLAY_SUBMIT_ENABLED=true`. Daí em diante o build de produção
   do pipeline é enviado à trilha **internal**. A promoção internal → fechado
   → produção é feita no Play Console, com lançamento gradual.
4. **Ficha da loja e políticas**: Política de Privacidade (link
   `<web>/legal/privacidade`, também dentro do app), formulário de segurança
   de dados (inclua a divulgação do ML Kit:
   `https://developers.google.com/ml-kit/android-data-disclosure`),
   declaração de permissões (câmera, localização, microfone), classificação
   de conteúdo e público-alvo.
5. `npm run submit:android` envia manualmente o último build de produção à
   trilha internal.

## Localização em segundo plano

O rastreamento com a tela desligada está pronto e **desligado** (decisão 7.3).
Para ligar:

1. No Play Console, preencha a **declaração de localização em segundo plano**
   (por que o app precisa, o que o usuário ganha) com o **vídeo** mostrando o
   aviso dentro do app e o uso durante a rota.
2. Aguarde a aprovação do Google.
3. Defina `EXPO_PUBLIC_BACKGROUND_TRACKING=true` no ambiente EAS `production`
   (e `staging`, para homologar antes).
4. Gere **binários novos** (a chave muda o manifesto; OTA não leva).
5. No web, defina `BACKGROUND_TRACKING` conforme o `trajetto-ui` documenta,
   para a torre parar de avisar que só vê quem está com o app aberto.

Publicar `ACCESS_BACKGROUND_LOCATION` sem a declaração aprovada pode tirar o
app da loja.

## Rollback

| Problema | Como voltar |
| --- | --- |
| OTA ruim | Actions → **OTA rollback** → canal e ID de um grupo anterior bom (`eas update:list --branch production` ou expo.dev → Updates). Republica aquele grupo como o mais novo; os aparelhos aplicam na próxima abertura. O canal escolhido precisa ser o do grupo (o workflow confere e recusa se não for) |
| OTA ruim e o workflow não consegue ler a branch do grupo | o passo de conferência falha fechado (não republica). Fallback manual, numa máquina com a chave privada: `eas update:view <id>` para conferir a branch do grupo e, sendo a certa, `eas update:republish --group <id> --message "rollback" --private-key-path <caminho da private-key.pem>` (sem `--private-key-path` se não houver `certs/certificate.pem`). Depois corrija o `jq` do `ota-rollback.yml` para o formato que o `eas-cli` devolver |
| OTA ruim, voltar ao JS embutido | manual: `eas update:roll-back-to-embedded --branch production --runtime-version <runtime> --message "…"` (com `--private-key-path` se houver certificado) |
| Binário ruim na trilha internal/fechada | Play Console: não promova; envie um build novo |
| Binário ruim em produção | Play Console: **interromper o lançamento gradual**; corrija com OTA se o defeito for de JS, ou publique um binário novo (não dá para "desinstalar" uma versão) |
| Build de staging ruim | gere outro (`npm run build:staging`) e reinstale o APK |

O rollback da API não desfaz o app: se a API voltar para uma versão que não
entende o contrato atual do app, a fila guarda os envios recusados por
contrato e os reenvia depois da atualização, mas evite voltar a API para antes
de um contrato que o app já usa.

## Checklist do primeiro release

Contas e acessos:

- [ ] Projeto no expo.dev acessível; `eas-cli@21.7.0`; `eas login`.
- [ ] Ambiente EAS `staging` disponível no plano (além de `development`,
      `preview`, `production`).
- [ ] Robot user no expo.dev e token salvo como secret `EXPO_TOKEN` no GitHub;
      tokens antigos revogados (inclusive o do `.env.production` local).

Configuração EAS:

- [ ] Variáveis `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_WEB_APPLICATION_URL`,
      `EXPO_PUBLIC_BACKGROUND_TRACKING=false` e `APP_ENV` em `preview`,
      `staging` e `production`.
- [ ] `GOOGLE_SERVICES_JSON` (arquivo, secreto) nos três ambientes de release.
- [ ] Chave FCM V1 em `eas credentials`.
- [ ] Keystore gerada no primeiro build e backup no cofre.

Stack de staging:

- [ ] API e web de staging no ar no Dokploy (ver docs do `trajetto-api` e do
      `trajetto-ui`), com HTTPS e WebSocket; `curl https://<API staging>/health/liveness` responde.
- [ ] Usuário motorista de teste criado no web de staging.

GitHub:

- [ ] Branch `staging` criada a partir de `main`, com force push bloqueado;
      `main` protegida, só merge commit habilitado (squash e rebase
      desligados).
- [ ] Ambientes `staging` e `production` criados; `production` com revisores e
      branch `main`.
- [ ] `API_REPO_READ_TOKEN` (opcional) e `PLAY_SUBMIT_ENABLED` (deixe
      desligada até o passo da loja).

OTA assinada (recomendado antes do primeiro binário de produção):

- [ ] Par de chaves gerado, chave privada no cofre, plano confirmado,
      `certs/certificate.pem` commitado.
- [ ] Decidido se o CI assina (secret `EXPO_UPDATE_PRIVATE_KEY` nos ambientes)
      ou se a OTA de produção é manual.

Primeiro ciclo:

- [ ] Push em `staging` → CI verde → build de staging enfileirado (primeira
      vez conta como mudança nativa) → instalar o APK num aparelho de teste.
- [ ] Testar login, rota, comprovante com foto, modo avião, push e links
      legais contra a API de staging.
- [ ] Conferir em expo.dev que a OTA de staging tem o **mesmo runtime** do
      APK (se não tiver, o `google-services.json` usado no `eas update`
      difere do do build).
- [ ] PR `staging` → `main`, merge commit, aprovação do ambiente
      `production` → AAB de produção no EAS.
- [ ] Primeiro AAB enviado à mão na trilha internal; Play App Signing ativo;
      service account no EAS; `PLAY_SUBMIT_ENABLED=true`.
- [ ] Ficha da loja, segurança de dados (ML Kit), política de privacidade.
- [ ] Na API de produção, `MIN_MOBILE_CONTRACT` vazio até haver motivo.

## Rotina de cada release

1. Trabalhe numa branch, abra PR para `staging` (CI roda no PR).
2. Mudou o que o app envia? Suba `CLIENT_CONTRACT`; a API compatível sobe
   antes.
3. Merge em `staging` → OTA/APK de staging. Teste no aparelho; rode o E2E
   Maestro se mexeu no laço do motorista.
4. PR `staging` → `main` com merge commit. Aprove o ambiente `production`.
5. Acompanhe em expo.dev (Builds/Updates) e, se houve binário, promova na
   Play Console.
6. Release de loja? Suba `version` no `app.json` antes do build.

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| `staging-evidence` falha em `main` | o commit não passou por `staging`, a execução de staging não terminou, o merge foi squash ou rebase do GitHub, ou a árvore do merge difere da de `staging` (mudança só em `main` ou conflito resolvido no PR) | publique em `staging`, espere verde e faça merge commit; leve para `staging` (por PR) o que estiver só em `main` e repita o release |
| Job de staging/produção verde sem publicar nada | `EXPO_TOKEN` ausente, ou só docs/testes mudaram | veja os avisos (notice) do job |
| "OTA de produção pulada" | falta `certs/certificate.pem` ou `EXPO_UPDATE_PRIVATE_KEY` no ambiente | siga [OTA assinada](#ota-assinada-code-signing) ou publique à mão |
| "precisa do google-services.json" | falta `GOOGLE_SERVICES_JSON` no ambiente EAS do perfil | cadastre a variável de arquivo |
| "exige EXPO_PUBLIC_API_URL com HTTPS" / "não aceita API local" | URL do ambiente EAS não é pública ou não usa HTTPS | corrija a variável do ambiente |
| Build de release diz "API inacessível" no aparelho | URL insegura embutida | idem; gere build/OTA de novo |
| OTA não chega ao aparelho | runtime diferente (código nativo mudou, ou `google-services.json` diferente entre `eas update` e build) | gere build novo; mantenha os arquivos iguais |
| OTA recusada sem erro visível | binário com certificado e OTA sem assinatura (ou outra chave) | publique assinada com a chave certa |
| Build falha no EAS | credenciais, `projectId`, dependência | veja o log em expo.dev; confira `EXPO_TOKEN` e `extra.eas.projectId` |
| Tela de atualização obrigatória para todos | `MIN_MOBILE_CONTRACT` acima do contrato publicado | publique a OTA com o contrato novo ou baixe o mínimo na API |

## Os três repositórios juntos

> Esta seção é **a mesma** nos três manuais de deploy:
> [`trajetto-api/docs/deploy.md`](https://github.com/Trajetto-Organization/trajetto-api/blob/main/docs/deploy.md),
> [`trajetto-ui/docs/deploy.md`](https://github.com/Trajetto-Organization/trajetto-fleet-manager-ui/blob/main/docs/deploy.md)
> e
> [`trajetto-mobile/docs/deploy.md`](https://github.com/Trajetto-Organization/trajetto-fleet-manager-mobile/blob/main/docs/deploy.md).
> Mudou aqui, mude nos outros dois. O detalhe de cada passo fica no manual do
> repositório dono dele.

### Quem é quem

| | API (`trajetto-api`) | Web (`trajetto-fleet-manager-ui`, pasta `trajetto-ui`) | App (`trajetto-fleet-manager-mobile`, pasta `trajetto-mobile`) |
|---|---|---|---|
| Artefato | imagens `trajetto-api`, `trajetto-ai` e `trajetto-backup` em `ghcr.io/trajetto-organization/` | imagem `ghcr.io/trajetto-organization/trajetto-ui` | APK/AAB (EAS Build) e OTA (EAS Update) |
| Onde roda | Dokploy: **um app Compose (Docker Stack)** por ambiente com o `compose.production.yaml`: `api`, `trajetto-database` (Postgres), `trajetto-redis`, `trajetto-ai` e `trajetto-backup` | Dokploy: **uma Application** por ambiente, puxando a imagem do GHCR | no celular do motorista (APK interno em staging, Play Store em produção) |
| Nome no Dokploy / EAS | `trajetto-staging` e `trajetto` | `trajetto-ui-staging` e `trajetto-ui-production` | perfis, ambientes e canais `staging` e `production` |
| Como o pipeline publica | API do Dokploy (`.github/scripts/dokploy-deploy.mjs`), que acompanha o deployment até o fim | webhook de deploy da Application (`.github/scripts/dokploy-webhook.mjs`), depois espera o `/build-id.json` | `eas update` e `eas build` |
| Secrets de deploy no GitHub | environments `staging` e `production`: `DOKPLOY_URL`, `DOKPLOY_API_KEY`, `DOKPLOY_COMPOSE_ID` | environment `staging`: `DOKPLOY_STAGING_WEBHOOK_URL`; environment `production`: `DOKPLOY_PRODUCTION_WEBHOOK_URL` | `EXPO_TOKEN` (repositório) e `EXPO_UPDATE_PRIVATE_KEY` (environments `staging` e `production`) |
| Sem os secrets | move as tags e pula o deploy com `::notice::` | move as tags e pula o deploy com aviso | termina verde com aviso, sem publicar |
| De staging para produção | promove por digest a imagem `sha-<7 do commit>` (tag `staging` → `stable`), sem rebuild | igual à API, e exige o marcador `staged-<7 do commit>` no mesmo digest | promove o **commit** verde em staging (a URL da API é embutida no build, então o artefato não pode ser o mesmo) |
| Rollback | *Run workflow* do `deploy.yml` com `image_tag=sha-<7>` | *Run workflow* do `deploy.yml` com `image_tag=sha-<7>` | `ota-rollback.yml` (republica um grupo de OTA) |

Regras comuns aos três: a branch `staging` recebe o trabalho (push direto do
dono ou merge de PR) e todo push nela roda a validação completa e publica o
staging; `main` só recebe PR **de `staging`**, com **merge commit** (squash e
rebase criam um commit que o staging nunca validou, e a promoção recusa); o
environment `production` do GitHub tem **Required reviewers** e
*Deployment branches* restrito a `main`, então nada chega à produção sem
aprovação.

### Endereços

| | Staging | Produção |
|---|---|---|
| Web | `https://staging.intrajetto.com` | `https://www.intrajetto.com` (o apex `intrajetto.com` redireciona) |
| API (REST e Socket.IO) | `https://trajettoapi-staging.thorsolucoes.com.br` | `https://trajettoapi.thorsolucoes.com.br` |
| Serviço de IA | sem endereço público: `http://trajetto-ai:8080` na rede interna da stack da API | idem |

### O que precisa casar entre os repositórios

| Valor | API (Environment do app Compose) | Web (Environment da Application) | App (ambiente EAS) |
|---|---|---|---|
| URL pública da API | `API_HOST` (só o host, para o roteador do Traefik) e `API_HTTP_REQUEST` (a URL) | `HTTP_REQUEST` (chamadas do servidor da web) e `PUBLIC_API_URL` (chamadas do navegador) | `EXPO_PUBLIC_API_URL` |
| Socket.IO | o mesmo host da API, com WebSocket liberado na borda | `PUBLIC_SOCKET_URL` (vazia = `PUBLIC_API_URL`) | o socket usa `EXPO_PUBLIC_API_URL` |
| Origem da web | `HTTP_REQUEST` = a origem da web do ambiente (única origem do CORS e do Socket.IO, base dos links) | `METADATA_BASE` | `EXPO_PUBLIC_WEB_APPLICATION_URL` (links de Privacidade e Termos) |
| Limite de tentativas por IP | `RATE_LIMIT_FORWARDER_SECRET` | `RATE_LIMIT_FORWARDER_SECRET`, **o mesmo valor** | — |
| Captcha (Turnstile) | `TURNSTILE_SECRET_KEY` (o mesmo widget da web) e `TURNSTILE_REQUIRED` | `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` | — |
| Fotos no R2 | `R2_*` (um bucket por ambiente) | `CSP_STORAGE_ORIGINS` libera a origem do bucket; o CORS do bucket libera a origem da web | envia direto à URL pré-assinada que a API devolve (sem configuração) |
| IA (leitura de fotos) | `AI_LOCAL_TOKEN`, que o compose entrega também ao `trajetto-ai` como `AI_TOKEN` (um valor por ambiente) | nenhuma variável: a IA chega pela API | nenhuma variável |
| Push (FCM) | nenhuma: a API chama a Expo Push API | — | `GOOGLE_SERVICES_JSON` (arquivo secreto no EAS) e a chave FCM V1 em `eas credentials` |
| Rastreamento em segundo plano | — | `BACKGROUND_TRACKING` | `EXPO_PUBLIC_BACKGROUND_TRACKING` (as duas ligam juntas) |
| Versão do app | `MIN_MOBILE_CONTRACT` e `MOBILE_STORE_URL` | — | `CLIENT_CONTRACT` em `utils/client-version.ts` |
| Gate de rotas da web | `/docs/json` com `DOCS_USER` e `DOCS_PASSWORD` | secrets `API_DOCS_URL`, `DOCS_USER`, `DOCS_PASSWORD` no environment `production` | — |
| Checkout entre repositórios no CI | `CLIENT_REPOS_READ_TOKEN` (lê a web e o app) | `API_REPO_READ_TOKEN` (lê a API) | `API_REPO_READ_TOKEN` (lê a API) |

Segredos nunca são compartilhados entre staging e produção. Cada variável
está detalhada no `docs/variaveis-de-ambiente.md` do repositório que a lê.

### Ordem do primeiro deploy

1. **GitHub, nos três repositórios:** branch `staging` criada a partir de
   `main`; environments `staging` e `production` (este com revisores e só a
   branch `main`); só merge commit habilitado; proteção de `main`. Um
   primeiro push em `staging` em cada repositório: a API e a web publicam
   `sha-<7>` no GHCR e pulam o deploy; o app pula o EAS até o `EXPO_TOKEN`
   existir.
2. **Servidor:** VPS com Dokploy, Traefik ajustado com
   `trajetto-api/infra/traefik/`, DNS na Cloudflare (Full strict) para os
   hosts da web e da API, registry `ghcr.io` no Dokploy com um token
   `read:packages` (o mesmo registry serve para as quatro imagens).
3. **Contas externas:** buckets R2 (fotos e backup, um de cada por
   ambiente, CORS das fotos com a origem da web), widgets do Turnstile por
   ambiente, Meta e Resend (de teste em staging), heartbeats de monitoramento.
4. **API de staging** (`trajetto-staging`, manual da API): um único deploy
   do app Compose sobe, juntos, o **banco** (`trajetto-database`), o
   **Redis**, o **serviço de IA** (`trajetto-ai`, com o `AI_LOCAL_TOKEN`), o
   backup e a `api`, que só fica pronta quando banco e Redis respondem.
   Confira `/health/readiness` e, como MASTER na web, *Sistema → Provedores*.
   Depois, os secrets `DOKPLOY_*` no environment `staging` da API.
5. **Web de staging** (`trajetto-ui-staging`, manual da web): imagem
   `:staging`, `HTTP_REQUEST` e `PUBLIC_API_URL` apontando para a API de
   staging, o mesmo `RATE_LIMIT_FORWARDER_SECRET` da API de staging, e o
   `HTTP_REQUEST` da API de staging igual à origem da web de staging. Depois,
   `DOKPLOY_STAGING_WEBHOOK_URL` e `METADATA_BASE_STAGING` no environment
   `staging` da web.
6. **App de staging** (manual do app): ambiente EAS `staging` com
   `EXPO_PUBLIC_API_URL` = API de staging e
   `EXPO_PUBLIC_WEB_APPLICATION_URL` = web de staging; `EXPO_TOKEN` no
   GitHub; um push em `staging` gera o APK de staging.
7. **Produção, na mesma ordem:** app Compose `trajetto` (primeiro deploy com
   `API_IMAGE_TAG`/`AI_IMAGE_TAG`/`BACKUP_IMAGE_TAG` = `sha-<7>`) e PR
   `staging → main` da API, que cria `stable`; depois a Application
   `trajetto-ui-production` e o PR da web; por último o PR do app, que gera
   o AAB de produção apontando para a API de produção.

### Ordem de cada release

**API → web → app**, sempre:

1. **API:** merge `staging → main`, aprovação, convergência das réplicas.
   Mudanças de rota seguem expandir e depois contrair: a API nunca tira uma
   rota que a web ou o app em produção ainda chamam.
2. **Web:** só depois. O gate de rotas do promote falha se a API de
   produção ainda não serve alguma rota que o build da web chama.
3. **App:** por último. Se o app passou a enviar algo novo, o
   `CLIENT_CONTRACT` (`utils/client-version.ts`) sobe e a API compatível já
   precisa estar em produção; `MIN_MOBILE_CONTRACT` só sobe depois que a OTA
   (ou o binário) com o contrato novo estiver publicada e os contratos
   antigos sumirem dos logs da API.
