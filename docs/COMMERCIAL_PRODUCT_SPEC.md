# PLDS — Commercial Platform Product Specification

> **Living product reference** · Created 2026-10-28
>
> **Status:** Planning / discovery. Not a deployed commercial product. This document records agreed direction, ideas to validate, and open decisions. Keep it updated as the product evolves.

## 1. The idea

PLDS began as a household calendar and payment tracker for recurring lessons and services. The commercial opportunity is a **two-sided coordination platform** for **families and teachers / independent service professionals**.

Core question: **Who has a lesson or appointment, what happened, what changed, and what is actually owed?**

Traditional calendars store dates; budgeting apps store transactions. PLDS connects schedules, attendance, cancellations, rescheduling, notes, conversations, and financial reconciliation around **one shared session record**.

Potential audiences: families managing multiple children's lessons or household services; tutors, music teachers, therapists, coaches and other independent instructors with multiple client families. Launch focus: families and teachers, initially Greece. Expansion to other services or markets is possible, not a launch requirement.

## 2. Agreed principles

- **Both families and teachers have accounts** and can independently start using the product.
- **Either side may create recurring lessons, propose sessions, and invite the other**. Invitations require acceptance and appropriate permissions.
- **One shared session record, two tailored dashboards** — not two separate apps or duplicate calendars.
- **A teacher has one account covering all their families** and a consolidated, private work calendar and earnings view.
- **A household has its own account / membership structure**, can include multiple parents and children, and sees its own lessons, providers, and expenses.
- Families **must not see** other clients of a teacher. Teachers see only sessions and client information shared with them.
- Financially significant changes need an auditable agreement workflow, rather than one person's unilateral edits silently changing what the other owes.
- Build for real use: clear month view, excellent phone experience, low-friction editing, and understandable financial totals.
- The personal PLDS Household prototype should remain free to operate where possible. A commercial service has ongoing costs; **commercial pricing and long-term cost model are not yet decided**.

## 3. Main account views

### Family / parent

- Household calendar with all providers and children (where applicable).
- Month and list views with activity colors and statuses.
- Recurring scheduling; track each instance independently.
- What is owed, paid, remaining, and to whom.
- Mark attendance, propose cancellation or a new time, respond to changes.
- Shared pre-lesson and post-lesson notes; optional private family notes.
- Homework per child, with deadlines, completion progress and teacher feedback.
- Message a teacher about a relationship or specific lesson.
- Receive reminders, proposed changes, notes, invoices/payment confirmations.

### Teacher / professional

- Single unified calendar across all client families; avoid exposing those clients to one another.
- Create lessons/recurring schedules and invite parents.
- Attendance, cancellations, rescheduling, and exceptions per family.
- Earnings, payments received, outstanding balances per client.
- Shared pre-lesson notes and post-lesson debriefs; optional private professional notes.
- Assign homework and track submitted/completed work for linked students.
- Communicate with parents and receive confirmations/notifications.
- Professional reports and exports are potential premium features.

### Shared actions

- Create/propose a lesson, link to a family/professional, accept invitation.
- Propose date/time, status, or fee changes and accept/reject them.
- Record partial/full payments; optionally confirm receipt.
- Keep an audit history: who did what and when.

## 4. Lesson notes and brief debriefs **[AGREED NEW FEATURE]**

Both **parent and teacher** can write notes **before and after** each individual lesson.

**Before the lesson (prep / briefing):**
- Parent example: topics to cover, homework concern, absence/context, goals.
- Teacher example: planned exercise, materials needed, homework reminder.
- Notes can be written ahead of time and updated with a visible edit history.

**After the lesson (debrief):**
- Teacher example: what was covered, progress, homework, next steps.
- Parent example: follow-up observation, question, feedback, completion confirmation.
- A debrief can be short; this should not become burdensome paperwork.

**Suggested model:**
- Each note belongs to a specific session; includes author, role, timestamp, stage (before/after), and text.
- **Shared** notes are visible to linked parent/teacher; **private** notes, if enabled, remain visible only to their author or their own household/professional account.
- Clearly label shared vs private before saving to prevent accidental disclosure.
- Support edits but retain provenance/history where feasible; record when a note was updated.
- Notifications when a newly shared note/debrief is posted.
- Optional lesson-level follow-up checklist/homework later.
- Attachments and rich media are later-phase candidates; limit sensitive child information and avoid unnecessary collection.

