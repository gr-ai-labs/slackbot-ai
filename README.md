# Slackbot AI - Message Reword Bot

A Slack bot that transforms blunt or direct messages into friendly, diplomatic communication using Claude AI.

## Usage

In Slack, use the `/reword` slash command:

```
/reword I need this done NOW
```

Returns a diplomatically reworded version of your message.

## Architecture

```
Slack /reword command
        ↓
Railway (Hono server) ─── always running, no cold starts
        ↓
Vercel AI Gateway
        ↓
Claude 3 Haiku
        ↓
Reworded message back to Slack
```

## Deployment

### Railway (Production - Recommended)

The app runs on Railway as a Node.js server with no cold starts.

**URL:** `https://slackbot-ai-production.up.railway.app/api/slack/reword`

**Environment Variables:**
- `SLACK_SIGNING_SECRET` - From Slack App settings
- `AI_GATEWAY_API_KEY` - Vercel AI Gateway API key

**Deploy:**
```bash
railway login
railway init
railway up
railway variables set SLACK_SIGNING_SECRET="xxx"
railway variables set AI_GATEWAY_API_KEY="xxx"
railway domain
```

### Vercel (Alternative - Serverless)

Also deployable as Vercel Edge Functions, but may experience cold starts.

**URL:** `https://slackbot-ai-ten.vercel.app/api/slack/reword`

```bash
vercel --prod
```

## Development

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Build
npm run build

# Run tests
npm test
```

## Project Structure

```
├── src/
│   └── server.ts          # Hono server for Railway
├── api/
│   └── slack/
│       └── reword.ts      # Vercel serverless function
├── lib/
│   ├── slack.ts           # Slack verification & helpers
│   └── prompts.ts         # Claude system prompts
├── tests/
│   ├── unit/              # Unit tests
│   ├── integration/       # Integration tests
│   └── e2e/               # End-to-end tests
├── railway.json           # Railway configuration
└── vercel.json            # Vercel configuration
```

## Slack App Setup

1. Create a Slack App at https://api.slack.com/apps
2. Add a Slash Command `/reword`
3. Set the Request URL to your deployment URL + `/api/slack/reword`
4. Copy the Signing Secret to your environment variables
5. Install the app to your workspace
