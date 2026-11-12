# Setup Guide — Vacancy Tracker

## Architecture

- **SQL (PostgreSQL)** stores ALL application data: rooms, beds, tenants,
  contracts, viewer/central access, Super Admin data, and the AI assistant's
  conversations, messages, insights and config.
- **Firebase Authentication** holds ONLY the generated login
  (`yourname@vecancy.tracker` + password). No application data is in Firebase.
- **`server/`** (Python/Flask) serves the pages and the JSON API. It verifies
  the Firebase ID token on every request, takes the user id only from that
  token, and enforces the same authorization the old `firestore.rules` did.
  Database credentials never reach the browser.
- One shared login (`auth-ui.js`) is used by `index.html`, `viewer.html`,
  `superadmin.html` and `marketing.html`.

## Accounts

- **Create Account:** prove your Google account or email (Google popup or an
  emailed sign-in link), pick a name, and set a password. The system creates
  the unique username `name@vecancy.tracker`. A taken name is refused with
  "This name was taken."
- **Sign in:** generated username + password only. Your Google password is
  never requested or stored.
- **Update Account:** verify the original Google/email, see your username
  (it never changes), and set a new password.
- The original email is kept only in the SQL `accounts` table and is never
  shown to other users.

## Setup

1. **Firebase (Authentication only).** In the Firebase Console enable
   **Email/Password**, **Email link (passwordless)** and **Google** under
   Authentication → Sign-in method. Add your hosting domain under
   Authentication → Settings → Authorized domains. Put the web config in
   `firebase-config.js`. You do not need Firestore, Functions or Hosting, so
   there is nothing to pay for.
2. **Database.** Create a free hosted PostgreSQL database (Neon, Supabase,
   etc.) and apply the schema:
   `psql "$DATABASE_URL" -f server/schema.sql`
3. **Server environment variables** (set on the server, never in the browser):
   - `DATABASE_URL`: the PostgreSQL connection string.
   - `FIREBASE_SERVICE_ACCOUNT_JSON`: the Firebase service-account JSON
     (Project settings → Service accounts → Generate new private key).
4. **Install and run:**
   `pip install -r requirements.txt` then
   `python server/app.py` (or, on a host: `gunicorn --chdir server "app:create_app()" --bind 0.0.0.0:$PORT`).
   Open the printed address; serve over HTTPS in production.
5. **Migrating existing Firestore data** (do this before anyone relies on the
   new system; nothing is deleted from Firebase):
   `python server/migrate_firestore.py export backup.json` then
   `python server/migrate_firestore.py import backup.json`.
   Import is all-or-nothing and re-reads every record to confirm it matches.
   Existing users keep their data: when they create their new account the
   same internal user id is reused. Keep the old Firestore data until you have
   checked the result. The old rules and function are kept in `legacy/`.

## Built-in Python tracker assistant (no AI API key)

The assistant uses a small, deterministic Python rule engine, not a Gemini,
OpenAI, or other language-model API. There is no model API key, model token
charge, or model call. It recognizes a practical set of tracker questions,
explains actual screens/workflows, reports facts from the signed-in user's
current SQL records, and refuses questions outside this application.
It is intentionally limited: it does not understand arbitrary requests like a
large language model and may ask for a room number or other detail when a
request is ambiguous.

The assistant runs inside the Python server (`/api/assistant`, code in
`server/ai.py`). It verifies the sign-in token, reads only the signed-in
user's SQL records, and never writes data. Conversations, messages, insights
and config are stored in the SQL tables `ai_conversations`, `ai_messages`,
`ai_insights` and `ai_config`, tied to the user's internal user id. For a
change, the browser shows a preview and requires confirmation before passing
the request to the tracker's existing validated workflow. It is rate-limited,
never accepts a model-generated database query, and no resident notes leave
the server. There is no AI provider key anywhere. Nothing extra to deploy:
it starts with `python server/app.py`.

## Importing sample rooms

`seed-data.js` holds real resident names, so `firebase.json` excludes it (and
`practice.html`) from deployment. The **Import my existing rooms** button is
therefore hidden on the live site and only works when you open the project
from your own computer (for example `firebase serve` or a local web server).

## Overdue reminders, reservations and tenant history

- **Overdue tenants** stay marked *Overdue* until the admin acts. A reminder
  panel at the top of the Room Canvas lists them with **Extend** and
  **Check out** buttons.
- **Reserving a bed:** the admin chooses the bed for each incoming client. The
  scan lists compatible vacant beds and scheduled checkouts. The list shows
  when the current tenant leaves compared with the client's arrival. If the
  tenant leaves after the client arrives, the admin must confirm.
- **Extending a stay** on a bed that has a reservation asks the admin to
  cancel that reservation first; the client returns to *Searching*.
- **Tenant History** keeps tenants who were checked out, removed or replaced
  for 30 days. The app deletes expired records automatically (at most once an
  hour while someone is signed in).

## Main workflows