**Open:** Should shared lesson notes be editable after submission or appended as revisions? Who can see notes if multiple family adults are linked? Define retention and deletion policy.

## 5. Homework and assignments **[AGREED NEW FEATURE]**

Each lesson should have a clearly labelled **Homework** area, separate from the pre-lesson notes, post-lesson debrief and messages. Homework is part of the shared lesson record, and outstanding work can be surfaced on the family's and teacher's dashboards.

**Core workflow:**
- **Teacher** creates homework during or after a lesson: title/instructions, optional due date, the relevant child/student, and which lesson it came from.
- **Parent** can view the assignment, add a question or completion update, and optionally attach completed work in a later phase.
- **Teacher** can mark an assignment reviewed, add feedback, and set a follow-up item for the next lesson.
- Both parties can see the assignment's current state (for example: **Assigned → In progress → Submitted / Marked done → Reviewed**) and who last updated it; parents should be able to indicate that it is finished without asserting that the teacher has reviewed it.
- Allow **multiple homework items per lesson** and show an easy **all outstanding homework** overview across lessons, children and teachers. A teacher's overview must only show the students they are authorized to see.
- If linked to a subsequent lesson, display relevant outstanding homework in that session's **Before lesson** area, without copying or losing the original assignment.
- A rescheduled lesson retains its linked homework and due date; a cancelled lesson should not silently delete existing assignments. Offer explicit due-date adjustment when a schedule change affects the homework.

**Notifications:** new homework assigned, an optional due-date reminder, submission/completion recorded, and teacher feedback posted. Respect per-user preferences and quiet hours. No pushy streaks, rankings or punitive reminders.

**Privacy and scope:** this includes information about children; show it only to authorized household adults and the linked teacher, use minimal student details, and do not expose homework across a teacher's families. Files, photos, grading, checklists and external learning links are later-phase possibilities and should be designed with storage cost and privacy in mind.

**Open decisions:** Can parents create homework/reminders of their own, or only teachers? Should assignments be visible to children via a future child-facing view? Should teachers be able to mark an assignment optional? Define data retention and attachment size limits before public launch.

## 6. Cancellation and rescheduling rules **[AGREED NEW FEATURE]**

**Both parent and teacher can define cutoff periods for cancelling or rescheduling without charge/penalty.**

We should support **separate deadlines for**:
- Parent-initiated cancellation.
- Teacher-initiated cancellation.
- Parent-requested rescheduling.
- Teacher-requested rescheduling.

Different teacher-family relationships, activities, and service types may need different terms (e.g., 24 hours, 12 hours, 48 hours). These can be configurable, with sensible defaults.

**Proposed fair policy workflow (must be agreed before launch):**
1. Each participant can propose its preferred advance-notice requirements.
2. Terms that affect **the other participant** take effect only when both parties accept the policy, with a clear summary of what happens on each side.
4. When a cancellation/rescheduling is requested, show the applicable cutoff timestamp and whether it is **within the free window** or **late** before confirmation.
5. Both parties can propose changes; the counterparty sees **Accept / Decline / Suggest another time**.
6. Fee-free cancellations remove the lesson charge. A late parent cancellation can retain an agreed fee; a teacher cancellation must not automatically charge the parent for an undelivered session. Any credits/penalties are explicitly defined in the agreed terms.
7. A replacement session is linked to the original to prevent duplicate charges.
8. Policy changes should apply **prospectively**, not retroactively, unless both parties explicitly agree.
9. Keep an audit log of policy versions, acceptance timestamps, actions, and any billing outcomes.

**Edge cases to specify before implementation:** differing teacher/parent preferred windows, no-shows, force majeure, mutually agreed exemptions, recurring lessons vs one-offs, DST/timezone boundaries, overlapping reschedule proposals, and payment already made.

## 7. Communication system **[AGREED NEW FEATURE]**

