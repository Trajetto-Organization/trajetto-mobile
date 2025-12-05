export type UserRole = "MASTER" | "BUSINESS_ADMIN" | "BUSINESS_USER";

export type PermissionKey =
  | "branch_manage"
  | "profile_access_manage"
  | "user_permission_manage"
  | "user_registration_manage"
  | "part_manage"
  | "supplier_manage"
  | "vehicle_type_manage"
  | "fuel_type_manage"
  | "driver_manage"
  | "service_order_manage"
  | "service_order_part_manage"
  | "vehicle_manage"
  | "account_payable_manage"
  | "kanban_manage"
  | "fine_manage"
  | "fuel_manage"
  | "vehicle_checklist_manage";

export interface Permission {
  permissionKey: PermissionKey;
  canRead: boolean;
  canWrite: boolean;
}

export interface ProfileAccess {
  name: string;
  permissions: Permission[];
}

export interface User {
  id: string;
  businessId?: string | null;
  selectedBusiness?: string | null;
  role: UserRole;
  email: string;
  name: string;
  two_factor_enabled?: boolean;
  avatar?: string | null;
  profileAccess?: ProfileAccess | null;
  driverId?: string | null;
  driver?: {
    id: string;
    status: string;
  } | null;
  email_notifications_enabled?: boolean;
  activity_notifications_enabled?: boolean;
  access_revoked?: boolean;
}

export interface UserMeResponse {
  message: string;
  user: User;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResponse {
  message: string;
  token: string;
  refresh_token: string;
  user: User;
  role: UserRole;
}

export interface TwoFactorRequiredResponse {
  message: string;
  twoFactorVerification: boolean;
}

export interface EmailVerificationResponse {
  message: string;
  emailVerification: boolean;
}

export interface TwoFactorVerificationResponse {
  message: string;
  token: string;
  refresh_token: string;
  role: UserRole;
}

export interface RefreshTokenResponse {
  token: string;
  refresh_token: string;
}

export interface JWTPayload {
  sub: string;
  businessId?: string;
  role: UserRole;
  permissions?: Permission[];
  exp: number;
  iat: number;
}

export interface AuthState {
  user: User | null;
  tokens: AuthTokens | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (
    email: string,
    password: string
  ) => Promise<{
    success: boolean;
    error?: string;
    requiresTwoFactor?: boolean;
    requiresEmailVerification?: boolean;
    email?: string;
  }>;
  verifyTwoFactor: (
    email: string,
    code: string
  ) => Promise<{ success: boolean; error?: string }>;
  resendTwoFactorCode: (
    email: string
  ) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<boolean>;
  checkAuth: () => Promise<void>;
  setUser: (user: User) => void;
}

export interface ForgotPasswordResponse {
  message: string;
}

export interface Business {
  id: string;
  name: string;
  document: string;
}
