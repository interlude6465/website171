#!/usr/bin/env python3
with open('core_components.js', 'r') as f:
    content = f.read()

# 1. Replace revealPage to always show PIN
old_reveal = '''    core.revealPage = function() {
        var antiLeak = document.getElementById('anti-leak');
        if (antiLeak) antiLeak.parentNode.removeChild(antiLeak);
        var loader = document.getElementById('early-loader');
        if (loader) loader.parentNode.removeChild(loader);

        // Skip PIN overlay if user unlocked within the last 7 days
        var pinOverlay = document.getElementById('pinOverlayFS');
        var unlockedUntil = 0;
        try { unlockedUntil = parseInt(localStorage.getItem('pinUnlockedUntil') || '0', 10); } catch(e) {}
        if (unlockedUntil && Date.now() < unlockedUntil) {
            if (pinOverlay) { pinOverlay.style.display = 'none'; }
            var home = document.getElementById('homeScreen');
            if (home) home.classList.remove('hidden');
        } else {
            if (pinOverlay) pinOverlay.classList.remove('pin-hidden');
        }
    };'''

new_reveal = '''    core.revealPage = function() {
        var antiLeak = document.getElementById('anti-leak');
        if (antiLeak) antiLeak.parentNode.removeChild(antiLeak);
        var loader = document.getElementById('early-loader');
        if (loader) loader.parentNode.removeChild(loader);

        // Always show the PIN overlay (no 7-day skip)
        var pinOverlay = document.getElementById('pinOverlayFS');
        if (pinOverlay) {
            pinOverlay.style.display = '';
            pinOverlay.classList.remove('pin-hidden');
        }
        // Ensure home screen remains hidden until PIN is entered
        var home = document.getElementById('homeScreen');
        if (home) home.classList.add('hidden');
    };'''

if old_reveal not in content:
    print('ERROR: Could not find revealPage pattern')
    exit(1)

content = content.replace(old_reveal, new_reveal)
print('revealPage replaced successfully')

# 2. Remove the line that sets pinUnlockedUntil in tryUnlock
old_try = "      try { localStorage.setItem('pinUnlockedUntil', String(Date.now() + 7 * 24 * 60 * 60 * 1000)); } catch(e) {}"

if old_try not in content:
    print('ERROR: Could not find tryUnlock localStorage line')
    exit(1)

content = content.replace(old_try + '\n', '')
print('tryUnlock localStorage line removed successfully')

# Verify no more pinUnlockedUntil references
remaining = content.count('pinUnlockedUntil')
print(f'Remaining pinUnlockedUntil occurrences: {remaining}')

with open('core_components.js', 'w') as f:
    f.write(content)

print('File written successfully')