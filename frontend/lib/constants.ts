export const AGENT_STAGES = [
  "understand",
  "retrieve",
  "plan",
  "tool_result",
  "verify",
  "reflection",
  "final",
  "error",
  "reject",
] as const;

export type AgentStage = typeof AGENT_STAGES[number];

export const STAGE_LABELS: Record<AgentStage, string> = {
  understand: "Understand",
  retrieve: "Retrieve",
  plan: "Plan",
  tool_result: "Act",
  verify: "Verify",
  reflection: "Reflect",
  final: "Final",
  error: "Error",
  reject: "Rejected",
};

export function getStageLabel(stage?: string | null): string {
  if (!stage) {
    return "Pending";
  }
  if ((AGENT_STAGES as readonly string[]).includes(stage)) {
    return STAGE_LABELS[stage as AgentStage];
  }
  return stage.replace(/_/g, " ");
}
