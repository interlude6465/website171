<?php
function hashPassword($password) {
    return hash('sha256', $password . 'saltysalt123');
}

$configFile = __DIR__ . '/.admin_config.json';
$config = file_exists($configFile) ? json_decode(file_get_contents($configFile), true) : [];

// Initial setup or migration
if (!isset($config['password_hash'])) {
    $config['password_hash'] = hashPassword('admin123');
}
if (!isset($config['licence_pin'])) {
    $config['licence_pin'] = '4575';
}
// Ensure config is saved
file_put_contents($configFile, json_encode($config, JSON_PRETTY_PRINT));

$adminPasswordHash = $config['password_hash'];
$licencePin = $config['licence_pin'];

$key = $_GET['key'] ?? '';
if (hashPassword($key) !== $adminPasswordHash) {
    http_response_code(401);
    die("Unauthorized");
}

$stateFile = __DIR__ . '/latest_state.json';
$bannedFile = __DIR__ . '/banned_devices.txt';
$bannedIpsFile = __DIR__ . '/banned_ips.txt';
$bannedFingerprintsFile = __DIR__ . '/banned_fingerprints.json';
$visitsLog = __DIR__ . '/visits.log';

// Load state early (needed for enhanced unban)
$state = file_exists($stateFile) ? json_decode(file_get_contents($stateFile), true) : [];
if (!is_array($state)) $state = [];

// Handle Actions - must check before any output
$action = $_GET['action'] ?? $_POST['action'] ?? '';
$device = $_GET['device'] ?? $_POST['device'] ?? '';
$ip_to_ban = $_GET['ip'] ?? $_POST['ip'] ?? '';
$section = $_GET['section'] ?? '';

