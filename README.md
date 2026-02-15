# JARVIS - JRV Car Rental AI Assistant

Hybrid AI assistant for JRV Car Rental, Seremban, Malaysia.
Runs on **NVIDIA Jetson Orin Nano** (local AI) + **Cloud APIs** (Kimi K2, Gemini) for complex tasks.

## Architecture

```
Customer (WhatsApp) ──► WhatsApp Channel
                            │
                            ▼
                       JARVIS Brain ────── Intent Reader (EVERY message)
                            │                      │
                            ├── Text ──► AI Router ──┬── Ollama (Llama 8B) — FREE, local
                            │                        ├── Gemini Flash — fast cloud
                            │                        └── Kimi K2 — smart, tool calling
                            │
                            ├── Voice ──► Whisper STT → AI → Piper/Edge TTS
                            ├── Image ──► Gemini Vision / LLaVA / Tesseract OCR
                            ├── Location ──► Google Maps + Delivery Zone Matching
                            ├── Document ──► Cloudinary upload + Admin forwarding
                            └── Phone ──► JARVIS Voice Messages
                            │
                            ▼
                       Supabase (4 tables)
                       ├── cars            → Fleet (plate_number, status, catalog_id)
                       ├── car_catalog     → Makes/models (make, model, year)
                       ├── agreements      → Bookings (date_start, date_end, mobile)
                       └── bot_data_store  → Config, pricing, FAQ, templates
                            │
                            ▼
                       Cloudinary (media storage)
                       ├── jrv/voice/      → TTS voice notes
                       ├── jrv/images/     → Generated images
                       ├── jrv/payments/   → Payment proof uploads
                       └── jrv/customers/  → Customer documents/media
```

---

## Step-by-Step Setup

### Step 1: Clone & Install

```bash
git clone <this-repo>
cd jrv-bot-kimi
npm install
```

**Requirements:** Node.js 18+

### Step 2: Create .env File

```bash
cp .env.example .env
```

Edit `.env` and fill in your credentials:

```env
# REQUIRED — Supabase (database)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key

# REQUIRED — At least ONE AI provider
KIMI_API_KEY=your-kimi-key              # https://platform.moonshot.ai
GEMINI_API_KEY=your-gemini-key          # https://aistudio.google.com/apikey

# RECOMMENDED — Cloudinary (media storage)
CLOUDINARY_CLOUD_NAME=your-cloud-name   # https://console.cloudinary.com
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret

# REQUIRED — Admin config
BOSS_PHONE=60XXXXXXXXXX
ADMIN_PHONES=60XXXXXXXXXX,60XXXXXXXXXX

# OPTIONAL — Local AI (Jetson)
LOCAL_AI_URL=http://localhost:11434      # Ollama
LOCAL_AI_MODEL=llama3.1:8b
```

### Step 3: Test Database Connection

```bash
npm run test:connection
```

You should see:
```
✓ cars: XX rows
✓ agreements: XX rows
✓ bot_data_store: XX rows
✓ No status mismatches
```

### Step 4: Test AI Providers

```bash
npm run test:ai
```

You need at least ONE to pass:
```
Kimi K2:  ✓ OK       ← Cloud AI (smart, tool calling)
Gemini:   ✓ OK       ← Cloud AI (fast, vision)
Ollama:   ✓ OK       ← Local AI (free, offline)
```

**To set up Ollama (local AI):**
```bash
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull llama3.1:8b
ollama serve              # Keep running in background
```

### Step 5: Test Location Service

```bash
npm run test:location
```

Tests Google Maps links, delivery zone matching, distance calculation:
```
✓ Seremban       0.0km  zone=free   fee=FREE
✓ KLIA          26.0km  zone=zone2  fee=RM70
✓ Kuala Lumpur  54.0km  zone=zone3  fee=RM150
```

### Step 6: Test Media Pipeline

```bash
npm run test:media
```

Tests Cloudinary connection, upload, TTS engines, vision models:
```
✓ Cloudinary configured
✓ Connected to Cloudinary
✓ Upload successful
✓ edge-tts installed
```

**To install Edge TTS (free voice):**
```bash
pip install edge-tts
```

### Step 7: Run All Tests

```bash
npm test
```

Runs all tests in sequence: connection → AI → location → media.

### Step 8: Start the Bot

**Dev mode** (HTTP test server at localhost:3000):
```bash
npm run dev
```

**Production mode** (WhatsApp connection):
```bash
npm start
```

On first run, scan the QR code with WhatsApp to connect.

---

## Features

| Feature | Description |
|---------|-------------|
| **Customer Recognition** | Phone matched against agreements history |
| **Admin Detection** | 5 admins defined in bot_data_store |
| **Fleet Validation** | Cross-references car status with active agreements |
| **Booking Flow** | Guided step-by-step booking creation |
| **Hybrid AI** | Local (FREE) for simple queries, Cloud for complex |
| **Voice I/O** | Whisper STT + Piper/Edge TTS (JARVIS voice) |
| **Image Analysis** | Car plate reading, damage assessment, payment proofs |
| **Location Sharing** | GPS → delivery zone + fee, Google Maps links |
| **Media Forwarding** | Customer images/docs uploaded to Cloudinary, forwarded to admin |
| **Cloud Storage** | All media (voice, images, docs) stored in Cloudinary |
| **Reports** | Fleet, earnings, daily summary, 6 report formats |
| **Reminders** | Natural language scheduling with repeat support |
| **Voice Calls** | JARVIS voice messages to customers |
| **Multi-Language** | Malay, English, Chinese, Tamil |

