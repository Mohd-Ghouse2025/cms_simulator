import { notFound } from "next/navigation"
import { SimulatorDetailPage } from "@/features/simulators/SimulatorDetailPage"

type SimulatorDetailRouteProps = {
  params: Promise<{
    id: string
  }>
}

export default async function SimulatorDetailRoute({ params }: SimulatorDetailRouteProps) {
  const { id } = await params
  const simulatorId = Number(id)
  if (!Number.isFinite(simulatorId)) {
    notFound()
  }
  return <SimulatorDetailPage simulatorId={simulatorId} />
}
