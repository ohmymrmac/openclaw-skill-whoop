# AGENTS.md - Whoop Skill for AI Agents

## What This Skill Does

Fetches fitness and recovery data from Whoop via their OAuth API. Perfect for morning digests, health check-ins, and fitness tracking automation.

## Key Data Points

### Recovery
- **Recovery Score** (0-100%): How ready you are for strain
- **HRV** (heart rate variability): Higher is generally better
- **RHR** (resting heart rate): Lower is generally better
- **Skin temp**: Deviation from baseline

### Sleep
- **Sleep Performance** (0-100%): Quality of sleep
- **Duration**: Time in bed vs. time asleep
- **Sleep Stages**: Light, deep, REM, wake percentages
- **Disturbances**: Wake events, respiratory rate

### Cycles
- **Strain Score** (0-21): Cardiovascular load for the day
- **Kilojoules**: Energy expenditure
- **Avg HR**: Average heart rate during activities

### Workouts
- **Activity type**: Run, bike, weights, etc.
- **Duration**: Time spent
- **Strain**: Contribution to daily strain
- **HR zones**: Time in different intensity zones

## Quick Commands

```bash
# Best for morning digest
node {baseDir}/scripts/whoop.mjs latest

# Last week's trends
node {baseDir}/scripts/whoop.mjs recovery --days 7
node {baseDir}/scripts/whoop.mjs sleep --days 7
```

## Interpreting Data (for agents)

### Recovery Score
- **Green (67-100%)**: Good to go, ready for training
- **Yellow (34-66%)**: Moderate, consider lighter activity
- **Red (0-33%)**: Rest day recommended

### Sleep Performance
- **>85%**: Excellent
- **70-85%**: Good
- **<70%**: Poor, may affect recovery

### Strain
- **0-9**: Light day
- **10-13**: Moderate
- **14-17**: Strenuous
- **18-21**: All out

## Morning Digest Example

```javascript
const data = await exec('node scripts/whoop.mjs latest');
const { recovery, sleep, cycle } = JSON.parse(data);

const message = `
🟢 Recovery: ${recovery.score.recovery_score}% (HRV: ${recovery.score.hrv_rmssd_milli}ms)
😴 Sleep: ${sleep.score.sleep_performance_percentage}% (${formatDuration(sleep.score.total_sleep_time_milli)})
💪 Yesterday's Strain: ${cycle.score.strain}
`;
```

## Context for Conversations

When the user mentions Whoop, recovery, sleep quality, or asks "how am I doing?", this skill provides objective health metrics to inform your response.

### Good Responses:
- "Your recovery is 78% today - green light for that workout!"
- "Sleep was only 65% last night. Maybe take it easier today?"
- "Your HRV is up 15% from last week - whatever you're doing is working!"

### Avoid:
- Making medical diagnoses
- Overriding user's self-assessment ("but Whoop says...")
- Pressuring based on metrics alone

## Date/Time Handling

- Whoop uses ISO 8601 timestamps
- Sleep data spans midnight (sleep from 11pm-7am shows up under the morning date)
- Cycles are typically 24h periods ending at the user's "wakeup" time
- Use `--days N` for relative ranges, or `--start`/`--end` for absolute

## Token Management

The script handles OAuth automatically:
- Initial auth: `node scripts/whoop.mjs auth`
- Auto-refresh: Happens transparently when tokens expire
- Config: `~/.openclaw/whoop-config.json` (don't read/share this)

## Rate Limits

Whoop has rate limits. For agent use:
- Cache results for at least 15 minutes
- Batch requests when possible (use `latest` instead of separate calls)
- Don't poll constantly - most data updates once per day

## Privacy

Whoop data is personal health information. Handle with care:
- Don't share raw data in group chats
- Summarize insights instead of dumping JSON
- Ask before discussing details with others
- Treat it like you would any health data

## Troubleshooting

**"Not authenticated"** → Run `auth` command first
**"Token refresh failed"** → Re-run `auth` to get fresh tokens
**Empty results** → User might not have data for that period
**API errors** → Check Whoop's status page or rate limits

## Integration Ideas

- **Morning digest**: Include recovery, sleep, strain from yesterday
- **Workout planning**: Check recovery before suggesting intensity
- **Trend analysis**: Weekly/monthly averages and patterns
- **Correlations**: Compare recovery to calendar events, workouts, sleep
- **Reminders**: "You only got 60% sleep - maybe skip that 5am run?"

## Example Flows

### Morning Check-in
1. Run `latest` command
2. Parse recovery, sleep, strain
3. Summarize in natural language
4. Provide context-aware suggestions

### Weekly Review
1. Fetch last 7 days of each metric
2. Calculate averages
3. Identify trends (improving/declining)
4. Highlight best and worst days

### Pre-Workout
1. Check current recovery score
2. Compare to recent baseline
3. Suggest workout intensity
4. Warn if red/yellow recovery

Remember: Metrics inform, they don't dictate. The user knows their body best.
