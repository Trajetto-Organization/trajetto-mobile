import type { PropsWithChildren, ReactNode } from "react";

import { Redirect } from "expo-router";
import { Text, View } from "react-native";

import { useAuthStore } from "../store";
import { validateUserAccess } from "../utils/permissions";

import { accessNotice } from "../features/access/access-messages";

import { LoadingSpinner } from "./ui";
import { SignOutButton } from "./ui/logout-modal";

interface ProtectedRouteProps extends PropsWithChildren {
  fallback?: ReactNode;
}

export const ProtectedRoute = ({ children, fallback }: ProtectedRouteProps) => {
  const user = useAuthStore((state) => state.user);

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);

  const isInitialized = useAuthStore((state) => state.isInitialized);

  if (!isInitialized || isLoading) {
    return (
      <LoadingSpinner text="Verificando permissões..." className="bg-background" />
    );
  }

  if (!isAuthenticated || !user) {
    return fallback ?? <Redirect href="/login" />;
  }

  const accessValidation = validateUserAccess(user);
  if (!accessValidation.hasAccess) {
    const { title, message } = accessNotice(accessValidation.reason);

    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <View className="mb-6 h-20 w-20 items-center justify-center rounded-full bg-destructive-soft">
          <Text className="text-2xl text-destructive">!</Text>
        </View>
        <Text className="mb-4 text-center text-xl font-bold text-ink">
          {title}
        </Text>
        <Text className="mb-8 text-center text-muted">{message}</Text>

        {/* Signing out here leaves this account's queued submissions on the
            phone, so it warns first like the drawer does (MOB-15). */}
        <SignOutButton />
      </View>
    );
  }

  return <>{children}</>;
};
