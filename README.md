# VoteCity

VoteCity is a frontend-first civic engagement demo built for a Bolt-friendly workflow. It lets residents submit local needs, vote on priorities, view a live leaderboard, switch into a light council mode, and simulate donations once a project reaches the support threshold.

## Stack

- React
- TypeScript
- Vite
- Local storage for demo persistence

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Bolt compatibility

The app intentionally uses a conventional Vite + React structure with no custom backend so it can be imported into Bolt and extended there with auth, a real database, AI features, or deployment integrations.
