<?php
$key = $_GET['key'] ?? '';
if ($key !== 'admin123') {
    die("Unauthorized");
}

$stateFile = '/var/log/licence-app/latest_state.json';
$bannedFile = '/var/www/licence/banned_devices.txt';
$approvedFile = '/var/www/licence/approved_devices.txt';

// Handle Actions
$action = $_GET['action'] ?? '';
$device = $_GET['device'] ?? '';

if ($action && $device) {
    if ($action === 'ban') {
        $bannedDevices = file_exists($bannedFile) ? file($bannedFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
        if (!in_array($device, $bannedDevices)) {
            $bannedDevices[] = $device;
            file_put_contents($bannedFile, implode("\n", $bannedDevices) . "\n");
        }
    } elseif ($action === 'unban') {
        if (file_exists($bannedFile)) {
            $bannedDevices = file($bannedFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            $bannedDevices = array_filter($bannedDevices, fn($d) => $d !== $device);
            file_put_contents($bannedFile, implode("\n", $bannedDevices) . "\n");
        }
    }
    header("Location: admin.php?key=" . urlencode($key));
    exit;
}

$state = file_exists($stateFile) ? json_decode(file_get_contents($stateFile), true) : [];
$bannedDevices = file_exists($bannedFile) ? file($bannedFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];

$successDevices = [];
$failedDevices = [];

foreach ($state as $id => $data) {
    if ($data['success'] === 'YES') {
        $successDevices[$id] = $data;
    } else {
        $failedDevices[$id] = $data;
    }
}

// Sort by last seen
uasort($successDevices, fn($a, $b) => strcmp($b['last_seen'], $a['last_seen']));
uasort($failedDevices, fn($a, $b) => strcmp($b['last_seen'], $a['last_seen']));

function getPhotoBase64($path) {
    if ($path && $path !== '—' && file_exists($path)) {
        return file_get_contents($path);
    }
    return 'https://via.placeholder.com/50x50.png?text=No+Photo';
}
?>
<!DOCTYPE html>
<html>
<head>
    <title>Licence Admin Dashboard</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 20px; background: #f4f7f6; color: #333; }
        h1, h2 { color: #0f2b3a; }
        .container { max-width: 1200px; margin: 0 auto; }
        .card { background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); padding: 20px; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { text-align: left; padding: 12px; border-bottom: 1px solid #eee; font-size: 14px; }
        th { background: #f8f9fa; font-weight: 600; color: #666; }
        .photo-thumb { width: 50px; height: 50px; border-radius: 4px; object-fit: cover; background: #eee; }
        .btn { padding: 6px 12px; border-radius: 4px; border: none; cursor: pointer; font-size: 12px; font-weight: 600; text-decoration: none; display: inline-block; }
        .btn-ban { background: #ff4d4f; color: white; }
        .btn-unban { background: #52c41a; color: white; }
        .btn-refresh { background: #1890ff; color: white; margin-bottom: 20px; padding: 10px 20px; font-size: 14px; }
        .deviceId { font-family: monospace; color: #888; font-size: 12px; }
        .status-badge { padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; text-transform: uppercase; }
        .status-success { background: #e6f7ff; color: #1890ff; border: 1px solid #91d5ff; }
        .status-failed { background: #fff1f0; color: #ff4d4f; border: 1px solid #ffa39e; }
        .status-banned { background: #000; color: #fff; }
        .collapsible { cursor: pointer; display: flex; align-items: center; justify-content: space-between; }
        .collapsible:after { content: '\002B'; font-weight: bold; float: right; margin-left: 5px; }
        .active:after { content: "\2212"; }
        .content { display: none; overflow: hidden; }
        .show { display: block; }
        .refresh-row { display: flex; align-items: center; gap: 15px; margin-bottom: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="refresh-row">
            <h1>Licence Admin Dashboard</h1>
            <a href="admin.php?key=<?=htmlspecialchars($key)?>" class="btn btn-refresh">Refresh Now</a>
            <label><input type="checkbox" id="autoRefresh" checked> Auto-refresh (5s)</label>
        </div>

        <div class="card">
            <h2>Success Section (<?=count($successDevices)?> devices)</h2>
            <table>
                <thead>
                    <tr>
                        <th>Photo</th>
                        <th>Device Info</th>
                        <th>User Details</th>
                        <th>Last Seen</th>
                        <th>Attempts</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($successDevices as $id => $d): 
                        $isBanned = in_array($id, $bannedDevices);
                    ?>
                    <tr>
                        <td><img src="<?=getPhotoBase64($d['photo_path'])?>" class="photo-thumb"></td>
                        <td>
                            <div class="deviceId" title="<?=htmlspecialchars($id)?>"><?=htmlspecialchars(substr($id, 0, 20))?>...</div>
                            <div style="font-size: 12px;"><?=htmlspecialchars($d['ip'])?></div>
                        </td>
                        <td>
                            <strong><?=htmlspecialchars($d['name'])?></strong><br>
                            <span style="font-size: 12px; color: #666;"><?=htmlspecialchars($d['dob'])?></span><br>
                            <span style="font-size: 11px; color: #888;"><?=htmlspecialchars($d['address'])?></span>
                        </td>
                        <td><?=htmlspecialchars($d['last_seen'])?></td>
                        <td><?=htmlspecialchars($d['attempt_count'] ?? 0)?></td>
                        <td>
                            <?php if ($isBanned): ?>
                                <span class="status-badge status-banned">BANNED</span>
                                <a href="admin.php?key=<?=htmlspecialchars($key)?>&action=unban&device=<?=htmlspecialchars($id)?>" class="btn btn-unban">Unban</a>
                            <?php else: ?>
                                <a href="admin.php?key=<?=htmlspecialchars($key)?>&action=ban&device=<?=htmlspecialchars($id)?>" class="btn btn-ban">Ban Device</a>
                            <?php endif; ?>
                        </td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>

        <div class="card">
            <h2 class="collapsible" onclick="toggleFailed()">Failed Section (<?=count($failedDevices)?> devices)</h2>
            <div id="failedContent" class="content">
                <table>
                    <thead>
                        <tr>
                            <th>Photo</th>
                            <th>Device Info</th>
                            <th>Last Seen</th>
                            <th>Attempts</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($failedDevices as $id => $d): 
                            $isBanned = in_array($id, $bannedDevices);
                        ?>
                        <tr>
                            <td><img src="<?=getPhotoBase64($d['photo_path'])?>" class="photo-thumb"></td>
                            <td>
                                <div class="deviceId" title="<?=htmlspecialchars($id)?>"><?=htmlspecialchars(substr($id, 0, 20))?>...</div>
                                <div style="font-size: 12px;"><?=htmlspecialchars($d['ip'])?></div>
                            </td>
                            <td><?=htmlspecialchars($d['last_seen'])?></td>
                            <td><?=htmlspecialchars($d['attempt_count'] ?? 0)?></td>
                            <td>
                                <?php if ($isBanned): ?>
                                    <span class="status-badge status-banned">BANNED</span>
                                    <a href="admin.php?key=<?=htmlspecialchars($key)?>&action=unban&device=<?=htmlspecialchars($id)?>" class="btn btn-unban">Unban</a>
                                <?php else: ?>
                                    <a href="admin.php?key=<?=htmlspecialchars($key)?>&action=ban&device=<?=htmlspecialchars($id)?>" class="btn btn-ban">Ban Device</a>
                                <?php endif; ?>
                            </td>
                        </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <script>
        function toggleFailed() {
            const content = document.getElementById("failedContent");
            content.classList.toggle("show");
            document.querySelector(".collapsible").classList.toggle("active");
        }

        setInterval(() => {
            if (document.getElementById("autoRefresh").checked) {
                window.location.reload();
            }
        }, 5000);
    </script>
</body>
</html>
