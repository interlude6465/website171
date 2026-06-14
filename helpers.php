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
