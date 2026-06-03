const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

let createClient = null;
try {
  ({ createClient } = require('@supabase/supabase-js'));
} catch {
}

let sharp = null;
try {
  sharp = require('sharp');
} catch {
}

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const PUBLIC_DIR = fs.existsSync(path.join(ROOT, 'public')) ? path.join(ROOT, 'public') : ROOT;
const BUNDLED_DATA_DIR = path.join(ROOT, 'data');
const BUNDLED_UPLOAD_DIR = path.join(BUNDLED_DATA_DIR, 'uploads');
const BUNDLED_DB_FILE = path.join(BUNDLED_DATA_DIR, 'wallpapers.json');

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const PROFILE_PIC_MAX_BYTES = 5 * 1024 * 1024;
const MAX_UPLOAD_BODY_BYTES = Math.ceil(MAX_UPLOAD_BYTES * 1.4) + 1024 * 1024;
const PROFILE_PIC_BODY_BYTES = Math.ceil(PROFILE_PIC_MAX_BYTES * 1.4) + 512 * 1024;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const ACTIVE_SESSION_IDLE_MS = positiveNumberEnv('THE_VOID_ACTIVE_SESSION_IDLE_MS', 30 * 60 * 1000, 1000);
const ADMIN_LOGIN_MAX_FAILED_ATTEMPTS = positiveNumberEnv('THE_VOID_ADMIN_LOGIN_MAX_FAILED_ATTEMPTS', 2, 1);
const ADMIN_LOGIN_LOCK_MS = positiveNumberEnv('THE_VOID_ADMIN_LOGIN_LOCK_MS', 3 * 60 * 60 * 1000, 60 * 1000);
const USER_LOGIN_MAX_FAILED_ATTEMPTS = positiveNumberEnv('THE_VOID_USER_LOGIN_MAX_FAILED_ATTEMPTS', 4, 1);
const USER_LOGIN_LOCK_MS = positiveNumberEnv('THE_VOID_USER_LOGIN_LOCK_MS', 30 * 60 * 1000, 60 * 1000);
const WALLPAPER_UPLOAD_LIMIT_PER_WINDOW = positiveNumberEnv('THE_VOID_UPLOAD_LIMIT_PER_24H', 4, 1);
const WALLPAPER_UPLOAD_WINDOW_MS = 24 * 60 * 60 * 1000;
const ACTIVE_USER_SESSIONS_SETTING_KEY = 'active_user_sessions';
const ADMIN_LOGIN_PROTECTION_SETTING_KEY = 'admin_login_protection';
const USER_LOGIN_PROTECTION_SETTING_KEY = 'user_login_protection';
const ONE_DEVICE_LOGIN_MESSAGE = 'This profile is already logged in on another device. Logout from the other device to login here.';
const USER_SESSION_COOKIE = 'the_void_user_session';
const ADMIN_SESSION_COOKIE = 'the_void_session';
const PASSWORD_MIN_LENGTH = 4;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_.-]{2,23}$/;
const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.THE_VOID_SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.THE_VOID_SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_BUCKET = String(process.env.SUPABASE_BUCKET || process.env.THE_VOID_SUPABASE_BUCKET || 'wallpapers').trim() || 'wallpapers';
const SUPABASE_PROFILE_BUCKET = String(process.env.SUPABASE_PROFILE_BUCKET || process.env.THE_VOID_PROFILE_BUCKET || 'profile-pics').trim() || 'profile-pics';
const FORCE_BUNDLE_SEED = /^true$/i.test(String(process.env.THE_VOID_FORCE_BUNDLE_SEED || '').trim());
const AUTO_SYNC_STORAGE = !/^false$/i.test(String(process.env.THE_VOID_AUTO_SYNC_STORAGE || 'true').trim());
const ENFORCE_ONE_ACCOUNT_PER_IP = !/^false$/i.test(String(process.env.THE_VOID_ENFORCE_ONE_ACCOUNT_PER_IP || 'true').trim());
const IP_HASH_SECRET = String(process.env.THE_VOID_IP_HASH_SECRET || SUPABASE_SERVICE_ROLE_KEY || process.env.THE_VOID_ADMIN_PASSWORD || 'the-void-dev-secret').trim();
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const LOCAL_DATA_DIR = resolveLocalDataDir();
const LOCAL_UPLOAD_DIR = path.join(LOCAL_DATA_DIR, 'uploads');
const LOCAL_PROFILE_PIC_DIR = path.join(LOCAL_DATA_DIR, 'profile-pics');
const LOCAL_DB_FILE = path.join(LOCAL_DATA_DIR, 'wallpapers.json');
const LOCAL_USERS_FILE = path.join(LOCAL_DATA_DIR, 'users.json');

const runtimePassword = process.env.THE_VOID_ADMIN_PASSWORD || crypto.randomBytes(8).toString('base64url');
const configuredHash = process.env.THE_VOID_ADMIN_PASSWORD_HASH || sha256(runtimePassword);
const sessions = new Map();
const userSessions = new Map();
const localAppSettings = new Map();
let localDbMutationQueue = Promise.resolve();
let localUserMutationQueue = Promise.resolve();
let supabase = null;
let setupError = '';
let bootstrapPromise = null;

if (!process.env.THE_VOID_ADMIN_PASSWORD && !process.env.THE_VOID_ADMIN_PASSWORD_HASH) {
  console.log('\nTHE VOID admin password for this server run:');
  console.log(`  ${runtimePassword}`);
  console.log('Set THE_VOID_ADMIN_PASSWORD for a permanent password.\n');
}

if (USE_SUPABASE) {
  if (!createClient) {
    setupError = 'Supabase dependency missing. Run npm install so @supabase/supabase-js is installed.';
  } else {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'X-Client-Info': 'the-void-render-free' } },
    });
    bootstrapPromise = bootstrapSupabase().catch((error) => {
      setupError = friendlySupabaseError(error);
      console.error('Supabase setup failed:', setupError);
    });
  }
} else if (isRender()) {
  setupError = 'Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Render environment variables.';
} else {
  prepareLocalStorage();
}

function isRender() {
  return Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_URL);
}


function positiveNumberEnv(name, fallback, minimum = 0) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}


function jsonClone(value) {
  if (value === undefined || value === null) return {};
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
}

async function readAppSettingValue(key) {
  const safeKey = String(key || '').trim();
  if (!safeKey) return {};

  if (USE_SUPABASE) {
    if (bootstrapPromise) await bootstrapPromise.catch(() => {});
    if (!setupError && supabase) {
      const result = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', safeKey)
        .maybeSingle();
      if (result.error) throw result.error;
      return result.data?.value && typeof result.data.value === 'object' ? result.data.value : {};
    }
  }

  return jsonClone(localAppSettings.get(safeKey) || {});
}

async function writeAppSettingValue(key, value) {
  const safeKey = String(key || '').trim();
  if (!safeKey) return;
  const safeValue = value && typeof value === 'object' && !Array.isArray(value) ? value : {};

  if (USE_SUPABASE) {
    if (bootstrapPromise) await bootstrapPromise.catch(() => {});
    if (!setupError && supabase) {
      const now = new Date().toISOString();
      const result = await supabase.from('app_settings').upsert({
        key: safeKey,
        value: safeValue,
        updated_at: now,
      }, { onConflict: 'key' });
      if (result.error) throw result.error;
      return;
    }
  }

  localAppSettings.set(safeKey, jsonClone(safeValue));
}

function retryAfterSecondsUntil(lockedUntilMs) {
  return Math.max(1, Math.ceil((Number(lockedUntilMs || 0) - Date.now()) / 1000));
}

function formatMinutes(seconds) {
  const value = Math.max(1, Math.ceil(Number(seconds || 0) / 60));
  return `${value} minute${value === 1 ? '' : 's'}`;
}

function formatHours(seconds) {
  const value = Math.max(1, Math.ceil(Number(seconds || 0) / 3600));
  return `${value} hour${value === 1 ? '' : 's'}`;
}

function lockoutPayload(message, lockedUntilMs) {
  const retryAfterSeconds = retryAfterSecondsUntil(lockedUntilMs);
  return {
    error: message,
    locked: true,
    lockedUntil: new Date(Number(lockedUntilMs || 0)).toISOString(),
    retryAfterSeconds,
  };
}

async function readAdminLoginProtection() {
  const value = await readAppSettingValue(ADMIN_LOGIN_PROTECTION_SETTING_KEY);
  const lockedUntilMs = Date.parse(value.lockedUntil || '');
  const parsedLockedUntilMs = Number.isFinite(lockedUntilMs) ? lockedUntilMs : 0;
  if (parsedLockedUntilMs && parsedLockedUntilMs <= Date.now()) {
    return { failedAttempts: 0, lockedUntilMs: 0 };
  }
  return {
    failedAttempts: Math.max(0, Number(value.failedAttempts || 0) || 0),
    lockedUntilMs: parsedLockedUntilMs,
  };
}

async function writeAdminLoginProtection(state) {
  const lockedUntilMs = Number(state?.lockedUntilMs || 0);
  await writeAppSettingValue(ADMIN_LOGIN_PROTECTION_SETTING_KEY, {
    failedAttempts: Math.max(0, Number(state?.failedAttempts || 0) || 0),
    lockedUntil: lockedUntilMs > Date.now() ? new Date(lockedUntilMs).toISOString() : '',
    updatedAt: new Date().toISOString(),
  });
}

function userLoginDeviceHash(req, browserKey = '') {
  const key = String(browserKey || '').trim().slice(0, 128);
  if (key) return hashScoped(key, 'login-browser-key');
  return hashScoped(getRequestIp(req), 'login-ip');
}

async function readUserLoginProtection() {
  const value = await readAppSettingValue(USER_LOGIN_PROTECTION_SETTING_KEY);
  const source = value.devices && typeof value.devices === 'object' && !Array.isArray(value.devices) ? value.devices : {};
  const devices = {};
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [deviceHash, entry] of Object.entries(source)) {
    if (!deviceHash || !entry || typeof entry !== 'object') continue;
    const lockedUntilMs = Date.parse(entry.lockedUntil || '');
    const updatedAtMs = Date.parse(entry.updatedAt || '');
    const isLocked = Number.isFinite(lockedUntilMs) && lockedUntilMs > Date.now();
    const isRecent = Number.isFinite(updatedAtMs) && updatedAtMs >= cutoff;
    if (!isLocked && !isRecent) continue;
    const parsedLockedUntilMs = Number.isFinite(lockedUntilMs) ? lockedUntilMs : 0;
    devices[deviceHash] = {
      failedAttempts: parsedLockedUntilMs && parsedLockedUntilMs <= Date.now() ? 0 : Math.max(0, Number(entry.failedAttempts || 0) || 0),
      lockedUntilMs: parsedLockedUntilMs && parsedLockedUntilMs > Date.now() ? parsedLockedUntilMs : 0,
      updatedAt: entry.updatedAt || new Date().toISOString(),
    };
  }
  return devices;
}

async function writeUserLoginProtection(devices) {
  const cleaned = {};
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [deviceHash, entry] of Object.entries(devices || {})) {
    const lockedUntilMs = Number(entry?.lockedUntilMs || 0);
    const updatedAtMs = Date.parse(entry?.updatedAt || '');
    const isLocked = lockedUntilMs > Date.now();
    const isRecent = Number.isFinite(updatedAtMs) && updatedAtMs >= cutoff;
    if (!isLocked && !isRecent) continue;
    cleaned[deviceHash] = {
      failedAttempts: Math.max(0, Number(entry?.failedAttempts || 0) || 0),
      lockedUntil: isLocked ? new Date(lockedUntilMs).toISOString() : '',
      updatedAt: entry?.updatedAt || new Date().toISOString(),
    };
  }
  await writeAppSettingValue(USER_LOGIN_PROTECTION_SETTING_KEY, {
    devices: cleaned,
    updatedAt: new Date().toISOString(),
  });
}

async function getUserLoginLock(deviceHash) {
  const devices = await readUserLoginProtection();
  const entry = devices[deviceHash];
  if (entry?.lockedUntilMs > Date.now()) return entry;
  return null;
}

async function recordUserLoginFailure(deviceHash) {
  const devices = await readUserLoginProtection();
  const current = devices[deviceHash] || { failedAttempts: 0, lockedUntilMs: 0 };
  const failedAttempts = Number(current.failedAttempts || 0) + 1;
  const now = new Date().toISOString();
  if (failedAttempts >= USER_LOGIN_MAX_FAILED_ATTEMPTS) {
    const lockedUntilMs = Date.now() + USER_LOGIN_LOCK_MS;
    devices[deviceHash] = { failedAttempts, lockedUntilMs, updatedAt: now };
    await writeUserLoginProtection(devices);
    return { locked: true, failedAttempts, lockedUntilMs, remainingAttempts: 0 };
  }
  devices[deviceHash] = { failedAttempts, lockedUntilMs: 0, updatedAt: now };
  await writeUserLoginProtection(devices);
  return {
    locked: false,
    failedAttempts,
    lockedUntilMs: 0,
    remainingAttempts: Math.max(0, USER_LOGIN_MAX_FAILED_ATTEMPTS - failedAttempts),
  };
}

