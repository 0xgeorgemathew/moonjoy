-- Finish numeric amount normalization for the bidirectional trade balance guard.

do $$
declare
  v_function_sql text;
begin
  select pg_get_functiondef(
    'public.accept_bidirectional_trade(uuid,uuid,uuid,text,text,text,text,text,text,text,integer,uuid,numeric,numeric,timestamp with time zone,text,text)'::regprocedure
  )
  into v_function_sql;

  v_function_sql := replace(
    v_function_sql,
    'v_token_balance::bigint',
    'v_token_balance::numeric'
  );

  execute v_function_sql;
end
$$;
