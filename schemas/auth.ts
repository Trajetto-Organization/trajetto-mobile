import { z } from "zod";

// Trimmed before checking, as the web does (decision 16.702): an
// autocompleted address often arrives with a trailing space on a phone, and
// the trimmed value is what is sent.
const emailField = z
  .string()
  .trim()
  .min(1, "O e-mail é obrigatório.")
  .email("O e-mail informado não é válido.")
  .max(100, "O e-mail deve ter no máximo 100 caracteres.");

export const loginSchema = z.object({
  email: emailField,
  password: z
    .string()
    // Missing is said as missing, before the length rule (decision 16.702).
    .min(1, "A senha é obrigatória.")
    .min(7, "A senha deve ter pelo menos 7 caracteres.")
    .max(100, "A senha deve ter no máximo 100 caracteres."),
});

export const forgotPasswordSchema = z.object({
  email: emailField,
});

export const twoFactorSchema = z.object({
  code: z
    .string()
    // Missing is said as missing: the button is enabled with no digits typed.
    .min(1, "Digite o código de 6 dígitos.")
    .min(6, "O código deve ter 6 dígitos.")
    .max(6, "O código deve ter 6 dígitos.")
    .regex(/^\d{6}$/, "O código deve conter apenas números."),
});

export type LoginFormData = z.infer<typeof loginSchema>;

export type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;
export type TwoFactorFormData = z.infer<typeof twoFactorSchema>;
