# Moon Joy Worker

This workspace is reserved for background runtime behavior:

- match timers
- readiness checks
- stale session cleanup
- quote refresh
- execution monitoring
- settlement and reconciliation

Keep request/response behavior in `apps/web`. Keep pure rules in `packages/game`.
