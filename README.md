# 📱 Trajetto Fleet Manager Mobile

<div align="center">

![React Native](https://img.shields.io/badge/React_Native-0.81.4-blue.svg)
![Expo](https://img.shields.io/badge/Expo-~54.0.8-000020.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-~5.9.2-blue.svg)
![NativeWind](https://img.shields.io/badge/NativeWind-4.2.1-38bdf8.svg)
![Zustand](https://img.shields.io/badge/Zustand-5.0.8-ff6b35.svg)

**Aplicação mobile para gestão de frotas Trajetto**

Sistema móvel completo para motoristas e gestores realizarem abastecimentos e checklists veiculares em campo.

[🚀 Instalação](#-instalação) • [📱 Como Executar](#-como-executar) • [🏗️ Arquitetura](#️-arquitetura) • [🛠️ Tecnologias](#️-tecnologias)

</div>

---

## 📋 Índice

- [Sobre o Projeto](#-sobre-o-projeto)
- [Funcionalidades](#-funcionalidades)
- [Arquitetura](#️-arquitetura)
- [Tecnologias](#️-tecnologias)
- [Pré-requisitos](#-pré-requisitos)
- [Instalação](#-instalação)
- [Como Executar](#-como-executar)
- [Builds e Deploy](#-builds-e-deploy)
- [Configuração](#-configuração)
- [Estrutura do Projeto](#-estrutura-do-projeto)
- [Autenticação](#-autenticação)
- [Recursos Mobile](#-recursos-mobile)
- [Interface](#-interface)
- [Integração com APIs](#-integração-com-apis)
- [Gerenciamento de Estado](#-gerenciamento-de-estado)
- [Validação e Formulários](#-validação-e-formulários)
- [Plataformas Suportadas](#-plataformas-suportadas)
- [Contribuição](#-contribuição)

## 🎯 Sobre o Projeto

O **Trajetto Fleet Manager Mobile** é a aplicação móvel complementar ao sistema web de gestão de frotas. Desenvolvida em React Native com Expo, oferece aos motoristas e operadores de campo uma interface intuitiva para:

- **Registrar abastecimentos** com captura de foto do odômetro
- **Realizar checklists veiculares** completos com sistema inteligente de fotos
- **Gerenciar veículos** da frota com acesso offline
- **Autenticação segura** com suporte a 2FA

A aplicação foi projetada para funcionar de forma eficiente em campo, com recursos nativos mobile otimizados para operações diárias de frotas.

## 🚀 Funcionalidades

### 🔐 Sistema de Autenticação Completo

- **Login seguro** com email e senha
- **Autenticação de dois fatores (2FA)** via email
- **Recuperação de senha** com fluxo simplificado
- **Gestão de sessão** com refresh automático de tokens
- **Suporte multi-empresas** para usuários MASTER

### 🚛 Gestão de Veículos

- **Listagem inteligente** com scroll infinito
- **Busca em tempo real** com debounce otimizado
- **Estatísticas visuais** (total de veículos e ativos)
- **Status colorido** dos veículos para identificação rápida
- **Ações rápidas** (abastecimento e checklist)

### ⛽ Sistema de Abastecimento

- **Fluxo guiado em etapas:**
  1. Seleção da filial responsável
  2. Escolha do motorista
  3. Seleção do tipo de combustível
  4. Captura obrigatória de foto do odômetro
  5. Preenchimento dos dados de abastecimento
- **Validação inteligente** de quilometragem
- **Cálculo automático** de valores
- **Upload seguro** com foto comprimida

### 📋 Checklist Veicular Inteligente

- **Sistema categorizado** de verificações:
  - **Proteção Legal** (sempre obrigatórias)
  - **Segurança Crítica** (foto obrigatória se não OK)
  - **Verificações Técnicas**
  - **Itens Internos**
- **Captura múltipla de fotos** por categoria
- **Validação inteligente** de fotos obrigatórias
- **Interface otimizada** para uso em campo

### ⚡ Recursos de Produtividade

- **Seleção rápida** de entidades com busca
- **Cache inteligente** para uso offline limitado
- **Feedback tátil** em todas as interações
- **Toasts informativos** para confirmações
- **Estados de loading** bem definidos

## 🏗️ Arquitetura

A aplicação segue uma **arquitetura limpa e escalável** baseada em:

```
📁 app/                    # Sistema de rotas (Expo Router)
    (auth)/               # Rotas de autenticação
    (protected)/          # Rotas protegidas
📁 components/            # Componentes reutilizáveis
    ui/                   # Componentes base de interface
    screens/              # Componentes específicos de telas
    shared/               # Componentes compartilhados
📁 hooks/                 # Hooks customizados
📁 store/                 # Gerenciamento de estado (Zustand)
📁 providers/             # Providers de contexto
📁 utils/                 # Utilitários e helpers
📁 types/                 # Tipagem TypeScript
📁 schemas/               # Validação de dados (Zod)
📁 assets/                # Recursos estáticos
```

### 🔧 Padrões Arquiteturais

- **Expo Router** para roteamento baseado em arquivos
- **Zustand** para estado global simplificado
- **TanStack Query** para cache e sincronização de dados
- **React Hook Form + Zod** para formulários validados
- **Clean Architecture** com separação de responsabilidades

## 🛠️ Tecnologias

### 📱 Core Framework

- **React Native 0.81.4** - Framework de desenvolvimento mobile
- **Expo SDK 54** - Plataforma e ferramentas de desenvolvimento
- **TypeScript 5.9.2** - Tipagem estática para JavaScript

### 🧭 Navegação e Roteamento

- **Expo Router 6** - Sistema de roteamento baseado em arquivos
- **React Navigation 7** - Navegação nativa para React Native

### 🎨 Interface e Estilização

- **NativeWind 4.2.1** - Tailwind CSS para React Native
- **React Native Paper 5.14.5** - Componentes Material Design
- **Expo Linear Gradient** - Gradientes nativos
- **@expo/vector-icons** - Biblioteca de ícones

### 📊 Gerenciamento de Estado

- **Zustand 5.0.8** - Estado global reativo
- **TanStack Query 5.89.0** - Cache e sincronização de dados
- **AsyncStorage** - Persistência local de dados
- **Expo Secure Store** - Armazenamento seguro de tokens

### 📝 Formulários e Validação

- **React Hook Form 7.62.0** - Gerenciamento de formulários
- **Zod 3.25.76** - Validação de schemas
- **@hookform/resolvers** - Integração RHF + Zod

### 📷 Recursos Nativos

- **Expo Camera** - Acesso à câmera do dispositivo
- **Expo Image Picker** - Seleção de imagens da galeria
- **Expo Haptics** - Feedback tátil
- **React Native Gesture Handler** - Gestos nativos
- **React Native Reanimated** - Animações performáticas

### 🎭 UI/UX Avançado

- **@gorhom/bottom-sheet** - Bottom sheets nativos
- **React Native Toast Message** - Notificações toast
- **React Native Shimmer Placeholder** - Loading states
- **Expo Blur** - Efeitos de blur

### ⚙️ Desenvolvimento

- **ESLint** - Linting e qualidade de código
- **Metro** - Bundler React Native
- **Expo CLI** - Ferramentas de desenvolvimento

## 📋 Pré-requisitos

Certifique-se de ter instalado:

- **Node.js** (versão 18 ou superior)
- **npm** ou **yarn**
- **Expo CLI** (`npm install -g @expo/cli`)
- **Expo Go** no dispositivo móvel (para testes)

Para desenvolvimento avançado:

- **Android Studio** (para builds Android)
- **Xcode** (para builds iOS - somente macOS)

## 🚀 Instalação

### 1. Clonando o Repositório

```bash
# Clone o repositório principal
git clone https://github.com/seu-usuario/trajetto.git

# Navegue para a pasta do projeto mobile
cd trajetto/trajetto-fleet-manager-mobile

# Instale as dependências
npm install
```

### 2. Configuração de Ambiente

1. **Copie o arquivo de exemplo de variáveis de ambiente:**

```bash
cp .env.example .env
```

2. **Configure as variáveis de ambiente no `.env`:**

```env
# URL da API Backend
EXPO_PUBLIC_API_URL=http://localhost:3333

# Ambiente da aplicação
EXPO_PUBLIC_APP_ENV=development

# Nome da aplicação
EXPO_PUBLIC_APP_NAME=Trajetto Mobile Dev

# Versão da aplicação
EXPO_PUBLIC_APP_VERSION=1.0.0-dev
```

3. **Para produção, configure o `.env.production`:**

```env
EXPO_PUBLIC_API_URL=https://api.trajetto.com.br
EXPO_PUBLIC_APP_ENV=production
EXPO_PUBLIC_APP_NAME=Trajetto Mobile
EXPO_PUBLIC_APP_VERSION=1.0.0
```

## 📱 Como Executar

### 🔧 Desenvolvimento Local

```bash
# Iniciar o servidor de desenvolvimento
npm start

# Ou para plataformas específicas
npm run android  # Abrir no emulador Android
npm run ios      # Abrir no simulador iOS (somente macOS)
npm run web      # Abrir versão web (experimental)
```

### 📲 Testando no Dispositivo

1. **Instale o Expo Go** no seu dispositivo
2. **Execute `npm start`** no terminal
3. **Escaneie o QR Code** com o Expo Go
4. **Aguarde o carregamento** da aplicação

### ⚙️ Comandos Úteis

```bash
# Limpar cache do Metro
npm run clear

# Executar linting
npm run lint

# Reset do projeto (caso de problemas)
npm run reset-project
```

## 🚀 Builds e Deploy

### 🔨 Build de Desenvolvimento

```bash
# Build de desenvolvimento
npx expo build:android
npx expo build:ios
```

### 📦 Build de Produção

```bash
# Configurar ambiente de produção
cp .env.production .env

# Build de produção
eas build --platform android --profile production
eas build --platform ios --profile production
```

### 🚀 Publicação

```bash
# Publicar update OTA
eas update --branch production

# Submeter para lojas
eas submit --platform android
eas submit --platform ios
```

## ⚙️ Configuração

### 📱 Configuração do Expo (app.json)

```json
{
  "expo": {
    "name": "Trajetto Mobile",
    "slug": "trajetto-fleet-manager-mobile",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/images/icon.png",
    "splash": {
      "image": "./assets/images/splash-icon.png",
      "backgroundColor": "#ffffff"
    },
    "ios": {
      "bundleIdentifier": "com.trajetto.fleetmanager",
      "supportsTablet": true
    },
    "android": {
      "package": "com.trajetto.fleetmanager",
      "permissions": [
        "android.permission.CAMERA",
        "android.permission.READ_EXTERNAL_STORAGE"
      ]
    }
  }
}
```

### 🎨 Configuração do Tailwind (tailwind.config.js)

```javascript
module.exports = {
  content: ["./app/**/*.{js,ts,tsx}", "./components/**/*.{js,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#eff6ff",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
        },
      },
    },
  },
};
```

## 📁 Estrutura do Projeto

### 🗂️ Organização Detalhada

```
trajetto-fleet-manager-mobile/
├── 📱 app/                           # Sistema de rotas (Expo Router)
│   ├── (auth)/                       # Grupo: Autenticação
│   │   ├── login.tsx                 # Tela de login
│   │   ├── forgot-password.tsx       # Recuperação de senha
│   │   └── two-factor.tsx            # Verificação 2FA
│   ├── (protected)/                  # Grupo: Rotas protegidas
│   │   ├── vehicles.tsx              # Lista de veículos
│   │   ├── fuel.tsx                  # Criar abastecimento
│   │   ├── checklist.tsx             # Criar checklist
│   │   └── select-business.tsx       # Seleção de empresa
│   ├── _layout.tsx                   # Layout raiz
│   └── index.tsx                     # Redirecionamento inicial
├── 🧩 components/                    # Componentes reutilizáveis
│   ├── ui/                           # Componentes base
│   │   ├── Button.tsx                # Botão customizado
│   │   ├── Input.tsx                 # Input com validação
│   │   ├── Select.tsx                # Seletor dropdown
│   │   ├── Avatar.tsx                # Avatar de usuário
│   │   ├── LoadingSpinner.tsx        # Loading spinner
│   │   ├── ConfirmModal.tsx          # Modal de confirmação
│   │   └── [outros componentes UI]
│   ├── screens/                      # Componentes de tela
│   │   ├── vehicles/                 # Componentes da tela de veículos
│   │   ├── fuel/                     # Componentes do abastecimento
│   │   └── checklist/                # Componentes do checklist
│   └── shared/                       # Componentes compartilhados
│       ├── ProtectedRoute.tsx        # Proteção de rotas
│       ├── EntitySelector.tsx        # Seletor de entidades
│       └── CameraComponent.tsx       # Componente de câmera
├── 🪝 hooks/                         # Hooks customizados
│   ├── useAuth.ts                    # Hook de autenticação
│   ├── useVehicles.ts                # Hook de veículos
│   ├── useInfiniteScroll.ts          # Hook de scroll infinito
│   └── useCamera.ts                  # Hook de câmera
├── 🗄️ store/                         # Gerenciamento de estado
│   ├── authStore.ts                  # Estado de autenticação
│   ├── vehicleStore.ts               # Estado de veículos
│   └── appStore.ts                   # Estado global da app
├── 🔧 providers/                     # Providers de contexto
│   ├── QueryProvider.tsx             # Provider do TanStack Query
│   ├── ThemeProvider.tsx             # Provider de tema
│   └── ToastProvider.tsx             # Provider de toasts
├── ⚙️ utils/                         # Utilitários
│   ├── api.ts                        # Cliente HTTP
│   ├── storage.ts                    # Helpers de storage
│   ├── validations.ts                # Validações customizadas
│   ├── formatters.ts                 # Formatadores de dados
│   └── constants.ts                  # Constantes da aplicação
├── 📝 types/                         # Definições de tipos
│   ├── auth.ts                       # Tipos de autenticação
│   ├── vehicle.ts                    # Tipos de veículos
│   ├── fuel.ts                       # Tipos de abastecimento
│   └── api.ts                        # Tipos de API
├── 🔍 schemas/                       # Schemas de validação
│   ├── authSchemas.ts                # Schemas de auth
│   ├── fuelSchemas.ts                # Schemas de abastecimento
│   └── checklistSchemas.ts           # Schemas de checklist
└── 🎨 assets/                        # Recursos estáticos
    ├── images/                       # Imagens da aplicação
    ├── icons/                        # Ícones customizados
    └── fonts/                        # Fontes customizadas
```

### 🔄 Fluxo de Navegação

```mermaid
graph TD
    A[index.tsx] --> B{Autenticado?}
    B -->|Não| C[/login]
    B -->|Sim| D[/vehicles]
    C --> E[/forgot-password]
    C --> F[/two-factor]
    D --> G[/fuel]
    D --> H[/checklist]
    D --> I[/select-business]
```

## 🔐 Autenticação

### 🔑 Sistema de Autenticação Completo

A aplicação implementa um sistema robusto de autenticação com:

#### 🚪 Fluxo de Login

```typescript
// Validação com Zod
const loginSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "Senha deve ter pelo menos 6 caracteres"),
});

// Hook de autenticação
const { login, isLoading } = useAuth();

// Processo de login
const handleLogin = async (data: LoginForm) => {
  const result = await login(data.email, data.password);
  if (result.requires2FA) {
    router.push("/two-factor");
  } else {
    router.push("/vehicles");
  }
};
```

#### 🔐 Autenticação de Dois Fatores (2FA)

- **Envio automático** de código por email
- **Input especializado** para código de 6 dígitos
- **Validação em tempo real** do código
- **Reenvio de código** com cooldown

#### 🎫 Gestão de Tokens

```typescript
// Store de autenticação com Zustand
interface AuthStore {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;

  // Ações
  login: (email: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  refreshTokens: () => Promise<boolean>;
  setUser: (user: User) => void;
}

// Persistência segura
const authStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      // Implementação do store
    }),
    {
      name: "trajetto-auth",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
```

#### 🛡️ Proteção de Rotas

```typescript
// Componente de proteção
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, user } = useAuthStore();

  if (!isAuthenticated) {
    return <Redirect href="/login" />;
  }

  return <>{children}</>;
};

// Uso nas rotas protegidas
export default function VehiclesLayout() {
  return (
    <ProtectedRoute>
      <Stack />
    </ProtectedRoute>
  );
}
```

### ⚡ Interceptação de Requisições

```typescript
// Cliente HTTP com interceptação automática
class ApiClient {
  async request(url: string, options: RequestInit = {}) {
    const token = await SecureStore.getItemAsync("accessToken");

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (response.status === 401) {
      const refreshed = await this.refreshToken();
      if (refreshed) {
        return this.request(url, options); // Retry
      } else {
        authStore.getState().logout();
        throw new Error("Sessão expirada");
      }
    }

    return response;
  }
}
```

## 📱 Recursos Mobile

### 📷 Sistema de Câmera

```typescript
// Hook personalizado para câmera
const useCamera = () => {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  const requestPermission = async () => {
    const { status } = await Camera.requestCameraPermissionsAsync();
    setHasPermission(status === "granted");
  };

  const takePicture = async (cameraRef: React.RefObject<Camera>) => {
    if (cameraRef.current) {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        base64: false,
        exif: false,
      });
      return photo;
    }
  };

  return { hasPermission, requestPermission, takePicture };
};
```

### 🖼️ Seleção de Imagens

```typescript
// Componente de seleção de imagem
const ImagePickerBottomSheet = ({ isVisible, onClose, onImageSelected }) => {
  const pickImage = async (useCamera: boolean) => {
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          aspect: [16, 9],
          quality: 0.7,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          aspect: [16, 9],
          quality: 0.7,
        });

    if (!result.canceled && result.assets[0]) {
      onImageSelected(result.assets[0]);
    }
  };

  return (
    <BottomSheet isVisible={isVisible} onClose={onClose}>
      <Button onPress={() => pickImage(true)}>📷 Tirar Foto</Button>
      <Button onPress={() => pickImage(false)}>🖼️ Escolher da Galeria</Button>
    </BottomSheet>
  );
};
```

### 📳 Feedback Tátil

```typescript
// Uso do Expo Haptics
import * as Haptics from "expo-haptics";

// Feedback para diferentes ações
const handleSuccess = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  showToast("Sucesso!", "success");
};

const handleError = () => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  showToast("Erro!", "error");
};

const handleButtonPress = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
};
```

### 🔐 Armazenamento Seguro

```typescript
// Tokens sensíveis no Expo Secure Store
const TokenManager = {
  async setTokens(accessToken: string, refreshToken: string) {
    await SecureStore.setItemAsync("accessToken", accessToken);
    await SecureStore.setItemAsync("refreshToken", refreshToken);
  },

  async getAccessToken(): Promise<string | null> {
    return await SecureStore.getItemAsync("accessToken");
  },

  async clearTokens() {
    await SecureStore.deleteItemAsync("accessToken");
    await SecureStore.deleteItemAsync("refreshToken");
  },
};

// Dados não sensíveis no AsyncStorage
const DataManager = {
  async setUserPreferences(preferences: UserPreferences) {
    await AsyncStorage.setItem("userPreferences", JSON.stringify(preferences));
  },

  async getUserPreferences(): Promise<UserPreferences | null> {
    const data = await AsyncStorage.getItem("userPreferences");
    return data ? JSON.parse(data) : null;
  },
};
```

## 🎨 Interface

### 🎨 Sistema de Design

A aplicação utiliza um design system baseado em **Material Design** com **NativeWind** para estilização:

#### 🌈 Cores e Tema

```javascript
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#eff6ff",
          100: "#dbeafe",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          900: "#1e3a8a",
        },
        success: {
          50: "#f0fdf4",
          500: "#22c55e",
          600: "#16a34a",
        },
        warning: {
          50: "#fffbeb",
          500: "#f59e0b",
          600: "#d97706",
        },
        error: {
          50: "#fef2f2",
          500: "#ef4444",
          600: "#dc2626",
        },
      },
    },
  },
};
```

#### 🔘 Componentes de Interface

**Botão Customizado:**

```typescript
interface ButtonProps {
  variant?: "primary" | "secondary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  loading?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}

const Button: React.FC<ButtonProps> = ({
  variant = "primary",
  size = "md",
  loading = false,
  ...props
}) => {
  const baseClasses = "rounded-lg items-center justify-center";
  const variants = {
    primary: "bg-primary-600 active:bg-primary-700",
    secondary: "bg-gray-100 active:bg-gray-200",
    outline: "border border-primary-600 active:bg-primary-50",
    ghost: "active:bg-gray-100",
  };

  return (
    <Pressable
      className={`${baseClasses} ${variants[variant]} ${sizeClasses[size]}`}
      disabled={loading || props.disabled}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        props.onPress();
      }}
    >
      {loading ? <LoadingSpinner /> : props.children}
    </Pressable>
  );
};
```

**Input com Validação:**

```typescript
interface InputProps {
  label: string;
  error?: string;
  required?: boolean;
  type?: "text" | "email" | "password" | "number";
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
}

const Input: React.FC<InputProps> = ({
  label,
  error,
  required = false,
  ...props
}) => {
  return (
    <View className="space-y-2">
      <Text className="text-gray-700 font-medium">
        {label} {required && <Text className="text-red-500">*</Text>}
      </Text>
      <TextInput
        className={`
          border rounded-lg px-4 py-3 bg-white
          ${error ? "border-red-500" : "border-gray-300"}
          focus:border-primary-500
        `}
        {...props}
      />
      {error && <Text className="text-red-500 text-sm">{error}</Text>}
    </View>
  );
};
```

### 📱 Responsive Design

```typescript
// Hook para dimensões da tela
const useScreenDimensions = () => {
  const [dimensions, setDimensions] = useState(Dimensions.get("window"));

  useEffect(() => {
    const subscription = Dimensions.addEventListener("change", ({ window }) => {
      setDimensions(window);
    });

    return () => subscription?.remove();
  }, []);

  return {
    ...dimensions,
    isSmallScreen: dimensions.width < 380,
    isTablet: dimensions.width > 768,
  };
};

// Uso em componentes
const VehicleCard = () => {
  const { isSmallScreen } = useScreenDimensions();

  return (
    <View
      className={`
      p-4 bg-white rounded-lg shadow-sm border border-gray-200
      ${isSmallScreen ? "mx-2" : "mx-4"}
    `}
    >
      {/* Conteúdo do card */}
    </View>
  );
};
```

## 🌐 Integração com APIs

### 🔌 Cliente HTTP Customizado

```typescript
// utils/api.ts
class ApiClient {
  private baseURL: string;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
  }

  // Método genérico para requisições
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const token = await SecureStore.getItemAsync("accessToken");

    const config: RequestInit = {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
      },
    };

    const response = await fetch(`${this.baseURL}${endpoint}`, config);

    if (response.status === 401) {
      await this.handleTokenRefresh();
      return this.request<T>(endpoint, options);
    }

    if (!response.ok) {
      throw new ApiError(response.status, await response.text());
    }

    return response.json();
  }

  // Métodos convenientes
  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: "GET" });
  }

  async post<T>(endpoint: string, data?: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Upload de arquivos
  async uploadFile<T>(endpoint: string, formData: FormData): Promise<T> {
    const token = await SecureStore.getItemAsync("accessToken");

    const response = await fetch(`${this.baseURL}${endpoint}`, {
      method: "POST",
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: formData,
    });

    if (!response.ok) {
      throw new ApiError(response.status, await response.text());
    }

    return response.json();
  }
}

// Instância global
export const api = new ApiClient(
  process.env.EXPO_PUBLIC_API_URL || "http://localhost:3333",
);
```

### 🔄 Integração com TanStack Query

```typescript
// hooks/useVehicles.ts
export const useVehicles = (businessId: string) => {
  return useInfiniteQuery({
    queryKey: ["vehicles", businessId],
    queryFn: async ({ pageParam = 1 }) => {
      const response = await api.get<VehiclesResponse>(
        `/vehicles?page=${pageParam}&limit=20&businessId=${businessId}`,
      );
      return response;
    },
    getNextPageParam: (lastPage) => lastPage.nextPage,
    enabled: !!businessId,
    staleTime: 5 * 60 * 1000, // 5 minutos
  });
};

// hooks/useFuelCreation.ts
export const useFuelCreation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (fuelData: CreateFuelData) => {
      const formData = new FormData();

      // Dados do formulário
      Object.entries(fuelData.form).forEach(([key, value]) => {
        formData.append(key, String(value));
      });

      // Foto do odômetro
      if (fuelData.odometerPhoto) {
        formData.append("odometerPhoto", {
          uri: fuelData.odometerPhoto.uri,
          type: "image/jpeg",
          name: "odometer.jpg",
        } as any);
      }

      return api.uploadFile<FuelResponse>("/fuel/create-fuel", formData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["fuel-history"] });
    },
  });
};
```

### 🔄 Estados de Loading e Error

```typescript
// Componente de lista com estados
const VehiclesList = () => {
  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useVehicles(businessId);

  if (isLoading) {
    return <VehiclesSkeletonLoader />;
  }

  if (isError) {
    return <ErrorState message={error.message} onRetry={() => refetch()} />;
  }

  const vehicles = data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <FlatList
      data={vehicles}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <VehicleCard vehicle={item} />}
      onEndReached={() => {
        if (hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      }}
      ListFooterComponent={() =>
        isFetchingNextPage ? <LoadingSpinner /> : null
      }
    />
  );
};
```

## 📊 Gerenciamento de Estado

### 🐻 Zustand Store

```typescript
// store/authStore.ts
interface AuthState {
  // Estado
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  // Ações
  login: (email: string, password: string) => Promise<LoginResult>;
  verify2FA: (code: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshTokens: () => Promise<boolean>;
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (email: string, password: string) => {
        set({ isLoading: true });

        try {
          const response = await api.post<LoginResponse>("/user/session", {
            email,
            password,
          });

          if (response.requires2FA) {
            return { requires2FA: true };
          }

          await TokenManager.setTokens(
            response.accessToken,
            response.refreshToken,
          );

          set({
            user: response.user,
            isAuthenticated: true,
            isLoading: false,
          });

          return { success: true };
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      logout: async () => {
        await TokenManager.clearTokens();
        await AsyncStorage.clear();

        set({
          user: null,
          isAuthenticated: false,
        });
      },

      // Outras ações...
    }),
    {
      name: "trajetto-auth",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
```

### 📱 Estado da Aplicação

```typescript
// store/appStore.ts
interface AppState {
  // Estado global da app
  selectedBusiness: Business | null;
  isOnline: boolean;

  // Ações
  setSelectedBusiness: (business: Business) => void;
  setOnlineStatus: (isOnline: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedBusiness: null,
  isOnline: true,

  setSelectedBusiness: (business) => set({ selectedBusiness: business }),
  setOnlineStatus: (isOnline) => set({ isOnline }),
}));

// Hook para verificar status online
export const useNetworkStatus = () => {
  const { isOnline, setOnlineStatus } = useAppStore();

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setOnlineStatus(state.isConnected ?? false);
    });

    return unsubscribe;
  }, [setOnlineStatus]);

  return isOnline;
};
```

## 📝 Validação e Formulários

### 🔍 Schemas de Validação com Zod

```typescript
// schemas/fuelSchemas.ts
export const fuelCreationSchema = z.object({
  // Dados obrigatórios
  vehicleId: z.string().min(1, "Veículo é obrigatório"),
  driverId: z.string().min(1, "Motorista é obrigatório"),
  fuelTypeId: z.string().min(1, "Tipo de combustível é obrigatório"),
  branchId: z.string().min(1, "Filial é obrigatória"),

  // Dados do abastecimento
  currentMileage: z
    .number()
    .min(0, "Quilometragem deve ser positiva")
    .refine((val) => val > 0, "Quilometragem é obrigatória"),

  litersAmount: z
    .number()
    .min(0.1, "Quantidade mínima é 0.1L")
    .max(1000, "Quantidade máxima é 1000L"),

  pricePerLiter: z
    .number()
    .min(0.01, "Preço mínimo é R$ 0.01")
    .max(50, "Preço máximo é R$ 50.00"),

  totalAmount: z.number().min(0.01, "Valor total mínimo é R$ 0.01"),

  refuelingDate: z.date().max(new Date(), "Data não pode ser futura"),

  // Dados opcionais
  notes: z.string().max(500, "Máximo 500 caracteres").optional(),

  // Validação de foto
  odometerPhoto: z.object({
    uri: z.string().min(1, "Foto do odômetro é obrigatória"),
    type: z.string(),
    name: z.string(),
  }),
});

export type FuelCreationForm = z.infer<typeof fuelCreationSchema>;
```

### 📋 Formulários com React Hook Form

```typescript
// components/screens/fuel/FuelCreationForm.tsx
const FuelCreationForm = () => {
  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isValid },
  } = useForm<FuelCreationForm>({
    resolver: zodResolver(fuelCreationSchema),
    mode: "onChange",
  });

  // Watch para cálculo automático
  const litersAmount = watch("litersAmount");
  const pricePerLiter = watch("pricePerLiter");

  // Cálculo automático do total
  useEffect(() => {
    if (litersAmount && pricePerLiter) {
      const total = litersAmount * pricePerLiter;
      setValue("totalAmount", Number(total.toFixed(2)));
    }
  }, [litersAmount, pricePerLiter, setValue]);

  const onSubmit = async (data: FuelCreationForm) => {
    try {
      await createFuel.mutateAsync(data);

      Toast.show({
        type: "success",
        text1: "Abastecimento registrado!",
        text2: "Os dados foram salvos com sucesso.",
      });

      router.back();
    } catch (error) {
      Toast.show({
        type: "error",
        text1: "Erro ao registrar",
        text2: error.message,
      });
    }
  };

  return (
    <ScrollView className="flex-1 bg-gray-50">
      <View className="p-4 space-y-4">
        {/* Seleção de veículo */}
        <Controller
          control={control}
          name="vehicleId"
          render={({ field: { onChange, value } }) => (
            <VehicleSelector
              selectedId={value}
              onSelect={onChange}
              error={errors.vehicleId?.message}
            />
          )}
        />

        {/* Dados de abastecimento */}
        <Controller
          control={control}
          name="currentMileage"
          render={({ field: { onChange, value } }) => (
            <Input
              label="Quilometragem Atual"
              type="number"
              value={value?.toString() || ""}
              onChangeText={(text) => onChange(Number(text))}
              error={errors.currentMileage?.message}
              required
            />
          )}
        />

        {/* Foto do odômetro */}
        <Controller
          control={control}
          name="odometerPhoto"
          render={({ field: { onChange, value } }) => (
            <CameraInput
              label="Foto do Odômetro"
              required
              value={value}
              onChange={onChange}
              error={errors.odometerPhoto?.message}
            />
          )}
        />

        {/* Botão de submit */}
        <Button
          variant="primary"
          disabled={!isValid || createFuel.isLoading}
          loading={createFuel.isLoading}
          onPress={handleSubmit(onSubmit)}
        >
          Registrar Abastecimento
        </Button>
      </View>
    </ScrollView>
  );
};
```

### ✅ Validações Customizadas

```typescript
// utils/validations.ts
export const customValidations = {
  // Validação de quilometragem progressiva
  mileageProgression: (currentMileage: number, lastMileage?: number) => {
    if (lastMileage && currentMileage <= lastMileage) {
      return "Quilometragem deve ser maior que a anterior";
    }
    return true;
  },

  // Validação de foto
  photoValidation: (photo: ImagePickerAsset) => {
    const maxSize = 10 * 1024 * 1024; // 10MB

    if (photo.fileSize && photo.fileSize > maxSize) {
      return "Foto deve ter no máximo 10MB";
    }

    if (!photo.uri) {
      return "Foto é obrigatória";
    }

    return true;
  },

  // Validação de data
  dateValidation: (date: Date) => {
    const now = new Date();
    const oneYearAgo = new Date(
      now.getFullYear() - 1,
      now.getMonth(),
      now.getDate(),
    );

    if (date > now) {
      return "Data não pode ser futura";
    }

    if (date < oneYearAgo) {
      return "Data não pode ser anterior a um ano";
    }

    return true;
  },
};
```

## 📱 Plataformas Suportadas

### 🤖 Android

- **Versão mínima:** Android 6.0 (API 23)
- **Versão recomendada:** Android 8.0+ (API 26+)
- **Arquiteturas:** arm64-v8a, armeabi-v7a
- **Permissões:**
  - `CAMERA` - Captura de fotos
  - `READ_EXTERNAL_STORAGE` - Leitura de galeria
  - `WRITE_EXTERNAL_STORAGE` - Escrita de cache
  - `INTERNET` - Comunicação com APIs

### 🍎 iOS

- **Versão mínima:** iOS 13.0
- **Versão recomendada:** iOS 15.0+
- **Dispositivos:** iPhone 6s+ / iPad Air 2+
- **Permissões:**
  - `NSCameraUsageDescription` - Acesso à câmera
  - `NSPhotoLibraryUsageDescription` - Acesso à galeria

### 🌐 Web (Experimental)

- **Navegadores suportados:**
  - Chrome 90+
  - Safari 14+
  - Firefox 88+
  - Edge 90+

### ⚙️ Configurações de Build

**Android:**

```json
{
  "android": {
    "package": "com.trajetto.fleetmanager",
    "versionCode": 1,
    "compileSdkVersion": 34,
    "targetSdkVersion": 34,
    "buildToolsVersion": "34.0.0"
  }
}
```

**iOS:**

```json
{
  "ios": {
    "bundleIdentifier": "com.trajetto.fleetmanager",
    "buildNumber": "1",
    "deploymentTarget": "13.0"
  }
}
```

## 🤝 Contribuição

### 📝 Guidelines de Contribuição

1. **Fork** o repositório
2. **Crie uma branch** para sua feature (`git checkout -b feature/nova-funcionalidade`)
3. **Siga os padrões** de código estabelecidos
4. **Teste** suas alterações em dispositivos reais
5. **Commit** suas mudanças (`git commit -m 'feat: adiciona nova funcionalidade'`)
6. **Push** para a branch (`git push origin feature/nova-funcionalidade`)
7. **Abra um Pull Request**

### 🔍 Padrões de Código

- **TypeScript** para tipagem estática
- **ESLint** para linting
- **Prettier** para formatação (se configurado)
- **Conventional Commits** para mensagens de commit

### 🧪 Testes

```bash
# Executar testes (quando implementados)
npm test

# Executar testes em watch mode
npm run test:watch

# Verificar cobertura
npm run test:coverage
```

### 📚 Documentação

- Documente **novas funcionalidades** no README
- Adicione **JSDoc** em funções complexas
- Mantenha **schemas atualizados** quando modificar APIs

---

## 📄 Licença

Este projeto está sob a licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

---

<div align="center">

**📱 Trajetto Fleet Manager Mobile**

Desenvolvido com ❤️ para otimizar a gestão de frotas

---

_Versão 1.0.0 • React Native • Expo • TypeScript_

[Website](https://trajetto.com) • [Documentação](https://docs.trajetto.com) • [Suporte](mailto:support@trajetto.com)

</div>
