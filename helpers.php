<?php
/**
 * helpers.php - Centralized File I/O with locking and atomic writes
 */

function safeReadJson($path) {
    if (!file_exists($path)) return [];
    $fp = @fopen($path, 'r');
    if (!$fp) return [];
    
    flock($fp, LOCK_SH);
    $content = '';
    while (!feof($fp)) {
        $content .= fread($fp, 8192);
    }
    flock($fp, LOCK_UN);
    fclose($fp);
    
    $data = json_decode($content, true);
    return is_array($data) ? $data : [];
}

function safeWriteJson($path, $data, $backup = false) {
    $json = json_encode($data, JSON_PRETTY_PRINT);
    if ($json === false) return false;
    
    if ($backup && file_exists($path)) {
        @copy($path, $path . '.bak');
    }
    
    $tmpPath = $path . '.' . uniqid() . '.tmp';
    if (@file_put_contents($tmpPath, $json, LOCK_EX) === false) {
        return false;
    }
    
    // Atomic rename
    if (!@rename($tmpPath, $path)) {
        @unlink($tmpPath);
        return false;
    }
    return true;
}

// Acquire a held exclusive lock for serializing read-modify-write sequences
// (e.g. the shared latest_state.json). Returns the open handle (keep it in
// scope; the lock releases when the handle is closed or the script ends), or
// null if the lock could not be taken.
function acquireExclusiveLock($lockPath) {
    $fp = @fopen($lockPath, 'c');
    if (!$fp) return null;
    if (!@flock($fp, LOCK_EX)) { @fclose($fp); return null; }
    return $fp;
}

function safeReadRaw($path) {
    if (!file_exists($path)) return null;
    $fp = @fopen($path, 'r');
    if (!$fp) return null;

    flock($fp, LOCK_SH);
    $content = '';
    while (!feof($fp)) {
        $content .= fread($fp, 8192);
    }
    flock($fp, LOCK_UN);
    fclose($fp);
    return $content;
}

function safeWriteRaw($path, $content) {
    $tmpPath = $path . '.' . uniqid() . '.tmp';
    if (@file_put_contents($tmpPath, $content, LOCK_EX) === false) {
        return false;
    }
    if (!@rename($tmpPath, $path)) {
        @unlink($tmpPath);
        return false;
    }
    return true;
}

function safeAppend($path, $content) {
    return @file_put_contents($path, $content, FILE_APPEND | LOCK_EX) !== false;
}

function safeReadList($path) {
    if (!file_exists($path)) return [];
    $fp = @fopen($path, 'r');
    if (!$fp) return [];
    
    flock($fp, LOCK_SH);
    $lines = [];
    while (($line = fgets($fp)) !== false) {
        $trimmed = trim($line);
        if ($trimmed !== '') {
            $lines[] = $trimmed;
        }
    }
    flock($fp, LOCK_UN);
    fclose($fp);
    return array_values(array_unique($lines));
}

function normalizeBanReason($reason, $maxLen = 1000) {
    $reason = trim((string)$reason);
    $reason = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $reason);
    if (function_exists('mb_substr')) {
        return mb_substr($reason, 0, $maxLen);
    }
    return substr($reason, 0, $maxLen);
}

function banReasonsFilePath() {
    return __DIR__ . '/ban_reasons.json';
}

function banReasonKey($type, $value) {
    $type = preg_replace('/[^a-z_]/', '', strtolower((string)$type));
    $value = trim((string)$value);
    if ($type === '' || $value === '') return '';
    return $type . ':' . $value;
}

function fingerprintBanReasonKey($canvasHash, $webGLRenderer) {
    $canvasHash = trim((string)$canvasHash);
    $webGLRenderer = trim((string)$webGLRenderer);
    if ($canvasHash === '' && $webGLRenderer === '') return '';
    return 'fingerprint:' . hash('sha256', strtolower($canvasHash) . '|' . strtolower($webGLRenderer));
}

function banReasonFingerprintParts($fingerprint) {
    if (is_string($fingerprint) && $fingerprint !== '') {
        $decoded = json_decode($fingerprint, true);
        $fingerprint = is_array($decoded) ? $decoded : [];
    }
    if (!is_array($fingerprint)) $fingerprint = [];
    return [
        'canvasHash' => (string)($fingerprint['canvasHash'] ?? ''),
        'webGLRenderer' => (string)($fingerprint['webGLRenderer'] ?? '')
    ];
}

function saveBanReason($type, $value, $reason, $file = null) {
    $reason = normalizeBanReason($reason);
    $key = banReasonKey($type, $value);
    if ($key === '' || $reason === '') return false;

    $file = $file ?: banReasonsFilePath();
    $reasons = safeReadJson($file);
    if (!is_array($reasons)) $reasons = [];
    $reasons[$key] = [
        'type' => strtolower((string)$type),
        'value' => (string)$value,
        'reason' => $reason,
        'updated_at' => date('Y-m-d H:i:s')
    ];
    return safeWriteJson($file, $reasons, true);
}

