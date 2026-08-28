# Video Call App

A one-to-one video/audio calling foundation using Node.js, Socket.IO, and browser WebRTC.

## Current setup

- Node.js + Express server
- Socket.IO signaling
- WebRTC camera/microphone access
- One-to-one video calls
- Audio calls
- Accept/reject/end call flow
- Mute and camera controls
- Google STUN server for initial testing
- Responsive UI

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000` in two browser windows/tabs. Register one as `don` and another as `john`, then call between them.

Camera and microphone permission is requested by the browser when a call starts or is accepted.

## Production roadmap

1. Supabase authentication and profiles
2. Supabase Row Level Security
3. Persistent call history
4. Browser push notifications
5. TURN server configuration
6. Render deployment
7. Production security and rate limiting