async function clearUserLoginFailure(deviceHash) {
  const devices = await readUserLoginProtection();
  if (devices[deviceHash]) {
    delete devices[deviceHash];
    await writeUserLoginProtection(devices);
  }
}

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src 'self' https:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  };
}

function applySecurityHeaders(res) {
  for (const [key, value] of Object.entries(securityHeaders())) {
    res.setHeader(key, value);
  }
}

function requestOrigin(req) {
  const raw = req.headers.origin || '';
  return Array.isArray(raw) ? raw[0] : String(raw || '').trim();
}

function requestRefererOrigin(req) {
  const raw = req.headers.referer || '';
  const ref = Array.isArray(raw) ? raw[0] : String(raw || '').trim();
  if (!ref) return '';
  try {
    return new URL(ref).origin;
  } catch {
    return '';
  }
}

function expectedOrigins(req) {
  const hostHeader = req.headers['x-forwarded-host'] || req.headers.host || '';
  const hosts = String(Array.isArray(hostHeader) ? hostHeader[0] : hostHeader)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const protoHeader = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
  const proto = String(Array.isArray(protoHeader) ? protoHeader[0] : protoHeader).split(',')[0].trim() || 'http';
  const origins = new Set(hosts.map((host) => `${proto}://${host}`));
  if (process.env.RENDER_EXTERNAL_URL) origins.add(String(process.env.RENDER_EXTERNAL_URL).trim().replace(/\/+$/, ''));
  for (const item of String(process.env.THE_VOID_ALLOWED_ORIGINS || '').split(',')) {
    const origin = item.trim().replace(/\/+$/, '');
    if (origin) origins.add(origin);
  }
  return origins;
}

function sameOrigin(req, origin) {
  if (!origin) return false;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  for (const expected of expectedOrigins(req)) {
    try {
      const allowed = new URL(expected);
      if (parsed.protocol === allowed.protocol && parsed.host === allowed.host) return true;
    } catch {}
  }
  return false;
}

function isStateChangingMethod(method) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method || '').toUpperCase());
}

function passesOriginCsrfCheck(req) {
  const origin = requestOrigin(req) || requestRefererOrigin(req);
  return sameOrigin(req, origin);
}

function resolveLocalDataDir() {
  const configured = String(process.env.THE_VOID_DATA_DIR || '').trim();
  if (configured) return path.resolve(configured);

  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'THE-VOID', 'data');
  }

  if (process.env.XDG_DATA_HOME) {
    return path.join(process.env.XDG_DATA_HOME, 'the-void', 'data');
  }

  return path.join(os.homedir(), '.the-void', 'data');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function friendlySupabaseError(error) {
  const message = String(error?.message || error?.details || error || 'Supabase setup failed.');
  if (/relation .*wallpapers.* does not exist|relation .*app_settings.* does not exist|relation .*users.* does not exist|schema cache/i.test(message)) {
    return 'Supabase tables are missing. Run supabase/schema.sql in Supabase SQL Editor, then redeploy/restart.';
  }
  if (/bucket not found|not found/i.test(message) && /bucket|storage/i.test(message)) {
    return `Supabase Storage bucket was not found. Create public buckets named ${SUPABASE_BUCKET} and ${SUPABASE_PROFILE_BUCKET}.`;
  }
  if (/duplicate key value|unique constraint/i.test(message)) {
    if (/users_creator_name_key_unique|creator_name|username/i.test(message)) return 'USERNAME_TAKEN';
    if (/users_signup_ip_hash_unique|signup_ip_hash/i.test(message)) return 'Creator profile already exists on this IP.';
    if (/users_browser_key_hash_unique|browser_key/i.test(message)) return 'Creator profile already exists on this IP.';
  }
  if (/invalid api key|JWT|authorization|apikey/i.test(message)) {
    return 'Supabase key is invalid. Use the service_role key on the backend, not the anon key.';
  }
  return message;
}

async function bootstrapSupabase() {
  if (!supabase) return;

  const settingsCheck = await supabase.from('app_settings').select('key').limit(1);
  if (settingsCheck.error) throw settingsCheck.error;

  const wallpaperCheck = await supabase.from('wallpapers').select('id').limit(1);
  if (wallpaperCheck.error) throw wallpaperCheck.error;

  const usersCheck = await supabase.from('users').select('creator_id,creator_name,password_hash,password_salt,signup_ip_hash,profile_pic_url,profile_pic_path').limit(1);
  if (usersCheck.error) throw usersCheck.error;

  await seedBundledWallpapersOnce();
  await syncExistingStorageObjectsToDb();
}

