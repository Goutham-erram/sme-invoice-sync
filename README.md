# SME Invoice Sync 🚀

SME Invoice Sync is a lightweight, highly robust integration engine designed for Small and Medium Enterprises (SMEs). It connects a **QuickBooks Online (QBO)** sandbox or production account with **Google Sheets** and **Gmail** to automate invoicing workflows, sync records in real-time, and handle overdue payment reminders.

---

## 🛠️ Key Features

1. **Real-Time Invoice Tracker (Webhook & Manual)**
   * Syncs new invoices from QuickBooks to a formatted Google Sheet automatically.
   * Recognizes invoice status updates (e.g., balance updates) and updates Google Sheets.
   * Handles deletion and voiding edge cases seamlessly (adds visual strikethroughs to the rows).
2. **Automated Payment Tracker**
   * Automatically marks invoices as **Paid** (styled in green) when payment is applied.
3. **Daily Overdue Scanner & Email Reminders**
   * Periodically scans QuickBooks for active, unpaid invoices whose due date has passed.
   * Flags overdue invoices on Google Sheets (styled in red).
   * Sends highly polished, automated HTML email reminders to customers using Gmail SMTP.
   * *Development Safety:* Reminders are safely redirected to the developer in Sandbox mode.
4. **Admin Control Panel**
   * Next.js browser dashboard showing live OAuth connection status.
   * Quick-action buttons to manually trigger a **Bulk Sync** of all QuickBooks historical invoices or run a **Manual Overdue Scan**.
5. **Multi-Currency Processing**
   * Automatically handles multi-currency transactions, logging foreign currency, exchange rates, and calculating home currency amounts.

---

## 🏗️ Architecture & Technology Stack

* **Backend:** Node.js, Express (running inside Docker on Port `5001` to avoid macOS AirPlay Port 5000 conflicts).
* **Frontend:** Next.js (running inside Docker on Port `3000`).
* **Database:** PostgreSQL (Dockerized, persistent volume).
* **Cache:** Redis (Dockerized, ready for queueing/locking).
* **Scheduling:** `node-cron` scheduled scans running in `America/New_York` timezone.
* **Integrations:**
  * **QuickBooks Online SDK** (`intuit-oauth` and native API calls) with persistent, auto-refreshing OAuth 2.0 lifecycle manager.
  * **Google Sheets Web App**: Dispatched to a custom Apps Script (bypassing complex GCP OAuth setup for easier deployment).
  * **Gmail SMTP**: Managed via `nodemailer` using Gmail App Passwords.

---

## 🔑 Required Credentials & Env Setup

Create a file named `.env` in the `backend/` directory (`backend/.env`). A template is provided in `backend/.env.example`.

### 1. Server Configuration
* `PORT`: Set to `5001`.
* `NODE_ENV`: Set to `development` or `production`.
* `TZ`: Set to your local timezone (e.g. `America/New_York`).

### 2. Database & Cache
* `DATABASE_URL`: `postgresql://postgres:postgres@db:5432/sme_sync` (pre-configured for local Docker).
* `REDIS_URL`: `redis://redis:6379` (pre-configured for local Docker).

### 3. QuickBooks Online API
Create an app in the [Intuit Developer Portal](https://developer.intuit.com).
* `QB_CLIENT_ID`: OAuth 2.0 Client ID (from App Keys).
* `QB_CLIENT_SECRET`: OAuth 2.0 Client Secret (from App Keys).
* `QB_ENVIRONMENT`: `sandbox` (default) or `production`.
* `QB_REDIRECT_URI`: Set to `http://localhost:5001/api/auth/quickbooks/callback`.
* `QB_VERIFIER_TOKEN`: Found in your App's **Webhooks** tab after configuring the webhook URL.

### 4. Gmail SMTP Integration
* `GMAIL_USER`: The sender Gmail address (e.g. `your-company@gmail.com`).
* `GMAIL_APP_PASS`: A **16-character App Password** (not your regular account password). Go to your Google Account -> Security -> 2-Step Verification -> App Passwords to generate this.

### 5. Google Sheets (Apps Script Web App)
* `GOOGLE_SHEETS_WEB_APP_URL`: The URL generated when deploying the script located in `backend/src/google_apps_script.js`. See the Apps Script Deployment section below.

---

## 📝 Google Sheets Apps Script Setup

To connect Google Sheets:
1. Open a Google Sheet.
2. Navigate to **Extensions** -> **Apps Script**.
3. Replace all default code in the editor with the contents of [google_apps_script.js](backend/src/google_apps_script.js).
4. Save the project (click the floppy disk icon).
5. Click **Deploy** -> **New deployment**.
6. Set **Select type** to **Web app**.
7. Set **Execute as** to **Me**.
8. Set **Who has access** to **Anyone**.
9. Click **Deploy** and copy the **Web App URL** into your `backend/.env` file as `GOOGLE_SHEETS_WEB_APP_URL`.

---

## 🚀 Running the App Locally

### Prerequisites
Make sure you have [Docker](https://www.docker.com/products/docker-desktop/) installed on your machine.

### Step 1: Start the Docker containers
From the root directory, run:
```bash
docker compose up --build
```
This boots up the **Next.js frontend** (port 3000), **Node.js backend** (port 5001), **PostgreSQL database**, and **Redis cache**.

### Step 2: Establish QuickBooks OAuth Connection
Go to `http://localhost:3000` in your browser and click **"Connect QuickBooks"**. Complete the Intuit login flow to authorize the application. This securely stores the active token in PostgreSQL.

### Step 3: Run ngrok for QuickBooks Webhooks
Since QuickBooks needs to send webhooks to your local machine, run `ngrok` (outside Docker, on your host Mac):
```bash
ngrok http 5001
```
Copy the secure `https://...` address.

### Step 4: Configure Webhooks in QuickBooks Developer Portal
1. Go to your Intuit App Dashboard -> **Webhooks**.
2. Paste your ngrok URL with the path: `https://<your-ngrok-subdomain>.ngrok-free.dev/api/webhook/quickbooks`
3. Under **Select entities**, check **Invoice** (Create, Update, Delete, Void).
4. Save, copy the **Verifier Token**, and add it to your `backend/.env` as `QB_VERIFIER_TOKEN`.
5. Restart backend container: `docker compose restart backend`.

---

## 🧪 Testing & Diagnostics

* **Health Check:** `http://localhost:5001/health`
* **Local Webhook Test Suite:** Execute tests inside the running backend container:
  ```bash
  docker compose exec backend node src/test-webhook.js
  ```
* **Manual Invoice Sync:** Simulate a webhook push for an invoice ID (e.g. `txnId=XYZ` in the QBO URL):
  ```
  http://localhost:5001/api/test/sync-invoice?id=<INVOICE_ID>
  ```
* **Manual Overdue Scanner Trigger:**
  ```
  http://localhost:5001/api/test/scan-overdue
  ```
