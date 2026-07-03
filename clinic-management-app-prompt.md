# Clinic Management App — Build Prompt

Copy everything below into Antigravity as your build prompt.

---

## Project Overview

Build a full-stack **Clinic Management System** for a small clinic (~50 patients/day) with two connected devices on the same local network:

1. **System 1 — Doctor's PC** (main/server system, source of truth)
2. **System 2 — Pharmacist's PC** (client system, depends on System 1)

Both systems talk to a shared backend and database running on the Doctor's PC. Communication must be **low-latency and non-buffering** — use **WebSockets** for real-time updates (e.g., prescription sent from doctor should appear instantly on the pharmacist's screen) and **REST APIs** for standard data operations (patient lookup, billing, inventory).

---

## Tech Stack (suggested — adjust if Antigravity has defaults)

- **Backend**: FastAPI (Python) or Node.js/Express — runs on the Doctor's PC, exposes REST + WebSocket endpoints
- **Database**: SQLite (sufficient at this scale, single-file, easy to back up)
- **Frontend**: React (web app) served to both PCs via browser — no need for separate native apps. Doctor and Pharmacist see different views/routes based on role.
- **Networking**: Backend binds to the local network IP. Primary connection over **LAN (Ethernet)**, with a **Wi-Fi fallback** — both should work identically since it's the same local network, just document both connection methods in a settings/help screen.
- **Auth**: Simple username + hashed password (bcrypt) login, session token stored securely (HTTP-only cookie or JWT).

---

## Login Page (shared entry point)

- Role selector: **Doctor** or **Pharmacist**
- Username + password fields
- Passwords stored hashed (never plaintext) — bcrypt or argon2
- Session persists until logout; auto-logout after inactivity (configurable, e.g. 30 min)
- On successful login, redirect to the relevant dashboard (Doctor dashboard or Pharmacist dashboard)

---

## Hospital Branding

- Clinic: **Abhaya Medical Care** ("Compassion... Care... Cure...") — Dr. Ravishaa A.
- Logo: a heart + pulse-line + hand motif in white/red on a navy blue background, with a matching navy blue banner used site-wide.
- Add a settings section (admin/doctor-only) where clinic name, logo, address, and contact details can be edited later if needed — but seed the app with the above details by default.
- Header color scheme: navy blue background (`#1a2560`-ish) with white text, matching the physical clinic signboard. Logo appears top-left of the header, clinic name + tagline centered/next to it.
- These details appear in the header ("hospital details" bar, see layout below) of both the Doctor and Pharmacist views, and on the printed/exported daily bill.
use the deatils from board.png for reference 

## Screen Layout (Doctor's Dashboard)

Follow this exact wireframe structure:

```
┌────────────────────────────────────────────────┐
│              HOSPITAL DETAILS (header)          │
├───────────────┬──────────────────────────────────┤
│ Patient Details│                                  │
├────────────────┤                                  │
│ Prescription   │                                  │
├────────────────┤        MAIN CONTENT PANEL        │
│ Previous Visits│     (shows whichever tab is       │
├────────────────┤      selected on the left)        │
│                │                                  │
│  (empty space  │                                  │
│  for future    │                                  │
│  tabs/nav)     │                                  │
│                │                                  │
└───────────────┴──────────────────────────────────┘
```

- **Top bar**: full-width header showing hospital details (logo, clinic name, tagline, doctor name)
- **Left sidebar (task bar)**: fixed vertical tab list — `Patient Details`, `Prescription`, `Previous Visits` (in this order, top to bottom). Leave room below for future tabs.
- **Main content panel**: large area to the right of the sidebar that renders the content for whichever tab is currently selected (defaults to Patient Details after a patient is looked up).
- This same header + sidebar + content-panel structure should be reused consistently across the Doctor's screens (and adapted with Pharmacist-relevant tabs — Calendar, Inventory, Billing — for System 2).

---

## SYSTEM 1 — Doctor's PC (Main System)

### Patient ID System
- Each patient gets a **unique ID assigned in lexicographic order** (e.g., sequential codes like `A001`, `A002`... `A999`, `B001`...) so IDs sort naturally and are easy to scan/type.
- Provide a **fast, prominent search bar** at the top of the doctor's dashboard — search by ID or name, with autocomplete/type-ahead so the doctor doesn't have to remember exact IDs.

### Patient Detail Screen
Once a patient ID is entered/selected, show their full record on screen with a **left-side task bar (tabs)**, matching the wireframe in the "Screen Layout" section below, containing (top to bottom):
1. **Patient Details** — name, age, gender, contact info, medical history, uploaded photo
2. **Prescription** — current/active prescription workspace (see below)
3. **Previous Visits** — chronological list of past visits with dates and notes

