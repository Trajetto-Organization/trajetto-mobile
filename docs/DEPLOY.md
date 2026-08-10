# 🚀 Guia de Deploy - Trajetto Fleet Manager Mobile

Este guia explica como configurar e publicar o app nas lojas Google Play e App Store usando EAS (Expo Application Services) com deploy automatizado via GitHub Actions.

## 📋 Pré-requisitos

### 1. Criar conta no Expo

1. Acesse [expo.dev](https://expo.dev)
2. Crie uma conta gratuita
3. Instale o EAS CLI globalmente:

```bash
npm install -g eas-cli
```

### 2. Fazer login no EAS

```bash
cd trajetto-fleet-manager-mobile
eas login
```

### 3. Configurar o projeto no EAS

```bash
eas build:configure
```

Este comando irá:

- Criar um projeto no Expo
- Atualizar o `app.json` com o `projectId`
- Gerar o arquivo `eas.json` (já incluído no repositório)

## 🔧 Configuração Inicial

### Atualizar app.json

Após executar `eas build:configure`, atualize os campos no `app.json`:

```json
{
  "expo": {
    "extra": {
      "eas": {
        "projectId": "seu-project-id-gerado"
      }
    },
    "updates": {
      "url": "https://u.expo.dev/seu-project-id-gerado"
    }
  }
}
```

### Configurar Secrets do GitHub

No seu repositório GitHub, vá em **Settings > Secrets and variables > Actions** e adicione:

1. **EXPO_TOKEN**: Token de acesso do Expo
   - Gerar em: https://expo.dev/accounts/[seu-user]/settings/access-tokens
   - Crie um token com permissões de leitura e escrita

## 📱 Publicação nas Lojas

### Android - Google Play Store

#### Passo 1: Criar conta Google Play Developer

1. Acesse [Google Play Console](https://play.google.com/console)
2. Pague a taxa única de $25
3. Crie um novo app

#### Passo 2: Gerar Service Account Key

1. No Google Cloud Console, vá em **IAM & Admin > Service Accounts**
2. Crie uma service account
3. Gere uma chave JSON
4. Salve como `google-service-account.json` (NÃO commitar!)
5. No Google Play Console, adicione a service account em **Setup > API access**

#### Passo 3: Configurar eas.json

O arquivo já está configurado, mas atualize se necessário:

```json
{
  "submit": {
    "production": {
      "android": {
        "serviceAccountKeyPath": "./google-service-account.json",
        "track": "internal"
      }
    }
  }
}
```

#### Passo 4: Primeiro Build Manual

```bash
# Build de produção
eas build --platform android --profile production

# Após o build, fazer upload manual do primeiro APK/AAB
eas submit --platform android --latest
```

**Importante**: O primeiro upload DEVE ser manual na Google Play Console!

### iOS - App Store

#### Passo 1: Conta Apple Developer

1. Inscreva-se em [Apple Developer Program](https://developer.apple.com/programs/) ($99/ano)
2. Crie um App ID no portal do desenvolvedor
3. Crie um App no App Store Connect

#### Passo 2: Configurar eas.json

Atualize com suas informações:

```json
{
  "submit": {
    "production": {
      "ios": {
        "appleId": "seu-email@exemplo.com",
        "ascAppId": "1234567890",
        "appleTeamId": "XXXXXXXXXX"
      }
    }
  }
}
```

- **appleId**: Seu Apple ID
- **ascAppId**: ID do app no App Store Connect
- **appleTeamId**: ID do time (encontrado no Apple Developer)

#### Passo 3: Autenticação App Store

```bash
# Login na Apple
eas device:create

# Build de produção
eas build --platform ios --profile production

# Submit para TestFlight
eas submit --platform ios --latest
```

## 🤖 Deploy Automatizado com GitHub Actions

### Como funciona

O workflow `.github/workflows/eas-build.yml` está configurado para:

#### 1. Build Automático (Push para main/master)

- Detecta mudanças na pasta `trajetto-fleet-manager-mobile`
- Executa build **preview** para Android e iOS
- Builds ficam disponíveis no Expo para teste interno

#### 2. Build e Submit Manual

- Acesse **Actions** no GitHub
- Clique em "EAS Build and Submit"
- Clique em "Run workflow"
- Escolha:
  - **Platform**: `all`, `android` ou `ios`
  - **Profile**: `development`, `preview` ou `production`

#### 3. Submit Automático

- Apenas para builds de **production**
- Android: Envia para Google Play (Internal Testing)
- iOS: Envia para TestFlight

### Perfis de Build

| Perfil          | Descrição                              | Quando usar           |
| --------------- | -------------------------------------- | --------------------- |
| **development** | Build de desenvolvimento com DevClient | Desenvolvimento local |
| **preview**     | Build interno (APK/IPA)                | Testes internos       |
| **production**  | Build para lojas (AAB/IPA)             | Publicação oficial    |

## 🔄 Fluxo de Trabalho Recomendado

### Desenvolvimento

```bash
# Build local para testes
eas build --platform android --profile development --local
```

### Testes Internos

```bash
# Build preview (APK para Android)
eas build --platform android --profile preview

# Compartilhar link gerado com testadores
```

### Produção

```bash
# Via GitHub Actions (recomendado)
# 1. Vá em Actions > EAS Build and Submit
# 2. Run workflow > production > all

# OU via CLI
eas build --platform all --profile production
eas submit --platform all --latest
```

## 📊 Monitoramento

### Expo Dashboard

- Acesse [expo.dev/accounts/trajetto/projects/trajetto-fleet-manager-mobile](https://expo.dev)
- Veja todos os builds em andamento e completos
- Baixe builds ou compartilhe links

### GitHub Actions

- Acesse a aba **Actions** no repositório
- Monitore o progresso dos builds
- Veja logs em caso de erros

## 🔐 Segurança

### Arquivos sensíveis (NÃO commitar)

Adicione ao `.gitignore`:

```
# EAS
google-service-account.json
*.p12
*.mobileprovision
*.cer

# Environment
.env
.env.local
```

### Secrets necessários

- `EXPO_TOKEN`: Token do Expo (obrigatório)
- Credentials iOS/Android são gerenciadas pelo EAS automaticamente

## 🆘 Troubleshooting

### Build falha no GitHub Actions

- Verifique se `EXPO_TOKEN` está configurado
- Confirme que `projectId` está correto no `app.json`
- Veja os logs detalhados em Actions

### Erro ao submeter para lojas

- **Android**: Verifique service account key e permissões
- **iOS**: Confirme Apple ID, ASC App ID e Team ID
- **Primeiro upload**: Deve ser manual na console da loja

### Incremento de versão

- O EAS incrementa automaticamente `versionCode` (Android) e `buildNumber` (iOS)
- Para mudar `version` (1.0.0 -> 1.1.0), atualize manualmente no `app.json`

## 📚 Recursos Úteis

- [EAS Build Documentation](https://docs.expo.dev/build/introduction/)
- [EAS Submit Documentation](https://docs.expo.dev/submit/introduction/)
- [GitHub Actions with Expo](https://docs.expo.dev/build/building-on-ci/)
- [Google Play Console](https://play.google.com/console)
- [App Store Connect](https://appstoreconnect.apple.com)

---

**Dica**: Comece sempre com builds de **preview** para testes internos antes de fazer builds de **production** para as lojas!
