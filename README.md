# GText

Real-time chatting website with React, Express, Socket.io, MongoDB, JWT auth, group chats, media sharing, an admin dashboard, and client-side message encryption.

## Stack

- Frontend: React + TypeScript
- Backend: Node.js, Express, Socket.io
- Database: MongoDB
- Auth: JWT + bcrypt

## Prerequisites

- Node.js 18+
- MongoDB running locally, Docker, or a MongoDB Atlas URI

Start a local database with Docker:

```bash
docker compose up -d
```

## Setup

1. Backend

```bash
cd backend
copy .env.example .env
npm install
npm start
```

Default API: `http://localhost:5000`

Seeded admin:

- Email: `admin@gtext.local`
- Password: `Admin123!`

Change `MONGO_URI`, `JWT_SECRET`, and admin credentials in `backend/.env` before any real use.

2. Frontend

```bash
cd frontend
npm install
npm start
```

App: `http://localhost:3000`

## Features

- Email/password registration and login
- Profiles with username and avatar
- One-to-one and group chats
- Sent / Delivered / Read receipts
- Image, video, and document sharing
- Browser push notifications for new messages
- Dark mode, high contrast, and larger text
- Admin dashboard for users, blocks, and reports
- Client-side AES-GCM message encryption with RSA-OAEP wrapped conversation keys

Encryption keys stay in the browser (`localStorage`). The server stores ciphertext, IVs, and wrapped keys only. This is a practical E2E model for a first version, not a full Signal-protocol implementation.

## API overview

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/users/search?q=`
- `GET /api/chat/conversations`
- `POST /api/chat/direct`
- `POST /api/chat/groups`
- `GET /api/admin/stats`

Socket events: `message:send`, `message:new`, `message:delivered`, `message:read`, `typing`, `notification:new`, `presence:update`.

## Deploy

- Frontend: `cd frontend && npm run build`, then host the `build/` folder on Vercel or similar.
- Backend: run `node server.js` on a Node host and point `CLIENT_ORIGIN` at the frontend URL.
- Set `REACT_APP_API_URL` to the public API origin before building the frontend.

## Troubleshooting

- `MongoDB connected` never appears: start MongoDB or update `MONGO_URI`.
- CORS errors: keep frontend on `http://localhost:3000` or change `CLIENT_ORIGIN`.
- Messages show `[Unable to decrypt]`: the private key lives on the device that created the account. Sign in on that same browser, or create a new chat after both users have logged in once.
