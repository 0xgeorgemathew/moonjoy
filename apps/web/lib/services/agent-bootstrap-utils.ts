import { createHash } from "node:crypto";

const MAX_ENS_LABEL_LENGTH = 32;
const AGENT_LABEL_PREFIX = "agent-";
const MAX_USER_LABEL_LENGTH_FOR_DERIVED_AGENT =
  MAX_ENS_LABEL_LENGTH - AGENT_LABEL_PREFIX.length;

export function deriveAgentLabel(userLabel: string): {
  ok: true;
  label: string;
  ensName: string;
} | {
  ok: false;
  reason: string;
  maxUserLabelLength: number;
} {
  const normalizedUserLabel = userLabel.trim().toLowerCase();
  if (!normalizedUserLabel) {
    return {
      ok: false,
      reason: "User ENS label is required before deriving an agent label.",
      maxUserLabelLength: MAX_USER_LABEL_LENGTH_FOR_DERIVED_AGENT,
    };
  }

  if (normalizedUserLabel.length > MAX_USER_LABEL_LENGTH_FOR_DERIVED_AGENT) {
    return {
      ok: false,
      reason: `Derived agent label would exceed ${MAX_ENS_LABEL_LENGTH} characters.`,
      maxUserLabelLength: MAX_USER_LABEL_LENGTH_FOR_DERIVED_AGENT,
    };
  }

  const label = `${AGENT_LABEL_PREFIX}${normalizedUserLabel}`;
  return {
    ok: true,
    label,
    ensName: `${label}.moonjoy.eth`,
  };
}

export function buildStrategyPointer(
  manifestBody: Record<string, unknown>,
): string {
  const canonicalJson = JSON.stringify(sortValue(manifestBody));
  const digest = createHash("sha256").update(canonicalJson).digest("hex");
  return `sha256:${digest}`;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortValue(nestedValue)]),
    );
  }

  return value;
}

export { MAX_USER_LABEL_LENGTH_FOR_DERIVED_AGENT };