## Commands

### Everyone
| Command | Description |
|---------|-------------|
| `/cars` | Fleet status |
| `/available` | Available cars |
| `/bookings` | Active bookings |
| `/pricing` | Rate card |
| `/book` | Start booking flow |
| `/search <query>` | Search cars/customers |
| `/reminders` | Your reminders |
| `/help` | All commands |

### Admin Only
| Command | Description |
|---------|-------------|
| `/report` | Daily summary |
| `/report1` - `/report6` | Various report formats |
| `/fleet-report` | Fleet validation |
| `/earnings` | Revenue report |
| `/expiring` | Expiring in 3 days |
| `/overdue` | Overdue returns |
| `/status` | System health |
| `/voice list` | Voice profiles |

### Boss Only (`/tool`)
| Command | Description |
|---------|-------------|
| `/tool help` | All boss tools |
| `/tool site <desc>` | Generate website HTML |
| `/tool broadcast <msg>` | Message all admins |
| `/tool export <type>` | Export data |
| `/tool pc` | Full PC performance report |
| `/tool cloud` | Cloudinary storage stats |
| `/tool cloud-voice` | List voice notes |
| `/tool cloud-images` | List images |
| `/tool generate-image <desc>` | AI image generation |
| `/tool location <lat> <lng>` | Lookup coordinates |
| `/tool delivery <place>` | Calculate delivery fee |
| `/tool customer-media <phone>` | List customer uploads |

## Test Scripts

```bash
npm test                  # Run ALL tests
npm run test:connection   # Supabase database
npm run test:ai           # AI providers (Kimi, Gemini, Ollama)
npm run test:location     # Location service + delivery zones
npm run test:media        # Cloudinary + TTS + vision engines
npm run test:voice        # Voice pipeline (STT + TTS)
```

## Deployment (Jetson Orin Nano)

1. Flash JetPack 6.2 on NVMe SSD
2. Install Ollama: `curl -fsSL https://ollama.ai/install.sh | sh`
3. Pull model: `ollama pull llama3.1:8b`
4. Install Whisper: `pip install faster-whisper`
5. Install Edge TTS: `pip install edge-tts`
6. Clone this repo, `npm install`, configure `.env`
7. Run tests: `npm test`
8. Start: `npm start` (scan QR code with WhatsApp)

## Project Structure

```
src/
├── index.js              # Main entry (WhatsApp + scheduler)
├── dev-server.js         # Dev HTTP server
├── config.js             # .env loader + validation
├── test-connection.js    # DB test
├── test-ai.js            # AI provider test
├── test-location.js      # Location service test
├── test-media.js         # Media pipeline test
│
├── ai/                   # AI layer
│   ├── router.js         # Routes queries: local vs cloud
│   ├── kimi-client.js    # Kimi K2 API
│   ├── kimi-tools.js     # Tool definitions + executors
│   ├── gemini-client.js  # Google Gemini API
│   └── local-client.js   # Ollama local AI
│
├── brain/                # Business logic
│   ├── jarvis.js         # Central orchestrator
│   ├── intent-reader.js  # Message classification
│   ├── conversation.js   # Chat context memory
│   ├── policies.js       # Pricing, delivery, rules
│   ├── booking-flow.js   # Step-by-step booking
│   ├── customer-flows.js # Customer interaction templates
│   ├── notifications.js  # Admin notifications + media forwarding
│   ├── admin-tools.js    # Boss-only power tools
│   ├── reports.js        # 6 report formats
│   ├── reminders.js      # Reminder scheduling
│   └── scheduler.js      # Cron-style task runner
│
├── channels/             # Communication
│   └── whatsapp.js       # WhatsApp Web.js client
│
├── media/                # Media processing
│   ├── index.js          # Exports
│   ├── cloudinary.js     # Cloud media storage (REST API)
│   ├── image-reader.js   # Vision: Gemini/LLaVA/Tesseract
│   └── image-generator.js # AI image generation
│
├── voice/                # Voice pipeline
│   ├── index.js          # Voice engine (STT + TTS)
│   ├── stt.js            # Speech-to-text (Whisper)
│   ├── tts.js            # Text-to-speech (Piper/Edge)
│   ├── jarvis-voice.js   # JARVIS voice profiles
│   └── caller.js         # Voice message sender
│
├── supabase/             # Database layer
│   ├── client.js         # Supabase client
│   ├── schemas/          # Table schemas
│   └── services/         # Data services (fleet, agreements, sync)
│
└── utils/                # Utilities
    ├── location.js       # Google Maps, geocoding, delivery zones
    ├── time.js           # UTC→MYT conversion
    ├── validators.js     # Fleet validation, safe accessors
    └── file-safety.js    # Backup/trash/audit system
```
