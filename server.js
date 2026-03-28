/**
 * Omi Transcript Webhook Server
 * Receives real-time transcripts from Omi and stores in Supabase
 *
 * Endpoints:
 *   POST /webhook/omi         — real-time transcript segments
 *   POST /webhook/omi/memory  — processed conversation memories
 *   POST /webhook/omi/test    — health check (auto-deletes test data)
 *   GET  /health              — server + Supabase status
 */

require('dotenv').config();

const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================
// Privacy Filter
// ============================================

const PERSONAL_KEYWORDS = [
  'personal', 'family', 'health', 'private', 'doctor', 'medical',
  'relationship', 'therapy', 'medication', 'diagnosis', 'symptom'
];

function flagPersonalContent(transcript) {
  const lower = transcript.toLowerCase();
  return PERSONAL_KEYWORDS.some(keyword => lower.includes(keyword));
}

// ============================================
// Parse Omi Payload (handles both formats)
// ============================================

function parseOmiPayload(body) {
  const memory = body.memory || body.conversation || body;

  const transcript =
    body.transcript ||
    body.text ||
    body.content ||
    (memory.transcript_segments && memory.transcript_segments.map(s => `${s.speaker || ''}: ${s.text}`).join('\n')) ||
    (memory.transcript && memory.transcript) ||
    (body.segments && body.segments.map(s => s.text).join(' ')) ||
    null;

  const speaker =
    body.speaker ||
    body.speaker_id ||
    (body.segments && body.segments[0]?.speaker) ||
    (memory.transcript_segments && memory.transcript_segments[0]?.speaker) ||
    null;

  const timestamp =
    body.timestamp ||
    body.created_at ||
    memory.created_at ||
    memory.started_at ||
    new Date().toISOString();

  return { transcript, speaker, timestamp, raw: body };
}

// ============================================
// Real-Time Transcript Endpoint
// ============================================

app.post('/webhook/omi', async (req, res) => {
  try {
    const { transcript, speaker, timestamp, raw } = parseOmiPayload(req.body);

    if (!transcript || transcript.trim().length === 0) {
      return res.status(400).json({ error: 'Missing transcript content' });
    }

    const isPotentialPersonal = flagPersonalContent(transcript);
    const eventDate = new Date(timestamp).toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('omi_events')
      .insert([{
        event_date: eventDate,
        event_timestamp: new Date(timestamp).toISOString(),
        transcript: transcript.trim(),
        speaker: speaker || 'Unknown',
        source: 'omi_live',
        raw_metadata: {
          ...raw,
          potential_personal: isPotentialPersonal,
          received_at: new Date().toISOString()
        },
        processed: false,
        embedding_indexed: false
      }])
      .select('id, event_timestamp');

    if (error) {
      console.error('Supabase insert error:', error.message);
      return res.status(500).json({ error: 'Database error' });
    }

    console.log(`Event stored: ${data[0].id} | ${eventDate} | Speaker: ${speaker || 'Unknown'}`);

    return res.status(200).json({
      success: true,
      event_id: data[0].id,
      timestamp: data[0].event_timestamp
    });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// Processed Memory Endpoint
// ============================================

app.post('/webhook/omi/memory', async (req, res) => {
  try {
    const memory = req.body.memory || req.body.conversation || req.body;

    const segments = memory.transcript_segments || [];
    const transcript = segments.length > 0
      ? segments.map(s => `${s.speaker || 'Unknown'}: ${s.text}`).join('\n')
      : (memory.transcript || null);

    if (!transcript || transcript.trim().length === 0) {
      return res.status(400).json({ error: 'Missing transcript content' });
    }

    const structured = memory.structured || null;
    const timestamp = memory.created_at || memory.started_at || new Date().toISOString();
    const eventDate = new Date(timestamp).toISOString().split('T')[0];
    const speaker = (segments[0]?.speaker) || 'Unknown';
    const isPotentialPersonal = flagPersonalContent(transcript);

    const { data, error } = await supabase
      .from('omi_events')
      .insert([{
        event_date: eventDate,
        event_timestamp: new Date(timestamp).toISOString(),
        transcript: transcript.trim(),
        speaker,
        source: 'omi_memory',
        raw_metadata: {
          ...req.body,
          structured: structured
            ? {
                title: structured.title,
                overview: structured.overview,
                action_items: structured.action_items || []
              }
            : null,
          potential_personal: isPotentialPersonal,
          received_at: new Date().toISOString()
        },
        processed: false,
        embedding_indexed: false
      }])
      .select('id, event_timestamp');

    if (error) {
      console.error('Supabase insert error:', error.message);
      return res.status(500).json({ error: 'Database error' });
    }

    console.log(`Memory stored: ${data[0].id} | ${eventDate} | ${segments.length} segments`);

    return res.status(200).json({
      success: true,
      event_id: data[0].id,
      timestamp: data[0].event_timestamp,
      segments_processed: segments.length
    });

  } catch (err) {
    console.error('Memory webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// Test Endpoint
// ============================================

app.post('/webhook/omi/test', async (req, res) => {
  try {
    const now = new Date();

    const { data, error } = await supabase
      .from('omi_events')
      .insert([{
        event_date: now.toISOString().split('T')[0],
        event_timestamp: now.toISOString(),
        transcript: 'Test transcript from webhook verification',
        speaker: 'Test',
        source: 'test',
        raw_metadata: { test: true, received_at: now.toISOString() },
        processed: false,
        embedding_indexed: false
      }])
      .select('id');

    if (error) return res.status(500).json({ error: error.message });

    // Auto-cleanup
    const eventId = data[0].id;
    setTimeout(async () => {
      await supabase.from('omi_events').delete().eq('id', eventId);
    }, 5000);

    return res.status(200).json({
      success: true,
      message: 'Webhook working. Test event auto-deletes in 5s.',
      event_id: eventId
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================
// Health Check
// ============================================

app.get('/health', async (req, res) => {
  try {
    const { error } = await supabase.from('omi_events').select('count').limit(1);
    res.json({
      status: 'ok',
      supabase: error ? 'error' : 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ============================================
// Start
// ============================================

const PORT = process.env.OMI_WEBHOOK_PORT || 3001;

app.listen(PORT, () => {
  console.log(`Omi Webhook Server running on port ${PORT}`);
});

module.exports = app;
