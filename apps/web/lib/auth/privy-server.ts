import { PrivyClient } from "@privy-io/node";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID!;
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET!;

let _client: PrivyClient | null = null;

export function getPrivyServerClient(): PrivyClient {
  if (!_client) {
    _client = new PrivyClient({
      appId: PRIVY_APP_ID,
      appSecret: PRIVY_APP_SECRET,
    });
  }
  return _client;
}
