# OpenClaw Whoop Skill 💪

OpenClaw skill for accessing Whoop fitness and recovery data via OAuth API.

## Features

- ✅ OAuth 2.0 authentication with PKCE
- ✅ Automatic token refresh with refresh-token rotation safety
- ✅ Request timeout protection (prevents hanging calls)
- ✅ Recovery scores and metrics
- ✅ Sleep performance data
- ✅ Physiological cycle tracking
- ✅ Workout history
- ✅ Zero external dependencies (pure Node.js)
- ✅ JSON output for agent integration

## Quick Start

### 1. Install

```bash
# Clone to OpenClaw skills directory
cd ~/.openclaw/workspace/skills
git clone https://github.com/ohmymrmac/openclaw-skill-whoop.git whoop
```

### 2. Get Whoop OAuth Credentials

1. Visit [Whoop Developer Portal](https://developer.whoop.com)
2. Create a new OAuth application
3. Set redirect URI: `http://localhost:3000/callback`
4. Save your Client ID and Client Secret

### 3. Configure

```bash
openclaw config set skills.entries.whoop.enabled true
openclaw config set skills.entries.whoop.env.WHOOP_CLIENT_ID "your_client_id"
openclaw config set skills.entries.whoop.env.WHOOP_CLIENT_SECRET "your_client_secret"
```

### 4. Authenticate

```bash
cd ~/.openclaw/workspace/skills/whoop
node scripts/whoop.mjs auth
```

Follow the browser prompts to authorize the application.

### 5. Test

```bash
node scripts/whoop.mjs me
node scripts/whoop.mjs latest
node scripts/whoop.mjs status
```

Proactively rotate tokens (useful before scheduled jobs):

```bash
node scripts/whoop.mjs refresh
```

## Usage

### Auth Utilities

```bash
# See token status/expiry
node scripts/whoop.mjs status

# Proactively refresh tokens
node scripts/whoop.mjs refresh
```

### Get Latest Data (Perfect for Morning Digest)

```bash
node scripts/whoop.mjs latest
```

Returns your most recent recovery, sleep, and cycle data in one call.

### Get Recovery Data

```bash
# Last 7 days
node scripts/whoop.mjs recovery --days 7

# Specific date range
node scripts/whoop.mjs recovery --start 2026-02-01 --end 2026-02-08
```

### Get Sleep Data

```bash
node scripts/whoop.mjs sleep --days 7
```

### Get Cycle Data

```bash
node scripts/whoop.mjs cycles --days 7
```

### Get Workouts

```bash
node scripts/whoop.mjs workouts --days 7
```

## AI Agent Integration

This skill outputs pure JSON to stdout, making it perfect for AI agent workflows:

```javascript
// Example: Morning digest with Whoop data
const whoop = await exec('node ~/.openclaw/workspace/skills/whoop/scripts/whoop.mjs latest');
const data = JSON.parse(whoop);

console.log(`Recovery: ${data.recovery.score.recovery_score}%`);
console.log(`HRV: ${data.recovery.score.hrv_rmssd_milli}ms`);
console.log(`Sleep: ${data.sleep.score.sleep_performance_percentage}%`);
console.log(`Strain: ${data.cycle.score.strain}`);
```

## API Coverage

| Endpoint | Command | Status |
|----------|---------|--------|
| `/v2/user/profile/basic` | `me` | ✅ |
| `/v2/recovery` | `recovery` | ✅ |
| `/v2/activity/sleep` | `sleep` | ✅ |
| `/v2/cycle` | `cycles` | ✅ |
| `/v2/activity/workout` | `workouts` | ✅ |

## Architecture

- **Pure Node.js**: No external dependencies
- **ES Modules**: Modern JavaScript imports
- **OAuth 2.0 + PKCE**: Secure authentication
- **Token Management**: Automatic refresh
- **Local Storage**: `~/.openclaw/whoop-config.json`

## Requirements

- Node.js 18+ (uses native fetch)
- OpenClaw (optional, but recommended)
- Whoop account with API access

## Development

```bash
# Clone
git clone https://github.com/ohmymrmac/openclaw-skill-whoop.git
cd openclaw-skill-whoop

# Make script executable
chmod +x scripts/whoop.mjs

# Test
node scripts/whoop.mjs --help
```

## Security

- OAuth tokens stored locally in `~/.openclaw/whoop-config.json`
- Never committed to version control (.gitignore included)
- Read-only API scopes
- No data sent to third parties (except Whoop API)

## Contributing

Issues and pull requests welcome! This is a community skill for OpenClaw.

## License

MIT

## Links

- [Whoop Developer Portal](https://developer.whoop.com)
- [OpenClaw](https://openclaw.com)
- [API Documentation](https://developer.whoop.com/api)

## Author

[@ohmymrmac](https://github.com/ohmymrmac)
