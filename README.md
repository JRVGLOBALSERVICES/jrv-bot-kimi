# JARVIS - JRV Car Rental AI Assistant

**JRV Car Rental, Seremban, Malaysia**
WhatsApp: +60126565477 | Website: [jrvservices.co](https://jrvservices.co)

Branches:
- 195, Jalan S2 B14, Seremban 2, 70300 Seremban, Negeri Sembilan
- Lot 12071, Jalan Sungai Ujong, Taman Ast, 70200 Seremban, Negeri Sembilan

Hybrid AI assistant running on **NVIDIA Jetson Orin Nano** (local AI) + **Cloud APIs** (Kimi K2, Gemini) for complex tasks.

---

## Architecture

```
Customer (WhatsApp) ──► WhatsApp Channel ──► JARVIS Brain
                                                 │
                                  Intent Reader (EVERY message)
                                  │             │
                    ┌─────────────┼─────────────┼─────────────────┐
                    │             │             │                 │
                    ▼             ▼             ▼                 ▼
                 Text          Voice         Image            Location
                    │             │             │                 │
                    ▼             ▼             ▼                 ▼
              AI Router     Whisper STT    Gemini Vision    Google Maps
              ┌──┬──┐        → AI →        / LLaVA         + Zone Match
              │  │  │     Piper/Edge TTS   / Tesseract OCR  + Delivery Fee
              │  │  │
              ▼  ▼  ▼
          Ollama Kimi Gemini
          (local)(cloud)(vision)
                    │
                    ▼
              Supabase (Database)
              ├── cars            → Fleet (plate, status, catalog_id)
              ├── car_catalog     → Makes/models (make, model, year)
              ├── agreements      → Bookings (dates, mobile, status)
              └── bot_data_store  → Config, pricing, FAQ, templates
                    │
                    ▼
              Cloudinary (Media Storage)
              ├── jrv/voice/      → TTS voice notes
              ├── jrv/images/     → Generated images
              ├── jrv/payments/   → Payment proof uploads
              └── jrv/customers/  → Customer documents/media

              Vercel Dashboard
              ├── /api/fleet      → Fleet overview
              ├── /api/bookings   → Active bookings
              ├── /api/earnings   → Revenue stats
              ├── /api/control    → Kill/pause/resume bot
              ├── /api/config     → Switch AI models
              └── /api/status     → Bot heartbeat
```

---

## Setup

### 1. Clone & Install

```bash
git clone <this-repo>
cd jrv-bot-kimi
npm install
```

Requirements: Node.js 18+

### 2. Create .env File

```bash
cp .env.example .env
```

### 3. Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SUPABASE_URL` | Yes | — | Supabase project URL |
| `SUPABASE_KEY` | Yes | — | Supabase anon key |
| `KIMI_API_KEY` | Recommended | — | Kimi K2 API key ([platform.moonshot.ai](https://platform.moonshot.ai)) |
| `KIMI_API_URL` | No | `https://api.moonshot.ai/v1` | Kimi API base URL |
| `KIMI_MODEL` | No | `kimi-k2-0905-preview` | Kimi model (`kimi-k2.5`, `kimi-k2-thinking`) |
| `KIMI_THINKING_MODEL` | No | `kimi-k2-thinking` | Kimi thinking model |
| `GEMINI_API_KEY` | Recommended | — | Google Gemini key ([aistudio.google.com](https://aistudio.google.com/apikey)) |
| `GEMINI_MODEL` | No | `gemini-2.0-flash` | Gemini model |
| `LOCAL_AI_URL` | No | `http://localhost:11434` | Ollama URL |
| `LOCAL_AI_MODEL` | No | `llama3.1:8b` | Ollama model |
| `LOCAL_WHISPER_URL` | No | `http://localhost:8080` | Whisper STT URL |
| `LOCAL_TTS_URL` | No | `http://localhost:5500` | Piper TTS URL |
| `EDGE_TTS_VOICE` | No | `ms-MY-YasminNeural` | Edge TTS voice |
| `CLOUDINARY_CLOUD_NAME` | Recommended | — | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Recommended | — | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Recommended | — | Cloudinary API secret |
| `CLOUDINARY_UPLOAD_PRESET` | No | `jrv_voice` | Upload preset |
| `BOSS_PHONE` | Yes | — | Boss phone (60XXXXXXXXXX) |
| `BOSS_NAME` | No | `Boss` | Boss display name |
| `ADMIN_PHONES` | Yes | — | Comma-separated admin phones |
| `WHATSAPP_SESSION_NAME` | No | `jrv-jarvis` | WhatsApp session name |
| `SIP_SERVER` | No | — | SIP server for phone calls |
| `SIP_USERNAME` | No | — | SIP username |
| `SIP_PASSWORD` | No | — | SIP password |
| `RUNTIME_MODE` | No | `laptop` | `laptop` or `jetson` |
| `DASHBOARD_SECRET` | No | — | Vercel dashboard auth token |

### 4. Test

```bash
npm test                  # Run ALL tests
npm run test:connection   # Supabase database
npm run test:ai           # AI providers (Kimi, Gemini, Ollama)
npm run test:location     # Location service + delivery zones
npm run test:media        # Cloudinary + TTS + vision
npm run test:voice        # Voice pipeline (STT + TTS)
```

### 5. Start

```bash
npm run dev    # Dev mode (HTTP server at localhost:3000)
npm start      # Production (WhatsApp connection — scan QR code)
```

---

## How It Works

### Message Flow

```
1. Message arrives (WhatsApp)
2. Identify sender (admin/customer/new)
3. Intent classification (EVERY message)
4. Escalation check (HIGH/CRITICAL → notify Vir)
5. Check active booking flow
6. Route by type: text/voice/image/location/document
7. Generate response (AI or direct handler)
8. Forward ALL customer interactions to superadmin Vir
9. Send response back to customer
```

### Intent Classification

Every inbound message is classified before processing:

| Intent | Priority | Triggers (multi-language) |
|--------|----------|--------------------------|
| `emergency` | CRITICAL | accident, breakdown, stolen, police |
| `complaint` | HIGH | complain, not happy, refund, scam |
| `cancellation` | HIGH | cancel, batal, tak jadi |
| `payment` | MEDIUM | pay, bayar, transfer, receipt |
| `extension_inquiry` | MEDIUM | extend, sambung, tambah hari |
| `return_inquiry` | MEDIUM | return, pulang, drop off |
| `booking_inquiry` | MEDIUM | book, tempah, sewa, available |
| `pricing_inquiry` | LOW | price, harga, berapa, discount |
| `delivery` | LOW | deliver, hantar, pickup, KLIA |
| `document_submit` | LOW | IC, license, passport |
| `admin_command` | LOW | /commands |
| `report_request` | LOW | report, summary, earnings |
| `greeting` | LOW | hi, hello, salam, 你好 |
| `media` | LOW | voice note, image, video |
| `location` | MEDIUM | GPS pin shared |
| `general` | LOW | everything else |

### AI Routing

```
Message → Classify → Route:
  ├── Cloud (Kimi K2): complex queries, tool calling, reports, analytics
  │   Triggers: report, analysis, revenue, forecast, booking, customer, etc.
  │   Also: messages > 300 chars, admin messages > 100 chars
  │
  ├── Local (Ollama): simple chat, FAQ, greetings
  │   FREE, offline, fast
  │
  └── Fallback: Kimi fails → Ollama, Ollama fails → Kimi
```

Gemini is NOT used for text. It is reserved for image/vision analysis only.

### Kimi K2 Tool Calling

When Kimi K2 handles a query, it can call these tools to get live data:

| Tool | Description | Admin Only |
|------|-------------|------------|
| `get_available_cars` | Cars available for rental (no plates for customers) | No |
| `get_pricing` | All category rates | No |
| `get_delivery_fee` | Fee for a location name | No |
| `get_delivery_by_coordinates` | Fee from GPS coordinates | No |
| `get_jrv_location` | Office location + Maps link | No |
| `get_payment_info` | Bank details + payment methods | No |
| `get_policies` | Deposit, cancellation, fuel, insurance, etc. | No |
| `lookup_customer` | Customer rental history | Yes |
| `get_active_bookings` | All active bookings | Yes |
| `get_expiring_rentals` | Rentals expiring in N days | Yes |
| `get_overdue_rentals` | Past-due returns | Yes |
| `get_fleet_status` | Fleet overview counts | No |
| `search_cars` | Search by make/model/color/plate | No |

---

## Features A-Z

### Admin Detection

5 admins defined in `bot_data_store`:

| Name | Phone | Role |
|------|-------|------|
| Rj | 60138606455 | Papa/Creator (Boss) |
| Vir | 60138845477 | Uncle/Superadmin |
| Amisha | 60162783080 | Sister |
| Suriyati | 60146635913 | Mum |
| Kakku | 601170193138 | TATA |

Admins get: plate numbers, full booking details, reports, voice notes.
Customers get: car models only, no plates, no admin phones, text-only replies.

### Booking Flow

Guided step-by-step booking via WhatsApp chat:

```
1. Customer says "book" or "nak sewa"
2. Show available cars (numbered list, no plates for customers)
3. Customer picks a number → show pricing
4. Customer provides dates → calculate total (best rate: monthly > weekly > 3-day > daily)
5. Confirm name
6. Delivery option: pickup at office (FREE) or delivery to location
7. Final confirmation → assign plate INTERNALLY
8. Notify Vir with full details + assigned plate
9. Customer sees "Vehicle details on pickup/delivery day"
10. Show payment instructions + document requirements
```

Plate assignment: the car plate is assigned internally and sent to Vir. The customer only learns the plate number on pickup/delivery day.

Date parsing supports:
- `2026-02-20 - 2026-02-25`
- `20/02/2026 - 25/02/2026`
- `tomorrow - 5 days`
- `3 days`

### Cloudinary Media Storage

All media stored in Cloudinary cloud storage:

| Folder | Contents |
|--------|----------|
| `jrv/voice/` | Generated TTS voice notes |
| `jrv/images/` | AI-generated images |
| `jrv/payments/` | Customer payment proof uploads |
| `jrv/customers/{phone}/` | Per-customer documents and media |

### Customer Flows

7 structured interaction templates:

1. **New Customer Welcome** — Greet, collect name + dates + car preference
2. **Returning Customer** — Greet by name, show active rental, offer services
3. **Payment Collection** — Show bank details (Maybank 555135160390), await proof
4. **Document Collection** — List required docs (IC/passport, license, utility bill)
5. **Extension Request** — Check current rental, calculate rate, confirm
6. **Return Process** — Remind fuel/cleanliness, confirm return location
7. **Expiry Contact** — Auto-contact expiring customers (extend or return?)

### Delivery Zones & Fees

| Zone | Areas | Fee | Distance |
|------|-------|-----|----------|
| Free | Seremban, Senawang, Sendayan | FREE | <15km |
| Zone 1 | Port Dickson, Nilai | RM50 | <40km |
| Zone 2 | KLIA, KLIA2 | RM70 | <70km |
| Zone 3 | KL, Kuala Lumpur, Melaka | RM150 | >70km |

GPS-based matching: customer shares location pin → Haversine distance → zone assignment → fee calculation.

### Document Requirements

**Malaysian customers:**
1. IC (MyKad)
2. Driving License
3. Utility Bill (proof of address)

**Foreign customers:**
1. Passport
2. International Driving Permit (IDP)
3. Valid Visa

### Escalation System

| Priority | Action |
|----------|--------|
| CRITICAL (accident, stolen, emergency) | Notify ALL admins immediately |
| HIGH (complaint, cancellation) | Notify superadmin Vir |
| MEDIUM (payment, extension, return) | Normal processing + forward to Vir |
| LOW (greeting, FAQ, pricing) | Normal processing + forward to Vir |

ALL customer interactions are forwarded to superadmin Vir — not just escalations.

### Image Analysis

4 vision engines in priority order:

1. **Gemini Vision** (cloud) — primary for all media
2. **LLaVA** (Ollama local) — FREE, fast, private
3. **Kimi K2.5 Vision** (cloud) — fallback
4. **Tesseract.js** (OCR only) — last resort, text extraction

Capabilities:
- Car plate reading
- Damage assessment
- Payment proof detection
- General image description

Customer images are uploaded to Cloudinary and forwarded to admin.

### Language Support

4 languages with auto-detection:

| Language | Greeting | TTS Voice |
|----------|----------|-----------|
| English | Hello, Hi | en-GB-RyanNeural |
| Malay | Salam, Hai | ms-MY-OsmanNeural |
| Chinese | 你好 | zh-CN-YunxiNeural |
| Tamil | வணக்கம் | ta-IN-ValluvarNeural |

Intent patterns include keywords in all 4 languages.

### Location Service

- **GPS → Address**: Reverse geocoding via Nominatim (free, no API key)
- **GPS → Zone**: Haversine distance calculation to known zone coordinates
- **Zone → Fee**: Automatic delivery fee assignment
- **Maps Links**: Google Maps view + directions to JRV
- **WhatsApp Location**: Parse location pins from WhatsApp messages

### Notifications

9 notification event types:

| Event | Recipients | Content |
|-------|-----------|---------|
| Customer message | Vir | Message + intent + JARVIS reply |
| Escalation (HIGH) | Vir | Alert with priority + message |
| Escalation (CRITICAL) | ALL admins | Emergency alert |
| Payment proof | Vir | Customer name + amount |
| New booking | Vir | Full details + assigned plate |
| Expiring rental | Vir | Customer + days left |
| Overdue return | ALL admins | Car + customer + due date |
| Location shared | Vir | Area + zone + fee + Maps link |
| Media received | Vir | Type + Cloudinary URL |

### Policies & Pricing

**Pricing by category:**

| Category | Models | Daily | 3-Day | Weekly | Monthly |
|----------|--------|-------|-------|--------|---------|
| Economy | Axia, Bezza, Saga | RM80 | RM210 | RM450 | RM1,400 |
| Compact | Myvi, Iriz, City | RM100 | RM270 | RM580 | RM1,700 |
| SUV | Ativa, X50, X70 | RM150 | RM400 | RM850 | RM2,500 |
| Premium | HRV, Vios, Civic | RM180 | RM480 | RM1,000 | RM3,000 |
| MPV | Alza, Avanza, Innova | RM160 | RM430 | RM900 | RM2,700 |

**Other policies:**

| Policy | Details |
|--------|---------|
| Deposit | RM150 for students, foreigners, P license. Regular customers: RM0 |
| Cancellation | Free 24h before pickup. Late: RM50. No show: full day |
| Extension | Same rate. Must notify 24h before. Late return: RM50/hr (3hrs), then full day |
| Fuel | Same-to-same. Short: RM10 per bar |
| Cleanliness | Excessive dirt: RM50 cleaning fee |
| Insurance | Basic included. Excess: RM3,000 sedan, RM5,000 SUV/MPV |
| Payment | Cash, Bank Transfer (Maybank 555135160390 JRV GLOBAL SERVICES), QR Code |

### Proactive Scheduler

5 automated tasks:

| Task | Interval | Description |
|------|----------|-------------|
| Expiry check | Every 4 hours | Contact customers 2 days before end date |
| Overdue check | Every 2 hours | Alert all admins about late returns |
| Daily report | 8am MYT | Summary report to superadmin |
| Conversation cleanup | Every 15 minutes | Remove expired chat contexts |
| Reminder check | Every 1 minute | Fire due reminders |

### Reports

8 report formats (admin only):

| Command | Report |
|---------|--------|
| `/report` | Daily summary |
| `/report1` | Sorted by time |
| `/report2` | Sorted by contact |
| `/report3` | Sorted by timeslot |
| `/report4` | Follow-up report |
| `/report5` | Available cars report |
| `/report6` | Full summary |
| `/fleet-report` | Fleet validation (cross-check status vs agreements) |
| `/earnings` | Revenue report |

### Voice Engine

Bidirectional voice pipeline:

**STT (Speech-to-Text):**
- Whisper (local on Jetson or remote)
- Receives WhatsApp voice notes → transcribes → processes as text

**TTS (Text-to-Speech):**
- Edge TTS (free, Microsoft Azure Neural voices)
- Piper TTS (local, custom voice models)
- Generated audio uploaded to Cloudinary

Voice notes are sent ONLY to admins. Customers get text-only replies.

### Voice Profiles

3 switchable voice profiles:

| Profile | Name | Style | EN Voice | MS Voice |
|---------|------|-------|----------|----------|
| `jarvis` | JARVIS | Professional (British male) | en-GB-RyanNeural | ms-MY-OsmanNeural |
| `friday` | FRIDAY | Friendly (female) | en-US-JennyNeural | ms-MY-YasminNeural |
| `casual` | Casual | Casual (male) | en-US-DavisNeural | ms-MY-OsmanNeural |

Each profile has voices for EN, MS, ZH, and TA.

Switch with: `/voice jarvis`, `/voice friday`, `/voice casual`

---

## Commands Reference

### Everyone

```
/cars          Fleet status (all cars with status)
/available     Available cars only
/bookings      Active bookings list
/pricing       Full rate card by category
/book          Start guided booking flow
/search <q>    Search cars or customers
/reminders     Your active reminders
/remind <text> Set a reminder (natural language)
/help          All commands
```

### Admin Only

```
/report        Daily summary
/report1       Sorted by time
/report2       Sorted by contact
/report3       Sorted by timeslot
/report4       Follow-up report
/report5       Available cars report
/report6       Full summary
/fleet-report  Fleet validation
/earnings      Revenue report
/expiring      Expiring in 3 days
/overdue       Overdue returns
/status        System health
/voice list    Voice profiles
/voice <id>    Change voice
```

### Boss Only (/tool)

```
/tool help              All boss tools
/tool pc                PC performance report
/tool site <desc>       Generate website HTML
/tool broadcast <msg>   Message all admins
/tool export <type>     Export data
/tool config            Show config
/tool set <key> <val>   Change setting
/tool query <table>     Query data
/tool system            System info

/tool backups           List backups
/tool trash             List trashed files
/tool restore <file>    Restore backup
/tool delete <file>     Delete from trash
/tool purge-trash       Empty trash
/tool safety-log        Audit log

/tool reminder-all      All reminders
/tool clear-reminders   Clear by phone

/tool cloud             Cloudinary storage stats
/tool cloud-voice       List voice notes
/tool cloud-images      List images
/tool cloud-videos      List videos
/tool cloud-delete <id> Delete media
/tool generate-image    AI image generation
/tool upload            Upload info
/tool customer-media    Customer files

/tool location                JRV location info
/tool location <lat> <lng>    Lookup coordinates
/tool delivery <place>        Delivery fee calc
```

---

## Operational Rules

All 34 rules JARVIS follows (from `bot_data_store`):

1. Query `bot_data_store` first before answering operational questions
2. All prices MUST come from `bot_data_store`, never make up prices
3. Car plates HIDDEN from customers — show model names only
4. Car plates VISIBLE to admins only
5. Format: **bold headers** + ```monospace data```
6. No corporate BS — get straight to data
7. Match customer language (Malay/English/Chinese/Tamil)
8. Customer with >5 bookings = regular customer, priority treatment
9. Always greet returning customers by name
10. New customers: welcome warmly, collect name and requirements
11. Voice notes: ONLY to admins, customers get text-only
12. Escalate HIGH/CRITICAL intents to superadmin Vir immediately
13. ALL customer interactions forwarded to superadmin Vir
14. Show only cars with NO active agreements when asked about availability
15. Cross-validate car status with agreements before showing
16. Expiring rentals: contact customer 2 days before end date
17. Overdue returns: alert admins immediately, contact customer
18. Payment proof: forward to superadmin for verification
19. Never share admin phone numbers with customers
20. Never share other customer details
21. Always show delivery fees when asked about delivery
22. Student/foreigner/P license: always mention RM150 deposit
23. Insurance excess: share only when asked or during accident
24. Late return penalty: inform customer clearly before rental
25. Fuel policy: always mention same-to-same rule
26. Cleaning fee: mention only if asked or at return time
27. Cancellation: mention free 24h cancellation when booking
28. Extension: customer must notify 24h before end date
29. Documents: remind customer what to bring before pickup
30. Reports: use exact formats from `bot_data_store`
31. Dates: always Malaysia Time (MYT = UTC+8)
32. Amounts: always prefix with RM
33. Phone format: +60XXXXXXXXX
34. Business number: +60126565477

---

## Project Structure

```
jrv-bot-kimi/
├── src/
│   ├── index.js              # Main entry (WhatsApp + scheduler)
│   ├── dev-server.js         # Dev HTTP server (localhost:3000)
│   ├── config.js             # .env loader + validation
│   ├── test-connection.js    # Supabase test
│   ├── test-ai.js            # AI provider test
│   ├── test-location.js      # Location service test
│   ├── test-media.js         # Media pipeline test
│   │
│   ├── ai/                   # AI layer
│   │   ├── router.js         # Routes: local vs cloud + caching
│   │   ├── kimi-client.js    # Kimi K2 API (tool calling)
│   │   ├── kimi-tools.js     # 13 tool definitions + executors
│   │   ├── gemini-client.js  # Google Gemini (vision only)
│   │   └── local-client.js   # Ollama local AI
│   │
│   ├── brain/                # Business logic
│   │   ├── jarvis.js         # Central orchestrator (9-step pipeline)
│   │   ├── intent-reader.js  # Message classification (16 intents)
│   │   ├── conversation.js   # Chat context memory
│   │   ├── policies.js       # Pricing, delivery, rules (34 rules)
│   │   ├── booking-flow.js   # Step-by-step booking (state machine)
│   │   ├── customer-flows.js # 7 customer interaction templates
│   │   ├── notifications.js  # Admin notifications + media forwarding
│   │   ├── admin-tools.js    # Boss-only power tools (/tool)
│   │   ├── reports.js        # 8 report formats
│   │   ├── reminders.js      # Natural language reminder scheduling
│   │   └── scheduler.js      # 5 cron-style automated tasks
│   │
│   ├── channels/             # Communication
│   │   └── whatsapp.js       # WhatsApp Web.js + status reporting
│   │
│   ├── media/                # Media processing
│   │   ├── index.js          # Exports
│   │   ├── cloudinary.js     # Cloud storage (REST API, no SDK)
│   │   ├── image-reader.js   # Vision: Gemini → LLaVA → Kimi → Tesseract
│   │   └── image-generator.js # AI image generation
│   │
│   ├── voice/                # Voice pipeline
│   │   ├── index.js          # Voice engine (STT + TTS)
│   │   ├── stt.js            # Speech-to-text (Whisper)
│   │   ├── tts.js            # Text-to-speech (Piper/Edge TTS)
│   │   ├── jarvis-voice.js   # 3 voice profiles × 4 languages
│   │   └── caller.js         # Voice message sender
│   │
│   ├── supabase/             # Database layer
│   │   ├── client.js         # Supabase client
│   │   ├── schemas/          # Table schemas
│   │   └── services/         # Data services
│   │       ├── fleet-service.js      # Cars + catalog
│   │       ├── agreements-service.js # Bookings + customers
│   │       ├── data-store-service.js # Config + pricing + FAQ
│   │       └── sync.js               # 5-min sync + heartbeat + control
│   │
│   └── utils/                # Utilities
│       ├── location.js       # GPS, geocoding, zones, Maps links
│       ├── time.js           # UTC → MYT conversion
│       ├── validators.js     # Fleet cross-validation, color names
│       ├── cache.js          # Response caching (TTL-based)
│       └── file-safety.js    # Backup + trash + audit system
│
├── api/                      # Vercel serverless functions (dashboard)
│   ├── _lib/
│   │   ├── supabase.js       # Shared Supabase client
│   │   └── auth.js           # Bearer token auth (DASHBOARD_SECRET)
│   ├── fleet.js              # GET /api/fleet
│   ├── bookings.js           # GET /api/bookings
│   ├── earnings.js           # GET /api/earnings
│   ├── control.js            # GET/POST /api/control (kill/pause/resume)
│   ├── config.js             # GET/POST /api/config (model switching)
│   └── status.js             # GET /api/status (heartbeat)
│
├── public/                   # Dashboard UI
│   └── index.html            # Terminal-style dashboard (dark theme)
│
├── vercel.json               # Vercel deployment config
├── .npmrc                    # ignore-scripts for Vercel build
├── package.json              # Dependencies
└── .env.example              # Environment template
```

---

## Vercel Dashboard

Remote dashboard for monitoring and controlling the bot.

### Setup

1. Deploy to Vercel (connect repo)
2. Set environment variables in Vercel project settings:
   - `SUPABASE_URL` — your Supabase project URL
   - `SUPABASE_KEY` — your Supabase anon key
   - `DASHBOARD_SECRET` — a secret token for dashboard auth
3. Set Install Command in Vercel dashboard Build Settings to: `npm install`
   (`.npmrc` with `ignore-scripts=true` prevents native module compilation)

### Features

- **Fleet Overview** — cars grouped by status (available/rented/maintenance)
- **Active Bookings** — with overdue and expiring alerts
- **Revenue Stats** — today, this month, all time
- **Bot Controls** — Kill, Restart, Pause, Resume
- **Model Switching** — change Kimi, Gemini, Ollama models live
- **Bot Heartbeat** — online status, last sync, car/booking counts
- **Auto-refresh** — updates every 60 seconds

### Bot Communication

The dashboard communicates with the bot through Supabase `bot_data_store`:

| Key | Direction | Purpose |
|-----|-----------|---------|
| `bot_status` | Bot → Dashboard | Heartbeat (online, mode, counts) |
| `bot_control` | Dashboard → Bot | Commands (kill, restart, pause, resume) |
| `bot_config` | Dashboard → Bot | Model changes (kimiModel, geminiModel, etc.) |
| `whatsapp_status` | Bot → Dashboard | WhatsApp connection state |

Bot polls for control commands every 30 seconds.

---

## Database Schema

### cars

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `plate_number` | text | License plate (e.g., NAA1234) |
| `catalog_id` | uuid | FK → car_catalog |
| `status` | text | available / rented / maintenance |
| `color` | text | Hex color code (e.g., #f27218) |
| `year` | int | Manufacturing year |
| `daily_price` | numeric | Daily rental rate (RM) |
| `body_type` | text | economy / compact / suv / premium / mpv |

### car_catalog

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `make` | text | Manufacturer (Perodua, Proton, Honda, Toyota) |
| `model` | text | Model name (Myvi, X50, City, etc.) |
| `year` | int | Year |

### agreements

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `customer_name` | text | Customer full name |
| `mobile` | text | Customer phone |
| `plate_number` | text | Assigned car plate |
| `car_type` | text | Car description |
| `date_start` | date | Rental start date |
| `date_end` | date | Rental end date |
| `total_price` | numeric | Total amount (RM) |
| `status` | text | active / completed / cancelled |

### bot_data_store

| Column | Type | Description |
|--------|------|-------------|
| `key` | text | Unique key (PK) |
| `value` | jsonb | Configuration value |
| `created_by` | text | Who created it |
| `updated_at` | timestamp | Last update |

Keys: `all_pricing_updated_v2`, `delivery_zones`, `faq`, `testimonials`, `bot_status`, `bot_control`, `bot_config`, `jarvis_operational_rules_complete`, admin entries, etc.

---

## Deployment

### Laptop (Development)

```bash
git clone <repo>
cd jrv-bot-kimi
npm install
cp .env.example .env   # Fill in credentials
npm test               # Verify everything works
npm start              # Scan QR code with WhatsApp
```

### Jetson Orin Nano (Production)

```bash
# 1. Flash JetPack 6.2 on NVMe SSD
# 2. Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull llama3.1:8b
ollama serve  # Background

# 3. Install voice tools
pip install faster-whisper edge-tts

# 4. Clone and configure
git clone <repo>
cd jrv-bot-kimi
npm install
cp .env.example .env
# Set RUNTIME_MODE=jetson in .env

# 5. Test and start
npm test
npm start  # Scan QR code
```

### Vercel (Dashboard Only)

```bash
# Connect repo to Vercel
# Set env vars: SUPABASE_URL, SUPABASE_KEY, DASHBOARD_SECRET
# Deploy automatically on push to main
```

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `@supabase/supabase-js` | Database client |
| `dotenv` | Environment variables |
| `express` | Dev HTTP server |
| `whatsapp-web.js` | WhatsApp Web client |
| `qrcode-terminal` | QR code display for WhatsApp login |
| `sharp` | Image processing |
| `tesseract.js` | OCR text extraction |
| `fluent-ffmpeg` | Audio/video conversion |
| `mic` | Microphone input (Jetson) |
| `speaker` | Audio output (Jetson) |
| `sox-stream` | Audio streaming |
| `sip.js` | SIP/VoIP phone calls |
| `peerjs` | Peer-to-peer connections |
| `ws` | WebSocket client |
| `systeminformation` | System stats (CPU, RAM, disk) |
| `node-fetch` | HTTP requests |
| `nodemon` | Dev auto-restart |
