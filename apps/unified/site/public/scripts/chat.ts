// The website's "Text us" box (parity tier 3, chat-to-text; server crm/comms/chatToText.ts, POST /api/chat-to-text; included by
// base.ejs only where chat_to_text and texting are on). A round button at the corner opens a small form: name, mobile, message, and
// the site's usual unticked "Text me" box with the same words as every other form (site/smsConsent.ts consentWording('enquiry')).
// Ticked, the message reaches the business's texting inbox and they reply by text; unticked, they get back to you another way.
(function () {
  var CONSENT = 'Text me about my enquiry. Message frequency varies. Message and data rates may apply. Reply STOP to stop receiving texts, or HELP for help.';
  var css = '.tw-chat-btn{position:fixed;right:18px;bottom:18px;z-index:9999;border:0;border-radius:999px;padding:12px 18px;font:600 15px/1 system-ui,sans-serif;background:#ea580c;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.2);cursor:pointer}' +
    '.tw-chat{position:fixed;right:18px;bottom:72px;z-index:9999;width:min(340px,calc(100vw - 36px));background:#fff;color:#111827;border:1px solid #e5e7eb;border-radius:14px;padding:16px;box-shadow:0 10px 30px rgba(0,0,0,.18);font:15px/1.4 system-ui,sans-serif}' +
    '.tw-chat input,.tw-chat textarea{width:100%;box-sizing:border-box;margin:6px 0;padding:9px;border:1px solid #9ca3af;border-radius:8px;font:inherit;color:#111827;background:#fff}' +
    '.tw-chat label.tw-consent{display:flex;gap:8px;align-items:flex-start;font-size:12px;color:#374151;margin:6px 0}.tw-chat label.tw-consent input{width:auto;margin-top:2px}' +
    '.tw-chat button[type=submit]{width:100%;border:0;border-radius:8px;padding:10px;background:#c2410c;color:#fff;font:600 15px system-ui,sans-serif;cursor:pointer}.tw-chat .tw-msg{font-size:14px;margin-top:8px}' +
    '.tw-chat .tw-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}';
  var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  var btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'tw-chat-btn'; btn.textContent = 'Text us'; btn.setAttribute('aria-expanded', 'false');
  var box = document.createElement('div');
  box.className = 'tw-chat'; box.hidden = true; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Text us');
  box.innerHTML =
    '<form novalidate>' +
      '<strong>Send us a message</strong>' +
      '<input name="name" autocomplete="name" placeholder="Your name" aria-label="Your name" maxlength="80" required>' +
      '<input name="phone" type="tel" autocomplete="tel" placeholder="Mobile number" aria-label="Mobile number" maxlength="30" required>' +
      '<textarea name="message" rows="3" placeholder="How can we help?" aria-label="Message" maxlength="1000" required></textarea>' +
      '<div class="tw-hp" aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off"></div>' +
      '<label class="tw-consent"><input type="checkbox" name="smsConsent" value="yes"><span>' + CONSENT + ' <a href="/privacy" target="_blank" rel="noopener">Privacy</a> · <a href="/terms" target="_blank" rel="noopener">Terms</a></span></label>' +
      '<button type="submit">Send</button>' +
      '<p class="tw-msg" role="status"></p>' +
    '</form>';
  document.body.appendChild(box); document.body.appendChild(btn);

  btn.addEventListener('click', function () {
    box.hidden = !box.hidden;
    btn.setAttribute('aria-expanded', String(!box.hidden));
    if (!box.hidden) { var first = box.querySelector('input[name=name]') as HTMLInputElement | null; if (first) first.focus(); }
  });
  var form = box.querySelector('form') as HTMLFormElement;
  var msg = box.querySelector('.tw-msg') as HTMLElement;
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = new FormData(form);
    var payload: Record<string, unknown> = { name: f.get('name'), phone: f.get('phone'), message: f.get('message'), website: f.get('website') || '', smsConsent: f.get('smsConsent') === 'yes', page: location.pathname };
    var send = form.querySelector('button[type=submit]') as HTMLButtonElement;
    send.disabled = true; msg.textContent = 'Sending…';
    fetch('/api/chat-to-text', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (r) {
        if (r.ok) { form.reset(); msg.textContent = (r.d && (r.d.message || (r.d.data && r.d.data.message))) || 'Thanks — we will be in touch soon.'; }
        else msg.textContent = (r.d && r.d.error) || 'That did not send. Please call us instead.';
      })
      .catch(function () { msg.textContent = 'That did not send. Please call us instead.'; })
      .then(function () { send.disabled = false; });
  });
})();
