/**
 * Nova Credit — form mailer (Google Apps Script web app).
 *
 * The website POSTs each form submission here; this script emails it to the
 * Gmail account that owns the script and returns a reference number.
 * Nothing is stored: no Sheet, no Drive file, no log of field values.
 *
 * Recipients (optional) — Project Settings → Script properties:
 *   TO_LOAN, TO_HR, TO_COMPLAINTS, TO_CONTACT   per-form addresses
 *   TO                                          fallback for all forms
 * With none set, everything goes to the script owner's Gmail.
 *
 * Setup and deployment: see README.md in this folder.
 */

var FORMS = {
  application: {
    title: 'Loan application', to: 'TO_LOAN', nameKeys: ['ln', 'fn'], emailKey: 'em',
    required: ['fn', 'ln', 'pid', 'ph', 'em'], files: ['doc'],
    keys: ['p','a','cur','tm','rp','pu','vm','vmd','vy','vn','vv','vs','fn','ln','pid','bd','cz','idn','gn','ed','mil','res',
           'ph','ph2','em','adr','adl','rt','ms','dep','sp','spi','emp','co','pos','exp','inc','inc2','obl','src','doc','cons','cap']
  },
  vacancy: {
    title: 'Job application', to: 'TO_HR', nameKeys: ['ln', 'fn'], emailKey: 'em',
    required: ['vac', 'fn', 'ln', 'ph', 'em'], files: ['cv'],
    keys: ['vac','src','sal','start','fn','ln','pid','bd','gn','cz','mil','ph','em','adr','ms','dep','un','fac','deg','yr',
           'co','pos','per','rsn','cv','lge','lgr','lgo','sw','cons','cap']
  },
  complaints: {
    title: 'Complaint', to: 'TO_COMPLAINTS', nameKeys: ['ln', 'fn'], emailKey: 'em',
    required: ['fn', 'ln', 'ph', 'em', 'txt'], files: ['att'],
    keys: ['rd','rn','fn','ln','pid','bd','cz','adr','ph','em','pr','nt','txt','att','ch','sig','dt','cap']
  },
  contact: {
    title: 'Contact message', to: 'TO_CONTACT', nameKeys: ['n'], emailKey: 'e',
    required: ['n', 'e', 'm'], files: [],
    keys: ['n', 'e', 's', 'm']
  }
};

var MAX_VALUE = 5000;                     // chars per field
var MAX_LABEL = 200;
var MAX_FILE_BYTES = 10 * 1024 * 1024;    // matches the "max 10 MB" hint on the site
var MAX_PER_HOUR = 30;                    // consumer Gmail allows ~100 emails/day
var MIN_FILL_MS = 3000;                   // faster than this is a bot
var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    var form = FORMS[req.form];
    if (!form) return reply_({ ok: false, error: 'unknown form' });
    if (!(Number(req.elapsed) >= MIN_FILL_MS)) return reply_({ ok: false, error: 'too fast' });

    var fields = cleanFields_(req.fields, form.keys);
    var byKey = {};
    fields.forEach(function (f) { byKey[f.k] = f.v; });

    var missing = form.required.filter(function (k) { return !byKey[k]; });
    if (missing.length) return reply_({ ok: false, error: 'missing fields' });
    var email = byKey[form.emailKey];
    if (!EMAIL_RE.test(email)) return reply_({ ok: false, error: 'bad email' });

    var files = cleanFiles_(req.files, form.files);
    if (files === null) return reply_({ ok: false, error: 'bad file' });

    if (MailApp.getRemainingDailyQuota() < 1) return reply_({ ok: false, error: 'quota' });
    if (!underHourlyCap_()) return reply_({ ok: false, error: 'rate limit' });

    var ref = 'NC-' + Utilities.formatDate(new Date(), 'Asia/Tbilisi', 'yyMMdd') + '-' + randomCode_(5);
    // Subject carries the name and reference only — never the personal ID number.
    var who = form.nameKeys.map(function (k) { return byKey[k] || ''; }).join(' ').replace(/[\r\n]+/g, ' ').trim().slice(0, 80);

    MailApp.sendEmail({
      to: recipient_(form.to),
      subject: '[' + form.title + '] ' + who + ' — ' + ref,
      body: renderBody_(form, fields, ref, req.lang),
      replyTo: email,
      name: 'Nova Credit website',
      attachments: files
    });

    console.log('[nova-forms] ' + req.form + ' ok ref=' + ref);   // no field values
    return reply_({ ok: true, ref: ref });
  } catch (err) {
    console.error('[nova-forms] ' + (err && err.name) + ': ' + (err && err.message));
    return reply_({ ok: false, error: 'server error' });
  }
}

