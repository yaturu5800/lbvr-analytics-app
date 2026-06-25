# LBVR Analytics

VR headset fleet analytics dashboard for LBVR experiences. Built with React + Vite + TypeScript, reading live data from Supabase.

## Pages

| Route | Description |
|---|---|
| `/` | Fleet Overview — session counts, completion rate, charts |
| `/funnel` | Funnel Analysis — stage-by-stage drop-off |
| `/completion` | Completion Rates — outcomes by day/device |
| `/devices` | Device List — all headsets with aggregate stats |
| `/devices/:id` | Device Detail — full history, health trends, problem signals |
| `/problems` | Problem Detection — auto-detected issues fleet-wide |
| `/spatial` | Spatial View — scatter plot of starting positions |

## Setup

```bash
npm install
cp .env.example .env.local
# fill in VITE_SUPABASE_ANON_KEY from the Supabase dashboard
npm run dev
```

## Deploy to Vercel

```bash
vercel deploy
```

Set environment variables in Vercel dashboard:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Stack

- React 19 + Vite 8
- TypeScript
- Tailwind CSS v4
- `@supabase/supabase-js`
- `recharts`
- `react-router-dom` v7
- `date-fns`
