/**
 * Role Requests portal: Approval Matrix API
 *
 * Bound to the "Approval Matrix - Level x Department" Google Sheet.
 * The sheet stays the source of truth. The portal reads it with GET and
 * HR admins write it back with POST. Every write is logged.
 *
 * Tabs used:
 *   Approval Matrix    the grid HR already maintains (header row starts with "Level")
 *   Portal Admins      column A: emails allowed to edit from the portal (created on first run)
 *   Matrix Change Log  timestamp, editor, summary (created on first run)
 *
 * Script properties (Project Settings > Script properties):
 *   GOOGLE_CLIENT_ID   OAuth web client ID used by the portal's "Sign in with Google" button
 *   ALLOWED_DOMAIN     optional, defaults to aaico.com
 */

const MATRIX_TAB = 'Approval Matrix';
const ADMIN_TAB = 'Portal Admins';
const LOG_TAB = 'Matrix Change Log';
const FIXED_COLS = 3; // Level, Level title, Track
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------------- HTTP entry points ---------------- */

function doGet() {
  try {
    return json_({ ok: true, matrix: readMatrix_() });
  } catch (err) {
    return json_({ ok: false, error: 'read_failed', message: String(err) });
  }
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_request' }); }

  let email;
  try { email = verifyIdToken_(body.idToken); } catch (err) { return json_({ ok: false, error: 'unauthenticated', message: String(err.message || err) }); }
  const admin = isAdmin_(email);

  if (body.action === 'whoami') return json_({ ok: true, email: email, isAdmin: admin });
  if (body.action === 'log') return json_({ ok: true, log: readLog_(50) });
  if (body.action !== 'save') return json_({ ok: false, error: 'unknown_action' });
  if (!admin) return json_({ ok: false, error: 'forbidden', message: email + ' is not on the Portal Admins tab.' });

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(15000)) return json_({ ok: false, error: 'busy' });
  try {
    const current = readMatrix_();
    if (body.baseVersion && body.baseVersion !== current.version) {
      return json_({ ok: false, error: 'conflict', message: 'The sheet changed since you loaded it.', matrix: current });
    }
    const problems = validate_(body.matrix);
    if (problems.length) return json_({ ok: false, error: 'invalid', problems: problems });

    writeMatrix_(body.matrix);
    appendLog_(email, body.summary || []);
    return json_({ ok: true, matrix: readMatrix_() });
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- Matrix read / write ---------------- */

function matrixSheet_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(MATRIX_TAB);
  if (!sh) throw new Error('Tab "' + MATRIX_TAB + '" not found');
  return sh;
}

function findHeaderRow_(values) {
  for (let r = 0; r < values.length; r++) {
    if (String(values[r][0]).trim().toLowerCase() === 'level') return r;
  }
  throw new Error('Could not find the header row (a row whose first cell is "Level")');
}

function parseCell_(v) {
  return String(v || '')
    .split(/[\s,;]+/)
    .map(function (s) { return s.trim().toLowerCase(); })
    .filter(Boolean);
}

function readMatrix_() {
  const sh = matrixSheet_();
  const values = sh.getDataRange().getDisplayValues();
  const h = findHeaderRow_(values);
  const header = values[h];

  const depts = [];
  for (let c = FIXED_COLS; c < header.length; c++) {
    const name = String(header[c]).trim();
    if (!name) break;
    depts.push(name);
  }

  const levels = [], cells = [];
  for (let r = h + 1; r < values.length; r++) {
    const row = values[r];
    const code = String(row[0]).trim();
    if (!code) break;
    levels.push({ code: code, title: String(row[1]).trim(), track: String(row[2]).trim() });
    cells.push(depts.map(function (_, i) { return parseCell_(row[FIXED_COLS + i]); }));
  }

  const matrix = { levels: levels, depts: depts, cells: cells };
  matrix.version = hash_(JSON.stringify(matrix));
  matrix.updatedAt = new Date().toISOString();
  return matrix;
}

function writeMatrix_(m) {
  const sh = matrixSheet_();
  const values = sh.getDataRange().getDisplayValues();
  const h = findHeaderRow_(values);
  const startRow = h + 1; // 1-based row of the header

  // Clear the old block (contents only, so formatting and comments survive).
  let oldRows = 1;
  while (h + oldRows < values.length && String(values[h + oldRows][0]).trim()) oldRows++;
  let oldCols = FIXED_COLS;
  while (oldCols < values[h].length && String(values[h][oldCols]).trim()) oldCols++;
  const newCols = FIXED_COLS + m.depts.length;
  sh.getRange(startRow, 1, Math.max(oldRows, m.levels.length + 1), Math.max(oldCols, newCols)).clearContent();

  const out = [['Level', 'Level title', 'Track'].concat(m.depts)];
  m.levels.forEach(function (lv, r) {
    out.push([lv.code, lv.title, lv.track].concat(m.depts.map(function (_, c) {
      return ((m.cells[r] || [])[c] || []).join('\n');
    })));
  });
  sh.getRange(startRow, 1, out.length, newCols).setValues(out).setWrap(true);
  SpreadsheetApp.flush();
}

