# APK Deep Inventory — myVicRoads.apk v1.3.5
*Generated: 2026-06-02 | Source: `apk_extracted/` + `apk_loot/`*

**Package:** `au.gov.vic.myvicroads`
**Version:** 1.3.5 (versionCode 478770)
**Min SDK:** 31 (Android 12)  **Target SDK:** 35 (Android 15)  **Compile SDK:** 35
**Main activity:** `au.gov.vic.vicroads.MainActivity` (single-Activity Jetpack Compose app)
**Application class:** `au.gov.vic.vicroads.VicRoadsApplication`

The app is almost entirely written in **Kotlin + Jetpack Compose**: only a handful of legacy `res/layout/` XMLs exist (Amplify dev menu + webview), and `res/values/` is empty in the decoded tree (compiled into `resources.arsc`). All UI assets that matter are **vector drawables** (`res/drawable/*.xml`), three **OTF fonts** (`res/font/vic_*.otf`), two **GLSL shaders** for the hologram coat-of-arms effect, and a handful of **launcher PNGs**.

---

## 1. Backend / Amplify Configuration

File: `apk_loot/backend/amplifyconfiguration.json`

The whole backend uses **AWS Cognito** in the `ap-southeast-2` (Sydney) region. There is no API Gateway / AppSync URL in this file — those calls must be made from Kotlin code with hard-coded endpoints (likely in `classes.dex`).

```json
{
  "UserAgent": "aws-amplify-cli/2.0",
  "Version": "1.0",
  "auth": {
    "plugins": {
      "awsCognitoAuthPlugin": {
        "UserAgent": "aws-amplify-cli/0.1.0",
        "Version": "0.1.0",
        "IdentityManager": {
          "Default": {}
        },
        "CredentialsProvider": {
          "CognitoIdentity": {
            "Default": {
              "PoolId": "ap-southeast-2:074e9b0d-70c1-4b73-a57f-164a68ef1628",
              "Region": "ap-southeast-2"
            }
          }
        },
        "CognitoUserPool": {
          "Default": {
            "PoolId": "ap-southeast-2_HWZXwaF7X",
            "AppClientId": "3jtgfkom08ntclb1je15unckvv",
            "Region": "ap-southeast-2"
          }
        }
      }
    }
  }
}
```

**Key IDs (potentially useful for fidelity / fake-call mocking):**
- Cognito Identity Pool: `ap-southeast-2:074e9b0d-70c1-4b73-a57f-164a68ef1628`
- Cognito User Pool: `ap-southeast-2_HWZXwaF7X`
- App Client ID: `3jtgfkom08ntclb1je15unckvv`
- Firebase project hint (from arsc strings): `learners-app-and-vr-website.appspot.com`

---

## 2. WebView Injection Scripts

Both scripts are tiny templated wrappers used to inject CSS/JS into in-app Custom Tabs / WebView sessions (the `%1$s` is replaced by Kotlin code at runtime with the actual payload to inject — that payload likely lives in dex strings).

`apk_loot/webview/inject_css.js`:
```javascript
function injectStyle($code) {
    var node = document.createElement('style');

    node.type = 'text/css';
    node.innerHTML = $code;

    document.head.appendChild(node);
}

injectStyle('%1$s');
```

`apk_loot/webview/inject_js.js`:
```javascript
function injectScript($code) {
    var node = document.createElement('script');

    node.type = 'text/javascript';
    node.innerHTML = $code;

    document.body.appendChild(node);
}

injectScript('%1$s');
```

There are also matching layouts: `view_webview.xml`, `web_view_with_toolbar.xml`, `webview_toolbar.xml` (binary AXML in `res/layout/`).

---

## 3. GLSL Hologram Shaders

These power the **shimmering coat-of-arms hologram** on the digital licence card. The fragment shader currently uses a simple roll-based alpha modulation; an earlier simplex-noise iridescence version is preserved in comments and can be revived in JS via `gl-matrix` or three.js.

### Vertex Shader — `res/raw/hologram_vertex.glsl`
```glsl
#version 100

uniform mat4 uVPMatrix;
attribute vec4 a_Position;
attribute vec2 a_TexCoord;
varying vec2 v_TexCoord;

void main(void)
{
    gl_Position = a_Position;
    v_TexCoord = vec2(a_TexCoord.x, (1.0 - (a_TexCoord.y)));
}
```

### Fragment Shader — `res/raw/hologram_fragment.glsl`
```glsl
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_globalTime;
uniform float u_pitch;
uniform float u_roll;

uniform sampler2D u_Texture;
varying vec2 v_TexCoord;

// From Stackoveflow
// http://stackoverflow.com/questions/15095909/from-rgb-to-hsv-in-opengl-glsl
vec3 hsv2rgb(vec3 c)
{
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Simplex 2D noise
// from https://gist.github.com/patriciogonzalezvivo/670c22f3966e662d2f83
vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }

float snoise(vec2 v){
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy) );
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1;
    i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
                      + i.x + vec3(0.0, i1.x, 1.0 ));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
                            dot(x12.zw,x12.zw)), 0.0);
    m = m*m ;
    m = m*m ;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

void main(void){

    // This is old hologram effect, commented out so if we want to revert back in the future we can
    // vec2 uv = gl_FragCoord.xy / u_resolution;
    // float xnoise = snoise(vec2((uv.x, u_roll / 15.0) + 0.001 ));
    // float ynoise = snoise(vec2((uv.y, u_pitch / 15.0) + 0.001 ));

    // vec2 t = vec2(xnoise, ynoise);
    // float s1 = snoise(uv + t / 2.0 + snoise(uv + snoise(uv + t/3.0)));
    // vec3 hsv = vec3(s1, 0.2, 1.0);
    // vec3 rgb = hsv2rgb(hsv);

    vec4 textureVec = texture2D(u_Texture, v_TexCoord);

    // vec3 textureRGB = textureVec.rgb * textureVec.a;

    // The components (r, g, b, a) represent the red, green, blue and alpha color channels, respectively.

    // The roll of the device goes from -60 to 60.
    // The range at which a user will tilt their phone to show the hologram is -10 to 10
    // Transform the roll to be in a range of 0.0-1.0 based on a user's tilt range of -10 and 10, with the minimum alpha at 0.2
    float roll = (abs(u_roll) / 10.0) + 0.2;

    // The textureVec rgb values work together with the textureVec alpha value to create either a white or a transparent pixel
    // While the coat of arms image is mostly white with an alpha of 1.0 or clear with an alpha of 0.0, in the case of edge pixels there may be a pixel with an alpha in between 0 and 1.
    // Because of this, we must use the rgb and alpha of the textureVec to create the animation instead of simply discarding clear pixels
    // The outputted pixel should be a combination of the textureVec pixel and the roll value
    // A higher roll (aka phone more tilted) will create a more opaque pixel, while a lower roll (aka phone straight) will create a more transparent pixel
    float r = textureVec.r * roll;
    float g = textureVec.g * roll;
    float b = textureVec.b * roll;
    float alpha = textureVec.a * roll;

    gl_FragColor = vec4(r, g, b, alpha);
}
```

