<?php
/**
 * index.php — Whitelist gate (server-side).
 *
 * The real application document (index.html, which contains ALL of the inline
 * CSS + UI) is NEVER served by nginx as a static file anymore — every request
 * for "/" lands here first. We decide, BEFORE emitting a single byte of the
 * app, whether this visitor is allowed to receive the code:
 *
 *   - Whitelist mode OFF  -> serve the real app to everyone (unchanged behaviour).
 *   - Whitelist mode ON   -> only devices whose deviceId cookie is on the
 *                            approved list receive the real app. Everyone else
 *                            gets the self-contained lock page below (logo +
 *                            starfield + message) and none of our actual code.
 *
 * This is what stops a random visitor from opening DevTools and lifting the
 * CSS/markup: an un-approved device literally never receives index.html.
 *
 * Approved users get index.html verbatim (readfile), so the licence app and all
 * of its styling are byte-for-byte identical to before.
 */

require_once __DIR__ . '/helpers.php';

$config       = safeReadJson(__DIR__ . '/.admin_config.json');
$whitelistOn  = is_array($config) && !empty($config['whitelist_mode']);

$serveRealApp = true;
if ($whitelistOn) {
    $deviceId  = isset($_COOKIE['deviceId']) ? trim($_COOKIE['deviceId']) : '';
    $approved  = safeReadList(__DIR__ . '/approved_devices.txt');
    $serveRealApp = ($deviceId !== '' && strtolower($deviceId) !== 'unknown' && in_array($deviceId, $approved, true));
}

if ($serveRealApp) {
    header('Content-Type: text/html; charset=utf-8');
    readfile(__DIR__ . '/index.html');
    exit;
}

// ---- Locked: emit only the gate page (no app code) -------------------------
http_response_code(200);
header('Content-Type: text/html; charset=utf-8');
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
  }
  .gate-logo pre {
    display: inline-block;
    margin: 0;
    font-family: monospace;
    font-size: clamp(6px, 2.4vw, 14px);
    line-height: 1.05;
    font-weight: 700;
    white-space: pre;
    letter-spacing: 0;
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
    <div class="gate-msg">This service is no longer available, please contact the owner to gain access</div>
  </div>

  <script>
  /* Identify this device exactly the way the app does (so the admin sees it as
     pending and can approve it), then poll the server — the moment the owner
     approves this device, reload straight into the real app. Mirrors
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

    function check() {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', 'log.php?action=checkBan&deviceId=' + encodeURIComponent(deviceId) + '&t=' + Date.now(), true);
        xhr.timeout = 10000;
        xhr.onload = function () {
          // "OK" means the server now allows this device (i.e. it was approved).
          if (xhr.status === 200 && xhr.responseText.trim() === 'OK') {
            location.reload();
          }
        };
        xhr.send();
      } catch (e) {}
    }
    check();
    setInterval(check, 20000);
  })();
  </script>
</body>
</html>
