Realtime Quiz Game
------------------
This project includes:
- frontend: React + Vite (Bootstrap)
- backend: single-file Flask app with Flask-SocketIO and MongoDB persistence

Setup (backend):
1. Create a Python venv, install requirements (pip install -r backend/requirements.txt)
2. Set MONGO_URI env var if needed.
3. Run backend: python backend/app.py

Setup (frontend):
1. cd frontend
2. npm install
3. npm run dev

Notes:
- Uploads stored in backend/uploads
- Adjust VITE_BACKEND_URL env var in frontend to point to backend if not localhost.
# Game
