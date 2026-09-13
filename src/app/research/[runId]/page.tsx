import { ResearchWorkspace } from "@/components/research-workspace";

export default async function ResearchRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return <ResearchWorkspace runId={runId} />;
}
