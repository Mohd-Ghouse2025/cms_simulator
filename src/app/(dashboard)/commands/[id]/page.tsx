import { notFound } from "next/navigation"
import { CommandDetailPage } from "@/features/commands/CommandDetailPage"

type CommandDetailRouteProps = {
  params: Promise<{
    id: string
  }>
}

export default async function CommandDetailRoute({ params }: CommandDetailRouteProps) {
  const { id } = await params
  const commandId = Number(id)
  if (!Number.isFinite(commandId)) {
    notFound()
  }
  return <CommandDetailPage commandId={commandId} />
}
