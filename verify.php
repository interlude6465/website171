<?php
/* verify.php — public "Verification of Permit" page (the scanned QR destination).
 *
 * The licence app (served only to the owner's device) pushes a snapshot of the
 * current name / photo / address to this endpoint, keyed by a random token. The
 * Reveal-QR sheet encodes  verify.php?id=<token>  so anyone who scans the code
 * lands on this read-only verification page rendered from that snapshot.
 *
 *   POST ?action=save  { token, name, address, photo }  -> { ok, token }
 *   GET  ?id=<token>                                     -> renders the page
 *
 * Snapshots live in verify_data/<token>.json (git-ignored runtime state).
 */

$DATA_DIR = __DIR__ . '/verify_data';

function vf_token($t) {
    return (is_string($t) && preg_match('/^[A-Za-z0-9_-]{8,64}$/', $t)) ? $t : '';
}

/* ---------------- SAVE SNAPSHOT ---------------- */
if (($_GET['action'] ?? '') === 'save' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    header('Content-Type: application/json');
    $in = json_decode(file_get_contents('php://input'), true);
    if (!is_array($in)) { echo json_encode(['ok' => false, 'error' => 'bad json']); exit; }

    $token = vf_token($in['token'] ?? '');
    if ($token === '') { echo json_encode(['ok' => false, 'error' => 'bad token']); exit; }

    if (!is_dir($DATA_DIR)) { @mkdir($DATA_DIR, 0775, true); }

    $photo = (string)($in['photo'] ?? '');
    if (strpos($photo, 'data:image') !== 0 || strlen($photo) > 700000) { $photo = ''; }

    $rec = [
        'name'    => substr(trim((string)($in['name'] ?? '')), 0, 80),
        'address' => substr(trim((string)($in['address'] ?? '')), 0, 200),
        'photo'   => $photo,
        'savedAt' => time(),
    ];
    @file_put_contents($DATA_DIR . '/' . $token . '.json', json_encode($rec));
    echo json_encode(['ok' => true, 'token' => $token]);
    exit;
}

/* ---------------- RENDER PAGE ---------------- */
$token = vf_token($_GET['id'] ?? '');
$rec   = null;
if ($token !== '') {
    $f = $DATA_DIR . '/' . $token . '.json';
    if (is_file($f)) { $rec = json_decode(file_get_contents($f), true); }
}

$found   = is_array($rec) && trim((string)($rec['name'] ?? '')) !== '';
$name    = $found ? (string)$rec['name'] : '';
$address = $found ? (string)$rec['address'] : '';
$photo   = $found ? (string)($rec['photo'] ?? '') : '';
if (strpos($photo, 'data:image') !== 0) { $photo = ''; }

/* Timestamp = when the QR was generated (snapshot saved), in local time —
   not when the page is scanned. savedAt is a unix time recorded at save. */
date_default_timezone_set('Australia/Melbourne');
$savedTs    = ($found && !empty($rec['savedAt'])) ? (int)$rec['savedAt'] : time();
$verifiedAt = date('D j M Y', $savedTs) . ' ' . strtolower(date('g:ia', $savedTs));

