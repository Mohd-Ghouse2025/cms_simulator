"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { useTenantAuth } from "./useTenantAuth";
import styles from "./LoginPage.module.css";
import { ApiEnvironment, getDefaultApiEnvironment, resolveApiBase } from "@/lib/resolveApiBase";
import { readLastTenantCookie } from "@/lib/authCookies";

export const LoginPage = () => {
  const { login, rememberedTenants, isAuthenticated } = useTenantAuth();
  const router = useRouter();
  const [tenantName, setTenantName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberTenant, setRememberTenant] = useState(true);
  const [status, setStatus] = useState("Waiting for tenant discovery…");
  const [submitting, setSubmitting] = useState(false);
  const [tenantError, setTenantError] = useState<string | null>(null);
  const [preview, setPreview] = useState("");
  const [apiEnvironment, setApiEnvironment] = useState<ApiEnvironment>(() => {
    const envFlag = process.env.NEXT_PUBLIC_DEFAULT_ENV;
    return envFlag && envFlag.toLowerCase() === "local" ? "local" : "remote";
  });

  const tenantPrefilledRef = useRef(Boolean(rememberedTenants[0]));

  useEffect(() => {
    if (tenantPrefilledRef.current) {
      return;
    }
    const lastTenant = readLastTenantCookie();
    if (lastTenant) {
      tenantPrefilledRef.current = true;
      setTenantName(lastTenant);
    }
  }, []);

  useEffect(() => {
    if (tenantPrefilledRef.current) {
      return;
    }
    if (rememberedTenants.length > 0) {
      setTenantName((current) => current || (rememberedTenants[0] ?? ""));
      tenantPrefilledRef.current = true;
    }
  }, [rememberedTenants]);

  useEffect(() => {
    if (isAuthenticated) {
      router.replace("/dashboard");
    }
  }, [isAuthenticated, router]);

  useEffect(() => {
    if (!tenantName) {
      setPreview("");
      setTenantError(null);
      return;
    }
    try {
      const { apiBase } = resolveApiBase(tenantName, undefined, apiEnvironment);
      setPreview(apiBase);
      setTenantError(null);
    } catch (error) {
      setPreview("");
      setTenantError(error instanceof Error ? error.message : "Invalid tenant");
    }
  }, [tenantName, apiEnvironment]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const detected = getDefaultApiEnvironment();
    setApiEnvironment(detected);
  }, []);

  const rememberedOptions = useMemo(
    () => rememberedTenants.filter(Boolean),
    [rememberedTenants]
  );

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (tenantError) {
      setStatus(tenantError);
      return;
    }
    if (!tenantName) {
      setStatus("Please enter a tenant name");
      return;
    }
    let apiBase = "";
    let tenantSlug = "";
    try {
      const result = resolveApiBase(tenantName, undefined, apiEnvironment);
      apiBase = result.apiBase;
      tenantSlug = result.tenant;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Invalid tenant");
      return;
    }
    if (!username || !password) {
      setStatus("Please complete all fields");
      return;
    }
    setSubmitting(true);
    setStatus("Validating tenant health…");
    try {
      await login({
        baseUrl: apiBase,
        tenant: tenantSlug,
        username,
        password,
        rememberTenant
      });
      setStatus("Authenticated successfully");
      router.push("/dashboard");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <Card className={styles.card} title={<span className="heading-md">OCPP Simulator Login</span>}>
        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.helperRow}>
            <label className={styles.label}>
              Tenant name
              <input
                className={`${styles.input} ${tenantError ? styles.inputError : ""}`}
                value={tenantName}
                onChange={(event) => {
                  tenantPrefilledRef.current = true;
                  setTenantName(event.target.value);
                }}
                placeholder="e.g. charger-zone"
                type="text"
                autoComplete="organization"
                required
              />
            </label>
            <div className={styles.helperMeta}>
              <p className={styles.helperText}>
                We’ll connect to{" "}
                {preview ? (
                  <span className={styles.previewChip}>{preview}</span>
                ) : (
                  "your tenant API"
                )}
              </p>
              <button
                type="button"
                onClick={() =>
                  setApiEnvironment((current) => (current === "local" ? "remote" : "local"))
                }
                className={`${styles.environmentButton} ${
                  apiEnvironment === "local"
                    ? styles.environmentButtonLocal
                    : styles.environmentButtonProduction
                }`}
                title={
                  apiEnvironment === "local"
                    ? "Switch to production API"
                    : "Switch to local API"
                }
              >
                {apiEnvironment === "local" ? "Local API" : "Production API"}
              </button>
            </div>
            {tenantError ? <span className={styles.errorText}>{tenantError}</span> : null}
          </div>
          {rememberedOptions.length > 0 ? (
            <div className={styles.remembered}>
              <span>Recently used:</span>
              <div className={styles.rememberedList}>
                {rememberedOptions.map((slug, index) => (
                  <button
                    type="button"
                    key={`${slug}-${index}`}
                    onClick={() => {
                      tenantPrefilledRef.current = true;
                      setTenantName(slug);
                    }}
                    className={styles.rememberedButton}
                  >
                    {slug}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <label className={styles.label}>
            Username
            <input
              className={styles.input}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="user@tenant"
              type="text"
              autoComplete="username"
              required
            />
          </label>
          <label className={styles.label}>
            Password
            <input
              className={styles.input}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={rememberTenant}
              onChange={(event) => setRememberTenant(event.target.checked)}
            />
            Remember Tenant
          </label>
          <div className={styles.actions}>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Signing in…" : "Login"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                tenantPrefilledRef.current = true;
                setTenantName("");
                setUsername("");
                setPassword("");
                setTenantError(null);
                setPreview("");
                setStatus("Waiting for tenant discovery…");
              }}
            >
              Reset
            </Button>
          </div>
          <span className={styles.status}>Status: {status}</span>
        </form>
      </Card>
    </div>
  );
};
