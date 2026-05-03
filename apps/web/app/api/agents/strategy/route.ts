import { type NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUserId, AuthError } from "@/lib/auth/server";
import { createStrategy, listStrategies, AgentBootstrapError } from "@/lib/services/agent-bootstrap-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAgentStrategy } from "@/lib/services/public-strategy-service";
import type { McpRuntimeContext } from "@/lib/types/mcp";
import type { StrategyKind, StrategySourceType } from "@/lib/types/strategy";

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("mode");
  if (mode === "mine") {
    let privyUserId: string;
    try {
      privyUserId = await getAuthenticatedUserId(request);
    } catch (error) {
      const status = error instanceof AuthError ? error.statusCode : 401;
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unauthorized" },
        { status },
      );
    }

    const supabase = createAdminClient();
    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("privy_user_id", privyUserId)
      .maybeSingle();

    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const { data: agent } = await supabase
      .from("agents")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (!agent) {
      return NextResponse.json({ error: "Active agent not found." }, { status: 404 });
    }

    const { data: strategies, error } = await supabase
      .from("strategies")
      .select("id, name, strategy_kind, source_type, status, manifest_body, manifest_pointer, created_at, updated_at")
      .eq("agent_id", agent.id)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: "Failed to load strategies." }, { status: 500 });
    }

    const activePublicStrategy =
      (strategies ?? []).find(
        (strategy) => strategy.status === "active" && strategy.strategy_kind === "public",
      ) ?? null;
    const activeSecretStrategy =
      (strategies ?? []).find(
        (strategy) => strategy.status === "active" && strategy.strategy_kind === "secret_sauce",
      ) ?? null;

    return NextResponse.json({
      strategies: strategies ?? [],
      activeStrategyId: activePublicStrategy?.id ?? null,
      activeSecretStrategyId: activeSecretStrategy?.id ?? null,
      activeStrategyIds: {
        public: activePublicStrategy?.id ?? null,
        secret_sauce: activeSecretStrategy?.id ?? null,
      },
    });
  }

  const ens = request.nextUrl.searchParams.get("ens");
  if (!ens) {
    return NextResponse.json(
      { error: "Missing required query parameter: ens" },
      { status: 400 },
    );
  }

  const manifest = await resolveAgentStrategy(ens);
  if (!manifest) {
    return NextResponse.json(
      { error: "No public strategy found for this agent." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ens, manifest });
}

type CreateStrategyRequest = {
  name?: string;
  strategyKind?: StrategyKind;
  sourceType?: StrategySourceType;
  manifestBody?: Record<string, unknown>;
  activate?: boolean;
};

export async function POST(request: Request) {
  let privyUserId: string;
  try {
    privyUserId = await getAuthenticatedUserId(request);
  } catch (error) {
    const status = error instanceof AuthError ? error.statusCode : 401;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status },
    );
  }

  let body: CreateStrategyRequest;
  try {
    body = (await request.json()) as CreateStrategyRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }

  if (!body.manifestBody || typeof body.manifestBody !== "object" || Array.isArray(body.manifestBody)) {
    return NextResponse.json({ error: "manifestBody must be an object." }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("privy_user_id", privyUserId)
    .maybeSingle();

  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const { data: agent } = await supabase
    .from("agents")
    .select("id, smart_account_address")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (!agent?.smart_account_address) {
    return NextResponse.json(
      { error: "Active agent smart account is required before uploading a strategy." },
      { status: 409 },
    );
  }

  const { data: approval } = await supabase
    .from("mcp_approvals")
    .select("id, client_name, mcp_subject, scopes, execution_signer_id, execution_key_expires_at")
    .eq("agent_id", agent.id)
    .eq("status", "active")
    .maybeSingle();

  const context: McpRuntimeContext = {
    approvalId: approval?.id ?? "",
    agentId: agent.id,
    userId: user.id,
    privyUserId,
    clientName: approval?.client_name ?? "Moonjoy Web",
    subject: approval?.mcp_subject ?? `moonjoy:web:${agent.id}`,
    scopes: Array.isArray(approval?.scopes) ? approval.scopes : [],
    smartAccountAddress: agent.smart_account_address,
    executionSignerId: approval?.execution_signer_id ?? null,
    executionKeyExpiresAt: approval?.execution_key_expires_at ?? null,
    requestOrigin: "agents-ui",
  };

  try {
    const result = await createStrategy(context, {
      name: body.name,
      strategyKind: body.strategyKind ?? "public",
      sourceType: body.sourceType ?? "agent_generated_plan",
      manifestBody: body.manifestBody,
      activate: body.activate ?? true,
      publishPublicPointer: false,
    });

    const listing = await listStrategies(context, false);

    return NextResponse.json(
      {
        ...result,
        publicPointerDeferred: true,
        note:
          body.strategyKind === "secret_sauce"
            ? "Secret sauce uploaded to 0G as an encrypted blob and saved locally. Publish moonjoy:secret_sauce from the browser wallet when ready."
            : "Strategy uploaded to 0G and saved locally. Publish moonjoy:strategy from the browser wallet when ready.",
        strategies: listing.strategies,
        activeStrategyId: listing.activeStrategyId,
        activeSecretStrategyId: listing.activeSecretStrategyId,
        activeStrategyIds: listing.activeStrategyIds,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AgentBootstrapError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[agents/strategy] Unexpected error", error);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
