const crypto = require('crypto');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const L = (v, n) => { v = v == null ? '' : String(v).trim(); return v ? v.slice(0, n) : null; };
const CATS = ['المطعم','المياه','الكهرباء','النظافة','الغرف','النقل','الأمن','الإدارة','أخرى'];
const URG = ['عادية','مهمة','عاجلة'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const env = process.env;
  const { type, token, data: d } = req.body || {};
  if (!d || !token || !['complaint', 'member'].includes(type)) return res.status(400).json({ error: 'bad' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const v = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET || '', response: token, remoteip: ip })
  }).then(r => r.json()).catch(() => ({}));
  if (!v.success) return res.status(400).json({ error: 'captcha' });

  let table, row, subject, html, code = null;
  if (type === 'complaint') {
    const description = L(d.description, 2000);
    if (!description) return res.status(400).json({ error: 'bad' });
    code = 'SV-' + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
    row = {
      tracking_code: code,
      category: CATS.includes(d.category) ? d.category : 'أخرى',
      urgency: URG.includes(d.urgency) ? d.urgency : 'عادية',
      location: L(d.location, 200), email: L(d.email, 200), description
    };
    table = 'complaints';
    subject = 'شكوى جديدة (' + row.urgency + ') - ' + row.category;
    html = `<p><b>${esc(row.category)}</b> — ${esc(row.urgency)}</p><p>${esc(description)}</p><p>المكان: ${esc(row.location || '-')}</p><p>الرمز: ${code}</p>`;
  } else {
    row = {
      full_name: L(d.full_name, 200), birth_date: L(d.birth_date, 10), phone: L(d.phone, 50),
      email: L(d.email, 200), faculty: L(d.faculty, 200), major: L(d.major, 200),
      level: L(d.level, 100), room: L(d.room, 100), reason: L(d.reason, 2000)
    };
    if (!row.full_name || !row.phone || !row.email || !/^\S+@\S+\.\S+$/.test(row.email))
      return res.status(400).json({ error: 'bad' });
    table = 'members';
    subject = 'طلب انخراط جديد - ' + row.full_name;
    html = `<p><b>${esc(row.full_name)}</b></p><p>${esc(row.phone)} — ${esc(row.email)}</p><p>${esc(row.faculty || '')} / ${esc(row.major || '')} / ${esc(row.level || '')}</p>`;
  }

  const ins = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(row)
  });
  if (!ins.ok) {
    const t = await ins.text();
    return res.status(t.includes('23505') ? 409 : 500).json({ error: t.includes('23505') ? 'duplicate' : 'db' });
  }

  if (env.RESEND_API_KEY && env.NOTIFY_EMAIL) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Student Voice <onboarding@resend.dev>', to: [env.NOTIFY_EMAIL], subject, html })
    }).catch(() => {});
  }
  res.status(200).json({ ok: true, code });
};
