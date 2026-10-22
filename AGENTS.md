# AGENTS.md — trajetto-mobile

Guia para agentes de código (Codex, Claude, Cursor, Copilot e afins) e para
qualquer pessoa que chega agora a este repositório. Leia inteiro antes da
primeira mudança. O `CLAUDE.md` tem o mesmo conteúdo com notas de fluxo para o
Claude Code; mantenha os dois em sincronia.

Documentação completa: [`docs/arquitetura.md`](docs/arquitetura.md),
[`docs/testes.md`](docs/testes.md), [`docs/deploy.md`](docs/deploy.md),
[`docs/variaveis-de-ambiente.md`](docs/variaveis-de-ambiente.md) e o
[`README.md`](README.md).

## O que é este repositório

`trajetto-mobile` (no GitHub: `Trajetto-Organization/trajetto-mobile`)
é o **app de campo do motorista** do Trajetto, um SaaS B2B multiempresa de
Gestão de Frotas e Gestão de Entregas para transportadoras. **Só Android**:
Expo SDK 54 com dev client, React Native 0.81 (nova arquitetura, Hermes,
React Compiler), expo-router 6, NativeWind 4, react-query 5, zustand 5,
react-hook-form + zod 3, socket.io-client, expo-updates com OTA assinada.

O app faz: rota do dia, iniciar rota, chegada, "a caminho", comprovante de
entrega (foto do canhoto, assinatura, recebedor), ocorrências (formulário,
autorização da torre), pausas, chat por ticket com a central, notificações e,
quando a empresa contratou Frotas, abastecimento e checklist do veículo. O
laço do motorista funciona **offline** (cache de 7 dias e fila de envios
durável com upload retomável).

Repositórios irmãos (normalmente clonados lado a lado em `C:/dev/trajetto`):

| Repo | Papel |
| --- | --- |
| `trajetto-api` | API Fastify + Prisma + PostgreSQL + Redis; é o juiz de todas as regras |
| `trajetto-ui` | site público, portal de docs e painel web (Next.js) |
| `trajetto-mobile` | este app |

Idioma: conversa, docs e textos de tela em **pt-BR com acentos**;
identificadores e **comentários no código em inglês**; títulos de teste em
inglês.

## Comandos

