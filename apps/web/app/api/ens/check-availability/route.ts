import { NextResponse } from "next/server";
import { getAuthenticatedUserId, AuthError } from "@/lib/auth/server";
import {
  checkAvailability,
  validateEnsLabel,
} from "@/lib/services/ens-service";

export async function POST(request: Request) {
  try {
    await getAuthenticatedUserId(request);
  } catch (err) {
    const status = err instanceof AuthError ? err.statusCode : 401;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unauthorized" },
      { status },
    );
  }

  let body: { label?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { label } = body;
  if (!label || typeof label !== "string") {
    return NextResponse.json(
      { error: "Label is required" },
      { status: 400 },
    );
  }

  const validation = validateEnsLabel(label);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  let onchainAvailable: boolean;
  try {
    onchainAvailable = await checkAvailability(label);
  } catch (err) {
    console.error("[ens/check-availability] Onchain check failed:", err);
    return NextResponse.json(
      { error: "Failed to check onchain availability" },
      { status: 502 },
    );
  }

  return NextResponse.json({ available: onchainAvailable, label });
}
