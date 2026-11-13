# M. I. A.

M. I. A. is a standalone local app. It does not use Base44 or require a hosted backend, GitHub, external fonts, or email. Once its dependencies are installed and the app is built, it runs on the computer that hosts it and works without an internet connection. Ubuntu fonts are bundled with the app for offline use. Patients create a unique username and four-digit PIN, then can optionally add a device passkey. Patient accounts and records are stored in a local SQLite database; health details are encrypted at rest, and each account only receives its own profile after PIN or passkey authentication.

The Devices page includes vital-sign and environmental BLE tabs. Environmental readings are available from compatible Bluetooth Environmental Sensing Service sensors; unsupported or missing sensor values are left blank. Temperature units can be switched between Celsius and Fahrenheit in the UI, while stored values and clinical thresholds remain in Celsius.

The local Symptom Assessment combines existing symptom rules with an included 2023 disease/symptom dataset (246,945 source rows, 773 labels, and 377 usable symptom features). Its ranked percentages are non-calibrated symptom-match scores, not diagnostic probabilities or validated clinical conclusions. The dataset contains no treatment outcomes or nutrient measurements, and its associations have not been independently clinically validated. Recent sleep and food logs are displayed as context only; nutrient levels are not inferred. Inventory matches identify potentially relevant supportive supplies, not instructions to use them. Assessment and plan steps require qualified-clinician review and must not be used to start, stop, or change medication.

Connected BLE readings are shown live and are not uploaded or automatically recorded. Signed-in patients can explicitly save real vital-sign or environmental sensor readings to their encrypted local patient record from the Devices page. Simulated readings are never saved. Fingerprint sign-in uses WebAuthn passkeys: account creation and the profile page register Windows Hello platform authentication, including a VeriMark sensor enrolled with Windows Hello. A separate profile action is available for external FIDO2 security keys. Fingerprint verification stays on the authenticator; M. I. A. stores only the passkey credential.

## Project Layout

- `src/pages/` contains the app screens; `src/components/` contains shared UI and reusable wellness panels.
- `src/hooks/` contains device and browser hooks; `src/lib/` contains assessment, data, API, and local account logic.
- `server/` contains the local API and encrypted SQLite storage; `desktop/` contains the Electron desktop entry point.
- `public/mia.png` is the M. I. A. app logo; `public/mia.ico` supplies Windows app and installer icons. Bundled offline fonts are also in `public/`; `scripts/` contains local development helpers.
- `data/` is local runtime data and must be kept backed up, not cleaned as source code.
- `dist/`, `dev-dist/`, and `release/` are generated build outputs; builds can recreate them.

Use the Light/Dark controls at the top-right of the app to change appearance. The selected theme is saved on the current device.

The local service must be running whenever the app is used. Use Node.js 24 or newer. Development and browser mode store the SQLite database and encryption key in the project-relative `data/` directory. The packaged desktop app keeps its database, encrypted key file, and browser session profile in `data/` beside `M. I. A.exe`. Health fields remain encrypted in SQLite; the desktop data key is wrapped with a separate master password using scrypt and AES-256-GCM. Keep the database and wrapped key together. Losing the master password makes the portable health records unrecoverable. This local prototype has no remote backup or account recovery service and is not a certified clinical records system.

Medical inventory is saved in the local encrypted database so changes persist across app restarts, including the Windows desktop app's changing local port. Signed-in patient assessments and sleep/food logs are saved to that patient's encrypted record; guest sessions do not save patient records. Patient records show concise assessment and sleep/food history summaries; select an event to expand its details. Session history is saved only when the session contains a recorded event.

## Windows Desktop App

The Windows desktop build opens M. I. A. in its own app window, starts the API locally, and stores the database, password-wrapped key, browser profile, and login-session cookies in the `data/` folder beside `M. I. A.exe`. Electron's profile path is redirected before any app window starts, so it does not use Windows AppData for its profile. The API binds only to IPv4 loopback, and Electron resolves the `localhost` app origin to that same loopback address. This keeps local connections consistent without changing the `localhost` WebAuthn origin used by existing Windows Hello and FIDO2 passkeys. On each desktop launch, prior login sessions and cookies are cleared, so the app returns to the login screen. While on any other page, it warns after 90 seconds of inactivity and logs out to the login screen after two minutes. It does not require internet access after the app files are copied to the computer.

On first launch, create a separate master password of at least 12 characters. Enter it each time M. I. A. starts to unlock the portable data; it is not the patient PIN and is never saved by the app. The master password protects the random database key, while patient PINs continue to be stored as scrypt hashes. Anyone with the USB and master password can access the accounts. Keep a backup of the entire `data/` directory. Losing or forgetting the master password makes encrypted health records unrecoverable.

