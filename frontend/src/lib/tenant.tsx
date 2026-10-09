import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export const DEFAULT_TENANT = "11111111-2222-3333-4444-555555555555";
const STORAGE_KEY = "trustgraph.tenant";

export const TENANT_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TenantContextValue {
  tenant: string;
  setTenant: (tenant: string) => void;
}

const TenantContext = createContext<TenantContextValue | null>(null);

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const [tenant, setTenantState] = useState<string>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored && TENANT_PATTERN.test(stored) ? stored : DEFAULT_TENANT;
    } catch {
      return DEFAULT_TENANT;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, tenant);
    } catch {
      // storage unavailable (private mode) — session-only tenant is fine
    }
  }, [tenant]);

  const setTenant = useCallback((next: string) => {
    if (TENANT_PATTERN.test(next)) setTenantState(next);
  }, []);

  const value = useMemo(() => ({ tenant, setTenant }), [tenant, setTenant]);
  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantContextValue {
  const context = useContext(TenantContext);
  if (!context) throw new Error("useTenant must be used inside TenantProvider");
  return context;
}
