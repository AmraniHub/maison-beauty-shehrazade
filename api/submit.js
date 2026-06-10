const crypto = require('crypto');

const sha256 = (v) =>
  v ? crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex') : undefined;

const normalizePhone = (phone) => {
  let p = String(phone).replace(/\D/g, '');
  if (p.startsWith('0') && p.length === 10) p = '212' + p.slice(1);
  else if (!p.startsWith('212') && p.length === 9) p = '212' + p;
  return p;
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const {
    name, phone, service, eventId,
    userAgent, eventSourceUrl, fbp, fbc,
  } = req.body || {};

  const results = {};

  // ── 1. Meta CAPI ──────────────────────────────────────────────────────────
  const pixelId     = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;

  if (pixelId && accessToken) {
    const parts    = String(name || '').trim().split(/\s+/);
    const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const testCode = process.env.META_TEST_EVENT_CODE;

    const payload = {
      data: [{
        event_name:       'Lead',
        event_time:       Math.floor(Date.now() / 1000),
        event_id:         eventId,
        event_source_url: eventSourceUrl,
        action_source:    'website',
        user_data: {
          ph: [sha256(normalizePhone(phone))].filter(Boolean),
          fn: [sha256(parts[0])].filter(Boolean),
          ln: parts[1] ? [sha256(parts[1])] : [],
          fbp: fbp || undefined,
          fbc: fbc || undefined,
          client_ip_address: clientIp  || undefined,
          client_user_agent: userAgent || undefined,
        },
        custom_data: { content_name: service, content_category: 'Lead', currency: 'MAD', value: 0 }
      }]
    };
    if (testCode) payload.test_event_code = testCode;

    try {
      const r = await fetch(
        `https://graph.facebook.com/v20.0/${pixelId}/events?access_token=${accessToken}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      );
      results.capi = await r.json();
    } catch (e) { results.capi = { error: e.message }; }
  }

  // ── 2. Telegram notification ──────────────────────────────────────────────
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId   = process.env.TELEGRAM_CHAT_ID;

  if (botToken && chatId) {
    const now = new Date().toLocaleString('fr-MA', {
      timeZone: 'Africa/Casablanca',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    const msg =
      `🌸 <b>حجز جديد — Maison Beauty Shehrazade</b>\n\n` +
      `👤 الاسم: ${name}\n` +
      `📱 الواتساب: <code>${phone}</code>\n` +
      `🎯 الخدمة: ${service}\n` +
      `🕐 ${now}`;

    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' })
      });
      results.telegram = 'sent';
    } catch (e) { results.telegram = { error: e.message }; }
  }

  // ── 3. Google Sheets CRM ──────────────────────────────────────────────────
  const scriptUrl = process.env.GOOGLE_SCRIPT_URL;

  if (scriptUrl) {
    try {
      await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          name:    name    || '',
          phone:   phone   || '',
          service: service || '',
          source:  'Maison Beauty Shehrazade',
          eventId: eventId || '',
        })
      });
      results.sheets = 'sent';
    } catch (e) { results.sheets = { error: e.message }; }
  }

  return res.status(200).json({ status: 'ok', results });
};