async function seedBundledWallpapersOnce() {
  if (!fs.existsSync(BUNDLED_DB_FILE)) return;

  const settingKey = 'bundled_seed_done';
  if (!FORCE_BUNDLE_SEED) {
    const existing = await supabase
      .from('app_settings')
      .select('key')
      .eq('key', settingKey)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return;
  }

  const bundledDb = readDbFile(BUNDLED_DB_FILE);
  const rows = [];
  const now = new Date().toISOString();

  for (const item of bundledDb.wallpapers) {
    const id = String(item.id || '').trim();
    const filename = path.basename(String(item.filename || ''));
    if (!id || !filename) continue;

    const sourcePath = path.join(BUNDLED_UPLOAD_DIR, filename);
    if (!fs.existsSync(sourcePath)) continue;

    const ext = path.extname(filename).replace(/^\./, '').toLowerCase() || 'jpg';
    const mime = item.mime || mimeForExt(path.extname(filename)) || `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    const storagePath = `seed/${filename}`;
    const buffer = fs.readFileSync(sourcePath);

    const upload = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(storagePath, buffer, {
        contentType: mime,
        cacheControl: '31536000',
        upsert: true,
      });
    if (upload.error) throw upload.error;

    const publicUrlResult = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(storagePath);
    const publicUrl = publicUrlResult?.data?.publicUrl;
    if (!publicUrl) throw new Error(`Could not create public URL for ${storagePath}.`);

    rows.push({
      id,
      title: String(item.title || 'Untitled wallpaper').trim().slice(0, 80) || 'Untitled wallpaper',
      creator: String(item.creator || 'The Void').trim().slice(0, 60) || 'The Void',
      storage_path: storagePath,
      public_url: publicUrl,
      mime,
      status: ['pending', 'approved', 'rejected'].includes(item.status) ? item.status : 'approved',
      created_at: item.createdAt || now,
      approved_at: item.approvedAt || null,
      updated_at: item.updatedAt || item.approvedAt || item.createdAt || now,
    });
  }

  if (rows.length) {
    const upsert = await supabase.from('wallpapers').upsert(rows, { onConflict: 'id' });
    if (upsert.error) throw upsert.error;
  }

  const marker = await supabase.from('app_settings').upsert({
    key: settingKey,
    value: { seededAt: now, count: rows.length, forced: FORCE_BUNDLE_SEED },
    updated_at: now,
  }, { onConflict: 'key' });
  if (marker.error) throw marker.error;

  console.log(`Seeded ${rows.length} bundled wallpapers into Supabase Storage/DB.`);
}

function isImageStoragePath(storagePath, item = {}) {
  const ext = path.extname(String(storagePath || '')).toLowerCase();
  const mime = String(item?.metadata?.mimetype || item?.metadata?.mimeType || item?.metadata?.contentType || '').toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) || /^image\/(jpeg|png|webp)$/.test(mime);
}

async function listStorageImageObjects(prefix = '', depth = 0) {
  const images = [];
  if (!supabase || depth > 5) return images;

  for (let offset = 0; offset < 10000; offset += 1000) {
    const listed = await supabase.storage.from(SUPABASE_BUCKET).list(prefix, {
      limit: 1000,
      offset,
      sortBy: { column: 'created_at', order: 'desc' },
    });
    if (listed.error) throw listed.error;

    const entries = listed.data || [];
    for (const entry of entries) {
      if (!entry?.name || entry.name === '.emptyFolderPlaceholder') continue;
      const storagePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (isImageStoragePath(storagePath, entry)) {
        images.push({ ...entry, storagePath });
        continue;
      }

      if (!path.extname(entry.name) && depth < 5) {
        const nested = await listStorageImageObjects(storagePath, depth + 1);
        images.push(...nested);
      }
    }

    if (entries.length < 1000) break;
  }

  return images;
}

function titleFromStoragePath(storagePath) {
  const name = path.basename(String(storagePath || ''), path.extname(String(storagePath || '')));
  const cleaned = name
    .replace(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i, 'Wallpaper')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'Recovered wallpaper').slice(0, 80);
}

async function syncExistingStorageObjectsToDb() {
  if (!AUTO_SYNC_STORAGE || !supabase) return;

  const files = await listStorageImageObjects('');
  if (!files.length) return;

  const existingPaths = new Set();
  for (let offset = 0; offset < 10000; offset += 1000) {
    const result = await supabase
      .from('wallpapers')
      .select('storage_path')
      .range(offset, offset + 999);
    if (result.error) throw result.error;
    for (const row of result.data || []) {
      if (row.storage_path) existingPaths.add(row.storage_path);
    }
    if ((result.data || []).length < 1000) break;
  }

  const now = new Date().toISOString();
  const rows = [];
  for (const file of files) {
    if (!file.storagePath || existingPaths.has(file.storagePath)) continue;
    const mime = String(file?.metadata?.mimetype || file?.metadata?.mimeType || file?.metadata?.contentType || mimeForExt(path.extname(file.storagePath)) || 'image/jpeg');
    const publicUrlResult = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(file.storagePath);
    const publicUrl = publicUrlResult?.data?.publicUrl;
    if (!publicUrl) continue;
    const createdAt = file.created_at || file.updated_at || now;
    rows.push({
      id: crypto.randomUUID(),
      title: titleFromStoragePath(file.storagePath),
      creator: 'The Void',
      creator_id: null,
      auth_type: 'password',
      storage_path: file.storagePath,
      public_url: publicUrl,
      mime,
      status: 'approved',
      created_at: createdAt,
      approved_at: createdAt,
      updated_at: file.updated_at || createdAt,
    });
  }

  if (!rows.length) return;
  for (let index = 0; index < rows.length; index += 100) {
    const batch = rows.slice(index, index + 100);
    const insert = await supabase.from('wallpapers').insert(batch);
    if (insert.error) throw insert.error;
  }
  console.log(`Recovered ${rows.length} existing Supabase Storage image(s) into the wallpapers table.`);
}

async function ensureBackendReady(res) {
  if (bootstrapPromise) await bootstrapPromise;
  if (setupError) {
    sendJson(res, 500, {
      error: setupError,
      setupRequired: true,
      requiredEnv: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_BUCKET', 'THE_VOID_ADMIN_PASSWORD'],
    });
    return false;
  }
  return true;
}

function prepareLocalStorage() {
  fs.mkdirSync(LOCAL_DATA_DIR, { recursive: true });
  fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });
  fs.mkdirSync(LOCAL_PROFILE_PIC_DIR, { recursive: true });

  if (!fs.existsSync(LOCAL_DB_FILE)) {
    if (fs.existsSync(BUNDLED_DB_FILE)) {
      fs.copyFileSync(BUNDLED_DB_FILE, LOCAL_DB_FILE);
    } else {
      writeFileAtomic(LOCAL_DB_FILE, JSON.stringify({ wallpapers: [] }, null, 2));
    }
  }

  if (!fs.existsSync(LOCAL_USERS_FILE)) {
    writeFileAtomic(LOCAL_USERS_FILE, JSON.stringify([], null, 2));
  }

  copyMissingBundledUploadsToLocal();
}

function copyMissingBundledUploadsToLocal() {
  if (!fs.existsSync(BUNDLED_UPLOAD_DIR)) return;
  const db = readDbFile(LOCAL_DB_FILE);
  const referencedFiles = new Set(
    db.wallpapers.map((item) => path.basename(String(item.filename || ''))).filter(Boolean)
  );
  for (const filename of referencedFiles) {
    const source = path.join(BUNDLED_UPLOAD_DIR, filename);
    const target = path.join(LOCAL_UPLOAD_DIR, filename);
    if (fs.existsSync(source) && !fs.existsSync(target)) fs.copyFileSync(source, target);
  }
}

function readDbFile(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { wallpapers: Array.isArray(parsed.wallpapers) ? parsed.wallpapers : [] };
  } catch {
    return { wallpapers: [] };
  }
}

function readLocalDb() {
  return readDbFile(LOCAL_DB_FILE);
}

function readUsersFile(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readLocalUsers() {
  return readUsersFile(LOCAL_USERS_FILE);
}

function writeLocalUsers(users) {
  const safeUsers = Array.isArray(users) ? users : [];
  writeFileAtomic(LOCAL_USERS_FILE, JSON.stringify(safeUsers, null, 2));
}

function sanitizeDb(db) {
  return { wallpapers: Array.isArray(db.wallpapers) ? db.wallpapers : [] };
}

function writeFileAtomic(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(tempFile, 'w');
  try {
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tempFile, filePath);
}

function writeLocalDb(db) {
  writeFileAtomic(LOCAL_DB_FILE, JSON.stringify(sanitizeDb(db), null, 2));
}

function mutateLocalDb(mutator) {
  const run = localDbMutationQueue.then(async () => {
    const db = readLocalDb();
    const result = await mutator(db);
    writeLocalDb(db);
    return result;
  });
  localDbMutationQueue = run.catch(() => {});
  return run;
}

function safeCompare(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (!rawKey) continue;
    cookies[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue.join('='));
  }
  return cookies;
}

function isAdmin(req) {
  const token = parseCookies(req)[ADMIN_SESSION_COOKIE];
  if (!token) return false;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return true;
}

function extForMime(mime) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return null;
}

function mimeForExt(ext) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
  }[ext] || 'application/octet-stream';
}


function parseImageDataUrl(dataUrl, maxBytes, label = 'image') {
  const match = String(dataUrl || '').match(/^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) {
    const error = new Error(`Upload a PNG, JPG, or WEBP ${label}.`);
    error.status = 400;
    throw error;
  }
  const sourceMime = match[1];
  const buffer = Buffer.from(match[3], 'base64');
  if (!buffer.length || buffer.length > maxBytes) {
    const error = new Error(`${label.charAt(0).toUpperCase()}${label.slice(1)} must be under ${Math.floor(maxBytes / (1024 * 1024))} MB.`);
    error.status = 400;
    throw error;
  }
  return { sourceMime, buffer };
}

async function cleanImageBuffer(buffer, options = {}) {
  if (!sharp) {
    const error = new Error('Image validation dependency is missing. Run npm install before deploying.');
    error.status = 500;
    throw error;
  }

  const label = options.label || 'image';
  const maxBytes = options.maxBytes || MAX_UPLOAD_BYTES;
  const maxPixels = options.maxPixels || 50_000_000;
  const resize = options.resize || null;

  let image = sharp(buffer, { failOn: 'warning', limitInputPixels: maxPixels, animated: false }).rotate();
  let metadata;
  try {
    metadata = await image.metadata();
  } catch {
    const error = new Error(`The uploaded ${label} is not a valid clean image file.`);
    error.status = 400;
    throw error;
  }

  const format = String(metadata?.format || '').toLowerCase();
  if (!['jpeg', 'png', 'webp'].includes(format)) {
    const error = new Error(`Upload a PNG, JPG, or WEBP ${label}.`);
    error.status = 400;
    throw error;
  }
  if (!metadata.width || !metadata.height) {
    const error = new Error(`The uploaded ${label} has invalid image dimensions.`);
    error.status = 400;
    throw error;
  }
  if (metadata.width > 12000 || metadata.height > 12000 || metadata.width * metadata.height > maxPixels) {
    const error = new Error(`The uploaded ${label} is too large in resolution.`);
    error.status = 400;
    throw error;
  }

  if (resize) {
    image = image.resize(resize);
  }

  let cleanBuffer;
  try {
    cleanBuffer = await image.webp({ quality: options.quality || 90, effort: 4 }).toBuffer();
  } catch {
    const error = new Error(`The uploaded ${label} could not be safely cleaned.`);
    error.status = 400;
    throw error;
  }

  if (!cleanBuffer.length || cleanBuffer.length > maxBytes) {
    const error = new Error(`Cleaned ${label} must be under ${Math.floor(maxBytes / (1024 * 1024))} MB.`);
    error.status = 400;
    throw error;
  }

  return {
    mime: 'image/webp',
    ext: 'webp',
    buffer: cleanBuffer,
    width: metadata.width,
    height: metadata.height,
    sourceFormat: format,
  };
}

function serveStatic(_req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  if (filePath === '/admin') filePath = '/admin.html';

  const resolved = path.normalize(path.join(PUBLIC_DIR, filePath));
  const publicRoot = path.resolve(PUBLIC_DIR);
  if (resolved !== publicRoot && !resolved.startsWith(publicRoot + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mimeForExt(path.extname(resolved)),
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

function rowToItem(row) {
  return {
    id: row.id,
    title: row.title,
    creator: row.creator || 'The Void',
    creatorId: row.creator_id || '',
    authType: row.auth_type || '',
    storagePath: row.storage_path,
    publicUrl: row.public_url,
    mime: row.mime,
    status: row.status,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    updatedAt: row.updated_at,
  };
}

function mediaUrlForItem(item) {
  return USE_SUPABASE && item?.publicUrl ? item.publicUrl : `/media/${item.id}`;
}

function publicWallpaperDto(item) {
  return {
    id: item.id,
    title: item.title,
    creator: item.creator || 'The Void',
    creatorId: item.creatorId || '',
    createdAt: item.createdAt,
    approvedAt: item.approvedAt,
    mediaUrl: mediaUrlForItem(item),
  };
}

function readClientUserHeaders(req) {
  return {
    creatorId: String(req.headers['x-creator-id'] || '').trim(),
    creatorName: String(req.headers['x-creator-name'] || '').trim(),
  };
}

function normalizeCreatorName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 60);
}

function normalizeUsername(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 24);
}

function validateUsername(username) {
  if (!username || username.length < 3) {
    return 'Username must be at least 3 characters.';
  }
  if (!USERNAME_PATTERN.test(username)) {
    return 'Username can use letters, numbers, underscore, dot, or dash.';
  }
  return '';
}

function validatePassword(password) {
  if (String(password || '').length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  return '';
}

function getRequestIp(req) {
  const header = req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '';
  const first = Array.isArray(header) ? header[0] : String(header).split(',')[0];
  const raw = String(first || req.socket.remoteAddress || '').trim();
  return raw.replace(/^::ffff:/, '') || 'unknown';
}

function hashScoped(value, scope) {
  return sha256(`${IP_HASH_SECRET}:${scope}:${String(value || '').trim()}`);
}

function passwordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const hash = crypto.scryptSync(String(password || ''), String(salt), 64).toString('hex');
  return safeCompare(hash, expectedHash);
}

function userCookieOptions(req, maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000)) {
  const secureCookie = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
  return `HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secureCookie}`;
}

function setUserSessionCookie(req, token) {
  return `${USER_SESSION_COOKIE}=${encodeURIComponent(token)}; ${userCookieOptions(req)}`;
}

function clearUserSessionCookie() {
  return `${USER_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

function sessionHash(token) {
  return sha256(`user-session:${String(token || '')}`);
}

function activeSessionExpiresAtMs(active) {
  const expiresAtMs = Date.parse(active?.expiresAt || '');
  return Number.isFinite(expiresAtMs) ? expiresAtMs : 0;
}

function activeSessionLastSeenAtMs(active) {
  const lastSeenAtMs = Date.parse(active?.updatedAt || active?.lastSeenAt || '');
  return Number.isFinite(lastSeenAtMs) ? lastSeenAtMs : 0;
}

function activeSessionIsFresh(active) {
  return Boolean(active?.tokenHash && activeSessionExpiresAtMs(active) > Date.now());
}

function activeSessionCanBlockNewLogin(active) {
  if (!activeSessionIsFresh(active)) return false;
  const lastSeenAtMs = activeSessionLastSeenAtMs(active);
  if (!lastSeenAtMs) return false;
  return Date.now() - lastSeenAtMs <= ACTIVE_SESSION_IDLE_MS;
}

function normalizeActiveSessionsValue(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const sessions = source.sessions && typeof source.sessions === 'object' && !Array.isArray(source.sessions)
    ? source.sessions
    : source;
  const normalized = {};
  for (const [creatorId, active] of Object.entries(sessions || {})) {
    if (!creatorId || !activeSessionIsFresh(active)) continue;
    normalized[creatorId] = {
      tokenHash: String(active.tokenHash || ''),
      browserKeyHash: String(active.browserKeyHash || active.deviceKeyHash || ''),
      expiresAt: String(active.expiresAt || ''),
      updatedAt: String(active.updatedAt || active.lastSeenAt || active.createdAt || ''),
    };
  }
  return normalized;
}

async function readActiveUserSessions() {
  if (USE_SUPABASE) {
    const result = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', ACTIVE_USER_SESSIONS_SETTING_KEY)
      .maybeSingle();
    if (result.error) throw result.error;
    return normalizeActiveSessionsValue(result.data?.value || {});
  }

  const sessionsByCreator = {};
  for (const user of readLocalUsers()) {
    const active = {
      tokenHash: user.activeSessionHash,
      browserKeyHash: user.activeSessionBrowserKeyHash,
      expiresAt: user.activeSessionExpiresAt,
      updatedAt: user.activeSessionUpdatedAt,
    };
    if (user.creatorId && activeSessionIsFresh(active)) sessionsByCreator[user.creatorId] = active;
  }
  return sessionsByCreator;
}

async function writeActiveUserSessions(sessionsByCreator) {
  const cleaned = normalizeActiveSessionsValue({ sessions: sessionsByCreator });
  if (USE_SUPABASE) {
    const now = new Date().toISOString();
    const result = await supabase.from('app_settings').upsert({
      key: ACTIVE_USER_SESSIONS_SETTING_KEY,
      value: { sessions: cleaned },
      updated_at: now,
    }, { onConflict: 'key' });
    if (result.error) throw result.error;
    return;
  }

  await mutateLocalUsers((users) => {
    for (const item of users) {
      const active = cleaned[item.creatorId];
      item.activeSessionHash = active?.tokenHash || '';
      item.activeSessionBrowserKeyHash = active?.browserKeyHash || '';
      item.activeSessionExpiresAt = active?.expiresAt || '';
      item.activeSessionUpdatedAt = active?.updatedAt || '';
    }
  });
}

async function getActiveUserSession(creatorId) {
  if (!creatorId) return null;
  const sessionsByCreator = await readActiveUserSessions();
  const active = sessionsByCreator[creatorId];
  return activeSessionIsFresh(active) ? active : null;
}

async function findActiveUserSessionByTokenHash(tokenHash) {
  if (!tokenHash) return null;
  const sessionsByCreator = await readActiveUserSessions();
  for (const [creatorId, active] of Object.entries(sessionsByCreator)) {
    if (activeSessionIsFresh(active) && active?.tokenHash === tokenHash) {
      return { creatorId, ...active };
    }
  }
  return null;
}

async function setActiveUserSession(creatorId, tokenHash, expiresAt, browserKeyHash = '') {
  const sessionsByCreator = await readActiveUserSessions();
  sessionsByCreator[creatorId] = {
    tokenHash,
    browserKeyHash: String(browserKeyHash || ''),
    expiresAt,
    updatedAt: new Date().toISOString(),
  };
  await writeActiveUserSessions(sessionsByCreator);
}

async function clearActiveUserSession({ creatorId = '', tokenHash = '' } = {}) {
  const sessionsByCreator = await readActiveUserSessions();
  let changed = false;
  for (const [id, active] of Object.entries(sessionsByCreator)) {
    if ((creatorId && id === creatorId) || (tokenHash && active?.tokenHash === tokenHash)) {
      delete sessionsByCreator[id];
      changed = true;
    }
  }
  if (changed) await writeActiveUserSessions(sessionsByCreator);
}

async function rejectLoginIfAnotherDevice(req, res, user, browserKeyHash = '') {
  const existingToken = parseCookies(req)[USER_SESSION_COOKIE];
  const existingHash = existingToken ? sessionHash(existingToken) : '';
  const active = await getActiveUserSession(user.creatorId);
  if (active && active.tokenHash !== existingHash) {
    const sameKnownBrowser = Boolean(browserKeyHash && (
      browserKeyHash === active.browserKeyHash ||
      browserKeyHash === user.browserKeyHash
    ));
    const activeLockStillInUse = activeSessionCanBlockNewLogin(active);

    if (!sameKnownBrowser && activeLockStillInUse) {
      sendJson(res, 409, { error: ONE_DEVICE_LOGIN_MESSAGE, code: 'ACTIVE_SESSION_EXISTS' });
      return true;
    }
  }
  return false;
}

function publicUserDto(user) {
  return {
    creatorId: user.creatorId,
    username: user.creatorName,
    creatorName: user.creatorName,
    authType: 'password',
    profilePicUrl: user.profilePicUrl || '',
    avatarUrl: user.profilePicUrl || '',
    createdAt: user.createdAt || null,
    lastLoginAt: user.lastLoginAt || null,
  };
}


function adminUserDto(user, counts = {}) {
  return {
    creatorId: user.creatorId,
    username: user.creatorName,
    creatorName: user.creatorName,
    profilePicUrl: user.profilePicUrl || '',
    createdAt: user.createdAt || null,
    lastLoginAt: user.lastLoginAt || null,
    wallpaperCount: Number(counts.total || 0),
    approvedCount: Number(counts.approved || 0),
    pendingCount: Number(counts.pending || 0),
    rejectedCount: Number(counts.rejected || 0),
    hasSignupIpLock: Boolean(user.signupIpHash),
    hasBrowserLock: Boolean(user.browserKeyHash),
  };
}

async function createUserSession(req, res, user, status = 200, extraPayload = {}, browserKeyHash = '') {
  if (await rejectLoginIfAnotherDevice(req, res, user, browserKeyHash)) return;

  const token = crypto.randomBytes(32).toString('base64url');
  const hash = sessionHash(token);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  userSessions.set(token, {
    creatorId: user.creatorId,
    username: user.creatorName,
    tokenHash: hash,
    browserKeyHash,
    expiresAt,
  });
  await setActiveUserSession(user.creatorId, hash, new Date(expiresAt).toISOString(), browserKeyHash);
  sendJson(res, status, { ok: true, user: publicUserDto(user), ...extraPayload }, {
    'Set-Cookie': setUserSessionCookie(req, token),
  });
}

async function getUserSession(req) {
  const token = parseCookies(req)[USER_SESSION_COOKIE];
  if (!token) return null;

  const tokenHash = sessionHash(token);
  let session = userSessions.get(token);
  if (session && session.expiresAt >= Date.now()) {
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    session.tokenHash = session.tokenHash || tokenHash;
    session.browserKeyHash = session.browserKeyHash || '';
    session.token = token;
    return session;
  }

  if (session) userSessions.delete(token);

  const active = await findActiveUserSessionByTokenHash(tokenHash);
  if (!active) return null;

  const user = await findUserById(active.creatorId);
  if (!user) return null;

  session = {
    creatorId: active.creatorId,
    username: user.creatorName,
    tokenHash,
    browserKeyHash: active.browserKeyHash || '',
    expiresAt: Date.now() + SESSION_TTL_MS,
    token,
  };
  userSessions.set(token, session);
  return session;
}

function normalizeUserRow(row) {
  if (!row) return null;
  return {
    creatorId: row.creator_id || row.creatorId,
    creatorName: row.creator_name || row.creatorName,
    authType: row.auth_type || row.authType || 'password',
    email: row.email || null,
    passwordHash: row.password_hash || row.passwordHash || '',
    passwordSalt: row.password_salt || row.passwordSalt || '',
    signupIpHash: row.signup_ip_hash || row.signupIpHash || '',
    browserKeyHash: row.browser_key_hash || row.browserKeyHash || '',
    profilePicPath: row.profile_pic_path || row.profilePicPath || '',
    profilePicUrl: row.profile_pic_url || row.profilePicUrl || '',
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
    lastLoginAt: row.last_login_at || row.lastLoginAt || null,
  };
}

function isActiveSignupLockUser(row) {
  const user = normalizeUserRow(row);
  if (!user?.creatorId || !user?.creatorName) return false;
  if (user.authType === 'password' && (!user.passwordHash || !user.passwordSalt)) return false;
  return true;
}

async function supabaseSignupLockExists(signupIpHash, browserKeyHash) {
  if (!USE_SUPABASE || !ENFORCE_ONE_ACCOUNT_PER_IP) return false;

  const checks = [
    { column: 'signup_ip_hash', value: signupIpHash },
    { column: 'browser_key_hash', value: browserKeyHash },
  ].filter((item) => item.value);

  for (const check of checks) {
    const result = await supabase
      .from('users')
      .select('creator_id,creator_name,auth_type,password_hash,password_salt,signup_ip_hash,browser_key_hash')
      .eq(check.column, check.value)
      .limit(25);
    if (result.error) throw result.error;

    const rows = result.data || [];
    if (!rows.length) continue;

    if (rows.some(isActiveSignupLockUser)) return true;

    const clear = await supabase
      .from('users')
      .update({ signup_ip_hash: null, browser_key_hash: null })
      .eq(check.column, check.value);
    if (clear.error) throw clear.error;
  }

  return false;
}

function mutateLocalUsers(mutator) {
  const run = localUserMutationQueue.then(async () => {
    const users = readLocalUsers();
    const result = await mutator(users);
    writeLocalUsers(users);
    return result;
  });
  localUserMutationQueue = run.catch(() => {});
  return run;
}

async function checkUsername(req, res) {
  if (!(await ensureBackendReady(res))) return;
  try {
    const raw = await readBody(req, 32 * 1024);
    const payload = JSON.parse(raw || '{}');
    const username = normalizeUsername(payload.username || payload.creatorName);
    if (!username) return sendJson(res, 200, { exists: false });

    if (USE_SUPABASE) {
      const result = await supabase
        .from('users')
        .select('creator_id')
        .eq('creator_name_key', username)
        .limit(1);
      if (result.error) throw result.error;
      return sendJson(res, 200, { exists: Boolean((result.data || []).length) });
    }

    const exists = readLocalUsers().some((user) => normalizeUsername(user.creatorName) === username);
    return sendJson(res, 200, { exists });
  } catch (error) {
    sendJson(res, 400, { error: friendlySupabaseError(error) || 'Could not check username.' });
  }
}

async function createUser(req, res) {
  return signupUser(req, res);
}

async function findUserByUsername(username) {
  const normalized = normalizeUsername(username);
  if (!normalized) return null;
  if (USE_SUPABASE) {
    const result = await supabase
      .from('users')
      .select('creator_id,creator_name,auth_type,email,password_hash,password_salt,signup_ip_hash,browser_key_hash,profile_pic_path,profile_pic_url,created_at,updated_at,last_login_at')
      .eq('creator_name_key', normalized)
      .maybeSingle();
    if (result.error) throw result.error;
    return normalizeUserRow(result.data);
  }
  const found = readLocalUsers().find((user) => normalizeUsername(user.creatorName) === normalized);
  return normalizeUserRow(found);
}

async function updateUserLastLogin(user) {
  const now = new Date().toISOString();
  user.lastLoginAt = now;
  if (USE_SUPABASE) {
    const update = await supabase.from('users').update({ last_login_at: now }).eq('creator_id', user.creatorId);
    if (update.error) throw update.error;
  } else {
    await mutateLocalUsers((users) => {
      const item = users.find((entry) => entry.creatorId === user.creatorId);
      if (item) item.lastLoginAt = now;
    });
  }
}

async function signupUser(req, res) {
  if (!(await ensureBackendReady(res))) return;
  try {
    const raw = await readBody(req, 32 * 1024);
    const payload = JSON.parse(raw || '{}');
    const username = normalizeUsername(payload.username || payload.creatorName);
    const password = String(payload.password || '');
    const browserKey = String(payload.browserKey || '').trim().slice(0, 128);
    const usernameError = validateUsername(username);
    if (usernameError) return sendJson(res, 400, { error: usernameError });
    const passwordError = validatePassword(password);
    if (passwordError) return sendJson(res, 400, { error: passwordError });

    const signupIpHash = hashScoped(getRequestIp(req), 'signup-ip');
    const browserKeyHash = browserKey ? hashScoped(browserKey, 'browser-key') : null;

    const existingUser = await findUserByUsername(username);
    if (existingUser) {
      if (verifyPassword(password, existingUser.passwordSalt, existingUser.passwordHash)) {
        await updateUserLastLogin(existingUser);
        return await createUserSession(req, res, existingUser, 200, { alreadyExisted: true, message: 'Profile already exist, Loging in.' }, browserKeyHash);
      }
      return sendJson(res, 409, { error: 'USERNAME_TAKEN' });
    }

    const { salt, hash } = passwordRecord(password);
    const now = new Date().toISOString();
    const creatorId = crypto.randomUUID();

    if (USE_SUPABASE) {
      if (ENFORCE_ONE_ACCOUNT_PER_IP && await supabaseSignupLockExists(signupIpHash, browserKeyHash)) {
        return sendJson(res, 409, { error: 'Creator profile already exists on this IP.' });
      }

      const insertPayload = {
        creator_id: creatorId,
        creator_name: username,
        auth_type: 'password',
        email: null,
        password_hash: hash,
        password_salt: salt,
        signup_ip_hash: signupIpHash,
        browser_key_hash: browserKeyHash,
        profile_pic_path: null,
        profile_pic_url: null,
        last_login_at: now,
        created_at: now,
        updated_at: now,
      };

      let insert = await supabase.from('users').insert(insertPayload)
        .select('creator_id,creator_name,auth_type,email,profile_pic_path,profile_pic_url,created_at,last_login_at')
        .maybeSingle();

      if (insert.error) {
        const msg = String(insert.error.message || '');
        if (/creator_name|username/i.test(msg)) return sendJson(res, 409, { error: 'USERNAME_TAKEN' });
        if (/signup_ip_hash|browser_key/i.test(msg)) {
          if (ENFORCE_ONE_ACCOUNT_PER_IP && await supabaseSignupLockExists(signupIpHash, browserKeyHash)) {
            return sendJson(res, 409, { error: 'Creator profile already exists on this IP.' });
          }
          insert = await supabase.from('users').insert(insertPayload)
            .select('creator_id,creator_name,auth_type,email,profile_pic_path,profile_pic_url,created_at,last_login_at')
            .maybeSingle();
          if (insert.error) return sendJson(res, 409, { error: 'Creator profile already exists on this IP.' });
        } else {
          throw insert.error;
        }
      }
      return await createUserSession(req, res, normalizeUserRow(insert.data), 201, {}, browserKeyHash);
    }

    const createdUser = await mutateLocalUsers((users) => {
      if (users.some((user) => normalizeUsername(user.creatorName) === username)) {
        const error = new Error('USERNAME_TAKEN');
        error.status = 409;
        throw error;
      }
      if (ENFORCE_ONE_ACCOUNT_PER_IP) {
        let hasActiveSignupLock = false;
        for (const user of users) {
          const sameIp = user.signupIpHash && user.signupIpHash === signupIpHash;
          const sameBrowser = browserKeyHash && user.browserKeyHash && user.browserKeyHash === browserKeyHash;
          if (!sameIp && !sameBrowser) continue;
          if (isActiveSignupLockUser(user)) {
            hasActiveSignupLock = true;
          } else {
            user.signupIpHash = '';
            user.browserKeyHash = '';
          }
        }
        if (hasActiveSignupLock) {
          const error = new Error('Creator profile already exists on this IP.');
          error.status = 409;
          throw error;
        }
      }
      const user = {
        creatorId,
        creatorName: username,
        authType: 'password',
        email: null,
        passwordHash: hash,
        passwordSalt: salt,
        signupIpHash,
        browserKeyHash,
        profilePicPath: '',
        profilePicUrl: '',
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
      };
      users.push(user);
      return user;
    });
    return await createUserSession(req, res, createdUser, 201, {}, browserKeyHash);
  } catch (error) {
    const message = error.message === 'USERNAME_TAKEN' ? 'USERNAME_TAKEN' : (friendlySupabaseError(error) || error.message || 'Signup failed.');
    sendJson(res, error.status || 400, { error: message });
  }
}

async function loginUser(req, res) {
  if (!(await ensureBackendReady(res))) return;
  try {
    const raw = await readBody(req, 32 * 1024);
    const payload = JSON.parse(raw || '{}');
    const username = normalizeUsername(payload.username);
    const password = String(payload.password || '');
    const browserKey = String(payload.browserKey || '').trim().slice(0, 128);
    const browserKeyHash = browserKey ? hashScoped(browserKey, 'browser-key') : '';
    const loginDeviceHash = userLoginDeviceHash(req, browserKey);
    if (!username || !password) return sendJson(res, 400, { error: 'Username and password are required.' });

    const locked = await getUserLoginLock(loginDeviceHash);
    if (locked) {
      const retryAfterSeconds = retryAfterSecondsUntil(locked.lockedUntilMs);
      return sendJson(res, 423, lockoutPayload(`Too many wrong login attempts from this device. Try again in ${formatMinutes(retryAfterSeconds)}.`, locked.lockedUntilMs));
    }

    const user = await findUserByUsername(username);
    if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      const failure = await recordUserLoginFailure(loginDeviceHash);
      if (failure.locked) {
        const retryAfterSeconds = retryAfterSecondsUntil(failure.lockedUntilMs);
        return sendJson(res, 423, lockoutPayload(`Too many wrong login attempts from this device. Login is locked for ${formatMinutes(retryAfterSeconds)}.`, failure.lockedUntilMs));
      }
      return sendJson(res, 401, {
        error: `Invalid username or password. ${failure.remainingAttempts} attempt${failure.remainingAttempts === 1 ? '' : 's'} left before this device is locked.`,
        remainingAttempts: failure.remainingAttempts,
      });
    }

    await clearUserLoginFailure(loginDeviceHash);
    await updateUserLastLogin(user);
    return await createUserSession(req, res, user, 200, {}, browserKeyHash);
  } catch (error) {
    sendJson(res, error.status || 400, { error: friendlySupabaseError(error) || error.message || 'Login failed.' });
  }
}

async function logoutUser(req, res) {
  const token = parseCookies(req)[USER_SESSION_COOKIE];
  if (token) {
    const session = userSessions.get(token);
    userSessions.delete(token);
    try {
      await clearActiveUserSession({
        creatorId: session?.creatorId || '',
        tokenHash: session?.tokenHash || sessionHash(token),
      });
    } catch (error) {
      console.error('Could not clear active user session:', error.message || error);
    }
  }
  sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearUserSessionCookie() });
}