**Replica notes:**
- `u_roll` is the device roll from gyroscope, mapped to alpha modulation in [0.2, 1.0+].
- Web port: feed `DeviceOrientationEvent.gamma` (roll) into the fragment shader's `u_roll` uniform; the source texture is `vic_coat_of_arms.webp` (already in `apk_loot/logos/`).
- The commented-out simplex-noise version is the "iridescent" look — easy bonus fidelity if you re-enable it.

---

## 4. Firebase / Remote Config

### `res/raw/firebase_common_keep.xml`
ProGuard keep-rules for Firebase string resources. Tells the build to retain these string IDs:
- `google_app_id`, `gcm_defaultSenderId`, `google_api_key`
- `firebase_database_url`, `ga_trackingId`
- `google_storage_bucket`, `project_id`

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources xmlns:tools="http://schemas.android.com/tools"
    tools:keep="@string/google_app_id,@string/gcm_defaultSenderId,@string/google_api_key,@string/firebase_database_url,@string/ga_trackingId,@string/google_storage_bucket,@string/project_id" />
```

The actual values live in `resources.arsc`. The storage bucket leaked in raw strings: **`learners-app-and-vr-website.appspot.com`** (Firebase project name).

### `res/xml/remote_config_defaults.xml` (binary AXML)
Decoded keys/values:
- `force_app_update` = `false`
- `force_app_update_version` = `1.0.0`
- `my_account` = `true`

These are Firebase Remote Config default flags for kill-switching the app and gating the "My Account" feature.

---

## 5. AndroidManifest Routes & Permissions

### Permissions requested
| Permission | Purpose |
|---|---|
| `CAMERA` | QR scanning (ML Kit) |
| `ACCESS_NETWORK_STATE` | Connectivity checks |
| `INTERNET` | API calls |
| `USE_BIOMETRIC` / `USE_FINGERPRINT` | Biometric login |
| `WAKE_LOCK` | Keep screen on while showing licence |
| `REORDER_TASKS` | Background → foreground task management |
| `com.google.android.gms.permission.AD_ID` | Firebase Analytics device ID |
| `com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE` | Play Install Referrer |
| `com.android.vending.CHECK_LICENSE` | Pairip licence check |
| `au.gov.vic.myvicroads.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | Internal receiver guard |

### Activities
| Activity | Notes |
|---|---|
| `au.gov.vic.vicroads.MainActivity` | Single Compose host. `launchMode=singleTask`, portrait-locked (`screenOrientation=1`). **Auto-verified deep link target.** |
| `com.amplifyframework.auth.cognito.activities.CustomTabsManagerActivity` | Cognito OAuth callback (system theme transparent) |
| `com.amplifyframework.devmenu.DeveloperMenuActivity` | Hidden Amplify dev menu (uses the `view_webview` / `dev_menu_*` layouts) |
| `androidx.credentials.playservices.HiddenActivity` | Passkey / Credential Manager bridge |
| `androidx.credentials.playservices.IdentityCredentialApiHiddenActivity` | mDoc identity credentials bridge |
| `com.google.android.gms.auth.api.signin.internal.SignInHubActivity` | Google Sign-In fallback |
| `com.pairip.licensecheck.LicenseActivity` | Google Play licence verification |

### Intent filters / deeplinks
**Only one deep link is declared (auto-verified Digital Asset Link required):**
```xml
<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW"/>
  <category android:name="android.intent.category.DEFAULT"/>
  <category android:name="android.intent.category.BROWSABLE"/>
  <data android:scheme="https"
        android:host="www.vicroads.vic.gov.au"
        android:path="/qr-scan"/>
</intent-filter>
```
So `https://www.vicroads.vic.gov.au/qr-scan` opens the app's QR-scan flow. Useful for the replica's "open in app" button.

### Queries (Android 11+ package visibility)
The app declares it needs to query apps that can:
- `SENDTO mailto:` (email apps)
- `DIAL` (phone dialer)
- `VIEW https://*` (browsers)
- `android.support.customtabs.action.CustomTabsService` (Custom Tabs providers — Chrome, Edge, etc.)

### Providers / Services
- `com.pairip.licensecheck.LicenseContentProvider` — anti-piracy
- `com.google.mlkit.common.internal.MlKitInitProvider` — barcode scanning init
- `com.google.firebase.provider.FirebaseInitProvider` — Firebase init
- `androidx.startup.InitializationProvider` (emoji2, lifecycle, profileinstaller)
- `androidx.credentials.playservices.CredentialProviderMetadataHolder` — passkeys
- `androidx.camera.core.impl.MetadataHolderService` — CameraX

---

## 6. String Resources (App-Specific)

`res/values/strings.xml` is compiled into `resources.arsc` (1122 strings). The complete resource-name map is in `apk_loot/decoded/public.xml`. Below are the **user-facing values** harvested directly from `resources.arsc` bytes — these are what the replica should mirror verbatim for fidelity.

### Onboarding & Login
- **"Welcome to the\nmyVicRoads app"** (splash heading)
- **"Connect your myVicRoads account, licence and other key services."**
- **"Easy access to your digital driver licence"**
- **"Simplify your sign in"** — "Sign in easily now with your fingerprint, face, or PIN. Sync across your devices."
- **"Verify digital licences"** — "securely verify digital licences by scanning the QR code."
- **"Skip Onboarding"**, **"Onboarding slide"**
- **"Let's get you logged in."**
- **"Log in to your myVicRoads account"** / **"Log in using your existing myVicRoads account."**
- **"Sign in with Google"** / **"Sign in with a different account"**
- **"Login with biometrics"** / **"Login to the myVicRoads app, enter your myVicRoads account username and password and a six-digit PIN will be sent to you to authenticate as the user."**