**In-app messaging** between linked teachers and household adults, with two layers:

- **Relationship conversation**: general family ↔ teacher discussion (availability, goals, materials, payment questions).
- **Session conversation**: discussion attached to a particular lesson (late arrival, lesson prep, cancellation dispute, debrief clarification).

Design ideas:
- A single **Messages** inbox for each user; unread count.
- Show the associated session/activity clearly; jump from a message to the lesson.
- Plain text first; attachments and voice messages can come later.
- Timestamps, author name, delivery/unread indicators; optional read receipts.
- No child-to-teacher direct messaging in first release. Adult-to-adult access only.
- Protect private information, prevent cross-family message exposure, consider blocking/reporting and account-disconnection behavior before public rollout.
- **Critical decisions stay structured:** chat messages alone should not silently change session times, agreed fees, or cancellation terms. Use explicit proposal/accept actions and keep their confirmation in the conversation as a system event.

## 8. Notifications **[AGREED NEW FEATURE]**

**Start with an in-app notification center**: reliable, low operating cost, read/unread states, and direct links to relevant sessions or messages.

Trigger candidates:
- Invitation received/accepted.
- New message, shared lesson note/debrief, homework assignment, homework completion/submission or teacher feedback.
- Lesson added, changed, cancelled, rescheduled, or proposal awaiting response.
- Policy proposal or revised cutoff awaiting acceptance.
- Upcoming lesson and approaching free cancellation/reschedule cutoff.
- Payment recorded; receipt confirmed; balance mismatch or dispute.

Delivery options, in priority order:
1. In-app notifications (core feature, can be implemented without per-message email costs).
2. Browser/PWA push notifications where device/browser support permits and the user opts in. Requires proper push subscription handling and backend delivery.
4. Optional email digests/critical alerts after cost and provider quotas are assessed. **Do not rely on Supabase's restrictive free authentication-email allowance for general messaging.**
5. SMS/WhatsApp **not in the initial plan** due to costs and provider dependencies.

Preferences: per event type and channel, quiet hours, reminder lead time, email opt-in, unread badges, no spam from repeated schedule edits. Respect privacy by avoiding sensitive lesson-note content in lock-screen notification previews.

**Open:** default reminder timings, whether urgent changes should bypass quiet hours, and feasible free-tier notification limits.

## 9. Financial and session engine

- Recurring lesson templates create individual session instances.
- Session states: scheduled, completed, cancelled-free, cancelled-chargeable, rescheduled-original, rescheduled-replacement; consider proposed/pending confirmation as distinct states.
- Keep proposed changes separate from accepted changes.
- Rates can vary by provider, activity, family or session; preserve historical rates.
- Owed / Paid / Remaining totals, per-provider and per-family ledgers.
- Partial payments, payment dates, attribution and who recorded/confirmed payment.
- Avoid double-charging a moved lesson. Show how cancellation fees affected the total.
- In-app money tracking first. Processing actual payments, invoices and tax compliance are separate potential commercial phases.
- Auditable change history with actor, timestamp, before/after values and links to relevant agreements.

## 10. Visual language from PLDS Household prototype

**Baseline is the latest design demo v0.3.4, not the deployed authentication app.** Transfer to production only after core authentication and synchronization are stable.

- Light and dark themes; month and list calendar, colored dashboard cards.
- Scheduled sessions retain each activity's original hue but appear lighter / more vivid as iterated; predominantly white bold text; yellow activity uses darker text for legibility.
- Cancelled: light grey background, **red 3px outline**, bold red letters.
- Rescheduled original: light grey background, **black 3px outline**, bold black letters.
- Rescheduled replacement: light grey background, **green 3px outline**, bold green letters.
- Dashboard focuses on **Owed, Paid, Remaining**; remove the separate **Planned** amount.
- Responsive phone-first layout; sufficient contrast in both themes.
- Professional dashboard can use consistent statuses but optimize for viewing multiple families.

## 11. Privacy, account and technical principles