The desktop app presents a device chooser when connecting compatible Bluetooth LE sensors and asks before completing Bluetooth pairing. Device availability depends on the computer’s Bluetooth adapter and the sensor’s supported services.

To create a Windows installer from a development checkout with Node.js 24 or newer:

```bash
npm install
npm run desktop:win
```

The installer is written to `release/M-I-A-Setup-0.0.0.exe`. A packaged desktop app keeps its runtime data beside the executable, including when installed. On first run, the app can migrate a matching database/key pair from a sibling `MIA Patient Data Transfer` folder or from `%APPDATA%\MarsMedic AI`; it snapshots and validates the database, stores only a password-wrapped key in the app-relative `data/` directory, and leaves the source files untouched. If both sources exist, migration proceeds only when the database and key files match exactly; incomplete, damaged, or conflicting data stops startup without replacing existing files. The desktop app blocks requests to non-local origins.

On non-Windows build hosts, create an unpacked Windows app folder instead:

```bash
npm run desktop:win:dir
```

Copy the complete `release/win-unpacked` folder to Windows and launch `M. I. A.exe`. Create the NSIS installer on Windows with `npm run desktop:win`.

To use the portable app on another Windows computer, safely eject the USB drive, plug it into the other computer, and launch `M. I. A.exe` from its folder. The app and its `data/` folder stay together on the USB drive, so accounts, patient records, inventory, preferences, and saved login sessions remain available offline. Enter the portable master password, then sign in with the existing patient PIN. Do not copy only the executable; copy the entire app folder including `resources/` and `data/`. Windows Hello credentials are bound to their original computer and cannot be transferred; register Windows Hello again on the new computer after signing in with the PIN.

For development, `npm run desktop` builds and launches the app window on the current computer.

## Run Locally and Offline

```bash
npm install
npm run build
npm start
```

Open `http://127.0.0.1:8787` on the same computer. The local server serves the app and its SQLite/API service together; leave it running while using M. I. A. This does not require a GitHub or Base44 session. `npm install` and `npm run build` are setup steps; after they finish, `npm start` runs locally without internet access.

For development with automatic reloads, run:

```bash
npm run dev
```

This starts both the local SQLite/API service on `127.0.0.1:8787` and the Vite development server, usually at `http://127.0.0.1:5173`. Account sign-in and records need the local service to be running; they do not need internet access. The production-style `npm start` server is the intended way to run the built app offline.

The desktop installer bundles the built frontend, local service, and runtime dependencies. The traditional `npm start` mode remains available for running in a separate browser and stores its data under the project `data/` directory.

## Optional: Share on a Local Network

For collaborators on the same Wi-Fi/LAN, one trusted computer can host the app and database. Internet access is not required, but all devices must be connected to that local network and the host must remain on. Do not expose this prototype to the public internet.

LAN access requires HTTPS because browsers restrict passkeys and Bluetooth to secure contexts, and health data must not be sent in clear text. Reserve a fixed LAN IP for the host, then obtain a trusted TLS certificate for that address or local DNS name. For a small trusted network, install `mkcert` on the host and run:

```bash
mkcert -install
mkcert 192.168.1.25
mkcert -CAROOT
```

Install the resulting `rootCA.pem` as trusted on each collaborator device. Copy only that public root certificate—not `rootCA-key.pem`—and keep the generated TLS private key and database encryption key on the host.

Set these environment variables in the host's shell, replacing example values with the host's LAN address and certificate file paths:

```bash
export LAN_HOST=192.168.1.25
export TLS_CERT_PATH=/path/to/192.168.1.25.pem
export TLS_KEY_PATH=/path/to/192.168.1.25-key.pem
```

For development, run `npm run dev` and open `https://192.168.1.25:5173` from each trusted device. The API stays bound to the host computer's loopback interface behind the HTTPS development server.

For a production-style local host, build the app and bind the API only to the host's specific LAN address:

```bash
npm run build
API_HOST="$LAN_HOST" npm start
```

Collaborators open `https://192.168.1.25:8787`. Configure the host firewall to allow that port only from the trusted local network. To access the same patient record, they must sign in to that same patient account; the app does not provide collaborator roles or per-person access controls. Anyone with that account's username and PIN has the same access, so share credentials only with trusted people. Keep a secured backup of both `data/marsmedic.sqlite` and its matching key.

## Checks

```bash
npm run lint
npm run build
npm run test:api
```