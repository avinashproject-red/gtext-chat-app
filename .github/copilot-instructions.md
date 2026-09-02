# GText

Real-time chat app: React + TypeScript frontend, Express + Socket.io backend, MongoDB, JWT auth.

- Frontend lives in `frontend/` (`npm start` on port 3000).
- Backend lives in `backend/` (`npm start` on port 5000).
- Keep message payloads encrypted on the client; the API stores ciphertext, IVs, and wrapped keys.
- Prefer modular changes: models, routes, sockets, then matching React pages/components.
