import React, { useEffect } from 'react';
import { useAuthStore } from '../store';

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const { checkAuth, isInitialized } = useAuthStore();

  useEffect(() => {
    // Initialize auth state when app starts
    if (!isInitialized) {
      checkAuth();
    }
  }, [checkAuth, isInitialized]);

  return <>{children}</>;
};