- **Theme:** Use the moon/sun control on the sign-in screen or workspace header
  to switch between light and dark mode. The choice is saved in this browser.
- **Rooms and beds:** Add or edit a room from the Room Canvas or Hallway Layout.
  Room settings include gender, resident-group zoning, tenancy mode, capacity,
  AC status, and bed/resident details. The app prevents deleting occupied or
  reserved rooms and protects linked temporary-client assignments.
- **Shared views:** Room Canvas, Hallway Layout, Bed Matrix, Analytics,
  Checkout Schedule, and Reserved Clients share the live room KPIs and
  search/status/gender filters. The checkout schedule shows three months and
  filters by departure proximity.
- **Reservations:** Use **Reserve Clients** to record an incoming client,
  target check-in, resident group, and optional preferred bed. Confirm an
  eligible reservation from the matching checkout.
- **Temporary stays:** Use **Temporary Dorm Clients** to assign a compatible
  vacant bed. Check the guest out from the same tab to release it.
- **Transfers:** Use a resident's transfer action and select a compatible
  vacant bed. Transfers preserve resident and contract data and append an
  audit entry.
- **Hallway layout:** Unlock the layout before moving rooms. Add or edit
  facilities and walkways with the shape controls.

The Python assistant can answer questions about these existing features and
basic live counts. Its action support is deliberately limited to the action
types and fields accepted by `assistant.js`; unsupported or ambiguous requests
should be completed using the normal application interface.

## Project layout

`app.js` was split into smaller files in `js/`, loaded in this order by
`index.html` (the order matters, and `99-main.js` must stay last):

| File | What it holds |
|---|---|
| `js/proof.js` | Shared code + password fingerprint helper (also used by the viewer page) |
| `js/01-state.js` | Shared settings and in-memory data |
| `js/02-auth-boot.js` | Start-up, sign in / sign up, login screen |
| `js/03-clock-and-sync.js` | Live clock and data sync (SQL polling) |
| `js/04-helpers.js` | Date parsing, bed status, vacancy and matching rules |
| `js/05-dashboard.js` | Original room dashboard rendering |
| `js/06-rooms.js` | Add / edit / delete rooms |
| `js/07-transfers.js` | Resident transfers |
| `js/08-temporary-clients.js` | Bed pickers and temporary dorm clients |
| `js/09-hallway.js` | Hallway layout |
| `js/10-analytics-calendar.js` | Original analytics, matrix, checkout calendar rendering |
| `js/11-reservations.js` | Reserve Clients tab |
| `js/12-overdue-history.js` | Overdue reminders, check-out, extend stay, tenant history |
| `js/13-viewer-access.js` | Admin side of viewer access |
| `js/14-canvas-tabs.js` | Active Room Canvas, Bed Matrix, Analytics and Checkout Schedule views |
| `js/99-main.js` | Tabs, button wiring, `boot()` |

The old `app.js` is no longer used. Delete it from your project folder.

## Viewer access (read-only vacancy page)

1. Sign in as the admin and open the **Viewer Access** tab.
2. Choose a **dorm code** and a **password** (8+ characters) and turn it on.
3. Give viewers the link to `viewer.html`, the code and the password.
4. A viewer opens the page, signs in with the generated username and password, enters
   the code and password, and sees a read-only vacancy list, hallway layout, and summary
   analytics. The viewer asks for the dorm code and password again on each visit. It never receives
   resident names, personal details, or checkout dates: the admin app publishes
   name-free room counts to `dorms/{code}/vacancy` and sanitized hallway data
   to `dorms/{code}/layout/public`.
5. In the same tab the admin can see everyone who joined, **Remove** a viewer
   (they lose access immediately and cannot rejoin until you choose
   **Allow again**), pause access, change the password (this removes all
   current viewers) or turn viewer access off completely.

Notes:

- Vacancy counts and hallway layout are updated while an admin has the app open. If nobody has
  it open, viewers see the last published state.
- Pausing access stops new joins and new page loads. A viewer who already has
  the page open may keep seeing live data until they reload it.
- The password is never stored. Only a one-way fingerprint is kept, and only
  the admin account can read it. Choose a long password and a code that is
  hard to guess; anyone who knows both can join.
- Each admin account has one dorm code. The code can be 4-30 characters
  (letters, numbers, dashes) and must be unused.
- Viewers sign in with the shared username/password login, then enter the
  dorm code and password on the read-only viewer page.
- Dorm owners see a viewer's generated username only, never their original
  email.

## Testing access control

Authorization lives in `server/rules.py` and is covered by
`python -m pytest server/tests` (plus `node server/tests/client_test.mjs`
against a test server). After deploying, with two accounts (one admin, one viewer):

1. Viewer with the wrong password cannot join.
2. Viewer with the right password joins and sees the room list.
3. Viewer cannot read another user's records (the API returns "denied").
4. Admin removes the viewer: the viewer page shows "Access ended" and joining
   again fails. **Allow again** restores access.
5. Viewer cannot edit rooms or the hallway.