async function clearUserSessionsForCreator(creatorId) {
  for (const [token, session] of userSessions.entries()) {
    if (session?.creatorId === creatorId) userSessions.delete(token);
  }
  try { await clearActiveUserSession({ creatorId }); } catch {}
}

async function removeStorageObjects(bucket, paths) {
  if (!supabase || !bucket) return [];
  const uniquePaths = [...new Set((paths || []).map((item) => String(item || '').trim()).filter(Boolean))];
  const errors = [];
  for (let index = 0; index < uniquePaths.length; index += 100) {
    const batch = uniquePaths.slice(index, index + 100);
    if (!batch.length) continue;
    try {
      const result = await supabase.storage.from(bucket).remove(batch);
      if (result.error) errors.push(result.error.message || String(result.error));
    } catch (error) {
      errors.push(error.message || String(error));
    }
  }
  return errors;
}

async function getProfile(req, res) {
  const user = await requireCreator(req, res);
  if (!user) return;
  try {
    if (USE_SUPABASE) {
      const result = await supabase
        .from('wallpapers')
        .select('id,title,creator,status,public_url,created_at,approved_at')
        .eq('creator_id', user.creatorId)
        .order('created_at', { ascending: false });
      if (result.error) throw result.error;
      const uploads = (result.data || []).map((item) => ({
        id: item.id,
        title: item.title,
        creator: item.creator,
        status: item.status,
        createdAt: item.created_at,
        approvedAt: item.approved_at,
        mediaUrl: item.status === 'approved' ? (item.public_url || `/media/${item.id}`) : null,
      }));
      return sendJson(res, 200, { ok: true, user: publicUserDto(user), uploads, counts: uploadCounts(uploads) });
    }

    const uploads = readLocalDb().wallpapers
      .filter((item) => item.creatorId === user.creatorId)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .map((item) => ({
        id: item.id,
        title: item.title,
        creator: item.creator,
        status: item.status,
        createdAt: item.createdAt,
        approvedAt: item.approvedAt,
        mediaUrl: item.status === 'approved' ? (item.public_url || `/media/${item.id}`) : null,
      }));
    return sendJson(res, 200, { ok: true, user: publicUserDto(user), uploads, counts: uploadCounts(uploads) });
  } catch (error) {
    sendJson(res, 400, { error: friendlySupabaseError(error) || error.message || 'Could not load profile.' });
  }
}


