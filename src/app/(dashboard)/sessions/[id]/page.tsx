import { notFound } from "next/navigation"
import { SessionDetailPage } from "@/features/sessions/SessionDetailPage"

type SessionDetailRouteProps = {
  params: Promise<{
    id: string
  }>
}

export default async function SessionDetailRoute({ params }: SessionDetailRouteProps) {
  const { id } = await params
  const sessionId = Number(id)
  if (!Number.isFinite(sessionId)) {
    notFound()
  }
  return <SessionDetailPage sessionId={sessionId} />
}