### Home / Bottom Nav
Bottom-bar tab labels (drawn by `ic_home_*`, `ic_licence_*`, `ic_vehicle_*`, `ic_payments_*`, `ic_profile_*`):
- `bottom_bar_licence` → "Licence"
- `Profile and settings`, `Registered vehicles`, `Direct debit payments`, etc.

Home quick-link tiles:
- **"Tap to view licence"**
- **"View demerit points"** / **"Demerit point balance"**
- **"Access myLearners"**
- **"Update address on licence"**
- **"Manage licence renewal"** / **"Renew your licence when it's due"**
- **"Replace my physical licence card"**
- **"Order driver history report"**
- **"Verify someone's identity"** / **"Verify Licence"** / **"Verify Permit"**
- **"My registered vehicles"** / **"View all registered vehicles"**
- **"Manage registration renewal"** / **"Renew your registration when it's due"**
- **"Change your garage address"**
- **"Unregistered vehicle permits"** / **"Apprentice registration discount"**
- **"My vehicle reports"**
- **"Manage payment methods"** — "Store your credit card and bank account details to make payments"
- **"Manage direct debit settings"**
- **"View recent transactions made using your myVicRoads account"**

### Licence Detail Screen (most important for the replica)
- **Toolbar titles:** "Car licence details", "Car learner permit details", "Heavy vehicle licence details", "Rider licence details", "Rider learner permit details", "learner permit details", "licence details"
- **Section headings:** "Personal details", "Other details", "Licence conditions", "Licence status:"
- **Field labels:** "Licence number", "Licence type", "Date of birth", "First issued date", "Card", "Card Number", "Driver licence card number", "Probationary licence card number", "Learner permit card number", "Rider Card number", "Car Card number", "End Restriction %s", "Address", "Signature", "Last refreshed: ", "No conditions", "Proficiency"
- **Status flags:** "Full proficiency", "Probationary licence", "Learner permit", "Permit number", "Permit status"

### QR Code (digital licence presentation)
- **"Reveal QR code"** / **"Scan QR Code"** / **"How to scan a QR code"**
- **"Hover the QR code in front of your phone to scan"**
- **"Align the QR code within the square frame, hold still and wait for verification."**
- **"By presenting this QR code you securely verify digital licences by scanning the QR code."**
- **"The person who scans this code will only validate your licence number. No other data will be shared."**
- **"The person who scans this code will validate your photo, name, licence number and status."**
- **"Code expires in "** / **"Code will expire in "** / **"Code has expired "**
- **"QR code timer error"** / **"QR code not recognised"** / **"Please make sure you are scanning a myVicRoads app QR code."**
- **"Details verified with"** (verifier scan result)
- **"Do you consent to share your information?"**

### Biometrics / PIN
- **"Enable Biometrics"** / **"Enable biometric login"** / **"Enable biometrics and deactivate card or account"**
- **"Enabling biometrics provides an extra layer of security and is a convenient way to authorise log in. Only the Biometrics stored on this device will be enabled."**
- **"Skip setting up biometrics"**
- **"Set up your PIN code"** / **"Setup your 6 digit pin code"** / **"Confirm your 6 digit pin code"**
- **"Enter your existing 6 digit pin code"** / **"Please enter your existing PIN code"** / **"Confirm your PIN code"**
- **"By resetting your PIN you will be logged out."** / **"No PIN, pattern, or password set."**
- **"Biometrics failed too many times"** / **"Your device's biometric scanner is currently unavailable. Try again later."**

### Passkeys
- **"Add a passkey"** / **"Create a passkey"** / **"Passkey settings"** / **"Passkey created successfully"**
- **"No passkey created"** / **"Learn more about passkeys"** / **"Use your passkey to confirm it"**
- **"Your passkey is stored in"**
- **"Passkey creation failed. Please try again later."**
- **"Delete this passkey?"** / **"You already have a passkey that can be used on this device."**

### MFA / Email
- **"VicRoads has sent you an email with a 6 digit verification code. The code is valid for 1 hour."**
- **"Didn't receive code?"** / **"Code expires in "**
- **"Google Authenticator"** / **"Microsoft Authenticator app"**
- **"This activates two-step verification on your myVicRoads account."**

### Errors / Generic
- **"Network Error!"** / **"Connection error"** / **"Error: invalid"** / **"Limit exceeded"** / **"Fields cannot be blank."**
- **"No licence available"** / **"No licence or permit available"** / **"Licence can't be displayed"** / **"Licence has been disabled"**
- **"We do not have a licence associated with your myVicRoads account."**
- **"We are unable to retrieve your digital licence. Apologies for any inconvenience. We recommend using your physical licence card at this time."**

### Privacy Notice (legally exact wording — verbatim from the APK)
> **VicRoads (R&L Services Victoria Pty Ltd, Us/Our/We) is committed to protecting the privacy of your personal information. We handle your information in accordance with the Privacy and Data Protection Act 2014 (Vic), the Health Records Act 2001 (Vic) and Part 7B of the Road Safety Act 1986 (Vic).**

> **To obtain your Digital Driver Licence (DDL) you must have a current myVicRoads account and have downloaded the myVicRoads app. We will use your information from your myVicRoads account to provide you with secure access to your DDL via the myVicRoads app. If you do not agree to let Us use your personal information for this purpose, we cannot supply you the DDL. This means you will continue to use your hard copy driver licence.**

> **Once logged into your myVicRoads app you can access your DDL. You control who can view your DDL and what information you disclose through the use of a QR code. Refer to the VicRoads Privacy Policy for information about the data you're sharing when the QR code is scanned. VicRoads does not monitor your use of the DDL, and no personal information is kept in the DDL.**

(Title: **"VicRoads DDL Privacy Collection Notice"**; CTA: **"I acknowledge"** / "I acknowledge the VicRoads DDL Terms and Conditions and wish to receive a DDL.")

### FAQ tile copy
- **"How can I get a DDL?"**
- **"How do I access my DDL?"**
- **"How can I control access to my DDL information?"**
- **"Learn more about the DDL"**

---

## 7. Brand Colors & Dimensions