async function deleteProfile(req, res) {
  const user = await requireCreator(req, res);
  if (!user) return;

  try {
    const raw = await readBody(req, 32 * 1024);
    const payload = JSON.parse(raw || '{}');
    const password = String(payload.password || '');
    if (!password) return sendJson(res, 400, { error: 'Enter your password to delete profile.' });

    const fullUser = await findUserById(user.creatorId);
    if (!fullUser || !verifyPassword(password, fullUser.passwordSalt, fullUser.passwordHash)) {
      return sendJson(res, 401, { error: 'Password is incorrect.' });
    }

    if (USE_SUPABASE) {
      const wallpaperResult = await supabase
        .from('wallpapers')
        .select('id,storage_path')
        .eq('creator_id', user.creatorId);
      if (wallpaperResult.error) throw wallpaperResult.error;

      const wallpapers = wallpaperResult.data || [];
      const wallpaperPaths = wallpapers.map((item) => item.storage_path).filter(Boolean);

      const deleteWallpapers = await supabase
        .from('wallpapers')
        .delete()
        .eq('creator_id', user.creatorId);
      if (deleteWallpapers.error) throw deleteWallpapers.error;

      const deleteUser = await supabase
        .from('users')
        .delete()
        .eq('creator_id', user.creatorId);
      if (deleteUser.error) throw deleteUser.error;

      const storageErrors = [];
      storageErrors.push(...await removeStorageObjects(SUPABASE_BUCKET, wallpaperPaths));
      if (fullUser.profilePicPath) {
        storageErrors.push(...await removeStorageObjects(SUPABASE_PROFILE_BUCKET, [fullUser.profilePicPath]));
      }

      await clearUserSessionsForCreator(user.creatorId);
      const payload = {
        ok: true,
        message: 'Profile deleted.',
        deletedWallpapers: wallpapers.length,
      };
      if (storageErrors.length) {
        payload.warning = 'Profile deleted, but some Storage files may need manual cleanup.';
      }
      return sendJson(res, 200, payload, { 'Set-Cookie': clearUserSessionCookie() });
    }

    const removedWallpaperFiles = await mutateLocalDb((db) => {
      const removed = db.wallpapers.filter((item) => item.creatorId === user.creatorId);
      db.wallpapers = db.wallpapers.filter((item) => item.creatorId !== user.creatorId);
      const stillReferenced = new Set(db.wallpapers.map((item) => path.basename(String(item.filename || ''))).filter(Boolean));
      return removed
        .map((item) => path.basename(String(item.filename || '')))
        .filter((filename) => filename && !stillReferenced.has(filename));
    });

    const removedUser = await mutateLocalUsers((users) => {
      const index = users.findIndex((entry) => entry.creatorId === user.creatorId);
      if (index < 0) {
        const error = new Error('Profile not found.');
        error.status = 404;
        throw error;
      }
      const [removed] = users.splice(index, 1);
      return removed;
    });

    for (const filename of removedWallpaperFiles) {
      const filePath = path.join(LOCAL_UPLOAD_DIR, path.basename(filename));
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch {}
      }
    }
    if (removedUser?.profilePicPath) {
      const avatarPath = path.join(LOCAL_PROFILE_PIC_DIR, path.basename(removedUser.profilePicPath));
      if (fs.existsSync(avatarPath)) {
        try { fs.unlinkSync(avatarPath); } catch {}
      }
    }

    await clearUserSessionsForCreator(user.creatorId);
    return sendJson(res, 200, {
      ok: true,
      message: 'Profile deleted.',
      deletedWallpapers: removedWallpaperFiles.length,
    }, { 'Set-Cookie': clearUserSessionCookie() });
  } catch (error) {
    sendJson(res, error.status || 400, { error: friendlySupabaseError(error) || error.message || 'Could not delete profile.' });
  }
}


async function parseProfilePicPayload(raw) {
  const payload = JSON.parse(raw || '{}');
  const { buffer } = parseImageDataUrl(payload.dataUrl, PROFILE_PIC_MAX_BYTES, 'profile picture');
  return cleanImageBuffer(buffer, {
    label: 'profile picture',
    maxBytes: PROFILE_PIC_MAX_BYTES,
    maxPixels: 20_000_000,
    resize: { width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true },
    quality: 88,
  });
}

async function updateProfilePicture(req, res) {
  const user = await requireCreator(req, res);
  if (!user) return;

  let storagePath = '';
  let savedFilePath = '';
  try {
    const raw = await readBody(req, PROFILE_PIC_BODY_BYTES);
    const { mime, ext, buffer } = await parseProfilePicPayload(raw);
    const currentUser = await findUserById(user.creatorId);
    const id = crypto.randomUUID();

    if (USE_SUPABASE) {
      storagePath = `${user.creatorId}/${id}.${ext}`;
      const upload = await supabase.storage.from(SUPABASE_PROFILE_BUCKET).upload(storagePath, buffer, {
        contentType: mime,
        cacheControl: '31536000',
        upsert: false,
      });
      if (upload.error) throw upload.error;

      const publicUrlResult = supabase.storage.from(SUPABASE_PROFILE_BUCKET).getPublicUrl(storagePath);
      const publicUrl = publicUrlResult?.data?.publicUrl;
      if (!publicUrl) throw new Error('Could not create public URL for profile picture.');

      const update = await supabase
        .from('users')
        .update({ profile_pic_path: storagePath, profile_pic_url: publicUrl })
        .eq('creator_id', user.creatorId)
        .select('creator_id,creator_name,auth_type,email,password_hash,password_salt,signup_ip_hash,browser_key_hash,profile_pic_path,profile_pic_url,created_at,updated_at,last_login_at')
        .maybeSingle();
      if (update.error) throw update.error;

      if (currentUser?.profilePicPath && currentUser.profilePicPath !== storagePath) {
        try { await supabase.storage.from(SUPABASE_PROFILE_BUCKET).remove([currentUser.profilePicPath]); } catch {}
      }
      return sendJson(res, 200, { ok: true, message: 'Profile picture updated.', user: publicUserDto(normalizeUserRow(update.data)) });
    }

    const filename = `${user.creatorId}-${id}.${ext}`;
    savedFilePath = path.join(LOCAL_PROFILE_PIC_DIR, filename);
    writeFileAtomic(savedFilePath, buffer);
    const profilePicUrl = `/profile-pics/${filename}`;
    const profilePicPath = filename;
    const updatedUser = await mutateLocalUsers((users) => {
      const item = users.find((entry) => entry.creatorId === user.creatorId);
      if (!item) {
        const error = new Error('Login required.');
        error.status = 401;
        throw error;
      }
      const oldPath = item.profilePicPath || '';
      item.profilePicPath = profilePicPath;
      item.profilePicUrl = profilePicUrl;
      item.updatedAt = new Date().toISOString();
      if (oldPath && oldPath !== profilePicPath) {
        const oldFile = path.join(LOCAL_PROFILE_PIC_DIR, path.basename(oldPath));
        if (fs.existsSync(oldFile)) {
          try { fs.unlinkSync(oldFile); } catch {}
        }
      }
      return item;
    });
    return sendJson(res, 200, { ok: true, message: 'Profile picture updated.', user: publicUserDto(normalizeUserRow(updatedUser)) });
  } catch (error) {
    if (storagePath) {
      try { await supabase.storage.from(SUPABASE_PROFILE_BUCKET).remove([storagePath]); } catch {}
    }
    if (savedFilePath && fs.existsSync(savedFilePath)) {
      try { fs.unlinkSync(savedFilePath); } catch {}
    }
    sendJson(res, error.status || 400, { error: friendlySupabaseError(error) || error.message || 'Could not update profile picture.' });
  }
}

async function searchUsers(req, res) {
  if (!(await ensureBackendReady(res))) return;
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const query = normalizeUsername(url.searchParams.get('q') || '');
    if (!query) return sendJson(res, 200, { users: [] });

    if (USE_SUPABASE) {
      const result = await supabase
        .from('users')
        .select('creator_id,creator_name,profile_pic_url,created_at')
        .ilike('creator_name_key', `${query}%`)
        .order('creator_name', { ascending: true })
        .limit(8);
      if (result.error) throw result.error;
      return sendJson(res, 200, { users: (result.data || []).map((row) => publicUserDto(normalizeUserRow(row))) });
    }

    const users = readLocalUsers()
      .map(normalizeUserRow)
      .filter((user) => normalizeUsername(user.creatorName).startsWith(query))
      .sort((a, b) => String(a.creatorName).localeCompare(String(b.creatorName)))
      .slice(0, 8)
      .map(publicUserDto);
    return sendJson(res, 200, { users });
  } catch (error) {
    sendJson(res, 400, { error: friendlySupabaseError(error) || error.message || 'Could not search users.' });
  }
}

async function getPublicUserProfile(req, res, username) {
  if (!(await ensureBackendReady(res))) return;
  try {
    const normalized = normalizeUsername(username);
    if (!normalized) return sendJson(res, 404, { error: 'User not found.' });

    const user = await findUserByUsername(normalized);
    if (!user) return sendJson(res, 404, { error: 'User not found.' });

    if (USE_SUPABASE) {
      const result = await supabase
        .from('wallpapers')
        .select('id,title,creator,creator_id,status,public_url,storage_path,mime,created_at,approved_at')
        .eq('creator_id', user.creatorId)
        .order('created_at', { ascending: false });
      if (result.error) throw result.error;
      const allUploads = (result.data || []).map(rowToItem).map((item) => ({
        id: item.id,
        title: item.title,
        creator: item.creator,
        status: item.status,
        createdAt: item.createdAt,
        approvedAt: item.approvedAt,
        mediaUrl: item.status === 'approved' ? mediaUrlForItem(item) : null,
      }));
      const publicUploads = allUploads
        .filter((item) => item.status === 'approved')
        .sort((a, b) => String(b.approvedAt || b.createdAt || '').localeCompare(String(a.approvedAt || a.createdAt || '')));
      return sendJson(res, 200, {
        ok: true,
        user: publicUserDto(user),
        uploads: publicUploads,
        counts: uploadCounts(allUploads),
        publicProfile: true,
      });
    }

    const allUploads = readLocalDb().wallpapers
      .filter((item) => item.creatorId === user.creatorId)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .map((item) => ({
        id: item.id,
        title: item.title,
        creator: item.creator,
        status: item.status,
        createdAt: item.createdAt,
        approvedAt: item.approvedAt,
        mediaUrl: item.status === 'approved' ? `/media/${item.id}` : null,
      }));
    const publicUploads = allUploads
      .filter((item) => item.status === 'approved')
      .sort((a, b) => String(b.approvedAt || b.createdAt || '').localeCompare(String(a.approvedAt || a.createdAt || '')));
    return sendJson(res, 200, {
      ok: true,
      user: publicUserDto(user),
      uploads: publicUploads,
      counts: uploadCounts(allUploads),
      publicProfile: true,
    });
  } catch (error) {
    sendJson(res, 400, { error: friendlySupabaseError(error) || error.message || 'Could not load user profile.' });
  }
}

function serveLocalProfilePic(req, res, filename) {
  const safeName = path.basename(String(filename || ''));
  if (!safeName) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const filePath = path.join(LOCAL_PROFILE_PIC_DIR, safeName);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': mimeForExt(path.extname(filePath)),
    'Cache-Control': 'public, max-age=86400',
  });
  fs.createReadStream(filePath).pipe(res);
}

