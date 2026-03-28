# Omi Transcript Webhook

Webhook server that receives real-time transcripts from [Omi](https://www.omi.me/) and stores them in Supabase for downstream processing.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/webhook/omi` | Real-time transcript segments |
| POST | `/webhook/omi/memory` | Processed conversation memories |
| POST | `/webhook/omi/test` | Health check (auto-deletes test data) |
| GET | `/health` | Server + database status |

## Setup

1. Create a Supabase project with an `omi_events` table
2. Copy `.env.example` to `.env` and fill in your credentials
3. `npm install && npm start`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `OMI_WEBHOOK_PORT` | Server port (default: 3001) |

## Supabase Schema

```sql
CREATE TABLE omi_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  event_date DATE NOT NULL,
  event_timestamp TIMESTAMPTZ NOT NULL,
  transcript TEXT NOT NULL,
  speaker VARCHAR(100),
  source VARCHAR(50) DEFAULT 'omi_live',
  raw_metadata JSONB,
  processed BOOLEAN DEFAULT FALSE,
  summary_id UUID,
  embedding_indexed BOOLEAN DEFAULT FALSE
);
```

## Omi App Configuration

In the Omi mobile app, create an integration app pointing to your server:

- **Webhook URL (Real-time transcripts):** `https://your-domain.com/webhook/omi`
- **Webhook URL (Memory/conversation):** `https://your-domain.com/webhook/omi/memory`

## Docker

```bash
docker build -t omi-webhook .
docker run -d --env-file .env -p 3001:3001 omi-webhook
```
