# FIBA Americas Nominations System

Web application to generate nomination and confirmation letters for Video Graphic Operators (VGO) and Technical Delegates (TD) assigned to FIBA Americas competitions.

## Stack

- **Frontend:** React + Tailwind CSS (Vite)
- **Backend:** FastAPI (Python 3.11+) as Vercel Serverless Functions
- **Database:** Supabase (PostgreSQL)
- **Document generation:** python-docx
- **File storage:** Supabase Storage
- **Deploy:** Vercel

## Project Structure

```
fiba-nominations/
├── api/                    # Vercel serverless Python backend
│   ├── index.py            # FastAPI entry point (/api/*)
│   └── _lib/               # Backend modules (underscore = not exposed as endpoints)
│       ├── database.py
│       ├── models.py
│       ├── schemas.py
│       ├── routers/
│       └── services/
├── src/                    # React frontend
│   ├── api/client.js
│   ├── pages/
│   ├── App.jsx
│   └── main.jsx
├── templates/              # .docx letter templates
├── supabase/migrations/    # Database schema
├── vercel.json             # Vercel configuration
├── package.json            # Frontend dependencies
└── requirements.txt        # Python dependencies
```

## Deploy to Vercel

### 1. Database setup

1. Create a Supabase project at [supabase.com](https://supabase.com)
2. Run `supabase/migrations/001_initial_schema.sql` in the SQL Editor
3. (Optional) Create a `nominations` storage bucket for generated documents

### 2. Deploy

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

### 3. Environment Variables

Set these in your Vercel project settings (Settings → Environment Variables):

| Variable | Value |
|----------|-------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_KEY` | Your Supabase anon/service key |

## Local Development

```bash
# Frontend (terminal 1)
npm install
npm run dev
# → http://localhost:5173

# Backend (terminal 2)
pip install -r requirements.txt
python -m uvicorn api.index:app --reload --port 8000
```

The Vite dev server proxies `/api/*` requests to `localhost:8000` automatically.

Create a `.env` file in the project root:
```
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_anon_key
```

## Adding a New Competition Template

1. Place the `.docx` template in `templates/`
2. Add the template key to `competitions.template_key` CHECK constraint in the DB
3. Add file mapping in `api/_lib/services/document_generator.py` → `TEMPLATE_FILES`
4. Add field mapping in `api/_lib/models.py` → `TEMPLATE_FIELDS`
5. Update `src/pages/Nominations.jsx` for any template-specific form logic

## Bulk Import Format

Upload `.csv`, `.xlsx`, or `.xls` files with these columns:

| Column | Required | Valid Values |
|--------|----------|-------------|
| Nombre / Name | Yes | Free text |
| Email | Yes | Valid email |
| País / Country | No | Free text |
| Teléfono / Phone | No | Free text |
| Pasaporte / Passport | No | Free text |
| Rol / Role | Yes | VGO / TD |

## Notes

- **PDF conversion:** LibreOffice is not available on Vercel serverless. Documents are generated as `.docx` and stored in Supabase Storage. For PDF conversion, consider adding a post-processing step or using an external API.
- **File storage:** Generated documents are uploaded to the Supabase Storage `nominations` bucket. Create this bucket in your Supabase dashboard with public access.
- **Function timeout:** Vercel Pro plan allows up to 60s function execution. Hobby plan is 10s.
