# Vault Verified AI Handoff Protocol

Purpose: use GitHub as a shared, auditable workspace between ChatGPT/OpenAI and Claude without requiring direct model-to-model API calls.

## Scope

This protocol is for analysis, review, implementation planning, and code review. It does not grant either model authority to alter Vault Verified evidence, governance, billing, grading, or distribution rules outside the existing controlled paths.

## Shared object

Each handoff is a GitHub Issue created with the **AI Handoff** issue template.

The issue body is the task contract. Comments are append-only working notes and review responses.

## Roles

- **OPENAI / PRODUCER**: proposes analysis, implementation, or patch plan.
- **CLAUDE / CRITIC**: independently challenges assumptions, checks edge cases, and identifies unsupported claims or defects.
- **VAULT / AUTHORITY**: the existing Vault system and human approval process remain authoritative for governed actions.

Roles can be reversed for a specific task if the issue explicitly says so.

## State markers

Use one marker on the first line of a handoff comment:

- `[OPENAI_RESULT]`
- `[OPENAI_REVIEW]`
- `[CLAUDE_RESULT]`
- `[CLAUDE_REVIEW]`
- `[NEEDS_OPENAI]`
- `[NEEDS_CLAUDE]`
- `[RESOLVED]`
- `[BLOCKED]`

The GitHub workflow updates labels from these markers. Markers are coordination metadata, not evidence of correctness.

## Required response shape

Each model response should include:

1. **Conclusion** — concise answer or recommendation.
2. **Evidence** — concrete files, functions, rows, logs, or source references used.
3. **Risks / disagreements** — what could be wrong or what the other model should challenge.
4. **Proposed next action** — exactly what should happen next.
5. **Confidence tier** — Fact, Observation, Hypothesis, Rule Candidate, Rule, or Doctrine when relevant.

## Handoff sequence

1. Create issue with objective, constraints, source references, and requested roles.
2. Producer posts `[OPENAI_RESULT]` or `[CLAUDE_RESULT]`.
3. Reviewer posts the corresponding review marker.
4. If disagreement remains, post `[NEEDS_OPENAI]` or `[NEEDS_CLAUDE]` with the unresolved question.
5. When the task is genuinely closed, post `[RESOLVED]` with the final disposition and any PR/commit/deployment references.

## Safety rules

- Never put API keys, secrets, webhooks, tokens, private customer data, or credentials in issues/comments.
- Do not treat model agreement as verification.
- Do not merge production changes merely because both models agree.
- Use normal branch/PR/deployment controls for code changes.
- For governed Vault data, preserve the existing append-only and fail-closed rules.
- If a task touches live outbound distribution, payment, or irreversible state, the handoff issue must identify that risk explicitly.

## Cost model

GitHub Issues, comments, labels, and Actions are the transport. This protocol itself does not call either model API. It therefore avoids model API charges, but each assistant still has to access GitHub through its existing product connection/session. Fully unattended model-to-model execution would still require an API or another agent runtime capable of invoking the models.