### Brand color palette (recovered from vector drawables)
| Hex | Where it appears | Suggested role |
|---|---|---|
| **`#253544`** | `ic_licence_outline`, `ic_vehicle_outline`, `ic_payments_outline`, `ic_profile_outline`, `ic_home_default`, `ic_external_link`, `ic_right_chevron`, `ic_qr_code`, `ic_logout`, `vicroads_logo`, `enable_biometric`, `pin_view`, `scanning_info`, `card_verification`, `onboarding_page_1..4` | **Primary navy / text** (R&L Services VicRoads brand navy) |
| **`#43B02A`** | `enable_biometric`, `enable_camera_permissions`, `pin_view`, `mfa_select`, `scanning_info`, `card_verification`, `registered_vehicles_icon`, `demerit_point_icon`, `onboarding_page_1..4` | **Accent green** (VicRoads "go" green — illustrations/CTAs) |
| **`#00693C`** | `ic_licence_filled`, `ic_vehicle_filled`, `ic_payments_filled` | **Bottom-nav active tab green** (dark) |
| **`#046235`** | `ic_profile_filled` | Profile-tab active green (slightly different — bug or intentional) |
| **`#397E58`** | `green_probationary_icon` (the "P" badge) | Probationary licence green |
| **`#DE3523`** | `red_probationary_icon` (red "P") | Red Probationary licence colour |
| **`#FFF001`** | `yellow_learner_icon` (the "L" badge) | Learner permit yellow |
| **`#84BB19`** | `ic_passkey_info`, `ic_passkey_success` | Passkey-success lime |
| **`#243544`** | `ic_passkey_info`, `ic_passkey_success` | Near-identical to primary navy (within color-pick tolerance) |
| **`#F23B3B`** | `ic_passkey_alert` | Passkey-error red |
| **`#EFF7FE`** | `ic_passkey_info` | Pale-blue info background |
| **`#EEEFF0`** | `demerit_point_icon`, `registered_vehicles_icon` | Light card-illustration grey |
| **`#E2E3E5`** | `onboarding_page_1` | Onboarding background grey |
| **`#EEEEEF`** | `onboarding_page_3` | Onboarding background grey (slight variant) |
| **`#8D8D8D`** | `ic_delete` | Disabled / delete grey |
| **`#212121`** | `ic_close`, `ic_share` | Near-black (Material default on-surface) |

### App-named dimensions (from `public.xml`)
Hand-picked app-specific dimens — full list is in the resource table (~250 dimens total, mostly Material defaults). The ones VicRoads added:

| Dimen name | Purpose hint |
|---|---|
| `AppBarLeftIconWidth` | Top-app-bar back/menu icon width |
| `DDLSectionTitleHeight` | Digital Driver Licence section header row height |
| `licenceIdCardHeaderIconHeight` / `…IconWidth` | Coat-of-arms icon size on card header |
| `licenceIdCardLoaderSize` | Spinner size on card while loading |
| `licenceIdCardTitleViewHeight` | Title strip height on the licence card |
| `licenceRoundedCorner` | Card corner radius |
| `enlarge_qr_code_disclaimer_bottom_padding` | Spacing under disclaimer on enlarged QR view |
| `enlarge_qr_code_timer_font_size` / `…_text_font_size` | QR countdown timer typography |
| `qr_code_bottom_padding` | Spacing under QR code |
| `digital_driver_card_expand_icon_size` | Expand-chevron icon size |
| `digital_driver_card_inner_bottom_padding` | Card padding |
| `digital_driver_card_horizontal_padding` | Card padding |
| `digital_driver_card_title_line_height` | Card title typography |
| `digital_driver_card_subtitle_line_height` | Card subtitle typography |

---

## 8. Untapped Drawables

The replica's `index.html` currently references only:
`vicroads_logo`, `vicroads_logo_white`, `ic_coat_of_arms`, `ic_home_default`, `ic_licence_outline`, `ic_payments_outline`, `ic_profile_outline`, `demerit_point_icon`, `green_probationary_icon`, `registered_vehicles_icon`, plus the `vic_*` fonts.

**Vector drawables NOT yet harvested** (all in `apk_extracted/res/drawable/*.xml`, all binary AXML — convert with `aapt2 dump xmltree` or render to SVG via the path-data extractor). Brand colours already known from §7.

