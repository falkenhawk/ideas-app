# Drawing WebSocket Server

Simple WebSocket relay server for the collaborative drawing app.

## Deploy to Railway (FREE)

1. Go to https://railway.app
2. Sign up with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select this repository
5. Railway will auto-detect the server and deploy it
6. Copy the deployment URL (something like: `your-app.railway.app`)
7. Update `draw.html` with your WebSocket URL

## Local Testing

```bash
cd server
npm install
npm start
```

Server runs on http://localhost:8080

## Environment Variables

- `PORT`: Port to run on (Railway sets this automatically)

## How It Works

- Clients connect and join rooms by name
- Server relays drawing strokes between clients in the same room
- No drawing data is stored - pure relay
