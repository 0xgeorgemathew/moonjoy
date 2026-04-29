import { formatEther, parseEther } from "viem";
import { cachedEnsRead } from "@/lib/services/ens-cache";
import { getEnsPublicClient } from "@/lib/services/ens-service";

export const THEORETICAL_MAX_AGENT_GAS_RESERVE_WEI = parseEther("0.003");

export type AgentFundingStatus = {
  owner: string;
  nativeBalanceWei: string;
  nativeBalanceEth: string;
  theoreticalMaxGasReserveWei: string;
  theoreticalMaxGasReserveEth: string;
  gasReserveSatisfied: boolean;
  gasReserveShortfallWei: string;
};

export async function getAgentFundingStatus(
  smartAccountAddress: string,
): Promise<AgentFundingStatus> {
  const normalizedAddress = smartAccountAddress.toLowerCase();
  const balance = await cachedEnsRead(
    "chain.balance",
    normalizedAddress,
    () =>
      getEnsPublicClient().getBalance({
        address: smartAccountAddress as `0x${string}`,
      }),
    15_000,
  );

  const shortfall =
    balance >= THEORETICAL_MAX_AGENT_GAS_RESERVE_WEI
      ? BigInt(0)
      : THEORETICAL_MAX_AGENT_GAS_RESERVE_WEI - balance;

  return {
    owner: smartAccountAddress,
    nativeBalanceWei: balance.toString(),
    nativeBalanceEth: formatEther(balance),
    theoreticalMaxGasReserveWei: THEORETICAL_MAX_AGENT_GAS_RESERVE_WEI.toString(),
    theoreticalMaxGasReserveEth: formatEther(THEORETICAL_MAX_AGENT_GAS_RESERVE_WEI),
    gasReserveSatisfied: shortfall === BigInt(0),
    gasReserveShortfallWei: shortfall.toString(),
  };
}
