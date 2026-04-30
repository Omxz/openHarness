const RETRYABLE_STATUSES = new Set(["blocked", "failed"]);
const READY_STATES = new Set(["ready", "configured"]);

export function buildRetryPlan({
  run,
  providerRegistry,
  requestedProvider,
  privacyMode,
} = {}) {
  if (!run || !RETRYABLE_STATUSES.has(run.status)) {
    return unavailable("run_not_retryable", "Only blocked or failed runs can be retried");
  }

  const goal = typeof run.goal === "string" ? run.goal.trim() : "";
  if (!goal) {
    return unavailable("missing_goal", "Run has no goal to retry");
  }

  const providers = providerRegistry?.providers ?? [];
  const selectedPrivacyMode =
    privacyMode || run.privacyMode || providerRegistry?.privacyMode || "ask-before-api";
  const currentProviderId = canonicalProviderId(
    run.workerId ?? run.providerId ?? run.provider,
  );
  const candidates = providers
    .map((provider) => ({
      provider,
      eligible: isEligibleProvider({
        provider,
        privacyMode: selectedPrivacyMode,
        currentProviderId,
        supervisionCategory: run.supervision?.category,
      }),
    }))
    .filter((candidate) => candidate.eligible);

  if (requestedProvider) {
    const provider = providers.find((candidate) => candidate.id === requestedProvider);
    if (!provider) {
      return unavailable(
        "provider_not_found",
        `Retry provider "${requestedProvider}" was not found`,
      );
    }
    const eligible = candidates.find((candidate) => candidate.provider.id === requestedProvider);
    if (!eligible) {
      return unavailable(
        "provider_not_eligible",
        `Retry provider "${requestedProvider}" is not eligible for ${selectedPrivacyMode}`,
      );
    }
    return planForProvider({
      run,
      provider,
      privacyMode: selectedPrivacyMode,
      currentProviderId,
    });
  }

  const [best] = candidates.sort((left, right) =>
    scoreProvider({
      provider: right.provider,
      currentProviderId,
      supervisionCategory: run.supervision?.category,
    }) -
    scoreProvider({
      provider: left.provider,
      currentProviderId,
      supervisionCategory: run.supervision?.category,
    }),
  );

  if (!best) {
    return unavailable(
      "no_eligible_provider",
      `No ready retry provider supports ${selectedPrivacyMode}`,
    );
  }

  return planForProvider({
    run,
    provider: best.provider,
    privacyMode: selectedPrivacyMode,
    currentProviderId,
  });
}

function isEligibleProvider({
  provider,
  privacyMode,
  currentProviderId,
  supervisionCategory,
}) {
  if (!provider?.id) return false;
  if (provider.runnable === false || provider.configured === false) return false;
  if (!READY_STATES.has(provider.readiness?.state)) return false;
  if (!provider.privacyModes?.includes(privacyMode)) return false;
  if (
    provider.id === currentProviderId &&
    (supervisionCategory === "usage-limit" ||
      supervisionCategory === "auth-required")
  ) {
    return false;
  }
  return true;
}

function scoreProvider({ provider, currentProviderId, supervisionCategory }) {
  let score = 0;
  if (provider.readiness?.state === "ready") score += 30;
  if (provider.readiness?.state === "configured") score += 20;
  if (provider.id !== currentProviderId) score += 30;
  if (provider.kind === "subscription-worker") score += 30;
  if (provider.kind === "local") score += 24;
  if (provider.kind === "api") score += 12;
  if (provider.kind === "built-in") score -= 100;
  if (provider.id === currentProviderId && supervisionCategory === "worker-exit") {
    score -= 20;
  }
  return score;
}

function planForProvider({ run, provider, privacyMode, currentProviderId }) {
  const providerLabel = provider.label ?? provider.id;
  const baseReason =
    run.supervision?.reason ??
    supervisionReason(run.supervision?.category, currentProviderId) ??
    (currentProviderId
      ? `${currentProviderId} blocked`
      : "Run blocked");

  return {
    available: true,
    retryOfRunId: run.runId,
    providerId: provider.id,
    providerLabel,
    privacyMode,
    reason: `${baseReason}; retry with ${providerLabel}`,
  };
}

function supervisionReason(category, providerId) {
  if (!providerId) return null;
  if (category === "usage-limit") return `${providerId} hit a usage limit`;
  if (category === "auth-required") return `${providerId} needs authentication`;
  return null;
}

function unavailable(code, reason) {
  return {
    available: false,
    code,
    reason,
  };
}

function canonicalProviderId(id) {
  if (id === "cli:scripted") return "scripted";
  return id ?? null;
}
