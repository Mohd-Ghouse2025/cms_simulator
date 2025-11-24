'use client'

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { useState } from "react"
import { TenantAuthProvider } from "@/features/auth/TenantAuthContext"
import { NotificationOutlet } from "@/components/layout/NotificationOutlet"
import { ApiError } from "@/lib/api"
import { useNotificationStore } from "@/store/notificationStore"

const handleQueryError = (error: unknown) => {
  const { pushToast } = useNotificationStore.getState()
  if (error instanceof ApiError) {
    if (error.status >= 500) {
      pushToast({
        title: "Server error",
        description: "The CMS could not process the request. Please try again shortly.",
        level: "error",
        timeoutMs: 5000,
      })
    }
    return
  }
  pushToast({
    title: "Request failed",
    description: error instanceof Error ? error.message : "Unexpected error",
    level: "warning",
    timeoutMs: 4000,
  })
}

const createQueryClient = () =>
  new QueryClient({
    queryCache: new QueryCache({
      onError: handleQueryError,
    }),
    mutationCache: new MutationCache({
      onError: handleQueryError,
    }),
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 10_000,
      },
    },
  })

type AppProvidersProps = {
  children: ReactNode
}

export const AppProviders = ({ children }: AppProvidersProps) => {
  const [queryClient] = useState(() => createQueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      <TenantAuthProvider>
        {children}
        <NotificationOutlet />
      </TenantAuthProvider>
    </QueryClientProvider>
  )
}