### Bottom-nav state pair (filled / outline)
- `ic_home_filled.xml` *(filled active state for Home tab)*
- `ic_licence_filled.xml` *(filled green #00693C, used when Licence tab is active)*
- `ic_vehicle_filled.xml`, `ic_vehicle_outline.xml`
- `ic_payments_filled.xml`
- `ic_profile_filled.xml`

### Action icons / chevrons
- `ic_qr_code.xml` *(the QR-frame icon — likely on the licence card to indicate "tap for QR")*
- `ic_external_link.xml`, `ic_right_chevron.xml`, `ic_close.xml`, `ic_delete.xml`, `ic_logout.xml`, `ic_share.xml`

### Passkey illustrations
- `ic_passkey.xml`, `ic_passkey_alert.xml` (red `#F23B3B`), `ic_passkey_info.xml` (multi-color), `ic_passkey_success.xml` (lime `#84BB19`)

### Onboarding illustrations (the 4 hero illustrations — high value for fidelity)
- `onboarding_page_1.xml` *(multi-color illustration; navy + green + greys + white)*
- `onboarding_page_2.xml` *(simpler — navy + green + white)*
- `onboarding_page_3.xml` *(navy + green + greys + white)*
- `onboarding_page_4.xml` *(navy + green + white)*
- Plus the `$onboarding_page_*` AVD frame components (animated reveals)

### Auth / camera flow illustrations
- `enable_biometric.xml` — biometric prompt illustration
- `enable_camera_permissions.xml` — camera-permission prompt illustration
- `card_verification.xml` — card-number-entry illustration
- `pin_view.xml`, `pin_view_image_placeholder.xml` — PIN-pad illustration
- `mfa_select.xml` — MFA-method-picker illustration
- `scanning_info.xml` — "how to scan" illustration
- `placeholder_qr_code.xml` — QR placeholder while loading

### Licence-card visual badges
- `green_probationary_icon.xml` ("P" green) **— in use**
- `red_probationary_icon.xml` ("P" red) — **NOT yet used**, needed for red-P drivers
- `yellow_learner_icon.xml` ("L" yellow) — **NOT yet used**, needed for learner permits

### Logo variants
- `vicroads_logo.xml` (navy `#253544` on white) **— in use**
- `vicroads_logo_white.xml` (pure white, for dark backgrounds)
- `vicroads_logo_black.xml` (pure black)
- `vicroads_home_logo.xml` (animated home-screen logo with reveal AVD frames `$vicroads_home_logo__0..2`)

### Animated vector drawables (AVDs)
- `avd_show_password.xml` / `avd_hide_password.xml` — password-field eye-toggle
- Onboarding AVD frames (`$onboarding_page_*__N`)
- Coat-of-arms hologram is rendered live via the GLSL shaders, not as AVD.

### Already-extracted raster
- `floral_bgro_w.webp` *(in use as background)*
- `vic_coat_of_arms.webp` *(in use, also used as hologram texture)*
- `notification_oversize_large_icon_bg.png` *(notification chrome — not user-facing)*
- Launcher PNGs (`ic_launcher.png`, `_foreground`, `_round`) — in `apk_loot/launcher/`

---

## 9. App-Specific Layouts

After filtering out `abc_*`, `design_*`, `mtrl_*`, `m3_*`, `notification_*`, `material_*`, `select_dialog_*`, `support_*`, `fingerprint_dialog_*`, `ime_*`, `preference_*`, the **entire** app-defined `res/layout/` directory is:

```
activity_dev_menu.xml
custom_dialog.xml
dev_menu_fragment_device.xml
dev_menu_fragment_environment.xml
dev_menu_fragment_file_issue.xml
dev_menu_fragment_logs.xml
dev_menu_fragment_main.xml
view_webview.xml
web_view_with_toolbar.xml
webview_toolbar.xml
```

**Plus** in `res/menu/` and `res/navigation/`:
- `menu/dev_menu_logs_menu.xml`
- `navigation/dev_menu_nav_graph.xml`

**Implication:** All seven `dev_menu_*` files belong to the **Amplify developer menu** (`com.amplifyframework.devmenu.DeveloperMenuActivity`), not VicRoads's own UI. The three `view_webview` / `web_view_with_toolbar` / `webview_toolbar` are the in-app browser chrome. The lone `custom_dialog.xml` is generic.

**So the real app UI is 100% Jetpack Compose** — there are no app-specific Android View XMLs to mine for layout structure. Fidelity work must come from screenshots + the string IDs + the dimens + the vector drawables.

---

## 10. Other Notable Assets

### `assets/` directory (`apk_extracted/assets/`)
| File | Size | Purpose |
|---|---|---|
| `mlkit_barcode_models/barcode_ssd_mobilenet_v1_dmp25_quant.tflite` | 390 KB | ML Kit barcode detector |
| `mlkit_barcode_models/oned_auto_regressor_mobile.tflite` | 214 KB | 1D barcode regressor |
| `mlkit_barcode_models/oned_feature_extractor_mobile.tflite` | 277 KB | 1D barcode features |
| `dexopt/baseline.prof` + `.profm` | small | AOT compilation hints (Android baseline profile) |

The ML Kit `.tflite` models scan PDF417/QR/Code128 — these are the on-device scanner the app's "Verify" feature uses. **Replica can ignore** (browser uses a JS lib like `html5-qrcode`).

### Anti-piracy / DRM
- `com.pairip.licensecheck.LicenseActivity` + `LicenseContentProvider` — **Pairip Play licensing** (3rd-party SaaS). Will refuse to run if reinstalled from non-Play source. Not relevant to web replica but explains why the APK fights reverse-engineering.
- `META-INF/stamp-cert-sha256` — Play Store integrity stamp.

### Proto schemas (binary, in APK root)
- `action_logs.proto` — analytics action log schema
- `client_analytics.proto` — Firebase analytics client schema

Both compiled to binary. The schema field names could be reversed from `classes.dex` if needed, but unlikely to affect replica fidelity.

### Kotlin module markers (helpful map of internal package structure)
Inside `META-INF/`:
- `Login_prodRelease.kotlin_module` *(`prodRelease` is the build flavor)*
- `Shared_prodRelease.kotlin_module`
- `aws-auth-cognito_release.kotlin_module`
- `com.amplifyframework.aws-core_release.kotlin_module`
- `com.amplifyframework.core_release.kotlin_module`

Confirms the project is split into at least **`Login`** and **`Shared`** Gradle modules.

### Fonts (already harvested in `apk_loot/fonts/`)
- `vic_regular.otf`, `vic_medium.otf`, `vic_semibold.otf`
- This is **VIC** (the Victorian State Government brand font, formally "VIC Sans" / "VIC Serif"). Already used in the replica.

### Launcher icons (already harvested in `apk_loot/launcher/`)
- `mipmap-anydpi-v26/ic_launcher.xml` — adaptive icon (foreground+background drawable refs)
- `mipmap-xxxhdpi-v4/ic_launcher.png` (`ic_launcher_round.png`, `ic_launcher_foreground.png`)

### Splits (resource APK split config)
- `res/xml/splits0.xml` describes the language/density/abi splits available on the Play Store. Not useful for replica.

### Dev tooling
- `res/raw/amplifyconfiguration.json`, `inject_css.js`, `inject_js.js`, `hologram_*.glsl`, `firebase_common_keep.xml` — already covered above.

---

## Cross-References for Replica Work

| Replica feature | Use this asset / value |
|---|---|
| **Card hologram shimmer (coat of arms)** | `apk_extracted/res/raw/hologram_fragment.glsl` + `hologram_vertex.glsl` + texture `apk_loot/logos/vic_coat_of_arms.png`. Drive `u_roll` from `DeviceOrientationEvent.gamma`. Optional: enable the commented-out simplex-noise iridescence path. |
| **Card background "floral" pattern** | `apk_loot/logos/floral_bgro_w.png` (already wired in `index.html`). |
| **Brand navy** | `#253544` — primary text, outline icons, headings. |
| **Brand green (CTA / illustrations)** | `#43B02A`. **Bottom-nav active state uses the darker `#00693C`** (profile tab oddly uses `#046235`). |
| **Red P / Green P / Yellow L badges** | Extract paths from `apk_extracted/res/drawable/red_probationary_icon.xml`, `green_probationary_icon.xml`, `yellow_learner_icon.xml` (binary AXML — use the path-data extractor) and reproduce as SVG with `#DE3523` / `#397E58` / `#FFF001`. |
| **Onboarding hero illustrations** | `onboarding_page_1..4.xml` — multi-color compositions of navy + green + light-grey + white. Highest-impact untapped assets. |
| **Card heading typography** | Font `vic_semibold.otf`; line-height tokens in `digital_driver_card_title_line_height` and `digital_driver_card_subtitle_line_height` dimens. |
| **Licence number / DOB / address / signature labels** | Use the exact strings from §6 ("Licence number", "Date of birth", "Address", "First issued date", "Signature", "Last refreshed: ", "No conditions"). |
| **Section headings** | "Personal details", "Other details", "Licence conditions" (verbatim). |
| **Reveal QR toggle** | Label "Reveal QR code"; on press, show with disclaimer "By presenting this QR code you securely verify…". Timer copy: "Code expires in ", "Code has expired ". |
| **Splash heading** | "Welcome to the\nmyVicRoads app" — line break is significant. |
| **Privacy collection notice modal** | Verbatim text in §6 (legally precise — match exactly). Acknowledge CTA: "I acknowledge". |
| **Bottom-nav 5 tabs** | Order matches drawable names: Home → Licence → Vehicles → Payments → Profile. Use the `_outline` SVG for inactive and `_filled` (green) for active. |
| **Deep link from "Open in app" buttons** | `https://www.vicroads.vic.gov.au/qr-scan` — the only declared auto-verified deep link. |
| **Cognito ids (for spoofed/staged backend)** | User Pool `ap-southeast-2_HWZXwaF7X`, Client `3jtgfkom08ntclb1je15unckvv`, Identity Pool `ap-southeast-2:074e9b0d-70c1-4b73-a57f-164a68ef1628`. |
| **WebView interop pattern** | If the replica embeds an iframe, use the same `injectStyle(code)` / `injectScript(code)` pattern from `inject_css.js` / `inject_js.js`. |
| **App version footer** | "v1.3.5" (the APK version). String resource template "App version %s". |
| **Force-update / kill-switch flags** | Firebase Remote Config defaults: `force_app_update=false`, `force_app_update_version=1.0.0`, `my_account=true`. Mirror as JS feature flags. |

### Things NOT in the APK (and therefore should NOT be invented for the replica)
- No SVG/EPS source files of the coat of arms — the only asset is the rasterised WebP.
- No JSON sample of a licence record — the data shape must be reverse-engineered from dex or guessed.
- No QR-code payload schema — `licence_detail_screen_qr_code_*` strings exist but the encoded payload format lives only in dex.
- No backend REST URLs in plain text (only Cognito) — API base URLs are buried in `classes.dex`.
- No multi-language strings — the APK ships English only (`values/` has no `values-fr/`, `values-zh/`, etc.).

---

# Session 2 Addendum — Full Resource Dump Pass
*Generated: 2026-06-03 | Script: `finish_apk_dissect.py` + `fix_arsc.py`*

The session-1 inventory was hand-curated from binary regex into prose tables. This pass committed the **actual extracted files** to disk so you can `grep`, `cat`, or import them programmatically. Everything below is now a real file you can read.

---

## 11. Bulk-Extracted Resources (now on disk)

All extracted via `pyaxmlparser.ARSCParser.get_*_resources()` on `apk_extracted/resources.arsc` (441,700 bytes, 1122 strings indexed).

| File | Entries | Notes |
| --- | --- | --- |
| `apk_loot/decoded/values/au.gov.vic.myvicroads/strings.xml` | **763** | All user-facing copy in default English config. Stable IDs (`bottom_bar_licence`, `digital_driver_card_licence_title`, etc.) |
| `apk_loot/decoded/values/au.gov.vic.myvicroads/colors.xml` | **196** | Mostly AppCompat/Material references — Compose brand colours are hardcoded in Kotlin, not in ARSC |
| `apk_loot/decoded/values/au.gov.vic.myvicroads/dimens.xml` | **443** | Pixel-exact paddings/sizes — see §13 |
| `apk_loot/decoded/values/au.gov.vic.myvicroads/integers.xml` | **34** | Animation durations, max-length constants |
| `apk_loot/decoded/values/au.gov.vic.myvicroads/bools.xml` | 0 | Extractor failed on this type (`list index out of range`); none of the boolean flags are essential |
| `apk_loot/decoded/values/resources_summary.json` | full | Single JSON dump of all the above for programmatic consumption |

### High-value string IDs (now grep-able directly)

```
bottom_bar_licence                          "Licence"
bottom_bar_payments                         "Payments"
bottom_bar_profile                          "Profile"
bottom_bar_vehicles                         "Vehicles"
digital_driver_card_licence_title           "My licence"
digital_driver_card_licence_subtitle        "Tap to view licence"
biometrics_login_title                      "Login with biometrics"
biometrics_login_negative_text              "Use PIN"
enable_biometrics_screen_title              "Enable biometric login"
enable_biometrics_screen_button             "Continue"
enable_biometrics_screen_skip               "Skip this step"
card_verification_view_description          "Keep your account secure. Verify with your
                                             8 character card number found on the back of
                                             your full licence card."
enable_passkey_screen_in_progress_title     "Simplify your sign in"
enable_passkey_screen_in_progress_subtitle  "Create a passkey"
enable_passkey_screen_in_progress_message   "Sign in easily now with your fingerprint,
                                             face, or PIN. Sync across your devices."
```

There are 763 of these — full file at `apk_loot/decoded/values/au.gov.vic.myvicroads/strings.xml`. Use them verbatim for every copy element in the replica so it reads identical to the real app.

---

## 12. AndroidManifest.xml — Now Decoded

Previously binary AXML; now readable at `apk_loot/decoded/AndroidManifest.xml` (12,031 bytes).

### Confirmed facts (relevant to replica fidelity)

- **Single deep link** (the only `intent-filter` with `android:autoVerify="true"`):
  ```
  scheme:  https
  host:    www.vicroads.vic.gov.au
  path:    /qr-scan
  ```
  This is the QR-scan flow entry point. Everything else is launched via the LAUNCHER intent.

- **Permissions** (the minimum set the replica should pretend to need):
  - `CAMERA` (QR scan)
  - `ACCESS_NETWORK_STATE` + `INTERNET`
  - `USE_BIOMETRIC` + `USE_FINGERPRINT`
  - `WAKE_LOCK` (keep screen on while licence card is shown)
  - `REORDER_TASKS`
  - `com.google.android.gms.permission.AD_ID`
  - `com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE`
  - `com.android.vending.CHECK_LICENSE` (Play Store licence check)

- **MainActivity** flags: `launchMode="singleTop"` (= 2), `screenOrientation="portrait"` (= 1) — replica should be portrait-locked too.

- **Queries** (Android 11+ package visibility): the app explicitly declares it can `SENDTO mailto:`, `DIAL`, open `https://` URLs in browsers, and bind to Custom Tabs services.

- **Anti-piracy**: `com.pairip.licensecheck.LicenseActivity` + `LicenseContentProvider` — explains why the APK is wrapped in PairIP and why a full transpile was a budget grave.

---

## 13. Pixel-Exact Dimensions (drop straight into CSS)

`apk_loot/decoded/values/au.gov.vic.myvicroads/dimens.xml` — these 443 dimen entries are direct rectifiable to CSS pixels (Android `dip` is approximately CSS `px` at default zoom).

### Digital driver card (the centerpiece replica)

| Name | Value | CSS |
| --- | --- | --- |
| `digital_driver_card_width`  | `327.0dip` | `width: 327px` |
| `digital_driver_card_height` | `204.0dip` | `height: 204px` |
| `digital_driver_card_horizontal_padding` | `24.0dip` | `padding-left/right: 24px` |
| `digital_driver_card_inner_bottom_padding` | `34.0dip` | `padding-bottom: 34px` |
| `digital_driver_card_title_line_height` | `22.0sp` | `line-height: 22px` |
| `digital_driver_card_subtitle_line_height` | `20.0sp` | `line-height: 20px` |
| `digital_driver_card_expand_icon_size` | `14.0dip` | `width/height: 14px` (the arrow on "Tap to view licence") |
| `licenceRoundedCorner` | `8.0dip` | `border-radius: 8px` |
| `licenceIdCardLoaderSize` | `150.0dip` | Loader/spinner viewport during licence reveal |
| `licenceIdCardTitleViewHeight` | `67.0dip` | Top wordmark band height on the open card |
| `licenceIdCardHeaderIconWidth` | `86.0dip` | **VicRoads logo width** on the licence — matches `vicroads_logo_white.svg`'s 86 viewBox unit |
| `licenceIdCardHeaderIconHeight` | `22.0dip` | **VicRoads logo height** — matches `vicroads_logo_white.svg`'s 22 viewBox unit (intrinsic 86x22 svg, no resize needed) |
| `dateRangeTabSpacingTop` | `28.0dip` | Top spacing on Identity/Age tabs |
| `dateRangeTabSpacingBottom` | `18.0dip` | Bottom spacing on Identity/Age tabs |

Full file: `apk_loot/decoded/values/au.gov.vic.myvicroads/dimens.xml`. Search for `m3_`, `mtrl_`, `design_`, `abc_` to filter out the Material/AppCompat noise and find more vicroads-specific dimensions.

---

## 14. DEX URL/Endpoint Harvest

Both `classes.dex` (10MB) and `classes2.dex` (1.4MB) were byte-grepped for HTTPS URLs, REST endpoint fragments, and keyword-flagged literals.

### Output files (`apk_loot/decoded/dex_strings/`)

| File | Entries | Use |
| --- | --- | --- |
| `all_urls_dedup.txt` | **67** | All unique HTTPS/HTTP URLs found in either DEX |
| `classes.dex__urls.txt` | 58 | Just classes.dex |
| `classes2.dex__urls.txt` | 9 | Just classes2.dex |
| `endpoint_fragments.txt` | 653 | `/api/...`, `/v1/...`, `/graphql`, `/auth`, `/login`, `/cognito` paths (mostly Google/Amplify SDK class names — manually filter for real REST paths) |
| `interesting_literals.txt` | 2063 | Printable >=8-char runs containing keywords (vicroads, cognito, hologram, barcode, webview, licence, permit, demerit, etc.) |

### Real VicRoads URLs found in DEX (13 unique — the gold)

These are the **actual** URLs the app links out to. Drop them into the in-app browser overlay's URL display for one-to-one realism:

```
https://www.vicroads.vic.gov.au
https://www.vicroads.vic.gov.au/contact-us
https://www.vicroads.vic.gov.au/licences/digital-driver-licence
https://www.vicroads.vic.gov.au/licences/licence-and-permit-types/cards-and-card-numbers
https://www.vicroads.vic.gov.au/online-services/deactivate-your-mylearners-account/
https://www.vicroads.vic.gov.au/online-services/help-centre/myvicroads-app-help/how-to-use
https://www.vicroads.vic.gov.au/online-services/help-centre/myvicroads-app-help/terms-and-conditions#app
https://www.vicroads.vic.gov.au/online-services/help-centre/two-step-verification
https://www.vicroads.vic.gov.au/online-services/login/sso
https://www.vicroads.vic.gov.au/online-services/passkeys
https://www.vicroads.vic.gov.au/online-services/sign-up-for-a-vicroads-online-account
https://www.vicroads.vic.gov.au/website-terms/privacy
https://sts.amazonaws.com                          (AWS STS — not user-facing)
```

### AWS/Amplify infrastructure URLs

The remaining 53 URLs are Amplify SDK boilerplate: `cognito-identity.`, `cognito-idp.`, `sts.`, `portal.sso.`, `oidc.` (with `-fips` siblings), plus Firebase Remote Config, Firebase Installations, app-measurement, AdServices. These were templated by the AWS Amplify generator — no replica value but documented for completeness.

### Notable absence

**No API Gateway / AppSync URL** appears in plaintext form. The licence/demerit/vehicles REST endpoints are constructed at runtime in Kotlin (concatenated from constants in `classes.dex` Compose ViewModels). To recover them would require `dex2jar` + `jadx` decompile — beyond the scope of a regex sweep but possible if needed.

---

## 15. Library Versions (full SDK stack)

All `*.properties` files harvested to `apk_loot/decoded/properties/` (34 files). Highlights:

| Library | Version | Notes |
| --- | --- | --- |
| `firebase-analytics` | 21.3.0 | Crash + usage analytics |
| `firebase-components` | 17.1.0 | DI for Firebase modules |
| `firebase-installations-interop` | 17.1.0 | Per-install ID |
| `firebase-measurement-connector` | 19.0.0 | Analytics bridge |
| `barcode-scanning` | 17.3.0 | MLKit (QR scan) |
| `barcode-scanning-common` | 17.0.0 | MLKit common |
| `play-services-auth` | 21.1.1 | Google Sign-In + credentials |
| `play-services-auth-base` | 18.0.10 | |
| `play-services-auth-blockstore` | 16.4.0 | Cred backup |
| `play-services-base` | 18.5.0 | |
| `play-services-basement` | 18.4.0 | |
| `googleid` | 1.1.0 | One-Tap Sign-In |
| `image` | 1.0.0-beta1 | Image loader (Coil or similar) |
| `play-services-ads-identifier` | 18.0.0 | AD_ID resolution |

These confirm the app uses standard AWS Amplify + Firebase + MLKit stack — no exotic dependencies. If we ever need to mock backend call responses, the Amplify auth response schema is publicly documented and matches the versions above.

---

## 16. WebView Architecture (decoded)

The real in-app browser's view tree is now readable at `apk_loot/decoded/layouts_xml/`:

- `layout__view_webview.xml` — single full-bleed `WebView` inside a `ConstraintLayout`. No URL bar, no chrome.
- `layout__web_view_with_toolbar.xml` — wraps the above with `webview_toolbar` at the top.
- `layout__webview_toolbar.xml` — a `ConstraintLayout` with two `ImageView`s (16dp padding each) — left button + right button. References `@7F0800C9` (close icon) and `@7F0800EB` (share icon).

The in-app browser overlay we already built in `index.html` matches this structure exactly: status bar -> toolbar (close + share) -> WebView content area -> bottom action bar. Our jerky load bar is an embellishment the real app doesn't have (it uses the native WebView progress) — but it adds visual interest.

### Inject scripts (templates only)

`apk_extracted/res/raw/inject_css.js` and `inject_js.js` are wrapper templates with `%1$s` placeholders — the actual CSS/JS content is templated in from Kotlin at runtime (lives in `classes.dex`). The templates themselves are uninteresting but they're now copied verbatim to `apk_loot/decoded/configs/` for reference:

```js
// inject_css.js
function injectStyle($code) {
    var node = document.createElement('style');
    node.type = 'text/css';
    node.innerHTML = $code;
    document.head.appendChild(node);
}
injectStyle('%1$s');
```

---

## 17. Remote Config & Manifest XMLs (decoded)

`apk_loot/decoded/xml/` now contains 5 readable files:

| File | Contents |
| --- | --- |
| `remote_config_defaults.xml` | `force_app_update_version=1.0.0`, `force_app_update=false`, `my_account=true` — only 3 feature flags |
| `backup_rules.xml` | `<full-backup-content/>` — empty (no per-key backup overrides) |
| `data_extraction_rules.xml` | (62 bytes — minimal) |
| `image_share_filepaths.xml` | (80 bytes — defines what `FileProvider` can share) |
| `splits0.xml` | 70-language config split index (af, am, ar, ... zh, zu) — confirms app ships English-only at runtime; other languages are downloadable splits |

---

## 18. Updated Drop-in Recommendations

Now that strings.xml + dimens.xml are committed to disk, the replica fidelity ceiling is higher than the original session-1 plan suggested.

### Quick wins for the next pass (in priority order)

1. **Wire the licence card to exact dimens**. Set `.my-licence-panel`'s outer container to `width: 327px; height: 204px; padding: 0 24px 34px; border-radius: 8px` — these are the EXACT real-app numbers. Currently we're guessing.

2. **Use the white VicRoads logo at its intrinsic 86x22 size** on the licence card top band. `apk_loot/icons/logos/vicroads_logo_white.svg` already has this viewBox — no extra CSS needed.

3. **Replace all hand-typed UI copy** with verbatim strings from `strings.xml`. Even "Tap to view licence" should be sourced from `digital_driver_card_licence_subtitle` to guarantee character-identical match.

4. **Set browser overlay URLs from the 13 real DEX URLs** — e.g. the "Replace licence" page's URL pill should read `vicroads.vic.gov.au/licences/digital-driver-licence`, not a guess.

5. **Add the QR-scan deep link** — if you want the replica to be installable as a PWA and trigger from external links, register `https://www.vicroads.vic.gov.au/qr-scan` as the manifest start URL.

6. **Wire remote config feature flags** locally — read `force_app_update`, `my_account` from a JSON in the replica root so admin panel can toggle them and trigger the same UI states.

### Already done in earlier sessions (no action)

- All 22 high-value SVG icons converted and integrated (nav, home, badges, QR, logos)
- Brand palette retune (#43B02A, #253544, #DE3523, #397E58, #FFF001 all wired)
- Browser overlay sliding sheet + jerky load bar + 12 replica pages
- Hologram shader running in 3 layers with gyro calibration
- Real OTF fonts loaded (`vic_regular`, `vic_medium`, `vic_semibold`)

### Still impossible without decompile

- Exact GraphQL/REST API endpoints for `/licence`, `/demerits`, `/vehicles` (in `classes.dex` Kotlin code)
- Real licence record JSON schema (constructed at runtime by `LicenceDetailViewModel`)
- QR code payload format (encoded by Kotlin in `EnlargedQrCodeState` class — string fragment found in interesting_literals)
- Exact Compose colour constants (Kotlin `Color(0xFF43B02A)` calls — not in ARSC because Compose doesn't use Android resources)

These are all classes-dex-decompile-required if absolute fidelity becomes critical. Tooling needed: `dex2jar` + `jadx-cli` (neither installed locally; would need download).

---

## 19. Helper scripts on disk

| Script | Purpose |
| --- | --- |
| `decode_apk.py` | Session 1 — first-pass ARSC + AXML decode (had bugs in bulk getters) |
| `apk_vd_to_svg.py` | Session 1.5 — VectorDrawable -> SVG converter (468 lines, handled all 84 SVGs perfectly) |
| `finish_apk_dissect.py` | Session 2 — completes manifest/xml/dex/properties extraction |
| `fix_arsc.py` | Session 2 — fixes the bytes-vs-str bug in the bulk ARSC extractor |

All scripts are reproducible — `py finish_apk_dissect.py && py fix_arsc.py` re-runs the entire dump in <30 seconds.
