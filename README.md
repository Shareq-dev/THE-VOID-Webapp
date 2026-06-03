## THE VOID

THE-VOID is a reference codebase for a dark theme wallpaper web app. It includes a static frontend, a native Node.js backend, Supabase database/storage support, creator profiles, image uploads, and an admin moderation flow.

This public repository is intentionally minimal. It contains the source needed to understand, run, and adapt the app, but it does **not** include production secrets, database exports, uploaded images, internal troubleshooting notes, deployment hooks, or live-service credentials.

## Includes 

- Creator signup/login with custom username + password accounts
- Creator profiles with profile picture, joined date, upload stats, and wallpaper grid
- 9:16 wallpaper editor/preview before upload  
- Admin dashboard for approving, rejecting, and deleting wallpapers  
- Supabase Postgres + Supabase Storage integration  
- Render deployment setup  
- `@username` creator search  
- Profile deletion with full database + Storage cleanup  

## Security & Reliability

- Server-side image validation using `sharp`
- Uploaded files are decoded, verified, and re-encoded into clean WEBP before storage  
- Corrupt/fake/polyglot image uploads are rejected
- Admin login lock after wrong attempts
- User login lock per browser/device after wrong attempts
- Upload limit per creator account every 24 hours
- One active session per account, with Render cold-start recovery
- Same-origin request protection and security headers
- Supabase service role key stays server-side only


## Stack

- Node.js 
- Native Node `http` server
- Static HTML, CSS, and JavaScript frontend
- Supabase Postgres and Storage
- Sharp image validation/re-encoding
- Render-ready deployment config


## Local setup

```bash
npm install
cp .env.example .env
npm start
```

For a real deployment, create your own Supabase project, run `supabase/schema.sql`, and set your own environment variables in your hosting provider.

## Required environment variables

Set these outside the repository:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_BUCKET=wallpapers
SUPABASE_PROFILE_BUCKET=profile-pics
THE_VOID_ADMIN_PASSWORD=
THE_VOID_IP_HASH_SECRET=
```

## Deployment

The included `render.yaml` is a generic Render blueprint. It defines the build/start commands and marks sensitive values as manually supplied environment variables.

## License

MIT. Use this code as a reference for your own app.
