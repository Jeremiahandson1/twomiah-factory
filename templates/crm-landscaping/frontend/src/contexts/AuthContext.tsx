// Auth context — shared implementation (packages/tenant-ui/src/auth/AuthContext.tsx), vendored as ../shared.
// This file hands the shared provider this template's api client; everything else keeps importing useAuth from here.
import React from 'react';
import api from '../services/api';
import { AuthProvider as SharedAuthProvider, useAuth } from '../shared';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SharedAuthProvider api={api as any}>{children}</SharedAuthProvider>;
}

export { useAuth };
