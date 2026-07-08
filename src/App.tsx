import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import L from "leaflet";
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Dialog,
  TextArea,
  TextField
} from "@radix-ui/themes";
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  areaCoordinates,
  boroughAreas,
  boroughName,
  categories,
  createInitialState,
  FUNDING_THRESHOLD,
  getWeekKey,
  seedNeeds,
  statusOptions,
  WEEKLY_VOTE_LIMIT
} from "./data/seed";
import { useCountUp } from "./hooks/useCountUp";
import { isOpenRouterConfigured, reviewNeedWithOpenRouter } from "./lib/openrouter";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import { AiReview, AppState, NeedCategory, NeedItem, NeedStatus } from "./types";
import voteCityMark from "./assets/votecity-mark.png";

const STORAGE_KEY = "votecity-state";
const DEMO_AUTH_KEY = "votecity-demo-user";
const REVIEW_MINUTES_SAVED_PER_NEED = 18;
const AVERAGE_OFFICER_HOURLY_COST = 32;
const AVOIDED_LOW_DEMAND_SPEND_PER_PRIORITY = 2400;
const BOROUGH_CENTER: [number, number] = [51.512, -0.097];

type AuthMode = "signin" | "signup";

interface AppIdentity {
  id: string;
  email: string;
  displayName: string;
  source: "supabase" | "demo";
}

const currency = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0
});

function loadState(): AppState {
  if (typeof window === "undefined") {
    return createInitialState();
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return createInitialState();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AppState>;
    const currentWeek = getWeekKey();
    const normalized = normalizeState(parsed);

    if (normalized.lastVoteWeekKey !== currentWeek) {
      return {
        ...normalized,
        lastVoteWeekKey: currentWeek,
        voteLedger: {}
      };
    }

    return normalized;
  } catch {
    return createInitialState();
  }
}

function loadDemoIdentity(): AppIdentity | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(DEMO_AUTH_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as AppIdentity;
  } catch {
    return null;
  }
}

