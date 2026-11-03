# PLDS Household — maintenance verification (3 November 2026)

## Changes
- Version 0.3.127: household dashboard, reports and CSV use date-effective activity rates.
- History backfill uses the earliest recorded rate, the last audited rate for each Athens calendar day, and the current rate. Rate changes after deployment are saved by an audited database trigger; rescheduled replacements use their ORIGINAL lesson date's fee.
- No children, payments, invitations, or existing schedules are migrated or rewritten.
- Hardened teacher reschedule approvals: an assignment must still be active at approval time.
- Household naming/finalization requires owner membership. Household members can still view/edit household activities under existing policies.
- Web Push v1 private signing key moved from Edge source into encrypted Supabase Vault. Only service_role can call the secret retrieval RPC. Edge function v8 removes the test-notification endpoint; JWT verification stays enabled.
- Invited account UI requires 12-character passwords. The server-side minimum remains governed by the Supabase Auth configuration.

## Verification performed
- Pricing transaction test: baseline and changed prices at past/today dates, fully rolled back.
- Simulated two-household RLS SELECT, UPDATE, and role escalation test: passed, fully rolled back.
- Revoked-teacher pending-proposal test: passed, fully rolled back.
- App JavaScript parses; month charges, cancellations, cross-month reschedules use original fee.
- CI: offline tests/household-smoke.mjs, run on PR and main push.

## Residual follow-up
- Existing Web Push v1 device subscriptions remain until each device refreshes its registration using Options > Repair. Do not remove the Vault v1 key until the v1 count is zero. Confirm real-device push delivery independently.
- Supabase leaked-password detection is Pro-only. If remaining on the free plan, set the strongest available server-side minimum in Auth settings; the 12-character UI check is not a replacement for server enforcement.
- Historical price changes before the first available audit entry cannot be independently reconstructed; verify old reports if those rates are disputed.
- Simulated database isolation tests are not a substitute for Carolina's separate account, notification, onboarding, and device tests.
- The SECURITY DEFINER RPCs used by the app must remain callable by the appropriate authenticated users; their per-user access checks are more important than blindly suppressing the linter.
- Payment allocations are activity-level, not schedule/teacher-level; for activities shared across multiple teachers, teacher-specific payment reconciliation requires an explicit allocation model.
