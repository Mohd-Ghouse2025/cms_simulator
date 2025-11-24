'use client'

import type { ReactNode } from "react"
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useTenantAuth } from "@/features/auth/useTenantAuth"
import { AppShell } from "@/components/layout/AppShell"

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { isAuthenticated, hydrated } = useTenantAuth()
  const router = useRouter()

  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      router.replace("/login")
    }
  }, [hydrated, isAuthenticated, router])

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-text-secondary">
        Checking session…
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-text-secondary">
        Redirecting to login…
      </div>
    )
  }

  return <AppShell>{children}</AppShell>
}
