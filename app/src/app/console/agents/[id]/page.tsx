import AgentDetail from "@/components/console/AgentDetail";

export default async function ConsoleAgent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AgentDetail agentId={id} />;
}