function e($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
/* address arrives as plain text with newlines between lines */
function addr_html($s) {
    $s = e($s);
    return nl2br(str_replace(["\r\n", "\r", "\n"], "\n", $s));
}
?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no">
<meta name="theme-color" content="#ffffff">
<title>Verification of Permit</title>
<style>
@font-face { font-family:'VicRoads'; src:url('/apk_loot/fonts/vic_regular.otf') format('opentype');  font-weight:400; font-display:swap; }
@font-face { font-family:'VicRoads'; src:url('/apk_loot/fonts/vic_medium.otf') format('opentype');   font-weight:500; font-display:swap; }
@font-face { font-family:'VicRoads'; src:url('/apk_loot/fonts/vic_semibold.otf') format('opentype'); font-weight:600; font-display:swap; }
@font-face { font-family:'VicRoads'; src:url('/apk_loot/fonts/vic_bold.otf') format('opentype');     font-weight:700; font-display:swap; }

:root{
  --navy:#3f4d5c;
  --grey:#7c8893;
  --green-card:#c8dcb0;
  --holo-opacity:0.2;
}
*{ box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
html,body{ margin:0; padding:0; background:#ffffff; }
body{
  font-family:"VicRoads",Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial;
  color:var(--navy);
  -webkit-font-smoothing:antialiased;
  padding-bottom:env(safe-area-inset-bottom);
}

/* Sizes are matched 1:1 to the real myVicRoads verification page (measured
   from reference screenshots at their native 375pt width → CSS px below). */

/* ---- header ---- */
.vhead{
  position:sticky; top:0; z-index:50;
  background:#ffffff;
  padding:calc(env(safe-area-inset-top) + 8px) 16px 9px;
  display:flex; align-items:center; justify-content:space-between;
  border-bottom:1px solid #eceff2;
}
.vhead .back{ font-size:22px; color:var(--navy); width:34px; }
.vhead .title{ font-size:18px; font-weight:700; color:var(--navy); }
.vhead .close{ font-size:17px; color:var(--navy); width:52px; text-align:right; font-weight:400; }
.vhead .back, .vhead .close{ background:none; border:0; font-family:inherit; cursor:pointer; }

/* ---- verified banner ---- */
.verified{ text-align:center; padding:26px 20px 22px; }
.verified .tick{
  width:56px; height:56px; border-radius:50%;
  background:#1d8a38; margin:0 auto 14px;
  display:flex; align-items:center; justify-content:center;
}
.verified .tick svg{ width:30px; height:30px; }
.verified h1{ margin:0; font-size:22px; font-weight:700; color:var(--navy); }

/* ---- red probationary licence banner (matches the licence card header) ---- */
.permit-banner{
  background:#dc3327;
  padding:13px 16px;
  display:flex; align-items:center; justify-content:space-between;
  box-shadow:0 3px 6px rgba(0,0,0,0.18), inset 0 -3px 4px rgba(255,255,255,0.12);
}
.permit-banner .pb-type{ font-size:16px; font-weight:800; color:#fff; line-height:1.12; letter-spacing:.3px; }
.permit-banner .pb-sub{ font-size:13px; font-weight:500; color:#fff; opacity:.96; margin-top:2px; }
.permit-banner img{ height:22px; width:auto; flex:none; }

/* ---- green photo card (matches licence card-section) ---- */
.card-section{
  position:relative;
  padding:16px 14px;
  background-color:var(--green-card);
  background-image:
    url('/apk_loot/logos/floral_bgro_w.webp'),
    radial-gradient(ellipse at 30% 25%, rgba(255,255,255,0.18), transparent 55%),
    repeating-linear-gradient(135deg, rgba(255,255,255,0.04) 0, rgba(255,255,255,0.04) 2px, transparent 2px, transparent 7px);
  background-size:cover, auto, auto;
  background-position:center, 0 0, 0 0;
  background-repeat:no-repeat, no-repeat, repeat;
  overflow:hidden;
}
.photo{
  position:relative;
  width:168px; height:212px;
  margin:0 auto;
  background:rgba(255,255,255,0.35);
  border-radius:12px;
  overflow:hidden;           /* clip the crest to the photo, like the licence card */
  contain:layout;
  box-shadow:0 1px 4px rgba(0,0,0,0.08);
}
.photo > img.face{ width:100%; height:100%; object-fit:cover; display:block; border-radius:12px; }
.photo .placeholder{
  width:100%; height:100%; display:flex; align-items:center; justify-content:center;
  color:#9fb389; font-size:12px; text-align:center; padding:10px; border-radius:12px;
}
.hologram-coat-of-arms{
  position:absolute; top:50%; left:49%;
  width:115%; aspect-ratio:1/1;
  transform:translate(-50%,-50%);
  pointer-events:none; z-index:10;
  opacity:var(--holo-opacity);
  mix-blend-mode:screen;
}
.hologram-coat-of-arms img{ width:100%; height:100%; object-fit:contain; object-position:center; display:block; }

/* ---- details ---- */
.vname{ font-size:18px; font-weight:700; color:var(--navy); padding:22px 18px 12px; letter-spacing:.2px; }
.vrule{ border:0; border-top:1px solid #e4e8ec; margin:0 18px; }
.vfield{ padding:14px 18px 4px; }
.vfield .label{ font-size:14px; color:var(--grey); font-weight:400; margin-bottom:6px; }
.vfield .value{ font-size:16px; font-weight:700; color:var(--navy); line-height:1.3; }

.section-bar{ background:#eceff2; padding:13px 18px; font-size:15px; font-weight:700; color:var(--navy); margin-top:14px; }

.status-row{ padding:14px 18px 2px; }
.status-row .label{ font-size:14px; color:var(--grey); margin-bottom:8px; }
.status-row .val{ display:flex; align-items:center; gap:10px; font-size:17px; font-weight:700; color:var(--navy); }
.mini-tick{ width:26px; height:26px; border-radius:50%; background:#1d8a38; display:inline-flex; align-items:center; justify-content:center; flex:none; }
.mini-tick svg{ width:14px; height:14px; }
.p-badge{ height:26px; width:auto; flex:none; display:block; }

.verified-with{
  margin:18px 16px calc(env(safe-area-inset-bottom) + 22px);
  background:#eef1f4; border-radius:12px;
  padding:16px 14px; text-align:center;
}
.verified-with .vw-label{ font-size:15px; color:var(--navy); font-weight:500; margin-bottom:6px; }
.verified-with img{ height:24px; width:auto; margin-bottom:6px; }
.verified-with .vw-time{ font-size:14px; color:var(--navy); }

/* tap hint for enabling reflections on iOS (needs a gesture for motion perms) */
.holo-hint{
  position:fixed; left:50%; bottom:calc(env(safe-area-inset-bottom) + 14px);
  transform:translateX(-50%);
  background:rgba(31,38,48,.9); color:#fff; font-size:13px;
  padding:9px 16px; border-radius:20px; z-index:80;
  border:0; font-family:inherit;
}

.notfound{ text-align:center; padding:80px 28px; color:var(--navy); }
.notfound .x{ width:84px; height:84px; border-radius:50%; background:#c23b3b; margin:0 auto 20px; display:flex; align-items:center; justify-content:center; font-size:46px; color:#fff; }
.notfound h1{ font-size:26px; font-weight:700; margin:0 0 10px; }
.notfound p{ font-size:16px; color:var(--grey); }
</style>
</head>
<body>

<div class="vhead">
  <button class="back" onclick="history.back()" aria-label="Back">&#8249;</button>
  <div class="title">Verification of Permit</div>
  <button class="close" onclick="history.back()">Close</button>
</div>

<?php if (!$found): ?>
  <div class="notfound">
    <div class="x">&times;</div>
    <h1>Permit could not be verified</h1>
    <p>This verification link is invalid or has expired. Ask the holder to reveal a fresh QR code.</p>
  </div>
<?php else: ?>

  <div class="verified">
    <div class="tick">
      <svg viewBox="0 0 24 24" fill="none"><path d="M4 12.5l5 5 11-11" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>
    <h1>Permit Verified</h1>
  </div>

  <div class="permit-banner">
    <div>
      <div class="pb-type">PROBATIONARY DRIVER LICENCE</div>
      <div class="pb-sub">Victoria Australia</div>
    </div>
    <img src="/apk_loot/icons/logos/vicroads_logo_white.svg" alt="VicRoads">
  </div>

  <div class="card-section">
    <div class="photo">
      <?php if ($photo): ?>
        <img class="face" src="<?php echo e($photo); ?>" alt="Licence photo">
      <?php else: ?>
        <div class="placeholder">No photo on file</div>
      <?php endif; ?>
      <div class="hologram-coat-of-arms" id="hologramOverlay">
        <img src="/apk_loot/logos/vic_coat_of_arms.png" alt="" aria-hidden="true">
      </div>
    </div>
  </div>

  <div class="vname"><?php echo e(strtoupper($name)); ?></div>
  <hr class="vrule">

  <div class="vfield">
    <div class="label">Address</div>
    <div class="value"><?php echo addr_html(strtoupper($address)); ?></div>
  </div>

  <div class="section-bar">Car licence details</div>

  <div class="status-row">
    <div class="label">Licence status</div>
    <div class="val">
      <span class="mini-tick"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4 4 10-10" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      Current
    </div>
  </div>

  <div class="status-row">
    <div class="label">Proficiency</div>
    <div class="val"><img class="p-badge" src="/apk_loot/icons/badges/red_probationary_icon.svg" alt="P"> P1</div>
  </div>

  <div class="verified-with">
    <div class="vw-label">Details verified with</div>
    <img src="/apk_loot/icons/logos/vicroads_logo_color.svg" alt="VicRoads"><br>
    <span class="vw-time"><?php echo e($verifiedAt); ?></span>
  </div>

  <button class="holo-hint" id="holoHint" style="display:none">Tap to enable reflections</button>

  <script>
  /* Coat-of-arms hologram — opacity tracks device motion RAW (no smoothing),
     mirroring the licence page. iOS 13+ needs a user gesture to grant motion. */
  (function(){
    var root = document.documentElement;
    var BASE = 0.2, MAX = 1.0, active = false;
    function compute(beta, gamma){
      beta = beta || 0; gamma = gamma || 0;
      var b = Math.abs(beta), g = Math.abs(gamma);
      var betaOp;
      if (b >= 75) betaOp = MAX;
      else if (b <= 0) betaOp = BASE;
      else betaOp = BASE + (MAX - BASE) * (b / 75);
      var gammaOp = BASE + (MAX - BASE) * Math.min(g / 45, 1);
      return Math.min(MAX, Math.max(BASE, Math.max(betaOp, gammaOp)));
    }
    function onOrient(e){
      if (!active) return;
      root.style.setProperty('--holo-opacity', compute(e.beta, e.gamma).toFixed(3));
    }
    function enable(){
      if (active) return;
      active = true;
      window.addEventListener('deviceorientation', onOrient);
      var h = document.getElementById('holoHint'); if (h) h.style.display = 'none';
    }
    var needsPerm = (typeof DeviceOrientationEvent !== 'undefined' &&
                     typeof DeviceOrientationEvent.requestPermission === 'function');
    if (needsPerm){
      var hint = document.getElementById('holoHint');
      if (hint){
        hint.style.display = 'block';
        hint.addEventListener('click', function(){
          DeviceOrientationEvent.requestPermission()
            .then(function(s){ if (s === 'granted') enable(); else hint.style.display='none'; })
            .catch(function(){ hint.style.display='none'; });
        });
      }
    } else if (typeof DeviceOrientationEvent !== 'undefined'){
      enable();
    }
  })();
  </script>

<?php endif; ?>

</body>
</html>
