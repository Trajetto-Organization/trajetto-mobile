import React from "react";

import { QueryProvider } from "./query-provider";
import { ToastProvider } from "./toast-provider";

import { AuthProvider } from "./auth-provider";
import { SocketProvider } from "./socket-provider";

interface ProvidersProps {
  children: React.ReactNode;
}

export const Providers: React.FC<ProvidersProps> = ({ children }) => {
  return (
    <QueryProvider>
      <AuthProvider>
        <SocketProvider>
          <ToastProvider>{children}</ToastProvider>
        </SocketProvider>
      </AuthProvider>
    </QueryProvider>
  );
};
