<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET");
header('Content-Type: application/json');

$deviceId = $_GET['deviceId'] ?? '';
if (empty($deviceId)) {
    echo json_encode(['hasPhoto' => false]);
    exit;
}

$photoFile = __DIR__ . '/photos/' . $deviceId . '.jpg';
echo json_encode(['hasPhoto' => file_exists($photoFile)]);
?>