// Visiting the /exec URL in a browser should show this — a quick deploy check.
function doGet() {
  return ContentService.createTextOutput('Nova Credit form mailer is running.');
}

// Run once from the editor: grants the mail permission and sends a sample to the owner.
function testSend() {
  var out = doPost({ postData: { contents: JSON.stringify({
    form: 'contact', lang: 'en', elapsed: 10000,
    fields: [
      { k: 'n', label: 'Name', section: 'Contact', v: 'Test Sender' },
      { k: 'e', label: 'Email', section: 'Contact', v: Session.getEffectiveUser().getEmail() },
      { k: 's', label: 'Subject', section: 'Contact', v: 'Form mailer test' },
      { k: 'm', label: 'Message', section: 'Contact', v: 'If you can read this, the website forms will reach this inbox.' }
    ],
    files: []
  }) } });
  console.log(out.getContent());
}

function cleanFields_(raw, allowed) {
  var seen = {};
  return (Array.isArray(raw) ? raw : []).filter(function (f) {
    if (!f || allowed.indexOf(f.k) < 0 || seen[f.k]) return false;
    seen[f.k] = true;
    return true;
  }).map(function (f) {
    return {
      k: f.k,
      label: String(f.label || f.k).replace(/[\r\n]+/g, ' ').slice(0, MAX_LABEL),
      section: String(f.section || '').replace(/[\r\n]+/g, ' ').slice(0, MAX_LABEL),
      v: String(f.v == null ? '' : f.v).trim().slice(0, MAX_VALUE)
    };
  });
}

// Returns attachment blobs, or null if any file is not a real pdf/jpg/png within the size limit.
function cleanFiles_(raw, allowed) {
  var list = Array.isArray(raw) ? raw : [];
  var blobs = [];
  for (var i = 0; i < list.length; i++) {
    var f = list[i];
    if (!f || allowed.indexOf(f.k) < 0) return null;
    var bytes = Utilities.base64Decode(String(f.data || ''));
    if (!bytes.length || bytes.length > MAX_FILE_BYTES) return null;
    var mime = sniffType_(bytes);                       // trust the content, not the browser's claim
    if (!mime) return null;
    var name = String(f.name || 'attachment').replace(/[\r\n\/\\:*?"<>|]+/g, '_').slice(0, 100);
    blobs.push(Utilities.newBlob(bytes, mime, name));
  }
  return blobs;
}

function sniffType_(b) {
  var u = function (i) { return b[i] & 0xff; };
  if (u(0) === 0x25 && u(1) === 0x50 && u(2) === 0x44 && u(3) === 0x46 && u(4) === 0x2d) return 'application/pdf';  // %PDF-
  if (u(0) === 0x89 && u(1) === 0x50 && u(2) === 0x4e && u(3) === 0x47) return 'image/png';
  if (u(0) === 0xff && u(1) === 0xd8 && u(2) === 0xff) return 'image/jpeg';
  return null;
}

function renderBody_(form, fields, ref, lang) {
  var lines = [
    form.title + ' — ' + ref,
    'Submitted ' + Utilities.formatDate(new Date(), 'Asia/Tbilisi', 'yyyy-MM-dd HH:mm') + ' (Tbilisi time)',
    'Form language: ' + (lang === 'en' ? 'English' : 'Georgian')
  ];
  var section = null;
  fields.forEach(function (f) {
    if (f.section && f.section !== section) {
      section = f.section;
      lines.push('', '== ' + section + ' ==');
    }
    lines.push(f.label + ': ' + (f.v || '—'));
  });
  lines.push('', '—', 'Sent by the novacredit.ge website form. Reply to this email to answer the sender.');
  return lines.join('\n');
}

function recipient_(key) {
  var props = PropertiesService.getScriptProperties();
  return props.getProperty(key) || props.getProperty('TO') || Session.getEffectiveUser().getEmail();
}

function underHourlyCap_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    var cache = CacheService.getScriptCache();
    var key = 'sent-' + Math.floor(Date.now() / 3600000);
    var n = Number(cache.get(key) || 0);
    if (n >= MAX_PER_HOUR) return false;
    cache.put(key, String(n + 1), 3700);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function randomCode_(len) {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var out = '';
  for (var i = 0; i < len; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
