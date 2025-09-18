import { z } from "zod";

export const loginSchema = z.object({
  email: z
    .string()
    .min(1, "O e-mail é obrigatório.")
    .email("O e-mail informado não é válido.")
    .max(100, "O e-mail deve ter no máximo 100 caracteres."),
  password: z
    .string()
    .min(7, "A senha deve ter pelo menos 7 caracteres.")
    .max(100, "A senha deve ter no máximo 100 caracteres."),
});

export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .min(1, "O e-mail é obrigatório.")
    .email("O e-mail informado não é válido.")
    .max(100, "O e-mail deve ter no máximo 100 caracteres."),
});

export const twoFactorSchema = z.object({
  code: z
    .string()
    .min(6, "O código deve ter 6 dígitos.")
    .max(6, "O código deve ter 6 dígitos.")
    .regex(/^\d{6}$/, "O código deve conter apenas números."),
});

export type LoginFormData = z.infer<typeof loginSchema>;

export type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;
export type TwoFactorFormData = z.infer<typeof twoFactorSchema>;
