<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Requested-With');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$configFile = __DIR__ . '/.admin_config.json';
$config = file_exists($configFile) ? json_decode(file_get_contents($configFile), true) : [];
$pin = $config['licence_pin'] ?? '4575';
echo json_encode(['pin' => trim($pin), 'version' => time()]);
?>