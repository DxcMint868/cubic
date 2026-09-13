import TraceView from "@/components/console/TraceView";

export default async function ConsoleTaskTrace({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TraceView taskId={id} />;
}
