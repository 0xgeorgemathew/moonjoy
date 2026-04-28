import { getPrivyServerClient } from "@/lib/auth/privy-server";

export async function getAuthenticatedUserId(
  request: Request,
): Promise<string> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AuthError("Missing authorization header", 401);
  }

  const token = authHeader.slice(7);

  try {
    const privy = getPrivyServerClient();
    const claims = await privy.utils().auth().verifyAccessToken(token);
    return claims.user_id;
  } catch (err) {
    console.error("[auth] Token verification failed:", err);
    throw new AuthError("Invalid or expired access token", 401);
  }
}

export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}
