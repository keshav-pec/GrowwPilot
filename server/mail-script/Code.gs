/**
 * GrowwPilot mail script (Google Apps Script web app). Paste into script.google.com — see README.md here.
 *
 * The server POSTs JSON:
 *   one email:  { secret, to, subject, htmlBody, textBody, fromName, replyTo, attachments: [{ fileName, mimeType, base64 }] }
 *   a batch:    { secret, emails: [ ...up to 40 of the above, without secret ] }
 * Replies:
 *   { status: "success" }                                   one email sent
 *   { status: "success", results: [{ status: "sent" } | { status: "failed", message, skipped? }] }   batch
 *   { status: "error", message }                            nothing sent (wrong secret, bad request, Gmail error)
 *
 * The secret is in Project Settings -> Script Properties -> MAIL_SECRET (the same value as MAIL_SCRIPT_SECRET
 * on the server). Calls without it are refused, so finding the URL is not enough to send mail from this account.
 */

var MAX_BATCH = 40;

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ status: 'error', message: 'bad request: body must be JSON' });
  }

  var secret = PropertiesService.getScriptProperties().getProperty('MAIL_SECRET');
  if (!secret || body.secret !== secret) return reply({ status: 'error', message: 'unauthorised' });

  if (Array.isArray(body.emails)) {
    if (body.emails.length > MAX_BATCH) return reply({ status: 'error', message: 'batch too large (at most ' + MAX_BATCH + ')' });
    var results = [];
    var quotaMessage = null;
    for (var i = 0; i < body.emails.length; i++) {
      // After the first "too many times" (daily quota) the rest are not tried; the server sends them another way
      if (quotaMessage) {
        results.push({ status: 'failed', skipped: true, message: quotaMessage });
        continue;
      }
      try {
        sendOne(body.emails[i]);
        results.push({ status: 'sent' });
      } catch (err) {
        var message = String((err && err.message) || err);
        if (/too many times/i.test(message)) quotaMessage = message;
        results.push({ status: 'failed', message: message });
      }
    }
    return reply({ status: 'success', results: results });
  }

  try {
    sendOne(body);
    return reply({ status: 'success' });
  } catch (err) {
    return reply({ status: 'error', message: String((err && err.message) || err) });
  }
}

function sendOne(email) {
  if (!email || !email.to || !email.subject) throw new Error('Invalid email: "to" and "subject" are required');
  var options = { htmlBody: email.htmlBody || undefined, name: email.fromName || 'GrowwPilot' };
  if (email.replyTo) options.replyTo = email.replyTo;
  if (email.attachments && email.attachments.length) {
    options.attachments = email.attachments.map(function (a) {
      return Utilities.newBlob(Utilities.base64Decode(a.base64), a.mimeType, a.fileName);
    });
  }
  GmailApp.sendEmail(email.to, email.subject, email.textBody || '', options);
}

// Health check: open the /exec link in a browser, or the server's Email card calls it
function doGet() {
  return reply({ status: 'ok', service: 'growwpilot-mail' });
}

// Run this once from the editor (Run -> testSendEmail) to give the script permission to send Gmail
function testSendEmail() {
  var me = Session.getActiveUser().getEmail();
  GmailApp.sendEmail(me, 'GrowwPilot mail script works', 'If you can read this, the script can send email from this account.');
  Logger.log('Sent a test email to ' + me + '. Emails left today: ' + MailApp.getRemainingDailyQuota());
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
