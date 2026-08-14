-- Operator Command Center verification queries (run after migration deployment).
-- Expected: service role can read; anon/authenticated cannot execute the function.

select * from public.get_operator_command_center() order by submitted_at desc;

select
  has_function_privilege('anon', 'public.get_operator_command_center()', 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', 'public.get_operator_command_center()', 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('service_role', 'public.get_operator_command_center()', 'EXECUTE') as service_role_can_execute;

select event_type, application_id, profile_id, error_code, created_at
from private.operator_journey_events
order by created_at desc
limit 50;