### Prescription Workflow
- When starting a new prescription, **pre-fill it with the patient's previous prescription** as the starting point (not blank) — doctor can then:
  - Delete any medicine from the list
  - Add new medicines (name, dosage, frequency, duration)
- **Final bill section** within the prescription screen:
  - Consultation fee, **minimum ₹400**
  - Fee adjustable via **+50 / −50 increment buttons** (cannot go below ₹400)
  - Bill total = consultation fee + any other itemized charges (leave room to extend later)
- Once finalized, prescription is sent (via WebSocket, real-time) to the Pharmacist's system for verification and billing.

### Recent/Frequent Visits View
- Separate view listing all visits **sorted by visit number/frequency** (i.e., patients who've visited most, ranked) — helps identify regular/chronic patients at a glance.

### Image Upload
- Allow image upload in **both** the Patient Details tab (e.g., ID proof, reports) and the Prescription tab (e.g., photo of a lab report or handwritten note to attach).
- Store images on disk (not in the DB directly), reference by file path in the database.

---

## SYSTEM 2 — Pharmacist's PC (Client System)

### 1. Appointment Calendar
- Calendar view to **set and manage appointments**
- **Hard cap of 45 appointments per day**
- Ability to **edit or cancel** existing appointment slots
- Visual indicator when a day is full

### 2. Medicine Inventory Management
- Full CRUD for medicines: add, edit, delete, view stock levels
- Track quantity on hand, reorder threshold (optional, nice-to-have), unit price
- This inventory list should be what populates the "add medicine" options on the Doctor's prescription screen (keep the two in sync)

### 3. Prescription Verification & Billing
- Pharmacist sees incoming prescriptions from the doctor **in real time** (WebSocket push, no manual refresh)
- Pharmacist **verifies** the prescription (checks stock, confirms medicines)
- Once verified, system calculates **total cost** (medicines + consultation fee from doctor's bill)
- Pharmacist marks payment method: **UPI or Cash**
- **End-of-day report**: total bills for the day, broken down into:
  - Total collected via Cash
  - Total collected via UPI
  - Grand total (Cash + UPI)
- Report should be viewable on-screen and ideally exportable/printable.

---

## Non-Functional Requirements

- **Performance**: Real-time doctor → pharmacist prescription handoff should feel instant (WebSocket, not polling). Avoid noticeable lag/buffering on the LAN.
- **Reliability**: If the pharmacist's PC briefly disconnects, it should reconnect automatically and sync any missed prescriptions rather than losing them.
- **Security**:
  - Role-based access — pharmacist cannot edit patient medical history; doctor's login is separate from pharmacist's.
  - All traffic should ideally run over HTTPS even on the LAN (self-signed cert is fine) rather than plain HTTP, since patient data is sensitive.
  - Local network only — no need for internet-facing exposure; document how to connect via LAN or Wi-Fi in a simple settings/help page.
- **Backups**: Daily automatic backup of the database file to a separate folder/drive.
- **Usability**: Large, clear buttons and text (clinic staff may not be highly technical). Minimize clicks to reach the patient search and prescription screens, since these are used dozens of times a day.

---

## Data Model (starting point)

```
Patient
  - id (lexicographic, e.g. A001)
  - name, age, gender, contact
  - photo_path
  - created_at

Visit
  - id
  - patient_id (FK)
  - date
  - doctor_notes
  - visit_number (for frequency sorting)

Prescription
  - id
  - visit_id (FK)
  - medicines: [{ name, dosage, frequency, duration }]
  - consultation_fee (default 400, step 50)
  - status: draft | sent | verified | billed
  - attached_image_path (optional)

Medicine (Inventory)
  - id
  - name
  - stock_quantity
  - unit_price

Bill
  - id
  - prescription_id (FK)
  - total_amount
  - payment_method: upi | cash
  - date
  - verified_by (pharmacist)

Appointment
  - id
  - patient_id (FK, optional if new patient)
  - date
  - time_slot
  - status: booked | completed | cancelled

User
  - id
  - username
  - password_hash
  - role: doctor | pharmacist
```

---

## Build Order (suggested)

1. Backend: set up DB schema, auth (login + roles), and core REST endpoints for patients/prescriptions/medicines.
2. WebSocket layer for real-time doctor → pharmacist prescription push.
3. Doctor frontend: login → search/patient detail screen with the three-tab task bar → prescription workflow with billing.
4. Pharmacist frontend: login → calendar, inventory, and verification/billing screen with daily cash/UPI report.
5. Polish: image upload, hospital branding header, connection settings (LAN/Wi-Fi help), backups.

---

**Note:** Fill in the `[Placeholder]` section above with exact details from your framework.png (layout, colors, hospital info fields) before or during the build — upload the image and describe the layout if Antigravity can't read images directly.
