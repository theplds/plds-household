# Household App — incoming basketball email (Resend)

Status: server and Household review UI implemented in app version 0.3.154.
Receiving mail requires provider setup. Never copy API keys into client JavaScript.

## 1. Resend account (service administrator)

Resend provides an assigned receiving domain, such as abc123.resend.app, without purchasing another domain.

1. Open https://resend.com/receiving in the owner-managed Resend account.
2. Find the assigned receiving domain (only the domain portion, not a complete email address).
3. Create an API key able to retrieve received messages.
4. Create a webhook subscribed to email.received with endpoint:
   https://vizoixctzkwyhjhhaulj.supabase.co/functions/v1/household-inbound-email
5. Copy the webhook signing secret beginning whsec_.

In Supabase Dashboard → Edge Functions → Secrets, set:
- INBOUND_EMAIL_DOMAIN = your-id.resend.app
- RESEND_API_KEY = private Resend API key
- RESEND_WEBHOOK_SECRET = private webhook signing secret

Do not expose these credentials in code, GitHub, an email, or ChatGPT.
The function has JWT gateway verification disabled because the receiving
provider cannot supply a Supabase JWT. Every POST verifies a signed Svix
message and timestamp before processing any content.

## 2. Household configuration

Sign into Household → Options → Household & access →
Incoming email schedules → Set up / review.

1. Copy the generated forwarding address (unique to your Household).
2. Enter the exact basketball email sender address.
3. Choose an existing Basketball activity and child.
4. Enable the sender filter and save.

## 3. Gmail filtering

On a computer, open Gmail → Settings → See all settings →
Forwarding and POP/IMAP → Add a forwarding address.
Enter the Household forwarding address and complete the confirmation email
by finding it in your Resend receiving dashboard.

In Gmail, create a filter matching the specific basketball sender and
choose Forward it to the verified address. Do not enable forwarding of
the entire inbox.

## 4. Review

When a message arrives, Resend forwards a signed event to the Supabase Edge
Function. The backend retrieves its body and extracts explicit Greek or
English dates and time ranges. Matching sessions appear in the review queue.

A signed-in household member approves or dismisses each proposed session.
Approval creates a single-day bounded Household activity schedule, checks
for existing calendar conflicts, and preserves any extracted venue as a
session-linked note. The approval confirmation explains possible charges.

## Limitations and privacy

- In-app pending count updates while Household is open. Background mobile
  push notifications for newly received emails have NOT been implemented.
- Image-only messages, attachments, and arbitrary unstructured schedules
  may require manual review. There is no OCR or external AI extraction.
- Cancellations and reschedules are not applied automatically.
- Sender allowlisting is not cryptographic sender verification. Nothing
  can modify the calendar without manual authenticated approval.
- Only limited email metadata and extracted suggestions are retained in
  Household; the full email body is not retained there.
- Resend stores inbound emails separately under its own retention and
  processing terms. Review its privacy terms before forwarding children's
  schedules.

References:
https://resend.com/features/inbound
https://resend.com/docs/api-reference/emails/retrieve-received-email
https://support.google.com/mail/answer/10957