function uploadCounts(uploads) {
  return uploads.reduce((counts, item) => {
    counts.total += 1;
    counts[item.status] = (counts[item.status] || 0) + 1;
    return counts;
  }, { total: 0, pending: 0, approved: 0, rejected: 0 });
}

async function changePassword(req, res) {
  const user = await requireCreator(req, res);
  if (!user) return;
  try {
    const raw = await readBody(req, 32 * 1024);
    const payload = JSON.parse(raw || '{}');
    const currentPassword = String(payload.currentPassword || '');
    const newPassword = String(payload.newPassword || '');
    const passwordError = validatePassword(newPassword);
    if (passwordError) return sendJson(res, 400, { error: passwordError });

    const fullUser = await findUserById(user.creatorId);
    if (!fullUser || !verifyPassword(currentPassword, fullUser.passwordSalt, fullUser.passwordHash)) {
      return sendJson(res, 401, { error: 'Current password is incorrect.' });
    }

    const { salt, hash } = passwordRecord(newPassword);
    if (USE_SUPABASE) {
      const result = await supabase.from('users').update({ password_hash: hash, password_salt: salt }).eq('creator_id', user.creatorId);
      if (result.error) throw result.error;
    } else {
      await mutateLocalUsers((users) => {
        const item = users.find((entry) => entry.creatorId === user.creatorId);
        if (item) {
          item.passwordHash = hash;
          item.passwordSalt = salt;
          item.updatedAt = new Date().toISOString();
        }
      });
    }
    return sendJson(res, 200, { ok: true, message: 'Password updated.' });
  } catch (error) {
    sendJson(res, error.status || 400, { error: friendlySupabaseError(error) || error.message || 'Could not update password.' });
  }
}

async function findUserById(creatorId) {
  if (!creatorId) return null;
  if (USE_SUPABASE) {
    const result = await supabase
      .from('users')
      .select('creator_id,creator_name,auth_type,email,password_hash,password_salt,signup_ip_hash,browser_key_hash,profile_pic_path,profile_pic_url,created_at,updated_at,last_login_at')
      .eq('creator_id', creatorId)
      .maybeSingle();
    if (result.error) throw result.error;
    return normalizeUserRow(result.data);
  }
  return normalizeUserRow(readLocalUsers().find((user) => user.creatorId === creatorId) || null);
}


async function countRecentWallpaperUploads(creatorId) {
  const cutoffIso = new Date(Date.now() - WALLPAPER_UPLOAD_WINDOW_MS).toISOString();
  if (USE_SUPABASE) {
    const result = await supabase
      .from('wallpapers')
      .select('id', { count: 'exact', head: true })
      .eq('creator_id', creatorId)
      .gte('created_at', cutoffIso);
    if (result.error) throw result.error;
    return Number(result.count || 0);
  }

  return readLocalDb().wallpapers.filter((item) => {
    if (item.creatorId !== creatorId) return false;
    const createdAt = Date.parse(item.createdAt || item.created_at || '');
    return Number.isFinite(createdAt) && createdAt >= Date.now() - WALLPAPER_UPLOAD_WINDOW_MS;
  }).length;
}

async function enforceWallpaperUploadLimit(res, creatorId) {
  const count = await countRecentWallpaperUploads(creatorId);
  if (count < WALLPAPER_UPLOAD_LIMIT_PER_WINDOW) return true;
  sendJson(res, 429, {
    error: `Upload limit reached. Each profile can upload only ${WALLPAPER_UPLOAD_LIMIT_PER_WINDOW} images in 24 hours. Try again later.`,
    code: 'UPLOAD_LIMIT_REACHED',
  });
  return false;
}

async function requireCreator(req, res) {
  if (bootstrapPromise) await bootstrapPromise;
  if (setupError) {
    sendJson(res, 500, { error: setupError, setupRequired: true });
    return null;
  }

  const session = await getUserSession(req);
  if (!session?.creatorId) {
    sendJson(res, 401, { error: 'Login required.' });
    return null;
  }

  const active = await getActiveUserSession(session.creatorId);
  if (active && active.tokenHash !== session.tokenHash) {
    if (session.token) userSessions.delete(session.token);
    sendJson(res, 401, { error: ONE_DEVICE_LOGIN_MESSAGE, code: 'ACTIVE_SESSION_REPLACED' }, {
      'Set-Cookie': clearUserSessionCookie(),
    });
    return null;
  }
  try {
    await setActiveUserSession(session.creatorId, session.tokenHash, new Date(session.expiresAt).toISOString(), session.browserKeyHash || '');
  } catch (error) {
    console.error('Could not refresh active user session:', error.message || error);
  }

  const user = await findUserById(session.creatorId);
  if (!user) {
    sendJson(res, 401, { error: 'Login required.' });
    return null;
  }

  return user;
}

async function handleUpload(req, res) {
  const user = await requireCreator(req, res);
  if (!user) return;
  try {
    if (!(await enforceWallpaperUploadLimit(res, user.creatorId))) return;
  } catch (error) {
    return sendJson(res, 400, { error: friendlySupabaseError(error) || error.message || 'Could not verify upload limit.' });
  }
  if (USE_SUPABASE) return handleSupabaseUpload(req, res, user);
  return handleLocalUpload(req, res, user);
}

async function parseImagePayload(raw) {
  const payload = JSON.parse(raw || '{}');
  const title = String(payload.title || 'Untitled wallpaper').trim().slice(0, 80) || 'Untitled wallpaper';
  const creator = normalizeCreatorName(payload.creator) || 'The Void';
  const creatorId = String(payload.creatorId || '').trim();
  const authType = ['password', 'guest', 'google'].includes(String(payload.authType || '').trim()) ? String(payload.authType).trim() : 'password';
  const { buffer } = parseImageDataUrl(payload.dataUrl, MAX_UPLOAD_BYTES, 'image');
  const clean = await cleanImageBuffer(buffer, {
    label: 'image',
    maxBytes: MAX_UPLOAD_BYTES,
    maxPixels: 50_000_000,
    quality: 90,
  });
  return { title, creator, creatorId, authType, ...clean };
}

async function handleSupabaseUpload(req, res, user) {
  let storagePath = '';
  try {
    const raw = await readBody(req, MAX_UPLOAD_BODY_BYTES);
    const { title, creator, creatorId, authType, mime, ext, buffer } = await parseImagePayload(raw);
    if (creatorId && creatorId !== user.creatorId) {
      const mismatch = new Error('Login required.');
      mismatch.status = 401;
      throw mismatch;
    }
    const ownerId = user.creatorId;
    const ownerName = user.creatorName || creator || 'The Void';
    const ownerAuthType = 'password';
    const id = crypto.randomUUID();
    storagePath = `uploads/${id}.${ext}`;

    const upload = await supabase.storage.from(SUPABASE_BUCKET).upload(storagePath, buffer, {
      contentType: mime,
      cacheControl: '31536000',
      upsert: false,
    });
    if (upload.error) throw upload.error;

    const publicUrlResult = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(storagePath);
    const publicUrl = publicUrlResult?.data?.publicUrl;
    if (!publicUrl) throw new Error('Could not create public URL for uploaded wallpaper.');

    const now = new Date().toISOString();
    const insert = await supabase.from('wallpapers').insert({
      id,
      title,
      creator: ownerName,
      creator_id: ownerId,
      auth_type: ownerAuthType,
      storage_path: storagePath,
      public_url: publicUrl,
      mime,
      status: 'pending',
      created_at: now,
      approved_at: null,
      updated_at: now,
    });
    if (insert.error) throw insert.error;

    sendJson(res, 201, { ok: true, message: 'Wallpaper submitted for approval.' });
  } catch (error) {
    if (storagePath) {
      try { await supabase.storage.from(SUPABASE_BUCKET).remove([storagePath]); } catch {}
    }
    sendJson(res, error.status || 400, { error: friendlySupabaseError(error) || 'Upload failed.' });
  }
}

async function handleLocalUpload(req, res, user) {
  let savedFilePath = '';
  try {
    const raw = await readBody(req, MAX_UPLOAD_BODY_BYTES);
    const { title, creator, creatorId, authType, mime, ext, buffer } = await parseImagePayload(raw);
    if (creatorId && creatorId !== user.creatorId) {
      const mismatch = new Error('Login required.');
      mismatch.status = 401;
      throw mismatch;
    }
    const ownerId = user.creatorId;
    const ownerName = user.creatorName || creator || 'The Void';
    const ownerAuthType = 'password';
    const id = crypto.randomUUID();
    const filename = `${id}.${ext}`;
    savedFilePath = path.join(LOCAL_UPLOAD_DIR, filename);
    writeFileAtomic(savedFilePath, buffer);

    await mutateLocalDb((db) => {
      db.wallpapers.unshift({
        id,
        title,
        creator: ownerName,
        creatorId: ownerId,
        authType: ownerAuthType,
        filename,
        mime,
        status: 'pending',
        createdAt: new Date().toISOString(),
        approvedAt: null,
        updatedAt: new Date().toISOString(),
      });
    });

    sendJson(res, 201, { ok: true, message: 'Wallpaper submitted for approval.' });
  } catch (error) {
    if (savedFilePath && fs.existsSync(savedFilePath)) {
      try { fs.unlinkSync(savedFilePath); } catch {}
    }
    sendJson(res, error.status || 400, { error: error.message || 'Upload failed.' });
  }
}

async function listApproved(req, res) {
  if (!(await ensureBackendReady(res))) return;
  if (USE_SUPABASE) return listSupabaseApproved(res);
  return listLocalApproved(res);
}

async function listSupabaseApproved(res) {
  try {
    const result = await supabase
      .from('wallpapers')
      .select('id,title,creator,creator_id,auth_type,storage_path,public_url,mime,status,created_at,approved_at,updated_at')
      .eq('status', 'approved')
      .order('created_at', { ascending: false });
    if (result.error) throw result.error;
    sendJson(res, 200, { wallpapers: (result.data || []).map(rowToItem).map(publicWallpaperDto) });
  } catch (error) {
    sendJson(res, 500, { error: friendlySupabaseError(error) || 'Could not load wallpapers.' });
  }
}

function listLocalApproved(res) {
  const db = readLocalDb();
  const wallpapers = db.wallpapers
    .filter((item) => item.status === 'approved')
    .map((item) => publicWallpaperDto({
      id: item.id,
      title: item.title,
      creator: item.creator,
      createdAt: item.createdAt,
      approvedAt: item.approvedAt,
    }));
  sendJson(res, 200, { wallpapers });
}

async function serveMedia(req, res, id) {
  if (!(await ensureBackendReady(res))) return;
  if (USE_SUPABASE) return serveSupabaseMedia(req, res, id);
  return serveLocalMedia(req, res, id);
}

async function serveSupabaseMedia(req, res, id, asDownload = false) {
  try {
    const result = await supabase
      .from('wallpapers')
      .select('id,title,creator,creator_id,auth_type,storage_path,public_url,mime,status')
      .eq('id', id)
      .maybeSingle();
    if (result.error) throw result.error;
    const item = result.data ? rowToItem(result.data) : null;
    if (!item || (item.status !== 'approved' && !isAdmin(req))) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const file = await supabase.storage.from(SUPABASE_BUCKET).download(item.storagePath);
    if (file.error) throw file.error;
    const arrayBuffer = await file.data.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.writeHead(200, {
      'Content-Type': item.mime || 'application/octet-stream',
      'Content-Length': buffer.length,
      'Cache-Control': item.status === 'approved' ? 'public, max-age=86400' : 'no-store',
      'Content-Disposition': `${asDownload ? 'attachment' : 'inline'}; filename="${safeDownloadName(item.title)}.${extForMime(item.mime) || 'jpg'}"`,
    });
    res.end(buffer);
  } catch (error) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(friendlySupabaseError(error) || 'Not found');
  }
}

function getLocalMediaFilePath(item) {
  const filename = path.basename(String(item.filename || ''));
  if (!filename) return '';
  const persisted = path.join(LOCAL_UPLOAD_DIR, filename);
  if (fs.existsSync(persisted)) return persisted;
  const bundled = path.join(BUNDLED_UPLOAD_DIR, filename);
  if (fs.existsSync(bundled)) return bundled;
  return persisted;
}

function serveLocalMedia(req, res, id, asDownload = false) {
  const db = readLocalDb();
  const item = db.wallpapers.find((entry) => entry.id === id);
  if (!item || (item.status !== 'approved' && !isAdmin(req))) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const filePath = getLocalMediaFilePath(item);
  if (!filePath || !fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': item.mime || mimeForExt(path.extname(filePath)),
    'Cache-Control': item.status === 'approved' && !asDownload ? 'public, max-age=86400' : 'no-store',
    'Content-Disposition': `${asDownload ? 'attachment' : 'inline'}; filename="${safeDownloadName(item.title)}.${extForMime(item.mime) || path.extname(filePath).replace(/^\./, '') || 'jpg'}"`,
  });
  fs.createReadStream(filePath).pipe(res);
}

function safeDownloadName(value) {
  return String(value || 'wallpaper')
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'wallpaper';
}

async function downloadWallpaper(req, res, id) {
  const user = await requireCreator(req, res);
  if (!user) return;
  if (USE_SUPABASE) return serveSupabaseMedia(req, res, id, true);
  return serveLocalMedia(req, res, id, true);
}