// ---- Password change action ----
if ($action === 'change_password') {
    $oldPass = $_POST['old_password'] ?? '';
    $newPass = $_POST['new_password'] ?? '';
    $confirmPass = $_POST['confirm_password'] ?? '';

    if (hashPassword($oldPass) === $adminPasswordHash) {
        if ($newPass === $confirmPass && !empty($newPass)) {
            $config['password_hash'] = hashPassword($newPass);
            $written = file_put_contents($configFile, json_encode($config, JSON_PRETTY_PRINT));
            if ($written === false) {
                $passwordError = "Failed to save new password. Check file permissions.";
            } else {
                header("Location: admin.php?key=" . urlencode($newPass) . "&section=passwords&msg=password_changed");
                exit;
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
        if ($newPin === $confirmPin && !empty($newPin) && strlen($newPin) === 4 && ctype_digit($newPin)) {
            $config['licence_pin'] = $newPin;
            $written = file_put_contents($configFile, json_encode($config, JSON_PRETTY_PRINT));
            if ($written === false) {
                $pinError = "Failed to save new PIN. Check file permissions.";
            } else {
                header("Location: admin.php?key=" . urlencode($key) . "&section=passwords&msg=pin_changed");
                exit;
            }
        } else {
            $pinError = "New PIN must be 4 digits and match confirmation.";
        }
    } else {
        $pinError = "Current PIN incorrect.";
    }
}

// ---- Ban/Unban actions ----
if ($action && ($device || $ip_to_ban || $action === 'ban_fingerprint' || $action === 'unban_fingerprint') && $action !== 'change_password' && $action !== 'change_licence_pin') {
    if ($action === 'ban') {
        $device = trim($device);
        $bannedDevices = file_exists($bannedFile) ? file($bannedFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
        $bannedDevices = array_map('trim', $bannedDevices);
        if (!in_array($device, $bannedDevices, true)) {
            $bannedDevices[] = $device;
            file_put_contents($bannedFile, implode("\n", $bannedDevices) . "\n");
        }
    } elseif ($action === 'unban') {
        $device = trim($device);
        if (file_exists($bannedFile)) {
            $bannedDevices = file($bannedFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            $bannedDevices = array_map('trim', $bannedDevices);
            $bannedDevices = array_filter($bannedDevices, fn($d) => trim($d) !== $device);
            file_put_contents($bannedFile, implode("\n", $bannedDevices) . "\n");
        }
    } elseif ($action === 'ban_ip') {
        $ip_to_ban = trim($ip_to_ban);
        $bannedIps = file_exists($bannedIpsFile) ? file($bannedIpsFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
        $bannedIps = array_map('trim', $bannedIps);
        if (!in_array($ip_to_ban, $bannedIps, true)) {
            $bannedIps[] = $ip_to_ban;
            file_put_contents($bannedIpsFile, implode("\n", $bannedIps) . "\n");
        }
    } elseif ($action === 'unban_ip') {
        $ip_to_ban = trim($ip_to_ban);
        if (file_exists($bannedIpsFile)) {
            $bannedIps = file($bannedIpsFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            $bannedIps = array_map('trim', $bannedIps);
            $bannedIps = array_filter($bannedIps, fn($i) => trim($i) !== $ip_to_ban);
            file_put_contents($bannedIpsFile, implode("\n", $bannedIps) . "\n");
        }
    } elseif ($action === 'ban_fingerprint') {
        // Ban by canvasHash from the fingerprint data
        $canvasHash = trim($_GET['canvasHash'] ?? $_POST['canvasHash'] ?? '');
        $webGLRenderer = trim($_GET['webGLRenderer'] ?? $_POST['webGLRenderer'] ?? '');
        if ($canvasHash || $webGLRenderer) {
            $bannedFps = file_exists($bannedFingerprintsFile) ? json_decode(file_get_contents($bannedFingerprintsFile), true) : [];
            if (!is_array($bannedFps)) $bannedFps = [];
            $entry = [
                'canvasHash' => $canvasHash,
                'webGLRenderer' => $webGLRenderer,
                'banned_deviceId' => $device,
                'banned_at' => date('Y-m-d H:i:s'),
                'banned_by' => 'admin'
            ];
            $bannedFps[] = $entry;
            file_put_contents($bannedFingerprintsFile, json_encode($bannedFps, JSON_PRETTY_PRINT));
        }
    } elseif ($action === 'unban_fingerprint') {
        // Remove all fingerprint entries matching a device
        $canvasHash = trim($_GET['canvasHash'] ?? $_POST['canvasHash'] ?? '');
        $webGLRenderer = trim($_GET['webGLRenderer'] ?? $_POST['webGLRenderer'] ?? '');
        if (file_exists($bannedFingerprintsFile)) {
            $bannedFps = json_decode(file_get_contents($bannedFingerprintsFile), true);
            if (!is_array($bannedFps)) $bannedFps = [];
            $bannedFps = array_filter($bannedFps, function($entry) use ($canvasHash, $webGLRenderer) {
                if ($canvasHash && ($entry['canvasHash'] ?? '') === $canvasHash) return false;
                if ($webGLRenderer && ($entry['webGLRenderer'] ?? '') === $webGLRenderer) return false;
                return true;
            });
            file_put_contents($bannedFingerprintsFile, json_encode(array_values($bannedFps), JSON_PRETTY_PRINT));
        }
    }
    
    // Enhanced unban: also clear linked fingerprints, IPs, and reset failed_attempts
    if ($action === 'unban' && $device) {
        // Reset failed_attempts for the unbanned device to prevent immediate re-ban
        if (isset($state[$device])) {
            $state[$device]['failed_attempts'] = 0;
            if (@file_put_contents($stateFile, json_encode($state, JSON_PRETTY_PRINT)) === false) {
                // Log error or handle it as needed
            }
        }
        // Also try to clear associated IP from bans
        if (isset($state[$device]) && !empty($state[$device]['ip'])) {
            $ipToClear = $state[$device]['ip'];
            if (file_exists($bannedIpsFile)) {
                $bannedIps = file($bannedIpsFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
                $bannedIps = array_map('trim', $bannedIps);
                $bannedIps = array_filter($bannedIps, fn($i) => trim($i) !== $ipToClear);
                file_put_contents($bannedIpsFile, implode("\n", $bannedIps) . "\n");
            }
        }
        // Clear related fingerprints
        if (isset($state[$device]) && !empty($state[$device]['fingerprint']) && $state[$device]['fingerprint'] !== '—') {
            $deviceFp = is_array($state[$device]['fingerprint']) ? $state[$device]['fingerprint'] : json_decode($state[$device]['fingerprint'], true);
            if (is_array($deviceFp)) {
                $cHash = $deviceFp['canvasHash'] ?? '';
                $wRenderer = $deviceFp['webGLRenderer'] ?? '';
                if ($cHash || $wRenderer) {
                    $bannedFps = file_exists($bannedFingerprintsFile) ? json_decode(file_get_contents($bannedFingerprintsFile), true) : [];
                    if (!is_array($bannedFps)) $bannedFps = [];
                    $bannedFps = array_filter($bannedFps, function($entry) use ($cHash, $wRenderer) {
                        if ($cHash && ($entry['canvasHash'] ?? '') === $cHash) return false;
                        if ($wRenderer && ($entry['webGLRenderer'] ?? '') === $wRenderer) return false;
                        return true;
                    });
                    file_put_contents($bannedFingerprintsFile, json_encode(array_values($bannedFps), JSON_PRETTY_PRINT));
                }
            }
        }
    }
    
    $redirectDevice = $_GET['device'] ?? '';
    if ($redirectDevice) {
        header("Location: admin.php?key=" . urlencode($key) . "&device=" . urlencode($redirectDevice));
    } elseif ($section === 'banned') {
        header("Location: admin.php?key=" . urlencode($key) . "&section=banned");
    } else {
        header("Location: admin.php?key=" . urlencode($key));
    }
    exit;
}

$bannedDevices = file_exists($bannedFile) ? file($bannedFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
$bannedDevices = array_map('trim', $bannedDevices);

$bannedIps = file_exists($bannedIpsFile) ? file($bannedIpsFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
$bannedIps = array_map('trim', $bannedIps);

$bannedFingerprints = file_exists($bannedFingerprintsFile) ? json_decode(file_get_contents($bannedFingerprintsFile), true) : [];
if (!is_array($bannedFingerprints)) $bannedFingerprints = [];

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
    if (file_exists($path)) {
        $data = file_get_contents($path);
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
    if (isset($state[$deviceId]['photo_path']) && $state[$deviceId]['photo_path'] !== '—' && file_exists($state[$deviceId]['photo_path'])) {
        $data = file_get_contents($state[$deviceId]['photo_path']);
        if (strpos($data, 'data:image') === 0) return $data;
        return 'data:image/jpeg;base64,' . $data;
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

?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= $isProfileView ? 'Device Profile' : ($isPasswordView ? 'Password Management' : ($isBannedView ? 'Banned Management' : 'Licence Admin Dashboard')) ?></title>
    <style>
        :root {
            --primary: #007aff;
            --danger: #ff3b30;
            --success: #34c759;
            --warning: #ff9500;
            --bg: #f2f2f7;
            --card-bg: #ffffff;
            --text: #1c1c1e;
            --text-secondary: #8e8e93;
            --text-muted: #aeaeb2;
            --border: #e5e5ea;
            --shadow: 0 2px 8px rgba(0,0,0,0.06);
            --radius: 12px;
        }
        * { box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            margin: 0;
            background: var(--bg);
            color: var(--text);
            -webkit-font-smoothing: antialiased;
        }
        .container { max-width: 1100px; margin: 0 auto; padding: 20px; }
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
        h1 { font-size: 22px; margin: 0; font-weight: 700; }
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
            background: #e5e5ea;
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
            background: #e5e5ea;
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
        .device-card .status-badge.online { background: #e8f8ee; color: var(--success); }
        .device-card .status-badge.offline { background: #f2f2f7; color: var(--text-muted); }
        .device-card .status-badge.banned-sm { background: #fde8e7; color: var(--danger); }
        
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
            background: #e5e5ea;
            flex-shrink: 0;
        }
        .profile-header .info { flex: 1; min-width: 200px; }
        .profile-header .info h2 { margin: 0 0 4px 0; font-size: 22px; }
        .profile-header .info .meta { color: var(--text-secondary); font-size: 13px; margin-bottom: 4px; }
        .profile-header .info .field { margin-top: 10px; }
        .profile-header .info .field .lbl { font-size: 11px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.3px; }
        .profile-header .info .field .val { font-weight: 600; font-size: 15px; }
        .profile-header .ban-area { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
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
            background: #f9f9f9;
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
            transition: border-color 0.2s;
        }
        .form-group input:focus { border-color: var(--primary); }
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
    </style>
</head>
<body>
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
        $currentIp = $d['ip'] ?? '';
        $isIpBanned = $currentIp && in_array(trim($currentIp), $bannedIps, true);
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
                    <div class="lbl" style="font-size:10px;text-transform:uppercase;margin-bottom:4px;">Device Control</div>
                    <?php if ($isDeviceBanned): ?>
                        <span class="badge badge-banned">DEVICE BANNED</span>
                        <a href="admin.php?key=<?=htmlspecialchars($key)?>&device=<?=urlencode($viewDevice)?>&action=unban" class="btn btn-success btn-sm">Unban Device</a>
                    <?php else: ?>
                        <a href="admin.php?key=<?=htmlspecialchars($key)?>&device=<?=urlencode($viewDevice)?>&action=ban" class="btn btn-danger btn-sm">Ban Device</a>
                    <?php endif; ?>
                </div>
                
                <?php if ($currentIp): ?>
                <div>
                    <div class="lbl" style="font-size:10px;text-transform:uppercase;margin-bottom:4px;">IP Control (<?=$currentIp?>)</div>
                    <?php if ($isIpBanned): ?>
                        <span class="badge badge-banned">IP BANNED</span>
                        <a href="admin.php?key=<?=htmlspecialchars($key)?>&device=<?=urlencode($viewDevice)?>&ip=<?=urlencode($currentIp)?>&action=unban_ip" class="btn btn-success btn-sm">Unban IP</a>
                    <?php else: ?>
                        <a href="admin.php?key=<?=htmlspecialchars($key)?>&device=<?=urlencode($viewDevice)?>&ip=<?=urlencode($currentIp)?>&action=ban_ip" class="btn btn-danger btn-sm">Ban IP</a>
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
                        <div style="flex:1;min-width:140px;padding:12px;border-radius:8px;background:<?=$lock1?'#fde8e7':'#e8f8ee'?>;border:1px solid <?=$lock1?'var(--danger)':'var(--success)'?>;">
                            <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:<?=$lock1?'var(--danger)':'var(--success)'?>;">Lock 1</div>
                            <div style="font-size:13px;font-weight:600;margin-top:2px;">Explicit (Cookie/IP)</div>
                            <div style="font-size:16px;font-weight:700;margin-top:4px;color:<?=$lock1?'var(--danger)':'var(--success)'?>;"><?=$lock1?'🔴 BREACHED':'🟢 CLEAR'?></div>
                        </div>
                        <div style="flex:1;min-width:140px;padding:12px;border-radius:8px;background:<?=$lock2?'#fde8e7':'#e8f8ee'?>;border:1px solid <?=$lock2?'var(--danger)':'var(--success)'?>;">
                            <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:<?=$lock2?'var(--danger)':'var(--success)'?>;">Lock 2</div>
                            <div style="font-size:13px;font-weight:600;margin-top:2px;">Implicit (Canvas/WebGL)</div>
                            <div style="font-size:16px;font-weight:700;margin-top:4px;color:<?=$lock2?'var(--danger)':'var(--success)'?>;"><?=$lock2?'🔴 BREACHED':'🟢 CLEAR'?></div>
                        </div>
                        <div style="flex:1;min-width:140px;padding:12px;border-radius:8px;background:<?=$lock3?'#fde8e7':'#e8f8ee'?>;border:1px solid <?=$lock3?'var(--danger)':'var(--success)'?>;">
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
                    <div style="margin-top:8px;padding:10px;background:#f9f9f9;border-radius:6px;font-size:11px;font-family:monospace;color:var(--text-secondary);word-break:break-all;">
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
                            <?php else: ?>
                                <a href="admin.php?key=<?=htmlspecialchars($key)?>&device=<?=urlencode($viewDevice)?>&canvasHash=<?=urlencode($cHash)?>&webGLRenderer=<?=urlencode($wRenderer)?>&action=ban_fingerprint" class="btn btn-danger btn-sm">🔒 Ban Fingerprint (Lock 2)</a>
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
                    <div class="form-group"><label>Current PIN</label><input type="password" name="old_pin" required maxlength="4"></div>
                    <div class="form-group"><label>New PIN (4 digits)</label><input type="password" name="new_pin" required maxlength="4"></div>
                    <div class="form-group"><label>Confirm New PIN</label><input type="password" name="confirm_pin" required maxlength="4"></div>
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

        <div id="healthDetailsBanned" class="debug-section" style="margin-top:-10px; margin-bottom:20px; background:#fff; color:var(--text); border:1px solid var(--border);">
            <h3 style="margin:0 0 10px 0; font-size:14px;">File System Writability</h3>
            <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:10px;">
                <?php foreach ($health as $file => $status): 
                    $isOK = strpos($status, 'Writable') !== false;
                ?>
                    <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; padding:6px; background:#f9f9f9; border-radius:6px;">
                        <span><?=htmlspecialchars($file)?></span>
                        <span class="badge <?=$isOK ? 'badge-success' : 'badge-danger'?>"><?=htmlspecialchars($status)?></span>
                    </div>
                <?php endforeach; ?>
            </div>
        </div>

        <div class="profile-section">
            <h3>Banned Devices</h3>
            <table class="admin-table">
                <thead><tr><th>Device ID</th><th>Actions</th></tr></thead>
                <tbody>
                    <?php if (empty($bannedDevices)): ?><tr><td colspan="2">No banned devices.</td></tr><?php endif; ?>
                    <?php foreach ($bannedDevices as $bd): ?>
                    <tr>
                        <td style="font-family:monospace;"><?=htmlspecialchars($bd)?></td>
                        <td><a href="admin.php?key=<?=urlencode($key)?>&section=banned&device=<?=urlencode($bd)?>&action=unban" class="btn btn-success btn-sm">Unban</a></td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>

        <div class="profile-section">
            <h3>Banned IPs</h3>
            <table class="admin-table">
                <thead><tr><th>IP Address</th><th>Actions</th></tr></thead>
                <tbody>
                    <?php if (empty($bannedIps)): ?><tr><td colspan="2">No banned IPs.</td></tr><?php endif; ?>
                    <?php foreach ($bannedIps as $bi): ?>
                    <tr>
                        <td style="font-family:monospace;"><?=htmlspecialchars($bi)?></td>
                        <td><a href="admin.php?key=<?=urlencode($key)?>&section=banned&ip=<?=urlencode($bi)?>&action=unban_ip" class="btn btn-success btn-sm">Unban</a></td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>

        <div class="profile-section">
            <h3>Banned Fingerprints (Lock 2)</h3>
            <table class="admin-table">
                <thead><tr><th>Canvas Hash</th><th>WebGL Renderer</th><th>Linked Device</th><th>Banned At</th><th>Actions</th></tr></thead>
                <tbody>
                    <?php if (empty($bannedFingerprints)): ?><tr><td colspan="5">No banned fingerprints.</td></tr><?php endif; ?>
                    <?php foreach ($bannedFingerprints as $bfp): ?>
                    <tr>
                        <td style="font-family:monospace;font-size:11px;"><?=htmlspecialchars(substr($bfp['canvasHash'] ?? '—', 0, 20))?></td>
                        <td style="font-family:monospace;font-size:11px;"><?=htmlspecialchars(substr($bfp['webGLRenderer'] ?? '—', 0, 30))?></td>
                        <td style="font-family:monospace;font-size:11px;"><?=htmlspecialchars($bfp['banned_deviceId'] ?? '—')?></td>
                        <td style="font-size:12px;"><?=htmlspecialchars($bfp['banned_at'] ?? '—')?></td>
                        <td>
                            <a href="admin.php?key=<?=urlencode($key)?>&section=banned&canvasHash=<?=urlencode($bfp['canvasHash'] ?? '')?>&webGLRenderer=<?=urlencode($bfp['webGLRenderer'] ?? '')?>&action=unban_fingerprint" class="btn btn-success btn-sm">Unban</a>
                        </td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>

    <?php else: 
        $devices = $state;
        uasort($devices, fn($a, $b) => strcmp($b['last_seen'] ?? '', $a['last_seen'] ?? ''));

        $activeDevices = [];
        $offlineDevices = [];
        foreach ($devices as $id => $data) {
            $status = getDeviceStatus($id, $state, $visits);
            if ($status === 'active') $activeDevices[$id] = $data;
            else $offlineDevices[$id] = $data;
        }
    ?>
        <header>
            <h1>Admin Dashboard</h1>
            <div class="header-actions">
                <a href="admin.php?key=<?=htmlspecialchars($key)?>&section=banned" class="btn btn-danger btn-sm">🚫 Banned Mgmt</a>
                <a href="admin.php?key=<?=htmlspecialchars($key)?>&section=passwords" class="btn btn-warning btn-sm">⚙ Passwords</a>
                <a href="admin.php?key=<?=htmlspecialchars($key)?>" class="btn btn-primary btn-sm">Refresh</a>
            </div>
        </header>

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

        <div id="healthDetails" class="debug-section" style="margin-top:-10px; margin-bottom:20px; background:#fff; color:var(--text); border:1px solid var(--border);">
            <h3 style="margin:0 0 10px 0; font-size:14px;">File System Writability</h3>
            <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:10px;">
                <?php foreach ($health as $file => $status): 
                    $isOK = strpos($status, 'Writable') !== false;
                ?>
                    <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; padding:6px; background:#f9f9f9; border-radius:6px;">
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
                </div>
                <span class="status-badge <?=$isBanned?'banned-sm':'offline'?>"><?=$isBanned?'Banned':'Offline'?></span>
            </a>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>
    </div>
</body>
</html>
