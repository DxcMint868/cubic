import DecisionDetail from "@/components/console/DecisionDetail";

export default async function ConsoleDecision({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DecisionDetail decisionId={id} />;
}