async function login(req, res) {
  try {
    const protection = await readAdminLoginProtection();
    if (protection.lockedUntilMs > Date.now()) {
      const retryAfterSeconds = retryAfterSecondsUntil(protection.lockedUntilMs);
      return sendJson(res, 423, lockoutPayload(`Admin login is locked on every device and network for ${formatHours(retryAfterSeconds)}.`, protection.lockedUntilMs));
    }

    const raw = await readBody(req, 16 * 1024);
    const { password } = JSON.parse(raw || '{}');
    const ok = safeCompare(sha256(password || ''), configuredHash);
    if (!ok) {
      const failedAttempts = protection.failedAttempts + 1;
      if (failedAttempts >= ADMIN_LOGIN_MAX_FAILED_ATTEMPTS) {
        const lockedUntilMs = Date.now() + ADMIN_LOGIN_LOCK_MS;
        await writeAdminLoginProtection({ failedAttempts, lockedUntilMs });
        return sendJson(res, 423, lockoutPayload('Wrong admin password entered too many times. Admin login is locked from every device and network for 3 hours.', lockedUntilMs));
      }
      await writeAdminLoginProtection({ failedAttempts, lockedUntilMs: 0 });
      return sendJson(res, 401, {
        error: `Invalid password. ${ADMIN_LOGIN_MAX_FAILED_ATTEMPTS - failedAttempts} attempt left before admin login locks for 3 hours.`,
        remainingAttempts: ADMIN_LOGIN_MAX_FAILED_ATTEMPTS - failedAttempts,
      });
    }

    await writeAdminLoginProtection({ failedAttempts: 0, lockedUntilMs: 0 });
    const token = crypto.randomBytes(32).toString('base64url');
    sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
    const secureCookie = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
    sendJson(res, 200, { ok: true }, {
      'Set-Cookie': `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secureCookie}`,
    });
  } catch (error) {
    sendJson(res, error.status || 400, { error: friendlySupabaseError(error) || error.message || 'Login failed.' });
  }
}

