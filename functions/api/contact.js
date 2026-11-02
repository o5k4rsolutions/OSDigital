import { WorkerMailer } from 'worker-mailer';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (s, max) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

function buildHtml({ name, email, subject, message, replySubject, ip, date, siteUrl }) {
  const replyHref = `mailto:${email}?subject=${encodeURIComponent(replySubject)}`;
  const logo = `${siteUrl}/themes/OSDigital_poziome_color-light-bg.svg`;
  const font = `'Open Sans','Segoe UI',Arial,sans-serif`;
  return `<!doctype html><html lang="pl"><body style="margin:0;padding:0;background:#f3f5f8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f8;padding:32px 12px;">
<tr><td align="center">
 <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3e7ee;font-family:${font};">
  <tr><td style="padding:28px 36px;border-bottom:1px solid #e3e7ee;"><img src="${logo}" alt="OSDigital" height="34" style="display:block;height:34px;border:0;"></td></tr>
  <tr><td style="padding:32px 36px 8px;">
    <p style="margin:0 0 6px;font-size:13px;color:#6b7686;">Nowa wiadomość z formularza kontaktowego</p>
    <h1 style="margin:0;font-size:22px;line-height:1.3;color:#14171f;font-weight:700;">${esc(subject)}</h1>
  </td></tr>
  <tr><td style="padding:20px 36px 4px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f9fb;border-radius:10px;">
     <tr><td style="padding:16px 20px;font-size:14px;color:#14171f;line-height:1.6;">
       <span style="color:#6b7686;">Od:</span> <strong>${esc(name)}</strong><br>
       <span style="color:#6b7686;">E-mail:</span> <a href="mailto:${esc(email)}" style="color:#0b7a75;text-decoration:none;">${esc(email)}</a><br>
       <span style="color:#6b7686;">Data:</span> ${esc(date)}
     </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:20px 36px 8px;">
    <p style="margin:0 0 8px;font-size:13px;color:#6b7686;">Treść wiadomości</p>
    <div style="font-size:15px;line-height:1.7;color:#14171f;border-left:3px solid #0b7a75;padding:2px 0 2px 16px;white-space:pre-wrap;">${esc(message)}</div>
  </td></tr>
  <tr><td style="padding:28px 36px 36px;">
    <a href="${replyHref}" style="display:inline-block;background:#0b7a75;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:999px;">Odpowiedz klientowi</a>
    <p style="margin:14px 0 0;font-size:12px;color:#8a94a3;">Przycisk otworzy nową wiadomość z adresem nadawcy i tematem „${esc(replySubject)}”. Możesz też użyć zwykłego „Odpowiedz” – adres zwrotny jest ustawiony na klienta.</p>
  </td></tr>
  <tr><td style="padding:18px 36px;background:#14171f;font-size:12px;color:#9aa5b5;line-height:1.6;">
    OSDigital &middot; <a href="${siteUrl}" style="color:#9aa5b5;">${esc(siteUrl.replace(/^https?:\/\//, ''))}</a><br>IP nadawcy: ${esc(ip)}
  </td></tr>
 </table>
</td></tr></table></body></html>`;
}

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch { return json({ ok: false, error: 'Nieprawidłowe dane formularza.' }, 400); }
  if (b.website) return json({ ok: true }); // honeypot

  const name = clean(b.name, 120), email = clean(b.email, 160);
  const topic = clean(b.subject, 160) || 'Zapytanie ze strony';
  const message = String(b.message ?? '').trim().slice(0, 5000);
  const errors = {};
  if (name.length < 2) errors.name = 'Podaj imię lub nazwę firmy.';
  if (!isEmail(email)) errors.email = 'Podaj poprawny adres e-mail.';
  if (message.length < 10) errors.message = 'Wiadomość powinna mieć co najmniej 10 znaków.';
  if (b.consent !== true) errors.consent = 'Zgoda jest wymagana, aby odpowiedzieć na wiadomość.';
  if (Object.keys(errors).length) return json({ ok: false, errors }, 400);

  const need = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_TO'].filter(k => !env[k]);
  if (need.length) { console.error('Brak zmiennych:', need.join(', ')); return json({ ok: false, error: 'Formularz jest chwilowo niedostępny. Napisz bezpośrednio na adres e-mail.' }, 500); }

  const siteUrl = (env.SITE_URL || new URL(request.url).origin).replace(/\/$/, '');
  const ip = request.headers.get('CF-Connecting-IP') || 'nieznane';
  const date = new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
  const replySubject = `Re: ${topic}`;
  const secure = String(env.SMTP_SECURE) === 'true';

  try {
    await WorkerMailer.send(
      {
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT || (secure ? 465 : 587)),
        secure,
        startTls: !secure,
        credentials: { username: env.SMTP_USER, password: env.SMTP_PASS },
        authType: 'plain'
      },
      {
        from: { name: env.MAIL_FROM_NAME || 'OSDigital Formularz', email: env.MAIL_FROM || env.SMTP_USER },
        to: env.MAIL_TO,
        reply: { name, email },
        subject: `Nowa wiadomość: ${topic} – ${name}`,
        text: `Od: ${name} <${email}>\nData: ${date}\nTemat: ${topic}\n\n${message}\n\nOdpowiedz: mailto:${email}?subject=${encodeURIComponent(replySubject)}`,
        html: buildHtml({ name, email, subject: topic, message, replySubject, ip, date, siteUrl })
      }
    );
    return json({ ok: true });
  } catch (err) {
    console.error('SMTP error:', err?.message || err);
    return json({ ok: false, error: 'Nie udało się wysłać wiadomości. Spróbuj ponownie lub napisz bezpośrednio na adres e-mail.' }, 500);
  }
}
