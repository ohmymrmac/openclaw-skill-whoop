---
name: whoop
description: "Access Whoop recovery, sleep, cycle, and workout data via OAuth API."
homepage: https://developer.whoop.com
user-invocable: true
metadata: 
  openclaw:
    requires:
      env: ["WHOOP_CLIENT_ID", "WHOOP_CLIENT_SECRET"]
    primaryEnv: "WHOOP_CLIENT_ID"
    emoji: "💪"
---

# Whoop

This skill provides OAuth-authenticated access to the Whoop API for retrieving recovery, sleep, cycle, and workout data.

- Script: `{baseDir}/scripts/whoop.mjs`
- Auth: OAuth 2.0 with PKCE (requires `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET`)
- Output: **JSON only** (stdout), suitable for agents and automation
- Config: Tokens stored in `~/.openclaw/whoop-config.json`

## Setup

### 1. Register OAuth Application

1. Visit [Whoop Developer Portal](https://developer.whoop.com)
2. Create a new OAuth application
3. Set redirect URI to: `http://localhost:3000/callback`
4. Note your Client ID and Client Secret

### 2. Configure OpenClaw

The safest way to provide credentials:

```bash
openclaw config set skills.entries.whoop.enabled true
openclaw config set skills.entries.whoop.env.WHOOP_CLIENT_ID "your_client_id"
openclaw config set skills.entries.whoop.env.WHOOP_CLIENT_SECRET "your_client_secret"
```

**Verify configuration:**

```bash
openclaw config get skills.entries.whoop
```

### 3. Authenticate

Run the OAuth flow once to obtain tokens:

```bash
node {baseDir}/scripts/whoop.mjs auth
```

This will:
- Open your browser to Whoop's authorization page
- Start a local server on port 3000 for the callback
- Exchange the authorization code for access + refresh tokens
- Store tokens in `~/.openclaw/whoop-config.json`

The skill automatically refreshes access tokens as needed.

## Commands

### Profile

Get basic user profile:

```bash
node {baseDir}/scripts/whoop.mjs me
```

### Recovery Data

Get recovery scores and metrics:

```bash
# Last 7 days
node {baseDir}/scripts/whoop.mjs recovery --days 7

# Specific date range
node {baseDir}/scripts/whoop.mjs recovery --start 2026-02-01 --end 2026-02-08
```

### Sleep Data

Get sleep performance and stages:

```bash
# Last 7 days
node {baseDir}/scripts/whoop.mjs sleep --days 7

# Specific date range
node {baseDir}/scripts/whoop.mjs sleep --start 2026-02-01T00:00:00Z --end 2026-02-08T23:59:59Z
```

### Cycle Data

Get physiological cycle data (strain, recovery, sleep need):

```bash
# Last 7 days
node {baseDir}/scripts/whoop.mjs cycles --days 7

# Specific date range
node {baseDir}/scripts/whoop.mjs cycles --start 2026-02-01 --end 2026-02-08
```

### Workout Data

Get workout activities:

```bash
# Last 7 days
node {baseDir}/scripts/whoop.mjs workouts --days 7

# Specific date range
node {baseDir}/scripts/whoop.mjs workouts --start 2026-02-01 --end 2026-02-08
```

### Latest Summary

Get the most recent recovery, sleep, and cycle data (perfect for morning digest):

```bash
node {baseDir}/scripts/whoop.mjs latest
```

Returns:
```json
{
  "recovery": { /* latest recovery record */ },
  "sleep": { /* latest sleep record */ },
  "cycle": { /* latest cycle record */ }
}
```

## Common Patterns

### Morning Digest Integration

For an AI agent to include Whoop data in a morning digest:

```bash
node {baseDir}/scripts/whoop.mjs latest
```

Parse the JSON output to extract:
- Recovery score percentage
- HRV (heart rate variability)
- RHR (resting heart rate)
- Sleep performance percentage
- Sleep duration and quality
- Yesterday's strain score

### Weekly Summary

```bash
node {baseDir}/scripts/whoop.mjs recovery --days 7
node {baseDir}/scripts/whoop.mjs sleep --days 7
node {baseDir}/scripts/whoop.mjs workouts --days 7
```

Calculate averages and trends from the returned arrays.

### Date Range Queries

All date/time parameters accept ISO 8601 format:
- Date only: `2026-02-08`
- Date + time: `2026-02-08T14:30:00Z`
- With timezone: `2026-02-08T09:30:00-05:00`

## API Details

- Base URL: `https://api.prod.whoop.com`
- Scopes: `read:recovery`, `read:cycles`, `read:workout`, `read:sleep`, `read:profile`
- Token refresh: Automatic (handled by the script)
- Rate limits: Whoop enforces rate limits per the API documentation

## Troubleshooting

**"Not authenticated" error:**
Run `node {baseDir}/scripts/whoop.mjs auth` to authenticate.

**"Token refresh failed" error:**
Your refresh token may have expired. Re-run authentication:
```bash
node {baseDir}/scripts/whoop.mjs auth
```

**OAuth callback timeout:**
Ensure port 3000 is not in use and your firewall allows local connections.

**Client ID/Secret not found:**
Verify they're set in OpenClaw config or environment variables.

## Security Notes

- Never commit `~/.openclaw/whoop-config.json` to version control
- Store OAuth credentials in OpenClaw config, not in code or prompts
- Refresh tokens are long-lived; protect them as you would passwords
- The skill only requests read-only scopes

## Data Privacy

This skill stores OAuth tokens locally in `~/.openclaw/whoop-config.json`. No data is sent to any third party except Whoop's API. The skill runs entirely on your local machine.
