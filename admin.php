<?php
require_once __DIR__ . '/helpers.php';

function hashPassword($password) {
    return hash('sha256', $password . 'saltysalt123');
}

// Password prompt shown until a valid session exists. The password is only ever
// sent here via POST and compared as a hash server-side — it never appears in
// this markup, so it can't be found in the page source.
function renderAdminLogin($error = '') {
    http_response_code(($error !== '') ? 401 : 200);
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate');
    $err = $error !== '' ? '<div class="login-err">' . htmlspecialchars($error) . '</div>' : '';
    echo <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Admin</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body { background: radial-gradient(ellipse at 50% 35%, #0a1230 0%, #05060f 55%, #000 100%);
    color: #fff; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, Inter, Arial, sans-serif;
    display: flex; align-items: center; justify-content: center; }
  .login-card { width: min(360px, 90vw); background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.14); border-radius: 16px; padding: 30px 26px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5); text-align: center; }
  .login-card h1 { font-size: 20px; font-weight: 700; margin: 0 0 4px; letter-spacing: 0.3px; }
  .login-card p { font-size: 13px; color: #aab0c6; margin: 0 0 22px; }
  .login-card input { width: 100%; background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.18); border-radius: 10px; padding: 13px 14px;
    color: #fff; font-size: 17px; text-align: center; letter-spacing: 4px; outline: none;
    transition: border-color 0.15s, box-shadow 0.15s; }
  .login-card input:focus { border-color: #32d74b; box-shadow: 0 0 0 3px rgba(50,215,75,0.22); }
  .login-card button { width: 100%; margin-top: 14px; background: #32d74b; color: #04210b;
    border: none; border-radius: 10px; padding: 13px; font-size: 16px; font-weight: 700; cursor: pointer; }
  .login-card button:active { opacity: 0.85; }
  .login-err { color: #ff5a4d; font-size: 13px; margin-bottom: 14px; font-weight: 600; }
</style>
</head>
<body>
  <form class="login-card" method="POST" action="admin.php" autocomplete="off">
    <h1>Admin Access</h1>
    <p>Enter the admin password to continue</p>
    {$err}
    <input type="password" name="admin_password" inputmode="numeric" autofocus required aria-label="Admin password">
    <button type="submit">Unlock</button>
  </form>
</body>
</html>
HTML;
}

$configFile = __DIR__ . '/.admin_config.json';
$config = safeReadJson($configFile);

// Initial setup or migration
if (!isset($config['password_hash'])) {
    $config['password_hash'] = hashPassword('admin123');
}
if (!isset($config['licence_pin'])) {
    $config['licence_pin'] = '457511';
}
if (!isset($config['whitelist_mode'])) {
    $config['whitelist_mode'] = false;
}
// Ensure config is saved
safeWriteJson($configFile, $config, true);

$adminPasswordHash = $config['password_hash'];
$licencePin = $config['licence_pin'];
$whitelistMode = $config['whitelist_mode'];

// ---- Authentication: password login backed by a PHP session ----------------
// The password is NEVER written into served HTML; only its hash lives in
// .admin_config.json and we compare hashes server-side. After login, the
// in-page links carry a RANDOM per-session token (not the password), so nothing
// secret is exposed in the page source. Auth is proven by the session cookie.
session_start();

$submittedKey = $_GET['key'] ?? $_POST['key'] ?? '';
$loginPass    = $_POST['admin_password'] ?? '';

// Logout
if (isset($_GET['logout'])) {
    $_SESSION = [];
    session_destroy();
    header('Location: admin.php');
    exit;
}

$authed = !empty($_SESSION['admin_authed']) && hash_equals($adminPasswordHash, (string)$_SESSION['admin_authed']);

// A correct password — via the login form, or a legacy ?key=/POST key — logs in.
if (!$authed) {
    $candidate = $loginPass !== '' ? $loginPass : $submittedKey;
    if ($candidate !== '' && hash_equals($adminPasswordHash, hashPassword($candidate))) {
        $_SESSION['admin_authed'] = $adminPasswordHash;
        if (empty($_SESSION['admin_token'])) $_SESSION['admin_token'] = bin2hex(random_bytes(16));
        $authed = true;
    }
}

if (!$authed) {
    renderAdminLogin($loginPass !== '' ? 'Incorrect password.' : '');
    exit;
}

// Random token used in all in-page links instead of the password (safe in HTML).
if (empty($_SESSION['admin_token'])) $_SESSION['admin_token'] = bin2hex(random_bytes(16));
$key = $_SESSION['admin_token'];

$stateFile = __DIR__ . '/latest_state.json';
$bannedFile = __DIR__ . '/banned_devices.txt';
$bannedIpsFile = __DIR__ . '/banned_ips.txt';
$approvedDevicesFile = __DIR__ . '/approved_devices.txt';
$bannedFingerprintsFile = __DIR__ . '/banned_fingerprints.json';
$visitsLog = __DIR__ . '/visits.log';

// Load state early (needed for enhanced unban)
$state = safeReadJson($stateFile);
if (!is_array($state)) $state = [];

$approvedDevices = safeReadList($approvedDevicesFile);
$bannedDevices = safeReadList($bannedFile);
$bannedIps = safeReadList($bannedIpsFile);
$deletedFile = __DIR__ . '/deleted_devices.txt';
$deletedDevices = safeReadList($deletedFile);
$requestsFile = __DIR__ . '/access_requests.json';
$accessRequests = safeReadJson($requestsFile);
if (!is_array($accessRequests)) $accessRequests = [];

// Handle Actions - must check before any output
$action = $_GET['action'] ?? $_POST['action'] ?? '';
$device = $_GET['device'] ?? $_POST['device'] ?? '';
$ip_to_ban = $_GET['ip'] ?? $_POST['ip'] ?? '';
$section = $_GET['section'] ?? '';
$banReason = normalizeBanReason($_POST['ban_reason'] ?? $_GET['ban_reason'] ?? '');

// ---- Password change action ----
if ($action === 'change_password') {
    $oldPass = $_POST['old_password'] ?? '';
    $newPass = $_POST['new_password'] ?? '';
    $confirmPass = $_POST['confirm_password'] ?? '';

    if (hashPassword($oldPass) === $adminPasswordHash) {
        if ($newPass === $confirmPass && !empty($newPass)) {
            $config['password_hash'] = hashPassword($newPass);
            if (safeWriteJson($configFile, $config, true)) {
                // Keep this session authed under the new hash (no password in URL).
                $_SESSION['admin_authed'] = $config['password_hash'];
                header("Location: admin.php?section=passwords&msg=password_changed");
                exit;
            } else {
                $passwordError = "Failed to save new password. Check file permissions.";
            }
        } else {
            $passwordError = "New passwords do not match or are empty.";
        }
    } else {
        $passwordError = "Current password incorrect.";
    }
}

// ---- Licence PIN change action ----
if ($action === 'change_licence_pin') {
    $oldPin = $_POST['old_pin'] ?? '';
    $newPin = $_POST['new_pin'] ?? '';
    $confirmPin = $_POST['confirm_pin'] ?? '';

    if ($oldPin === $licencePin) {
        if ($newPin === $confirmPin && !empty($newPin) && strlen($newPin) === 6 && ctype_digit($newPin)) {
            $config['licence_pin'] = $newPin;
            if (safeWriteJson($configFile, $config, true)) {
                header("Location: admin.php?key=" . urlencode($key) . "&section=passwords&msg=pin_changed");
                exit;
            } else {
                $pinError = "Failed to save new PIN. Check file permissions.";
            }
        } else {
            $pinError = "New PIN must be 6 digits and match confirmation.";
        }
    } else {
        $pinError = "Current PIN incorrect.";
    }
}

// ---- Whitelist Toggle Action ----
if ($action === 'toggle_whitelist') {
    $config['whitelist_mode'] = !($config['whitelist_mode'] ?? false);
    safeWriteJson($configFile, $config, true);
    header("Location: admin.php?key=" . urlencode($key) . "&section=" . ($section ?: 'banned'));
    exit;
}

// ---- Broadcast message to all devices ----
if ($action === 'broadcast') {
    $msg = trim($_POST['message'] ?? '');
    if ($msg !== '') {
        $bf = __DIR__ . '/broadcast.json';
        $current = file_exists($bf) ? safeReadJson($bf) : [];
        $nextId = (is_array($current) && isset($current['id'])) ? ((int)$current['id'] + 1) : 1;
        safeWriteJson($bf, [
            'id' => $nextId,
            'message' => $msg,
            'createdAt' => date('Y-m-d H:i:s')
        ], true);
    }
    header("Location: admin.php?key=" . urlencode($key) . "&msg=broadcast_sent");
    exit;
}

// ---- Delete / Restore profile (soft-delete) ----
if ($action === 'delete_profile') {
    $device = trim($device);
    if ($device) {
        $deletedDevices = safeReadList($deletedFile);
        if (!in_array($device, $deletedDevices, true)) {
            $deletedDevices[] = $device;
            safeWriteList($deletedFile, $deletedDevices);
        }
    }
    // Return to the dashboard (homescreen) after deleting, not the Deleted section.
    header("Location: admin.php?key=" . urlencode($key));
    exit;
}
if ($action === 'restore_profile') {
    $device = trim($device);
    if ($device) {
        $deletedDevices = array_values(array_filter(safeReadList($deletedFile), fn($d) => trim($d) !== $device));
        safeWriteList($deletedFile, $deletedDevices);
    }
    header("Location: admin.php?key=" . urlencode($key));
    exit;
}

// ---- Access request actions (approve / deny / delete) ----
if ($action === 'approve_request' || $action === 'deny_request' || $action === 'delete_request') {
    $device = trim($device);
    if ($device) {
        $reqs = safeReadJson($requestsFile);
        if (!is_array($reqs)) $reqs = [];

        if ($action === 'approve_request') {
            // Optional note shown on the user's "Add to Home Screen" page.
            $note = substr(trim($_POST['note'] ?? $_GET['note'] ?? ''), 0, 1000);
            // Add to the whitelist so the gate serves the real app next load.
            $approvedDevices = safeReadList($approvedDevicesFile);
            if (!in_array($device, $approvedDevices, true)) {
                $approvedDevices[] = $device;
                safeWriteList($approvedDevicesFile, $approvedDevices);
            }
            if (!isset($reqs[$device]) || !is_array($reqs[$device])) {
                $reqs[$device] = ['deviceId' => $device];
            }
            $reqs[$device]['status'] = 'approved';
            $reqs[$device]['decided_at'] = date('Y-m-d H:i:s');
            $reqs[$device]['note'] = $note;
        } elseif ($action === 'deny_request') {
            if ($banReason !== '') {
                saveBanReason('device', $device, $banReason);
            }
            // Make sure the device is NOT whitelisted, and mark the request denied
            // so the gate shows the "access denied" page.
            $approvedDevices = array_values(array_filter(safeReadList($approvedDevicesFile), fn($d) => trim($d) !== $device));
            safeWriteList($approvedDevicesFile, $approvedDevices);
            if (isset($reqs[$device])) {
                $reqs[$device]['status'] = 'denied';
                $reqs[$device]['decided_at'] = date('Y-m-d H:i:s');
                $reqs[$device]['denial_note'] = $banReason;
            }
        } elseif ($action === 'delete_request') {
            unset($reqs[$device]);
        }
        safeWriteJson($requestsFile, $reqs, true);
    }
    header("Location: admin.php?key=" . urlencode($key) . "&section=requests");
    exit;
}

// ---- Ban/Unban/Whitelist actions ----
if ($action && ($device || $ip_to_ban || in_array($action, ['ban_fingerprint', 'unban_fingerprint', 'approve', 'unapprove']))) {
    if ($action === 'ban') {
        $device = trim($device);
        if ($device && !in_array($device, $bannedDevices, true)) {
            $bannedDevices[] = $device;
            safeWriteList($bannedFile, $bannedDevices);
        }
        if ($device && $banReason !== '') {
            saveBanReason('device', $device, $banReason);
        }
        // Persist the ban across a localStorage wipe / PWA delete-and-re-add by
        // also banning the device's fingerprint (canvas + WebGL renderer survive
        // a storage clear, unlike the deviceId). Fully reversed by Unban below,
        // which clears the same fingerprint entry.
        if ($device && !empty($state[$device]['fingerprint']) && $state[$device]['fingerprint'] !== '—') {
            $fpRaw = $state[$device]['fingerprint'];
            $fpData = is_array($fpRaw) ? $fpRaw : json_decode($fpRaw, true);
            if (is_array($fpData)) {
                $cHash = (string)($fpData['canvasHash'] ?? '');
                $wRenderer = (string)($fpData['webGLRenderer'] ?? '');
                if ($cHash !== '' || $wRenderer !== '') {
                    $bannedFps = safeReadJson($bannedFingerprintsFile);
                    if (!is_array($bannedFps)) $bannedFps = [];
                    $dup = false;
                    foreach ($bannedFps as $e) {
                        if ((string)($e['canvasHash'] ?? '') === $cHash && (string)($e['webGLRenderer'] ?? '') === $wRenderer) { $dup = true; break; }
                    }
                    if (!$dup) {
                        $bannedFps[] = [
                            'canvasHash' => $cHash,
                            'webGLRenderer' => $wRenderer,
                            'banned_deviceId' => $device,
                            'banned_at' => date('Y-m-d H:i:s'),
                            'banned_by' => 'admin-auto',
                            'ban_reason' => $banReason
                        ];
                        safeWriteJson($bannedFingerprintsFile, $bannedFps);
                    }
                    if ($banReason !== '') {
                        saveFingerprintBanReason($cHash, $wRenderer, $banReason);
                    }
                }
            }
        }
    } elseif ($action === 'unban') {
        $device = trim($device);
        $bannedDevices = array_filter($bannedDevices, fn($d) => trim($d) !== $device);
        safeWriteList($bannedFile, $bannedDevices);
        clearBanReason('device', $device);

        // Enhanced unban: also clear linked fingerprints, IPs, and reset failed_attempts
        if (isset($state[$device])) {
            $state[$device]['failed_attempts'] = 0;
            $ipToClear = $state[$device]['ip'] ?? '';
            
            // Clear associated IP
            if ($ipToClear) {
                $bannedIps = safeReadList($bannedIpsFile);
                $bannedIps = array_filter($bannedIps, fn($i) => trim($i) !== $ipToClear);
                safeWriteList($bannedIpsFile, $bannedIps);
                clearBanReason('ip', $ipToClear);

                // Also un-ban any other device entries that share this IP. When a
                // banned device re-checks in (e.g. after a storage wipe / PWA
                // re-add) its new deviceId gets auto-added to the ban list; the
                // Lock-3 shared-IP rule would otherwise keep the user banned even
                // after Unban. On a personal single-user setup these siblings are
                // the same person, so one Unban should fully restore access.
                $bannedDevices = array_values(array_filter($bannedDevices, function($bd) use ($state, $ipToClear) {
                    if (isset($state[$bd]) && ($state[$bd]['ip'] ?? '') === $ipToClear) {
                        clearBanReason('device', $bd);
                        return false;
                    }
                    return true;
                }));
                safeWriteList($bannedFile, $bannedDevices);
            }

            // Clear related fingerprints
            if (!empty($state[$device]['fingerprint']) && $state[$device]['fingerprint'] !== '—') {
                $deviceFp = is_array($state[$device]['fingerprint']) ? $state[$device]['fingerprint'] : json_decode($state[$device]['fingerprint'], true);
                if (is_array($deviceFp)) {
                    $cHash = $deviceFp['canvasHash'] ?? '';
                    $wRenderer = $deviceFp['webGLRenderer'] ?? '';
                    if ($cHash || $wRenderer) {
                        $bannedFps = safeReadJson($bannedFingerprintsFile);
                        $bannedFps = array_filter($bannedFps, function($entry) use ($cHash, $wRenderer) {
                            if ($cHash && ($entry['canvasHash'] ?? '') === $cHash) return false;
                            if ($wRenderer && ($entry['webGLRenderer'] ?? '') === $wRenderer) return false;
                            return true;
                        });
                        safeWriteJson($bannedFingerprintsFile, array_values($bannedFps));
                        clearFingerprintBanReason($cHash, $wRenderer);
                    }
                }
            }
            safeWriteJson($stateFile, $state, true);
        }
    } elseif ($action === 'ban_ip') {
        $ip_to_ban = trim($ip_to_ban);
        if ($ip_to_ban && !in_array($ip_to_ban, $bannedIps, true)) {
            $bannedIps[] = $ip_to_ban;
            safeWriteList($bannedIpsFile, $bannedIps);
        }
        if ($ip_to_ban && $banReason !== '') {
            saveBanReason('ip', $ip_to_ban, $banReason);
        }
    } elseif ($action === 'unban_ip') {
        $ip_to_ban = trim($ip_to_ban);
        $bannedIps = array_filter($bannedIps, fn($i) => trim($i) !== $ip_to_ban);
        safeWriteList($bannedIpsFile, $bannedIps);
        clearBanReason('ip', $ip_to_ban);
    } elseif ($action === 'approve') {
        $device = trim($device);
        if ($device && !in_array($device, $approvedDevices)) {
            $approvedDevices[] = $device;
            safeWriteList($approvedDevicesFile, $approvedDevices);
        }
    } elseif ($action === 'unapprove') {
        $device = trim($device);
        $approvedDevices = array_filter($approvedDevices, fn($d) => $d !== $device);
        safeWriteList($approvedDevicesFile, $approvedDevices);
    } elseif ($action === 'ban_fingerprint') {
        $canvasHash = trim($_GET['canvasHash'] ?? $_POST['canvasHash'] ?? '');
        $webGLRenderer = trim($_GET['webGLRenderer'] ?? $_POST['webGLRenderer'] ?? '');
        if ($canvasHash || $webGLRenderer) {
            $bannedFps = safeReadJson($bannedFingerprintsFile);
            $bannedFps[] = [
                'canvasHash' => $canvasHash,
                'webGLRenderer' => $webGLRenderer,
                'banned_deviceId' => $device,
                'banned_at' => date('Y-m-d H:i:s'),
                'banned_by' => 'admin',
                'ban_reason' => $banReason
            ];
            safeWriteJson($bannedFingerprintsFile, $bannedFps);
            if ($banReason !== '') {
                saveFingerprintBanReason($canvasHash, $webGLRenderer, $banReason);
            }
        }
    } elseif ($action === 'unban_fingerprint') {
        $canvasHash = trim($_GET['canvasHash'] ?? $_POST['canvasHash'] ?? '');
        $webGLRenderer = trim($_GET['webGLRenderer'] ?? $_POST['webGLRenderer'] ?? '');
        $bannedFps = safeReadJson($bannedFingerprintsFile);
        $bannedFps = array_filter($bannedFps, function($entry) use ($canvasHash, $webGLRenderer) {
            if ($canvasHash && ($entry['canvasHash'] ?? '') === $canvasHash) return false;
            if ($webGLRenderer && ($entry['webGLRenderer'] ?? '') === $webGLRenderer) return false;
            return true;
        });
        safeWriteJson($bannedFingerprintsFile, array_values($bannedFps));
        clearFingerprintBanReason($canvasHash, $webGLRenderer);
    }

    // Actions triggered from the Banned Management page carry section=banned and
    // should leave the admin right there (e.g. unban a device, then unban more)
    // instead of being pulled into that device's profile. Actions fired from a
    // device profile have no section, so they fall through and stay on the profile.
    $redirectDevice = $_GET['device'] ?? $_POST['device'] ?? '';
    if ($section === 'banned') {
        header("Location: admin.php?key=" . urlencode($key) . "&section=banned");
    } elseif ($redirectDevice) {
        header("Location: admin.php?key=" . urlencode($key) . "&device=" . urlencode($redirectDevice));
    } else {
        header("Location: admin.php?key=" . urlencode($key));
    }
    exit;
}

$bannedFingerprints = safeReadJson($bannedFingerprintsFile);

// Read Visit History
$visits = [];
if (file_exists($visitsLog)) {
    $lines = file($visitsLog, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $v = json_decode($line, true);
        if ($v) $visits[] = $v;
    }
}
$visits = array_reverse($visits); // Latest first

// Debug info
$visitsLogSize = file_exists($visitsLog) ? filesize($visitsLog) : 0;
$stateFileSize = file_exists($stateFile) ? filesize($stateFile) : 0;
$totalVisitEntries = count($visits);
$totalDevicesInState = count($state);

function getPhotoBase64($deviceId) {
    $path = __DIR__ . "/photos/{$deviceId}.txt";
    $data = safeReadRaw($path);
    if ($data) {
        if (strpos($data, 'data:image') === 0) {
            return $data;
        }
        return 'data:image/jpeg;base64,' . $data;
    }
    return null;
}

function getDevicePhoto($deviceId) {
    $photo = getPhotoBase64($deviceId);
    if ($photo) {
        return $photo;
    }
    global $state;
    if (isset($state[$deviceId]['photo_path']) && $state[$deviceId]['photo_path'] !== '—') {
        $data = safeReadRaw($state[$deviceId]['photo_path']);
        if ($data) {
            if (strpos($data, 'data:image') === 0) return $data;
            return 'data:image/jpeg;base64,' . $data;
        }
    }
    return null;
}

function checkWritability() {
    $tests = [
        'State File' => __DIR__ . '/latest_state.json',
        'Visits Log' => __DIR__ . '/visits.log',
        'Photos Dir' => __DIR__ . '/photos',
        'Banned Devices' => __DIR__ . '/banned_devices.txt',
        'Banned IPs' => __DIR__ . '/banned_ips.txt',
        'Approved Devices' => __DIR__ . '/approved_devices.txt',
        'Banned Fingerprints' => __DIR__ . '/banned_fingerprints.json',
        'Admin Config' => __DIR__ . '/.admin_config.json'
    ];
    $results = [];
    foreach ($tests as $name => $path) {
        if (!file_exists($path)) {
            // Try to create it to test writability if it doesn't exist
            if ($name === 'Photos Dir') {
                $writable = @mkdir($path, 0777, true);
            } else {
                $writable = @file_put_contents($path, "") !== false;
            }
            $results[$name] = $writable ? 'Writable (Created)' : 'Not Found / Not Writable';
        } else {
            $results[$name] = is_writable($path) ? 'Writable' : 'Locked / Not Writable';
        }
    }
    return $results;
}

function truncateDeviceId($id, $len = 12) {
    if (strlen($id) <= $len) return $id;
    return substr($id, 0, $len) . '…';
}

// Classify devices as active or offline
function getDeviceStatus($deviceId, $state, $visits) {
    global $bannedDevices, $bannedIps;
    
    // Check if device ID banned
    if (in_array(trim($deviceId), $bannedDevices, true)) {
        return 'banned';
    }
    
    // Check if IP banned
    $ip = $state[$deviceId]['ip'] ?? '';
    if ($ip && in_array(trim($ip), $bannedIps, true)) {
        return 'banned';
    }
    
    $now = time();
    $fiveMinutes = 5 * 60;
    
    $lastEvent = null;
    $lastTimestamp = null;
    
    foreach ($visits as $v) {
        if (($v['deviceId'] ?? '') === $deviceId) {
            if ($lastTimestamp === null) {
                $lastEvent = $v['event'] ?? '';
                $lastTimestamp = $v['timestamp'] ?? '';
            }
            break;
        }
    }
    
    $lastSeen = $state[$deviceId]['last_seen'] ?? '';
    $checkTimestamp = $lastTimestamp ?: $lastSeen;
    if (!$checkTimestamp) return 'offline';
    
    $ts = strtotime($checkTimestamp);
    if (!$ts) return 'offline';
    
    $diff = $now - $ts;
    
    if ($diff <= $fiveMinutes) {
        $hideEvents = ['app_hidden', 'app_pagehide', 'app_beforeunload'];
        if (in_array($lastEvent, $hideEvents)) {
            return 'offline';
        }
        return 'active';
    }
    
    return 'offline';
}

function getDeviceLastActiveTime($deviceId, $state, $visits) {
    foreach ($visits as $v) {
        if (($v['deviceId'] ?? '') === $deviceId) {
            return $v['timestamp'] ?? '';
        }
    }
    return $state[$deviceId]['last_seen'] ?? '';
}

// Check if viewing a specific device profile
$viewDevice = $_GET['device'] ?? '';
$isProfileView = !empty($viewDevice) && isset($state[$viewDevice]);

// Check if viewing sections
$isPasswordView = $section === 'passwords';
$isBannedView = $section === 'banned';
$isDeletedView = $section === 'deleted';
$isRequestsView = $section === 'requests';

// Count requests still awaiting a decision (for the dashboard badge).
$pendingRequestCount = count(array_filter($accessRequests, fn($r) => ($r['status'] ?? '') === 'pending'));

?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= $isProfileView ? 'Device Profile' : ($isPasswordView ? 'Password Management' : ($isBannedView ? 'Banned Management' : 'Licence Admin Dashboard')) ?></title>
    <style>
        :root {
            --primary: #0a84ff;
            --danger: #ff453a;
            --success: #32d74b;
            --warning: #ff9f0a;
            --bg: #05060f;
            --card-bg: rgba(255,255,255,0.055);
            --text: #f4f6fb;
            --text-secondary: #aab0c6;
            --text-muted: #707793;
            --border: rgba(255,255,255,0.12);
            --shadow: 0 10px 34px rgba(0,0,0,0.5);
            --radius: 14px;
        }
        * { box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            margin: 0;
            background: #05060f;
            color: var(--text);
            -webkit-font-smoothing: antialiased;
            position: relative;
            min-height: 100vh;
        }

        /* Moving universe / starfield background (matches the Help & Info disclaimer) */
        .admin-stars {
            position: fixed;
            inset: 0;
            z-index: 0;
            pointer-events: none;
            overflow: hidden;
            background: radial-gradient(ellipse at 50% 30%, #0a1230 0%, #05060f 55%, #000 100%);
        }
        .admin-stars span {
            position: absolute;
            top: 0; left: 0;
            width: 200%; height: 200%;
            background-repeat: repeat;
            background-position: 0 0;
        }
        .admin-stars .layer-1 {
            background-image:
                radial-gradient(1px 1px at 20px 30px, #fff, transparent),
                radial-gradient(1px 1px at 120px 80px, #cfd8ff, transparent),
                radial-gradient(1px 1px at 200px 160px, #fff, transparent),
                radial-gradient(2px 2px at 320px 60px, #fff, transparent),
                radial-gradient(1px 1px at 400px 220px, #bcd0ff, transparent);
            background-size: 420px 300px;
            animation: admin-drift 90s linear infinite, admin-twinkle 4s ease-in-out infinite;
            opacity: 0.9;
        }
        .admin-stars .layer-2 {
            background-image:
                radial-gradient(1px 1px at 60px 120px, #fff, transparent),
                radial-gradient(1.5px 1.5px at 180px 40px, #e7ecff, transparent),
                radial-gradient(1px 1px at 280px 200px, #fff, transparent),
                radial-gradient(1px 1px at 360px 140px, #aac4ff, transparent);
            background-size: 380px 280px;
            animation: admin-drift 140s linear infinite reverse, admin-twinkle 6s ease-in-out infinite;
            opacity: 0.65;
        }
        .admin-stars .layer-3 {
            background-image:
                radial-gradient(2px 2px at 100px 90px, #fff, transparent),
                radial-gradient(2.5px 2.5px at 240px 180px, #d7e2ff, transparent),
                radial-gradient(2px 2px at 340px 50px, #fff, transparent);
            background-size: 500px 360px;
            animation: admin-drift 200s linear infinite, admin-twinkle 5s ease-in-out infinite;
            opacity: 0.45;
            filter: blur(0.4px);
        }
        @keyframes admin-drift {
            from { transform: translate3d(0, 0, 0); }
            to   { transform: translate3d(-50%, -50%, 0); }
        }
        @keyframes admin-twinkle {
            0%, 100% { opacity: 0.85; }
            50%      { opacity: 0.4; }
        }
        @media (prefers-reduced-motion: reduce) {
            .admin-stars span { animation: none !important; }
        }

        .container { max-width: 1100px; margin: 0 auto; padding: 20px; position: relative; z-index: 1; }
        @media (max-width: 600px) { .container { padding: 12px; } }

        /* Header */
        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            flex-wrap: wrap;
            gap: 10px;
        }
        h1 {
            font-size: 24px; margin: 0; font-weight: 800; letter-spacing: -0.3px;
            background: linear-gradient(90deg, #fff 0%, #a9c2ff 60%, #6f8dff 100%);
            -webkit-background-clip: text; background-clip: text;
            -webkit-text-fill-color: transparent;
            text-shadow: 0 2px 20px rgba(80,120,255,0.25);
        }
        h2 { font-size: 16px; margin: 0 0 10px 0; font-weight: 600; }
        .header-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .btn {
            padding: 8px 16px;
            border-radius: 8px;
            border: none;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: opacity 0.2s, transform 0.1s;
        }
        .btn:active { opacity: 0.7; transform: scale(0.97); }
        .btn-primary { background: var(--primary); color: white; }
        .btn-danger { background: var(--danger); color: white; }
        .btn-success { background: var(--success); color: white; }
        .btn-warning { background: var(--warning); color: white; }
        .btn-outline { background: transparent; border: 1.5px solid var(--border); color: var(--text); }
        .btn-sm { padding: 5px 12px; font-size: 12px; }
        .badge {
            display: inline-flex;
            align-items: center;
            padding: 2px 10px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 700;
            background: rgba(255,255,255,0.12);
            color: var(--text-secondary);
        }
        .badge-banned { background: #000; color: #fff; }
        .badge-success { background: var(--success); color: #fff; }
        .badge-danger { background: var(--danger); color: #fff; }
        .badge-warning { background: var(--warning); color: #fff; }
        .badge-muted { background: var(--text-muted); color: #fff; }
        .badge-info { background: #5ac8fa; color: #fff; }

        /* Stats bar */
        .stats-bar {
            display: flex;
            gap: 12px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }
        .stat-card {
            background: var(--card-bg);
            border-radius: var(--radius);
            padding: 14px 18px;
            box-shadow: var(--shadow);
            flex: 1;
            min-width: 100px;
        }
        .stat-card .num { font-size: 28px; font-weight: 700; }
        .stat-card .label { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }

        /* Debug section */
        .debug-section {
            background: #1e1e1e;
            color: #c0c0c0;
            border-radius: var(--radius);
            padding: 14px;
            margin-bottom: 20px;
            font-family: monospace;
            font-size: 12px;
            line-height: 1.5;
            display: none;
        }
        .debug-section.visible { display: block; }
        .debug-toggle {
            cursor: pointer;
            user-select: none;
        }
        .debug-section .key { color: #569cd6; }
        .debug-section .val { color: #ce9178; }
        .debug-section .ok { color: #4ec9b0; }
        .debug-section .fail { color: #f44747; }

        /* Section header */
        .section-header-bar {
            display: flex;
            align-items: center;
            gap: 10px;
            margin: 24px 0 14px 0;
            padding-bottom: 8px;
            border-bottom: 2px solid var(--border);
        }
        .section-header-bar .indicator {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            flex-shrink: 0;
        }
        .section-header-bar .indicator.active { background: var(--success); }
        .section-header-bar .indicator.offline { background: var(--text-muted); }
        .section-header-bar .count {
            font-size: 13px;
            color: var(--text-secondary);
            font-weight: 500;
        }

        /* Device Grid */
        .device-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 14px;
            margin-bottom: 24px;
        }
        .device-card {
            background: var(--card-bg);
            border-radius: var(--radius);
            box-shadow: var(--shadow);
            padding: 14px;
            display: flex;
            align-items: center;
            gap: 14px;
            cursor: pointer;
            transition: transform 0.15s, box-shadow 0.15s;
            text-decoration: none;
            color: inherit;
            position: relative;
        }
        .device-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 16px rgba(0,0,0,0.1);
        }
        .device-card:active { transform: translateY(0); }
        .device-card.offline { opacity: 0.6; }
        .device-card.offline:hover { opacity: 0.8; }
        .device-card.banned { opacity: 0.5; }
        .device-card.risk-high { border: 2px solid var(--danger); }
        .device-card.risk-medium { border: 2px solid var(--warning); }
        
        .device-card .photo-thumb {
            width: 56px;
            height: 56px;
            border-radius: 10px;
            object-fit: cover;
            background: rgba(255,255,255,0.08);
            flex-shrink: 0;
        }
        .device-card .info { flex: 1; min-width: 0; }
        .device-card .name {
            font-weight: 700;
            font-size: 15px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .device-card .sub {
            font-size: 12px;
            color: var(--text-secondary);
            margin-top: 2px;
        }
        .device-card .status-badge {
            display: inline-flex;
            align-items: center;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 10px;
            font-weight: 700;
            flex-shrink: 0;
        }
        .device-card .status-badge.online { background: rgba(50,215,75,0.18); color: var(--success); }
        .device-card .status-badge.offline { background: rgba(255,255,255,0.08); color: var(--text-muted); }
        .device-card .status-badge.banned-sm { background: rgba(255,69,58,0.2); color: var(--danger); }
        
        .risk-icon {
            position: absolute;
            top: -10px;
            right: -10px;
            font-size: 20px;
            z-index: 5;
        }

        /* Profile Page */
        .back-link {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            color: var(--primary);
            text-decoration: none;
            font-size: 14px;
            font-weight: 500;
            margin-bottom: 16px;
        }
        .back-link:hover { text-decoration: underline; }
        .profile-header {
            background: var(--card-bg);
            border-radius: var(--radius);
            box-shadow: var(--shadow);
            padding: 24px;
            display: flex;
            gap: 24px;
            flex-wrap: wrap;
            margin-bottom: 20px;
        }
        .profile-header .large-photo {
            width: 160px;
            height: 200px;
            border-radius: 10px;
            object-fit: cover;
            background: rgba(255,255,255,0.08);
            flex-shrink: 0;
        }
        .profile-header .info { flex: 1; min-width: 200px; }
        .profile-header .info h2 { margin: 0 0 4px 0; font-size: 22px; }
        .profile-header .info .meta { color: var(--text-secondary); font-size: 13px; margin-bottom: 4px; }
        .profile-header .info .field { margin-top: 10px; }
        .profile-header .info .field .lbl { font-size: 11px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.3px; }
        .profile-header .info .field .val { font-weight: 600; font-size: 15px; }
        .profile-header .ban-area { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
        .ban-reason-preview {
            color: var(--text-secondary);
            font-size: 12px;
            line-height: 1.45;
            margin-top: 6px;
            max-width: 240px;
            word-break: break-word;
        }
        .profile-section {
            background: var(--card-bg);
            border-radius: var(--radius);
            box-shadow: var(--shadow);
            padding: 20px;
            margin-bottom: 20px;
        }
        .profile-section h3 { margin: 0 0 14px 0; font-size: 16px; }

        /* Tables for Banned Mgmt */
        .admin-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
        }
        .admin-table th, .admin-table td {
            text-align: left;
            padding: 12px;
            border-bottom: 1px solid var(--border);
        }
        .admin-table th {
            font-size: 12px;
            text-transform: uppercase;
            color: var(--text-secondary);
            font-weight: 600;
        }
        .admin-table tr:last-child td { border-bottom: none; }

        /* Events Timeline */
        .timeline { position: relative; }
        .timeline::before {
            content: '';
            position: absolute;
            left: 16px;
            top: 0;
            bottom: 0;
            width: 2px;
            background: var(--border);
        }
        .event-item {
            position: relative;
            padding: 10px 0 10px 48px;
            min-height: 48px;
        }
        .event-item .event-dot {
            position: absolute;
            left: 8px;
            top: 14px;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            border: 3px solid var(--border);
            background: var(--card-bg);
        }
        .event-item .event-dot.success { border-color: var(--success); background: #e8f8ee; }
        .event-item .event-dot.failed { border-color: var(--danger); background: #fde8e7; }
        .event-item .event-dot.info { border-color: #5ac8fa; background: #e8f4fd; }
        .event-item .event-dot.warning { border-color: #ff9500; background: #fff3e0; }
        .event-item .event-time { font-size: 11px; color: var(--text-secondary); }
        .event-item .event-type { font-weight: 600; font-size: 13px; margin-top: 1px; }
        .event-item .event-meta { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
        .event-item .event-photo { margin-top: 6px; max-width: 120px; border-radius: 6px; cursor: pointer; }
        .event-badge {
            display: inline-block;
            padding: 1px 8px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 700;
            color: white;
            background: #8e8e93;
        }
        .event-badge.pin_success { background: var(--success); }
        .event-badge.pin_failed { background: var(--danger); }
        .event-badge.photo_updated { background: #5856d6; }
        .event-badge.data_updated { background: #ff9500; }
        .event-badge.app_loaded { background: #5ac8fa; }
        .event-badge.app_fully_loaded { background: #5ac8fa; }
        .event-badge.app_hidden { background: #8e8e93; }
        .event-badge.app_visible { background: #5ac8fa; }
        .event-badge.app_pagehide { background: #8e8e93; }
        .event-badge.app_beforeunload { background: #8e8e93; }
        .event-badge.data_cleared { background: var(--danger); }

        /* Password Page */
        .password-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-top: 10px;
        }
        @media (max-width: 700px) { .password-grid { grid-template-columns: 1fr; } }
        .password-form {
            background: var(--card-bg);
            border-radius: var(--radius);
            box-shadow: var(--shadow);
            padding: 20px;
        }
        .password-form h3 { margin: 0 0 16px 0; font-size: 16px; font-weight: 600; }
        .password-form .current-value {
            background: rgba(255,255,255,0.05);
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 8px 12px;
            font-size: 13px;
            color: var(--text-secondary);
            margin-bottom: 16px;
            font-family: monospace;
        }
        .form-group { margin-bottom: 14px; }
        .form-group label { display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; font-weight: 500; }
        .form-group input {
            width: 100%;
            padding: 10px;
            border: 1px solid var(--border);
            border-radius: 6px;
            font-size: 14px;
            outline: none;
            background: rgba(255,255,255,0.05);
            color: var(--text);
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        .form-group input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(10,132,255,0.25); }
        .password-form .btn { width: 100%; justify-content: center; padding: 10px; margin-top: 4px; }
        .msg-box { padding: 12px; border-radius: 8px; font-size: 14px; font-weight: 600; text-align: center; margin-bottom: 16px; }
        .msg-box.success { background: var(--success); color: white; }
        .msg-box.error { background: var(--danger); color: white; }

        .empty-state {
            grid-column: 1 / -1;
            text-align: center;
            padding: 40px;
            color: var(--text-secondary);
            background: var(--card-bg);
            border-radius: var(--radius);
            box-shadow: var(--shadow);
        }
        .empty-state .icon { font-size: 32px; margin-bottom: 8px; }

        @media (max-width: 600px) {
            .profile-header { flex-direction: column; align-items: center; text-align: center; }
            .profile-header .large-photo { width: 120px; height: 150px; }
            .profile-header .ban-area { align-items: center; }
            .device-grid { grid-template-columns: 1fr; }
            .stats-bar .stat-card { min-width: 80px; }
        }

        /* Frosted-glass treatment so the starfield shows through the cards */
        .stat-card, .device-card, .profile-header, .profile-section,
        .password-form, .empty-state {
            background: var(--card-bg);
            border: 1px solid var(--border);
            backdrop-filter: blur(16px) saturate(150%);
            -webkit-backdrop-filter: blur(16px) saturate(150%);
        }
        .device-card:hover { box-shadow: 0 8px 26px rgba(0,0,0,0.55); }
        .back-link { color: #7fa8ff; }
        a { color: #7fa8ff; }
        ::selection { background: rgba(10,132,255,0.4); }

        /* Modal styles — global so they work on every view (dashboard + requests) */
        .req-modal-overlay {
            display: none; position: fixed; inset: 0; z-index: 1000;
            background: rgba(0,0,0,0.62); -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px);
            align-items: center; justify-content: center; padding: 20px;
        }
        .req-modal-overlay.open { display: flex; }
        .req-modal {
            position: relative; width: min(520px, 94vw); max-height: 88vh; overflow-y: auto;
            background: #11131f; border: 1px solid var(--border); border-radius: 16px;
            padding: 24px 24px 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.6);
        }
        .req-modal-close {
            position: absolute; top: 14px; right: 14px; background: transparent; border: none;
            color: var(--text-secondary); font-size: 18px; cursor: pointer; line-height: 1;
        }
        .req-modal-close:hover { color: #fff; }
        .req-modal-field { margin-bottom: 14px; }
        .req-modal-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-secondary); margin-bottom: 4px; }
        .req-modal-value { font-size: 15px; color: var(--text); word-break: break-word; }
        .req-modal-actions { display: flex; gap: 10px; margin-top: 20px; }
    </style>
</head>
<body>
    <!-- moving universe / starfield background -->
    <div class="admin-stars" aria-hidden="true">
        <span class="layer-1"></span>
        <span class="layer-2"></span>
        <span class="layer-3"></span>
    </div>
    <div class="container">

    <!-- Debug Info Toggle -->
    <div style="text-align:right;margin-bottom:8px;">
        <span class="debug-toggle btn btn-sm btn-outline" onclick="document.getElementById('debugInfo').classList.toggle('visible')">🐛 Toggle Debug Info</span>
    </div>
    <div id="debugInfo" class="debug-section">
        <div><span class="key">visits.log</span>: <span class="val"><?=$visitsLog?></span></div>
        <div><span class="key">Total visit entries</span>: <span class="val"><?=$totalVisitEntries?></span></div>
        <div><span class="key">Total devices in state</span>: <span class="val"><?=$totalDevicesInState?></span></div>
        <div><span class="key">Current licence_pin</span>: <span class="val"><?=$config['licence_pin'] ?? 'NOT SET'?></span></div>
    </div>

    <?php if ($isProfileView): 
        $d = $state[$viewDevice];
        $isDeviceBanned = in_array(trim($viewDevice), $bannedDevices, true);
        $isDeviceApproved = in_array(trim($viewDevice), $approvedDevices, true);
        $currentIp = $d['ip'] ?? '';
        $isIpBanned = $currentIp && in_array(trim($currentIp), $bannedIps, true);
        $deviceBanReason = findBanReason($viewDevice, '');
        $ipBanReason = $currentIp ? findBanReason('', $currentIp) : '';
        $photo = getDevicePhoto($viewDevice);
        $deviceVisits = array_filter($visits, fn($v) => ($v['deviceId'] ?? '') === $viewDevice);
    ?>
        <a href="admin.php?key=<?=htmlspecialchars($key)?>" class="back-link">← Back to all devices</a>

        <div class="profile-header">
            <?php if ($photo): ?>
                <img src="<?=$photo?>" class="large-photo" onclick="window.open(this.src)">
            <?php else: ?>
                <div class="large-photo" style="display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:12px;text-align:center;padding:10px;">No<br>Photo</div>
            <?php endif; ?>
            <div class="info">
                <h2><?=htmlspecialchars($d['name'] ?? 'Unknown')?></h2>
                <div class="meta">Device: <span style="font-family:monospace;font-size:12px;"><?=htmlspecialchars($viewDevice)?></span></div>
                <div class="meta">IP: <?=htmlspecialchars($currentIp ?: '—')?></div>
                <div class="field">
                    <div class="lbl">Failed PIN Attempts</div>
                    <div class="val" style="color:<?=($d['failed_attempts']??0) >= 10 ? 'var(--danger)' : (($d['failed_attempts']??0) >= 5 ? 'var(--warning)' : 'inherit')?>">
                        <?=htmlspecialchars($d['failed_attempts'] ?? 0)?>
                    </div>
                </div>
                <div class="field">
                    <div class="lbl">Address</div>
                    <div class="val"><?=htmlspecialchars($d['address'] ?? '—')?></div>
                </div>
                <div class="field">
                    <div class="lbl">Last Seen</div>
                    <div class="val"><?=htmlspecialchars($d['last_seen'] ?? '—')?></div>
                </div>
            </div>
            <div class="ban-area">
                <div style="margin-bottom:10px;">
                    <div class="lbl" style="font-size:10px;text-transform:uppercase;margin-bottom:4px;">Whitelist Status</div>
                    <?php if ($isDeviceApproved): ?>
                        <span class="badge badge-success">APPROVED</span>
                        <a href="admin.php?key=<?=htmlspecialchars($key)?>&device=<?=urlencode($viewDevice)?>&action=unapprove" class="btn btn-outline btn-sm">Revoke Approval</a>
                    <?php else: ?>
                        <span class="badge badge-warning">PENDING</span>
                        <a href="admin.php?key=<?=htmlspecialchars($key)?>&device=<?=urlencode($viewDevice)?>&action=approve" class="btn btn-success btn-sm">Approve Device</a>
                    <?php endif; ?>
                </div>

                <div style="margin-bottom:10px;">
                    <div class="lbl" style="font-size:10px;text-transform:uppercase;margin-bottom:4px;">Device Control</div>
                    <?php if ($isDeviceBanned): ?>
                        <span class="badge badge-banned">DEVICE BANNED</span>
                        <a href="admin.php?key=<?=htmlspecialchars($key)?>&device=<?=urlencode($viewDevice)?>&action=unban" class="btn btn-success btn-sm">Unban Device</a>
                        <?php if ($deviceBanReason !== ''): ?><div class="ban-reason-preview"><?=nl2br(htmlspecialchars($deviceBanReason))?></div><?php endif; ?>
                    <?php else: ?>
                        <a href="admin.php?key=<?=htmlspecialchars($key)?>&device=<?=urlencode($viewDevice)?>&action=ban" class="btn btn-danger btn-sm" onclick="return promptBanReason(this);">Ban Device</a>
                    <?php endif; ?>
                </div>

                <div style="margin-bottom:10px;">
                    <div class="lbl" style="font-size:10px;text-transform:uppercase;margin-bottom:4px;">Profile</div>
                    <?php if (in_array($viewDevice, $deletedDevices, true)): ?>
                        <span class="badge badge-warning">DELETED</span>
                        <a href="admin.php?key=<?=htmlspecialchars($key)?>&device=<?=urlencode($viewDevice)?>&action=restore_profile" class="btn btn-success btn-sm">↩ Restore Profile</a>
                    <?php else: ?>
                        <a href="admin.php?key=<?=htmlspecialchars($key)?>&device=<?=urlencode($viewDevice)?>&action=delete_profile" class="btn btn-danger btn-sm" onclick="return confirm('Move this profile to the Deleted section?');">🗑 Delete Profile</a>
                    <?php endif; ?>
                </div>

                <?php if ($currentIp): ?>
                <div>
                    <div class="lbl" style="font-size:10px;text-transform:uppercase;margin-bottom:4px;">IP Control (<?=$currentIp?>)</div>
                    <?php if ($isIpBanned): ?>
                        <span class="badge badge-banned">IP BANNED</span>
                        <a href="admin.php?key=<?=htmlspecialchars($key)?>&device=<?=urlencode($viewDevice)?>&ip=<?=urlencode($currentIp)?>&action=unban_ip" class="btn btn-success btn-sm">Unban IP</a>
                        <?php if ($ipBanReason !== ''): ?><div class="ban-reason-preview"><?=nl2br(htmlspecialchars($ipBanReason))?></div><?php endif; ?>
                    <?php else: ?>
                        <a href="admin.php?key=<?=htmlspecialchars($key)?>&device=<?=urlencode($viewDevice)?>&ip=<?=urlencode($currentIp)?>&action=ban_ip" class="btn btn-danger btn-sm" onclick="return promptBanReason(this);">Ban IP</a>
                    <?php endif; ?>
                </div>
                <?php endif; ?>
            </div>
        </div>

                <!-- Triple-Lock Status -->
                <?php
                $lockStatus = $d['lockStatus'] ?? [];
                $fingerprintStr = $d['fingerprint'] ?? '—';
                $deviceFp = ($fingerprintStr !== '—') ? (is_array($fingerprintStr) ? $fingerprintStr : json_decode($fingerprintStr, true)) : null;
                $isFingerprintBanned = false;
                $matchedBannedFp = [];
                if ($deviceFp && is_array($deviceFp)) {
                    foreach ($bannedFingerprints as $bfp) {
                        $matchReason = '';
                        if (!empty($deviceFp['canvasHash']) && !empty($bfp['canvasHash']) && strtolower($deviceFp['canvasHash']) === strtolower($bfp['canvasHash'])) {
                            $matchReason = 'Canvas Match';
                        } elseif (!empty($deviceFp['webGLRenderer']) && !empty($bfp['webGLRenderer']) && strtolower($deviceFp['webGLRenderer']) === strtolower($bfp['webGLRenderer'])) {
                            $matchReason = 'WebGL Match';
                        }
                        if ($matchReason) {
                            $isFingerprintBanned = true;
                            $matchedBannedFp = $bfp;
                            break;
                        }
                    }
                }
                $lock1 = in_array('Lock1-DeviceId', $lockStatus) || in_array('Lock1-IP', $lockStatus) || $isDeviceBanned || $isIpBanned;
                $lock2 = in_array('Lock2-Canvas', $lockStatus) || in_array('Lock2-WebGL', $lockStatus) || $isFingerprintBanned;
                $lock3 = in_array('Lock3-SharedIP', $lockStatus) || in_array('Lock3-ProfileMatch', $lockStatus) || !empty(array_filter($lockStatus, fn($l) => strpos($l, 'Lock3-') === 0));
                ?>
                <div class="profile-section">
                    <h3>🔒 Triple-Lock Security Status</h3>
                    <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:4px;">
                        <div style="flex:1;min-width:140px;padding:12px;border-radius:8px;background:<?=$lock1?'rgba(255,69,58,0.14)':'rgba(50,215,75,0.14)'?>;border:1px solid <?=$lock1?'var(--danger)':'var(--success)'?>;">
                            <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:<?=$lock1?'var(--danger)':'var(--success)'?>;">Lock 1</div>
                            <div style="font-size:13px;font-weight:600;margin-top:2px;">Explicit (Cookie/IP)</div>
                            <div style="font-size:16px;font-weight:700;margin-top:4px;color:<?=$lock1?'var(--danger)':'var(--success)'?>;"><?=$lock1?'🔴 BREACHED':'🟢 CLEAR'?></div>
                        </div>
                        <div style="flex:1;min-width:140px;padding:12px;border-radius:8px;background:<?=$lock2?'rgba(255,69,58,0.14)':'rgba(50,215,75,0.14)'?>;border:1px solid <?=$lock2?'var(--danger)':'var(--success)'?>;">
                            <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:<?=$lock2?'var(--danger)':'var(--success)'?>;">Lock 2</div>
                            <div style="font-size:13px;font-weight:600;margin-top:2px;">Implicit (Canvas/WebGL)</div>
                            <div style="font-size:16px;font-weight:700;margin-top:4px;color:<?=$lock2?'var(--danger)':'var(--success)'?>;"><?=$lock2?'🔴 BREACHED':'🟢 CLEAR'?></div>
                        </div>
                        <div style="flex:1;min-width:140px;padding:12px;border-radius:8px;background:<?=$lock3?'rgba(255,69,58,0.14)':'rgba(50,215,75,0.14)'?>;border:1px solid <?=$lock3?'var(--danger)':'var(--success)'?>;">
                            <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:<?=$lock3?'var(--danger)':'var(--success)'?>;">Lock 3</div>
                            <div style="font-size:13px;font-weight:600;margin-top:2px;">Profile Matching</div>
                            <div style="font-size:16px;font-weight:700;margin-top:4px;color:<?=$lock3?'var(--danger)':'var(--success)'?>;"><?=$lock3?'🔴 BREACHED':'🟢 CLEAR'?></div>
                        </div>
                    </div>
                    <?php if (!empty($lockStatus)): ?>
                    <div style="margin-top:10px;font-size:12px;color:var(--text-secondary);">
                        <strong>Matched via:</strong> <?=implode(', ', array_map('htmlspecialchars', $lockStatus))?>
                    </div>
                    <?php endif; ?>
                    <?php if ($deviceFp && is_array($deviceFp)): ?>
                    <div style="margin-top:8px;padding:10px;background:rgba(255,255,255,0.05);border-radius:6px;font-size:11px;font-family:monospace;color:var(--text-secondary);word-break:break-all;">
                        <strong>Canvas Hash:</strong> <?=htmlspecialchars($deviceFp['canvasHash'] ?? '—')?><br>
                        <strong>WebGL Renderer:</strong> <?=htmlspecialchars($deviceFp['webGLRenderer'] ?? '—')?><br>
                        <strong>Platform:</strong> <?=htmlspecialchars($deviceFp['platform'] ?? '—')?><br>
                        <strong>Hardware Concurrency:</strong> <?=htmlspecialchars($deviceFp['hardwareConcurrency'] ?? '—')?><br>
                        <strong>Screen:</strong> <?=htmlspecialchars($deviceFp['screen'] ?? '—')?>
                    </div>
                    <?php endif; ?>
                    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
                        <?php if ($deviceFp && is_array($deviceFp)):
                            $cHash = $deviceFp['canvasHash'] ?? '';
                            $wRenderer = $deviceFp['webGLRenderer'] ?? '';
                        ?>
                            <?php if ($isFingerprintBanned): ?>
                                <a href="admin.php?key=<?=htmlspecialchars($key)?>&device=<?=urlencode($viewDevice)?>&canvasHash=<?=urlencode($cHash)?>&webGLRenderer=<?=urlencode($wRenderer)?>&action=unban_fingerprint" class="btn btn-success btn-sm">Unban Fingerprint</a>
                                <?php $fpBanReason = findBanReason('', '', ['canvasHash' => $cHash, 'webGLRenderer' => $wRenderer]); ?>
                                <?php if ($fpBanReason !== ''): ?><div class="ban-reason-preview"><?=nl2br(htmlspecialchars($fpBanReason))?></div><?php endif; ?>
                            <?php else: ?>
                                <a href="admin.php?key=<?=htmlspecialchars($key)?>&device=<?=urlencode($viewDevice)?>&canvasHash=<?=urlencode($cHash)?>&webGLRenderer=<?=urlencode($wRenderer)?>&action=ban_fingerprint" class="btn btn-danger btn-sm" onclick="return promptBanReason(this);">🔒 Ban Fingerprint (Lock 2)</a>
                            <?php endif; ?>
                        <?php endif; ?>
                    </div>
                </div>

                <!-- Linked Profiles (Lock 3) -->
                <?php
                // Find devices that share fingerprint characteristics with this one
                $linkedProfiles = [];
                if ($deviceFp && is_array($deviceFp)) {
                    foreach ($state as $otherId => $otherData) {
                        if ($otherId === $viewDevice) continue;
                        $otherFpStr = $otherData['fingerprint'] ?? '—';
                        if ($otherFpStr === '—') continue;
                        $otherFp = is_array($otherFpStr) ? $otherFpStr : json_decode($otherFpStr, true);
                        if (!is_array($otherFp)) continue;

                        $similarity = 0;
                        $reasons = [];
                        if (!empty($deviceFp['canvasHash']) && !empty($otherFp['canvasHash']) && strtolower($deviceFp['canvasHash']) === strtolower($otherFp['canvasHash'])) {
                            $similarity += 3;
                            $reasons[] = 'Canvas';
                        }
                        if (!empty($deviceFp['webGLRenderer']) && !empty($otherFp['webGLRenderer']) && strtolower($deviceFp['webGLRenderer']) === strtolower($otherFp['webGLRenderer'])) {
                            $similarity += 3;
                            $reasons[] = 'WebGL';
                        }
                        if (!empty($deviceFp['platform']) && !empty($otherFp['platform']) && $deviceFp['platform'] === $otherFp['platform']) {
                            $similarity++;
                            $reasons[] = 'Platform';
                        }
                        if (!empty($deviceFp['screen']) && !empty($otherFp['screen']) && $deviceFp['screen'] === $otherFp['screen']) {
                            $similarity++;
                            $reasons[] = 'Screen';
                        }
                        if ($otherData['ip'] === $currentIp && $currentIp !== 'unknown' && $currentIp !== '') {
                            $similarity += 2;
                            $reasons[] = 'Same IP';
                        }

                        if ($similarity >= 3) {
                            $linkedProfiles[] = [
                                'id' => $otherId,
                                'name' => $otherData['name'] ?? 'Unknown',
                                'score' => $similarity,
                                'reasons' => $reasons,
                                'banned' => in_array(trim($otherId), $bannedDevices, true)
                            ];
                        }
                    }
                }
                ?>
                <?php if (!empty($linkedProfiles)): ?>
                <div class="profile-section">
                    <h3>🔗 Linked Profiles <span class="badge"><?=count($linkedProfiles)?> matches</span></h3>
                    <div style="margin-top:8px;">
                        <?php foreach ($linkedProfiles as $lp): ?>
                        <div style="display:flex;align-items:center;gap:12px;padding:10px;border-bottom:1px solid var(--border);">
                            <div style="flex:1;min-width:0;">
                                <div style="font-weight:600;font-size:14px;"><?=htmlspecialchars($lp['name'])?></div>
                                <div style="font-size:11px;font-family:monospace;color:var(--text-secondary);"><?=htmlspecialchars(truncateDeviceId($lp['id']))?></div>
                                <div style="font-size:11px;color:var(--text-secondary);">Match: <?=implode(', ', $lp['reasons'])?> (score: <?=$lp['score']?>)</div>
                            </div>
                            <div>
                                <?php if ($lp['banned']): ?>
                                    <span class="badge badge-banned">Banned</span>
                                <?php endif; ?>
                                <a href="admin.php?key=<?=htmlspecialchars($key)?>&device=<?=urlencode($lp['id'])?>" class="btn btn-sm btn-outline">View</a>
                            </div>
                        </div>
                        <?php endforeach; ?>
                    </div>
                </div>
                <?php endif; ?>

                <div class="profile-section">
                    <h3>Visit History <span class="badge"><?=count($deviceVisits)?> events</span></h3>
            <div class="timeline">
                <?php if (empty($deviceVisits)): ?>
                    <div style="text-align:center;padding:30px;color:var(--text-secondary);">No history for this device yet.</div>
                <?php else: ?>
                    <?php foreach ($deviceVisits as $v): 
                        $ev = $v['event'] ?? 'unknown';
                        $dotClass = 'info';
                        if ($ev === 'pin_success') $dotClass = 'success';
                        elseif ($ev === 'pin_failed') $dotClass = 'failed';
                        elseif ($ev === 'data_cleared') $dotClass = 'failed';
                    ?>
                    <div class="event-item">
                        <div class="event-dot <?=$dotClass?>"></div>
                        <div class="event-time"><?=htmlspecialchars($v['timestamp'] ?? '—')?></div>
                        <div class="event-type">
                            <span class="event-badge <?=htmlspecialchars($ev)?>"><?=htmlspecialchars($ev)?></span>
                        </div>
                        <?php if (($v['pin_attempt'] ?? '—') !== '—'): ?>
                            <div class="event-meta">PIN attempt: <?=htmlspecialchars($v['pin_attempt'])?></div>
                        <?php endif; ?>
                    </div>
                    <?php endforeach; ?>
                <?php endif; ?>
            </div>
        </div>

    <?php elseif ($isPasswordView): ?>
        <header>
            <h1>Password Management</h1>
            <div class="header-actions">
                <a href="admin.php?key=<?=htmlspecialchars($key)?>" class="btn btn-outline">← Back to Dashboard</a>
            </div>
        </header>
        <!-- (Password forms same as before) -->
        <div class="password-grid">
            <div class="password-form">
                <h3>🔑 Change Admin Password</h3>
                <form method="POST" action="admin.php?key=<?= htmlspecialchars($key) ?>&section=passwords">
                    <input type="hidden" name="action" value="change_password">
                    <div class="form-group"><label>Current Password</label><input type="password" name="old_password" required></div>
                    <div class="form-group"><label>New Password</label><input type="password" name="new_password" required></div>
                    <div class="form-group"><label>Confirm New Password</label><input type="password" name="confirm_password" required></div>
                    <button type="submit" class="btn btn-primary">Change Admin Password</button>
                </form>
            </div>
            <div class="password-form">
                <h3>🔢 Change Licence PIN</h3>
                <form method="POST" action="admin.php?key=<?= htmlspecialchars($key) ?>&section=passwords">
                    <input type="hidden" name="action" value="change_licence_pin">
                    <div class="form-group"><label>Current PIN</label><input type="password" name="old_pin" required maxlength="6"></div>
                    <div class="form-group"><label>New PIN (6 digits)</label><input type="password" name="new_pin" required maxlength="6"></div>
                    <div class="form-group"><label>Confirm New PIN</label><input type="password" name="confirm_pin" required maxlength="6"></div>
                    <button type="submit" class="btn btn-warning">Change Licence PIN</button>
                </form>
            </div>
        </div>

    <?php elseif ($isBannedView): ?>
        <header>
            <h1>Banned Management</h1>
            <div class="header-actions">
                <a href="admin.php?key=<?=htmlspecialchars($key)?>" class="btn btn-outline">← Back to Dashboard</a>
            </div>
        </header>

        <div class="stats-bar">
            <div class="stat-card"><div class="num"><?=count($bannedDevices)?></div><div class="label">Banned Devices</div></div>
            <div class="stat-card"><div class="num"><?=count($bannedIps)?></div><div class="label">Banned IPs</div></div>
            <div class="stat-card"><div class="num"><?=count($bannedFingerprints)?></div><div class="label">Banned Fingerprints</div></div>
            <?php
            $health = checkWritability();
            $allWritable = !in_array('Locked / Not Writable', array_values($health)) && !in_array('Not Found / Not Writable', array_values($health));
            ?>
            <div class="stat-card" onclick="document.getElementById('healthDetailsBanned').classList.toggle('visible')" style="cursor:pointer;">
                <div class="num" style="color:<?=$allWritable ? 'var(--success)' : 'var(--danger)'?>"><?=$allWritable ? 'OK' : 'FAIL'?></div>
                <div class="label">System Health ▾</div>
            </div>
        </div>

        <div id="healthDetailsBanned" class="debug-section" style="margin-top:-10px; margin-bottom:20px; background:rgba(20,24,42,0.72); color:var(--text); border:1px solid var(--border);">
            <h3 style="margin:0 0 10px 0; font-size:14px;">File System Writability</h3>
            <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:10px;">
                <?php foreach ($health as $file => $status): 
                    $isOK = strpos($status, 'Writable') !== false;
                ?>
                    <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; padding:6px; background:rgba(255,255,255,0.05); border-radius:6px;">
                        <span><?=htmlspecialchars($file)?></span>
                        <span class="badge <?=$isOK ? 'badge-success' : 'badge-danger'?>"><?=htmlspecialchars($status)?></span>
                    </div>
                <?php endforeach; ?>
            </div>
        </div>

        <div class="profile-section">
            <h3>🛡️ Security Settings</h3>
            <div style="display:flex; align-items:center; justify-content:space-between; padding:15px; background:rgba(255,255,255,0.05); border-radius:10px; border:1px solid var(--border);">
                <div>
                    <div style="font-weight:700; font-size:15px;">Whitelist Mode</div>
                    <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">When enabled, only approved devices can access the application.</div>
                </div>
                <div style="display:flex; align-items:center; gap:12px;">
                    <span class="badge <?=$whitelistMode ? 'badge-success' : 'badge-muted'?>" style="font-size:12px; padding:5px 12px;"><?=$whitelistMode ? 'ACTIVE' : 'DISABLED'?></span>
                    <a href="admin.php?key=<?=htmlspecialchars($key)?>&section=banned&action=toggle_whitelist" class="btn <?=$whitelistMode ? 'btn-danger' : 'btn-success'?>">
                        <?=$whitelistMode ? 'Disable Whitelist' : 'Enable Whitelist'?>
                    </a>
                </div>
            </div>
        </div>

        <div class="profile-section">
            <h3>Approved Devices</h3>
            <table class="admin-table">
                <thead><tr><th>Profile</th><th>Actions</th></tr></thead>
                <tbody>
                    <?php if (empty($approvedDevices)): ?><tr><td colspan="2">No approved devices.</td></tr><?php endif; ?>
                    <?php foreach ($approvedDevices as $ad): ?>
                    <tr>
                        <td>
                            <div style="font-weight:600;"><?=htmlspecialchars($state[$ad]['name'] ?? 'Unknown')?></div>
                            <div style="font-family:monospace;font-size:11px;color:var(--text-secondary);"><?=htmlspecialchars($ad)?></div>
                        </td>
                        <td>
                            <a href="admin.php?key=<?=urlencode($key)?>&device=<?=urlencode($ad)?>" class="btn btn-primary btn-sm">View</a>
                            <a href="admin.php?key=<?=urlencode($key)?>&section=banned&device=<?=urlencode($ad)?>&action=unapprove" class="btn btn-outline btn-sm">Revoke</a>
                        </td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>

        <div class="profile-section">
            <h3>Banned Devices</h3>
            <table class="admin-table">
                <thead><tr><th>Profile</th><th>Reason</th><th>Actions</th></tr></thead>
                <tbody>
                    <?php if (empty($bannedDevices)): ?><tr><td colspan="3">No banned devices.</td></tr><?php endif; ?>
                    <?php foreach ($bannedDevices as $bd): ?>
                    <tr>
                        <td>
                            <div style="font-weight:600;"><?=htmlspecialchars($state[$bd]['name'] ?? 'Unknown')?></div>
                            <div style="font-family:monospace;font-size:11px;color:var(--text-secondary);"><?=htmlspecialchars($bd)?></div>
                        </td>
                        <td style="max-width:320px;font-size:12px;color:var(--text-secondary);word-break:break-word;"><?=nl2br(htmlspecialchars(findBanReason($bd, '')))?></td>
                        <td><a href="admin.php?key=<?=urlencode($key)?>&section=banned&device=<?=urlencode($bd)?>&action=unban" class="btn btn-success btn-sm">Unban</a></td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>

        <div class="profile-section">
            <h3>Banned IPs</h3>
            <table class="admin-table">
                <thead><tr><th>IP Address</th><th>Reason</th><th>Actions</th></tr></thead>
                <tbody>
                    <?php if (empty($bannedIps)): ?><tr><td colspan="3">No banned IPs.</td></tr><?php endif; ?>
                    <?php foreach ($bannedIps as $bi): ?>
                    <tr>
                        <td style="font-family:monospace;"><?=htmlspecialchars($bi)?></td>
                        <td style="max-width:320px;font-size:12px;color:var(--text-secondary);word-break:break-word;"><?=nl2br(htmlspecialchars(findBanReason('', $bi)))?></td>
                        <td><a href="admin.php?key=<?=urlencode($key)?>&section=banned&ip=<?=urlencode($bi)?>&action=unban_ip" class="btn btn-success btn-sm">Unban</a></td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>

        <div class="profile-section">
            <h3>Banned Fingerprints (Lock 2)</h3>
            <table class="admin-table">
                <thead><tr><th>Canvas Hash</th><th>WebGL Renderer</th><th>Linked Profile</th><th>Reason</th><th>Banned At</th><th>Actions</th></tr></thead>
                <tbody>
                    <?php if (empty($bannedFingerprints)): ?><tr><td colspan="6">No banned fingerprints.</td></tr><?php endif; ?>
                    <?php foreach ($bannedFingerprints as $bfp): $bfpDev = $bfp['banned_deviceId'] ?? ''; ?>
                    <tr>
                        <td style="font-family:monospace;font-size:11px;"><?=htmlspecialchars(substr($bfp['canvasHash'] ?? '—', 0, 20))?></td>
                        <td style="font-family:monospace;font-size:11px;"><?=htmlspecialchars(substr($bfp['webGLRenderer'] ?? '—', 0, 30))?></td>
                        <td style="font-size:11px;">
                            <div style="font-weight:600;"><?=htmlspecialchars($bfpDev !== '' ? ($state[$bfpDev]['name'] ?? 'Unknown') : '—')?></div>
                            <div style="font-family:monospace;color:var(--text-secondary);"><?=htmlspecialchars($bfpDev ?: '—')?></div>
                        </td>
                        <td style="max-width:320px;font-size:12px;color:var(--text-secondary);word-break:break-word;"><?=nl2br(htmlspecialchars(findBanReason('', '', ['canvasHash' => $bfp['canvasHash'] ?? '', 'webGLRenderer' => $bfp['webGLRenderer'] ?? ''])))?></td>
                        <td style="font-size:12px;"><?=htmlspecialchars($bfp['banned_at'] ?? '—')?></td>
                        <td>
                            <a href="admin.php?key=<?=urlencode($key)?>&section=banned&canvasHash=<?=urlencode($bfp['canvasHash'] ?? '')?>&webGLRenderer=<?=urlencode($bfp['webGLRenderer'] ?? '')?>&action=unban_fingerprint" class="btn btn-success btn-sm">Unban</a>
                        </td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>

    <?php elseif ($isRequestsView):
        // Access requests submitted from the locked gate page. Pending first,
        // then most-recent. Approving whitelists the device; denying shows the
        // "access denied" page on their device.
        $reqsList = $accessRequests;
        uasort($reqsList, function($a, $b) {
            $pa = (($a['status'] ?? '') === 'pending') ? 0 : 1;
            $pb = (($b['status'] ?? '') === 'pending') ? 0 : 1;
            if ($pa !== $pb) return $pa - $pb;
            return strcmp($b['requested_at'] ?? '', $a['requested_at'] ?? '');
        });
        $statusBadge = ['pending' => 'badge-warning', 'approved' => 'badge-success', 'denied' => 'badge-danger'];
    ?>
        <header>
            <h1>Access Requests</h1>
            <div class="header-actions">
                <a href="admin.php?key=<?=htmlspecialchars($key)?>" class="btn btn-outline">← Back to Dashboard</a>
            </div>
        </header>

        <div class="stats-bar">
            <div class="stat-card"><div class="num" style="color:var(--warning)"><?=$pendingRequestCount?></div><div class="label">Pending</div></div>
            <div class="stat-card"><div class="num"><?=count($accessRequests)?></div><div class="label">Total Requests</div></div>
        </div>

        <div class="profile-section">
            <h3>📨 Requests</h3>
            <table class="admin-table">
                <thead><tr><th>Name</th><th>Reason</th><th>Device</th><th>Requested</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                    <?php if (empty($reqsList)): ?><tr><td colspan="6">No access requests yet.</td></tr><?php endif; ?>
                    <?php foreach ($reqsList as $rid => $r):
                        $st = $r['status'] ?? 'pending';
                        $badge = $statusBadge[$st] ?? 'badge';
                        $approveUrl = 'admin.php?key=' . urlencode($key) . '&device=' . urlencode($rid) . '&action=approve_request';
                        $denyUrl    = 'admin.php?key=' . urlencode($key) . '&device=' . urlencode($rid) . '&action=deny_request';
                    ?>
                    <tr>
                        <td style="font-weight:600;"><?=htmlspecialchars($r['name'] ?? '—')?></td>
                        <td style="max-width:280px;font-size:13px;color:var(--text-secondary);word-break:break-word;"><?=nl2br(htmlspecialchars($r['reason'] ?? '—'))?></td>
                        <td style="font-family:monospace;font-size:11px;"><?=htmlspecialchars($rid)?></td>
                        <td style="font-size:12px;white-space:nowrap;"><?=htmlspecialchars($r['requested_at'] ?? '—')?></td>
                        <td><span class="badge <?=$badge?>"><?=strtoupper(htmlspecialchars($st))?></span></td>
                        <td style="white-space:nowrap;">
                            <button type="button" class="btn btn-outline btn-sm"
                                onclick='openRequestModal(this)'
                                data-name="<?=htmlspecialchars($r['name'] ?? '—', ENT_QUOTES)?>"
                                data-reason="<?=htmlspecialchars($r['reason'] ?? '—', ENT_QUOTES)?>"
                                data-device="<?=htmlspecialchars($rid, ENT_QUOTES)?>"
                                data-ip="<?=htmlspecialchars($r['ip'] ?? '—', ENT_QUOTES)?>"
                                data-requested="<?=htmlspecialchars($r['requested_at'] ?? '—', ENT_QUOTES)?>"
                                data-decided="<?=htmlspecialchars($r['decided_at'] ?? '', ENT_QUOTES)?>"
                                data-status="<?=htmlspecialchars($st, ENT_QUOTES)?>"
                                data-note="<?=htmlspecialchars($r['note'] ?? '', ENT_QUOTES)?>"
                                data-denial-note="<?=htmlspecialchars($r['denial_note'] ?? '', ENT_QUOTES)?>"
                                data-approve="<?=htmlspecialchars($approveUrl, ENT_QUOTES)?>"
                                data-deny="<?=htmlspecialchars($denyUrl, ENT_QUOTES)?>">View</button>
                            <?php if ($st !== 'approved'): ?>
                                <a href="<?=htmlspecialchars($approveUrl)?>" class="btn btn-success btn-sm">Approve</a>
                            <?php endif; ?>
                            <?php if ($st !== 'denied'): ?>
                                <a href="<?=htmlspecialchars($denyUrl)?>" class="btn btn-danger btn-sm" onclick="return promptBanReason(this, 'Reason shown on the access denied page:');">Deny</a>
                            <?php endif; ?>
                            <a href="admin.php?key=<?=urlencode($key)?>&device=<?=urlencode($rid)?>&action=delete_request" class="btn btn-outline btn-sm" onclick="return confirm('Delete this request record?');">✕</a>
                        </td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>

        <!-- Access request detail modal -->
        <div id="reqModal" class="req-modal-overlay" onclick="if(event.target===this)closeRequestModal()">
            <div class="req-modal" role="dialog" aria-modal="true" aria-labelledby="reqModalName">
                <button type="button" class="req-modal-close" onclick="closeRequestModal()" aria-label="Close">✕</button>
                <h3 style="margin:0 0 4px;">Access Request</h3>
                <div id="reqModalStatus" style="margin-bottom:16px;"></div>

                <div class="req-modal-field"><div class="req-modal-label">Name</div><div id="reqModalName" class="req-modal-value"></div></div>
                <div class="req-modal-field"><div class="req-modal-label">Reason</div><div id="reqModalReason" class="req-modal-value" style="white-space:pre-wrap;"></div></div>
                <div class="req-modal-field"><div class="req-modal-label">Device ID</div><div id="reqModalDevice" class="req-modal-value" style="font-family:monospace;font-size:12px;word-break:break-all;"></div></div>
                <div class="req-modal-field"><div class="req-modal-label">IP</div><div id="reqModalIp" class="req-modal-value" style="font-family:monospace;font-size:12px;"></div></div>
                <div class="req-modal-field"><div class="req-modal-label">Requested</div><div id="reqModalRequested" class="req-modal-value"></div></div>
                <div class="req-modal-field" id="reqModalDecidedWrap" style="display:none;"><div class="req-modal-label">Decided</div><div id="reqModalDecided" class="req-modal-value"></div></div>

                <form id="reqApproveForm" method="POST" action="admin.php" style="margin:0;">
                    <input type="hidden" name="key" value="<?=htmlspecialchars($key)?>">
                    <input type="hidden" name="action" value="approve_request">
                    <input type="hidden" name="device" id="reqApproveDevice" value="">
                    <div class="req-modal-field" style="margin-bottom:8px;">
                        <div class="req-modal-label">Note (shown on the user's “Add to Home Screen” screen)</div>
                        <textarea id="reqModalNote" name="note" maxlength="1000" rows="3" placeholder="Optional message to the approved user…"
                            style="width:100%;background:rgba(255,255,255,0.06);border:1px solid var(--border);border-radius:10px;padding:10px 12px;color:var(--text);font-size:14px;font-family:inherit;resize:vertical;"></textarea>
                    </div>
                    <div class="req-modal-actions">
                        <button type="submit" id="reqModalApprove" class="btn btn-success btn-sm">Approve</button>
                        <a id="reqModalDeny" href="#" class="btn btn-danger btn-sm" onclick="return promptBanReason(this, 'Reason shown on the access denied page:');">Deny</a>
                    </div>
                </form>
            </div>
        </div>

        <style>
            .req-modal-overlay {
                display: none; position: fixed; inset: 0; z-index: 1000;
                background: rgba(0,0,0,0.62); -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px);
                align-items: center; justify-content: center; padding: 20px;
            }
            .req-modal-overlay.open { display: flex; }
            .req-modal {
                position: relative; width: min(520px, 94vw); max-height: 88vh; overflow-y: auto;
                background: #11131f; border: 1px solid var(--border); border-radius: 16px;
                padding: 24px 24px 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.6);
            }
            .req-modal-close {
                position: absolute; top: 14px; right: 14px; background: transparent; border: none;
                color: var(--text-secondary); font-size: 18px; cursor: pointer; line-height: 1;
            }
            .req-modal-close:hover { color: #fff; }
            .req-modal-field { margin-bottom: 14px; }
            .req-modal-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-secondary); margin-bottom: 4px; }
            .req-modal-value { font-size: 15px; color: var(--text); word-break: break-word; }
            .req-modal-actions { display: flex; gap: 10px; margin-top: 20px; }
        </style>

        <script>
            function openRequestModal(btn) {
                var d = btn.dataset;
                document.getElementById('reqModalName').textContent     = d.name;
                document.getElementById('reqModalReason').textContent   = d.reason;
                document.getElementById('reqModalDevice').textContent   = d.device;
                document.getElementById('reqModalIp').textContent       = d.ip;
                document.getElementById('reqModalRequested').textContent = d.requested;

                var decidedWrap = document.getElementById('reqModalDecidedWrap');
                if (d.decided) {
                    document.getElementById('reqModalDecided').textContent = d.decided;
                    decidedWrap.style.display = '';
                } else {
                    decidedWrap.style.display = 'none';
                }

                var badgeClass = { pending: 'badge-warning', approved: 'badge-success', denied: 'badge-danger' }[d.status] || 'badge';
                document.getElementById('reqModalStatus').innerHTML =
                    '<span class="badge ' + badgeClass + '">' + d.status.toUpperCase() + '</span>';

                document.getElementById('reqApproveDevice').value = d.device;
                document.getElementById('reqModalNote').value = d.note || '';

                var approve = document.getElementById('reqModalApprove');
                var deny    = document.getElementById('reqModalDeny');
                deny.href   = d.deny;
                // Approve button submits the form (so the note is sent); re-show
                // it for an already-approved device so the note can be updated.
                approve.textContent   = (d.status === 'approved') ? 'Update note' : 'Approve';
                deny.style.display    = (d.status === 'denied')   ? 'none' : '';

                document.getElementById('reqModal').classList.add('open');
            }
            function closeRequestModal() {
                document.getElementById('reqModal').classList.remove('open');
            }
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') closeRequestModal();
            });
        </script>

    <?php elseif ($isDeletedView):
        // Deleted profiles that are currently inactive. A deleted profile that
        // is active right now intentionally appears on the dashboard's Active
        // list instead, and falls back here once it goes offline.
        $deletedInactive = [];
        foreach ($deletedDevices as $delId) {
            $delId = trim($delId);
            if ($delId === '' || !isset($state[$delId])) continue;
            if (getDeviceStatus($delId, $state, $visits) === 'active') continue;
            $deletedInactive[$delId] = $state[$delId];
        }
        uasort($deletedInactive, fn($a, $b) => strcmp($b['last_seen'] ?? '', $a['last_seen'] ?? ''));
    ?>
        <header>
            <h1>Deleted Profiles</h1>
            <div class="header-actions">
                <a href="admin.php?key=<?=htmlspecialchars($key)?>" class="btn btn-outline">← Back to Dashboard</a>
            </div>
        </header>

        <div class="stats-bar">
            <div class="stat-card"><div class="num"><?=count($deletedInactive)?></div><div class="label">Deleted (inactive)</div></div>
        </div>

        <div class="section-header-bar"><div class="indicator offline"></div><h2>🗑 Deleted</h2></div>
        <?php if (empty($deletedInactive)): ?>
            <p style="color:var(--text-secondary); padding:8px 2px;">No deleted profiles. A deleted profile that is currently active stays on the dashboard until it goes offline, then appears here.</p>
        <?php else: ?>
        <div class="device-grid">
            <?php foreach ($deletedInactive as $id => $d):
                $photo = getDevicePhoto($id);
            ?>
            <div class="device-card offline">
                <?php if($photo): ?><img src="<?=$photo?>" class="photo-thumb" style="filter:grayscale(0.5)"><?php else: ?><div class="photo-thumb"></div><?php endif; ?>
                <div class="info">
                    <div class="name"><?=htmlspecialchars($d['name'] ?? 'Unknown')?></div>
                    <div class="sub"><?=truncateDeviceId($id)?></div>
                    <div style="margin-top:6px; display:flex; gap:6px;">
                        <a href="admin.php?key=<?=htmlspecialchars($key)?>&device=<?=urlencode($id)?>" class="btn btn-outline btn-sm">View</a>
                        <a href="admin.php?key=<?=htmlspecialchars($key)?>&device=<?=urlencode($id)?>&action=restore_profile" class="btn btn-success btn-sm">↩ Restore</a>
                    </div>
                </div>
            </div>
            <?php endforeach; ?>
        </div>
        <?php endif; ?>

    <?php else:
        $devices = $state;
        uasort($devices, fn($a, $b) => strcmp($b['last_seen'] ?? '', $a['last_seen'] ?? ''));

        $activeDevices = [];
        $offlineDevices = [];
        foreach ($devices as $id => $data) {
            $status = getDeviceStatus($id, $state, $visits);
            // A deleted profile lives in the Deleted section while inactive, but
            // resurfaces in the Active list the moment it becomes active again.
            if ($status === 'active') $activeDevices[$id] = $data;
            elseif (in_array($id, $deletedDevices, true)) continue;
            else $offlineDevices[$id] = $data;
        }
    ?>
        <header>
            <h1>Admin Dashboard</h1>
            <div class="header-actions">
                <a href="admin.php?key=<?=htmlspecialchars($key)?>&section=requests" class="btn btn-success btn-sm" style="position:relative;">📨 Access Requests<?php if ($pendingRequestCount > 0): ?> <span class="badge badge-danger" style="margin-left:4px;"><?=$pendingRequestCount?></span><?php endif; ?></a>
                <a href="admin.php?key=<?=htmlspecialchars($key)?>&section=banned" class="btn btn-danger btn-sm">🚫 Banned Mgmt</a>
                <a href="admin.php?key=<?=htmlspecialchars($key)?>&section=passwords" class="btn btn-warning btn-sm">⚙ Passwords</a>
                <a href="admin.php?key=<?=htmlspecialchars($key)?>&section=deleted" class="btn btn-sm" style="background:#6e6e73;color:#fff;">🗑 Deleted</a>
                <button onclick="openBroadcastModal()" class="btn btn-sm" style="background:#ff9500;color:#fff;border:none;cursor:pointer;font-family:inherit;">📢 Message</button>
                <?php $devToken = hash('sha256', 'devmode|' . $adminPasswordHash); ?>
                <a href="index.php?dev=<?=htmlspecialchars($devToken)?>" target="_blank" rel="noopener" class="btn btn-sm" style="background:#5e5ce6;color:#fff;">🛠 Dev Mode</a>
                <a href="admin.php?key=<?=htmlspecialchars($key)?>" class="btn btn-primary btn-sm">Refresh</a>
                <a href="admin.php?logout=1" class="btn btn-outline btn-sm">Logout</a>
            </div>
        </header>

        <?php if (($_GET['msg'] ?? '') === 'broadcast_sent'): ?>
            <div class="msg-box success" style="margin-bottom:16px;">📢 Message broadcast to all devices! They will see it on next launch.</div>
        <?php endif; ?>

        <div class="stats-bar">
            <div class="stat-card"><div class="num"><?=count($state)?></div><div class="label">Total Devices</div></div>
            <div class="stat-card"><div class="num" style="color:var(--success)"><?=count($activeDevices)?></div><div class="label">Active</div></div>
            <div class="stat-card"><div class="num" style="color:var(--danger)"><?=count($bannedDevices) + count($bannedIps)?></div><div class="label">Total Banned</div></div>
            <?php
            $health = checkWritability();
            $allWritable = !in_array('Locked / Not Writable', array_values($health)) && !in_array('Not Found / Not Writable', array_values($health));
            ?>
            <div class="stat-card" onclick="document.getElementById('healthDetails').classList.toggle('visible')" style="cursor:pointer;">
                <div class="num" style="color:<?=$allWritable ? 'var(--success)' : 'var(--danger)'?>"><?=$allWritable ? 'OK' : 'FAIL'?></div>
                <div class="label">System Health ▾</div>
            </div>
        </div>

        <div id="healthDetails" class="debug-section" style="margin-top:-10px; margin-bottom:20px; background:rgba(20,24,42,0.72); color:var(--text); border:1px solid var(--border);">
            <h3 style="margin:0 0 10px 0; font-size:14px;">File System Writability</h3>
            <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:10px;">
                <?php foreach ($health as $file => $status): 
                    $isOK = strpos($status, 'Writable') !== false;
                ?>
                    <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; padding:6px; background:rgba(255,255,255,0.05); border-radius:6px;">
                        <span><?=htmlspecialchars($file)?></span>
                        <span class="badge <?=$isOK ? 'badge-success' : 'badge-danger'?>"><?=htmlspecialchars($status)?></span>
                    </div>
                <?php endforeach; ?>
            </div>
        </div>

        <div class="section-header-bar"><div class="indicator active"></div><h2>🟢 Currently Active</h2></div>
        <div class="device-grid">
            <?php foreach ($activeDevices as $id => $d): 
                $photo = getDevicePhoto($id);
                $failed = $d['failed_attempts'] ?? 0;
                $riskClass = $failed >= 10 ? 'risk-high' : ($failed >= 5 ? 'risk-medium' : '');
            ?>
            <a href="admin.php?key=<?=htmlspecialchars($key)?>&device=<?=urlencode($id)?>" class="device-card <?=$riskClass?>">
                <?php if($failed >= 5): ?><div class="risk-icon"><?=$failed >= 10 ? '🛑' : '⚠️'?></div><?php endif; ?>
                <?php if($photo): ?><img src="<?=$photo?>" class="photo-thumb"><?php else: ?><div class="photo-thumb"></div><?php endif; ?>
                <div class="info">
                    <div class="name"><?=htmlspecialchars($d['name'] ?? 'Unknown')?></div>
                    <div class="sub"><?=truncateDeviceId($id)?></div>
                    <?php if (in_array($id, $approvedDevices)): ?>
                        <div style="font-size:9px; color:var(--success); font-weight:700; margin-top:2px;">✓ APPROVED</div>
                    <?php else: ?>
                        <div style="font-size:9px; color:var(--warning); font-weight:700; margin-top:2px;">? PENDING</div>
                    <?php endif; ?>
                </div>
                <span class="status-badge online">Active</span>
            </a>
            <?php endforeach; ?>
        </div>

        <div class="section-header-bar"><div class="indicator offline"></div><h2>⚫ Offline / Banned</h2></div>
        <div class="device-grid">
            <?php foreach ($offlineDevices as $id => $d): 
                $status = getDeviceStatus($id, $state, $visits);
                $isBanned = ($status === 'banned');
                $photo = getDevicePhoto($id);
                $failed = $d['failed_attempts'] ?? 0;
                $riskClass = $failed >= 10 ? 'risk-high' : ($failed >= 5 ? 'risk-medium' : '');
            ?>
            <a href="admin.php?key=<?=htmlspecialchars($key)?>&device=<?=urlencode($id)?>" class="device-card <?=$isBanned?'banned':'offline'?> <?=$riskClass?>">
                <?php if($failed >= 5): ?><div class="risk-icon"><?=$failed >= 10 ? '🛑' : '⚠️'?></div><?php endif; ?>
                <?php if($photo): ?><img src="<?=$photo?>" class="photo-thumb" style="filter:grayscale(0.5)"><?php else: ?><div class="photo-thumb"></div><?php endif; ?>
                <div class="info">
                    <div class="name" style="<?=$isBanned?'text-decoration:line-through;':''?>"><?=htmlspecialchars($d['name'] ?? 'Unknown')?></div>
                    <div class="sub"><?=truncateDeviceId($id)?></div>
                    <?php if (in_array($id, $approvedDevices)): ?>
                        <div style="font-size:9px; color:var(--success); font-weight:700; margin-top:2px;">✓ APPROVED</div>
                    <?php else: ?>
                        <div style="font-size:9px; color:var(--warning); font-weight:700; margin-top:2px;">? PENDING</div>
                    <?php endif; ?>
                </div>
                <span class="status-badge <?=$isBanned?'banned-sm':'offline'?>"><?=$isBanned?'Banned':'Offline'?></span>
            </a>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>
    </div>

    <!-- Broadcast message modal -->
    <div class="req-modal-overlay" id="broadcastModalOverlay" onclick="if(event.target===this)closeBroadcastModal()">
        <div class="req-modal">
            <button class="req-modal-close" onclick="closeBroadcastModal()">&times;</button>
            <h3 style="margin:0 0 16px 0;font-size:18px;">📢 Send Message to All Devices</h3>
            <?php $currentBroadcast = file_exists(__DIR__ . '/broadcast.json') ? safeReadJson(__DIR__ . '/broadcast.json') : null; ?>
            <?php if (is_array($currentBroadcast) && !empty($currentBroadcast['message'])): ?>
                <div style="background:rgba(255,149,0,0.12);border:1px solid rgba(255,149,0,0.3);border-radius:8px;padding:12px 14px;margin-bottom:16px;font-size:13px;">
                    <div style="text-transform:uppercase;letter-spacing:1px;font-size:10px;color:var(--text-secondary);margin-bottom:4px;">Active Broadcast</div>
                    <div style="color:var(--text);margin-bottom:4px;"><?=htmlspecialchars($currentBroadcast['message'])?></div>
                    <div style="color:var(--text-secondary);font-size:11px;">Sent <?=htmlspecialchars($currentBroadcast['createdAt'] ?? '')?></div>
                </div>
                <div style="font-size:12px;color:var(--text-secondary);margin-bottom:14px;">Sending a new message replaces the current one.</div>
            <?php else: ?>
                <div style="font-size:13px;color:var(--text-secondary);margin-bottom:14px;">No active broadcast. All devices will see this message once, then dismiss it.</div>
            <?php endif; ?>
            <form method="POST" action="admin.php?key=<?=htmlspecialchars($key)?>">
                <input type="hidden" name="action" value="broadcast">
                <textarea name="message" placeholder="Type your message…" required rows="4" style="width:100%;background:#1a1d2e;border:1px solid var(--border);border-radius:8px;color:var(--text);padding:12px;font-family:inherit;font-size:14px;resize:vertical;margin-bottom:16px;"></textarea>
                <div class="req-modal-actions">
                    <button type="button" class="btn btn-outline btn-sm" onclick="closeBroadcastModal()">Cancel</button>
                    <button type="submit" class="btn btn-sm" style="background:#ff9500;color:#fff;">📢 Send to All Devices</button>
                </div>
            </form>
        </div>
    </div>

    <script>
        function promptBanReason(link, message) {
            var reason = window.prompt(message || 'Reason shown on the access denied page:', '');
            if (reason === null) return false;
            reason = reason.trim();
            if (!reason) {
                window.alert('Enter a reason to show below access denied.');
                return false;
            }
            var sep = link.href.indexOf('?') === -1 ? '?' : '&';
            link.href += sep + 'ban_reason=' + encodeURIComponent(reason);
            return true;
        }
        function openBroadcastModal() { document.getElementById('broadcastModalOverlay').classList.add('open'); }
        function closeBroadcastModal() { document.getElementById('broadcastModalOverlay').classList.remove('open'); }
        document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeBroadcastModal(); });
    </script>
</body>
</html>
