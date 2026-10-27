# Variáveis de ambiente do app do motorista

Todas as variáveis, secrets e credenciais que o `trajetto-mobile` usa: para
que servem, se são obrigatórias, o formato, o valor em cada ambiente, se são
secretas e **onde** configurar. Nenhum valor secreto aparece aqui, só nomes e
como gerar.

## Sumário

- [Como o app recebe configuração](#como-o-app-recebe-configuração)
- [Onde cada coisa é configurada](#onde-cada-coisa-é-configurada)
- [Variáveis do app (`EXPO_PUBLIC_*`)](#variáveis-do-app-expo_public_)
- [Variáveis de build (EAS)](#variáveis-de-build-eas)
- [Matriz por ambiente](#matriz-por-ambiente)
- [GitHub Actions](#github-actions)
- [Credenciais do EAS (não são variáveis)](#credenciais-do-eas-não-são-variáveis)
- [Variáveis de teste](#variáveis-de-teste)
- [Variáveis de outros repositórios que afetam o app](#variáveis-de-outros-repositórios-que-afetam-o-app)
- [Dokploy](#dokploy)
- [Como cadastrar no EAS (passo a passo)](#como-cadastrar-no-eas-passo-a-passo)

## Como o app recebe configuração

- **Tudo é decidido em tempo de build.** As variáveis `EXPO_PUBLIC_*` são
  substituídas no bundle JavaScript quando o Metro empacota (no `npm start`,
  no `eas build` e no `eas update`). Não existe configuração em tempo de
  execução: um APK de staging fala com a API de staging para sempre, e mudar a
  URL exige build ou OTA novos. Por isso o app não tem o "build uma vez,
  promove por digest" das imagens da API e do web (ver
  [deploy.md](./deploy.md#por-que-o-app-não-promove-o-mesmo-artefato)).
- **`EXPO_PUBLIC_*` não é segredo.** Fica legível dentro do APK. Nunca ponha
  token, senha ou chave numa variável com esse prefixo.
- **O EAS não lê o `.env`.** O `.env` (copiado de `.env.example`) serve só
  para o Metro local (`npm start`). `eas build` e `eas update` usam as
  variáveis do **ambiente EAS** indicado no perfil do `eas.json`
  (`development`, `preview` ou `production`; o EAS não tem ambiente
  `staging`, e o perfil `staging` usa o `preview`), cadastradas em
  expo.dev ou com `eas env:create`. Copiar `.env.production` para `.env`
  antes de um build não tem efeito nenhum.
- O `app.config.js` lê as variáveis de build e **recusa** configurações
  perigosas (URL sem HTTPS em release, `google-services.json` ausente num
  build de release no worker do EAS).

## Onde cada coisa é configurada

| Lugar | O que fica lá |
| --- | --- |
| `.env` local (gitignored) | `EXPO_PUBLIC_*` para o `npm start` |
| Ambientes do EAS (expo.dev → projeto → Environment variables) | `EXPO_PUBLIC_*`, `APP_ENV` e o arquivo `GOOGLE_SERVICES_JSON`, por ambiente |
| Credenciais do EAS (`eas credentials`) | keystore Android, service account do Google Play, chave FCM V1 |
| GitHub → Settings → Secrets and variables → Actions | `EXPO_TOKEN`, `API_REPO_READ_TOKEN`, variável `PLAY_SUBMIT_ENABLED` |
| GitHub → Settings → Environments (`staging`, `production`) | secret `EXPO_UPDATE_PRIVATE_KEY` (por ambiente) e revisores obrigatórios |
| Cofre do dono (offline) | cópia da chave privada de OTA (`keys/private-key.pem`) |
| Dokploy | **nada do app** (o app não roda em servidor); só a API e o web |

## Variáveis do app (`EXPO_PUBLIC_*`)

### `EXPO_PUBLIC_API_URL`

| | |
| --- | --- |
| Para quê | Base de todas as chamadas REST e do socket.io (`utils/api.ts`, `providers/socket-provider.tsx`) |
| Obrigatória | **Sim** em todo ambiente. Sem ela o app mostra "EXPO_PUBLIC_API_URL não configurada" e o build de release para |
| Formato | URL absoluta, sem barra final (é removida), sem credenciais, query ou fragmento. Em release: **HTTPS** e host público |
| Desenvolvimento | `http://localhost:3333` (emulador: `http://10.0.2.2:3333`; aparelho físico: `http://<IP da máquina>:3333`) |
| Staging | `https://api-staging.intrajetto.com` |
| Produção | a URL pública da API de produção (a definir, ex. `https://api.intrajetto.com`) |
| Secreta | Não |
| Onde | `.env` local; ambientes EAS `development`, `preview` (staging) e `production` |

A regra de URL segura (`utils/api-url-rules.ts` e `app.config.js`) recusa em
release: `http://`, `localhost`, `10.0.2.2`, `*.local`, `*.internal`,
`*.lan`, faixas privadas (10/8, 172.16/12, 192.168/16, 100.64/10, link-local)
e IPv6 local.

### `EXPO_PUBLIC_WEB_APPLICATION_URL`

| | |
| --- | --- |
| Para quê | Endereço do painel web: botão "abrir a plataforma web" e base dos links de **Privacidade** e **Termos** (`<origem>/legal/privacidade`, `<origem>/legal/termos`), exigidos pelo Google Play num app que coleta localização |
| Obrigatória | Recomendada. Sem ela, os links legais e o botão do web não aparecem |
| Formato | URL do web; pode apontar para qualquer página (só a origem é usada nos links legais) |
| Desenvolvimento | `http://localhost:3000/login` |
| Staging | o host do web de staging, ex. `https://staging.intrajetto.com/login` |
| Produção | `https://www.intrajetto.com/login` |
| Secreta | Não |
| Onde | `.env` local; ambientes EAS |

### `EXPO_PUBLIC_BACKGROUND_TRACKING`

| | |
| --- | --- |
| Para quê | Liga o rastreamento com a tela desligada **neste build**. Com `true`, o `app.config.js` declara `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE` e `FOREGROUND_SERVICE_LOCATION` no manifesto e liga o serviço em primeiro plano do `expo-location` |
| Obrigatória | Não. Ausente = `false` |
| Formato | `true` ou `false` (qualquer outro valor conta como `false`) |
| Todos os ambientes | **`false`** (decisão 7.3) até o Google aprovar a declaração de localização em segundo plano no Play Console; depois, `true` só nos ambientes cujo build passará pela loja |
| Secreta | Não |
| Onde | `.env` local; ambientes EAS. Muda o manifesto: exige **build novo**, não chega por OTA |

Publicar `ACCESS_BACKGROUND_LOCATION` sem a declaração aprovada tira o app da
loja. O web tem a variável espelho `BACKGROUND_TRACKING` (no `trajetto-ui`)
para a torre dizer que só vê motoristas com o app aberto.

## Variáveis de build (EAS)

### `APP_ENV`

| | |
| --- | --- |
| Para quê | Nome do ambiente EAS. O `app.config.js` usa para rodar a checagem de HTTPS também no `eas update` (que não passa pelo EAS Build e não tem `EAS_BUILD_PROFILE`) |
| Obrigatória | **Sim** nos ambientes EAS `preview` e `production` |
| Valor | o próprio nome: `preview` ou `production` (em `development` pode ficar ausente: a checagem relaxa para desenvolvimento) |
| Secreta | Não |
| Onde | só nos ambientes EAS (nunca no `.env` local: ligaria a checagem de release no Metro) |

### `GOOGLE_SERVICES_JSON`

| | |
| --- | --- |
| Para quê | Configuração Android do Firebase (`google-services.json`). Sem ela o app instala, mas nunca recebe push (o token Expo depende do FCM) |
| Obrigatória | **Sim** nos ambientes `preview` e `production`. Um build de release sem ela para no worker do EAS com a mensagem explicando |
| Tipo | variável do tipo **arquivo** (o EAS grava o arquivo e põe o caminho na variável) |
| Visibilidade | **secreta** (o arquivo traz a API key do projeto Firebase) |
| Onde | ambientes EAS. Localmente, o `google-services.json` na raiz (gitignored, liberado no `.easignore`) é usado quando a variável não existe |

O arquivo **não entra** no runtime (fingerprint): o `.fingerprintignore`
o deixa de fora. O runner do CI que dispara o `eas build` não tem a cópia
(gitignored), o worker do EAS tem (variável de arquivo), e com ele no cálculo
os dois runtimes divergiam e o EAS recusava o build ("Runtime version
mismatch"). Como ele não muda o runtime, trocar de projeto Firebase exige um
build novo, não uma OTA (`fingerprint-firebase.test.ts` guarda a regra).

### Definidas pelo próprio EAS (não configure)

| Variável | Quem define | Uso no app |
| --- | --- | --- |
| `EAS_BUILD` | EAS Build (`true` no worker) | `app.config.js` só exige o `google-services.json` no worker |
| `EAS_BUILD_PROFILE` | EAS Build (nome do perfil) | checagem de URL e filtro de ABIs dos APKs (`plugins/with-preview-abis.js`) |

### `NODE_ENV`

Aparece no `.env.example` (`development`) por convenção, mas o código do app
não lê; o Expo e o Metro definem o modo sozinhos. Não precisa existir nos
ambientes EAS.

## Matriz por ambiente

O EAS só tem `development`, `preview` e `production`. Os perfis `preview` e
`staging` do `eas.json` leem os dois o ambiente `preview`, que aponta para a
stack de staging.

| Variável | `.env` local | EAS `development` | EAS `preview` (perfis `preview` e `staging`) | EAS `production` |
| --- | --- | --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | `http://localhost:3333` | API local ou de staging | `https://api-staging.intrajetto.com` | API de produção (HTTPS) |
| `EXPO_PUBLIC_WEB_APPLICATION_URL` | `http://localhost:3000/login` | web local ou de staging | `https://staging.intrajetto.com/login` | `https://www.intrajetto.com/login` |
| `EXPO_PUBLIC_BACKGROUND_TRACKING` | `false` | `false` | `false` | `false` (até a aprovação) |
| `APP_ENV` | — | — | `preview` | `production` |
| `GOOGLE_SERVICES_JSON` (arquivo, secreto) | arquivo local opcional | opcional | **sim** | **sim** |

O ambiente `preview` é o staging do app: nunca o aponte para a produção.

## GitHub Actions

| Nome | Tipo | Escopo | Obrigatório | Para quê | Como gerar |
| --- | --- | --- | --- | --- | --- |
| `EXPO_TOKEN` | secret | repositório (ou os ambientes `staging` e `production`) | para publicar; sem ele o `deploy.yml` pula o EAS com aviso | autentica o `eas` no CI (build, update, republish) | expo.dev → conta/organização → Access tokens → **robot user** com o menor papel que publica (Developer). Nunca o token pessoal |
| `EXPO_UPDATE_PRIVATE_KEY` | secret | **ambiente** `staging` e **ambiente** `production` | não; sem ele o CI não publica OTA assinada (produção nunca publica sem) | assina as OTAs publicadas pelo CI | conteúdo PEM de `keys/private-key.pem` gerado por `npm run codesigning:generate` (ver [deploy.md](./deploy.md#ota-assinada-code-signing)) |
| `API_REPO_READ_TOKEN` | secret | repositório | não; sem ele os testes de paridade e socket se pulam | checkout de leitura do `trajetto-api` no CI | fine-grained PAT (ou GitHub App) com **Contents: Read** só no `Trajetto-Organization/trajetto-api` |
| `PLAY_SUBMIT_ENABLED` | **variável** | repositório | não (padrão desligado) | `true` faz o build de produção ser enviado à trilha `internal` da Play Store | ligue depois do primeiro AAB enviado à mão e da service account cadastrada no EAS |
| `GITHUB_TOKEN` | automático | — | — | consulta das execuções de staging (`actions: read`) | fornecido pelo GitHub |

Ambientes do GitHub (Settings → Environments):

- **`staging`**: sem revisores; secret `EXPO_UPDATE_PRIVATE_KEY` (opcional).
  Opcional: restringir a branch `staging` em "Deployment branches".
- **`production`**: **revisores obrigatórios** (o dono e mais uma pessoa),
  "Deployment branches" restrito a `main`, secret `EXPO_UPDATE_PRIVATE_KEY`.
  O job de produção, o build manual de produção e o rollback de produção
  esperam a aprovação.

## Credenciais do EAS (não são variáveis)

Ficam no projeto do expo.dev e são gerenciadas com `eas credentials`
(Android). Nunca entram no repositório nem no GitHub.

| Credencial | Para quê | Como |
| --- | --- | --- |
| Keystore Android (upload key) | assina APK/AAB | gerada e guardada pelo EAS no primeiro build; baixe um backup (`eas credentials` → Android → Keystore → Download) para o cofre |
| Google Service Account (Play) | `eas submit` e auto-submit para a trilha `internal` | Play Console → Configuração → Acesso à API → service account com permissão de release; `eas credentials` → Android → Google Service Account → upload do JSON |
| FCM V1 service account key | a Expo Push API entrega push ao FCM | Firebase → Configurações do projeto → Contas de serviço → gerar chave; `eas credentials` → Android → Push Notifications (FCM V1) → upload |

A API não guarda segredo do Firebase: ela chama a Expo Push API, que usa a
chave FCM V1 do projeto EAS.

## Variáveis de teste

| Variável | Onde | Para quê |
| --- | --- | --- |
| `MUTATION_TESTS` | `vitest.mutation.config.ts` | globs (separadas por vírgula) que limitam os testes de uma rodada de mutação |
| `E2E_API_ROOT`, `E2E_DB_NAME`, `E2E_PG_CONTAINER`, `E2E_PG_PORT`, `E2E_REDIS_CONTAINER`, `E2E_REDIS_PORT`, `E2E_API_PORT`, `E2E_METRO_PORT`, `E2E_API_URL`, `E2E_AVD`, `E2E_OUT` | `scripts/e2e/env.sh` | onde ficam a API, o banco descartável, as portas, o emulador e a saída do E2E (todas têm padrão) |
| `E2E_DRIVER_EMAIL`, `E2E_NOFLEET_EMAIL`, `E2E_TWOFA_EMAIL`, `E2E_DRIVER_PASSWORD` | `scripts/e2e/env.sh` | contas da massa de dados do E2E (banco descartável) |
| `E2E_FROM` | `scripts/e2e/run.sh` | retoma a suíte a partir de um fluxo |
| `ANDROID_HOME`, `JAVA_HOME`, `MAESTRO` | `scripts/e2e/env.sh` | SDK, JDK 17 e binário do Maestro (detectados sozinhos) |

## Variáveis de outros repositórios que afetam o app

| Variável | Repositório | Efeito no app |
| --- | --- | --- |
| `MIN_MOBILE_CONTRACT` | `trajetto-api` | vazio = gate desligado; um número faz contratos abaixo dele receberem 426 e abrirem a tela de atualização |
| `MOBILE_STORE_URL` | `trajetto-api` | opcional, `https://`; link da loja no corpo do 426 (sem ela, o app monta a página da Play Store pelo pacote `com.trajetto.fleetmanager`) |
| `BACKGROUND_TRACKING` | `trajetto-ui` | espelho do `EXPO_PUBLIC_BACKGROUND_TRACKING`: a torre avisa que só vê motoristas com o app aberto |

A tabela completa do que precisa casar entre a API, a web e o app (URLs,
origens, push, IA) é a mesma nos três repositórios:
[deploy.md → Os três repositórios juntos](./deploy.md#os-três-repositórios-juntos).

## Dokploy

O app não roda no Dokploy: ele é distribuído pelo EAS (APK interno e Play
Store) e por OTA. O que o Dokploy precisa para o app funcionar é a **API**
acessível no domínio público com HTTPS (o host de `EXPO_PUBLIC_API_URL`,
roteado pelo Traefik), com WebSocket liberado para o socket.io, e o **web**
no host de `EXPO_PUBLIC_WEB_APPLICATION_URL` servindo `/legal/privacidade` e
`/legal/termos`. A configuração deles está no `docs/deploy.md` e no
`docs/variaveis-de-ambiente.md` de cada repositório.

## Como cadastrar no EAS (passo a passo)

Com `eas-cli@21.7.0` instalado e `eas login` feito, na raiz do repositório:

```bash
# Staging: no ambiente preview (o EAS não tem ambiente staging; os perfis
# preview e staging do eas.json leem o preview). Texto simples, "plaintext".
eas env:create --scope project --environment preview   --name EXPO_PUBLIC_API_URL --value https://api-staging.intrajetto.com --visibility plaintext
eas env:create --scope project --environment preview   --name EXPO_PUBLIC_WEB_APPLICATION_URL --value https://staging.intrajetto.com/login --visibility plaintext
eas env:create --scope project --environment preview   --name EXPO_PUBLIC_BACKGROUND_TRACKING --value false --visibility plaintext
eas env:create --scope project --environment preview   --name APP_ENV --value preview --visibility plaintext
# repita para production, com os hosts de produção e APP_ENV=production

# Firebase: uma vez, para os dois ambientes de release
eas env:create --scope project --name GOOGLE_SERVICES_JSON --type file   --value ./google-services.json --visibility secret   --environment preview --environment production

# Conferir
eas env:list --environment preview
```

Pelo site: expo.dev → projeto `trajetto-fleet-manager-mobile` → Environment
variables → Add variable, escolhendo os ambientes. Mudou uma variável
`EXPO_PUBLIC_*`? Ela só chega aos aparelhos no próximo build ou na próxima
OTA daquele ambiente.
