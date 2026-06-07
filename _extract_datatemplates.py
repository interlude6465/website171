"""Try a more lenient matching strategy — search every method's strings list for our tags."""
import os, sys, re, json
os.environ['LOGURU_LEVEL'] = 'WARNING'
from loguru import logger
logger.remove()
logger.add(sys.stderr, level='WARNING')
from androguard.core.dex import DEX

DEX_FILES = ['apk_extracted/classes.dex', 'apk_extracted/classes2.dex']
results = {}

target_prefixes = [
    'EnlargedQrCodeState(', 'QrCodeData(', 'QrCodeScannerState(',
    'GetQrCodeRequest(', 'GetQrCodeResponse(', 'GetQrCodeWithHashResponse(',
    'VerifyQrCodeRequest(', 'VerifyQrCodeError(', 'VerifyQrCodeResult(',
    'QrCodeTimeoutError(', 'QrCodeError(', 'QrCodeVerifyResult(',
    'LoadQrCodeSuccess(', 'LoadQrCodeError(',
    'NavigateToEnlargedQrCode(', 'PullDownToRefreshQrCode(',
    'OnConsentQRCodeTapped(', 'OnQrCodeScanned(', 'QrCodeDeepLink(',
    'ValidationQrCodeResponse(',
    'LicenceState(', 'DigitalDriverLicence(', 'DriverLicence(',
    'LicenceRecord(', 'LicenceData(',
    'Condition(licenceCondition', 'CredentialDetails(', 'ValidationDriverLicence(',
    'ValidationLicenceHolding(', 'TranslateDigitalLicenceResponse(',
    'UpdateDDLPreferenceRequest(', 'ShowHideLicenceCardNumber(',
    'BiometricEnableState(',
]

for dex_path in DEX_FILES:
    print(f'[load] {dex_path}', file=sys.stderr)
    with open(dex_path, 'rb') as f:
        d = DEX(f.read())
    for c in d.get_classes():
        for m in c.get_methods():
            code = m.get_code()
            if not code: continue
            strs = []
            for ins in code.get_bc().get_instructions():
                op = ins.get_name()
                if 'const-string' in op:
                    mo = re.search(r'"((?:[^"\\]|\\.)*)"', ins.get_output(), re.DOTALL)
                    if mo:
                        strs.append(mo.group(1))
            if len(strs) < 2: continue
            # search for any of our prefixes among the strings
            for s_idx, s in enumerate(strs):
                for p in target_prefixes:
                    if p in s:
                        key = p.rstrip('(')
                        cls_name = c.get_name()
                        # slice from match through end
                        results.setdefault(key, []).append((cls_name, m.get_name(), strs[s_idx:s_idx+40]))
                        break

# emit
print(f'\n[hits in {len(results)} groups]', file=sys.stderr)
for k in sorted(results.keys()):
    print(f"\n========= {k} =========")
    for cls, mname, strs in results[k][:2]:
        print(f"  source: {cls}#{mname}")
        for s in strs:
            print(f"    {s!r}")

out_json = {}
for k, hits in results.items():
    out_json[k] = [{"class": cls, "method": mname, "strings": strs} for cls, mname, strs in hits[:3]]
with open('apk_loot/decompiled/_kotlin_data_classes.json', 'w', encoding='utf-8') as f:
    json.dump(out_json, f, indent=2)
print(f'\n[wrote] {len(out_json)} groups to JSON', file=sys.stderr)
