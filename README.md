# JARVIS - JRV Car Rental AI Assistant

Hybrid AI assistant for JRV Car Rental. Runs on **NVIDIA Jetson Orin Nano** with local AI models + **Kimi K2 API** for complex tasks.

## Architecture

```
User (WhatsApp / Phone / Web)
        │
        ▼
   JARVIS Brain ──── Conversation Manager
        │                   │
        ├── Text ───► AI Router ──┬── Local (Llama 8B) — FREE
        │                         └── Cloud (Kimi K2) — Smart
        ├── Voice ──► Whisper STT → AI → Piper TTS
        ├── Image ──► LLaVA / Kimi Vision → OCR / Analysis
        └── Phone ──► SIP/FreeSWITCH → Voice Pipeline
        │
        ▼
   Supabase (4 tables)
   ├── cars            → Fleet management
   ├── catalog         → Car models
   ├── agreements      → Bookings + customer data
   └── bot_data_store  → Config, pricing, FAQ, admins, templates
```

## Quick Start (Laptop Testing)

```bash
cp .env.example .env    # Fill in Supabase + Kimi credentials
npm install
node src/test-connection.js   # Verify database access
npm run dev                    # Start dev server at http://localhost:3000
```

## Features

- **Customer Recognition** — Phone number matched against agreements history
- **Admin Detection** — 5 admins defined in bot_data_store
- **Fleet Validation** — Cross-references car status with active agreements
- **UTC→MYT** — All dates stored UTC, displayed in Malaysia Time
- **Voice I/O** — Speech-to-text (Whisper) + Text-to-speech (Piper/Edge TTS)
- **Image Analysis** — Car plate reading, damage assessment (LLaVA/Kimi Vision)
- **Reports** — Fleet, earnings, daily summary with *bold* + ```mono``` formatting
- **Hybrid AI** — Simple queries local (FREE), complex queries cloud (Kimi K2)

## Commands

| Command | Access | Description |
|---------|--------|-------------|
| `/cars` | All | Fleet status |
| `/bookings` | All | Active bookings |
| `/search <query>` | All | Search cars/customers |
| `/help` | All | Show commands |
| `/report` | Admin | Daily summary |
| `/fleet-report` | Admin | Fleet + status validation |
| `/earnings` | Admin | Revenue report |
| `/status` | Admin | System health |

## Deployment (Jetson)

1. Flash JetPack 6.2 on NVMe SSD
2. Install Ollama: `curl -fsSL https://ollama.ai/install.sh | sh`
3. Pull model: `ollama pull llama3.1:8b`
4. Install Whisper: `pip install faster-whisper`
5. Clone this repo, `npm install`, configure `.env`
6. `npm start`
