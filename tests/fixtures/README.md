# Test fixtures

- `sdk/` (WP1): sanitized/synthetic raw SDK messages for `mapMessage`.
- `history/` (WP2): synthetic `SDKSessionInfo[]` / `SessionMessage[]` JSON.
- `events/` (WP4): normalized `SessionEvent[]` sequences reused by WP4-WP8.

Rules: never commit real transcripts or prompts. Use synthetic data and fake paths like `C:\fixture\proj`.
