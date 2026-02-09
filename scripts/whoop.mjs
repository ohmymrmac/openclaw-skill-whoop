#!/usr/bin/env node

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createServer } from 'node:http';
import { parse } from 'node:url';
import crypto from 'node:crypto';

const CONFIG_DIR = join(homedir(), '.openclaw');
const CONFIG_FILE = join(CONFIG_DIR, 'whoop-config.json');
const BASE_URL = 'https://api.prod.whoop.com';
const CLIENT_ID = process.env.WHOOP_CLIENT_ID || '';
const CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET || '';
const REDIRECT_URI = 'http://localhost:3000/callback';

// Utility functions
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

async function loadConfig() {
  try {
    if (!existsSync(CONFIG_FILE)) return {};
    const data = await readFile(CONFIG_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return {};
  }
}

async function saveConfig(config) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

async function refreshAccessToken(config) {
  if (!config.refresh_token) {
    throw new Error('No refresh token available. Please run: auth');
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: config.refresh_token,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });

  const response = await fetch(`${BASE_URL}/oauth/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  config.access_token = data.access_token;
  config.expires_at = Date.now() + (data.expires_in * 1000);
  if (data.refresh_token) {
    config.refresh_token = data.refresh_token;
  }
  await saveConfig(config);
  return config.access_token;
}

async function getAccessToken() {
  const config = await loadConfig();
  
  if (!config.access_token) {
    throw new Error('Not authenticated. Please run: auth');
  }

  // Check if token is expired (with 5 minute buffer)
  if (config.expires_at && Date.now() >= (config.expires_at - 300000)) {
    return await refreshAccessToken(config);
  }

  return config.access_token;
}

async function apiRequest(endpoint, options = {}) {
  const token = await getAccessToken();
  const url = `${BASE_URL}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${await response.text()}`);
  }

  return await response.json();
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
  authUrl.searchParams.set('scope', 'read:recovery read:cycles read:workout read:sleep read:profile');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  console.error('Opening browser for authentication...');
  console.error(`If it doesn't open automatically, visit: ${authUrl.toString()}`);
  
  // Open browser
  const { exec } = await import('node:child_process');
  exec(`open "${authUrl.toString()}"`);

  // Start callback server
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const parsedUrl = parse(req.url, true);
      
      if (parsedUrl.pathname === '/callback') {
        const { code, state: returnedState } = parsedUrl.query;
        
        if (returnedState !== state) {
          res.writeHead(400);
          res.end('State mismatch');
          server.close();
          return reject(new Error('State mismatch'));
        }

        try {
          // Exchange code for token
          const params = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code_verifier: codeVerifier,
          });

          const response = await fetch(`${BASE_URL}/oauth/oauth2/token`, {
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
          };

          await saveConfig(config);

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Authentication successful!</h1><p>You can close this window.</p></body></html>');
          
          console.log(JSON.stringify({ success: true, message: 'Authentication successful' }));
          
          server.close();
          resolve();
        } catch (err) {
          res.writeHead(500);
          res.end('Authentication failed');
          server.close();
          reject(err);
        }
      }
    });

    server.listen(3000, () => {
      console.error('Waiting for callback on http://localhost:3000/callback');
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Authentication timeout'));
    }, 300000);
  });
}

async function cmdMe() {
  const data = await apiRequest('/developer/v1/user/profile/basic');
  console.log(JSON.stringify(data, null, 2));
}

async function cmdRecovery(args) {
  const params = new URLSearchParams();
  
  if (args.start) params.set('start', args.start);
  if (args.end) params.set('end', args.end);
  if (args.days) {
    const end = new Date();
    const start = new Date(end.getTime() - (args.days * 24 * 60 * 60 * 1000));
    params.set('start', start.toISOString());
    params.set('end', end.toISOString());
  }
  
  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await apiRequest(`/developer/v2/recovery${query}`);
  console.log(JSON.stringify(data, null, 2));
}

async function cmdSleep(args) {
  const params = new URLSearchParams();
  
  if (args.start) params.set('start', args.start);
  if (args.end) params.set('end', args.end);
  if (args.days) {
    const end = new Date();
    const start = new Date(end.getTime() - (args.days * 24 * 60 * 60 * 1000));
    params.set('start', start.toISOString());
    params.set('end', end.toISOString());
  }
  
  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await apiRequest(`/developer/v2/activity/sleep${query}`);
  console.log(JSON.stringify(data, null, 2));
}

async function cmdCycles(args) {
  const params = new URLSearchParams();
  
  if (args.start) params.set('start', args.start);
  if (args.end) params.set('end', args.end);
  if (args.days) {
    const end = new Date();
    const start = new Date(end.getTime() - (args.days * 24 * 60 * 60 * 1000));
    params.set('start', start.toISOString());
    params.set('end', end.toISOString());
  }
  
  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await apiRequest(`/developer/v1/cycle${query}`);
  console.log(JSON.stringify(data, null, 2));
}

async function cmdWorkouts(args) {
  const params = new URLSearchParams();
  
  if (args.start) params.set('start', args.start);
  if (args.end) params.set('end', args.end);
  if (args.days) {
    const end = new Date();
    const start = new Date(end.getTime() - (args.days * 24 * 60 * 60 * 1000));
    params.set('start', start.toISOString());
    params.set('end', end.toISOString());
  }
  
  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await apiRequest(`/v1/workout${query}`);
  console.log(JSON.stringify(data, null, 2));
}

async function cmdLatest() {
  const today = new Date();
  const yesterday = new Date(today.getTime() - (24 * 60 * 60 * 1000));
  const start = yesterday.toISOString();
  const end = today.toISOString();

  const [recovery, sleep, cycles] = await Promise.all([
    apiRequest(`/developer/v2/recovery?start=${start}&end=${end}`).catch(() => null),
    apiRequest(`/developer/v2/activity/sleep?start=${start}&end=${end}`).catch(() => null),
    apiRequest(`/developer/v1/cycle?start=${start}&end=${end}`).catch(() => null),
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
  auth                          Start OAuth authentication flow
  me                            Get user profile
  recovery [options]            Get recovery data
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
  WHOOP_CLIENT_ID             OAuth client ID (required for auth)
  WHOOP_CLIENT_SECRET         OAuth client secret (required for auth)

Examples:
  whoop.mjs auth
  whoop.mjs me
  whoop.mjs recovery --days 7
  whoop.mjs sleep --start 2026-02-01 --end 2026-02-08
  whoop.mjs latest
`);
}

// Main
async function main() {
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
