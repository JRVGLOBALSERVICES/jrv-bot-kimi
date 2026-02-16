# JARVIS Agent Configuration

## Provider Priority

Failover order (automatic rotation on failure):
1. **Kimi K2.5** (Moonshot AI) — Primary. Best tool calling + reasoning.
2. **Groq Llama 3.3 70B** — Secondary. Ultra-fast, free tier.
3. **Ollama** (local) — Tertiary. Offline, free, private.

## Routing Rules

- **Admin messages** → Always cloud (quality + tools required)
- **Cloud triggers** → report, analytics, booking, available, customer, etc.
- **Long messages** (>300 chars) → Cloud
- **Simple chat** → Local (Ollama) if available, else cloud

## Circuit Breaker

- 5 consecutive failures → provider disabled for 60 seconds
- Auto-recovery after cooldown
- Provider health re-checked every 5 minutes

## Tool Execution

- 15-second timeout per tool call
- Max 3 tool call rounds per request
- Bad JSON arguments → empty args (don't crash)
- Tool errors → feed error back to AI for recovery

## Session Defaults

- Max conversation history: 20 messages
- Session TTL: 30 minutes idle
- Cache TTL: 5-60 minutes (varies by intent)
- Never cache: payments, complaints, emergencies

## Emergency Fallback

When ALL providers fail:
- Admin → status report showing what's down + suggest /commands
- Customer → bilingual "contact us" message (Malay + English)
- JARVIS never goes silent.
