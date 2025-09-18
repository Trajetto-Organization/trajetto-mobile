import React from "react";

import { QueryProvider } from "./query-provider";
import { ToastProvider } from "./toast-provider";

import { AuthProvider } from "./auth-provider";

interface ProvidersProps {
  children: React.ReactNode;
}

export const Providers: React.FC<ProvidersProps> = ({ children }) => {
  return (
    <QueryProvider>
      <AuthProvider>
        <ToastProvider>{children}</ToastProvider>
      </AuthProvider>
    </QueryProvider>
  );
};
