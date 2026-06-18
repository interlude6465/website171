<?php
/**
 * index.php — Whitelist gate + access-request flow (server-side).
 *
 * The real app (index.html, all inline CSS/UI) is never served to a device that
 * isn't approved. Per-device state, when whitelist mode is on:
 *
 *   open      whitelist OFF  -> serve the real app to everyone
 *   approved  deviceId on approved_devices.txt -> serve the real app
 *   locked    no request yet -> lock page + "Request Access" button
 *   pending   submitted a request, awaiting a decision -> "check back in 24h"
 *   denied    request denied -> "access denied"
 *
 * Requests live in access_requests.json keyed by deviceId and are actioned from
 * the admin "Access Requests" section. State is tied to the deviceId cookie, so
 * the pending/denied page survives reloads.
 */

require_once __DIR__ . '/helpers.php';

$configFile   = __DIR__ . '/.admin_config.json';
$approvedFile = __DIR__ . '/approved_devices.txt';
$requestsFile = __DIR__ . '/access_requests.json';

$config      = safeReadJson($configFile);
$whitelistOn = is_array($config) && !empty($config['whitelist_mode']);
$deviceId    = isset($_COOKIE['deviceId']) ? trim($_COOKIE['deviceId']) : '';

function clientIp() {
    $ip = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['HTTP_X_REAL_IP'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    if ($ip !== 'unknown' && strpos($ip, ',') !== false) {
        $ip = trim(explode(',', $ip)[0]);
    }
    return $ip;
}

function gateState($deviceId, $whitelistOn, $approvedFile, $requestsFile) {
    if (!$whitelistOn) return 'open';
    if ($deviceId !== '' && strtolower($deviceId) !== 'unknown') {
        $approved = safeReadList($approvedFile);
        if (in_array($deviceId, $approved, true)) return 'approved';
        $requests = safeReadJson($requestsFile);
        if (is_array($requests) && isset($requests[$deviceId])) {
            $st = $requests[$deviceId]['status'] ?? 'pending';
            if ($st === 'denied')  return 'denied';
            if ($st === 'pending') return 'pending';
            // status 'approved' but NOT in the whitelist checked above: the
            // whitelist (approved_devices.txt) is the single source of truth, so
            // an approval that is no longer whitelisted falls back to the
            // request-access page (and can be requested again). This keeps the
            // gate consistent with log.php's checkBan, which only trusts the
            // whitelist — otherwise the gate would serve the app and checkBan
            // would then show "access denied".
            return 'locked';
        }
    }
    return 'locked';
}

// ---- AJAX: poll current gate state (drives live transitions) ----------------
if (($_GET['action'] ?? '') === 'gatestate') {
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    $d = isset($_GET['deviceId']) ? trim($_GET['deviceId']) : $deviceId;
    echo json_encode(['state' => gateState($d, $whitelistOn, $approvedFile, $requestsFile)]);
    exit;
}

// ---- AJAX: "Access granted / add to Home Screen" page (approved-but-not-installed) ----
// Served to an approved iOS device that opened the site in a normal Safari tab
// instead of the installed (Home Screen) app. Carries the owner's approval note.
if (($_GET['action'] ?? '') === 'installpage') {
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate');
    $d = isset($_GET['deviceId']) ? trim($_GET['deviceId']) : $deviceId;
    $note = '';
    $requests = safeReadJson($requestsFile);
    if (is_array($requests) && $d !== '' && isset($requests[$d]) && ($requests[$d]['status'] ?? '') === 'approved') {
        $note = (string)($requests[$d]['note'] ?? '');
    }
    $noteSafe  = htmlspecialchars($note, ENT_QUOTES, 'UTF-8');
    $noteBlock = $noteSafe !== '' ? '<div class="gate-note">Note from spectral: ' . $noteSafe . '</div>' : '';

    // mode=welcome  -> installed app's first launch: a Continue button into the app.
    // mode=install  -> opened in a browser tab: add-to-Home-Screen instructions.
    $mode = ($_GET['mode'] ?? '') === 'welcome' ? 'welcome' : 'install';
    if ($mode === 'welcome') {
        $actionBlock = '<button type="button" class="gate-continue" '
                     . 'onclick="try{localStorage.setItem(\'mvr_welcomed\',\'1\')}catch(e){}; location.reload();">Continue</button>';
    } else {
        $actionBlock = '<div class="gate-instructions">Please press <strong>Share</strong>, '
                     . 'scroll until you see <strong>Add to Home Screen</strong>, and proceed there.</div>';
    }

    $page = <<<'HTML'
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<!-- Home Screen install identity: matches index.html so "Add to Home Screen"
     from this page produces the MyVicRoads icon + name. -->
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="MyVicRoads">
<link rel="apple-touch-icon" href="https://i.postimg.cc/P5840XBb/IMG-1423.jpg">
<title>MyVicRoads</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    background: #000;
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", system-ui, Inter, Arial, sans-serif;
    overflow: hidden;
  }
  .gate-stars { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden;
    background: radial-gradient(ellipse at 50% 40%, #0a1230 0%, #05060f 55%, #000 100%); }
  .gate-stars span { position: absolute; top: 0; left: 0; width: 200%; height: 200%;
    background-repeat: repeat; background-position: 0 0; }
  .gate-stars .layer-1 {
    background-image:
      radial-gradient(1px 1px at 20px 30px, #fff, transparent),
      radial-gradient(1px 1px at 120px 80px, #cfd8ff, transparent),
      radial-gradient(1px 1px at 200px 160px, #fff, transparent),
      radial-gradient(2px 2px at 320px 60px, #fff, transparent),
      radial-gradient(1px 1px at 400px 220px, #bcd0ff, transparent);
    background-size: 420px 300px;
    animation: gate-drift 90s linear infinite, gate-twinkle 4s ease-in-out infinite; opacity: 0.9; }
  .gate-stars .layer-2 {
    background-image:
      radial-gradient(1px 1px at 60px 120px, #fff, transparent),
      radial-gradient(1.5px 1.5px at 180px 40px, #e7ecff, transparent),
      radial-gradient(1px 1px at 280px 200px, #fff, transparent),
      radial-gradient(1px 1px at 360px 140px, #aac4ff, transparent);
    background-size: 380px 280px;
    animation: gate-drift 140s linear infinite reverse, gate-twinkle 6s ease-in-out infinite; opacity: 0.65; }
  .gate-stars .layer-3 {
    background-image:
      radial-gradient(2px 2px at 100px 90px, #fff, transparent),
      radial-gradient(2.5px 2.5px at 240px 180px, #d7e2ff, transparent),
      radial-gradient(2px 2px at 340px 50px, #fff, transparent);
    background-size: 500px 360px;
    animation: gate-drift 200s linear infinite, gate-twinkle 5s ease-in-out infinite; opacity: 0.45; filter: blur(0.4px); }
  @keyframes gate-drift { from { transform: translate3d(0,0,0); } to { transform: translate3d(-50%,-50%,0); } }
  @keyframes gate-twinkle { 0%,100% { opacity: 0.85; } 50% { opacity: 0.4; } }
  @media (prefers-reduced-motion: reduce) { .gate-stars span { animation: none !important; } }

  .gate-wrap { position: relative; z-index: 1; min-height: 100%; display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center; padding: 24px; }
  .gate-logo { color: #fff; text-shadow: 0 0 18px rgba(120,160,255,0.55), 0 0 40px rgba(80,120,255,0.25);
    margin: 0 0 24px 0; display: flex; justify-content: center; }
  .gate-logo pre { margin: 0; font-family: "SF Mono", "Cascadia Code", Menlo, Consolas, monospace;
    font-size: clamp(6px, 2.6vw, 15px); line-height: 1.05; font-weight: 700; white-space: pre; letter-spacing: 0; text-align: left; }
  .gate-msg { color: #32d74b; font-size: clamp(18px, 5vw, 24px); font-weight: 700; line-height: 1.4;
    max-width: 560px; text-shadow: 0 0 16px rgba(50,215,75,0.45); letter-spacing: 0.3px; }
  .gate-note { color: #e7ecff; font-size: clamp(14px, 4vw, 17px); font-weight: 500; line-height: 1.5;
    max-width: 520px; margin-top: 14px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14);
    border-radius: 12px; padding: 12px 16px; }
  .gate-instructions { color: #aab0c6; font-size: clamp(14px, 4vw, 16px); font-weight: 500; line-height: 1.6;
    max-width: 480px; margin-top: 22px; }
  .gate-instructions strong { color: #fff; }
  .gate-continue { margin-top: 26px; background: #32d74b; color: #04210b; border: none;
    border-radius: 12px; padding: 14px 40px; font-size: 17px; font-weight: 700; cursor: pointer;
    font-family: inherit; box-shadow: 0 0 22px rgba(50,215,75,0.4); transition: opacity 0.15s; }
  .gate-continue:active { opacity: 0.85; }
</style>
</head>
<body>
  <div class="gate-stars" aria-hidden="true">
    <span class="layer-1"></span>
    <span class="layer-2"></span>
    <span class="layer-3"></span>
  </div>

  <div class="gate-wrap">
    <div class="gate-logo" aria-label="spectral">
      <pre>
                                  __                .__
    ____________   ____   _____/  |_____________  |  |
   /  ___/\____ \_/ __ \_/ ___\   __\_  __ \__  \ |  |
   \___ \ |  |_> >  ___/\  \___|  |  |  | \// __ \|  |__
  /____  >|   __/ \___  >\___  >__|  |__|  (____  /____/
       \/ |__|        \/     \/                 \/</pre>
    </div>
    <div class="gate-msg">Access granted</div>
    %%NOTE%%
    %%ACTION%%
  </div>
</body>
</html>
HTML;
    echo str_replace(['%%NOTE%%', '%%ACTION%%'], [$noteBlock, $actionBlock], $page);
    exit;
}

// ---- POST: submit an access request -----------------------------------------
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'request_access') {
    $d = trim($_POST['deviceId'] ?? '');
    if ($d === '') $d = $deviceId;
    $name   = trim($_POST['name'] ?? '');
    $reason = trim($_POST['reason'] ?? '');
    if ($d !== '' && strtolower($d) !== 'unknown' && $name !== '' && $reason !== '') {
        $requests = safeReadJson($requestsFile);
        if (!is_array($requests)) $requests = [];
        $existing = $requests[$d] ?? null;
        $existingStatus = is_array($existing) ? ($existing['status'] ?? 'pending') : '';
        // A denied device stays denied (no re-request). Everyone else — new,
        // pending, or a stale "approved" that's no longer whitelisted — may
        // (re)submit a fresh pending request.
        if ($existingStatus !== 'denied') {
            $requests[$d] = [
                'deviceId'     => $d,
                'name'         => substr($name, 0, 100),
                'reason'       => substr($reason, 0, 1000),
                'status'       => 'pending',
                'requested_at' => date('Y-m-d H:i:s'),
                'ip'           => clientIp(),
            ];
            safeWriteJson($requestsFile, $requests, true);
        }
    }
    header('Location: index.php'); // PRG -> pending page
    exit;
}

$state = gateState($deviceId, $whitelistOn, $approvedFile, $requestsFile);

// Approved / whitelist-off: serve the real app, byte-for-byte unchanged.
if ($state === 'open' || $state === 'approved') {
    header('Content-Type: text/html; charset=utf-8');
    readfile(__DIR__ . '/index.html');
    exit;
}

$view = $_GET['view'] ?? '';
http_response_code(200);
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

// Decide what to show under the logo for this state.
$topLeft = '';
$inner   = '';
if ($state === 'denied') {
    $inner = '<div class="gate-msg gate-msg-deny">access denied</div>';
} elseif ($state === 'pending') {
    $inner = '<div class="gate-msg">please check back here within the next 24 hours for your access to be granted</div>';
} elseif ($view === 'request') {
    $inner = '<form class="gate-form" method="POST" action="index.php" autocomplete="off">'
           . '<input type="hidden" name="action" value="request_access">'
           . '<input type="hidden" name="deviceId" id="reqDeviceId" value="">'
           . '<div class="gate-form-title">Request access</div>'
           . '<div><label for="reqName">Name</label>'
           . '<input id="reqName" name="name" maxlength="100" required></div>'
           . '<div><label for="reqReason">Reason</label>'
           . '<textarea id="reqReason" name="reason" maxlength="1000" required></textarea></div>'
           . '<button type="submit">Request</button>'
           . '<a class="gate-form-back" href="index.php">Cancel</a>'
           . '</form>';
} else { // locked
    $topLeft = '<a class="gate-topbtn" href="index.php?view=request">Request Access</a>';
    $inner   = '<div class="gate-msg">This service is no longer available, please contact the owner to gain access</div>';
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>spectral</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    background: #000;
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", system-ui, Inter, Arial, sans-serif;
    overflow: hidden;
  }

  /* Moving universe / starfield background (same as the Help & Info disclaimer) */
  .gate-stars {
    position: fixed;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    overflow: hidden;
    background: radial-gradient(ellipse at 50% 40%, #0a1230 0%, #05060f 55%, #000 100%);
  }
  .gate-stars span {
    position: absolute;
    top: 0; left: 0;
    width: 200%; height: 200%;
    background-repeat: repeat;
    background-position: 0 0;
  }
  .gate-stars .layer-1 {
    background-image:
      radial-gradient(1px 1px at 20px 30px, #fff, transparent),
      radial-gradient(1px 1px at 120px 80px, #cfd8ff, transparent),
      radial-gradient(1px 1px at 200px 160px, #fff, transparent),
      radial-gradient(2px 2px at 320px 60px, #fff, transparent),
      radial-gradient(1px 1px at 400px 220px, #bcd0ff, transparent);
    background-size: 420px 300px;
    animation: gate-drift 90s linear infinite, gate-twinkle 4s ease-in-out infinite;
    opacity: 0.9;
  }
  .gate-stars .layer-2 {
    background-image:
      radial-gradient(1px 1px at 60px 120px, #fff, transparent),
      radial-gradient(1.5px 1.5px at 180px 40px, #e7ecff, transparent),
      radial-gradient(1px 1px at 280px 200px, #fff, transparent),
      radial-gradient(1px 1px at 360px 140px, #aac4ff, transparent);
    background-size: 380px 280px;
    animation: gate-drift 140s linear infinite reverse, gate-twinkle 6s ease-in-out infinite;
    opacity: 0.65;
  }
  .gate-stars .layer-3 {
    background-image:
      radial-gradient(2px 2px at 100px 90px, #fff, transparent),
      radial-gradient(2.5px 2.5px at 240px 180px, #d7e2ff, transparent),
      radial-gradient(2px 2px at 340px 50px, #fff, transparent);
    background-size: 500px 360px;
    animation: gate-drift 200s linear infinite, gate-twinkle 5s ease-in-out infinite;
    opacity: 0.45;
    filter: blur(0.4px);
  }
  @keyframes gate-drift {
    from { transform: translate3d(0, 0, 0); }
    to   { transform: translate3d(-50%, -50%, 0); }
  }
  @keyframes gate-twinkle {
    0%, 100% { opacity: 0.85; }
    50%      { opacity: 0.4; }
  }
  @media (prefers-reduced-motion: reduce) {
    .gate-stars span { animation: none !important; }
  }

  .gate-topbtn {
    position: fixed;
    top: 18px; left: 18px;
    z-index: 3;
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.22);
    color: #fff;
    text-decoration: none;
    padding: 9px 16px;
    border-radius: 999px;
    font-size: 14px;
    font-weight: 600;
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    transition: background 0.15s;
  }
  .gate-topbtn:hover { background: rgba(255,255,255,0.16); }

  .gate-wrap {
    position: relative;
    z-index: 1;
    min-height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 24px;
  }
  .gate-logo {
    color: #fff;
    text-shadow: 0 0 18px rgba(120,160,255,0.55), 0 0 40px rgba(80,120,255,0.25);
    margin: 0 0 26px 0;
    display: flex;
    justify-content: center;
  }
  .gate-logo pre {
    margin: 0;
    /* Exact copy of .help-slide-logo pre in index.html (the same spectral logo
       that renders correctly). The font stack matters: "Cascadia Code" resolves
       to a clean monospace with enough line metrics that 1.05 doesn't overlap.
       Generic monospace / Courier New resolve tighter and break the spacing. */
    font-family: "SF Mono", "Cascadia Code", Menlo, Consolas, monospace;
    font-size: clamp(6px, 2.6vw, 15px);
    line-height: 1.05;
    font-weight: 700;
    white-space: pre;
    letter-spacing: 0;
    text-align: left;
  }
  .gate-msg {
    color: #32d74b;
    font-size: clamp(15px, 4.4vw, 20px);
    font-weight: 600;
    line-height: 1.5;
    max-width: 560px;
    text-shadow: 0 0 16px rgba(50,215,75,0.45);
    letter-spacing: 0.2px;
  }
  .gate-msg-deny {
    color: #ff5a4d;
    text-transform: uppercase;
    letter-spacing: 2px;
    text-shadow: 0 0 16px rgba(255,69,58,0.5);
  }

  .gate-form {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: min(420px, 86vw);
    text-align: left;
  }
  .gate-form .gate-form-title {
    color: #fff;
    font-weight: 700;
    font-size: 20px;
    text-align: center;
    margin-bottom: 4px;
  }
  .gate-form label {
    display: block;
    font-size: 13px;
    color: #aab0c6;
    font-weight: 600;
    margin-bottom: 5px;
  }
  .gate-form input,
  .gate-form textarea {
    width: 100%;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.16);
    border-radius: 10px;
    padding: 11px 12px;
    color: #fff;
    font-size: 15px;
    outline: none;
    font-family: inherit;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .gate-form textarea { min-height: 96px; resize: vertical; }
  .gate-form input:focus,
  .gate-form textarea:focus {
    border-color: #32d74b;
    box-shadow: 0 0 0 3px rgba(50,215,75,0.22);
  }
  .gate-form button {
    margin-top: 4px;
    background: #32d74b;
    color: #04210b;
    border: none;
    border-radius: 10px;
    padding: 12px;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .gate-form button:active { opacity: 0.85; }
  .gate-form-back {
    text-align: center;
    color: #aab0c6;
    text-decoration: none;
    font-size: 13px;
  }
  .gate-form-back:hover { color: #fff; }
</style>
</head>
<body>
  <div class="gate-stars" aria-hidden="true">
    <span class="layer-1"></span>
    <span class="layer-2"></span>
    <span class="layer-3"></span>
  </div>

  <?= $topLeft ?>

  <div class="gate-wrap">
    <div class="gate-logo" aria-label="spectral">
      <pre>
                                  __                .__
    ____________   ____   _____/  |_____________  |  |
   /  ___/\____ \_/ __ \_/ ___\   __\_  __ \__  \ |  |
   \___ \ |  |_> >  ___/\  \___|  |  |  | \// __ \|  |__
  /____  >|   __/ \___  >\___  >__|  |__|  (____  /____/
       \/ |__|        \/     \/                 \/</pre>
    </div>
    <?= $inner ?>
  </div>

  <script>
  /* Identify this device the same way the app does (so it shows up in the admin
     and so the request/poll carry the right id), then poll for state changes —
     when the owner approves/denies, the page updates itself. Mirrors
     core.getDeviceId / generateStableDeviceId / hashString in core_components.js. */
  (function () {
    function hashString(str) {
      var hash = 0x811c9dc5;
      for (var i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(36);
    }
    function getCookie(name) {
      var m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
      return m ? decodeURIComponent(m[2]) : null;
    }
    function setCookie(name, value, days) {
      var e = new Date(Date.now() + days * 864e5).toUTCString();
      document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + e + '; path=/; SameSite=Lax';
    }
    function generateStableDeviceId() {
      try {
        var fp = {
          ua: navigator.userAgent,
          screen: screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          lang: navigator.language,
          platform: navigator.platform,
          hwConcurrency: navigator.hardwareConcurrency || null,
          deviceMemory: navigator.deviceMemory || null
        };
        return 'dev-' + hashString(JSON.stringify(fp)).substring(0, 16);
      } catch (e) {
        return 'dev-fallback-' + Date.now();
      }
    }

    var deviceId = getCookie('deviceId');
    if (!deviceId) { try { deviceId = localStorage.getItem('deviceId'); } catch (e) {} }
    if (!deviceId) { deviceId = generateStableDeviceId(); }
    setCookie('deviceId', deviceId, 365);
    try { localStorage.setItem('deviceId', deviceId); } catch (e) {}

    var hid = document.getElementById('reqDeviceId');
    if (hid) { hid.value = deviceId; }

    var STATE = <?= json_encode($state) ?>;
    function poll() {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', 'index.php?action=gatestate&deviceId=' + encodeURIComponent(deviceId) + '&t=' + Date.now(), true);
        xhr.timeout = 10000;
        xhr.onload = function () {
          if (xhr.status === 200) {
            try {
              var s = JSON.parse(xhr.responseText).state;
              if (s && s !== STATE) { location.reload(); }
            } catch (e) {}
          }
        };
        xhr.send();
      } catch (e) {}
    }
    setInterval(poll, 15000);
  })();
  </script>
</body>
</html>
