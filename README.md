# Simple Electron App

A minimal Electron desktop app base.

Requirements
- Node.js (16+ recommended)

Windows (cmd.exe) quick start

1. Open cmd.exe and cd to the project folder:

   cd /d e:\[app]

2. Install dependencies:

   npm install

3. Run the app:

   npm start

Notes
- This project uses a preload script and contextIsolation for security.
- To package the app use tools like `electron-builder` or `electron-forge`.

Next steps
- Add IPC handlers in `main.js` and use `ipcRenderer.invoke` from the renderer.
- Convert to TypeScript and add build scripts.
- Add native menus and keyboard shortcuts.

Packaging (create Windows .exe / installer)

1. Ensure you're on Windows (building an installer for Windows from Windows is recommended).

2. Install dependencies (this will install `electron` and `electron-builder`):

   npm install

3. Build an installer (NSIS) or portable exe:

   npm run dist

4. Output will be in the `dist` folder. Example artifacts: `Simple Electron App Setup 0.1.0.exe` (NSIS installer) and portable exe.

Notes & troubleshooting
- If you get permission or signing issues, run the build in an elevated shell.
- To customize icons, put `icon.ico` under `build/icon.ico`.
- For auto-update support, configure publish settings in the `build` section of `package.json`.

Database (env) and testing

- Put your DB connection info in a `.env` file at the project root with the following keys (example in `.env`):

   DB_HOST=smiledev.id.vn
   DB_NAME=smiledev_wap
   DB_USERNAME=smiledev_wap
   DB_PASSWORD=your_password
   DB_CONNECT_TIMEOUT=4000
   DB_SOCKET_TIMEOUT=60000

- The app will load `.env` on startup and initialize a MySQL pool using `mysql2`.
- To test the DB connection from the running app: open the app UI and click the "Test DB connection" button — it will show `DB: connected` or an error message.

- Login from the app:
   - Use the Login form in the app to sign in with username or email + password.
   - On successful login the main process will verify the password (bcrypt) and update the `last_login` column for that user in the database.
   - The UI shows success/failure messages.

   Set a user's password (if you don't know the sample passwords)

   1. Ensure `.env` contains correct DB credentials and is at project root.
   2. Install dependencies (once):

      npm install

   3. Run the helper script to set password for a user (username or email):

      node set_password.js MyNewPass123 seller@example.com

   4. After the script reports success, use the new password `MyNewPass123` in the app login form.

Security note
- Do NOT include `.env` with real credentials in public releases. When distributing source, remove or replace `.env` with instructions and provide credentials through a secure channel.