function saveFingerprintBanReason($canvasHash, $webGLRenderer, $reason, $file = null) {
    $reason = normalizeBanReason($reason);
    $key = fingerprintBanReasonKey($canvasHash, $webGLRenderer);
    if ($key === '' || $reason === '') return false;

    $file = $file ?: banReasonsFilePath();
    $reasons = safeReadJson($file);
    if (!is_array($reasons)) $reasons = [];
    $reasons[$key] = [
        'type' => 'fingerprint',
        'canvasHash' => (string)$canvasHash,
        'webGLRenderer' => (string)$webGLRenderer,
        'reason' => $reason,
        'updated_at' => date('Y-m-d H:i:s')
    ];
    return safeWriteJson($file, $reasons, true);
}

function clearBanReason($type, $value, $file = null) {
    $key = banReasonKey($type, $value);
    if ($key === '') return false;

    $file = $file ?: banReasonsFilePath();
    $reasons = safeReadJson($file);
    if (!is_array($reasons) || !isset($reasons[$key])) return true;
    unset($reasons[$key]);
    return safeWriteJson($file, $reasons, true);
}

function clearFingerprintBanReason($canvasHash, $webGLRenderer, $file = null) {
    $key = fingerprintBanReasonKey($canvasHash, $webGLRenderer);
    if ($key === '') return false;

    $file = $file ?: banReasonsFilePath();
    $reasons = safeReadJson($file);
    if (!is_array($reasons) || !isset($reasons[$key])) return true;
    unset($reasons[$key]);
    return safeWriteJson($file, $reasons, true);
}

function findBanReason($deviceId = '', $ip = '', $fingerprint = null, $file = null) {
    $file = $file ?: banReasonsFilePath();
    $reasons = safeReadJson($file);
    if (!is_array($reasons)) $reasons = [];

    $deviceKey = banReasonKey('device', $deviceId);
    if ($deviceKey !== '' && !empty($reasons[$deviceKey]['reason'])) {
        return (string)$reasons[$deviceKey]['reason'];
    }

    $ipKey = banReasonKey('ip', $ip);
    if ($ipKey !== '' && !empty($reasons[$ipKey]['reason'])) {
        return (string)$reasons[$ipKey]['reason'];
    }

    $fp = banReasonFingerprintParts($fingerprint);
    $fpKey = fingerprintBanReasonKey($fp['canvasHash'], $fp['webGLRenderer']);
    if ($fpKey !== '' && !empty($reasons[$fpKey]['reason'])) {
        return (string)$reasons[$fpKey]['reason'];
    }

    $bannedFps = safeReadJson(__DIR__ . '/banned_fingerprints.json');
    if (is_array($bannedFps) && ($fp['canvasHash'] !== '' || $fp['webGLRenderer'] !== '')) {
        foreach ($bannedFps as $entry) {
            if (!is_array($entry)) continue;
            $entryCanvas = (string)($entry['canvasHash'] ?? '');
            $entryRenderer = (string)($entry['webGLRenderer'] ?? '');
            $matchesCanvas = $fp['canvasHash'] !== '' && $entryCanvas !== '' && strtolower($fp['canvasHash']) === strtolower($entryCanvas);
            $matchesRenderer = $fp['webGLRenderer'] !== '' && $entryRenderer !== '' && strtolower($fp['webGLRenderer']) === strtolower($entryRenderer);
            if ($matchesCanvas || $matchesRenderer) {
                if (!empty($entry['ban_reason'])) return (string)$entry['ban_reason'];
                $entryKey = fingerprintBanReasonKey($entryCanvas, $entryRenderer);
                if ($entryKey !== '' && !empty($reasons[$entryKey]['reason'])) {
                    return (string)$reasons[$entryKey]['reason'];
                }
            }
        }
    }

    if ($ip !== '') {
        $state = safeReadJson(__DIR__ . '/latest_state.json');
        $bannedDevices = safeReadList(__DIR__ . '/banned_devices.txt');
        foreach ($bannedDevices as $bannedDevice) {
            if (isset($state[$bannedDevice]) && ($state[$bannedDevice]['ip'] ?? '') === $ip) {
                $linkedKey = banReasonKey('device', $bannedDevice);
                if ($linkedKey !== '' && !empty($reasons[$linkedKey]['reason'])) {
                    return (string)$reasons[$linkedKey]['reason'];
                }
            }
        }
    }

    return '';
}

function safeWriteList($path, $lines, $backup = false) {
    if ($backup && file_exists($path)) {
        @copy($path, $path . '.bak');
    }
    
    $lines = array_map('trim', $lines);
    $lines = array_filter($lines, fn($l) => $l !== '');
    $content = implode("\n", array_unique($lines)) . "\n";
    
    $tmpPath = $path . '.' . uniqid() . '.tmp';
    if (@file_put_contents($tmpPath, $content, LOCK_EX) === false) {
        return false;
    }
    
    if (!@rename($tmpPath, $path)) {
        @unlink($tmpPath);
        return false;
    }
    return true;
}

function backupFile($path) {
    if (file_exists($path)) {
        return @copy($path, $path . '.bak');
    }
    return false;
}
