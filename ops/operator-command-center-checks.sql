-- Operator Activation Command Center verification queries.
-- Expected: service role can read; anon/authenticated cannot execute.
-- No duplicate journey/event ledger is created by this design.

select *
from public.get_operator_command_center()
order by submitted_at desc;

select
  has_function_privilege('anon', 'public.get_operator_command_center()', 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', 'public.get_operator_command_center()', 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('service_role', 'public.get_operator_command_center()', 'EXECUTE') as service_role_can_execute;

select activation_state, count(*)
from public.get_operator_command_center()
group by activation_state
order by activation_state;

select acquisition_stage, count(*)
from public.get_operator_command_center()
group by acquisition_stage
order by acquisition_stage nulls first;
