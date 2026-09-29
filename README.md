# Jamia tul Banat Admissions App

A full-stack admissions application for Jamia tul Banat Faizan e Ummul Khair Foundation. Applications and uploaded documents are stored on the server using SQLite and a private uploads folder. Staff use a password-protected portal to review, edit, approve/reject, print, delete, and export applications.

## Requirements

- Node.js 24 or newer (the app uses Node's built-in SQLite module; no npm packages are required)

## Run locally on Windows

Double-click `Open Admission App.bat`. It asks you to choose a staff password, starts the Node.js server, and opens the site in your browser. Keep the Node.js server window open while using the app; close that window to stop it.

## Run manually in PowerShell

1. Open PowerShell in this folder.
2. Set a strong staff password for this run:

   ```powershell
   $env:ADMIN_PASSWORD = Read-Host "Choose a staff password (12+ characters)"
   ```

3. Start the server:

   ```powershell
   npm start
   ```

4. Open `http://127.0.0.1:3000` in the browser.
5. Select **Staff Portal** and sign in with the password you entered.

The server saves the database at `data/admissions.sqlite` and uploaded files under `data/uploads/`. Back up the complete `data` folder. Do not place that folder in a public web directory or share it; it contains student personal information and identity documents.

## Important before public deployment

This app is prepared to run as a server but is not deployed to a public domain. Public access requires a hosting provider, HTTPS, secure server configuration, backups, and appropriate privacy/data-retention practices for student records and identity documents. Never use the built-in server directly as a public production server. The WhatsApp link prepares a message for the applicant to send; it does not automatically message the admissions number.