function logout(_req, res) {
  sendJson(res, 200, { ok: true }, {
    'Set-Cookie': `${ADMIN_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  });
}

function requireAdmin(req, res) {
  if (!isAdmin(req)) {
    sendJson(res, 401, { error: 'Admin login required.' });
    return false;
  }
  return true;
}

async function listPending(req, res) {
  if (!requireAdmin(req, res)) return;
  if (!(await ensureBackendReady(res))) return;
  if (USE_SUPABASE) return listSupabasePending(res);
  return listLocalPending(res);
}

async function listSupabasePending(res) {
  try {
    const result = await supabase
      .from('wallpapers')
      .select('id,title,creator,creator_id,auth_type,storage_path,public_url,mime,status,created_at,approved_at,updated_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (result.error) throw result.error;
    const pending = (result.data || []).map(rowToItem).map((item) => ({
      id: item.id,
      title: item.title,
      creator: item.creator || 'The Void',
      createdAt: item.createdAt,
      mediaUrl: mediaUrlForItem(item),
    }));
    sendJson(res, 200, { pending });
  } catch (error) {
    sendJson(res, 500, { error: friendlySupabaseError(error) || 'Could not load pending wallpapers.' });
  }
}

function listLocalPending(res) {
  const db = readLocalDb();
  const pending = db.wallpapers
    .filter((item) => item.status === 'pending')
    .map((item) => ({
      id: item.id,
      title: item.title,
      creator: item.creator || 'The Void',
      createdAt: item.createdAt,
      mediaUrl: `/media/${item.id}`,
    }));
  sendJson(res, 200, { pending });
}

async function storageStatus(req, res) {
  if (!requireAdmin(req, res)) return;
  await ensureBackendReady({ writeHead() {}, end() {} }).catch(() => {});
  sendJson(res, 200, {
    mode: USE_SUPABASE ? 'supabase' : 'local',
    ready: !setupError,
    error: setupError || null,
    renderDetected: isRender(),
    supabaseUrlConfigured: Boolean(SUPABASE_URL),
    serviceRoleKeyConfigured: Boolean(SUPABASE_SERVICE_ROLE_KEY),
    bucket: SUPABASE_BUCKET,
    profileBucket: SUPABASE_PROFILE_BUCKET,
    autoSyncStorage: AUTO_SYNC_STORAGE,
    enforceOneAccountPerIp: ENFORCE_ONE_ACCOUNT_PER_IP,
    localDataDir: USE_SUPABASE ? null : LOCAL_DATA_DIR,
  });
}


async function listAdminUsers(req, res) {
  if (!requireAdmin(req, res)) return;
  if (!(await ensureBackendReady(res))) return;
  if (USE_SUPABASE) return listSupabaseAdminUsers(req, res);
  return listLocalAdminUsers(req, res);
}

function countWallpapersByCreator(rows) {
  const counts = new Map();
  for (const row of rows || []) {
    const creatorId = row.creator_id || row.creatorId || '';
    if (!creatorId) continue;
    const status = row.status || 'unknown';
    const current = counts.get(creatorId) || { total: 0, approved: 0, pending: 0, rejected: 0 };
    current.total += 1;
    if (status === 'approved') current.approved += 1;
    if (status === 'pending') current.pending += 1;
    if (status === 'rejected') current.rejected += 1;
    counts.set(creatorId, current);
  }
  return counts;
}

async function listSupabaseAdminUsers(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const query = normalizeUsername(url.searchParams.get('q') || '');
    let request = supabase
      .from('users')
      .select('creator_id,creator_name,auth_type,email,password_hash,password_salt,signup_ip_hash,browser_key_hash,profile_pic_path,profile_pic_url,created_at,updated_at,last_login_at')
      .limit(50);

    if (query) {
      request = request.ilike('creator_name_key', `${query}%`).order('creator_name', { ascending: true });
    } else {
      request = request.order('created_at', { ascending: false });
    }

    const result = await request;
    if (result.error) throw result.error;

    const users = (result.data || []).map(normalizeUserRow).filter(Boolean);
    const ids = users.map((user) => user.creatorId).filter(Boolean);
    let counts = new Map();
    if (ids.length) {
      const wallpaperResult = await supabase
        .from('wallpapers')
        .select('creator_id,status')
        .in('creator_id', ids);
      if (wallpaperResult.error) throw wallpaperResult.error;
      counts = countWallpapersByCreator(wallpaperResult.data || []);
    }

    sendJson(res, 200, { users: users.map((user) => adminUserDto(user, counts.get(user.creatorId))) });
  } catch (error) {
    sendJson(res, 400, { error: friendlySupabaseError(error) || error.message || 'Could not load users.' });
  }
}

function listLocalAdminUsers(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const query = normalizeUsername(url.searchParams.get('q') || '');
    const localUsers = readLocalUsers().map(normalizeUserRow).filter(Boolean);
    const db = readLocalDb();
    const counts = countWallpapersByCreator(db.wallpapers || []);
    const users = localUsers
      .filter((user) => !query || normalizeUsername(user.creatorName).startsWith(query))
      .sort((a, b) => {
        if (query) return String(a.creatorName || '').localeCompare(String(b.creatorName || ''));
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      })
      .slice(0, 50)
      .map((user) => adminUserDto(user, counts.get(user.creatorId)));
    sendJson(res, 200, { users });
  } catch (error) {
    sendJson(res, error.status || 400, { error: error.message || 'Could not load users.' });
  }
}

async function deleteAdminUser(req, res, creatorId) {
  if (!requireAdmin(req, res)) return;
  if (!(await ensureBackendReady(res))) return;
  const id = String(creatorId || '').trim();
  if (!id) return sendJson(res, 400, { error: 'User ID is required.' });
  if (USE_SUPABASE) return deleteSupabaseAdminUser(res, id);
  return deleteLocalAdminUser(res, id);
}

async function deleteSupabaseAdminUser(res, creatorId) {
  try {
    const userResult = await supabase
      .from('users')
      .select('creator_id,creator_name,auth_type,email,password_hash,password_salt,signup_ip_hash,browser_key_hash,profile_pic_path,profile_pic_url,created_at,updated_at,last_login_at')
      .eq('creator_id', creatorId)
      .maybeSingle();
    if (userResult.error) throw userResult.error;
    const user = normalizeUserRow(userResult.data);
    if (!user) return sendJson(res, 404, { error: 'User not found.' });

    const wallpaperResult = await supabase
      .from('wallpapers')
      .select('id,storage_path,status')
      .eq('creator_id', creatorId);
    if (wallpaperResult.error) throw wallpaperResult.error;

    const wallpapers = wallpaperResult.data || [];
    const wallpaperPaths = wallpapers.map((item) => item.storage_path).filter(Boolean);

    const deleteWallpapers = await supabase
      .from('wallpapers')
      .delete()
      .eq('creator_id', creatorId);
    if (deleteWallpapers.error) throw deleteWallpapers.error;

    const deleteUser = await supabase
      .from('users')
      .delete()
      .eq('creator_id', creatorId);
    if (deleteUser.error) throw deleteUser.error;

    const storageErrors = [];
    storageErrors.push(...await removeStorageObjects(SUPABASE_BUCKET, wallpaperPaths));
    if (user.profilePicPath) {
      storageErrors.push(...await removeStorageObjects(SUPABASE_PROFILE_BUCKET, [user.profilePicPath]));
    }

    await clearUserSessionsForCreator(creatorId);

    const payload = {
      ok: true,
      message: `Deleted @${user.creatorName} completely. That device/IP can create a new profile again unless another active profile from the same IP/browser still exists.`,
      deletedUser: adminUserDto(user, countWallpapersByCreator(wallpapers).get(creatorId)),
      deletedWallpapers: wallpapers.length,
      clearedSignupLock: Boolean(user.signupIpHash || user.browserKeyHash),
    };
    if (storageErrors.length) {
      payload.warning = 'User was deleted, but some Storage files may need manual cleanup.';
      payload.storageErrors = storageErrors;
    }
    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, error.status || 400, { error: friendlySupabaseError(error) || error.message || 'Could not delete user.' });
  }
}

async function deleteLocalAdminUser(res, creatorId) {
  try {
    let removedUser = null;
    const removedWallpaperFiles = await mutateLocalDb((db) => {
      const removed = db.wallpapers.filter((item) => item.creatorId === creatorId);
      db.wallpapers = db.wallpapers.filter((item) => item.creatorId !== creatorId);
      const stillReferenced = new Set(db.wallpapers.map((item) => path.basename(String(item.filename || ''))).filter(Boolean));
      return removed
        .map((item) => path.basename(String(item.filename || '')))
        .filter((filename) => filename && !stillReferenced.has(filename));
    });

    removedUser = await mutateLocalUsers((users) => {
      const index = users.findIndex((entry) => entry.creatorId === creatorId);
      if (index < 0) {
        const error = new Error('User not found.');
        error.status = 404;
        throw error;
      }
      const [removed] = users.splice(index, 1);
      return normalizeUserRow(removed);
    });

    for (const filename of removedWallpaperFiles) {
      const filePath = path.join(LOCAL_UPLOAD_DIR, path.basename(filename));
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch {}
      }
    }
    if (removedUser?.profilePicPath) {
      const avatarPath = path.join(LOCAL_PROFILE_PIC_DIR, path.basename(removedUser.profilePicPath));
      if (fs.existsSync(avatarPath)) {
        try { fs.unlinkSync(avatarPath); } catch {}
      }
    }

    await clearUserSessionsForCreator(creatorId);
    sendJson(res, 200, {
      ok: true,
      message: `Deleted @${removedUser.creatorName} completely. That device/IP can create a new profile again unless another active profile from the same IP/browser still exists.`,
      deletedUser: adminUserDto(removedUser, { total: removedWallpaperFiles.length }),
      deletedWallpapers: removedWallpaperFiles.length,
      clearedSignupLock: Boolean(removedUser.signupIpHash || removedUser.browserKeyHash),
    });
  } catch (error) {
    sendJson(res, error.status || 400, { error: error.message || 'Could not delete user.' });
  }
}

async function cleanupAdminUserLocks(req, res) {
  if (!requireAdmin(req, res)) return;
  if (!(await ensureBackendReady(res))) return;
  if (USE_SUPABASE) return cleanupSupabaseAdminUserLocks(res);
  return cleanupLocalAdminUserLocks(res);
}

async function cleanupSupabaseAdminUserLocks(res) {
  try {
    const usersResult = await supabase
      .from('users')
      .select('creator_id,creator_name,auth_type,password_hash,password_salt,signup_ip_hash,browser_key_hash');
    if (usersResult.error) throw usersResult.error;

    const rows = usersResult.data || [];
    const validCreatorIds = new Set(rows.map((row) => row.creator_id).filter(Boolean));
    const staleRows = rows.filter((row) => !isActiveSignupLockUser(row) && (row.signup_ip_hash || row.browser_key_hash));

    let clearedRows = 0;
    for (const row of staleRows) {
      const result = await supabase
        .from('users')
        .update({ signup_ip_hash: null, browser_key_hash: null })
        .eq('creator_id', row.creator_id);
      if (result.error) throw result.error;
      clearedRows += 1;
    }

    const sessionsByCreator = await readActiveUserSessions();
    let removedSessions = 0;
    for (const creatorId of Object.keys(sessionsByCreator)) {
      if (!validCreatorIds.has(creatorId)) {
        delete sessionsByCreator[creatorId];
        removedSessions += 1;
      }
    }
    if (removedSessions) await writeActiveUserSessions(sessionsByCreator);

    sendJson(res, 200, {
      ok: true,
      message: 'Cleaned stale signup/session locks. Active users keep their IP/device locks.',
      clearedMalformedSignupRows: clearedRows,
      clearedOrphanedActiveSessions: removedSessions,
    });
  } catch (error) {
    sendJson(res, error.status || 400, { error: friendlySupabaseError(error) || error.message || 'Could not clean stale locks.' });
  }
}

async function cleanupLocalAdminUserLocks(res) {
  try {
    let clearedRows = 0;
    const validCreatorIds = new Set();
    await mutateLocalUsers((users) => {
      for (const user of users) {
        if (user.creatorId) validCreatorIds.add(user.creatorId);
        if (!isActiveSignupLockUser(user) && (user.signupIpHash || user.browserKeyHash)) {
          user.signupIpHash = '';
          user.browserKeyHash = '';
          clearedRows += 1;
        }
      }
    });
    const sessionsByCreator = await readActiveUserSessions();
    let removedSessions = 0;
    for (const creatorId of Object.keys(sessionsByCreator)) {
      if (!validCreatorIds.has(creatorId)) {
        delete sessionsByCreator[creatorId];
        removedSessions += 1;
      }
    }
    if (removedSessions) await writeActiveUserSessions(sessionsByCreator);
    sendJson(res, 200, {
      ok: true,
      message: 'Cleaned stale signup/session locks. Active users keep their IP/device locks.',
      clearedMalformedSignupRows: clearedRows,
      clearedOrphanedActiveSessions: removedSessions,
    });
  } catch (error) {
    sendJson(res, error.status || 400, { error: error.message || 'Could not clean stale locks.' });
  }
}

async function updateWallpaperDetails(req, res, id) {
  if (!requireAdmin(req, res)) return;
  if (!(await ensureBackendReady(res))) return;
  if (USE_SUPABASE) return updateSupabaseWallpaperDetails(req, res, id);
  return updateLocalWallpaperDetails(req, res, id);
}

async function parseDetailsPayload(req) {
  const raw = await readBody(req, 32 * 1024);
  const payload = JSON.parse(raw || '{}');
  const title = String(payload.title || '').trim().slice(0, 80);
  const creator = String(payload.creator || '').trim().slice(0, 60);
  if (!title) {
    const error = new Error('Wallpaper name is required.');
    error.status = 400;
    throw error;
  }
  if (!creator) {
    const error = new Error('Username is required.');
    error.status = 400;
    throw error;
  }
  return { title, creator };
}

async function updateSupabaseWallpaperDetails(req, res, id) {
  try {
    const { title, creator } = await parseDetailsPayload(req);
    const result = await supabase
      .from('wallpapers')
      .update({ title, creator, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id,title,creator')
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return sendJson(res, 404, { error: 'Wallpaper not found.' });
    sendJson(res, 200, { ok: true, wallpaper: result.data });
  } catch (error) {
    sendJson(res, error.status || 400, { error: friendlySupabaseError(error) || 'Could not update wallpaper details.' });
  }
}

async function updateLocalWallpaperDetails(req, res, id) {
  try {
    const { title, creator } = await parseDetailsPayload(req);
    const updated = await mutateLocalDb((db) => {
      const item = db.wallpapers.find((entry) => entry.id === id);
      if (!item) {
        const error = new Error('Wallpaper not found.');
        error.status = 404;
        throw error;
      }
      item.title = title;
      item.creator = creator;
      item.updatedAt = new Date().toISOString();
      return { id: item.id, title: item.title, creator: item.creator };
    });
    sendJson(res, 200, { ok: true, wallpaper: updated });
  } catch (error) {
    sendJson(res, error.status || 400, { error: error.message || 'Could not update wallpaper details.' });
  }
}

async function moderate(req, res, id, status) {
  if (!requireAdmin(req, res)) return;
  if (!(await ensureBackendReady(res))) return;
  if (USE_SUPABASE) return moderateSupabase(req, res, id, status);
  return moderateLocal(req, res, id, status);
}

async function moderateSupabase(_req, res, id, status) {
  try {
    if (!['approved', 'rejected'].includes(status)) return sendJson(res, 400, { error: 'Invalid status.' });
    const now = new Date().toISOString();
    const patch = {
      status,
      approved_at: status === 'approved' ? now : null,
      updated_at: now,
    };
    const result = await supabase
      .from('wallpapers')
      .update(patch)
      .eq('id', id)
      .select('id,storage_path,status')
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return sendJson(res, 404, { error: 'Wallpaper not found.' });

    if (status === 'rejected' && result.data.storage_path) {
      try { await supabase.storage.from(SUPABASE_BUCKET).remove([result.data.storage_path]); } catch {}
    }
    sendJson(res, 200, { ok: true, status });
  } catch (error) {
    sendJson(res, 400, { error: friendlySupabaseError(error) || 'Moderation failed.' });
  }
}

async function moderateLocal(_req, res, id, status) {
  try {
    if (!['approved', 'rejected'].includes(status)) return sendJson(res, 400, { error: 'Invalid status.' });
    await mutateLocalDb((db) => {
      const item = db.wallpapers.find((entry) => entry.id === id);
      if (!item) {
        const error = new Error('Wallpaper not found.');
        error.status = 404;
        throw error;
      }
      item.status = status;
      item.approvedAt = status === 'approved' ? new Date().toISOString() : null;
      item.updatedAt = new Date().toISOString();
    });
    sendJson(res, 200, { ok: true, status });
  } catch (error) {
    sendJson(res, error.status || 400, { error: error.message || 'Moderation failed.' });
  }
}

async function deleteWallpaper(req, res, id) {
  if (!requireAdmin(req, res)) return;
  if (!(await ensureBackendReady(res))) return;
  if (USE_SUPABASE) return deleteSupabaseWallpaper(res, id);
  return deleteLocalWallpaper(res, id);
}

async function deleteSupabaseWallpaper(res, id) {
  try {
    const find = await supabase
      .from('wallpapers')
      .select('id,storage_path,status')
      .eq('id', id)
      .maybeSingle();
    if (find.error) throw find.error;
    if (!find.data) return sendJson(res, 404, { error: 'Wallpaper not found.' });

    const now = new Date().toISOString();
    const markRejected = await supabase
      .from('wallpapers')
      .update({ status: 'rejected', approved_at: null, updated_at: now })
      .eq('id', id);
    if (markRejected.error) throw markRejected.error;

    if (find.data.storage_path) {
      try { await supabase.storage.from(SUPABASE_BUCKET).remove([find.data.storage_path]); } catch {}
    }
    sendJson(res, 200, { ok: true, status: 'rejected', message: 'Wallpaper deleted from the app and moved to Rejected.' });
  } catch (error) {
    sendJson(res, 400, { error: friendlySupabaseError(error) || 'Delete failed.' });
  }
}

async function deleteLocalWallpaper(res, id) {
  try {
    const removed = await mutateLocalDb((db) => {
      const item = db.wallpapers.find((entry) => entry.id === id);
      if (!item) {
        const error = new Error('Wallpaper not found.');
        error.status = 404;
        throw error;
      }
      const previousFilename = item.filename;
      item.status = 'rejected';
      item.approvedAt = null;
      item.updatedAt = new Date().toISOString();
      const stillReferenced = db.wallpapers.some((entry) => entry.id !== id && entry.filename === previousFilename);
      return { item: { ...item, filename: previousFilename }, stillReferenced };
    });

    const filename = path.basename(String(removed.item.filename || ''));
    if (filename && !removed.stillReferenced) {
      const filePath = path.join(LOCAL_UPLOAD_DIR, filename);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch {}
      }
    }
    sendJson(res, 200, { ok: true, status: 'rejected', message: 'Wallpaper deleted from the app and moved to Rejected.' });
  } catch (error) {
    sendJson(res, error.status || 400, { error: error.message || 'Delete failed.' });
  }
}

const server = http.createServer(async (req, res) => {
  applySecurityHeaders(res);
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    if (isStateChangingMethod(req.method) && pathname.startsWith('/api/') && !passesOriginCsrfCheck(req)) {
      return sendJson(res, 403, { error: 'Security check failed. Refresh the page and try again.' });
    }

    if (req.method === 'POST' && pathname === '/api/check-username') return checkUsername(req, res);
    if (req.method === 'POST' && pathname === '/api/create-user') return createUser(req, res);
    if (req.method === 'POST' && pathname === '/api/auth/signup') return signupUser(req, res);
    if (req.method === 'POST' && pathname === '/api/auth/login') return loginUser(req, res);
    if (req.method === 'POST' && pathname === '/api/auth/logout') return logoutUser(req, res);
    if (req.method === 'POST' && pathname === '/api/auth/change-password') return changePassword(req, res);
    if (req.method === 'GET' && pathname === '/api/profile') return getProfile(req, res);
    if (req.method === 'POST' && pathname === '/api/profile/avatar') return updateProfilePicture(req, res);
    if (req.method === 'POST' && pathname === '/api/profile/delete') return deleteProfile(req, res);
    if (req.method === 'GET' && pathname === '/api/users/search') return searchUsers(req, res);
    const publicUserMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
    if (req.method === 'GET' && publicUserMatch) return getPublicUserProfile(req, res, publicUserMatch[1]);
    if (req.method === 'POST' && pathname === '/api/upload') return handleUpload(req, res);
    if (req.method === 'GET' && pathname === '/api/wallpapers') return listApproved(req, res);
    if (req.method === 'POST' && pathname === '/api/admin/login') return login(req, res);
    if (req.method === 'POST' && pathname === '/api/admin/logout') return logout(req, res);
    if (req.method === 'GET' && pathname === '/api/admin/pending') return listPending(req, res);
    if (req.method === 'GET' && pathname === '/api/admin/storage') return storageStatus(req, res);
    if (req.method === 'GET' && pathname === '/api/admin/users') return listAdminUsers(req, res);
    if (req.method === 'POST' && pathname === '/api/admin/users/cleanup-stale-locks') return cleanupAdminUserLocks(req, res);
    const adminUserDeleteMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/delete$/);
    if (req.method === 'POST' && adminUserDeleteMatch) return deleteAdminUser(req, res, adminUserDeleteMatch[1]);

    const updateMatch = pathname.match(/^\/api\/admin\/wallpapers\/([a-f0-9-]+)\/update$/);
    if (req.method === 'POST' && updateMatch) return updateWallpaperDetails(req, res, updateMatch[1]);

    const moderationMatch = pathname.match(/^\/api\/admin\/wallpapers\/([a-f0-9-]+)\/(approve|reject)$/);
    if (req.method === 'POST' && moderationMatch) {
      return moderate(req, res, moderationMatch[1], moderationMatch[2] === 'approve' ? 'approved' : 'rejected');
    }

    const deleteMatch = pathname.match(/^\/api\/admin\/wallpapers\/([a-f0-9-]+)\/delete$/);
    if (req.method === 'POST' && deleteMatch) return deleteWallpaper(req, res, deleteMatch[1]);

    const downloadMatch = pathname.match(/^\/api\/download\/([a-f0-9-]+)$/);
    if (req.method === 'GET' && downloadMatch) return downloadWallpaper(req, res, downloadMatch[1]);

    const mediaMatch = pathname.match(/^\/media\/([a-f0-9-]+)$/);
    if (req.method === 'GET' && mediaMatch) return serveMedia(req, res, mediaMatch[1]);

    const profilePicMatch = pathname.match(/^\/profile-pics\/([^/]+)$/);
    if (req.method === 'GET' && profilePicMatch) return serveLocalProfilePic(req, res, profilePicMatch[1]);

    if (req.method === 'GET') return serveStatic(req, res, pathname);
    sendJson(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Server error.' });
  }
});

function getLanUrls() {
  const interfaces = os.networkInterfaces();
  const urls = [];
  for (const values of Object.values(interfaces)) {
    for (const item of values || []) {
      if (item.family === 'IPv4' && !item.internal) urls.push(`http://${item.address}:${PORT}`);
    }
  }
  return urls;
}

server.listen(PORT, HOST, () => {
  console.log(`THE VOID is running at http://localhost:${PORT}`);
  console.log(`Admin page: http://localhost:${PORT}/admin`);
  console.log(`Public directory: ${PUBLIC_DIR}`);
  console.log(`Storage mode: ${USE_SUPABASE ? 'Supabase Storage + Supabase DB' : 'local development fallback'}`);
  if (USE_SUPABASE) {
    console.log(`Supabase bucket: ${SUPABASE_BUCKET}`);
  } else if (setupError) {
    console.log(`Setup required: ${setupError}`);
  } else {
    console.log(`Local wallpaper data directory: ${LOCAL_DATA_DIR}`);
  }

  const lanUrls = getLanUrls();
  if (lanUrls.length) {
    console.log('\nOpen one of these on your phone while connected to the same Wi-Fi:');
    for (const url of lanUrls) console.log(`  ${url}`);
    console.log('');
  }
});
