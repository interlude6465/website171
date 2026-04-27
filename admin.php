<?php
$logFile = '/var/log/licence-app/latest.log';
$accessLog = '/var/log/licence-app/access.log';
$stateFile = '/var/log/licence-app/latest_state.json';
$bannedFile = '/var/www/licence/banned_ips.txt';

// Handle actions
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $ip = trim($_POST['ip'] ?? '');
    if (isset($_POST['ban']) && $ip) {
        file_put_contents($bannedFile, $ip . "\n", FILE_APPEND | LOCK_EX);
    } elseif (isset($_POST['unban']) && $ip) {
        $banned = file($bannedFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        $banned = array_filter($banned, fn($line) => trim($line) !== $ip);
        file_put_contents($bannedFile, implode("\n", $banned) . "\n");
    } elseif (isset($_POST['clear_logs'])) {
        file_put_contents($logFile, '');
        file_put_contents($accessLog, '');
        file_put_contents($stateFile, '[]');
    }
    header("Location: admin.php");
    exit;
}

// Read logs
$logs = file_exists($logFile) ? array_reverse(file($logFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES)) : [];

// Read banned IPs
$banned = file_exists($bannedFile) ? array_filter(file($bannedFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES)) : [];
?>
<!DOCTYPE html>
<html>
<head>
    <title>Licence Admin</title>
    <meta charset="utf-8">
    <style>
        body { font-family: system-ui, sans-serif; margin:20px; background:#f8f9fa; }
        table { width:100%; border-collapse:collapse; margin:20px 0; background:white; }
        th, td { padding:12px; border-bottom:1px solid #ddd; text-align:left; }
        th { background:#0f2b3a; color:white; }
        .ban-btn { background:#c62828; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; }
        .unban-btn { background:#1aa266; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; }
        .clear-btn { background:#435166; color:white; border:none; padding:10px 16px; border-radius:6px; cursor:pointer; font-size:15px; }
    </style>
</head>
<body>
    <h1>Licence Admin Dashboard</h1>
    <p>Live view • Auto-refreshes every 5 seconds</p>

    <form method="post" style="margin:20px 0;">
        <button type="submit" name="clear_logs" class="clear-btn" onclick="return confirm('Clear ALL logs? This cannot be undone.')">🗑️ Clear All Logs</button>
    </form>

    <h2>Current Visitors</h2>
    <table>
        <tr><th>Time</th><th>IP</th><th>Event</th><th>Name</th><th>DOB</th><th>Action</th></tr>
        <?php foreach ($logs as $line):
            $parts = explode(' | ', $line);
            $time = $parts[0] ?? '';
            $ip   = str_replace('IP: ', '', $parts[1] ?? '');
            $event = str_replace('Event: ', '', $parts[2] ?? '');
            $name  = str_replace('Name: ', '', $parts[5] ?? '');
        ?>
        <tr>
            <td><?=htmlspecialchars($time)?></td>
            <td><?=htmlspecialchars($ip)?></td>
            <td><?=htmlspecialchars($event)?></td>
            <td><?=htmlspecialchars($name)?></td>
            <td>
                <form method="post" style="display:inline;">
                    <input type="hidden" name="ip" value="<?=htmlspecialchars($ip)?>">
                    <button type="submit" name="ban" class="ban-btn">Ban IP</button>
                </form>
            </td>
        </tr>
        <?php endforeach; ?>
    </table>

    <h2>Banned IPs (<?=count($banned)?>)</h2>
    <table>
        <tr><th>IP</th><th>Action</th></tr>
        <?php foreach ($banned as $b): ?>
        <tr>
            <td><?=htmlspecialchars($b)?></td>
            <td>
                <form method="post" style="display:inline;">
                    <input type="hidden" name="ip" value="<?=htmlspecialchars($b)?>">
                    <button type="submit" name="unban" class="unban-btn">Unban</button>
                </form>
            </td>
        </tr>
        <?php endforeach; ?>
    </table>

    <script>
        setTimeout(() => location.reload(), 5000);
    </script>
</body>
</html>
