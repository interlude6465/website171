<?php
$key = $_GET['key'] ?? '';
if ($key !== 'admin123') {
    http_response_code(401);
    die("Unauthorized");
}

$stateFile = __DIR__ . '/latest_state.json';
$bannedFile = __DIR__ . '/banned_devices.txt';

// Handle Actions
$action = $_GET['action'] ?? '';
$device = $_GET['device'] ?? '';

if ($action && $device) {
    $device = trim($device);
    if ($action === 'ban') {
        $bannedDevices = file_exists($bannedFile) ? file($bannedFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
        $bannedDevices = array_map('trim', $bannedDevices);
        if (!in_array($device, $bannedDevices, true)) {
            $bannedDevices[] = $device;
            file_put_contents($bannedFile, implode("\n", $bannedDevices) . "\n");
        }
    } elseif ($action === 'unban') {
        if (file_exists($bannedFile)) {
            $bannedDevices = file($bannedFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            $bannedDevices = array_map('trim', $bannedDevices);
            $bannedDevices = array_filter($bannedDevices, fn($d) => trim($d) !== $device);
            file_put_contents($bannedFile, implode("\n", $bannedDevices) . "\n");
        }
    }
    // Redirect back to device profile if viewing one, else to list
    $redirectDevice = $_GET['device'] ?? '';
    if ($redirectDevice) {
        header("Location: admin.php?key=" . urlencode($key) . "&device=" . urlencode($redirectDevice));
    } else {
        header("Location: admin.php?key=" . urlencode($key));
    }
    exit;
}

$state = file_exists($stateFile) ? json_decode(file_get_contents($stateFile), true) : [];
$bannedDevices = file_exists($bannedFile) ? file($bannedFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
$bannedDevices = array_map('trim', $bannedDevices);

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
    // Check latest_state for inline photo
    global $state;
    if (isset($state[$deviceId]['photo_path']) && $state[$deviceId]['photo_path'] !== '—' && file_exists($state[$deviceId]['photo_path'])) {
        $data = file_get_contents($state[$deviceId]['photo_path']);
        if (strpos($data, 'data:image') === 0) return $data;
        return 'data:image/jpeg;base64,' . $data;
    }
    return null;
}

function truncateDeviceId($id, $len = 12) {
    if (strlen($id) <= $len) return $id;
    return substr($id, 0, $len) . '…';
}

// Read Visit History
$visitsLog = '/var/log/licence-app/visits.log';
if (!file_exists($visitsLog)) {
    $visitsLog = __DIR__ . '/visits.log';
}
$visits = [];
if (file_exists($visitsLog)) {
    $lines = file($visitsLog, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $v = json_decode($line, true);
        if ($v) $visits[] = $v;
    }
}
$visits = array_reverse($visits); // Show latest first

// Check if viewing a specific device profile
$viewDevice = $_GET['device'] ?? '';
$isProfileView = !empty($viewDevice) && isset($state[$viewDevice]);

?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= $isProfileView ? 'Device Profile' : 'Licence Admin Dashboard' ?></title>
    <style>
        :root {
            --primary: #007aff;
            --danger: #ff3b30;
            --success: #34c759;
            --bg: #f2f2f7;
            --card-bg: #ffffff;
            --text: #1c1c1e;
            --text-secondary: #8e8e93;
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
        .badge-warning { background: #ff9500; color: #fff; }

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
            min-width: 120px;
        }
        .stat-card .num { font-size: 28px; font-weight: 700; }
        .stat-card .label { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }

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
        .device-card .status-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            flex-shrink: 0;
        }
        .status-dot.banned { background: var(--danger); }
        .status-dot.active { background: var(--success); }

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
        .event-item .event-time {
            font-size: 11px;
            color: var(--text-secondary);
        }
        .event-item .event-type {
            font-weight: 600;
            font-size: 13px;
            margin-top: 1px;
        }
        .event-item .event-meta {
            font-size: 12px;
            color: var(--text-secondary);
            margin-top: 2px;
        }
        .event-item .event-photo {
            margin-top: 6px;
            max-width: 120px;
            border-radius: 6px;
            cursor: pointer;
        }
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
        .event-badge.app_visible { background: #8e8e93; }
        .event-badge.app_pagehide { background: #8e8e93; }
        .event-badge.app_beforeunload { background: #8e8e93; }
        .event-badge.data_cleared { background: var(--danger); }

        /* Mobile */
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
        <?php if ($isProfileView): 
            $d = $state[$viewDevice];
            $isBanned = in_array(trim($viewDevice), $bannedDevices, true);
            $photo = getDevicePhoto($viewDevice);
            
            // Filter visits for this device
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
                    <div class="meta">IP: <?=htmlspecialchars($d['ip'] ?? '—')?></div>
                    <div class="field">
                        <div class="lbl">Date of Birth</div>
                        <div class="val"><?=htmlspecialchars($d['dob'] ?? '—')?></div>
                    </div>
                    <div class="field">
                        <div class="lbl">Address</div>
                        <div class="val"><?=htmlspecialchars($d['address'] ?? '—')?></div>
                    </div>
                    <div class="field">
                        <div class="lbl">Card Number</div>
                        <div class="val"><?=htmlspecialchars($d['card'] ?? '—')?></div>
                    </div>
                    <div class="field">
                        <div class="lbl">Last Seen</div>
                        <div class="val"><?=htmlspecialchars($d['last_seen'] ?? '—')?></div>
                    </div>
                </div>
                <div class="ban-area">
                    <?php if ($isBanned): ?>
                        <span class="badge badge-banned">BANNED</span>
                        <a href="admin.php?key=<?=htmlspecialchars($key)?>&device=<?=urlencode($viewDevice)?>&action=unban" class="btn btn-success">Unban Device</a>
                    <?php else: ?>
                        <span class="badge badge-success">Active</span>
                        <a href="admin.php?key=<?=htmlspecialchars($key)?>&device=<?=urlencode($viewDevice)?>&action=ban" class="btn btn-danger">Ban Device</a>
                    <?php endif; ?>
                </div>
            </div>

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
                            elseif (strpos($ev, 'app_') === 0) $dotClass = 'info';
                            elseif ($ev === 'photo_updated') $dotClass = 'warning';
                        ?>
                        <div class="event-item">
                            <div class="event-dot <?=$dotClass?>"></div>
                            <div class="event-time"><?=htmlspecialchars($v['timestamp'] ?? '—')?></div>
                            <div class="event-type">
                                <span class="event-badge <?=htmlspecialchars($ev)?>"><?=htmlspecialchars($ev)?></span>
                                <?php if (($v['success'] ?? false) === true || $v['success'] === 'true' || $v['success'] === 1): ?>
                                    <span style="color:var(--success);font-size:11px;">✓ success</span>
                                <?php elseif ($ev === 'pin_failed'): ?>
                                    <span style="color:var(--danger);font-size:11px;">✗ failed</span>
                                <?php endif; ?>
                            </div>
                            <?php if ($v['pin_attempt'] ?? '—' !== '—'): ?>
                                <div class="event-meta">PIN attempt: <?=htmlspecialchars($v['pin_attempt'])?></div>
                            <?php endif; ?>
                            <?php if ($v['has_photo'] ?? false): 
                                $evPhoto = getDevicePhoto($viewDevice);
                                if ($evPhoto): ?>
                                <img src="<?=$evPhoto?>" class="event-photo" onclick="window.open(this.src)">
                            <?php endif; endif; ?>
                        </div>
                        <?php endforeach; ?>
                    <?php endif; ?>
                </div>
            </div>

        <?php else: 
            // === DEVICE LIST VIEW ===
            // Prepare device list from state
            $devices = [];
            if (is_array($state)) {
                foreach ($state as $id => $data) {
                    $devices[$id] = $data;
                }
            }
            // Sort by last seen (most recent first)
            uasort($devices, fn($a, $b) => strcmp($b['last_seen'] ?? '', $a['last_seen'] ?? ''));

            $totalDevices = count($devices);
            $bannedCount = count(array_filter(array_keys($devices), fn($id) => in_array(trim($id), $bannedDevices, true)));
            $successCount = count(array_filter($devices, fn($d) => ($d['success'] ?? '') === 'YES'));
            $totalVisits = count($visits);
        ?>
            <header>
                <h1>Admin Dashboard</h1>
                <div class="header-actions">
                    <label style="font-size:13px;display:flex;align-items:center;gap:4px;">
                        <input type="checkbox" id="autoRefresh" checked> Auto (5s)
                    </label>
                    <a href="admin.php?key=<?=htmlspecialchars($key)?>" class="btn btn-primary btn-sm">Refresh</a>
                </div>
            </header>

            <div class="stats-bar">
                <div class="stat-card">
                    <div class="num"><?=$totalDevices?></div>
                    <div class="label">Devices</div>
                </div>
                <div class="stat-card">
                    <div class="num" style="color:var(--success)"><?=$successCount?></div>
                    <div class="label">Successful</div>
                </div>
                <div class="stat-card">
                    <div class="num" style="color:var(--danger)"><?=$bannedCount?></div>
                    <div class="label">Banned</div>
                </div>
                <div class="stat-card">
                    <div class="num"><?=$totalVisits?></div>
                    <div class="label">Total Events</div>
                </div>
            </div>

            <div class="device-grid">
                <?php if (empty($devices)): ?>
                    <div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-secondary);background:var(--card-bg);border-radius:var(--radius);box-shadow:var(--shadow);">
                        No devices have connected yet.
                    </div>
                <?php else: ?>
                    <?php foreach ($devices as $id => $d): 
                        $isBanned = in_array(trim($id), $bannedDevices, true);
                        $photo = getDevicePhoto($id);
                    ?>
                    <a href="admin.php?key=<?=htmlspecialchars($key)?>&device=<?=urlencode($id)?>" class="device-card">
                        <?php if ($photo): ?>
                            <img src="<?=$photo?>" class="photo-thumb">
                        <?php else: ?>
                            <div class="photo-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:10px;text-align:center;">No<br>Photo</div>
                        <?php endif; ?>
                        <div class="info">
                            <div class="name"><?=htmlspecialchars($d['name'] ?? 'Unknown')?></div>
                            <div class="sub"><?=truncateDeviceId($id)?></div>
                            <div class="sub"><?=htmlspecialchars($d['last_seen'] ?? '')?></div>
                        </div>
                        <div class="status-dot <?=$isBanned?'banned':'active'?>"></div>
                    </a>
                    <?php endforeach; ?>
                <?php endif; ?>
            </div>
        <?php endif; ?>
    </div>

    <script>
        <?php if (!$isProfileView): ?>
        setInterval(() => {
            if (document.getElementById("autoRefresh").checked) {
                window.location.reload();
            }
        }, 5000);
        <?php endif; ?>
    </script>
</body>
</html>