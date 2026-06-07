<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Requested-With');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/helpers.php';

$configFile = __DIR__ . '/.admin_config.json';
$config = safeReadJson($configFile);
$pin = $config['licence_pin'] ?? '457511';
echo json_encode(['pin' => trim($pin), 'version' => time()]);
?>