function validate_(m) {
  const p = [];
  if (!m || !Array.isArray(m.levels) || !Array.isArray(m.depts) || !Array.isArray(m.cells)) return ['Matrix payload is malformed'];
  if (!m.levels.length) p.push('At least one level is required');
  if (!m.depts.length) p.push('At least one department is required');
  const seenL = {}, seenD = {};
  m.levels.forEach(function (l) { const k = String(l.code).trim().toUpperCase(); if (!k) p.push('A level is missing its code'); if (seenL[k]) p.push('Duplicate level ' + k); seenL[k] = 1; });
  m.depts.forEach(function (d) { const k = String(d).trim().toLowerCase(); if (!k) p.push('A department is missing its name'); if (seenD[k]) p.push('Duplicate department ' + d); seenD[k] = 1; });
  if (m.cells.length !== m.levels.length) p.push('Row count does not match levels');
  const domain = (PropertiesService.getScriptProperties().getProperty('ALLOWED_DOMAIN') || 'aaico.com').toLowerCase();
  m.cells.forEach(function (row, r) {
    if (!Array.isArray(row) || row.length !== m.depts.length) { p.push('Row ' + (r + 1) + ' has the wrong number of departments'); return; }
    row.forEach(function (chain, c) {
      const where = m.levels[r].code + ' / ' + m.depts[c];
      if (!Array.isArray(chain) || !chain.length) { p.push(where + ': no approver'); return; }
      chain.forEach(function (em) {
        if (!EMAIL_RE.test(em)) p.push(where + ': "' + em + '" is not an email');
        else if (em.split('@')[1].toLowerCase() !== domain) p.push(where + ': ' + em + ' is not an @' + domain + ' address');
      });
    });
  });
  return p;
}

/* ---------------- Admins, auth, log ---------------- */

function verifyIdToken_(token) {
  if (!token) throw new Error('Missing sign-in token');
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Sign-in token rejected');
  const info = JSON.parse(res.getContentText());
  const props = PropertiesService.getScriptProperties();
  const clientId = props.getProperty('GOOGLE_CLIENT_ID');
  const domain = (props.getProperty('ALLOWED_DOMAIN') || 'aaico.com').toLowerCase();
  if (clientId && info.aud !== clientId) throw new Error('Token was issued for a different app');
  if (String(info.email_verified) !== 'true') throw new Error('Email not verified');
  const email = String(info.email).toLowerCase();
  if (email.split('@')[1] !== domain) throw new Error('Only @' + domain + ' accounts can sign in');
  return email;
}

function adminSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(ADMIN_TAB);
  if (!sh) {
    sh = ss.insertSheet(ADMIN_TAB);
    sh.getRange(1, 1, 1, 2).setValues([['Admin email', 'Notes']]).setFontWeight('bold');
  }
  return sh;
}

function isAdmin_(email) {
  const sh = adminSheet_();
  const last = sh.getLastRow();
  if (last < 2) return false;
  return sh.getRange(2, 1, last - 1, 1).getValues()
    .some(function (r) { return String(r[0]).trim().toLowerCase() === email; });
}

function logSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(LOG_TAB);
  if (!sh) {
    sh = ss.insertSheet(LOG_TAB);
    sh.getRange(1, 1, 1, 3).setValues([['When', 'Edited by', 'Changes']]).setFontWeight('bold');
    sh.setColumnWidth(3, 600);
  }
  return sh;
}

function appendLog_(email, summary) {
  const text = (Array.isArray(summary) ? summary : [String(summary)]).slice(0, 200).join('\n') || 'Saved with no listed changes';
  logSheet_().appendRow([new Date(), email, text]);
}

function readLog_(n) {
  const sh = logSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  const start = Math.max(2, last - n + 1);
  return sh.getRange(start, 1, last - start + 1, 3).getValues().reverse()
    .map(function (r) { return { when: new Date(r[0]).toISOString(), who: r[1], changes: String(r[2]) }; });
}

/* ---------------- helpers ---------------- */

function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('').slice(0, 16);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor to create the Admins and Log tabs and check the grid parses. */
function setup() {
  adminSheet_();
  logSheet_();
  const m = readMatrix_();
  Logger.log('Parsed %s levels x %s departments. Version %s', m.levels.length, m.depts.length, m.version);
}
