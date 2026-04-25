## Bun

This is a Bun Repo.

## Project

This is not a production project. It is a dev project.
It only need hackathon level quality.

## Dev Server

Do not run the dev server.
Always assume its running.

## Moon Joy — Design Direction

Moon Joy is a PvP crypto trading game. Two players compete by trading on Uniswap (Base), starting with USDC. Highest PnL wins. The aesthetic is lunar — "to the moon" energy: sharp, competitive, aspirational.

**Display font: Space Grotesk** — heavy, bold, uppercase "Command Headlines." Industrial reliability with high x-height and wide apertures. Loaded via `next/font/google` as `--font-display`, exposed as Tailwind `font-display`.

**Body font: Manrope** — clean and geometric. Maintains legibility during high-intensity trading. Loaded via `next/font/google` as `--font-body`, exposed as Tailwind `font-body`.

**Label font: Inter** — reserved for technical data, coordinates, and micro-stats. Loaded via `next/font/google` as `--font-label`, exposed as Tailwind `font-label`.

**Theme direction**: "Interstellar Brutalism" — deep space blue surfaces, neon green primary (#8eff71), brushed metal secondary (#cbe2fe/#8ba1bb). No 1px solid borders. Tonal layering for depth. Glassmorphism for overlays. Uppercase headings. "Lunar Command" energy — competitive, tactical, electric.

## Rules for Adding New Files

1. **New component** → `components/<feature>-<name>.tsx` (e.g., `arena-pnl-chart.tsx`). Use kebab-case. One component per file. No barrel/index files.
2. **New page/route** → Standard App Router path. Each page is independent — no conflicts.
3. **New API route** → `app/api/<resource>/route.ts` or `app/api/<resource>/<id>/route.ts`. One route per file.
4. **New service** → `lib/services/<name>-service.ts`. One service per file. Import directly, no barrel files.
5. **New hook** → `lib/hooks/use-<name>.ts`. One hook per file.
6. **New type** → Add to the appropriate file in `lib/types/`. If it's a new domain, create a new file and import it directly — don't update `lib/types/index.ts` unless coordinating.
7. **New migration** → `supabase/migrations/<timestamp>_<name>.sql`. Sequential by nature — pull before creating.

## Git Workflow

1. **Pull frequently** — `git pull --rebase` at least every 30 minutes, or before starting any new file.
2. **Commit often** — Small, focused commits make rebase trivial.
3. **Commit message format** — `feat(<feature>): description` or `fix(<feature>): description` (e.g., `feat(arena): add PnL chart`, `fix(wallet): delegate timeout`).
4. **If a rebase conflicts** — Resolve locally. If the conflict is in a shared file, ask the other dev before choosing which version to keep.
5. **Push regularly** — Don't let your local branch diverge by more than a few commits.
