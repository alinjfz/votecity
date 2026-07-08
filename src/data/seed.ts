import { AppState, NeedItem } from "../types";

export const WEEKLY_VOTE_LIMIT = 5;
export const FUNDING_THRESHOLD = 25;

export const boroughName = "Northbridge Borough";

export const boroughAreas = [
  "Riverside",
  "Market Ward",
  "Old Town",
  "Canal Side",
  "Station Quarter"
];

export const areaCoordinates: Record<string, [number, number]> = {
  Riverside: [51.5072, -0.1085],
  "Market Ward": [51.5114, -0.0946],
  "Old Town": [51.5148, -0.1048],
  "Canal Side": [51.5209, -0.0895],
  "Station Quarter": [51.5093, -0.0824]
};

export const categories = [
  "Streets",
  "Youth",
  "Green Spaces",
  "Community",
  "Safety",
  "Access"
] as const;

export const statusOptions = [
  "Under review",
  "Planned",
  "Funded",
  "Not feasible"
] as const;

export const seedNeeds: NeedItem[] = [
  {
    id: "need-1",
    title: "Late-evening youth studio in Market Ward",
    category: "Youth",
    area: "Market Ward",
    coordinates: [51.5117, -0.0958],
    reason:
      "Teenagers keep asking for a safe, staffed place to make music and stay off the street after school.",
    votes: 31,
    status: "Planned",
    image:
      "https://images.squarespace-cdn.com/content/v1/5f9c31c9c157d623c5d535fc/1688135024585-3U4QC1HRKXJ8AMICRK8L/IMG_6147.jpg",
    fundingGoal: 8000,
    fundingRaised: 3650,
    donorCount: 42,
    createdAt: "2026-07-01T10:00:00.000Z"
  },
  {
    id: "need-2",
    title: "Safer crossings near the primary school",
    category: "Safety",
    area: "Old Town",
    coordinates: [51.5142, -0.1061],
    reason:
      "Parents and carers say the school-run traffic makes crossing stressful, especially for younger children.",
    votes: 28,
    status: "Under review",
    image:
      "https://www.ncl.ac.uk/media/wwwnclacuk/pressoffice/images/news/september/Air-standard-full-width.jpg",
    fundingGoal: 12000,
    fundingRaised: 1200,
    donorCount: 16,
    createdAt: "2026-07-02T08:30:00.000Z"
  },
  {
    id: "need-3",
    title: "Community garden beds beside the canal",
    category: "Green Spaces",
    area: "Canal Side",
    coordinates: [51.5218, -0.0906],
    reason:
      "Residents want a shared growing space that brings neighbours together and makes the towpath feel cared for.",
    votes: 19,
    status: "Under review",
    image:
      "https://images.unsplash.com/photo-1466692476868-aef1dfb1e735?auto=format&fit=crop&w=900&q=80",
    fundingGoal: 5000,
    fundingRaised: 0,
    donorCount: 0,
    createdAt: "2026-07-03T14:10:00.000Z"
  },
  {
    id: "need-4",
    title: "Weekend repair cafe and tool library",
    category: "Community",
    area: "Riverside",
    coordinates: [51.5063, -0.1097],
    reason:
      "People want practical help fixing household items locally rather than throwing things away.",
    votes: 24,
    status: "Planned",
    image:
      "https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=900&q=80",
    fundingGoal: 3500,
    fundingRaised: 0,
    donorCount: 0,
    createdAt: "2026-07-03T17:40:00.000Z"
  },
  {
    id: "need-5",
    title: "Step-free entrance for the high street hall",
    category: "Access",
    area: "Station Quarter",
    coordinates: [51.5084, -0.0831],
    reason:
      "Local groups say events are still too hard to access for wheelchair users and people with pushchairs.",
    votes: 27,
    status: "Funded",
    image:
      "https://www.bramleyhampshire.org.uk/wp-content/uploads/2021/10/Screen-Shot-2021-10-18-at-11.56.07-300x203.png",
    fundingGoal: 9000,
    fundingRaised: 9000,
    donorCount: 63,
    createdAt: "2026-07-04T09:15:00.000Z"
  },
  {
    id: "need-6",
    title: "Shaded benches on the riverside route",
    category: "Streets",
    area: "Riverside",
    coordinates: [51.5079, -0.1114],
    reason:
      "Older residents asked for more places to rest during longer walks to the GP and market.",
    votes: 11,
    status: "Not feasible",
    image:
      "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=900&q=80",
    fundingGoal: 4000,
    fundingRaised: 0,
    donorCount: 0,
    createdAt: "2026-07-04T11:00:00.000Z"
  }
];

export function getWeekKey(date = new Date()): string {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);

  return `${utcDate.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

export function createInitialState(): AppState {
  return {
    needs: seedNeeds,
    lastVoteWeekKey: getWeekKey(),
    voteLedger: {}
  };
}