- **One platform, two role-specific dashboards**, shared session/ledger engine.
- Many-to-many teacher ↔ household relationships via invitation and acceptance.
- A user may conceivably be both a parent and a teacher; plan for role switching rather than hard-coding mutually exclusive identities.
- Supabase Auth, separate household memberships and strict row-level security; verify teacher permissions for relationship-linked data.
- Do not use user-editable metadata as authorization.
- Avoid putting API secrets in static GitHub Pages code. Only publishable client credentials belong in browser JS.
- Collect only necessary child/student information; explicit access, deletion/export, privacy policy, data retention, and GDPR assessment are essential before a public launch.
- Sensitive notes require careful scope; no public sharing by default.
- Backup/export strategy, audit trails, account recovery, accessibility and mobile reliability required before paid rollout.

## 12. Commercialization thoughts — **NOT FINAL DECISIONS**

- **Two acquisition paths:** families invite teachers, teachers invite families. This supports referral growth without forcing both parties to join simultaneously.
- Consumer/free tier should remain genuinely useful, not crippled.
- Potential revenue: paid household features (more activities/members, reports/exports) and/or paid professional tools (multi-client reporting, invoicing, business analytics).
- **€14.99 one-time** household upgrade was discussed as a *hypothetical* illustration, not an agreed price or proven business model.
- One-time payments must be tested against ongoing server, messaging, storage, notification, support, tax and payment processing costs. No promise of an indefinitely cost-free commercial service.
- Test willingness to pay through **5–10 real families and several teachers** before final pricing and marketing.
- Starting in Greece could suit Greek parents and local lesson practices; international expansion possible later.
- Name/branding: “PLDS Household” is the existing family prototype name. A broader product name may suit teacher + parent users.

## 13. Delivery roadmap

### Phase A — secure working household baseline
- [ ] Verify both existing password accounts can sign in with persistent sessions.
- [ ] Confirm household data syncs accurately between phones and is protected by RLS.
- [ ] Bring approved demo visual design to the real Supabase-connected app.
- [ ] Ensure month/list session editing, rescheduling, cancellations and payments work end-to-end.

### Phase B — shared parent/teacher pilot
- [ ] Teacher profiles and multi-household membership/relationship model.
- [ ] Invitations initiated by either participant.
- [ ] Shared lesson records, role-scoped calendars and payment views.
- [ ] Pre-lesson notes + post-lesson debriefs from both sides.
- [ ] Homework linked to lessons and individual students, with due dates, completion/review states and an outstanding-work overview.
- [ ] Configurable **bilateral** free cancellation/rescheduling cutoffs and agreement flow.
- [ ] Structured proposals for session changes, linked replacement sessions, and audit log.
- [ ] Teacher-family + session-specific conversations.
- [ ] In-app notifications and notification preferences.

### Phase C — commercial readiness
- [ ] Homework due-date reminders; optional file attachments and teacher feedback enhancements.
- [ ] Push reminders, optional email delivery as cost/quotas permit.
- [ ] Security review, GDPR/privacy and data deletion/export design.
- [ ] Reliability testing, backups and a clear support process.
- [ ] Pilot with families and teachers; measure retention and paid demand.
- [ ] Choose sustainable pricing and payments/tax implementation.
- [ ] Professional reporting, exports and other validated premium features.

## 14. Open product decisions

1. Exact definition of "free" cutoff by actor and action: who sets requirements vs who agrees, and who bears a late cancellation fee or credit.
2. Whether lesson notes have separate private/shared channels and how edit history works.
3. Homework authoring/assignment permissions, optional child access, and submission/attachment scope.
4. Whether the same session can be marked completed by either party without confirmation; payment confirmation workflow.
5. How households with two adults divide notes, notifications and permissions.
6. Whether a teacher can communicate with more than one parent at a time and whether read receipts are worth the complexity.
7. Which notification channels and reminders are included free vs paid.
8. Whether professionals can set recurring availability, breaks and multiple locations.
9. Consumer vs teacher pricing, one-time vs subscription, taxes, invoicing.
10. Final broader brand name and rollout strategy.

---

**Maintenance rule:** This file is the *canonical reference* for commercial PLDS planning. Record new user-approved requirements here, mark proposals clearly, and update checked tasks only when built and verified. Do not put real household personal data, children's notes, login credentials or keys into this public repository.