function App() {
  const [state, setState] = useState<AppState>(loadState);
  const [selectedNeedId, setSelectedNeedId] = useState(state.needs[0]?.id ?? "");
  const [activeArea, setActiveArea] = useState("All areas");
  const [activeCategory, setActiveCategory] = useState("All categories");
  const [partnerView, setPartnerView] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [authError, setAuthError] = useState("");
  const [authPending, setAuthPending] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");
  const [identity, setIdentity] = useState<AppIdentity | null>(null);
  const [authVersion, setAuthVersion] = useState(0);
  const [draftArea, setDraftArea] = useState(boroughAreas[0]);
  const [draftCoordinates, setDraftCoordinates] = useState<[number, number]>(
    areaCoordinates[boroughAreas[0]]
  );
  const retriedReviewIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIdentity(loadDemoIdentity());
      return;
    }

    let active = true;

    supabase?.auth.getSession().then(({ data }) => {
      if (!active) return;
      setIdentity(sessionToIdentity(data.session));
    });

    const subscription = supabase?.auth.onAuthStateChange((_event, session) => {
      setIdentity(sessionToIdentity(session));
    });

    return () => {
      active = false;
      subscription?.data.subscription.unsubscribe();
    };
  }, []);

  const userVoteIds = useMemo(() => {
    if (!identity) return [];
    return state.voteLedger[identity.id] ?? [];
  }, [identity, state.voteLedger]);

  const votesRemaining = identity
    ? Math.max(0, WEEKLY_VOTE_LIMIT - userVoteIds.length)
    : WEEKLY_VOTE_LIMIT;

  const filteredNeeds = useMemo(() => {
    return [...state.needs]
      .filter((need) => activeArea === "All areas" || need.area === activeArea)
      .filter(
        (need) => activeCategory === "All categories" || need.category === activeCategory
      )
      .sort((a, b) => b.votes - a.votes);
  }, [activeArea, activeCategory, state.needs]);

  const enrichedNeeds = useMemo(() => {
    return filteredNeeds.map((need) => {
      const priorityScore = calculatePriorityScore(need);
      const duplicateSignal = estimateDuplicateSignal(need, state.needs);

      return {
        ...need,
        duplicateSignal,
        priorityScore,
        urgencyLabel: describeUrgency(priorityScore),
        aiReason: buildAiReason(need, priorityScore, duplicateSignal)
      };
    });
  }, [filteredNeeds, state.needs]);

  useEffect(() => {
    if (!enrichedNeeds.some((need) => need.id === selectedNeedId)) {
      setSelectedNeedId(enrichedNeeds[0]?.id ?? "");
    }
  }, [enrichedNeeds, selectedNeedId]);

  const selectedNeed = enrichedNeeds.find((need) => need.id === selectedNeedId) ?? enrichedNeeds[0];

  const aiPriorities = useMemo(() => {
    return [...state.needs]
      .map((need) => {
        const priorityScore = calculatePriorityScore(need);
        const duplicateSignal = estimateDuplicateSignal(need, state.needs);

        return {
          ...need,
          duplicateSignal,
          priorityScore,
          urgencyLabel: describeUrgency(priorityScore),
          aiReason: buildAiReason(need, priorityScore, duplicateSignal)
        };
      })
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, 3);
  }, [state.needs]);

  const councilStats = useMemo(() => {
    const eligible = state.needs.filter((need) => need.votes >= FUNDING_THRESHOLD).length;
    const byStatus = statusOptions.map((status) => ({
      status,
      count: state.needs.filter((need) => need.status === status).length
    }));

    return {
      totalNeeds: state.needs.length,
      eligible,
      underReview: state.needs.filter((need) => need.status === "Under review").length,
      byStatus
    };
  }, [state.needs]);

  const roiStats = useMemo(() => {
    const underReviewNeeds = state.needs.filter((need) => need.status === "Under review");
    const highDemandNeeds = state.needs.filter((need) => need.votes >= FUNDING_THRESHOLD);
    const duplicatedThemes = new Set(
      aiPriorities.map((need) => `${need.category}-${need.area}`)
    ).size;
    const monthlyHoursSaved =
      (underReviewNeeds.length * REVIEW_MINUTES_SAVED_PER_NEED + duplicatedThemes * 12) / 60;
    const monthlyStaffValue = monthlyHoursSaved * AVERAGE_OFFICER_HOURLY_COST;
    const avoidedSpend = highDemandNeeds.length * AVOIDED_LOW_DEMAND_SPEND_PER_PRIORITY;

    return {
      monthlyHoursSaved,
      monthlyStaffValue,
      avoidedSpend,
      reportTimeReduction: Math.round(monthlyHoursSaved * 3.2)
    };
  }, [aiPriorities, state.needs]);

  const animatedNeedCount = useCountUp(state.needs.length);
  const animatedVoteCount = useCountUp(state.needs.reduce((sum, need) => sum + need.votes, 0));
  const animatedValue = useCountUp(roiStats.monthlyStaffValue);

  useEffect(() => {
    if (!isOpenRouterConfigured) {
      return;
    }

    state.needs.forEach((need) => {
      const shouldRetry =
        need.aiReview?.state === "pending" ||
        (need.aiReview?.state === "failed" &&
          (need.aiReview.error === "OpenRouter is not configured yet." ||
            need.aiReview.summary === "AI review is waiting for an OpenRouter API key."));

      if (shouldRetry && !retriedReviewIds.current.has(need.id)) {
        retriedReviewIds.current.add(need.id);
        void triggerAiReview(need);
      }
    });
  }, [state.needs]);

  async function triggerAiReview(need: NeedItem) {
    setState((current) => ({
      ...current,
      needs: current.needs.map((item) =>
        item.id === need.id
          ? {
              ...item,
              aiReview: {
                ...(item.aiReview ?? { state: "idle" }),
                state: "pending",
                error: undefined
              }
            }
          : item
      )
    }));

    if (!isOpenRouterConfigured) {
      setState((current) => ({
        ...current,
        needs: current.needs.map((item) =>
          item.id === need.id
            ? {
                ...item,
                aiReview: {
                  state: "failed",
                  error: "OpenRouter is not configured yet.",
                  summary: "AI review is waiting for an OpenRouter API key.",
                  nextStep: "Add VITE_OPENROUTER_API_KEY to enable automatic review."
                }
              }
            : item
        )
      }));
      return;
    }

    try {
      const result = await reviewNeedWithOpenRouter({
        title: need.title,
        category: need.category,
        area: need.area,
        reason: need.reason
      });

      setState((current) => ({
        ...current,
        needs: current.needs.map((item) =>
          item.id === need.id
            ? {
                ...item,
                aiReview: {
                  state: "complete",
                  rating: result.rating,
                  score: result.score,
                  summary: result.summary,
                  nextStep: result.nextStep,
                  reviewedAt: new Date().toISOString()
                }
              }
            : item
        )
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI review failed.";
      const hasCreditError =
        message.includes("402") || message.toLowerCase().includes("insufficient credits");
      const summary = hasCreditError
        ? "OpenRouter rejected the review request before it could complete."
        : "The idea is saved, but the AI review did not complete.";
      const nextStep = hasCreditError
        ? "Use a free model such as tencent/hy3:free, then restart Vite and retry."
        : "Retry once OpenRouter is available.";

      setState((current) => ({
        ...current,
        needs: current.needs.map((item) =>
          item.id === need.id
            ? {
                ...item,
                aiReview: {
                  ...(item.aiReview ?? { state: "idle" }),
                  state: "failed",
                  error: message,
                  summary,
                  nextStep
                }
              }
            : item
        )
      }));
    }
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthPending(true);
    setAuthError("");

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "").trim();
    const name = String(formData.get("name") || "").trim();

    try {
      if (isSupabaseConfigured && supabase) {
        if (authMode === "signup") {
          const { error } = await supabase.auth.signUp({
            email,
            password,
            options: {
              data: {
                display_name: name || email.split("@")[0]
              }
            }
          });

          if (error) throw error;
        } else {
          const { error } = await supabase.auth.signInWithPassword({
            email,
            password
          });

          if (error) throw error;
        }

        setAuthOpen(false);
        event.currentTarget.reset();
        return;
      }

      const demoIdentity: AppIdentity = {
        id: `demo-${email.toLowerCase()}`,
        email,
        displayName: name || email.split("@")[0],
        source: "demo"
      };

      window.localStorage.setItem(DEMO_AUTH_KEY, JSON.stringify(demoIdentity));
      setIdentity(demoIdentity);
      setAuthVersion((value) => value + 1);
      setAuthOpen(false);
      event.currentTarget.reset();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setAuthPending(false);
    }
  }

  async function handleSignOut() {
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
      return;
    }

    window.localStorage.removeItem(DEMO_AUTH_KEY);
    setIdentity(null);
    setAuthVersion((value) => value + 1);
  }

  function requireAuth(mode: AuthMode = "signin") {
    setAuthMode(mode);
    setAuthOpen(true);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!identity) {
      requireAuth("signup");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const title = String(formData.get("title") || "").trim();
    const category = String(formData.get("category") || "") as NeedCategory;
    const area = draftArea;
    const reason = String(formData.get("reason") || "").trim();
    const photo = String(formData.get("photo") || "").trim();

    if (!title || !category || !area || !reason) {
      setSubmitMessage("Please complete the title, category, area, and reason.");
      return;
    }

    const baseCoordinates = areaCoordinates[area] ?? BOROUGH_CENTER;
    const offset = ((state.needs.length % 5) - 2) * 0.0014;
    const newNeed: NeedItem = {
      id: `need-${crypto.randomUUID()}`,
      title,
      category,
      area,
      coordinates: [draftCoordinates[0], draftCoordinates[1]],
      reason,
      votes: 0,
      status: "Under review",
      image: photo || randomFallbackImage(category),
      fundingGoal: 5000,
      fundingRaised: 0,
      donorCount: 0,
      createdAt: new Date().toISOString(),
      submittedBy: identity.email,
      aiReview: {
        state: "pending"
      }
    };

    setState((current) => ({
      ...current,
      needs: [newNeed, ...current.needs]
    }));
    setSelectedNeedId(newNeed.id);
    setDraftArea(boroughAreas[0]);
    setDraftCoordinates(areaCoordinates[boroughAreas[0]]);
    event.currentTarget.reset();
    setSubmitMessage("Your need is now live under review. AI feasibility scoring is running.");
    void triggerAiReview(newNeed);
  }

  function handleVote(needId: string) {
    if (!identity) {
      requireAuth("signup");
      return;
    }

    setState((current) => {
      const existingVotes = current.voteLedger[identity.id] ?? [];

      if (existingVotes.includes(needId) || existingVotes.length >= WEEKLY_VOTE_LIMIT) {
        return current;
      }

      return {
        ...current,
        voteLedger: {
          ...current.voteLedger,
          [identity.id]: [...existingVotes, needId]
        },
        needs: current.needs.map((need) =>
          need.id === needId ? { ...need, votes: need.votes + 1 } : need
        )
      };
    });
  }

  function handleDonate(needId: string, amount: number) {
    setState((current) => ({
      ...current,
      needs: current.needs.map((need) =>
        need.id === needId
          ? {
              ...need,
              fundingRaised: Math.min(need.fundingGoal, need.fundingRaised + amount),
              donorCount: need.donorCount + 1,
              status:
                Math.min(need.fundingGoal, need.fundingRaised + amount) >= need.fundingGoal
                  ? "Funded"
                  : need.status
            }
          : need
      )
    }));
  }

  function updateStatus(needId: string, status: NeedStatus) {
    setState((current) => ({
      ...current,
      needs: current.needs.map((need) => (need.id === needId ? { ...need, status } : need))
    }));
  }

  return (
    <div className="site-shell">
      <Dialog.Root open={authOpen} onOpenChange={setAuthOpen}>
        <header className="site-header">
          <a className="brand" href="#top">
            <img alt="VoteCity logo" className="brand-logo" src={voteCityMark} />
            <div>
              <strong>VoteCity</strong>
              <span>Community needs, mapped clearly.</span>
            </div>
          </a>

          <nav className="main-nav">
            <a href="#how-it-works">How it works</a>
            <a href="#explore">Explore</a>
            <a href="#for-councils">For councils</a>
          </nav>

          <div className="header-actions">
            {identity ? (
              <>
                <div className="identity-chip">
                  <Avatar fallback={initials(identity.displayName)} radius="full" size="2" />
                  <div>
                    <strong>{identity.displayName}</strong>
                    <span>{identity.source === "supabase" ? "Account" : "Demo account"}</span>
                  </div>
                </div>
                <Button variant="soft" onClick={handleSignOut}>
                  Sign out
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => requireAuth("signin")}>
                  Sign in
                </Button>
                <Button onClick={() => requireAuth("signup")}>Create account</Button>
              </>
            )}
          </div>
        </header>

        <main id="top">
          <section className="hero-section">
            <div className="hero-copy">
              <span className="eyebrow">Neighbourhood priorities, made visible</span>
              <h1>A better way for residents to raise needs and vote on what their area needs next.</h1>
              <p>
                VoteCity helps local communities put real needs on the map, back them with visible
                support, and give councils a clearer signal about what deserves action first.
              </p>
              <div className="hero-actions">
                <Button size="3" onClick={() => document.getElementById("explore")?.scrollIntoView({ behavior: "smooth" })}>
                  Explore the live map
                </Button>
                <Button size="3" variant="soft" onClick={() => (identity ? document.getElementById("submit-need")?.scrollIntoView({ behavior: "smooth" }) : requireAuth("signup"))}>
                  Add a local need
                </Button>
              </div>
              {!isSupabaseConfigured ? (
                <Callout.Root color="amber" className="auth-callout">
                  <Callout.Text>
                    Supabase keys are not configured yet, so auth is running in local demo mode.
                    Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for production auth.
                  </Callout.Text>
                </Callout.Root>
              ) : null}
            </div>

            <div className="hero-media">
              <img alt="Community workshop" src={seedNeeds[0].image} />
              <img alt="Safer streets" src={seedNeeds[1].image} />
              <img alt="Local accessibility" src={seedNeeds[4].image} />
            </div>
          </section>

          <section className="impact-strip">
            <StatBlock
              label="Local needs mapped"
              suffix=""
              value={animatedNeedCount}
            />
            <StatBlock
              label="Community votes captured"
              suffix=""
              value={animatedVoteCount}
            />
            <StatBlock
              label="Estimated monthly partner value"
              prefix="£"
              value={animatedValue}
            />
          </section>

          <section className="story-section" id="how-it-works">
            <div className="story-copy">
              <span className="eyebrow">What it does</span>
              <h2>Built for residents first, with a serious pathway for councils and nonprofits.</h2>
              <p>
                The core product is simple: people sign in, add a need tied to a real place, and
                vote on what matters. Around that, VoteCity layers prioritisation, evidence, and a
                clearer record of community demand.
              </p>
            </div>
            <div className="story-features">
              <article>
                <img alt="Map view of community needs" src={seedNeeds[2].image} />
                <h3>Map local needs</h3>
                <p>Every issue starts with a place, a story, and a real photo.</p>
              </article>
              <article>
                <img alt="Residents supporting local priorities" src={seedNeeds[3].image} />
                <h3>Vote with an account</h3>
                <p>Signed-in residents get five votes each week, with one vote per need.</p>
              </article>
              <article>
                <img alt="Accessible community improvements" src={seedNeeds[4].image} />
                <h3>Review what rises</h3>
                <p>Councils and partners can see what support is building and why.</p>
              </article>
            </div>
          </section>

          <section className="explorer-section" id="explore">
            <div className="section-intro">
              <span className="eyebrow">Live explorer</span>
              <h2>Browse the borough map and support the needs that matter most.</h2>
              <p>
                The map is the product. Select a need, read the local story, and vote if you have
                an account.
              </p>
            </div>

            <div className="explorer-toolbar">
              <label>
                Area
                <select value={activeArea} onChange={(event) => setActiveArea(event.target.value)}>
                  <option>All areas</option>
                  {boroughAreas.map((area) => (
                    <option key={area}>{area}</option>
                  ))}
                </select>
              </label>
              <label>
                Category
                <select
                  value={activeCategory}
                  onChange={(event) => setActiveCategory(event.target.value)}
                >
                  <option>All categories</option>
                  {categories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </label>
              <div className="vote-status">
                <span>Votes left this week</span>
                <strong>{votesRemaining}</strong>
              </div>
            </div>

            <div className="explorer-layout">
              <div className="map-column">
                <div className="map-shell">
                  <MapContainer
                    center={selectedNeed?.coordinates ?? BOROUGH_CENTER}
                    className="live-map"
                    scrollWheelZoom={true}
                    zoom={14}
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <SelectedNeedViewport coordinates={selectedNeed?.coordinates ?? BOROUGH_CENTER} />
                    {enrichedNeeds.map((need) => (
                      <CircleMarker
                        center={need.coordinates}
                        eventHandlers={{ click: () => setSelectedNeedId(need.id) }}
                        key={need.id}
                        pathOptions={{
                          color: need.id === selectedNeed?.id ? "#b96a11" : "#0d7c68",
                          fillColor: need.id === selectedNeed?.id ? "#d88b2f" : "#11a287",
                          fillOpacity: 0.92,
                          weight: need.id === selectedNeed?.id ? 3 : 2
                        }}
                        radius={Math.max(8, Math.min(18, 6 + Math.round(need.votes / 4)))}
                      >
                        <Popup>
                          <strong>{need.title}</strong>
                          <br />
                          {need.area} · {need.votes} votes
                        </Popup>
                      </CircleMarker>
                    ))}
                  </MapContainer>
                  <div className="map-overlay">
                    <span className="eyebrow">Live map</span>
                    <strong>{boroughName}</strong>
                    <p>Select a marker to inspect a local need.</p>
                  </div>
                </div>

                {selectedNeed ? (
                  <div className="selected-need">
                    <div className="selected-image">
                      <img alt={selectedNeed.title} src={selectedNeed.image} />
                    </div>
                    <div className="selected-copy">
                      <div className="selected-meta">
                        <Badge color="amber" radius="full">
                          {selectedNeed.category}
                        </Badge>
                        <Badge radius="full" variant="soft">
                          {selectedNeed.status}
                        </Badge>
                      </div>
                      <h3>{selectedNeed.title}</h3>
                      <p>{selectedNeed.reason}</p>
                      <div className="selected-signals">
                        <div>
                          <span>Urgency</span>
                          <strong>{selectedNeed.urgencyLabel}</strong>
                        </div>
                        <div>
                          <span>Priority</span>
                          <strong>{selectedNeed.priorityScore}/100</strong>
                        </div>
                        <div>
                          <span>Votes</span>
                          <strong>{selectedNeed.votes}</strong>
                        </div>
                      </div>
                      <div className="ai-review-panel">
                        <div className="ai-review-head">
                          <span className="eyebrow">AI review</span>
                          <Badge
                            color={reviewColor(selectedNeed.aiReview)}
                            radius="full"
                            variant="soft"
                          >
                            {reviewLabel(selectedNeed.aiReview)}
                          </Badge>
                        </div>
                        <p className="muted-copy">
                          {selectedNeed.aiReview?.summary ??
                            "Every new idea starts under review, then AI checks feasibility."}
                        </p>
                        {typeof selectedNeed.aiReview?.score === "number" ? (
                          <div className="review-score-row">
                            <strong>{selectedNeed.aiReview.score}/100</strong>
                            <span>{selectedNeed.aiReview.rating} feasibility</span>
                          </div>
                        ) : null}
                        {selectedNeed.aiReview?.nextStep ? (
                          <p className="review-next-step">
                            Next step: {selectedNeed.aiReview.nextStep}
                          </p>
                        ) : null}
                        {selectedNeed.aiReview?.error ? (
                          <p className="review-next-step muted-copy">
                            Detail: {selectedNeed.aiReview.error}
                          </p>
                        ) : null}
                        {isOpenRouterConfigured &&
                        (selectedNeed.aiReview?.state === "failed" ||
                          selectedNeed.aiReview?.state === "pending") ? (
                          <div className="review-actions">
                            <Button
                              onClick={() => void triggerAiReview(selectedNeed)}
                              size="2"
                              variant="soft"
                            >
                              Retry AI review
                            </Button>
                          </div>
                        ) : null}
                      </div>
                      <p className="muted-copy">{selectedNeed.aiReason}</p>
                      <div className="selected-actions">
                        <Button
                          disabled={userVoteIds.includes(selectedNeed.id) || votesRemaining <= 0}
                          onClick={() => handleVote(selectedNeed.id)}
                          size="3"
                        >
                          {identity
                            ? userVoteIds.includes(selectedNeed.id)
                              ? "Already voted"
                              : "Vote for this need"
                            : "Sign in to vote"}
                        </Button>
                        {!identity ? (
                          <Button variant="soft" onClick={() => requireAuth("signup")} size="3">
                            Create account
                          </Button>
                        ) : null}
                      </div>
                      {selectedNeed.votes >= FUNDING_THRESHOLD ? (
                        <div className="funding-block">
                          <div className="funding-head">
                            <strong>Funding unlocked</strong>
                            <span>
                              {currency.format(selectedNeed.fundingRaised)} of{" "}
                              {currency.format(selectedNeed.fundingGoal)} raised
                            </span>
                          </div>
                          <div className="progress-track" aria-hidden="true">
                            <div
                              className="progress-fill"
                              style={{
                                width: `${Math.round(
                                  (selectedNeed.fundingRaised / selectedNeed.fundingGoal) * 100
                                )}%`
                              }}
                            />
                          </div>
                          <div className="donation-row">
                            {[25, 50, 100].map((amount) => (
                              <Button
                                key={amount}
                                onClick={() => handleDonate(selectedNeed.id, amount)}
                                variant="soft"
                              >
                                Contribute {currency.format(amount)}
                              </Button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="muted-copy">
                          Funding appears once a need reaches {FUNDING_THRESHOLD} votes.
                        </p>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              <aside className="explorer-sidebar">
                <div className="sidebar-section">
                  <span className="eyebrow">Ranked needs</span>
                  <h3>What residents are backing now</h3>
                  <div className="need-list">
                    {enrichedNeeds.map((need, index) => (
                      <button
                        className={need.id === selectedNeed?.id ? "need-list-item active" : "need-list-item"}
                        key={need.id}
                        onClick={() => setSelectedNeedId(need.id)}
                        type="button"
                      >
                        <span className="need-rank">#{index + 1}</span>
                        <div>
                          <strong>{need.title}</strong>
                          <span>
                            {need.area} · {need.votes} votes
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="sidebar-section partner-toggle">
                  <div className="toggle-head">
                    <span className="eyebrow">Partner lens</span>
                    <button
                      className={partnerView ? "toggle-button active" : "toggle-button"}
                      onClick={() => setPartnerView((value) => !value)}
                      type="button"
                    >
                      {partnerView ? "Resident view" : "Council view"}
                    </button>
                  </div>
                  {partnerView ? (
                    <div className="partner-panel">
                      <h3>Review view for councils and nonprofits</h3>
                      <ul>
                        {councilStats.byStatus.map((entry) => (
                          <li key={entry.status}>
                            <span>{entry.status}</span>
                            <strong>{entry.count}</strong>
                          </li>
                        ))}
                      </ul>
                      <p className="muted-copy">
                        Estimated monthly partner value: {currency.format(roiStats.monthlyStaffValue)}
                      </p>
                    </div>
                  ) : (
                    <div className="partner-panel">
                      <h3>Why people use VoteCity</h3>
                      <p className="muted-copy">
                        It makes support visible, ties every issue to a real place, and lets people
                        act without needing to understand council structures first.
                      </p>
                    </div>
                  )}
                </div>
              </aside>
            </div>
          </section>

          <section className="submission-section" id="submit-need">
            <div className="submission-copy">
              <span className="eyebrow">Add a need</span>
              <h2>Anyone can browse. Signed-in residents can submit and vote.</h2>
              <p>
                New submissions go straight onto the live map with a real image, a category, and a
                location inside the borough.
              </p>
              <img alt="Residents improving public space" src={seedNeeds[5].image} />
            </div>

            <div className="submission-form">
              {!identity ? (
                <div className="auth-gate">
                  <h3>Create an account to take part</h3>
                  <p>
                    Voting and submissions are tied to an account so each resident gets a fair
                    weekly vote allowance.
                  </p>
                  <Button size="3" onClick={() => requireAuth("signup")}>
                    Create account
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleSubmit}>
                  <div className="form-grid">
                    <label>
                      Title
                      <TextField.Root
                        name="title"
                        placeholder="Example: Better lighting by the towpath bridge"
                      />
                    </label>
                    <label>
                      Category
                      <select name="category" defaultValue="">
                        <option value="" disabled>
                          Select a category
                        </option>
                        {categories.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Area
                      <select
                        name="area"
                        onChange={(event) => {
                          const nextArea = event.target.value;
                          setDraftArea(nextArea);
                          setDraftCoordinates(areaCoordinates[nextArea] ?? BOROUGH_CENTER);
                        }}
                        value={draftArea}
                      >
                        {boroughAreas.map((area) => (
                          <option key={area} value={area}>
                            {area}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Photo URL
                      <TextField.Root name="photo" placeholder="https://..." />
                    </label>
                  </div>
                  <label className="full-width-field">
                    Why does it matter?
                    <TextArea name="reason" placeholder="Describe the local need and who it affects." />
                  </label>
                  <div className="location-picker">
                    <div className="location-copy">
                      <span className="eyebrow">Choose the exact place</span>
                      <h3>Click the map or drag the marker</h3>
                      <p className="muted-copy">
                        Fine-tune the location before publishing. The area sets the starting point,
                        then you can adjust it precisely.
                      </p>
                      <div className="coordinate-readout">
                        <span>Latitude {draftCoordinates[0].toFixed(5)}</span>
                        <span>Longitude {draftCoordinates[1].toFixed(5)}</span>
                      </div>
                    </div>
                    <div className="picker-map-shell">
                      <MapContainer center={draftCoordinates} className="picker-map" scrollWheelZoom={true} zoom={15}>
                        <TileLayer
                          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        />
                        <PickerViewport coordinates={draftCoordinates} />
                        <LocationPickerLayer
                          coordinates={draftCoordinates}
                          setCoordinates={setDraftCoordinates}
                        />
                      </MapContainer>
                    </div>
                  </div>
                  <div className="form-footer">
                    <p className="muted-copy">Signed in as {identity.email}</p>
                    <Button type="submit" size="3">
                      Publish local need
                    </Button>
                  </div>
                  {submitMessage ? <p className="form-message">{submitMessage}</p> : null}
                </form>
              )}
            </div>
          </section>

          <section className="council-section" id="for-councils">
            <div className="section-intro">
              <span className="eyebrow">For councils and partner organisations</span>
              <h2>Use community signals to review priorities faster and communicate more clearly.</h2>
            </div>
            <div className="partner-briefing">
              <div className="briefing-hero">
                <img alt="Council planning and review" src={seedNeeds[1].image} />
                <div className="briefing-copy">
                  <Badge color="jade" radius="full" size="2">
                    Live partner briefing
                  </Badge>
                  <h3>See what is rising locally before it becomes another manual reporting cycle.</h3>
                  <p>
                    VoteCity gives councils and delivery partners one place to review public demand,
                    understand urgency, and update the status residents can already see.
                  </p>
                  <div className="briefing-tags">
                    <span>{councilStats.totalNeeds} live needs</span>
                    <span>{councilStats.eligible} funding-ready</span>
                    <span>{councilStats.underReview} under review</span>
                  </div>
                </div>
              </div>

              <div className="briefing-metrics">
                <article className="briefing-metric">
                  <span>Estimated staff time recovered</span>
                  <strong>{roiStats.monthlyHoursSaved.toFixed(1)} hrs</strong>
                  <p>Time saved by grouping repeated local demand before manual triage starts.</p>
                </article>
                <article className="briefing-metric">
                  <span>Reporting time reduced</span>
                  <strong>{roiStats.reportTimeReduction} hrs</strong>
                  <p>Faster briefings for wards, committees, partner reviews, and update notes.</p>
                </article>
                <article className="briefing-metric">
                  <span>Protected spending</span>
                  <strong>{currency.format(roiStats.avoidedSpend)}</strong>
                  <p>Clearer ranking helps partners avoid pushing lower-signal projects first.</p>
                </article>
              </div>

              <div className="briefing-workspace">
                <div className="priority-queue">
                  <div className="queue-head">
                    <span className="eyebrow">Priority queue</span>
                    <h3>Needs most likely to require a response next</h3>
                  </div>
                  <div className="queue-list">
                    {aiPriorities.map((need, index) => (
                      <article className="queue-item" key={need.id}>
                        <div className="queue-rank">#{index + 1}</div>
                        <div className="queue-copy">
                          <strong>{need.title}</strong>
                          <p>
                            {need.area} · {need.votes} votes · {need.urgencyLabel}
                          </p>
                          <span>{need.aiReason}</span>
                          {need.aiReview?.rating ? (
                            <span className="queue-ai-line">
                              AI feasibility: {need.aiReview.rating} ({need.aiReview.score}/100)
                            </span>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>

                <div className="status-editor">
                  <div className="queue-head">
                    <span className="eyebrow">Public status updates</span>
                    <h3>Keep residents informed as priorities move</h3>
                  </div>
                  {aiPriorities.map((need) => (
                    <div className="status-card" key={need.id}>
                      <div className="status-card-copy">
                        <strong>{need.title}</strong>
                        <p>
                          {need.area} · {need.votes} votes · {need.urgencyLabel}
                        </p>
                        {need.aiReview?.rating ? (
                          <span className="status-ai-line">
                            AI feasibility: {need.aiReview.rating} ({need.aiReview.score}/100)
                          </span>
                        ) : null}
                      </div>
                      <div className="status-row">
                        {statusOptions.map((status) => (
                          <button
                            className={status === need.status ? "status-btn active" : "status-btn"}
                            key={status}
                            onClick={() => updateStatus(need.id, status)}
                            type="button"
                          >
                            {status}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <footer className="site-footer">
            <div className="footer-brand">
              <img alt="VoteCity logo" className="footer-logo" src={voteCityMark} />
              <strong>VoteCity</strong>
              <p>Local needs, visible support, clearer decisions.</p>
            </div>
            <div className="footer-columns">
              <div>
                <h4>Product</h4>
                <a href="#how-it-works">How it works</a>
                <a href="#explore">Live map</a>
                <a href="#for-councils">For councils</a>
              </div>
              <div>
                <h4>Participation</h4>
                <span>Account-based voting</span>
                <span>5 votes per resident each week</span>
                <span>Location-based submissions</span>
              </div>
              <div>
                <h4>Trust</h4>
                <span>Visible public status updates</span>
                <span>Simulated funding only in this demo</span>
                <span>Built for a generic London borough story</span>
              </div>
            </div>
            <div className="footer-cta">
              <div className="footer-actions">
                <Button variant="soft" onClick={() => document.getElementById("explore")?.scrollIntoView({ behavior: "smooth" })}>
                  Browse the map
                </Button>
                <Button onClick={() => (identity ? document.getElementById("submit-need")?.scrollIntoView({ behavior: "smooth" }) : requireAuth("signup"))}>
                  Start participating
                </Button>
              </div>
              <p className="footer-note">
                {identity
                  ? `Signed in as ${identity.email}`
                  : "Create an account to vote and submit local needs."}
              </p>
            </div>
          </footer>
        </main>

        <AuthDialog
          authError={authError}
          authMode={authMode}
          authPending={authPending}
          authVersion={authVersion}
          configured={isSupabaseConfigured}
          onSubmit={handleAuthSubmit}
          setAuthMode={setAuthMode}
        />
      </Dialog.Root>
    </div>
  );
}

function AuthDialog({
  authMode,
  authPending,
  authError,
  configured,
  authVersion,
  onSubmit,
  setAuthMode
}: {
  authMode: AuthMode;
  authPending: boolean;
  authError: string;
  configured: boolean;
  authVersion: number;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  setAuthMode: (mode: AuthMode) => void;
}) {
  return (
    <Dialog.Content maxWidth="460px">
      <Dialog.Title>{authMode === "signup" ? "Create your account" : "Sign in to VoteCity"}</Dialog.Title>
      <Dialog.Description>
        Voting and submitting local needs are tied to an account so each resident gets a fair vote allowance.
      </Dialog.Description>

      <div className="auth-switch">
        <button
          className={authMode === "signin" ? "auth-mode-button active" : "auth-mode-button"}
          onClick={() => setAuthMode("signin")}
          type="button"
        >
          Sign in
        </button>
        <button
          className={authMode === "signup" ? "auth-mode-button active" : "auth-mode-button"}
          onClick={() => setAuthMode("signup")}
          type="button"
        >
          Create account
        </button>
      </div>

      <form className="auth-form" key={`${authMode}-${authVersion}`} onSubmit={onSubmit}>
        {authMode === "signup" ? (
          <label>
            Name
            <TextField.Root name="name" placeholder="Your name" required={!configured} />
          </label>
        ) : null}
        <label>
          Email
          <TextField.Root name="email" placeholder="you@example.com" required type="email" />
        </label>
        <label>
          Password
          <TextField.Root name="password" placeholder="Password" required type="password" />
        </label>
        {!configured ? (
          <Callout.Root color="amber">
            <Callout.Text>
              Supabase is not configured, so this form creates a local demo account for now.
            </Callout.Text>
          </Callout.Root>
        ) : null}
        {authError ? (
          <Callout.Root color="red">
            <Callout.Text>{authError}</Callout.Text>
          </Callout.Root>
        ) : null}
        <div className="auth-actions">
          <Dialog.Close>
            <Button type="button" variant="soft">
              Cancel
            </Button>
          </Dialog.Close>
          <Button disabled={authPending} type="submit">
            {authPending
              ? "Please wait"
              : authMode === "signup"
                ? "Create account"
                : "Sign in"}
          </Button>
        </div>
      </form>
    </Dialog.Content>
  );
}

function StatBlock({
  label,
  value,
  prefix = "",
  suffix = ""
}: {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <div className="stat-block">
      <span>{label}</span>
      <strong>
        {prefix}
        {Math.round(value).toLocaleString("en-GB")}
        {suffix}
      </strong>
    </div>
  );
}

function SelectedNeedViewport({ coordinates }: { coordinates: [number, number] }) {
  const map = useMap();

  useEffect(() => {
    map.flyTo(coordinates, map.getZoom(), {
      animate: true,
      duration: 0.6
    });
  }, [coordinates, map]);

  return null;
}

function PickerViewport({ coordinates }: { coordinates: [number, number] }) {
  const map = useMap();

  useEffect(() => {
    map.flyTo(coordinates, map.getZoom(), {
      animate: true,
      duration: 0.4
    });
  }, [coordinates, map]);

  return null;
}

function LocationPickerLayer({
  coordinates,
  setCoordinates
}: {
  coordinates: [number, number];
  setCoordinates: (coordinates: [number, number]) => void;
}) {
  const pickerIcon = useMemo(
    () =>
      L.divIcon({
        className: "picker-marker-icon",
        html: '<span class="picker-marker-dot"></span>',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      }),
    []
  );

  useMapEvents({
    click(event) {
      setCoordinates([event.latlng.lat, event.latlng.lng]);
    }
  });

  return (
    <Marker
      draggable={true}
      eventHandlers={{
        dragend(event) {
          const latLng = event.target.getLatLng();
          setCoordinates([latLng.lat, latLng.lng]);
        }
      }}
      icon={pickerIcon}
      position={coordinates}
    />
  );
}

function sessionToIdentity(session: Session | null): AppIdentity | null {
  if (!session?.user.email) {
    return null;
  }

  return {
    id: session.user.id,
    email: session.user.email,
    displayName:
      (session.user.user_metadata.display_name as string | undefined) ??
      session.user.email.split("@")[0],
    source: "supabase"
  };
}

function calculatePriorityScore(need: NeedItem) {
  let score = 40;
  score += Math.min(need.votes * 1.6, 36);

  if (need.status === "Under review") score += 10;
  if (need.status === "Planned") score += 4;
  if (need.status === "Funded") score -= 8;
  if (need.status === "Not feasible") score -= 12;
  if (need.category === "Safety" || need.category === "Access") score += 8;
  if (need.votes >= FUNDING_THRESHOLD) score += 8;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function estimateDuplicateSignal(need: NeedItem, needs: NeedItem[]) {
  const sameAreaCategory = needs.filter(
    (item) => item.id !== need.id && item.area === need.area && item.category === need.category
  ).length;
  const sameCategory = needs.filter(
    (item) => item.id !== need.id && item.category === need.category
  ).length;

  return Math.max(1, sameAreaCategory + Math.min(2, sameCategory));
}

function describeUrgency(priorityScore: number) {
  if (priorityScore >= 82) return "High urgency";
  if (priorityScore >= 68) return "Priority emerging";
  return "Monitor";
}

function buildAiReason(need: NeedItem, priorityScore: number, duplicateSignal: number) {
  const urgency =
    priorityScore >= 82
      ? "High public backing and service relevance"
      : priorityScore >= 68
        ? "Growing signal across the borough"
        : "Community interest is present but still building";

  const categoryContext =
    need.category === "Safety" || need.category === "Access"
      ? "Likely to affect daily confidence and inclusion."
      : "Likely to improve day-to-day quality of life.";

  return `${urgency}. ${duplicateSignal} similar signals detected around ${need.area}. ${categoryContext}`;
}

function normalizeState(parsed: Partial<AppState>): AppState {
  const initial = createInitialState();
  const rawNeeds = Array.isArray(parsed.needs) ? parsed.needs : initial.needs;
  const rawLedger =
    parsed.voteLedger && typeof parsed.voteLedger === "object" ? parsed.voteLedger : {};

  return {
    needs: rawNeeds.map((need, index) => normalizeNeed(need, index)),
    lastVoteWeekKey:
      typeof parsed.lastVoteWeekKey === "string"
        ? parsed.lastVoteWeekKey
        : initial.lastVoteWeekKey,
    voteLedger: Object.fromEntries(
      Object.entries(rawLedger).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
      ])
    )
  };
}

function normalizeNeed(rawNeed: unknown, index: number): NeedItem {
  const initial = createInitialState();
  const seedFallback = initial.needs[index % initial.needs.length];
  const need = typeof rawNeed === "object" && rawNeed !== null ? rawNeed : {};
  const candidate = need as Partial<NeedItem>;
  const area =
    typeof candidate.area === "string" && candidate.area in areaCoordinates
      ? candidate.area
      : seedFallback.area;
  const coordinates = candidate.coordinates;
  const hasValidCoordinates =
    Array.isArray(coordinates) &&
    coordinates.length === 2 &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number";

  return {
    id: typeof candidate.id === "string" ? candidate.id : seedFallback.id,
    title: typeof candidate.title === "string" ? candidate.title : seedFallback.title,
    category: candidate.category ?? seedFallback.category,
    area,
    coordinates: hasValidCoordinates
      ? [coordinates[0], coordinates[1]]
      : areaCoordinates[area] ?? seedFallback.coordinates,
    reason: typeof candidate.reason === "string" ? candidate.reason : seedFallback.reason,
    votes: typeof candidate.votes === "number" ? candidate.votes : seedFallback.votes,
    status: candidate.status ?? seedFallback.status,
    image: typeof candidate.image === "string" ? candidate.image : seedFallback.image,
    fundingGoal:
      typeof candidate.fundingGoal === "number"
        ? candidate.fundingGoal
        : seedFallback.fundingGoal,
    fundingRaised:
      typeof candidate.fundingRaised === "number"
        ? candidate.fundingRaised
        : seedFallback.fundingRaised,
    donorCount:
      typeof candidate.donorCount === "number" ? candidate.donorCount : seedFallback.donorCount,
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : seedFallback.createdAt,
    submittedBy: typeof candidate.submittedBy === "string" ? candidate.submittedBy : undefined,
    aiReview: normalizeAiReview(candidate.aiReview)
  };
}

function randomFallbackImage(category: NeedCategory) {
  const imagesByCategory: Record<NeedCategory, string> = {
    Streets: seedNeeds[5].image,
    Youth: seedNeeds[0].image,
    "Green Spaces": seedNeeds[2].image,
    Community: seedNeeds[3].image,
    Safety: seedNeeds[1].image,
    Access: seedNeeds[4].image
  };

  return imagesByCategory[category];
}

function initials(value: string) {
  return value
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function normalizeAiReview(rawReview: unknown): AiReview | undefined {
  if (!rawReview || typeof rawReview !== "object") {
    return undefined;
  }

  const review = rawReview as Partial<AiReview>;

  return {
    state: review.state ?? "idle",
    rating: review.rating,
    score: typeof review.score === "number" ? review.score : undefined,
    summary: typeof review.summary === "string" ? review.summary : undefined,
    nextStep: typeof review.nextStep === "string" ? review.nextStep : undefined,
    reviewedAt: typeof review.reviewedAt === "string" ? review.reviewedAt : undefined,
    error: typeof review.error === "string" ? review.error : undefined
  };
}

function reviewLabel(review?: AiReview) {
  if (!review) return "Awaiting review";
  if (review.state === "pending") return "Reviewing now";
  if (review.state === "failed") return "Review unavailable";
  if (review.rating) return `${review.rating} feasibility`;
  return "Awaiting review";
}

function reviewColor(review?: AiReview) {
  if (!review) return "gray" as const;
  if (review.state === "pending") return "amber" as const;
  if (review.state === "failed") return "gray" as const;
  if (review.rating === "High") return "jade" as const;
  if (review.rating === "Medium") return "amber" as const;
  if (review.rating === "Low" || review.rating === "Not feasible") return "red" as const;
  return "gray" as const;
}

export default App;
