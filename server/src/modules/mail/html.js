// Building email bodies safely. Every piece of user data (names, salon names, message wording) goes through
// escapeHtml, so a customer called "<script>" shows up as text, never as code.

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

// Plain text -> HTML: escaped first, then line breaks become <br>
export function textToHtml(text) {
  return escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>');
}

// A subject is one line: line breaks would let someone add their own email headers
export function cleanSubject(subject) {
  return String(subject ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 200);
}

// A plain, mobile-friendly email in the app's colours. `body` and `footer` must already be safe HTML
// (use textToHtml / escapeHtml); salonName is escaped here.
export function layout({ salonName, body, footer = '' }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f7f7f5;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#111111;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f5;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e5e0;border-radius:12px;">
        <tr><td style="padding:20px 24px;border-bottom:3px solid #c9a227;">
          <div style="font-size:20px;font-weight:700;color:#6b4226;">${escapeHtml(salonName)}</div>
        </td></tr>
        <tr><td style="padding:24px;font-size:15px;line-height:1.6;">${body}</td></tr>
        ${footer ? `<tr><td style="padding:16px 24px;border-top:1px solid #e5e5e0;font-size:12px;line-height:1.5;color:#6b6b6b;">${footer}</td></tr>` : ''}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
