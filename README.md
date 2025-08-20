# Polluted Cities

## Run
```bash
npm install
npm start
# http://localhost:3000/health
# http://localhost:3000/cities
# http://localhost:3000/cities?countries=PL,DE
```

## What it does
- POST `/auth/login` → bearer token (cached in memory for a short TTL)
- GET `/pollution?country=XX&page=N&limit=K` for each requested country (sequential = friendly to rate limits)
- Filters out obvious non-cities; de‑dupes
- Wikipedia blurb per city (cached); drops entries whose summary screams *district/facility*
- Returns a list sorted by AQI
