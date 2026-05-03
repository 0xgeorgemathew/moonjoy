export const STRATEGY_SOURCE_TYPES = [
  "user_prompt",
  "md_context",
  "agent_generated_plan",
  "keeperhub_workflow",
  "default_behavior",
] as const;

export type StrategySourceType = (typeof STRATEGY_SOURCE_TYPES)[number];

export const STRATEGY_KINDS = ["public", "secret_sauce"] as const;

export type StrategyKind = (typeof STRATEGY_KINDS)[number];

export const STRATEGY_STATUSES = ["draft", "active", "archived"] as const;

export type StrategyStatus = (typeof STRATEGY_STATUSES)[number];

export type StrategyRecord = {
  id: string;
  user_id: string;
  agent_id: string;
  agent_smart_account_address: string;
  name: string;
  strategy_kind: StrategyKind;
  source_type: StrategySourceType;
  manifest_body: Record<string, unknown>;
  manifest_pointer: string;
  local_revision: number;
  status: StrategyStatus;
  created_at: string;
  updated_at: string;
};

export type StrategyDecisionRecord = {
  id: string;
  strategy_id: string;
  match_id: string | null;
  trade_id: string | null;
  rationale: string;
  created_at: string;
};
