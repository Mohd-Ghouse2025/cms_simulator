'use client';

import { useEffect, useMemo } from "react";
import { TenantApiClient } from "@/lib/api";
import { useTenantAuth } from "@/features/auth/useTenantAuth";

export const useTenantApi = () => {
  const { baseUrl, tokens, refreshTokens, logout } = useTenantAuth();

  const client = useMemo(
    () => new TenantApiClient(baseUrl, tokens, refreshTokens, logout),
    [baseUrl, tokens, refreshTokens, logout]
  );

  useEffect(() => {
    client.updateTokens(tokens);
  }, [client, tokens]);

  return client;
};
