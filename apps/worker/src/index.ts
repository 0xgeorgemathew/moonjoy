export type WorkerHealth = {
  status: "ready";
  responsibilities: string[];
};

export function getWorkerHealth(): WorkerHealth {
  return {
    status: "ready",
    responsibilities: [
      "match timers",
      "quote refresh",
      "valuation refresh",
      "mandatory window assessment",
      "settlement reconciliation",
    ],
  };
}