| Comando | Para quê |
| --- | --- |
| `npm ci` | instala (lockfile `package-lock.json`; Node 22) |
| `npm start` | Metro (`expo start`); abre no dev client, não no Expo Go |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | unitários Vitest (`tests/unitaires`) |
| `npx vitest run tests/unitaires/<arquivo>.test.ts` | um arquivo |
| `npm run test:coverage` | unitários com cobertura e piso |
| `npm run test:mutation` | Stryker (lento) |
| `npm run lint` | `expo lint` |
| `npm run doctor` | `expo-doctor` |
| `npm run validate` | typecheck + test + lint + doctor |
| `npm run build:<perfil>` / `npm run update:<canal> -- "msg"` | EAS build / OTA (só com pedido explícito) |
| `bash scripts/e2e/<script>.sh` | E2E Maestro no emulador ([`docs/testes.md`](docs/testes.md#e2e-no-emulador-maestro)) |

**Ao terminar uma mudança, rode `npm run typecheck` e `npm test`** (ou os
arquivos de teste afetados). **Não rode lint, `eas build`, `expo prebuild`
nem builds Gradle** por iniciativa própria: o dono roda lint e build.

## Mapa do código

```
app/                    rotas expo-router: (auth)/ login, 2FA, senha;
                        (protected)/ telas logadas; (tabs)/ vehicles, deliveries, chat
features/<assunto>/     regras puras (*-rules.ts) + hooks do assunto
  submissions/          fila offline (outbox), rascunhos, wizard, submit-or-queue
  offline/              allowlist do cache persistido
  access/               módulos contratados (FLEET, DELIVERIES)
  forms/                validação ao vivo, resolver de km, foco
  ai-precheck/          pré-checagem das fotos no aparelho (ML Kit)
  app-update/           tela de atualização obrigatória (426)
  tracking/             rastreamento de posição
  deliveries, occurrences, pauses, chat, fuel, checklist, notifications, …
components/ui/          peças compartilhadas, já em tokens de tema
components/screens/     componentes de cada tela
hooks/ providers/ store/  hooks transversais, provedores, stores zustand
schemas/                zod espelhando os contratos da API
utils/                  api.ts, api-url-rules.ts, client-version.ts, storage.ts,
                        telemetry.ts, theme-tokens.js
modules/text-reader/    módulo nativo Kotlin (OCR no aparelho)
plugins/                config plugins (ABIs dos APKs, uiMode)
tests/unitaires/        testes Vitest; tests/fixtures/ dados
.maestro/ scripts/e2e/  E2E no emulador
app.json app.config.js eas.json  configuração Expo/EAS
.github/workflows/      ci.yml, deploy.yml, ota-rollback.yml
docs/                   arquitetura, testes, deploy, variáveis de ambiente
```

Alias `@/` = raiz do repositório.

## Regras de arquitetura (não quebre)

1. **Decisão em função pura.** Regra de negócio vive em `features/**` sem
   import de React nem de módulo nativo, e é testada em Node puro. Se só der
   para testar com mock nativo, a regra está no lugar errado.
2. **Formulários = hooks compostos, sem contexto.** Contexto foi descartado de
   propósito (re-render a cada tecla em Android de entrada). Reaproveite
   `submit-or-queue`, `draft-store`, `use-draft-autosave`, `use-wizard-steps`,
   `use-discard-confirmation`, `use-image-capture`, `use-live-fields`.
3. **Validação ao vivo** (`features/forms/live-validation.ts`): confere ao
   sair do campo e a cada mudança depois; some na tecla que corrige; o envio
   confere tudo e foca o primeiro inválido. O botão de criar fica habilitado.
4. **Fila offline**: só falha transitória vai para a fila; erro de regra fica
   na tela com o rascunho. Todo item tem `client_submission_id`. Fotos são
   copiadas para o diretório do item e o upload é retomável. **"API parece
   inacessível" nunca pausa a fila**, só o rádio desligado. Mudou o formato de
   um item? Suba `OUTBOX_SCHEMA_VERSION` e acrescente o passo em
   `upcastOutboxItem`.
5. **Cache**: só as chaves de `OFFLINE_QUERY_KEYS`
   (`features/offline/offline-cache-rules.ts`); `gcTime` acompanha o `maxAge`
   de 7 dias.
6. **`prepareUploadImage` fica dentro de `use-image-capture`**: é o que tira
   EXIF/GPS das fotos (a API não toca nos bytes). Nunca condicional.
7. **`draft-store` nunca olha dentro do rascunho**; não renomeie campo
   persistido.
8. **Módulos**: pergunte a `features/access/module-rules.ts`; não espalhe
   checagem de módulo pelas telas.
9. **Contrato com a API**: mudou rota, campo ou formato de upload? Suba
   `CLIENT_CONTRACT` em `utils/client-version.ts`. A API aceita o novo antes
   e continua aceitando o antigo.
10. **Tema**: só tokens (`bg-background`, `bg-card`, `bg-surface`,
    `bg-subtle`, `text-ink`, `text-ink-soft`, `text-muted`, `border-border`,
    `border-input`, `bg-primary` + `text-primary-foreground`…). Nada de
    `gray-*`, `blue-*`, `bg-white`, hex ou `bg-gradient-*`. Todo `<Text>` tem
    cor. Props sem `className` usam `useThemeColors()`. Estados que mudam a
    mesma propriedade são classes exclusivas. Nunca remova o plugin
    `with-ui-mode-config-change`.
11. **Teclado e bottom sheet**: use o `KeyboardAvoidingView` de
    `components/ui/keyboard-avoiding-view.tsx`; toda `BottomSheetModal` usa
    `useCloseOnBack`.
12. **`testID`** em todo elemento que o Maestro toca; renomeou, ajuste o
    fluxo em `.maestro/` (o teste de fiação acusa).
13. **Textos de tela em pt-BR com acento** (`ptbr-accents.test.ts` varre as
    strings).
14. **Manifesto**: permissão nova passa pelo `app.config.js` (listas de
    removidas/limitadas) e pelo `android-manifest.test.ts`. Localização em
    segundo plano fica **desligada** (`EXPO_PUBLIC_BACKGROUND_TRACKING=false`)
    até a aprovação do Play Console.
15. **URL da API** em release: HTTPS público, sem credenciais, query ou
    fragmento (`utils/api-url-rules.ts` e a cópia no `app.config.js` andam
    juntas; um teste compara).

## Como adicionar uma funcionalidade de ponta a ponta

Exemplo: um envio novo do motorista (um novo tipo de registro).

1. **Contrato**: confirme a rota e o corpo no `trajetto-api` (ou faça a
   mudança lá primeiro). Espelhe o esquema em `schemas/<assunto>.ts` (zod).
2. **Regra pura**: `features/<assunto>/<assunto>-rules.ts` com o que decide
   (validação, estado, mensagens). Teste em
   `tests/unitaires/<assunto>-rules.test.ts`, vermelho antes de verde.
3. **Fila**: se o envio precisa funcionar offline, registre o tipo na fila
   (`features/submissions/outbox-schema.ts`, `kind-effects.ts`,
   `kind-refusals.ts` e `moduleOfSubmission` em
   `features/access/module-rules.ts`) e envie por `submit-or-queue`. Teste o
   que entra na fila e o que acontece em cada recusa.
4. **Hook e tela**: um hook em `features/<assunto>/` que compõe os hooks
   compartilhados; a tela em `app/(protected)/<tela>.tsx` com componentes em
   `components/screens/<tela>/`, tokens de tema e `testID`.
5. **Módulo e acesso**: a tela só aparece quando `module-rules` permite.
6. **Contrato do app**: suba `CLIENT_CONTRACT` se o app passou a enviar algo
   novo.
7. **Testes**: typecheck + unitários; se mexeu no laço do motorista, um fluxo
   Maestro novo ou ajustado.
8. **Docs**: atualize `docs/arquitetura.md` (e `docs/testes.md`,
   `docs/deploy.md` ou `docs/variaveis-de-ambiente.md` quando couber).

## Testes (resumo de `docs/testes.md`)

- Vitest 1.6 em Node puro; hooks com `tests/unitaires/support/hook-runtime.ts`
  (`vi.mock("react", () => reactShim)`), sem renderizador.
- **Títulos e comentários de teste em inglês**; vermelho antes de verde;
  importe o código real por `@/…`; testes de configuração leem o arquivo real
  e guardam o **fato**, não o texto.
- **Piso de cobertura** (statements 52, branches 87, functions 81, lines 52)
  em `vitest.config.ts` e `coverage-measured.test.ts`: suba quando a
  cobertura subir, nunca baixe para passar.
- Mutação com corte em 90 nas regras listadas em `stryker.config.mjs`.
- Testes de paridade leem `../trajetto-api` e se pulam sem ele.
- Pasta `android/` esquecida quebra `android-manifest.test.ts`: apague.
- E2E Maestro roda só no emulador local (API na 3335, Metro na 8081, banco
  `mobile_e2e`), nunca no CI.

## Build, deploy e ambientes (resumo de `docs/deploy.md`)

- Fluxo: branch de trabalho → PR para `staging` → PR `staging` → `main`
  (**só merge commit**: squash e o "Rebase and merge" do GitHub reescrevem os
  SHAs e o release é recusado). A árvore do merge tem de ser idêntica à do
  commit de staging: nada de commit ou hotfix direto em `main`; hotfix passa
  por `staging`.
- `ci.yml` valida branches de trabalho e PRs, e é chamado pelo `deploy.yml`.
- `deploy.yml`: push em `staging` → OTA no canal `staging` (+ APK se o lado
  nativo mudou); push em `main` → prova de que o commit ficou verde em
  staging → ambiente `production` (revisores) → OTA **assinada** no canal
  `production` (+ AAB se nativo, auto-submit à trilha internal com
  `PLAY_SUBMIT_ENABLED=true`). `ota-rollback.yml` republica um grupo antigo
  (só se o grupo for do canal escolhido).
- Sem `EXPO_TOKEN` os jobs de publicação só avisam e terminam verdes.
- O app **não** vai para Dokploy nem GHCR: as `EXPO_PUBLIC_*` são embutidas no
  build, então se promove o **commit**, não o artefato.
- Runtime por fingerprint: mudança nativa só chega por binário novo.
- Entre repositórios: a ordem do primeiro deploy (API → web → app), a ordem de
  cada release (**API → web → app**) e os valores que precisam casar com a API
  e a web (`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_WEB_APPLICATION_URL`,
  `MIN_MOBILE_CONTRACT`) estão em `docs/deploy.md`, seção "Os três
  repositórios juntos", igual nos três repositórios.

## Variáveis (resumo de `docs/variaveis-de-ambiente.md`)

- App: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_WEB_APPLICATION_URL`,
  `EXPO_PUBLIC_BACKGROUND_TRACKING` (sempre `false` por ora). Não são
  segredo: ficam legíveis no APK.
- Build (só nos ambientes EAS): `APP_ENV` e `GOOGLE_SERVICES_JSON` (arquivo,
  secreto). O EAS **não** lê o `.env`.
- GitHub: `EXPO_TOKEN`, `EXPO_UPDATE_PRIVATE_KEY` (secret de ambiente),
  `API_REPO_READ_TOKEN` e a variável `PLAY_SUBMIT_ENABLED`.
- Variável `EXPO_PUBLIC_*` nova? Declare no `.env.example` (um teste exige) e
  documente em `docs/variaveis-de-ambiente.md`.

## Faça e não faça

Faça:

- Leia `docs/arquitetura.md` antes de mexer em fila, cache, formulários,
  tema ou rastreamento.
- Mantenha o diff pequeno e focado; um ponto por vez (corrige, testa,
  valida, só então o próximo).
- Atualize os docs no mesmo trabalho quando mudar comportamento, comando,
  variável ou pipeline.

Não faça:

- **Não commite, não dê push, stash, reset nem checkout** sem pedido
  explícito do dono.
- Não rode lint nem builds (EAS, prebuild, Gradle) por iniciativa própria.
- Não escreva nem imprima segredos (tokens, chave de OTA, keystore,
  `google-services.json`, service accounts). `keys/`, `.env*` (exceto
  `.env.example`) e `google-services.json` são ignorados; mantenha assim, e
  mantenha o `.easignore` igual ao `.gitignore` menos o
  `google-services.json`.
- Não ligue `EXPO_PUBLIC_BACKGROUND_TRACKING` nem acrescente permissões sem
  passar pelo manifesto testado.
- Não adicione dependência nativa sem pensar no runtime (os binários atuais
  deixam de receber OTA) e sem `npx expo install` (versões alinhadas ao SDK).
- Não use cor numerada, hex ou `bg-white` em tela.
- Não mova regra de negócio para dentro de componente.
- Não use o Expo Go (há módulo nativo próprio).
