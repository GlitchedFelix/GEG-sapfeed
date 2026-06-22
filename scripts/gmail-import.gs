/**
 * GEG SAP Feed — Gmail Import Automation
 * ----------------------------------------
 * Runs hourly. Finds unread SAP report emails forwarded from Outlook,
 * determines brand from the subject line, and POSTs each .XLS attachment
 * to the /api/import-automated endpoint on the Vercel deployment.
 *
 * SETUP (one-time):
 *  1. Go to script.google.com > New project > paste this file
 *  2. Project Settings > Script Properties > add the three properties below:
 *       VERCEL_URL        → https://your-app.vercel.app  (no trailing slash)
 *       AUTOMATION_SECRET → the value from your Vercel AUTOMATION_SECRET env var
 *       ALERT_EMAIL       → your email address for failure notifications
 *  3. Run setupTrigger() once from the editor to create the hourly trigger
 *  4. Authorise the script when prompted (needs Gmail + URL Fetch permissions)
 *
 * VERCEL ENV VARS needed (add in Vercel Dashboard > Project > Settings > Environment Variables):
 *   AUTOMATION_SECRET      → same random string as above
 *   SUPABASE_SERVICE_ROLE_KEY → from Supabase Dashboard > Project Settings > API
 */

var LABEL_NAME = 'sap-imported';
var TZ = 'Africa/Johannesburg';

// ---------------------------------------------------------------------------
// Main entry point — runs every hour via time-based trigger
// ---------------------------------------------------------------------------

function checkForSapEmails() {
  var props = PropertiesService.getScriptProperties();
  var vercelUrl = props.getProperty('VERCEL_URL');
  var secret = props.getProperty('AUTOMATION_SECRET');
  var alertEmail = props.getProperty('ALERT_EMAIL');

  if (!vercelUrl || !secret || !alertEmail) {
    Logger.log('Script properties not configured. Run setupTrigger() after adding VERCEL_URL, AUTOMATION_SECRET, ALERT_EMAIL.');
    return;
  }

  var label = getOrCreateLabel(LABEL_NAME);

  // Emails arrive as manual or auto-forwards from Outlook, so the "from"
  // address is the forwarder (not the original SAP sender) and subjects
  // are prefixed with "FW: ". Search by the two known subject patterns only.
  // This Gmail account is dedicated to SAP imports so subject-only filtering is safe.
  var threads = GmailApp.search('(subject:"FW: Transport - ItalTile" OR subject:"FW: Transport") is:unread -label:' + LABEL_NAME);

  var processedToday = 0;

  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();

    for (var j = 0; j < messages.length; j++) {
      var msg = messages[j];
      if (!msg.isUnread()) continue;

      // Strip any "FW: " or "RE: " prefix Outlook may have added
      var rawSubject = msg.getSubject();
      var subject = rawSubject.replace(/^(FW|RE|FWD):\s*/i, '').trim();

      var brand;
      if (/italtile/i.test(subject)) {
        brand = 'ITALTILE';
      } else if (/^transport(\s+data)?$/i.test(subject)) {
        brand = 'CTM';
      } else {
        // Subject matched our search but isn't a pattern we recognise — alert and skip
        sendAlert(alertEmail, 'Unrecognised subject skipped', 'Subject: "' + rawSubject + '"\n\nThe email was left unread for manual review.');
        continue;
      }

      var attachments = msg.getAttachments();
      var xlsFiles = attachments.filter(function(a) {
        return a.getName().toUpperCase().slice(-4) === '.XLS';
      });

      if (xlsFiles.length === 0) {
        sendAlert(alertEmail, brand + ' email had no .XLS attachment', 'Subject: "' + rawSubject + '"\n\nThe email was left unread for manual review.');
        continue;
      }

      var allSucceeded = true;

      for (var k = 0; k < xlsFiles.length; k++) {
        var result = postToVercel(vercelUrl, secret, xlsFiles[k], brand);

        if (!result.ok) {
          sendAlert(
            alertEmail,
            brand + ' import failed',
            'File: ' + xlsFiles[k].getName() + '\nError: ' + result.error + '\n\nThe email was left unread so it will retry next hour.'
          );
          allSucceeded = false;
          break;
        }

        Logger.log(brand + ' | ' + xlsFiles[k].getName() + ' | inserted=' + result.data.inserted + ' duplicates=' + result.data.duplicates + ' errors=' + (result.data.errors || []).length);
      }

      if (allSucceeded) {
        msg.markRead();
        threads[i].addLabel(label);
        processedToday++;
      }
    }
  }

  checkForMissingEmails(alertEmail, processedToday);
}

// ---------------------------------------------------------------------------
// HTTP — POST file + brand to the Vercel endpoint
// ---------------------------------------------------------------------------

function postToVercel(vercelUrl, secret, attachment, brand) {
  var url = vercelUrl + '/api/import-automated';

  try {
    var response = UrlFetchApp.fetch(url, {
      method: 'post',
      payload: {
        brand: brand,
        file: attachment,
      },
      headers: {
        'x-automation-secret': secret,
      },
      muteHttpExceptions: true,
    });

    var code = response.getResponseCode();
    var body = response.getContentText();

    var json;
    try {
      json = JSON.parse(body);
    } catch (e) {
      return { ok: false, error: 'Non-JSON response (HTTP ' + code + '): ' + body.slice(0, 200) };
    }

    if (code !== 200) {
      return { ok: false, error: json.error || ('HTTP ' + code) };
    }

    return { ok: true, data: json };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Alert if no SAP emails have been processed by 10am on a weekday
// ---------------------------------------------------------------------------

function checkForMissingEmails(alertEmail, processedThisRun) {
  var now = new Date();
  var dayOfWeek = parseInt(Utilities.formatDate(now, TZ, 'u'), 10); // 1=Mon 7=Sun
  var hour = parseInt(Utilities.formatDate(now, TZ, 'H'), 10);

  // Only check weekdays after 10am SAST
  if (dayOfWeek >= 6 || hour < 10) return;

  var todayStr = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  var props = PropertiesService.getScriptProperties();
  var alertSentOn = props.getProperty('missing_alert_sent_on');

  // Already alerted today — don't spam
  if (alertSentOn === todayStr) return;

  // If this run processed something, we're fine
  if (processedThisRun > 0) return;

  // Check whether any earlier run today already labelled emails
  var alreadyDone = GmailApp.search('label:' + LABEL_NAME + ' after:' + todayStr);
  if (alreadyDone.length > 0) return;

  sendAlert(
    alertEmail,
    'No SAP emails processed today',
    'It is past 10:00 SAST on ' + todayStr + ' and no SAP report emails have been imported.\n\nCheck whether the SAP broadcast ran and whether the Outlook forward rule is active.'
  );
  props.setProperty('missing_alert_sent_on', todayStr);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendAlert(alertEmail, subject, body) {
  GmailApp.sendEmail(
    alertEmail,
    '[SAP Import Alert] ' + subject,
    body + '\n\n---\nSent by the GEG SAP Gmail automation script.'
  );
}

function getOrCreateLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

// ---------------------------------------------------------------------------
// Run this ONCE manually from the Apps Script editor to set up the trigger.
// It's safe to re-run — it clears existing triggers first.
// ---------------------------------------------------------------------------

function setupTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('checkForSapEmails')
    .timeBased()
    .everyHours(1)
    .create();
  Logger.log('Hourly trigger created for checkForSapEmails.');
}
