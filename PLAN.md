# VoteCity Hackathon Build Plan

## Summary

Build `VoteCity` as a UK nonprofit civic platform where residents surface local needs, vote on priorities, and optionally help fund the most-supported projects. The hackathon version should optimize for a strong emotional community story first, while still showing clear council usefulness through a light public-facing council mode.

The product story stays UK-wide, but the demo should use a generic London borough with seeded examples so the experience feels local, believable, and easy to follow.

## Key Changes

### Product shape
- Keep one shared public platform, not two separate products.
- Residents and councils mostly see the same underlying data.
- Add a light `Council View` toggle with ranked summaries, export-style cards, and status updates.

### Core V1 workflow
- `Submit need`: real working form with category, location, short reason, and optional photo.
- `Browse and vote`: seeded need cards plus live voting.
- `Leaderboard`: ranked by area and popularity.
- `Fund project`: simulated donation progress for items that cross a support threshold.
- `Council status`: visible status labels such as `Under review`, `Planned`, `Funded`, `Not feasible`.

### Scope and defaults
- Use `VoteCity` as the working name throughout.
- Keep the product narrative UK-wide.
- Use a `generic London borough` for seed data, screenshots, and demo copy.
- Use `mixed physical + community` categories, not infrastructure-only.
- Use `5 votes per week` per user, with only one vote allowed per item.
- Keep donations `simulated only`.
- Unlock funding only `after a vote threshold`.
- Keep the council role `visible but secondary` in the demo story.
- Use `real submit flow plus seeded data` so the demo has both credibility and polish.

### Public interfaces and behavior
- Need cards should expose: title, category, area, reason, vote count, status, and funding state.
- Voting should show remaining weekly votes.
- Funding UI should appear only when an item becomes project-eligible.
- Council mode should surface the same items with cleaner summary framing rather than a separate admin system.
- Duplicate handling can be lightweight or manual for hackathon purposes, but the UI should imply merged demand where useful.

## Test Plan

- Submit a new need and verify it appears in the public feed.
- Vote on seeded and newly submitted needs, confirming weekly vote limits and one-vote-per-item behavior.
- Confirm leaderboard ranking updates correctly after votes.
- Toggle council mode and verify ranked summaries and status labels remain readable and credible.
- Cross the funding threshold on a seeded item and verify donation UI becomes visible.
- Simulate a donation and verify the progress bar and supporter count update.
- Validate mobile-friendly flow for the core story: submit, vote, council view, funding.
- Dry-run the 2-minute demo to confirm the emotional community narrative still naturally leads into the council value.

## Assumptions

- Identity and anti-abuse controls stay lightweight for V1; they should support the story but not slow the build.
- Seeded data is the main demo backbone, even though submission is real.
- The borough is intentionally generic to avoid overcommitting to real civic facts.
- Donation compliance, real payment handling, deep moderation, and production-grade council workflows are out of scope for the hackathon build.
