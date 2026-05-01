-- Fix match_invites RLS policy to use (select auth.role()) for stable initplan evaluation
-- Prevents planner issues with direct auth.role() calls in policy expressions

DROP POLICY IF EXISTS "match_invites_service_role_only" ON public.match_invites;

CREATE POLICY "match_invites_service_role_only" ON public.match_invites
  FOR ALL
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');
