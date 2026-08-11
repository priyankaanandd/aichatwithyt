# Deployment

Recommended deployment:

- Backend: Render Web Service
- Frontend: Vercel Vite app
- Database: Neon Postgres with the `vector` extension enabled

## 1. Database

Create a Neon Postgres database and run this SQL once:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Use the Neon connection string as `DB_URL`.

## 2. Backend On Render

Create a Render Web Service from this repo.

Use:

```txt
Root Directory: server
Build Command: npm install
Start Command: npm start
```

Environment variables:

```env
GOOGLE_API_KEY=your_google_api_key
GEMINI_MODEL=gemini-flash-latest
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
DB_URL=your_neon_postgres_connection_string
BRIGHTDATA_API_KEY=your_bright_data_api_key
BRIGHTDATA_DATASET_ID=gd_lk56epmy2i5g7lzu0k
API_URL=https://your-render-service.onrender.com
CLIENT_URL=https://your-vercel-app.vercel.app
```

After Render gives you the public URL, update `API_URL` to that exact backend URL.

## 3. Frontend On Vercel

Create a Vercel project from this repo.

Use:

```txt
Root Directory: client
Build Command: npm run build
Output Directory: dist
```

Environment variable:

```env
VITE_API_URL=https://your-render-service.onrender.com
```

After Vercel gives you the public URL, update Render's `CLIENT_URL` to that frontend URL.

## 4. Local Commands

Backend:

```bash
cd server
npm install
npm run dev
```

Frontend:

```bash
cd client
npm install
npm run dev
```
