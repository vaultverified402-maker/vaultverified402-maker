# Near-Real-Time AI Dialogue Relay

## Goal

Reduce AI Handoff Queue latency from manual `check` cycles to seconds while keeping Notion as the authoritative audit ledger.

The relay does **not** make Notion disappear. It makes Notion the durable coordination record while a trusted local process handles detection, claiming, model invocation, and reply commits.

## Trust boundary

The relay owns lifecycle fields only:

- `Status`
- `Claimed By`
- `Claimed At`
- `Reply`
- `Model`
- `Turn Count`

A model runtime receives task content and returns reply text. It does not receive authority to mutate lifecycle fields.

The relay fails closed when:

- `Requires Human Approval = true`
- `Authorization` is unknown
- `Scope` contains an unsupported system
- `Turn Count >= Max Turns`
- no explicit runtime command exists for the addressed model
- the runtime times out, exits non-zero, or returns empty output

## Runtime model

`tools/ai_dialogue_relay.py` polls the Notion data source at a short interval (2 seconds by default). It takes the oldest eligible `QUEUED` handoff addressed to `Claude` or `OpenAI`, claims it, validates authority, invokes the configured local runtime, and writes the result back as `REPLIED`.

No model is invoked unless its command is explicitly configured by environment variable. This prevents accidental self-routing or guessed executors.

### Required environment

```bash
export NOTION_API_KEY='...'
export NOTION_HANDOFF_DATA_SOURCE_ID='79b7e648-7fc0-4aae-939a-abd2f57c002d'
```

Keep credentials local. Never commit them.

### Claude adapter

Anthropic documents non-interactive Claude Code with `claude -p` and JSON output. An example relay command is:

```bash
export CLAUDE_CMD='claude -p --output-format json --permission-mode plan --max-turns {max_turns} {prompt}'
```

The relay substitutes `{prompt}` and `{max_turns}` without using a shell.

### OpenAI adapter

Set `OPENAI_CMD` only to a locally approved non-interactive OpenAI runtime. The relay intentionally ships with **no guessed OpenAI command**:

```bash
export OPENAI_CMD='<approved command using {prompt}>'
```

Until configured, an item addressed to OpenAI will fail closed as `BLOCKED` instead of silently routing elsewhere.

## Run

One pass:

```bash
python3 tools/ai_dialogue_relay.py --once
```

Continuous local relay:

```bash
python3 tools/ai_dialogue_relay.py
```

Optional tuning:

```bash
export AI_RELAY_POLL_SECONDS=2
export AI_RELAY_MAX_RUNTIME_SECONDS=180
export AI_RELAY_ACTOR='Marco OS Live Relay'
```

## Near-immediate dialogue pattern

For multi-turn conversation, the answering side should create or re-address a **new governed queue turn** only when another model response is genuinely required. The relay can then claim the next turn within the polling interval. Do not create uncontrolled ping-pong: `Max Turns`, authorization, scope, and human-approval boundaries remain authoritative.

## Deployment recommendation

Run the relay in the same trusted local Ubuntu/Termux environment already used for the Claude dispatcher. Keep it session-based initially. Do not deploy it as an always-on production service until:

1. Claude reviews the invocation contract and fail-closed behavior.
2. The OpenAI runtime command is explicitly selected and tested.
3. A smoke test proves claim/reply lifecycle behavior without touching Vault production data.
4. Crash/orphan recovery is verified.

Notion remains the audit ledger; Vault production systems remain outside the relay's authority unless a separate task explicitly grants that scope.
