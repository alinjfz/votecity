export type NeedCategory =
  | "Streets"
  | "Youth"
  | "Green Spaces"
  | "Community"
  | "Safety"
  | "Access";

export type NeedStatus =
  | "Under review"
  | "Planned"
  | "Funded"
  | "Not feasible";

export type ReviewState = "idle" | "pending" | "complete" | "failed";
export type FeasibilityRating = "High" | "Medium" | "Low" | "Not feasible";

export interface AiReview {
  state: ReviewState;
  rating?: FeasibilityRating;
  score?: number;
  summary?: string;
  nextStep?: string;
  reviewedAt?: string;
  error?: string;
}

export interface NeedItem {
  id: string;
  title: string;
  category: NeedCategory;
  area: string;
  coordinates: [number, number];
  reason: string;
  votes: number;
  status: NeedStatus;
  image: string;
  fundingGoal: number;
  fundingRaised: number;
  donorCount: number;
  createdAt: string;
  submittedBy?: string;
  aiReview?: AiReview;
}

export interface AppState {
  needs: NeedItem[];
  lastVoteWeekKey: string;
  voteLedger: Record<string, string[]>;
}
