#!/usr/bin/env node

import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createServer } from 'node:http';
import crypto from 'node:crypto';

const CONFIG_DIR = join(homedir(), '.openclaw');
const CONFIG_FILE = join(CONFIG_DIR, 'whoop-config.json');
const OPENCLAW_CONFIG_FILE = join(CONFIG_DIR, 'openclaw.json');
const BASE_URL = 'https://api.prod.whoop.com';
const REDIRECT_URI = 'http://localhost:3000/callback';

const TOKEN_REFRESH_BUFFER_MS = 15 * 60 * 1000; // 15 minutes
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.WHOOP_HTTP_TIMEOUT_MS || '20000', 10);

let CLIENT_ID = process.env.WHOOP_CLIENT_ID || '';
let CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET || '';
let refreshInFlight = null;

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function shouldRefreshToken(config) {
  if (!config?.expires_at) return true;
  return Date.now() >= (config.expires_at - TOKEN_REFRESH_BUFFER_MS);
}

async function loadConfig() {
  try {
    if (!existsSync(CONFIG_FILE)) return {};
    const data = await readFile(CONFIG_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveConfig(config) {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));

  // Best effort file permissions hardening
  try {
    await chmod(CONFIG_FILE, 0o600);
  } catch {
    // no-op on filesystems/platforms that do not support chmod
  }
}

async function initWhoopCredentials() {
  if (CLIENT_ID && CLIENT_SECRET) return;

  try {
    if (!existsSync(OPENCLAW_CONFIG_FILE)) return;
    const raw = await readFile(OPENCLAW_CONFIG_FILE, 'utf8');
    const cfg = JSON.parse(raw);
    const whoopEnv = cfg?.skills?.entries?.whoop?.env || {};

    if (!CLIENT_ID && typeof whoopEnv.WHOOP_CLIENT_ID === 'string') {
      CLIENT_ID = whoopEnv.WHOOP_CLIENT_ID;
    }
    if (!CLIENT_SECRET && typeof whoopEnv.WHOOP_CLIENT_SECRET === 'string') {
      CLIENT_SECRET = whoopEnv.WHOOP_CLIENT_SECRET;
    }
  } catch {
    // no-op; fall back to env-only behavior
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function refreshAccessToken() {
  const config = await loadConfig();

  if (!config.refresh_token) {
    throw new Error('No refresh token available. Please run: auth');
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET must be set');
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: config.refresh_token,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: 'offline',
  });

  const response = await fetchWithTimeout(`${BASE_URL}/oauth/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const next = {
    ...config,
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in * 1000),
    refresh_token: data.refresh_token || config.refresh_token,
    token_type: data.token_type || config.token_type || 'bearer',
    scope: data.scope || config.scope,
  };

  await saveConfig(next);
  return next.access_token;
}

async function refreshAccessTokenLocked() {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken().finally(() => {
      refreshInFlight = null;
    });
  }

  return refreshInFlight;
}

async function getAccessToken() {
  const config = await loadConfig();

  if (!config.access_token && !config.refresh_token) {
    throw new Error('Not authenticated. Please run: auth');
  }

  if (!shouldRefreshToken(config) && config.access_token) {
    return config.access_token;
  }

  return await refreshAccessTokenLocked();
}

async function apiRequest(endpoint, options = {}, { retryOnUnauthorized = true } = {}) {
  const url = `${BASE_URL}${endpoint}`;

  const doRequest = async (token) => {
    return await fetchWithTimeout(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
  };

  let token = await getAccessToken();
  let response = await doRequest(token);

  if (response.status === 401 && retryOnUnauthorized) {
    // Access token may have been invalidated server-side. Force one refresh and retry.
    await refreshAccessTokenLocked();
    token = await getAccessToken();
    response = await doRequest(token);
  }

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${await response.text()}`);
  }

  return await response.json();
}

function browserOpenCommand(url) {
  if (process.platform === 'darwin') {
    return `open "${url}"`;
  }
  if (process.platform === 'win32') {
    return `start "" "${url}"`;
  }
  return `xdg-open "${url}"`;
}

async function openBrowser(url) {
  const { exec } = await import('node:child_process');
  exec(browserOpenCommand(url));
}

// Commands
async function cmdAuth() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('Error: WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET must be set');
    console.error('Set them in your OpenClaw config or environment variables');
    process.exit(1);
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = crypto.randomBytes(16).toString('hex');

  const authUrl = new URL(`${BASE_URL}/oauth/oauth2/auth`);
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'offline read:recovery read:cycles read:workout read:sleep read:profile');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  console.error('Opening browser for authentication...');
  console.error(`If it does not open automatically, visit: ${authUrl.toString()}`);

  await openBrowser(authUrl.toString());

  // Start callback server
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.close(() => fn(value));
    };

    const server = createServer(async (req, res) => {
      if (!req.url) {
        res.writeHead(400);
        res.end('Bad request');
        return;
      }

      const callbackUrl = new URL(req.url, REDIRECT_URI);

      if (callbackUrl.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = callbackUrl.searchParams.get('code');
      const returnedState = callbackUrl.searchParams.get('state');

      if (!code) {
        res.writeHead(400);
        res.end('Missing code');
        return finish(reject, new Error('Missing authorization code'));
      }

      if (returnedState !== state) {
        res.writeHead(400);
        res.end('State mismatch');
        return finish(reject, new Error('State mismatch'));
      }

      try {
        const params = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code_verifier: codeVerifier,
        });

        const response = await fetchWithTimeout(`${BASE_URL}/oauth/oauth2/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });

        if (!response.ok) {
          throw new Error(`Token exchange failed: ${response.status} ${await response.text()}`);
        }

        const data = await response.json();
        const config = {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: Date.now() + (data.expires_in * 1000),
          token_type: data.token_type || 'bearer',
          scope: data.scope,
        };

        await saveConfig(config);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Authentication successful!</h1><p>You can close this window.</p></body></html>');

        console.log(JSON.stringify({ success: true, message: 'Authentication successful' }));
        finish(resolve);
      } catch (err) {
        res.writeHead(500);
        res.end('Authentication failed');
        finish(reject, err);
      }
    });

    server.listen(3000, () => {
      console.error('Waiting for callback on http://localhost:3000/callback');
    });

    const timeout = setTimeout(() => {
      finish(reject, new Error('Authentication timeout'));
    }, 300000);

    // Don't keep the process alive solely for the timeout.
    timeout.unref?.();
  });
}

async function cmdRefresh() {
  const token = await refreshAccessTokenLocked();
  const config = await loadConfig();

  console.log(JSON.stringify({
    success: true,
    message: 'Token refreshed',
    expires_at: config.expires_at,
    has_access_token: Boolean(token),
    has_refresh_token: Boolean(config.refresh_token),
  }, null, 2));
}

async function cmdStatus() {
  const config = await loadConfig();
  const now = Date.now();
  const expiresInMs = config.expires_at ? (config.expires_at - now) : null;

  console.log(JSON.stringify({
    authenticated: Boolean(config.access_token || config.refresh_token),
    has_access_token: Boolean(config.access_token),
    has_refresh_token: Boolean(config.refresh_token),
    expires_at: config.expires_at || null,
    expires_in_seconds: typeof expiresInMs === 'number' ? Math.floor(expiresInMs / 1000) : null,
    needs_refresh: shouldRefreshToken(config),
  }, null, 2));
}

async function cmdMe() {
  const data = await apiRequest('/developer/v2/user/profile/basic');
  console.log(JSON.stringify(data, null, 2));
}

function addRangeParams(params, args) {
  if (args.start) params.set('start', args.start);
  if (args.end) params.set('end', args.end);

  if (args.days) {
    const days = Number.parseInt(String(args.days), 10);
    if (!Number.isFinite(days) || days <= 0) {
      throw new Error('--days must be a positive integer');
    }

    const end = new Date();
    const start = new Date(end.getTime() - (days * 24 * 60 * 60 * 1000));
    params.set('start', start.toISOString());
    params.set('end', end.toISOString());
  }
}

async function cmdRecovery(args) {
  const params = new URLSearchParams();
  addRangeParams(params, args);
  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await apiRequest(`/developer/v2/recovery${query}`);
  console.log(JSON.stringify(data, null, 2));
}

async function cmdSleep(args) {
  const params = new URLSearchParams();
  addRangeParams(params, args);
  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await apiRequest(`/developer/v2/activity/sleep${query}`);
  console.log(JSON.stringify(data, null, 2));
}

async function cmdCycles(args) {
  const params = new URLSearchParams();
  addRangeParams(params, args);
  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await apiRequest(`/developer/v2/cycle${query}`);
  console.log(JSON.stringify(data, null, 2));
}

async function cmdWorkouts(args) {
  const params = new URLSearchParams();
  addRangeParams(params, args);
  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await apiRequest(`/developer/v2/activity/workout${query}`);
  console.log(JSON.stringify(data, null, 2));
}

async function cmdLatest() {
  const today = new Date();
  const lookback = new Date(today.getTime() - (24 * 60 * 60 * 1000));
  const start = lookback.toISOString();
  const end = today.toISOString();

  const [recovery, sleep, cycles] = await Promise.all([
    apiRequest(`/developer/v2/recovery?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`).catch(() => null),
    apiRequest(`/developer/v2/activity/sleep?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`).catch(() => null),
    apiRequest(`/developer/v2/cycle?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`).catch(() => null),
  ]);

  const result = {
    recovery: recovery?.records?.[recovery.records.length - 1] || null,
    sleep: sleep?.records?.[sleep.records.length - 1] || null,
    cycle: cycles?.records?.[cycles.records.length - 1] || null,
  };

  console.log(JSON.stringify(result, null, 2));
}

function showHelp() {
  console.error(`
Whoop API CLI

Usage: whoop.mjs <command> [options]

Commands:
  auth                         Start OAuth authentication flow
  refresh                      Proactively refresh access/refresh token pair
  status                       Show local token/auth status
  me                           Get user profile
  recovery [options]           Get recovery data
  sleep [options]              Get sleep data
  cycles [options]             Get cycle data
  workouts [options]           Get workout data
  latest                       Get latest recovery, sleep, and cycle data

Options:
  --days N                     Get data for last N days
  --start DATE                 Start date (ISO 8601)
  --end DATE                   End date (ISO 8601)
  --help                       Show this help

Environment Variables:
  WHOOP_CLIENT_ID              OAuth client ID (required for auth)
  WHOOP_CLIENT_SECRET          OAuth client secret (required for auth)
  WHOOP_HTTP_TIMEOUT_MS        HTTP request timeout in ms (default: 20000)

Examples:
  whoop.mjs auth
  whoop.mjs refresh
  whoop.mjs status
  whoop.mjs me
  whoop.mjs recovery --days 7
  whoop.mjs sleep --start 2026-02-01 --end 2026-02-08
  whoop.mjs latest
`);
}

async function main() {
  await initWhoopCredentials();

  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help') {
    showHelp();
    process.exit(0);
  }

  // Parse flags
  const flags = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1];
      flags[key] = value && !value.startsWith('--') ? value : true;
      if (value && !value.startsWith('--')) i++;
    }
  }

  try {
    switch (command) {
      case 'auth':
        await cmdAuth();
        break;
      case 'refresh':
        await cmdRefresh();
        break;
      case 'status':
        await cmdStatus();
        break;
      case 'me':
        await cmdMe();
        break;
      case 'recovery':
        await cmdRecovery(flags);
        break;
      case 'sleep':
        await cmdSleep(flags);
        break;
      case 'cycles':
        await cmdCycles(flags);
        break;
      case 'workouts':
        await cmdWorkouts(flags);
        break;
      case 'latest':
        await cmdLatest();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
