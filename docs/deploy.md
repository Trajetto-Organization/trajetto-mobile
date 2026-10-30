# Deploy do app do motorista (staging e produção)

Como o app sai deste repositório e chega ao celular do motorista: perfis do
EAS, ambientes de staging e produção, o pipeline do GitHub Actions,
atualizações OTA assinadas, Play Store, Firebase, o gate de versão com a API,
rollback e o checklist do primeiro release. Este documento absorveu os
antigos `DEPLOY.md` e `ota-code-signing.md`.

Variáveis citadas aqui estão detalhadas em
[variaveis-de-ambiente.md](./variaveis-de-ambiente.md). O mapa da
infraestrutura feita à mão (as contas, os painéis da Expo, do GitHub, da
Cloudflare e do Dokploy, os tokens e o porquê de cada configuração) fica em
[`trajetto-api/docs/infraestrutura.md`](https://github.com/Trajetto-Organization/trajetto-api/blob/staging/docs/infraestrutura.md).

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
- [Tamanho do app](#tamanho-do-app)
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

| Meio                    | O que leva                  | Quando                                                                |
| ----------------------- | --------------------------- | --------------------------------------------------------------------- |
| **OTA** (EAS Update)    | só JavaScript e assets      | na próxima abertura do app, para binários do **mesmo runtime**        |
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

| Perfil        | Ambiente EAS  | Canal OTA     | Artefato                    | Distribuição | Para quê                                                          |
| ------------- | ------------- | ------------- | --------------------------- | ------------ | ----------------------------------------------------------------- |
| `development` | `development` | `development` | APK com dev client          | interna      | desenvolvimento local e E2E                                       |
| `preview`     | `preview`     | `preview`     | **APK**                     | interna      | base que o `staging` herda; fora do build manual (ver abaixo)     |
| `staging`     | `preview`     | `staging`     | **APK** (herda o `preview`) | interna      | homologação contra a stack de staging                             |
| `production`  | `production`  | `production`  | **AAB**                     | loja         | Play Store; `versionCode` incrementado pelo EAS (`autoIncrement`) |

- Os APKs de `preview` e `staging` levam só `arm64-v8a` e `armeabi-v7a`
  (`plugins/with-preview-abis.js`): o modelo do ML Kit tem código nativo por
  ABI e x86 não roda em celular. O AAB não precisa (a loja entrega um ABI por
  aparelho); o build do emulador (E2E) mantém x86_64.
- `submit.production.android.track = internal`: o `eas submit` publica na
  trilha de testes internos, nunca direto em produção.
- Comandos (todos `--platform android`): `npm run build:development`,
  `build:preview`, `build:staging`, `build:production`.
- O build manual do `deploy.yml` não oferece o `preview`: nenhum pipeline
  publica OTA no canal `preview`, então um APK dele nunca se atualiza. Para
  testar, use o `staging`, que recebe a OTA de todo push em `staging`.
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

| Número                  | Onde                                         | Quem muda                                               |
| ----------------------- | -------------------------------------------- | ------------------------------------------------------- |
| `version` (ex.: 1.0.0)  | `app.json` → `expo.version`                  | à mão, a cada release de loja (1.0.0 → 1.1.0)           |
| `versionCode`           | remoto no EAS (`appVersionSource: "remote"`) | o EAS, a cada build de produção (`autoIncrement`)       |
| Runtime                 | fingerprint                                  | automático                                              |
| `CLIENT_CONTRACT`       | `utils/client-version.ts` (hoje 3)           | à mão, em todo release que muda o que o app envia à API |
| `OUTBOX_SCHEMA_VERSION` | `utils/client-version.ts` (hoje 1)           | à mão, quando muda o formato dos itens da fila          |

Para consultar ou acertar o `versionCode` remoto: `eas build:version:get -p
android` e `eas build:version:set -p android`.

## Ambientes: staging e produção

|                          | Staging                                                                              | Produção                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Branch git               | `staging`                                                                            | `main`                                                                               |
| Perfil / canal           | `staging`                                                                            | `production`                                                                         |
| Ambiente EAS (variáveis) | `preview`                                                                            | `production`                                                                         |
| Artefato                 | APK instalado à mão pelos testadores (link no expo.dev)                              | AAB na Play Store                                                                    |
| API                      | a API de staging (stack própria, decisão 12.2): `https://api-staging.intrajetto.com` | a definir, ex. `https://api.intrajetto.com`                                          |
| Web (links legais)       | o web de staging, ex. `https://staging.intrajetto.com`                               | `https://www.intrajetto.com`                                                         |
| OTA pelo CI              | a cada push com mudança de app; assinada quando há chave                             | a cada merge com mudança de app; **sempre assinada**, após aprovação                 |
| Binário pelo CI          | quando o lado nativo muda                                                            | quando o lado nativo muda (+ envio à trilha internal com `PLAY_SUBMIT_ENABLED=true`) |
| Aprovação                | não                                                                                  | revisores do ambiente `production`                                                   |

Como o app aponta para cada API: a URL vem do ambiente EAS do perfil
(`EXPO_PUBLIC_API_URL`), cadastrada uma vez por ambiente (passo a passo em
[variaveis-de-ambiente.md](./variaveis-de-ambiente.md#como-cadastrar-no-eas-passo-a-passo)).
O APK de staging e o de produção podem ficar no mesmo celular? Não: os dois
usam o mesmo pacote `com.trajetto.fleetmanager`, então um substitui o outro.
Use um aparelho de teste para staging.

O EAS só oferece os ambientes `development`, `preview` e `production` no
plano da conta (ambiente personalizado, como `staging`, não existe). Por isso
o perfil e o canal `staging` usam as variáveis do ambiente **`preview`**
(`eas.json` e o `eas update` do `deploy.yml`). O perfil `preview` usa o mesmo
ambiente: os dois apontam para a stack de staging.

## Pipeline

Três workflows em `.github/workflows/`, todos com actions fixadas por SHA
(Dependabot as atualiza), `permissions: contents: read` por padrão e Node 22.

### `ci.yml` — a validação

| Gatilho             | Quando                                                                     |
| ------------------- | -------------------------------------------------------------------------- |
| `push`              | qualquer branch exceto `staging`, `main` e `master` (branches de trabalho) |
| `pull_request`      | PR para `staging`, `main` ou `master`                                      |
| `workflow_call`     | chamado pelo `deploy.yml` antes de qualquer publicação                     |
| `workflow_dispatch` | manual                                                                     |

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

| Job                | Quando                           | O que faz                                                                                                                                                                                                                                                                                                           |
| ------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checks`           | todo gatilho                     | chama o `ci.yml` inteiro; nada abaixo roda sem ele                                                                                                                                                                                                                                                                  |
| `plan`             | push                             | classifica o diff desde o **último release verde desta branch** (ou, sem ele, desde o push anterior): `app` (algo além de docs/testes/CI/E2E) e `native` (algo que muda o runtime)                                                                                                                                  |
| `staging-evidence` | push em `main`                   | acha o commit de staging (2º pai do merge ou o próprio commit) e exige uma execução verde deste workflow em `staging` para ele; num merge commit, exige também que a árvore do merge seja idêntica à do commit de staging (`git diff --quiet HEAD^2 HEAD`); senão falha com a explicação                            |
| `staging`          | push em `staging` com `app=true` | environment `staging` do GitHub: OTA no canal `staging` com as variáveis do ambiente EAS `preview`; build `staging` (APK, `--no-wait`) se `native=true`                                                                                                                                                             |
| `production`       | push em `main` com `app=true`    | ambiente `production` (espera aprovação): OTA **assinada** no canal `production`; build `production` (AAB, `--no-wait`) se `native=true`, com auto-submit à trilha internal quando `PLAY_SUBMIT_ENABLED=true` (`--auto-submit-with-profile production`; não combinar com `--auto-submit`, as duas flags se excluem) |
| `manual-build`     | `workflow_dispatch`              | build do perfil escolhido (development, staging, production) depois do CI; produção usa o ambiente `production`                                                                                                                                                                                            |

Comportamento sem configuração: sem `EXPO_TOKEN`, os jobs `staging` e
`production` terminam verdes com um aviso ("EXPO_TOKEN ausente: nada foi
publicado no EAS"). Assim o pipeline funciona antes de o robot user existir.
O build manual falha explicitamente sem o token.

Regras de assinatura no CI:

| Situação                                   | Staging                        | Produção                                               |
| ------------------------------------------ | ------------------------------ | ------------------------------------------------------ |
| `EXPO_UPDATE_PRIVATE_KEY` no ambiente      | OTA assinada                   | OTA assinada (se `certs/certificate.pem` existe)       |
| certificado no repo, sem chave no ambiente | OTA pulada com aviso           | OTA pulada com aviso                                   |
| sem certificado no repo                    | OTA sem assinatura (com aviso) | **OTA pulada** (produção nunca publica sem assinatura) |

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

| Nome                      | Onde                                              | Obrigatório                    |
| ------------------------- | ------------------------------------------------- | ------------------------------ |
| `EXPO_TOKEN`              | secret do repositório (ou dos ambientes)          | para publicar                  |
| `EXPO_UPDATE_PRIVATE_KEY` | secret dos **ambientes** `staging` e `production` | para OTA assinada pelo CI      |
| `API_REPO_READ_TOKEN`     | secret do repositório                             | não (testes de paridade)       |
| `PLAY_SUBMIT_ENABLED`     | variável do repositório                           | não (padrão: não envia à loja) |

Não há webhook de Dokploy neste repositório: o app não é hospedado lá.

## Proteção das branches e dos ambientes no GitHub

Configure em Settings do repositório `trajetto-mobile`:

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
3. **Actions → General**: "Workflow permissions" em _Read repository
   contents_; os jobs pedem só o que precisam (`actions: read` na prova de
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
6. **Definir `APP_ENV`** nos ambientes EAS `preview` e `production`, para a checagem de HTTPS rodar também no `eas update`.
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
   ambientes EAS `preview` e `production`
   ([passo a passo](./variaveis-de-ambiente.md#como-cadastrar-no-eas-passo-a-passo)).
   Um build de release sem ela para no worker do EAS.
3. Guarde a mesma cópia na raiz local (gitignored; o `.easignore` deixa ir no
   `eas build` local). O arquivo fica fora do runtime (fingerprint), pelo
   `.fingerprintignore`: o CI não tem a cópia, o EAS tem, e com o arquivo no
   cálculo o build falhava com "Runtime version mismatch". Trocar de projeto
   Firebase pede um build novo.
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

## Tamanho do app

O que se sabe do tamanho do app, medido num artefato real, e o que ainda
falta medir. Nenhum número desta seção é promessa: uma redução só vale depois
de um build comparável medido e de um teste no aparelho.

### O artefato medido

|                    |                                                                                                                                                                                                                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arquivo            | `application-ef6c2390-dc17-4e38-8379-f44a070015db.apk`, baixado do expo.dev em 27/10/2026 (build id `ef6c2390-dc17-4e38-8379-f44a070015db`)                                                                                                                                                                             |
| Tipo               | APK **release** universal do perfil `staging`, com duas ABIs (`arm64-v8a` e `armeabi-v7a`). **Não** é o dev client                                                                                                                                                                                                      |
| Tamanho do arquivo | **75.133.771 bytes** = 75,1 MB (71,7 MiB)                                                                                                                                                                                                                                                                               |
| Como se sabe       | o manifesto traz `{"expo-channel-name":"staging"}` e nenhuma `DevLauncherActivity`; os recursos foram renomeados pelo R8 (`res/CU.ttf`…), sinal do `shrinkResources`; `assets/index.android.bundle` começa com o número mágico do bytecode do Hermes (`c6 1f bc 03 c1 03 19 1f`); `lib/` só tem as duas ABIs de celular |
| Configuração       | `eas.json`: `staging` herda o `preview` (`buildType: apk`, sem `developmentClient`), então o EAS roda `assembleRelease`; `app.json`: Hermes, nova arquitetura, `enableMinifyInReleaseBuilds` e `enableShrinkResourcesInReleaseBuilds`; `plugins/with-preview-abis.js` deixa só as ABIs de celular                       |
| De onde veio       | `deploy.yml`, job de staging: `eas build --platform android --profile staging` quando o lado nativo muda                                                                                                                                                                                                                |

### De onde vem o "~96 MB"

O arquivo tem 75,1 MB. O número de ~96 MB provavelmente é o **tamanho
instalado**, o "Tamanho do app" de Configurações → Apps → Trajetto →
Armazenamento. Ele soma o APK inteiro (as bibliotecas nativas ficam dentro
dele, sem extrair, porque estão guardadas sem compressão) e o que o ART gera
na instalação: o `.vdex`, com o dex descomprimido (15,1 MB), e o `.odex` e o
`.art` compilados a partir do perfil `assets/dexopt/baseline.prof`. A conta
75,1 + ~15,1 + alguns MB dá 93 a 96 MB. Um APK com as quatro ABIs não
explicaria o número: só as bibliotecas x86_64 somariam cerca de 34 MB.

**Não confirmado.** Para confirmar, com o APK instalado num celular e a
depuração USB ligada:

```bash
# 1. Onde o pacote está instalado
adb shell pm path com.trajetto.fleetmanager
#    package:/data/app/~~<id>==/com.trajetto.fleetmanager-<id>==/base.apk

# 2. O APK e os artefatos do ART, no diretório da linha anterior
adb shell ls -lR /data/app/~~<id>==/com.trajetto.fleetmanager-<id>==/
#    base.apk (75.133.771 bytes, se for o mesmo build) e oat/arm64/base.vdex,
#    base.odex e base.art. Se a listagem for negada, pergunte pelos nomes:
adb shell stat -c '%s %n' <dir>/base.apk <dir>/oat/arm64/base.vdex <dir>/oat/arm64/base.odex

# 3. O número que a tela de Armazenamento mostra
adb shell dumpsys diskstats
#    "Package Names" e "App Sizes" são listas na mesma ordem: ache a posição de
#    com.trajetto.fleetmanager na primeira e leia a mesma posição na segunda.
#    O Android recalcula essas listas de tempos em tempos; confira com a tela.
```

Se `base.apk` + `base.vdex` + `base.odex` + `base.art` baterem com o "Tamanho
do app", a hipótese está confirmada; registre os números aqui. Se o 96 MB veio
de outro lugar (outro build, outro aparelho), anote o build id e meça de novo.
Sem login no EAS, a lista dos builds não foi consultada nesta medição:
`npx eas-cli build:list --platform android --limit 5` e
`npx eas-cli build:view <build id>` mostram perfil e artefato de cada um.

### Composição medida

Do APK de staging acima, medido com `zipinfo` em 28/10/2026, em bytes dentro
do arquivo. Os tamanhos das bibliotecas do ML Kit, dos modelos de código de
barras e dos recursos do Picnic também batem com os AARs e o JAR de origem no
cache do Gradle.

| Parte                                                         | No APK         | Observação                                                                                                                                                      |
| ------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/arm64-v8a/` (24 `.so`)                                   | 34.194.200     | guardadas sem compressão (padrão do Expo). As maiores: `libmlkit_google_ocr_pipeline.so` 11,06 MB, `libreactnative.so` 5,88 MB, `libbarhopper_v3.so` 4,95 MB    |
| `lib/armeabi-v7a/` (24 `.so`)                                 | 22.527.396     | as mesmas: 6,78 MB, 4,17 MB e 3,24 MB                                                                                                                           |
| `classes*.dex` (3 arquivos, depois do R8)                     | 6.247.992      | 15.098.940 descomprimidos                                                                                                                                       |
| `assets/index.android.bundle` (bytecode do Hermes)            | 4.456.000      | guardado sem compressão, para ser mapeado direto na memória (comprimido daria ~2,03 MB)                                                                         |
| `resources.arsc`                                              | 1.800.304      | guardado sem compressão                                                                                                                                         |
| o resto: `res/`, outros `assets/`, `META-INF/`, recursos Java | 5.357.923      | por diferença. Inclui os modelos de código de barras (880.888), o BouncyCastle `pqc` (1.214.815) e quatro fontes Inter (669.808), descritos nas reduções abaixo |
| **soma das entradas**                                         | **74.583.815** | 1.620 entradas; 85.231.921 descomprimidas                                                                                                                       |
| arquivo                                                       | 75.133.771     | as entradas mais o diretório do zip e o bloco de assinatura                                                                                                     |

- As bibliotecas nativas são 76% do conteúdo do APK (56,7 de 74,6 MB).
- O OCR do ML Kit embutido (17,8 MB de `.so` nas duas ABIs, mais os modelos)
  é decisão de produto: a pré-checagem funciona sem rede (decisão 14.2,
  [ADR 0010](https://github.com/Trajetto-Organization/trajetto-api/blob/staging/docs/adr/0010-ia-local.md);
  ver [arquitetura.md](./arquitetura.md#tamanho-do-binário)). Fica.
- Já está no lugar: Hermes, nova arquitetura, R8, `shrinkResources`, filtro de
  ABI nos APKs, AAB na produção, assets do repositório pequenos (280 KB) e o
  `app-dependencies.test.ts`, que exige um motivo para cada dependência.

### Que artefato comparar com qual

| Artefato               | Perfil                        | Como sai                                                                          | O que leva                                                                   | Tamanho                                  |
| ---------------------- | ----------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------- |
| APK de desenvolvimento | `development`                 | `npm run build:development`                                                       | dev client, build debug, quatro ABIs, sem R8; o JS vem do Metro              | não medido; não se compara com os outros |
| APK de staging         | `staging` (herda o `preview`) | `deploy.yml` num push em `staging` com mudança nativa, ou `npm run build:staging` | release, duas ABIs, R8, Hermes                                               | **75,1 MB** (build `ef6c2390-…`)         |
| AAB de produção        | `production`                  | `deploy.yml` em `main`, depois da aprovação do ambiente `production`              | release, quatro ABIs; a Play entrega a cada aparelho só o que serve para ele | não medido; estimativa abaixo            |

Compare sempre artefatos do mesmo tipo e do mesmo perfil, e anote o build id
de cada medição.

### Estimativa por ABI do AAB de produção

Contas feitas sobre a composição acima; **nenhum AAB foi gerado nem medido**.

| Celular       | Download pela Play | Instalado, sem o ART | De onde sai a conta                                                                                                                                                                                                     |
| ------------- | ------------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `arm64-v8a`   | ≈ 25 a 27 MB       | ≈ 52,6 MB            | instalado: o APK de staging sem as `.so` de armeabi-v7a (75,13 − 22,53). Download: os 34,19 MB de `.so` de arm64 chegam comprimidos (≈ 12,59 MB), somados aos 17,86 MB que não são `.so`, também comprimidos na entrega |
| `armeabi-v7a` | ≈ 23 a 25 MB       | ≈ 40,9 MB            | instalado: 75,13 − 34,19. Download: 22,53 MB de `.so` viram ≈ 10,55 MB, mais o mesmo resto                                                                                                                              |

Com os artefatos do ART, o "Tamanho do app" num celular arm64 instalado pela
Play deve ficar na casa de 70 MB, e não nos ~96 MB do APK universal de
staging. Também é estimativa. Para medir de verdade, baixe o AAB do build de
produção no expo.dev e rode:

```bash
bundletool build-apks --bundle=app.aab --output=app.apks
bundletool get-size total --apks=app.apks --dimensions=ABI
```

### Reduções possíveis

Nenhuma das duas foi aplicada nesta rodada: as duas mudam o binário e
precisam de build e de teste no aparelho antes de entrar.

#### 1. O dev client fora dos builds de release (~9,7 MB no APK de staging)

O `expo-dev-client` está nas dependências por causa do perfil `development`
(o `app-dependencies.test.ts` registra esse motivo), e o autolinking do Expo
liga os módulos dele em **todo** build, de qualquer perfil. Ele percorre
`dependencies` e `devDependencies`, então mover o pacote para
`devDependencies` não resolve. No release o launcher fica inativo, mas o peso
nativo vai junto:

| Item no APK de staging                     | Bytes                            | Origem                                                                                                                                                |
| ------------------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/arm64-v8a/libbarhopper_v3.so`         | 4.946.720                        | ML Kit `barcode-scanning:17.3.0`, declarado como `implementation` no `android/build.gradle` do `expo-dev-launcher`; só o leitor de QR do launcher usa |
| `lib/armeabi-v7a/libbarhopper_v3.so`       | 3.244.440                        | idem                                                                                                                                                  |
| `assets/mlkit_barcode_models/` (3 modelos) | 880.888                          | idem                                                                                                                                                  |
| 4 fontes Inter em `res/`                   | 669.808                          | `expo-dev-menu/android/src/main/res/font/inter_*.ttf`                                                                                                 |
| **total**                                  | **9.741.856** (≈ 13% do arquivo) | mais uma parte do dex, não medida                                                                                                                     |

O R8 e o `shrinkResources` não tiram `.so` de `lib/` nem `assets/` de uma
AAR, e o manifesto do release ainda registra a
`GmsBarcodeScanningDelegateActivity` do leitor.

**Plano:**

1. Um config plugin `plugins/with-release-autolinking-exclude.js`, no molde do
   `plugins/with-preview-abis.js`:
   - uma função pura `excludedModulesFor(profile)` que devolve
     `["expo-dev-client", "expo-dev-launcher", "expo-dev-menu", "expo-dev-menu-interface"]`
     para `preview`, `staging` e `production`, e `null` para `development`,
     para o perfil ausente e para o build local do E2E
     (`scripts/e2e/build-apk.sh` roda `assembleDebug` e precisa do dev
     client);
   - uma função pura `withExclude(settingsGradle, modules)` que escreve
     `expoAutolinking.exclude = [...]` logo antes de
     `expoAutolinking.useExpoModules()` no `settings.gradle` gerado. A
     propriedade existe no `expo-modules-autolinking` 3.0.27
     (`ExpoAutolinkingSettingsExtension.kt`). A função é idempotente (a linha
     inserida é marcada) e falha se a âncora sumir, para uma mudança do
     template do Expo falhar alto;
   - aplicada com `withSettingsGradle`, lendo `EAS_BUILD_PROFILE`, como o
     filtro de ABIs. Ela muda só o arquivo gerado, nunca o objeto de
     configuração, para o fingerprint (o runtime) sair igual no `eas build` e
     no `eas update`, que roda sem `EAS_BUILD_PROFILE`;
   - registrada em `app.json` → `plugins`.
2. Testes unitários: `excludedModulesFor` para cada perfil; `withExclude`
   insere antes da âncora, é idempotente e falha sem ela; o plugin está no
   `app.json`; o runtime é o mesmo com e sem `EAS_BUILD_PROFILE=staging` (no
   molde do `fingerprint-firebase.test.ts`).
3. O `expo-updates` só olha o dev client para preencher
   `BuildConfig.USE_DEV_CLIENT`, que ele lê apenas com o suporte de
   desenvolvimento ligado (build debug). O release não deve mudar; o build
   confirma.

**Validação no aparelho**, antes de adotar:

- build de staging pelo pipeline (push com mudança nativa, ou o `deploy.yml`
  manual com o perfil `staging`); `unzip -l` sem `libbarhopper_v3.so`, sem
  `assets/mlkit_barcode_models/` e sem as quatro fontes Inter; manifesto sem
  a `GmsBarcodeScanningDelegateActivity`;
- no celular: login e 2FA; câmera (canhoto e odômetro); pré-checagem por OCR
  (o ML Kit de texto é outra biblioteca e precisa continuar funcionando);
  push recebido e aberto; localização durante a rota; fila offline; uma OTA
  assinada aplicada;
- o perfil `development` continua abrindo o launcher e o menu de
  desenvolvimento (`npm run build:development` ou o build local do E2E);
- os dois tamanhos registrados aqui, antes e depois, com o build id.

Ganho esperado, a confirmar: −9,7 MB no APK de staging (75,1 → ~65,4 MB). No
AAB, para arm64, cerca de 6,5 MB a menos instalado e 3 MB a menos no
download.

#### 2. Os recursos do Picnic no BouncyCastle (1,21 MB)

O `expo-updates` declara `org.bouncycastle:bcutil-jdk15to18:1.78.1`, que traz
o `bcprov`. Com ele vêm três recursos Java do esquema pós-quântico Picnic,
`org/bouncycastle/pqc/crypto/picnic/lowmcL1.bin.properties`, `lowmcL3` e
`lowmcL5`: 1.221.059 bytes descomprimidos, 1.214.815 dentro do APK. A OTA é
assinada com `rsa-v1_5-sha256` (`codeSigningMetadata` no `app.config.js`),
que não usa Picnic, e o R8 não remove recursos Java.

**Plano:** em `app.json` → `expo-build-properties` → `android`, acrescentar
`"packagingOptions": { "exclude": ["org/bouncycastle/pqc/crypto/picnic/**"] }`.
O `expo-build-properties` 1.0.10 repassa a lista para
`android.packagingOptions.excludes`. Só esse caminho: nada além disso no
BouncyCastle. Um teste em `app-config-release.test.ts` fixa o padrão.

**Validação no aparelho:** build com a exclusão; `unzip -l` sem
`org/bouncycastle/pqc/crypto/picnic/`; publicar uma OTA **assinada** no canal
`staging` e ver o celular aplicá-la, porque a assinatura da OTA é conferida
no aparelho. Se a OTA não aplicar, desfaça a exclusão.

Ganho esperado, a confirmar: cerca de 1,2 MB no APK e no AAB.

### Comprimir as bibliotecas nativas: troca, não ganho

Hoje as `.so` ficam guardadas sem compressão (`useLegacyPackaging=false`,
padrão do template do Expo) e o Android as carrega direto do APK, sem
extrair. Com `expo-build-properties` → `android.useLegacyPackaging: true`:

- o arquivo do APK de staging cairia cerca de 33,6 MB: os 56,7 MB de `.so`
  viram ~23,1 MB com deflate nível 6 (as de arm64 ficam com 37% do tamanho,
  as de armeabi-v7a com 47%);
- mas na instalação o Android extrai as `.so` da ABI do celular para o disco.
  Num celular arm64, o APK instalado fica ~33,6 MB menor e o disco ganha
  34,2 MB de `.so` extraídas: o espaço instalado fica igual ou maior, e a
  instalação demora mais;
- na Play não há ganho de download, porque a loja já comprime o que entrega
  e recomenda bibliotecas sem compressão no AAB;
- o APK de staging passaria a ser empacotado de um jeito diferente do de
  produção.

**Recomendação:** manter como está. Só considerar a compressão para o APK de
staging se o tamanho do download instalado à mão virar um problema medido,
e registrar aqui que staging e produção passaram a ser empacotados de forma
diferente. Pelo mesmo motivo, o bundle do Hermes continua sem compressão
(`enableBundleCompression` desligado): comprimir economizaria ~2,4 MB e
custaria tempo de abertura.

### Como medir de novo

```bash
# Tamanho e composição de um APK (somente leitura)
ls -l app.apk                         # tamanho do arquivo
zipinfo -t app.apk                    # entradas e totais
unzip -l app.apk 'lib/*'              # bibliotecas nativas por ABI
unzip -p app.apk assets/index.android.bundle | head -c 8 | od -An -tx1
#   c6 1f bc 03 c1 03 19 1f = bytecode do Hermes
```

Registre em cada medição: tipo do artefato, perfil, build id, tamanho do
arquivo, download e instalado por ABI (quando for AAB) e o método.

## Localização em segundo plano

O rastreamento com a tela desligada está pronto e **desligado** (decisão 7.3).
Para ligar:

1. No Play Console, preencha a **declaração de localização em segundo plano**
   (por que o app precisa, o que o usuário ganha) com o **vídeo** mostrando o
   aviso dentro do app e o uso durante a rota.
2. Aguarde a aprovação do Google.
3. Defina `EXPO_PUBLIC_BACKGROUND_TRACKING=true` no ambiente EAS `production`
   (e no `preview`, o ambiente do staging, para homologar antes).
4. Gere **binários novos** (a chave muda o manifesto; OTA não leva).
5. No web, defina `BACKGROUND_TRACKING` conforme o `trajetto-ui` documenta,
   para a torre parar de avisar que só vê quem está com o app aberto.

Publicar `ACCESS_BACKGROUND_LOCATION` sem a declaração aprovada pode tirar o
app da loja.

## Rollback

| Problema                                                 | Como voltar                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OTA ruim                                                 | Actions → **OTA rollback** → canal e ID de um grupo anterior bom (`eas update:list --branch production` ou expo.dev → Updates). Republica aquele grupo como o mais novo; os aparelhos aplicam na próxima abertura. O canal escolhido precisa ser o do grupo (o workflow confere e recusa se não for)                                                                                                                                             |
| OTA ruim e o workflow não consegue ler a branch do grupo | o passo de conferência falha fechado (não republica). Fallback manual, numa máquina com a chave privada: `eas update:view <id>` para conferir a branch do grupo e, sendo a certa, `eas update:republish --group <id> --message "rollback" --private-key-path <caminho da private-key.pem>` (sem `--private-key-path` se não houver `certs/certificate.pem`). Depois corrija o `jq` do `ota-rollback.yml` para o formato que o `eas-cli` devolver |
| OTA ruim, voltar ao JS embutido                          | manual: `eas update:roll-back-to-embedded --branch production --runtime-version <runtime> --message "…"` (com `--private-key-path` se houver certificado)                                                                                                                                                                                                                                                                                        |
| Binário ruim na trilha internal/fechada                  | Play Console: não promova; envie um build novo                                                                                                                                                                                                                                                                                                                                                                                                   |
| Binário ruim em produção                                 | Play Console: **interromper o lançamento gradual**; corrija com OTA se o defeito for de JS, ou publique um binário novo (não dá para "desinstalar" uma versão)                                                                                                                                                                                                                                                                                   |
| Build de staging ruim                                    | gere outro (`npm run build:staging`) e reinstale o APK                                                                                                                                                                                                                                                                                                                                                                                           |

O rollback da API não desfaz o app: se a API voltar para uma versão que não
entende o contrato atual do app, a fila guarda os envios recusados por
contrato e os reenvia depois da atualização, mas evite voltar a API para antes
de um contrato que o app já usa.

## Checklist do primeiro release

Contas e acessos:

- [ ] Projeto no expo.dev acessível; `eas-cli@21.7.0`; `eas login`.
- [ ] Variáveis de staging cadastradas no ambiente EAS `preview` (o EAS não
      tem ambiente `staging`; o perfil `staging` lê o `preview`).
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

| Sintoma                                                        | Causa provável                                                                                                                                                                                                | O que fazer                                                                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `staging-evidence` falha em `main`                             | o commit não passou por `staging`, a execução de staging não terminou, o merge foi squash ou rebase do GitHub, ou a árvore do merge difere da de `staging` (mudança só em `main` ou conflito resolvido no PR) | publique em `staging`, espere verde e faça merge commit; leve para `staging` (por PR) o que estiver só em `main` e repita o release |
| Job de staging/produção verde sem publicar nada                | `EXPO_TOKEN` ausente, ou só docs/testes mudaram                                                                                                                                                               | veja os avisos (notice) do job                                                                                                      |
| "OTA de produção pulada"                                       | falta `certs/certificate.pem` ou `EXPO_UPDATE_PRIVATE_KEY` no ambiente                                                                                                                                        | siga [OTA assinada](#ota-assinada-code-signing) ou publique à mão                                                                   |
| "precisa do google-services.json"                              | falta `GOOGLE_SERVICES_JSON` no ambiente EAS do perfil                                                                                                                                                        | cadastre a variável de arquivo                                                                                                      |
| "exige EXPO_PUBLIC_API_URL com HTTPS" / "não aceita API local" | URL do ambiente EAS não é pública ou não usa HTTPS                                                                                                                                                            | corrija a variável do ambiente                                                                                                      |
| Build de release diz "API inacessível" no aparelho             | URL insegura embutida                                                                                                                                                                                         | idem; gere build/OTA de novo                                                                                                        |
| OTA não chega ao aparelho                                      | runtime diferente (código nativo mudou, ou `google-services.json` diferente entre `eas update` e build)                                                                                                       | gere build novo; mantenha os arquivos iguais                                                                                        |
| OTA recusada sem erro visível                                  | binário com certificado e OTA sem assinatura (ou outra chave)                                                                                                                                                 | publique assinada com a chave certa                                                                                                 |
| Build falha no EAS                                             | credenciais, `projectId`, dependência                                                                                                                                                                         | veja o log em expo.dev; confira `EXPO_TOKEN` e `extra.eas.projectId`                                                                |
| Tela de atualização obrigatória para todos                     | `MIN_MOBILE_CONTRACT` acima do contrato publicado                                                                                                                                                             | publique a OTA com o contrato novo ou baixe o mínimo na API                                                                         |

## Os três repositórios juntos

> Esta seção é **a mesma** nos três manuais de deploy:
> [`trajetto-api/docs/deploy.md`](https://github.com/Trajetto-Organization/trajetto-api/blob/main/docs/deploy.md),
> [`trajetto-ui/docs/deploy.md`](https://github.com/Trajetto-Organization/trajetto-ui/blob/main/docs/deploy.md)
> e
> [`trajetto-mobile/docs/deploy.md`](https://github.com/Trajetto-Organization/trajetto-mobile/blob/main/docs/deploy.md).
> Mudou aqui, mude nos outros dois. O detalhe de cada passo fica no manual do
> repositório dono dele. O que foi configurado à mão nos painéis (Contabo,
> Dokploy, Cloudflare, GitHub, Expo, Resend e R2), os tokens e o porquê de cada
> escolha ficam em
> [`trajetto-api/docs/infraestrutura.md`](https://github.com/Trajetto-Organization/trajetto-api/blob/staging/docs/infraestrutura.md).

### Quem é quem

|                             | API (`Trajetto-Organization/trajetto-api`)                                                                                                                                                                                                                                                                                                   | Web (`Trajetto-Organization/trajetto-ui`)                                                                                                                                                                       | App (`Trajetto-Organization/trajetto-mobile`)                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Artefato                    | imagens `trajetto-api` e `trajetto-ai` em `ghcr.io/trajetto-organization/`                                                                                                                                                                                                                                                                   | imagem `ghcr.io/trajetto-organization/trajetto-ui`                                                                                                                                                              | APK/AAB (EAS Build) e OTA (EAS Update)                                                                          |
| Onde roda                   | Dokploy, projeto `trajetto-api` de cada environment (`staging` e `production`): as Applications `trajetto-api` (2 réplicas, com domínio) e `trajetto-ai` (sem domínio), puxando as imagens do GHCR, e os Databases PostgreSQL (com o backup diário do próprio Dokploy para o Cloudflare R2) e Redis                                          | Dokploy, projeto `trajetto-ui` de cada environment: a Application `trajetto-ui`, puxando a imagem do GHCR                                                                                                       | no celular do motorista (APK interno em staging, Play Store em produção)                                        |
| Nome no Dokploy / EAS       | App Names `trajetto-api-staging` e `trajetto-api-production` (e `trajetto-ai-*`, `trajetto-postgres-*`, `trajetto-redis-*`)                                                                                                                                                                                                                  | Application `trajetto-ui` no projeto `trajetto-ui` de cada environment (App Names `trajetto-ui-staging` e `trajetto-ui-production`)                                                                             | perfis, ambientes e canais `staging` e `production`                                                             |
| Como o pipeline publica     | API do Dokploy (`.github/scripts/dokploy-deploy.mjs`): `application.deploy` de cada Application, na ordem IA → API, a IA só quando o digest muda, acompanhando cada deployment até o fim e disparando de novo, até 6 vezes e com espera crescente, o que termina em erro; depois espera a `/health/liveness` pública responder o commit novo | API do Dokploy com o **mesmo** `.github/scripts/dokploy-deploy.mjs` (cópia comparada por teste): `application.deploy` da Application `trajetto-ui`, acompanhando o deployment, depois espera o `/build-id.json` | `eas update` e `eas build`                                                                                      |
| Secrets de deploy no GitHub | environments `staging` e `production`: `DOKPLOY_URL`, `DOKPLOY_API_KEY`, `DOKPLOY_API_APPLICATION_ID` (obrigatórios) e `DOKPLOY_AI_APPLICATION_ID` (opcional); variáveis `API_PUBLIC_URL` (a conferência pela liveness) e `SWARM_API_SERVICE` (a conferência por SSH)                                                                        | environments `staging` e `production`: `DOKPLOY_URL`, `DOKPLOY_API_KEY` e `DOKPLOY_UI_APPLICATION_ID`                                                                                                           | `EXPO_TOKEN` (repositório) e `EXPO_UPDATE_PRIVATE_KEY` (environments `staging` e `production`)                  |
| Sem os secrets              | move as tags e pula o deploy com `::notice::`                                                                                                                                                                                                                                                                                                | move as tags e pula o deploy com aviso                                                                                                                                                                          | termina verde com aviso, sem publicar                                                                           |
| De staging para produção    | promove por digest a imagem `sha-<7 do commit>` (tag `staging` → `stable`), sem rebuild, e exige o marcador `staged-<7 do commit>` no mesmo digest                                                                                                                                                                                           | igual à API, e exige o marcador `staged-<7 do commit>` no mesmo digest                                                                                                                                          | promove o **commit** verde em staging (a URL da API é embutida no build, então o artefato não pode ser o mesmo) |
| Rollback                    | _Run workflow_ do `deploy.yml` com `image_tag=sha-<7>`                                                                                                                                                                                                                                                                                       | _Run workflow_ do `deploy.yml` com `image_tag=sha-<7>`                                                                                                                                                          | `ota-rollback.yml` (republica um grupo de OTA)                                                                  |

Regras comuns aos três: a branch `staging` recebe o trabalho (push direto do
dono ou merge de PR) e todo push nela roda a validação completa e publica o
staging; `main` só recebe PR **de `staging`**, com **merge commit** (squash e
rebase criam um commit que o staging nunca validou, e a promoção recusa); o
environment `production` do GitHub tem **Required reviewers** e
_Deployment branches_ restrito a `main`, então nada chega à produção sem
aprovação. No Dokploy, as imagens privadas do GHCR são puxadas com um token
_classic_ `read:packages`, informado no provider Docker de cada Application.

### Endereços

|                        | Staging                                                                           | Produção                                                           |
| ---------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Web                    | `https://staging.intrajetto.com`                                                  | `https://www.intrajetto.com` (o apex `intrajetto.com` redireciona) |
| API (REST e Socket.IO) | `https://api-staging.intrajetto.com`                                              | a definir, ex. `https://api.intrajetto.com`                        |
| Serviço de IA          | sem endereço público: `http://trajetto-ai-staging:8080` na rede `dokploy-network` | sem endereço público: `http://trajetto-ai-production:8080`         |

### O que precisa casar entre os repositórios

| Valor                             | API (Environment das Applications do projeto `trajetto-api`)                                                                                    | Web (Environment da Application)                                                         | App (ambiente EAS)                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| URL pública da API                | o host na aba _Domains_ da Application `trajetto-api` e `API_HTTP_REQUEST` (a URL; dela sai o logo dos e-mails)                                 | `HTTP_REQUEST` (chamadas do servidor da web) e `PUBLIC_API_URL` (chamadas do navegador)  | `EXPO_PUBLIC_API_URL`                                                                 |
| Socket.IO                         | o mesmo host da API, com WebSocket liberado na borda                                                                                            | `PUBLIC_API_URL` (o socket roda na própria API; não há variável própria)                 | o socket usa `EXPO_PUBLIC_API_URL`                                                    |
| Origem da web                     | `HTTP_REQUEST` = a origem da web do ambiente (única origem do CORS e do Socket.IO, base dos links)                                              | `METADATA_BASE`                                                                          | `EXPO_PUBLIC_WEB_APPLICATION_URL` (links de Privacidade e Termos)                     |
| Limite de tentativas por IP       | `RATE_LIMIT_FORWARDER_SECRET`                                                                                                                   | `RATE_LIMIT_FORWARDER_SECRET`, **o mesmo valor**                                         | —                                                                                     |
| Captcha (Turnstile)               | `TURNSTILE_SECRET_KEY` (o mesmo widget da web; definida, exige o token)                                                                         | `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY`                                            | —                                                                                     |
| Fotos no R2                       | `R2_*` (um bucket por ambiente)                                                                                                                 | `CSP_STORAGE_ORIGINS` libera a origem do bucket; o CORS do bucket libera a origem da web | envia direto à URL pré-assinada que a API devolve (sem configuração)                  |
| IA (leitura de fotos)             | `AI_LOCAL_TOKEN` na `trajetto-api` = `AI_TOKEN` na `trajetto-ai` (o mesmo valor, um por ambiente) e `AI_LOCAL_URL=http://<App Name da IA>:8080` | nenhuma variável: a IA chega pela API                                                    | nenhuma variável                                                                      |
| Push (FCM)                        | nenhuma: a API chama a Expo Push API                                                                                                            | —                                                                                        | `GOOGLE_SERVICES_JSON` (arquivo secreto no EAS) e a chave FCM V1 em `eas credentials` |
| Rastreamento em segundo plano     | —                                                                                                                                               | `BACKGROUND_TRACKING`                                                                    | `EXPO_PUBLIC_BACKGROUND_TRACKING` (as duas ligam juntas)                              |
| Versão do app                     | `MIN_MOBILE_CONTRACT` e `MOBILE_STORE_URL`                                                                                                      | —                                                                                        | `CLIENT_CONTRACT` em `utils/client-version.ts`                                        |
| Gate de rotas da web              | `/docs/json` com `DOCS_USER` e `DOCS_PASSWORD`                                                                                                  | secrets `API_DOCS_URL`, `DOCS_USER`, `DOCS_PASSWORD` no environment `production`         | —                                                                                     |
| Checkout entre repositórios no CI | `CLIENT_REPOS_READ_TOKEN` (lê a web e o app)                                                                                                    | `API_REPO_READ_TOKEN` (lê a API)                                                         | `API_REPO_READ_TOKEN` (lê a API)                                                      |

Segredos nunca são compartilhados entre staging e produção. Cada variável
está detalhada no `docs/variaveis-de-ambiente.md` do repositório que a lê.

### Ordem do primeiro deploy

1. **GitHub, nos três repositórios:** branch `staging` criada a partir de
   `main`; environments `staging` e `production` (este com revisores e só a
   branch `main`); só merge commit habilitado; proteção de `main`. Um
   primeiro push em `staging` em cada repositório: a API e a web publicam
   `sha-<7>` no GHCR e pulam o deploy; o app pula o EAS até o `EXPO_TOKEN`
   existir.
2. **Servidor:** VPS com Dokploy, rotação de log no `/etc/docker/daemon.json`,
   Traefik ajustado com `trajetto-api/infra/traefik/`, DNS na Cloudflare (Full
   strict) para os hosts da web e da API, e um token _classic_
   `read:packages` do GHCR (o mesmo serve para as três imagens: API, IA e web).
3. **Contas externas:** buckets R2 de fotos (um por ambiente, CORS com a
   origem da web) e de backup do banco (`trajetto-backups`, com um prefixo
   por ambiente; recomendado um bucket próprio para produção,
   `trajetto-backups-prod`), widgets do Turnstile por ambiente, Meta e
   Resend (de teste em staging), heartbeats de monitoramento.
4. **API de staging** (manual da API), no projeto `trajetto-api` do
   environment `staging`, nesta ordem e conferindo cada um: Databases
   **PostgreSQL** e **Redis**; Application **`trajetto-ai`** (com o
   `AI_TOKEN`); Application **`trajetto-api`** (com `AI_LOCAL_TOKEN` igual,
   `AI_LOCAL_URL` apontando para a IA e as URLs do banco e do Redis); o
   **backup** na aba _Backups_ do Database PostgreSQL (destino S3 no R2,
   diário). Confira `/health/readiness` e, como
   MASTER na web, _Sistema → Provedores_. Depois, os secrets `DOKPLOY_*` e a
   variável `API_PUBLIC_URL` no environment `staging` da API.
5. **Web de staging** (Application `trajetto-ui` do projeto `trajetto-ui` no
   environment `staging`, manual da web): imagem
   `:staging`, `HTTP_REQUEST` e `PUBLIC_API_URL` apontando para a API de
   staging, o mesmo `RATE_LIMIT_FORWARDER_SECRET` da API de staging, e o
   `HTTP_REQUEST` da API de staging igual à origem da web de staging. Depois,
   `DOKPLOY_URL`, `DOKPLOY_API_KEY` (a mesma chave da API serve),
   `DOKPLOY_UI_APPLICATION_ID` e `METADATA_BASE_STAGING` no environment
   `staging` da web.
6. **App de staging** (manual do app): ambiente EAS `preview` (o EAS não
   tem ambiente `staging`; o perfil `staging` lê o `preview`) com
   `EXPO_PUBLIC_API_URL` = API de staging e
   `EXPO_PUBLIC_WEB_APPLICATION_URL` = web de staging; `EXPO_TOKEN` no
   GitHub; um push em `staging` gera o APK de staging.
7. **Produção, na mesma ordem:** a tag `stable` da API criada antes (_Run
   workflow_ do `deploy.yml` da API com `image_tag=sha-<7>`, enquanto o
   environment `production` ainda não tem os secrets do Dokploy); as mesmas
   peças (Databases com o backup, IA e API) no projeto `trajetto-api` do
   environment `production`, já em `:stable`; os secrets de produção e o PR `staging → main` da API; depois a
   Application `trajetto-ui` do environment `production` e o PR da web; por último o PR do
   app, que gera o AAB de produção apontando para a API de produção.

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
