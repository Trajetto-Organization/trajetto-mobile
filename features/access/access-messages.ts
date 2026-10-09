/**
 * What the app tells a person whose access ended or was refused.
 *
 * One table for the three places that say it: the access-denied screen
 * (`ProtectedRoute`), the sign-in and session check (`auth-store`) and the
 * realtime security event (`SocketProvider`). Each kept its own copy, and
 * the three drifted apart — in wording, and in all of them losing their
 * accents (MOB-18). A reason the API stopped sending (`no_vehicle_permission`,
 * CRIT-20) also lived on in all three.
 *
 * Pure and import-free, so the wording is tested where it is decided.
 */

interface AccessNotice {
  title: string;
  message: string;
}

const CONTACT_ADMIN = "Entre em contato com o administrador.";
const SIGN_IN_AGAIN = "Faça login novamente.";

/**
 * Keyed by the reasons `validateUserAccess` returns and every session-ending
 * `securityAction` reason the API sends (the `sendSecurityEventTo*` calls and
 * trajetto-api `socket-revalidation.ts`; security-action-reasons.test.ts
 * reads them), plus the two session endings the sign-in flow reports.
 * `logout` is left to the generic ending: it is this session's own sign-out.
 */
const ACCESS_NOTICES: Readonly<Record<string, AccessNotice>> = {
  access_revoked: {
    title: "Acesso revogado",
    message: `Seu acesso foi revogado. ${CONTACT_ADMIN}`,
  },
  access_denied: {
    title: "Acesso negado",
    message: "Sua conta foi excluída ou não está autorizada.",
  },
  driver_inactive: {
    title: "Motorista inativo",
    message: `Seu cadastro como motorista está inativo. ${CONTACT_ADMIN}`,
  },
  no_permissions: {
    title: "Sem permissões",
    message: `Seu usuário não possui um perfil de acesso com permissões configuradas. ${CONTACT_ADMIN}`,
  },
  permissions_changed: {
    title: "Permissões atualizadas",
    message: `Suas permissões foram atualizadas. ${SIGN_IN_AGAIN}`,
  },
  session_expired: {
    title: "Sessão expirada",
    message: `Sua sessão expirou. ${SIGN_IN_AGAIN}`,
  },
  session_not_renewed: {
    title: "Sessão encerrada",
    message: `Não foi possível renovar sua sessão. ${SIGN_IN_AGAIN}`,
  },
  user_updated: {
    title: "Acesso alterado",
    message: `Seus dados de acesso foram alterados. ${SIGN_IN_AGAIN}`,
  },
  role_changed: {
    title: "Perfil alterado",
    message: `Seu perfil de acesso foi alterado. ${SIGN_IN_AGAIN}`,
  },
  password_changed: {
    title: "Senha alterada",
    message: "Sua senha foi alterada. Faça login com a nova senha.",
  },
  password_reset: {
    title: "Senha redefinida",
    message: "Sua senha foi redefinida. Faça login com a nova senha.",
  },
  session_compromised: {
    title: "Sessão encerrada",
    message: `Por segurança, sua sessão foi encerrada. ${SIGN_IN_AGAIN}`,
  },
  // Decision 4.1: an inactive company is told as such, not as a revoked or
  // deleted account.
  business_inactive: {
    title: "Empresa desativada",
    message: `A empresa está desativada. ${CONTACT_ADMIN}`,
  },
  branch_inactive: {
    title: "Filial desativada",
    message: `A filial do seu cadastro de motorista está desativada. ${CONTACT_ADMIN}`,
  },
};

/**
 * The reason a refused `/user/me` (403) ends the session with, by the API's
 * code. The session check used to call every refusal "access_denied" ("Sua
 * conta foi excluída ou não está autorizada"), an inactive company included.
 *
 * Same reasons as trajetto-api `socket-revalidation.ts`
 * REASON_BY_ELIGIBILITY_CODE, so the HTTP fallback and the live event agree,
 * except where decision 4.1 wants the company or branch named.
 */
const REASON_BY_REFUSAL_CODE: Readonly<Record<string, string>> = {
  AUTH_ACCESS_REVOKED: "access_revoked",
  AUTH_BUSINESS_REQUIRED: "access_denied",
  AUTH_BUSINESS_INACTIVE: "business_inactive",
  TENANT_INACTIVE: "business_inactive",
  AUTH_DRIVER_INACTIVE: "driver_inactive",
  AUTH_DRIVER_TENANT_MISMATCH: "driver_inactive",
  AUTH_BRANCH_INACTIVE: "branch_inactive",
  AUTH_PROFILE_NOT_CONFIGURED: "no_permissions",
};

function refusalReason(code: string | undefined): string {
  return code && Object.prototype.hasOwnProperty.call(REASON_BY_REFUSAL_CODE, code)
    ? REASON_BY_REFUSAL_CODE[code]
    : "access_denied";
}

/** The access-denied screen, for a reason it has no copy of its own for. */
const ACCESS_DENIED_NOTICE: AccessNotice = {
  title: "Acesso negado",
  message: `Você não tem permissão para acessar esta funcionalidade. ${CONTACT_ADMIN}`,
};

/** Sign-in refused for a reason this build does not know. */
const SIGN_IN_REFUSED_MESSAGE = `Acesso negado. ${CONTACT_ADMIN}`;

/** A realtime security event whose reason this build does not know. */
const SESSION_ENDED_MESSAGE = `Sua sessão foi encerrada. ${SIGN_IN_AGAIN}`;

// Own keys only: the reason comes from the server, and "constructor" must
// not find Object's.
const lookup = (reason: string | undefined): AccessNotice | undefined =>
  reason && Object.prototype.hasOwnProperty.call(ACCESS_NOTICES, reason)
    ? ACCESS_NOTICES[reason]
    : undefined;

function accessNotice(
  reason: string | undefined,
  fallback: AccessNotice = ACCESS_DENIED_NOTICE,
): AccessNotice {
  return lookup(reason) ?? fallback;
}

function accessMessage(reason: string | undefined, fallback: string): string {
  return lookup(reason)?.message ?? fallback;
}

export {
  ACCESS_DENIED_NOTICE,
  ACCESS_NOTICES,
  SESSION_ENDED_MESSAGE,
  REASON_BY_REFUSAL_CODE,
  SIGN_IN_REFUSED_MESSAGE,
  accessMessage,
  accessNotice,
  refusalReason,
};

export type { AccessNotice };
