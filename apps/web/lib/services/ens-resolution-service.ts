import { createAdminClient } from "@/lib/supabase/admin";
import { getFullNameForAddress, resolveAddress } from "@/lib/services/ens-service";
import { extractEnsLabel } from "@/lib/types/ens";
import type { Address } from "viem";

export async function resolveUser(userId: string): Promise<{
  ensName: string | null;
  address: Address | null;
}> {
  const supabase = createAdminClient();

  const { data: user } = await supabase
    .from("users")
    .select("embedded_signer_address")
    .eq("id", userId)
    .single();

  if (!user) {
    return { ensName: null, address: null };
  }

  if (!user.embedded_signer_address) {
    return { ensName: null, address: null };
  }

  const embeddedAddress = user.embedded_signer_address as Address;
  try {
    const ensName = await getFullNameForAddress(embeddedAddress);
    if (!ensName) {
      return { ensName: null, address: embeddedAddress };
    }
    // resolveAddress is cached, so repeated calls across a request are free.
    const address = await resolveAddress(extractEnsLabel(ensName));
    return { ensName, address };
  } catch {
    return { ensName: null, address: embeddedAddress };
  }
}
