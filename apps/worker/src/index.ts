import { getAvailableMatchActions, type MatchReadiness } from "@moonjoy/game";

export type WorkerHealth = {
  status: "ready";
  availableActions: string[];
};

export function getWorkerHealth(readiness: MatchReadiness): WorkerHealth {
  return {
    status: "ready",
    availableActions: getAvailableMatchActions("accepted", readiness),
  };
}
