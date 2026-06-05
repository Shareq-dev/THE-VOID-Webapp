# THE-VOID-Webapp / THE-VOID

THE VOID is a dark-theme, mobile-first wallpaper sharing web application built for creators and wallpaper lovers. I built it as a curated platform where users can browse approved mobile wallpapers, create creator accounts, upload wallpapers through a custom preview editor, and manage their public creator profiles. It's a passion project developed independently.

The app is designed around a simple idea: uploaded wallpapers should not go live immediately. Every wallpaper goes through an admin review flow first, and only approved wallpapers appear in the public gallery. This keeps the gallery curated while still giving creators a smooth way to submit and manage their work.

The project uses a vanilla frontend, a native Node.js backend, Supabase Postgres, Supabase Storage, Sharp image processing, and Render deployment support.

---

## App link

[the-void-zv1k.onrender.com](https://the-void-zv1k.onrender.com/)

---

## Overview

THE VOID is a full-stack wallpaper community app with a dark-theme interface and a mobile-first layout. It focuses mainly on mobile wallpapers, creator profiles, controlled uploads, optimized image delivery, and admin moderation.

Users can browse approved wallpapers publicly, but downloads require a logged-in creator session. Creators can sign up, upload wallpapers, update profile details, change passwords, manage their own wallpapers, and delete their profile if needed.

Admins manage the private moderation side of the platform. They can review pending wallpapers, approve or reject uploads, edit wallpaper metadata, manage users, remove upload limits for selected creators, and clean stale session or signup locks.

The production version uses Supabase for database and storage. For local development, the backend can fall back to local JSON files and local media storage when Supabase environment variables are not configured.

---

## Main Features

### Public Wallpaper Gallery

The public gallery displays only approved wallpapers. Each wallpaper card includes the wallpaper title, creator name, optimized preview image, and available actions.

The gallery is optimized for mobile use. Wallpaper images are served using smaller thumbnail and preview variants where possible, so the homepage does not load full-size images unnecessarily. The feed also uses batched loading behavior instead of rendering every wallpaper at once.

Full-size wallpaper downloads are served through the backend and require a logged-in creator session.

### Creator Accounts

THE VOID uses a custom username and password account system. Creator usernames are normalized, unique, and permanent after signup.

Passwords are stored as salted `crypto.scrypt` hashes. Signup also requires agreement to the Terms of Service and Privacy Policy before an account can be created.

Creators can log in through the same account modal used for signup.

### Creator Profiles

Every creator has a public profile page that shows their username, profile picture, joined date, upload count, and wallpaper grid.

Creators can manage their own profile after logging in. They can upload or change their profile picture, change their password after confirming the current password, edit the titles of their own wallpapers, delete their own wallpapers, and delete their full profile after password confirmation.

Public creator profiles can also be found through username lookup and creator search.

### Wallpaper Upload Editor

The upload flow includes a browser-side mobile wallpaper editor. The editor uses a 9:16 preview format and is designed around mobile wallpaper sizes such as `1080x1920` and `1440x2560`.

Supported upload formats are PNG, JPG, and WEBP. Wallpaper uploads are limited to 12 MB.

The editor includes crop and zoom controls, horizontal and vertical positioning controls, a grid toggle, reset controls, and preview presets for lock-screen and home-screen views.

After a creator submits a wallpaper, the backend validates the file, cleans and re-encodes it, stores it, and creates a pending wallpaper record for admin review.

### Admin Moderation

The admin dashboard is available at `/admin` and is protected by the server-side admin password.

Admins can review the pending wallpaper queue, approve or reject submissions, edit wallpaper title and creator metadata, delete wallpapers from the app, search creator accounts, delete creator accounts completely, remove or restore upload limits for selected users, and clean stale or orphaned locks.

This moderation layer is one of the main parts of the project because it keeps the public gallery controlled and prevents unreviewed uploads from appearing automatically.

### Search

The app includes a full-screen search modal opened from the top-left menu.

Search supports normal wallpaper search and creator search using `@username`. Public profile lookup is handled through backend API endpoints.

### Legal Pages

The project includes public legal pages:

```text
public/terms.html
public/privacy.html
```

Users must agree to these pages before creating a creator account.

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | HTML, CSS, vanilla JavaScript |
| Backend | Native Node.js HTTP server |
| Database | Supabase Postgres |
| File Storage | Supabase Storage |
| Image Processing | Sharp |
| Hosting | Render |
| Authentication | Custom username/password sessions |
| Local Development Storage | JSON files and local uploaded media directory |

The backend does not use Express. It is implemented directly with Node.js using the built-in `http` module.

---

## Architecture

```text
Browser
  |
  | Static HTML/CSS/JS and API requests
  v
Node server.js
  |
  | Database, storage, sessions, uploads, moderation
  v
Supabase Postgres and Supabase Storage
```

The browser handles the interface, previews, modals, search UI, profile UI, gallery rendering, and upload editor. The backend handles authentication, sessions, upload validation, image processing, admin actions, Supabase access, local fallback persistence, and media routes.

Supabase service role credentials are kept only on the server. The frontend never receives the Supabase service role key.

All uploads go through the backend instead of going directly from the browser to Supabase. This allows the server to validate image type and size, process the image with Sharp, create optimized variants, and store clean files.

State-changing API requests include origin checks so random external pages cannot easily trigger sensitive actions against the app.

---

## Project Structure

```text
.
├── package.json
├── render.yaml
├── server.js
├── supabase/
│   └── schema.sql
├── public/
│   ├── index.html
│   ├── admin.html
│   ├── terms.html
│   ├── privacy.html
│   ├── styles.css
│   ├── app-state.js
│   ├── app-search-auth.js
│   ├── app-profile.js
│   ├── app-editor.js
│   ├── app-gallery.js
│   ├── app-boot.js
│   ├── admin.js
│   └── script.js
├── .env.example
├── .gitignore
└── README.md
```

### Important Files

| File | Purpose |
| --- | --- |
| `server.js` | Main Node.js backend. Handles API routes, sessions, uploads, Supabase/local persistence, admin actions, and media routes. |
| `public/index.html` | Main public app shell. |
| `public/styles.css` | Dark responsive UI, mobile layout, modals, gallery styling, and admin styling. |
| `public/app-state.js` | Shared frontend state, browser keys, login helpers, modal helpers, and account menu helpers. |
| `public/app-search-auth.js` | Signup/login modal, legal agreement flow, creator search, and wallpaper search behavior. |
| `public/app-profile.js` | Own profile UI, public profile UI, avatar upload, profile edit/delete, and creator wallpaper management. |
| `public/app-editor.js` | Wallpaper file selection, 9:16 canvas editor, crop/zoom/position controls, and upload submit flow. |
| `public/app-gallery.js` | Public wallpaper feed, batched rendering, preview modal, download flow, and mobile performance handling. |
| `public/app-boot.js` | Starts the frontend app with `init()`. |
| `public/admin.html` | Admin dashboard shell. |
| `public/admin.js` | Admin login, moderation queues, wallpaper management, user management, and upload-limit controls. |
| `supabase/schema.sql` | Database tables, triggers, indexes, storage buckets, and storage read policies. |
| `render.yaml` | Render web service configuration. |

`public/script.js` is kept only as a compatibility note. The active frontend code is split across the `app-*.js` files.

---

## How the App Works

### Creator Flow

1. A user opens the app.
2. The user opens the Signup/Login modal from the menu.
3. During signup, the app validates the username, password, and legal agreement.
4. The backend creates the creator account and starts a creator session.
5. The creator selects a wallpaper image.
6. The image opens inside the 9:16 wallpaper editor.
7. The creator adjusts crop, zoom, and position.
8. The creator submits the wallpaper.
9. The backend validates, processes, stores, and records the upload as pending.
10. The admin reviews the pending wallpaper.
11. If approved, the wallpaper appears in the public gallery and on the creator profile.

### Admin Flow

1. Admin opens `/admin`.
2. Admin logs in using the configured admin password.
3. Admin reviews pending wallpaper submissions.
4. Admin approves or rejects uploads.
5. Admin can edit wallpaper metadata or delete wallpapers.
6. Admin can search and manage creator accounts.
7. Admin can remove or restore upload limits for specific creators.
8. Admin can clean stale active-session or signup locks.

---

## Local Setup

### Requirements

- Node.js 18+
- npm
- Supabase project for production-like testing

### Install Dependencies

```bash
npm install
```

### Configure Environment Variables

Create a local `.env` file from the example file:

```bash
cp .env.example .env
```

Fill in the required Supabase and admin values.

Node.js does not automatically load `.env` files unless the runtime environment or a loader handles it. For local testing, environment variables can be exported directly in the shell before starting the app.

Example:

```bash
export SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
export SUPABASE_BUCKET="wallpapers"
export SUPABASE_PROFILE_BUCKET="profile-pics"
export THE_VOID_ADMIN_PASSWORD="your-strong-admin-password"
export THE_VOID_IP_HASH_SECRET="your-long-random-secret"
npm start
```

### Start the App

```bash
npm start
```

Default local URL:

```text
http://localhost:4173
```

Admin page:

```text
http://localhost:4173/admin
```

### Local Fallback Mode

When Supabase variables are missing and the app is not running on Render, the backend can use local development storage.

Default local data locations:

```text
macOS/Linux: ~/.the-void/data
Windows: %LOCALAPPDATA%\THE-VOID\data
Custom: THE_VOID_DATA_DIR
```

Local data, uploaded files, generated media, and user JSON files should stay out of the repository.

---

## Supabase Setup

The Supabase schema is stored in:

```text
supabase/schema.sql
```

To set up Supabase:

1. Open the Supabase project.
2. Go to SQL Editor.
3. Paste the contents of `supabase/schema.sql`.
4. Run the SQL.
5. Confirm that the required Storage buckets exist.

Required buckets:

| Bucket | Purpose | Public | Limit |
| --- | --- | --- | --- |
| `wallpapers` | Wallpaper uploads and generated variants | Yes | 12 MB |
| `profile-pics` | Creator profile pictures | Yes | 5 MB |

The schema attempts to create or update the buckets. If bucket creation from SQL is blocked in the Supabase project, the buckets can be created manually from Supabase Storage.

### Supabase Tables

| Table | Purpose |
| --- | --- |
| `public.users` | Stores custom creator accounts and profile metadata. |
| `public.wallpapers` | Stores wallpaper metadata, creator ownership, storage paths, and moderation status. |
| `public.app_settings` | Stores JSON-backed operational settings such as sessions, lockouts, upload-limit exemptions, and sync markers. |

---

## Environment Variables

### Required for Production

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase service role key for database and Storage writes. |
| `SUPABASE_BUCKET` | Wallpaper bucket name. Usually `wallpapers`. |
| `SUPABASE_PROFILE_BUCKET` | Profile picture bucket name. Usually `profile-pics`. |
| `THE_VOID_ADMIN_PASSWORD` | Password for the private admin dashboard. |
| `THE_VOID_IP_HASH_SECRET` | Long stable secret used to hash IP/browser identifiers. |

### Main Optional Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `THE_VOID_AUTO_SYNC_STORAGE` | `true` | Recovers Storage images into `public.wallpapers` on startup when database rows are missing. |
| `THE_VOID_ADMIN_LOGIN_MAX_FAILED_ATTEMPTS` | `2` | Wrong admin login attempts before lock. |
| `THE_VOID_ADMIN_LOGIN_LOCK_MS` | `10800000` | Admin lock window in milliseconds. Default is 3 hours. |
| `THE_VOID_USER_LOGIN_MAX_FAILED_ATTEMPTS` | `4` | Wrong user login attempts before device/browser lock. |
| `THE_VOID_USER_LOGIN_LOCK_MS` | `1800000` | User login lock window in milliseconds. Default is 30 minutes. |
| `THE_VOID_UPLOAD_LIMIT_PER_24H` | `4` | Wallpaper submissions allowed per creator per 24 hours. |
| `THE_VOID_ACTIVE_SESSION_IDLE_MS` | `1800000` | Active session stale-lock window. Default is 30 minutes. |

### Additional Optional Variables

| Variable | Purpose |
| --- | --- |
| `THE_VOID_ALLOWED_ORIGINS` | Comma-separated list of additional trusted origins for custom domains. |
| `THE_VOID_ENFORCE_ONE_ACCOUNT_PER_IP` | Controls one-account-per-IP/device enforcement. |
| `THE_VOID_FORCE_BUNDLE_SEED` | Allows bundled wallpapers to be re-seeded intentionally. |
| `THE_VOID_DATA_DIR` | Custom local fallback data directory. |
| `THE_VOID_WALLPAPER_CACHE_MS` | Cache duration for approved wallpaper API responses. |
| `THE_VOID_ADMIN_PASSWORD_HASH` | Optional SHA-256 hash alternative for admin password verification. |
| `THE_VOID_SUPABASE_URL` | Alternative env name for `SUPABASE_URL`. |
| `THE_VOID_SUPABASE_SERVICE_ROLE_KEY` | Alternative env name for `SUPABASE_SERVICE_ROLE_KEY`. |
| `THE_VOID_SUPABASE_BUCKET` | Alternative env name for `SUPABASE_BUCKET`. |
| `THE_VOID_PROFILE_BUCKET` | Alternative env name for `SUPABASE_PROFILE_BUCKET`. |

---

## Render Deployment

The repository includes `render.yaml` for Render deployment.

### Render Service Settings

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Plan | Free or higher |

### Deployment Flow

1. Push the repository to GitHub.
2. Create a Render Web Service from the GitHub repository.
3. Add the required environment variables in Render.
4. Run `supabase/schema.sql` in Supabase.
5. Confirm that the `wallpapers` and `profile-pics` buckets exist and are public.
6. Deploy the Render service.
7. Open the public site.
8. Open `/admin` and log in.
9. Visit `/api/admin/storage` after admin login to confirm backend and storage status.

When configured correctly, the storage status should show production Supabase mode.

---

## Admin Dashboard

The admin dashboard is available at:

```text
/admin
```

The admin password is read from:

```text
THE_VOID_ADMIN_PASSWORD
```

### Admin Sections

| Section | Purpose |
| --- | --- |
| Approval Queue | Review pending wallpaper submissions before they go public. |
| Existing Wallpapers | Edit, download, or delete approved wallpapers. |
| User IDs | Search and manage creator accounts. |

### Admin User Management

The admin can manage creators from the `@User IDs` section.

Admin actions include searching users, checking upload counts and lock indicators, removing the 24-hour upload limit for a selected user, restoring the normal upload limit, deleting a creator account completely, and cleaning stale or orphaned locks.

Complete user deletion removes the user row, user wallpapers, profile picture, active session lock, signup IP/browser lock for that user, and related Storage files where possible.

Upload-limit exemptions are stored in `public.app_settings` under `upload_limit_exemptions`.

---

## API Endpoints

### Auth and Profile

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/signup` | Create a creator account or log in when matching credentials are provided. |
| `POST` | `/api/auth/login` | Log in with username and password. |
| `POST` | `/api/auth/logout` | End the current creator session. |
| `POST` | `/api/auth/change-password` | Change password after verifying the current password. |
| `GET` | `/api/profile` | Load the current creator profile. |
| `POST` | `/api/profile/avatar` | Upload or change profile picture. |
| `POST` | `/api/profile/delete` | Delete own profile after password confirmation. |
| `POST` | `/api/profile/wallpapers/<id>/update` | Update the title of an owned wallpaper. |
| `POST` | `/api/profile/wallpapers/<id>/delete` | Delete an owned wallpaper. |

### Public Users and Wallpapers

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/users/search?q=` | Search public creator profiles. |
| `GET` | `/api/users/<username>` | Load public creator profile. |
| `POST` | `/api/upload` | Submit wallpaper for admin approval. |
| `GET` | `/api/wallpapers` | List approved wallpapers. |
| `GET` | `/api/download/<id>` | Download full-size stored wallpaper. Login required. |
| `GET` | `/media/<id>?variant=thumb` | Serve public thumbnail variant when available. |
| `GET` | `/media/<id>?variant=preview` | Serve public preview variant when available. |
| `GET` | `/media/<id>` | Serve full-size or fallback media. |

### Admin

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/admin/login` | Admin login. |
| `POST` | `/api/admin/logout` | Admin logout. |
| `GET` | `/api/admin/pending` | List pending wallpapers. |
| `GET` | `/api/admin/storage` | Show backend/storage status. |
| `POST` | `/api/admin/wallpapers/<id>/approve` | Approve pending wallpaper. |
| `POST` | `/api/admin/wallpapers/<id>/reject` | Reject pending wallpaper. |
| `POST` | `/api/admin/wallpapers/<id>/delete` | Delete or reject wallpaper from the app. |
| `POST` | `/api/admin/wallpapers/<id>/update` | Edit wallpaper title or creator metadata. |
| `GET` | `/api/admin/users` | List or search users. |
| `POST` | `/api/admin/users/<creatorId>/upload-limit` | Toggle unlimited uploads for a selected creator. |
| `POST` | `/api/admin/users/<creatorId>/delete` | Delete a complete user/profile. |
| `POST` | `/api/admin/users/cleanup-stale-locks` | Clean stale or orphaned locks. |

### Compatibility Endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/check-username` | Legacy username availability check. |
| `POST` | `/api/create-user` | Legacy user creation route. |

---

## Database and Storage Model

### `public.users`

The `public.users` table stores creator accounts and profile metadata.

Important fields:

| Field | Purpose |
| --- | --- |
| `creator_id` | Unique creator ID. |
| `creator_name` | Display username. |
| `creator_name_key` | Normalized username key. |
| `auth_type` | Account/auth type marker. |
| `password_hash` | Hashed password. |
| `password_salt` | Password salt. |
| `signup_ip_hash` | Hashed signup IP identifier. |
| `browser_key_hash` | Hashed browser/device identifier. |
| `profile_pic_path` | Storage path for profile picture. |
| `profile_pic_url` | Public profile picture URL. |
| `created_at` | Account creation timestamp. |
| `last_login_at` | Last login timestamp. |
| `updated_at` | Last update timestamp. |

### `public.wallpapers`

The `public.wallpapers` table stores wallpaper metadata and moderation state.

Important fields:

| Field | Purpose |
| --- | --- |
| `id` | Unique wallpaper ID. |
| `title` | Wallpaper title. |
| `creator` | Creator display name. |
| `creator_id` | Linked creator ID. |
| `auth_type` | Upload/auth type marker. |
| `storage_path` | Supabase Storage path. |
| `public_url` | Public media URL. |
| `mime` | Stored media MIME type. |
| `status` | Moderation status. |
| `created_at` | Upload timestamp. |
| `approved_at` | Approval timestamp. |
| `updated_at` | Last update timestamp. |

Supported wallpaper statuses:

```text
pending
approved
rejected
```

### `public.app_settings`

The `public.app_settings` table stores JSON-backed operational settings.

It is used for active creator session locks, admin login protection, user login protection, upload-limit exemptions, storage sync markers, and seed markers.

### `wallpapers` Storage Bucket

The `wallpapers` bucket stores wallpaper media and generated image variants.

Typical paths:

```text
uploads/<wallpaper-id>.webp
thumbs/<wallpaper-id>.webp
previews/<wallpaper-id>.webp
seed/<filename>
```

New uploaded wallpapers are validated and re-encoded by the server. Recovered or seeded files may remain JPG, PNG, or WEBP depending on the original object.

### `profile-pics` Storage Bucket

The `profile-pics` bucket stores creator avatar images.

Typical path:

```text
<creator-id>/<profile-picture-id>.webp
```

---

## Security

The project includes several security-focused controls for authentication, uploads, admin access, and browser requests.

Main protections:

- Supabase service role key is used only in `server.js`.
- Browser code never receives the service role key.
- Passwords are salted and hashed with `crypto.scrypt`.
- Admin password verification uses a hash comparison flow.
- Creator sessions are stored in HTTP cookies and server memory.
- One active session per creator account is enforced through `app_settings.active_user_sessions`.
- Render cold-start recovery can rehydrate a valid session when the browser cookie matches the active session lock.
- Stale active-session locks expire after the configured idle window.
- User login lockouts protect against repeated wrong passwords per browser/device.
- Admin login lockouts protect the admin dashboard.
- Signup can enforce one creator profile per IP/browser/device.
- State-changing `/api/` requests require same-origin/origin validation.
- Security headers include CSP, frame blocking, `nosniff`, referrer policy, permissions policy, and HSTS.
- Uploaded wallpapers and profile pictures are decoded and re-encoded with Sharp.
- Corrupt, fake, unsupported, or oversized images are rejected.
- Upload limits restrict normal creators to a configurable number of submissions per 24 hours.

Secrets and environment files should not be committed to the repository. This includes `.env`, Supabase keys, real admin passwords, live user data, generated uploads, and real profile pictures.

---

## Performance

THE VOID includes several mobile-focused performance improvements.

The frontend is split by responsibility instead of keeping everything in one large script. Wallpaper cards use lighter image variants, and the public feed renders in batches. Images use lazy loading and async decoding where appropriate.

Generated image sizes:

| Variant | Size | Format |
| --- | --- | --- |
| Thumbnail | 360x640 | WEBP |
| Preview | 720x1280 | WEBP |
| Full media | Server-cleaned original-size output | WEBP for new uploads |

The preview modal clears stale canvas content before loading a new image, ignores stale async preview loads, and reduces heavy mobile animation work. Native mobile scrolling is preserved instead of using fake smooth-scroll behavior.

Approved wallpaper API responses can also use a short server-side cache window through `THE_VOID_WALLPAPER_CACHE_MS`.

---

## Troubleshooting

### Wallpapers exist in Supabase Storage but do not show in the app

Check that `supabase/schema.sql` has been run, `SUPABASE_URL` is set, `SUPABASE_SERVICE_ROLE_KEY` is set, `SUPABASE_BUCKET` is correct, `THE_VOID_AUTO_SYNC_STORAGE=true`, and the Render service has been restarted after environment variable changes.

The app can scan the public Storage bucket on startup and create missing `public.wallpapers` rows for image objects.

### `/api/admin/storage` says tables are missing

Run the schema:

```text
supabase/schema.sql
```

Then redeploy or restart the server.

### `/api/admin/storage` says bucket is missing

Create these public buckets in Supabase Storage:

```text
wallpapers
profile-pics
```

Custom bucket names can also be set with:

```text
SUPABASE_BUCKET
SUPABASE_PROFILE_BUCKET
```

### Signup says creator profile already exists on this IP

This happens when one-account-per-IP/device enforcement is enabled.

The existing account can be used from that device, the admin can delete the old account if it should be removed, or shared-IP account creation can be allowed by setting:

```text
THE_VOID_ENFORCE_ONE_ACCOUNT_PER_IP=false
```

### Login says profile is already logged in on another device

The app enforces one active session per creator account.

The creator can log out from the other device, wait for the active-session idle window to expire, or the admin can clean stale locks from the admin dashboard.

### Admin is locked after wrong attempts

Default admin lock behavior is 2 wrong attempts with a 3-hour lock window.

These values are controlled by:

```text
THE_VOID_ADMIN_LOGIN_MAX_FAILED_ATTEMPTS
THE_VOID_ADMIN_LOGIN_LOCK_MS
```

### Upload limit reached

By default, normal creators can submit 4 wallpapers per 24 hours.

This value is controlled by:

```text
THE_VOID_UPLOAD_LIMIT_PER_24H
```

The admin can also remove or restore the upload limit for a specific creator from `/admin`.

---

## Repository Safety

The repository should not include real secrets, real user data, generated uploads, or private production files.

Keep these out of version control:

```gitignore
node_modules/
.env
.env.*
!.env.example
data/
uploads/
profile-pics/
*.log
*.tmp
*.bak
*.old
*.backup
.DS_Store
.vscode/
.idea/
```

---

## Contact

Project: **THE VOID**

App support email:

```text
thevoid.support4u@gmail.com
```

LinkedIn profile:

```text
linkedin.com/in/syed-roshan-shareq-4408a7336/
