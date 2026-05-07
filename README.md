# Quote Snap — Mallard Electric LLC

Upload a photo of an electrical job site. AI analyzes it and generates a line-item quote with labor + materials pricing.

## Tech
- Next.js 14 (pages router)
- OpenAI GPT-4o Vision
- Mobile-first UI (iPhone optimized, HEIC supported)

## Setup

```bash
cd quote-snap
npm install
```

Add environment variable:
```bash
# .env.local
OPENAI_API_KEY=sk-...
LABOR_RATE=95
TRIP_CHARGE=75
```

```bash
npm run dev
# → http://localhost:3000
```

## Deploy to Vercel

1. Push to GitHub (new repo)
2. Import to Vercel (team: pedro-garcia-jrs-projects)
3. Add `OPENAI_API_KEY` to Vercel environment variables
4. Deploy

## API
POST `/api/quote` — body: `{ imageData, serviceType, customerName, customerAddress, notes }`
Returns: `{ summary, lineItems[], totalHours, materialsTotal, total, warranties }`
