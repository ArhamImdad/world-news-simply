import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { assertAppEnvironment } from "@/lib/environment-isolation";

const STAGING_PROJECT_REF = "xfmbyxjevjliiwndcrpr";
const shutdown = new AbortController();
const activeTelemetry = new Set<import("@/lib/replenishment-telemetry").ReplenishmentTelemetryRecorder>();

function persistControlledArtifact(kind: string, value: unknown) {
  const directory = resolve(process.cwd(), ".calibration", "staging-control");
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, `${new Date().toISOString().replace(/[:.]/g, "-")}-${kind}-${crypto.randomUUID()}.json`);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
  return path;
}

function runIdArguments(args: string[]) {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--run-id" && args[index + 1]) values.push(args[++index]);
    else throw new Error(`Unsupported cleanup argument: ${args[index]}`);
  }
  return values;
}

function fixtureArguments(args: string[]) {
  const runIds: string[] = [];
  let count = 1;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--run-id" && args[index + 1]) runIds.push(args[++index]);
    else if (args[index] === "--count" && args[index + 1]) count = Number.parseInt(args[++index], 10);
    else throw new Error(`Unsupported fixture argument: ${args[index]}`);
  }
  if (!Number.isInteger(count) || count < 1 || count > 30) {
    throw new Error("Fixture count must be an integer from 1 through 30.");
  }
  return { runIds, count };
}

async function stagingInspection(requireClean: boolean) {
  const [{ createServerSupabaseClient }, control] = await Promise.all([
    import("@/lib/supabase"), import("@/lib/staging-reserve-control"),
  ]);
  const inspection = await control.inspectStagingReserveState(createServerSupabaseClient());
  const artifactPath = persistControlledArtifact("inspection", inspection);
  if (requireClean && !control.reserveHarnessMayStart(inspection).allowed) {
    throw new Error(`Clean staging baseline validation failed: ${inspection.mismatches.join("; ")}`);
  }
  return { artifactPath, inspection };
}

async function cleanupRepository() {
  const [{ createServerSupabaseClient }, control] = await Promise.all([
    import("@/lib/supabase"), import("@/lib/staging-reserve-control"),
  ]);
  const database = createServerSupabaseClient();
  const fail = (label: string, error: { message: string } | null) => {
    if (error) throw new Error(`${label} failed: ${error.message}`);
  };
  const repository: import("@/lib/staging-reserve-control").CleanupRepository = {
    inspect: () => control.inspectStagingReserveState(database),
    async activeLeases() {
      const { data, error } = await database.from("replenishment_run_leases").select("run_id,expires_at")
        .gt("expires_at", new Date().toISOString());
      fail("Active lease inspection", error);
      return (data ?? []).map((row) => ({ runId: String(row.run_id), expiresAt: String(row.expires_at) }));
    },
    async attributedArticleIds(runIds) {
      const { data, error } = await database.from("article_replenishment_attribution").select("article_id").in("run_id", runIds);
      fail("Cleanup attribution resolution", error);
      return (data ?? []).map((row) => String(row.article_id));
    },
    async deleteArticles(articleIds) {
      if (articleIds.length === 0) return 0;
      const { count, error } = await database.from("articles").delete({ count: "exact" }).in("id", articleIds);
      fail("Run-attributed article cleanup", error);
      return count ?? 0;
    },
    async deleteExpiredLeases(runIds, at) {
      const { count, error } = await database.from("replenishment_run_leases").delete({ count: "exact" })
        .in("run_id", runIds).lte("expires_at", at);
      fail("Expired owned lease cleanup", error);
      return count ?? 0;
    },
  };
  return { database, control, repository };
}

async function stagingCleanup(suppliedRunIds: string[]) {
  const { control, repository } = await cleanupRepository();
  const result = await control.cleanupStagingReserveRuns(repository, suppliedRunIds);
  const artifactPath = persistControlledArtifact("cleanup", result);
  if (!result.success) throw new Error(`Cleanup postcondition failed: ${result.residualMismatches.join("; ")}`);
  return { artifactPath, result };
}

async function createControlledFixture(suppliedRunIds: string[], count = 1) {
  const { database, control } = await cleanupRepository();
  const [runId] = control.validatedRunIds(suppliedRunIds);
  if (suppliedRunIds.length !== 1) throw new Error("Fixture creation requires exactly one --run-id.");
  const { SYNTHESIS_SOURCES } = await import("@/lib/source-registry");
  const sources = SYNTHESIS_SOURCES.slice(0, 2);
  if (sources.length !== 2 || sources[0].domain === sources[1].domain) throw new Error("Controlled fixture requires two independent permitted sources.");
  const now = new Date();
  const articles = Array.from({ length: count }, (_, fixtureIndex) => {
    const fixtureNumber = fixtureIndex + 1;
    return {
      slug: `controlled-staging-fixture-${runId}-${fixtureNumber}`,
      title: `Controlled staging reserve visibility fixture ${fixtureNumber}`,
      content: `Controlled staging-only fixture ${fixtureNumber} with complete attribution to both permitted official sources.`,
      summary: `A non-public staging fixture ${fixtureNumber} used only to validate reserve inspection and cleanup.`, image_url: "/globe.svg",
      image_photographer_name: null, image_photographer_profile_url: null, image_attribution_url: null,
      image_download_location: null,
      source_url: `https://${sources[0].domain}/controlled-staging-fixture/${runId}/${fixtureNumber}`,
      sources: sources.map((source, sourceIndex) => ({ title: `Controlled source ${sourceIndex + 1} fixture ${fixtureNumber}`,
        url: `https://${source.domain}/controlled-staging-fixture/${runId}/${fixtureNumber}/${sourceIndex + 1}`,
        publisher: source.publisher, licenseType: source.licenseType, sourceType: source.sourceType,
        isPrimary: sourceIndex === 0, registryId: source.id, recognized: true,
        commercialUseAllowed: source.commercialUseAllowed, aiProcessingAllowed: source.aiProcessingAllowed,
        transformationAllowed: source.transformationAllowed, permissionUrl: source.permissionUrl })),
      publication_status: "draft", editorial_state: "ready", quality_score: 95, category: "Business", region: "Global",
      article_type: "news", is_breaking: false, is_editors_pick: false, read_time: 2, views: 0,
      prepared_at: now.toISOString(), publish_after: now.toISOString(),
      expires_at: new Date(now.getTime() + 86_400_000).toISOString(), freshness_class: "CURRENT",
      publication_priority: 90,
      topic_signature: ["controlled", "staging", "reserve", `fixture-${fixtureNumber}`], content_pool: "economic-data",
      validation_results: { factualSupportPassed: true, originalityPassed: true, duplicateDetectionPassed: true,
        sourceOverlapPassed: true, unsupportedClaims: false, inventedQuotes: false, inventedStatistics: false,
        completeAttribution: true, hardWarnings: [] },
      generation_metadata: { pipelineVersion: "autonomous-queue-v1", provider: "controlled-fixture", model: "none",
        modernPipeline: true, preparedAutomatically: true, fixtureIdentity: `controlled:${runId}:${fixtureNumber}` },
      preparation_key: `controlled-fixture:${runId}:${fixtureNumber}`,
    };
  });
  const inserted = await database.from("articles").insert(articles).select("id");
  if (inserted.error || !inserted.data || inserted.data.length !== count) {
    throw new Error(`Controlled fixture insert failed: ${inserted.error?.message ?? "incorrect inserted row count"}`);
  }
  const articleIds = inserted.data.map((row) => String(row.id));
  try {
    const attribution = await database.from("article_replenishment_attribution")
      .insert(articleIds.map((articleId) => ({ article_id: articleId, run_id: runId })));
    if (attribution.error) throw new Error(`Controlled fixture attribution failed: ${attribution.error.message}`);
  } catch (error) {
    await database.from("articles").delete().in("id", articleIds);
    throw error;
  }
  const inspection = await control.inspectStagingReserveState(database);
  const result = { runId, articleIds, fixtureReadyCount: articleIds.length, organicReadyCount: 0,
    providerRequests: 0, inspection };
  return { artifactPath: persistControlledArtifact("fixture", result), result };
}

async function activeLeaseCleanupSafety(suppliedRunIds: string[]) {
  const { database, control, repository } = await cleanupRepository();
  const [runId] = control.validatedRunIds(suppliedRunIds);
  if (suppliedRunIds.length !== 1) throw new Error("Lease safety validation requires exactly one --run-id.");
  const leaseModule = await import("@/lib/replenishment-lease");
  const lease = new leaseModule.ReplenishmentRunLease(new leaseModule.SupabaseReplenishmentLeaseStore(database), { runId });
  await lease.acquire();
  let refused = false;
  try {
    await control.cleanupStagingReserveRuns(repository, [runId]);
  } catch (error) {
    refused = error instanceof Error && /active replenishment lease/.test(error.message);
  } finally {
    await lease.release();
  }
  if (!refused) throw new Error("Cleanup did not refuse an active replenishment lease.");
  const inspection = await control.inspectStagingReserveState(database);
  return { runId, cleanupRefusedWhileActive: true, leaseReleased: inspection.counts.activeLeases === 0,
    providerRequests: 0, inspection };
}

function combineCounts(target: Record<string, number>, addition: Record<string, number>) {
  for (const [key, value] of Object.entries(addition)) target[key] = (target[key] ?? 0) + value;
}

async function status() {
  const [{ createServerSupabaseClient }, { getReadyQueueDepth, permittedSourceIds }, { readyArticleFailures }] =
    await Promise.all([import("@/lib/supabase"), import("@/lib/publication-queue"), import("@/lib/publication-policy")]);
  const database = createServerSupabaseClient();
  const [{ count: total, error: totalError }, { data: readyRows, error: readyError }] = await Promise.all([
    database.from("articles").select("id", { count: "exact", head: true }),
    database.from("articles").select("id,title,summary,content,image_url,image_photographer_name,image_attribution_url,sources,publication_status,editorial_state,quality_score,category,prepared_at,publish_after,expires_at,freshness_class,content_pool,topic_signature,validation_results,generation_metadata")
      .eq("publication_status", "draft").eq("editorial_state", "ready").gt("expires_at", new Date().toISOString()),
  ]);
  if (totalError) throw new Error(`Unable to count staging articles: ${totalError.message}`);
  if (readyError) throw new Error(`Unable to inspect staging queue: ${readyError.message}`);

  const permitted = new Set(permittedSourceIds());
  const failures: Record<string, number> = {};
  const pairs: Record<string, number> = {};
  const categories: Record<string, number> = {};
  let minimumScore = 100;
  for (const row of readyRows ?? []) {
    const reasons = readyArticleFailures(row as never, permitted, new Date());
    for (const reason of reasons) failures[reason] = (failures[reason] ?? 0) + 1;
    const sources = Array.isArray(row.sources) ? row.sources as Array<{ registryId?: string }> : [];
    const pair = sources.map((source) => source.registryId ?? "unknown").sort().join(" + ");
    pairs[pair] = (pairs[pair] ?? 0) + 1;
    categories[row.category] = (categories[row.category] ?? 0) + 1;
    minimumScore = Math.min(minimumScore, row.quality_score);
  }
  const depth = await getReadyQueueDepth(database);
  return {
    totalArticles: total ?? 0,
    readyDepth: depth,
    eligibleReadyRows: (readyRows ?? []).length - Object.values(failures).reduce((sum, count) => sum + count, 0),
    minimumReadyScore: readyRows?.length ? minimumScore : null,
    eligibilityFailures: failures,
    sourcePairs: pairs,
    categories,
  };
}

async function auditSources() {
  const [{ SYNTHESIS_SOURCES }, { parseFeed }, { EVERGREEN_TOPICS }, { collectExplicitSourceMaterials }, { preflightSources }] =
    await Promise.all([
      import("@/lib/source-registry"), import("@/lib/rss"), import("@/lib/evergreen-topics"),
      import("@/lib/source-material"), import("@/lib/article-quality"),
    ]);
  const feedResults = [];
  for (const source of SYNTHESIS_SOURCES) {
    try {
      const feed = await parseFeed(source);
      feedResults.push({ id: source.id, items: feed.items.length, status: "ok" });
    } catch (error) {
      feedResults.push({ id: source.id, items: 0, status: error instanceof Error ? error.name : "failed" });
    }
  }
  const evergreenResults = [];
  for (const candidate of EVERGREEN_TOPICS) {
    const materials = await collectExplicitSourceMaterials([candidate, ...candidate.corroboration]);
    const preflight = preflightSources(materials);
    evergreenResults.push({
      title: candidate.title,
      materialCount: materials.length,
      characters: materials.map((material) => material.text.length),
      accepted: preflight.accepted,
      reasons: preflight.reasons,
    });
  }
  return { enabledSources: SYNTHESIS_SOURCES.length, feedResults, evergreenResults };
}

async function replenish(cycles: number, projectRef: string) {
  const [{ replenishReadyQueue }, { discoverCalibrationIdentityHistory }, telemetryModule, visibilityModule,
    { createServerSupabaseClient }] = await Promise.all([
    import("@/lib/news-update"), import("@/lib/calibration-artifacts"), import("@/lib/replenishment-telemetry"),
    import("@/lib/replenishment-visibility"), import("@/lib/supabase"),
  ]);
  const calibrationDirectory = resolve(process.cwd(), ".calibration");
  const discovery = existsSync(calibrationDirectory)
    ? discoverCalibrationIdentityHistory(calibrationDirectory)
    : { identities: [], metrics: { calibrationJsonFilesDiscovered: 0, identityReplayArtifactsAccepted: 0,
      knownNonIdentityArtifactsSkipped: 0, unknownArtifactsSkipped: 0, historicalIdentitiesLoaded: 0 }, routes: [] };
  const retainedKnownIdentities = discovery.identities;
  console.log(JSON.stringify({ calibrationArtifactDiscovery: discovery.metrics }));
  const aggregate = {
    cycles: 0, candidatesProcessed: 0, candidatesRejected: 0, articlesPrepared: 0,
    sourceFailures: 0, providerFailures: 0, duplicateRejections: 0,
    revisionAttempts: 0,
    candidatesSentToGroq: 0, candidatesDeferred: 0, groqCalls: 0,
    groqInputTokens: 0, groqOutputTokens: 0, groqTotalTokens: 0,
    auditResults: [] as Array<unknown>,
    rejectionReasons: {} as Record<string, number>, productiveSourcePairs: {} as Record<string, number>,
    preparedCategories: {} as Record<string, number>, rejectedCategories: {} as Record<string, number>,
    queueTrend: [] as number[], elapsedSeconds: 0,
  };
  const started = Date.now();
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const runId = crypto.randomUUID();
    const telemetry = new telemetryModule.ReplenishmentTelemetryRecorder({ runId, projectRef });
    activeTelemetry.add(telemetry);
    let metrics;
    try {
      await visibilityModule.observeControlledRlsVisibility({ telemetry, serviceClient: createServerSupabaseClient(),
        phase: "starting", required: true });
      metrics = await replenishReadyQueue(undefined, retainedKnownIdentities, { signal: shutdown.signal, runId, telemetry,
        observeRls: (phase) => visibilityModule.observeControlledRlsVisibility({ telemetry,
          serviceClient: createServerSupabaseClient(), phase, required: true }) });
      await visibilityModule.observeControlledRlsVisibility({ telemetry, serviceClient: createServerSupabaseClient(),
        phase: "ending", required: true });
      telemetry.finalize("completed", "replenishment cycle completed");
    } catch (error) {
      telemetry.finalize(shutdown.signal.aborted ? "aborted" : "failed",
        error instanceof Error ? error.name : "replenishment cycle failed");
      throw error;
    } finally {
      activeTelemetry.delete(telemetry);
    }
    aggregate.cycles += 1;
    aggregate.candidatesProcessed += metrics.candidatesProcessed;
    aggregate.candidatesRejected += metrics.candidatesRejected;
    aggregate.articlesPrepared += metrics.articlesPrepared;
    aggregate.sourceFailures += metrics.sourceFailures;
    aggregate.providerFailures += metrics.providerFailures;
    aggregate.revisionAttempts += metrics.revisionAttempts;
    aggregate.candidatesSentToGroq += metrics.candidatesSentToGroq;
    aggregate.candidatesDeferred += metrics.candidatesDeferred;
    aggregate.groqCalls += metrics.groqCalls;
    aggregate.groqInputTokens += metrics.groqInputTokens;
    aggregate.groqOutputTokens += metrics.groqOutputTokens;
    aggregate.groqTotalTokens += metrics.groqTotalTokens;
    aggregate.auditResults.push(...metrics.auditResults);
    aggregate.duplicateRejections += metrics.duplicateRejections;
    combineCounts(aggregate.rejectionReasons, metrics.rejectionReasons);
    combineCounts(aggregate.productiveSourcePairs, metrics.productiveSourcePairs);
    combineCounts(aggregate.preparedCategories, metrics.preparedCategories);
    combineCounts(aggregate.rejectedCategories, metrics.rejectedCategories);
    aggregate.queueTrend.push(metrics.queueDepthAfter);
    if (metrics.queueDepthAfter >= 18 || metrics.candidatesProcessed === 0) break;
  }
  aggregate.elapsedSeconds = Math.round((Date.now() - started) / 1000);
  return aggregate;
}

async function calibrationStartupValidation() {
  const baseline = await stagingInspection(true);
  const { discoverCalibrationIdentityHistory } = await import("@/lib/calibration-artifacts");
  const calibrationDirectory = resolve(process.cwd(), ".calibration");
  const discovery = existsSync(calibrationDirectory)
    ? discoverCalibrationIdentityHistory(calibrationDirectory)
    : { identities: [], metrics: { calibrationJsonFilesDiscovered: 0, identityReplayArtifactsAccepted: 0,
      knownNonIdentityArtifactsSkipped: 0, unknownArtifactsSkipped: 0, historicalIdentitiesLoaded: 0 }, routes: [] };
  return { baseline, artifactDiscovery: discovery.metrics, providerRequests: 0, runIdCreated: false, leaseAcquired: false };
}

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)];
}

async function leaseReliabilityValidation(projectRef: string) {
  const starting = await stagingInspection(true);
  const [leaseModule, telemetryModule, { createServerSupabaseClient }] = await Promise.all([
    import("@/lib/replenishment-lease"), import("@/lib/replenishment-telemetry"), import("@/lib/supabase"),
  ]);
  const database = createServerSupabaseClient();
  const runId = crypto.randomUUID();
  const systemKey = `lease-reliability:${runId}`;
  const staleSystemKey = `lease-reliability-stale:${runId}`;
  const staleRunId = crypto.randomUUID();
  const replacementRunId = crypto.randomUUID();
  const telemetry = new telemetryModule.ReplenishmentTelemetryRecorder({ runId, projectRef });
  activeTelemetry.add(telemetry);
  const store = new leaseModule.SupabaseReplenishmentLeaseStore(database);
  const lease = new leaseModule.ReplenishmentRunLease(store, { runId, systemKey, observer: telemetry.leaseObserver() });
  let leaseAcquired = false;
  let leaseReleased = false;
  let staleReleased = false;
  let staleOwner = staleRunId;
  try {
    telemetry.recordQueue({ phase: "starting", observedAt: starting.inspection.inspectedAt,
      readyDepth: starting.inspection.counts.readyArticles, totalRows: starting.inspection.counts.totalArticles,
      approvedCount: starting.inspection.counts.approvedArticles,
      publicationSlotCount: starting.inspection.counts.publicationSlots });
    telemetry.recordRls({ phase: "starting", observedAt: starting.inspection.inspectedAt, required: true,
      anonVisibleReady: starting.inspection.counts.anonVisibleReady,
      authenticatedVisibleReady: starting.inspection.counts.authenticatedVisibleReady,
      serviceReady: starting.inspection.counts.serviceVisibleReady, temporaryAuthUserRef: null,
      temporaryAuthUserDeleted: starting.inspection.temporaryAuthUserDeleted, errorCode: null });

    await lease.acquire();
    leaseAcquired = true;
    await lease.assertOwned(shutdown.signal);
    for (let index = 0; index < 15; index += 1) await lease.assertOwned(shutdown.signal);
    await lease.renew();
    await lease.assertOwned(shutdown.signal);

    const wrongOwnerId = crypto.randomUUID();
    const wrongOwnerOwned = await store.owns(systemKey, wrongOwnerId);
    const nonOwnerHeartbeat = await store.renew(systemKey, wrongOwnerId, 180);
    const nonOwnerRelease = await store.release(systemKey, wrongOwnerId);

    const staleAcquired = await store.acquire(staleSystemKey, staleRunId, 15);
    const unexpiredTakeover = await store.acquire(staleSystemKey, replacementRunId, 15);
    await new Promise((resolve) => setTimeout(resolve, 15_250));
    const expiredTakeover = await store.acquire(staleSystemKey, replacementRunId, 15);
    if (expiredTakeover) staleOwner = replacementRunId;
    const staleOwnerStillOwns = await store.owns(staleSystemKey, staleRunId);
    const replacementOwns = await store.owns(staleSystemKey, replacementRunId);
    const staleFixtureReleased = await store.release(staleSystemKey, replacementRunId);
    staleReleased = staleFixtureReleased;

    leaseReleased = await lease.release();
    const ending = await stagingInspection(true);
    telemetry.recordQueue({ phase: "ending", observedAt: ending.inspection.inspectedAt,
      readyDepth: ending.inspection.counts.readyArticles, totalRows: ending.inspection.counts.totalArticles,
      approvedCount: ending.inspection.counts.approvedArticles,
      publicationSlotCount: ending.inspection.counts.publicationSlots });
    telemetry.recordRls({ phase: "ending", observedAt: ending.inspection.inspectedAt, required: true,
      anonVisibleReady: ending.inspection.counts.anonVisibleReady,
      authenticatedVisibleReady: ending.inspection.counts.authenticatedVisibleReady,
      serviceReady: ending.inspection.counts.serviceVisibleReady, temporaryAuthUserRef: null,
      temporaryAuthUserDeleted: ending.inspection.temporaryAuthUserDeleted, errorCode: null });
    telemetry.markCleanup(ending.inspection.cleanBaseline);
    telemetry.finalize("incomplete", "provider-free lease reliability diagnostic completed");
    const artifact = telemetryModule.readReplenishmentTelemetry(telemetry.path);
    const attempts = artifact.lease.ownershipAttempts;
    const latencies = attempts.map((attempt) => attempt.latencyMs);
    const successfulLatencies = attempts.filter((attempt) => attempt.outcome === "TRUE")
      .map((attempt) => attempt.latencyMs);
    const outcomes = (outcome: import("@/lib/replenishment-lease").LeaseOwnershipOutcome) =>
      attempts.filter((attempt) => attempt.outcome === outcome).length;
    const result = {
      schemaVersion: "staging-lease-reliability-v1", runId, systemKey: "lease-reliability:<run-id>",
      telemetryPath: telemetry.path, providerRequests: artifact.providerAttempts.length,
      startingExactZero: starting.inspection.cleanBaseline, finalExactZero: ending.inspection.cleanBaseline,
      ownershipCalls: attempts.length, trueResponses: outcomes("TRUE"), falseResponses: outcomes("FALSE"),
      transportTimeouts: outcomes("TRANSPORT_TIMEOUT"), networkErrors: outcomes("NETWORK_ERROR"),
      rpcErrors: outcomes("RPC_ERROR"), minimumLatencyMs: latencies.length ? Math.min(...latencies) : null,
      medianLatencyMs: percentile(latencies, 0.5), p90LatencyMs: percentile(latencies, 0.9),
      maximumLatencyMs: latencies.length ? Math.max(...latencies) : null,
      successfulMinimumLatencyMs: successfulLatencies.length ? Math.min(...successfulLatencies) : null,
      successfulMedianLatencyMs: percentile(successfulLatencies, 0.5),
      successfulP90LatencyMs: percentile(successfulLatencies, 0.9),
      successfulMaximumLatencyMs: successfulLatencies.length ? Math.max(...successfulLatencies) : null,
      ownershipRetryCount: attempts.filter((attempt) => attempt.retryPerformed).length,
      heartbeatSucceeded: artifact.lease.heartbeatCount >= 1,
      wrongOwnerRejected: !wrongOwnerOwned, nonOwnerHeartbeatRejected: !nonOwnerHeartbeat,
      nonOwnerReleaseRejected: !nonOwnerRelease, staleAcquired, unexpiredTakeoverRejected: !unexpiredTakeover,
      expiredTakeoverSucceeded: expiredTakeover, staleOwnerRejected: !staleOwnerStillOwns,
      replacementOwnershipConfirmed: replacementOwns, staleFixtureReleased, leaseReleased,
      telemetryClassification: artifact.run.evidenceClassification,
    };
    if (result.providerRequests !== 0 || !result.startingExactZero || !result.finalExactZero ||
        !result.wrongOwnerRejected || !result.nonOwnerHeartbeatRejected || !result.nonOwnerReleaseRejected ||
        !result.staleAcquired || !result.unexpiredTakeoverRejected || !result.expiredTakeoverSucceeded ||
        !result.staleOwnerRejected || !result.replacementOwnershipConfirmed || !result.staleFixtureReleased ||
        !result.leaseReleased || !result.heartbeatSucceeded || result.trueResponses !== 17) {
      throw new Error("Lease reliability postcondition failed.");
    }
    return { artifactPath: persistControlledArtifact("lease-reliability", result), result };
  } finally {
    if (leaseAcquired && !leaseReleased) await lease.release().catch(() => false);
    if (!staleReleased) await store.release(staleSystemKey, staleOwner).catch(() => false);
    activeTelemetry.delete(telemetry);
  }
}

async function noProviderTelemetryValidation(projectRef: string) {
  const [telemetryModule, leaseModule, visibilityModule, { createServerSupabaseClient }] = await Promise.all([
    import("@/lib/replenishment-telemetry"), import("@/lib/replenishment-lease"),
    import("@/lib/replenishment-visibility"), import("@/lib/supabase"),
  ]);
  const database = createServerSupabaseClient();
  const runId = crypto.randomUUID();
  const telemetry = new telemetryModule.ReplenishmentTelemetryRecorder({ runId, projectRef });
  activeTelemetry.add(telemetry);
  const queueObservation = async (phase: "starting" | "ending" | "cleanup") => {
    const [total, ready, approved, slots] = await Promise.all([
      database.from("articles").select("id", { count: "exact", head: true }),
      database.from("articles").select("id", { count: "exact", head: true }).eq("publication_status", "draft").eq("editorial_state", "ready"),
      database.from("articles").select("id", { count: "exact", head: true }).eq("publication_status", "approved"),
      database.from("articles").select("id", { count: "exact", head: true }).not("publication_slot", "is", null),
    ]);
    if ([total, ready, approved, slots].some((result) => result.error)) throw new Error("Telemetry validation queue observation failed.");
    telemetry.recordQueue({ phase, observedAt: new Date().toISOString(), readyDepth: ready.count ?? 0,
      totalRows: total.count ?? 0, approvedCount: approved.count ?? 0, publicationSlotCount: slots.count ?? 0 });
    return { total: total.count ?? 0, ready: ready.count ?? 0, approved: approved.count ?? 0, slots: slots.count ?? 0 };
  };
  const lease = new leaseModule.ReplenishmentRunLease(new leaseModule.SupabaseReplenishmentLeaseStore(database),
    { runId, observer: telemetry.leaseObserver() });
  try {
    const starting = await queueObservation("starting");
    if (Object.values(starting).some((count) => count !== 0)) throw new Error("No-provider telemetry test requires the zero staging baseline.");
    await visibilityModule.observeControlledRlsVisibility({ telemetry, serviceClient: database, phase: "starting", required: true });
    await lease.acquire();
    await lease.assertOwned(shutdown.signal);
    const dispositions = [
      ["rejected:source-preflight", ["fewer than two independent permitted source domains"]],
      ["rejected:source-preflight", ["thin source"]],
      ["rejected:evidence", ["insufficient supported evidence facts"]],
      ["rejected:synthesis", ["weak cross-source synthesis"]],
      ["rejected:duplicate", ["duplicate canonical candidate identity"]],
      ["deferred:token-budget", ["token budget"]],
      ["deferred:provider-boundary-zero-provider-test", ["provider calls intentionally disabled"]],
      ["rejected:freshness", ["source item expired"]],
      ["rejected:source-preflight", ["thin source"]],
      ["rejected:evidence", ["source depth below requirement"]],
      ["rejected:synthesis", ["insufficient comparison opportunities"]],
      ["rejected:duplicate", ["duplicate"]],
      ["deferred:provider-limit", ["provider candidate limit"]],
      ["rejected:freshness", ["freshness metadata invalid"]],
      ["rejected:source-preflight", ["fewer than two independent permitted source domains", "thin source"]],
      ["rejected:evidence", ["insufficient supported evidence facts"]],
      ["rejected:synthesis", ["weak cross-source synthesis"]],
      ["deferred:zero-provider-test", ["provider calls intentionally disabled"]],
    ] as const;
    for (const [index, [disposition, reasonCodes]] of dispositions.entries()) {
      const rank = index + 1;
      const at = new Date(Date.now() + index).toISOString();
      const candidateTelemetryId = telemetryModule.candidateTelemetryIdFor(runId, rank);
      telemetry.considerCandidate({ candidateTelemetryId, deterministicRank: rank,
        discoveredIdentity: { topic: `zero-provider-fixture-${rank}`, sourceUrl: `https://fixture-${rank}.invalid/item` },
        sourceHints: [`fixture-${rank}`], consideredAt: at, supplyClass: "OCCASIONAL_CURRENT",
        releaseSeriesId: null, normalizedPeriod: null, canonicalSeriesPeriodIdentity: null, recurringCadence: null,
        publisherRoots: [`fixture-${rank}.invalid`], category: "fixture", discoverySourceId: `fixture-${rank}`,
        preparationKey: null, releasePublicationDates: [], nextExpectedCadenceClassification: null });
      const isPreflight = disposition === "rejected:source-preflight";
      const isDuplicate = disposition === "rejected:duplicate";
      telemetry.recordCandidate({ candidateTelemetryId,
        candidateHash: rank % 3 === 0 ? `fixture-hash-${rank}` : null,
        sourcePair: rank % 2 === 0 ? ["fixture-primary", "fixture-secondary"] : ["fixture-primary"],
        sourceDomains: rank % 2 === 0 ? ["one.invalid", "two.invalid"] : ["one.invalid"],
        sourcePreflightResults: { passed: !isPreflight, reasons: isPreflight ? [...reasonCodes] : [] },
        evidenceResults: disposition === "rejected:evidence" ? { passed: false, reasons: [...reasonCodes] } : null,
        synthesisResult: disposition === "rejected:synthesis"
          ? { passed: false, score: 60, reasons: [...reasonCodes] } : null,
        duplicateResult: { duplicate: isDuplicate, reasons: isDuplicate ? [...reasonCodes] : [] },
        preGroqScore: rank >= 6 ? 95 : null, synthesisScore: rank >= 6 ? 92 : null,
        disposition, reasonCodes: [...reasonCodes], duplicateIdentity: isDuplicate, providerWorkStarted: false,
        endedAt: at, durationMs: 0 });
    }
    telemetry.recordFunnel(dispositions.map(([disposition, reasonCodes], index) => {
      const rejectedPreflight = disposition === "rejected:source-preflight";
      const rejectedEvidence = disposition === "rejected:evidence" || disposition === "rejected:synthesis";
      const blockedDuplicate = disposition === "rejected:duplicate";
      const rejectedFreshness = disposition === "rejected:freshness";
      const deferred = disposition.startsWith("deferred:");
      return {
        funnelIdentity: `zero-provider:${index + 1}`, discoveryRank: index + 1,
        discoverySourceId: `fixture-${index + 1}`, sourceUrl: `https://fixture-${index + 1}.invalid/item`,
        sourceHints: [`fixture-${index + 1}`], rawDiscovered: true as const,
        resolution: rejectedFreshness ? "not-assessed" as const : "qualified" as const,
        pairing: rejectedFreshness ? "not-assessed" as const : "qualified" as const,
        preflight: rejectedFreshness ? "not-assessed" as const : rejectedPreflight ? "rejected" as const : "qualified" as const,
        evidence: rejectedFreshness || rejectedPreflight ? "not-assessed" as const
          : rejectedEvidence ? "rejected" as const : "qualified" as const,
        duplicate: rejectedFreshness || rejectedPreflight || rejectedEvidence ? "not-assessed" as const
          : blockedDuplicate ? "blocked" as const : "surviving" as const,
        ranking: deferred ? "deferred" as const : "not-assessed" as const,
        finalStage: disposition, reasonCodes: [...reasonCodes],
      };
    }));
    await lease.assertOwned(shutdown.signal);
    await lease.release();
    await queueObservation("ending");
    await visibilityModule.observeControlledRlsVisibility({ telemetry, serviceClient: database, phase: "ending", required: true });
    const cleanup = await queueObservation("cleanup");
    telemetry.markCleanup(Object.values(cleanup).every((count) => count === 0));
    telemetry.finalize("completed", "controlled zero-provider telemetry validation completed");
    const artifact = telemetryModule.readReplenishmentTelemetry(telemetry.path);
    const reconstructed = telemetryModule.reportFromReplenishmentTelemetry(artifact);
    const missingRecordCopy = structuredClone(artifact);
    missingRecordCopy.candidates.splice(5, 1);
    const duplicateIdCopy = structuredClone(artifact);
    duplicateIdCopy.candidates.push(structuredClone(duplicateIdCopy.candidates[0]));
    return { artifactPath: telemetry.path, providerRequests: reconstructed.accounting.uniqueAttemptCount,
      retainedCandidates: artifact.candidates.length,
      validArtifact: telemetryModule.validateReplenishmentTelemetry(artifact),
      missingRecordValidation: telemetryModule.validateReplenishmentTelemetry(missingRecordCopy),
      duplicateIdValidation: telemetryModule.validateReplenishmentTelemetry(duplicateIdCopy),
      reconstructed, stdoutRequired: false };
  } catch (error) {
    if (telemetry.snapshot().lease.releaseSuccess !== true) await lease.release().catch(() => false);
    telemetry.finalize(shutdown.signal.aborted ? "aborted" : "failed", error instanceof Error ? error.name : "failed");
    throw error;
  } finally {
    activeTelemetry.delete(telemetry);
  }
}

async function reconstructTelemetryReport(pathArgument?: string) {
  if (!pathArgument) throw new Error("A telemetry artifact path is required.");
  const telemetryModule = await import("@/lib/replenishment-telemetry");
  const root = resolve(process.cwd(), ".calibration", "replenishment-runs");
  const path = resolve(process.cwd(), pathArgument);
  const relativePath = relative(root, path);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Telemetry report path must be under .calibration/replenishment-runs.");
  }
  return telemetryModule.reportFromReplenishmentTelemetry(telemetryModule.readReplenishmentTelemetry(path));
}

async function providerFailureCheck() {
  const [{ replenishReadyQueue }, { getReadyQueueDepth }] = await Promise.all([
    import("@/lib/news-update"), import("@/lib/publication-queue"),
  ]);
  const before = await getReadyQueueDepth();
  const metrics = await replenishReadyQueue({
    id: "intentional-staging-failure",
    model: "none",
    async generate() { throw new Error("Intentional staging provider failure"); },
    async validate() { throw new Error("Intentional staging provider failure"); },
  }, [], { signal: shutdown.signal });
  const after = await getReadyQueueDepth();
  return { before, after, queueIntact: before === after, metrics };
}

async function availableGroqModels() {
  const Groq = (await import("groq-sdk")).default;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured for staging.");
  const page = await new Groq({ apiKey }).models.list();
  return page.data.map((model) => model.id).sort();
}

async function probeProvider() {
  const [{ EVERGREEN_TOPICS }, { collectExplicitSourceMaterials }, { GroqContentProvider }, { evaluateArticle, hasCompleteSourceAttribution }, { buildEvidenceBundle }] = await Promise.all([
    import("@/lib/evergreen-topics"), import("@/lib/source-material"), import("@/lib/content-provider"),
    import("@/lib/article-quality"),
    import("@/lib/evidence-model"),
  ]);
  const candidate = EVERGREEN_TOPICS[0];
  const sources = await collectExplicitSourceMaterials([candidate, ...candidate.corroboration]);
  const evidence = buildEvidenceBundle(candidate.title, sources, candidate.url);
  const provider = new GroqContentProvider();
  try {
    provider.beginCandidate(evidence.candidateHash, `controlled-candidate:${evidence.candidateHash}`);
    let generated = await provider.generate(evidence);
    try {
      let review = await provider.validate(generated, evidence);
      let revised = false;
      if (provider.revise && (!review.should_publish || !review.claims_supported || review.mostly_paraphrase ||
          review.factual_completeness < 90 || review.originality < 90 || review.added_value < 90 ||
          review.meaningful_context < 90)) {
        generated = await provider.revise(generated, { focus: "originality", reasons: review.rejection_reasons, review }, evidence);
        review = await provider.validate(generated, evidence);
        revised = true;
      }
      const quality = evaluateArticle({ ...generated, quality_review: review }, sources, []);
      return {
        sourceCount: sources.length,
        generation: "ok",
        validation: "ok",
        revised,
        shouldPublish: review.should_publish,
        scores: {
          factualCompleteness: review.factual_completeness,
          originality: review.originality,
          usefulness: review.usefulness,
          meaningfulContext: review.meaningful_context,
          headlineQuality: review.headline_quality,
          addedValue: review.added_value,
        },
        rejectionReasons: review.rejection_reasons,
        deterministicQuality: quality,
        completeAttribution: hasCompleteSourceAttribution(generated.content, sources),
      };
    } catch (error) {
      return { sourceCount: sources.length, generation: "ok", validation: "failed", error: error instanceof Error ? error.message.slice(0, 300) : "unknown" };
    }
  } catch (error) {
    return { sourceCount: sources.length, generation: "failed", error: error instanceof Error ? error.message.slice(0, 300) : "unknown" };
  }
}

async function inspectFirstEvergreenMaterials() {
  const [{ EVERGREEN_TOPICS }, { collectExplicitSourceMaterials }] = await Promise.all([
    import("@/lib/evergreen-topics"), import("@/lib/source-material"),
  ]);
  const candidate = EVERGREEN_TOPICS[0];
  const sources = await collectExplicitSourceMaterials([candidate, ...candidate.corroboration]);
  return sources.map((source) => ({
    registryId: source.registryId,
    characters: source.text.length,
    beginning: source.text.slice(0, 700),
  }));
}

async function auditEvidenceBundles() {
  const [{ EVERGREEN_TOPICS }, { collectExplicitSourceMaterials }, { preflightSources }, evidenceModule] = await Promise.all([
    import("@/lib/evergreen-topics"), import("@/lib/source-material"), import("@/lib/article-quality"),
    import("@/lib/evidence-model"),
  ]);
  const results = [];
  for (const candidate of EVERGREEN_TOPICS) {
    const sources = await collectExplicitSourceMaterials([candidate, ...candidate.corroboration]);
    const preflight = preflightSources(sources);
    const evidence = evidenceModule.buildEvidenceBundle(candidate.title, sources, candidate.url);
    results.push({
      candidateHash: evidence.candidateHash,
      pair: evidence.sources.map((source) => source.id).join(" + "),
      rawCharacters: sources.reduce((total, source) => total + source.text.length, 0),
      evidenceCharacters: JSON.stringify(evidenceModule.compactEvidencePayload(evidence)).length,
      facts: evidence.facts.length,
      comparisons: evidence.plan.comparisonOpportunities.length,
      richnessScore: evidence.richnessScore,
      qualificationScore: evidenceModule.preGroqQualificationScore(evidence, preflight.score, true),
      failures: evidenceModule.evidenceBundleFailures(evidence),
    });
  }
  return results.sort((left, right) => right.qualificationScore - left.qualificationScore);
}

async function main() {
  const requestShutdown = () => {
    for (const telemetry of activeTelemetry) telemetry.invalidate("process shutdown signal received");
    shutdown.abort();
  };
  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);
  const isolation = assertAppEnvironment();
  if (isolation.mode !== "staging" || isolation.expectedProjectRef !== STAGING_PROJECT_REF) {
    throw new Error("Refusing to run: the canonical environment guard did not confirm staging.");
  }
  const projectRef = isolation.expectedProjectRef;
  const command = process.argv[2] ?? "status";
  if (["replenish", "provider-failure", "telemetry-no-provider", "calibration-startup", "lease-reliability", "funnel-replay", "cleanup", "fixture", "cleanup-lease-safety"].includes(command) &&
      process.env.REPLENISHMENT_PROCESS_TREE_SUPERVISED !== "1") {
    throw new Error("Replenishment must run through npm run staging:soak:safe.");
  }
  let result: unknown;
  if (command === "audit") result = await auditSources();
  else if (command === "inspect") {
    const argumentsAfterCommand = process.argv.slice(3);
    if (argumentsAfterCommand.some((argument) => argument !== "--allow-dirty")) throw new Error("Unsupported inspect argument.");
    result = await stagingInspection(!argumentsAfterCommand.includes("--allow-dirty"));
  }
  else if (command === "cleanup") result = await stagingCleanup(runIdArguments(process.argv.slice(3)));
  else if (command === "fixture") {
    const fixture = fixtureArguments(process.argv.slice(3));
    result = await createControlledFixture(fixture.runIds, fixture.count);
  }
  else if (command === "cleanup-lease-safety") result = await activeLeaseCleanupSafety(runIdArguments(process.argv.slice(3)));
  else if (command === "replenish") result = await replenish(Math.max(1, Number.parseInt(process.argv[3] ?? "1", 10) || 1), projectRef);
  else if (command === "calibration-startup") result = await calibrationStartupValidation();
  else if (command === "lease-reliability") result = await leaseReliabilityValidation(projectRef);
  else if (command === "telemetry-no-provider") result = await noProviderTelemetryValidation(projectRef);
  else if (command === "telemetry-report") result = await reconstructTelemetryReport(process.argv[3]);
  else if (command === "provider-failure") result = await providerFailureCheck();
  else if (command === "models") result = await availableGroqModels();
  else if (command === "probe") result = await probeProvider();
  else if (command === "materials") result = await inspectFirstEvergreenMaterials();
  else if (command === "evidence") result = await auditEvidenceBundles();
  else if (command === "preflight-replay") {
    const { runDeterministicSourcePreflightReplay } = await import("@/lib/news-update");
    const mode = process.argv[3] ?? "critical";
    if (mode !== "critical" && mode !== "low") throw new Error("Preflight replay mode must be critical or low.");
    result = await runDeterministicSourcePreflightReplay(mode);
  }
  else if (command === "preparation-parity") {
    const { runCandidatePreparationParity } = await import("@/lib/news-update");
    result = await runCandidatePreparationParity("critical");
  }
  else if (command === "funnel-replay") {
    const [{ runCandidateFunnelReplay }, { validateCandidateFunnelEvents }] = await Promise.all([
      import("@/lib/news-update"), import("@/lib/replenishment-telemetry"),
    ]);
    const replay = await runCandidateFunnelReplay("critical");
    result = { ...replay, validation: validateCandidateFunnelEvents(replay.funnelEvents),
      artifactPath: persistControlledArtifact("funnel-replay", replay) };
  }
  else if (command === "status") result = await status();
  else throw new Error(`Unknown staging soak command: ${command}`);
  const report = JSON.stringify({ projectRef, command, result }, null, 2);
  writeFileSync(resolve(process.cwd(), ".next", "cache", "staging-soak-report.json"), report, "utf8");
  console.log(report);
  process.removeListener("SIGINT", requestShutdown);
  process.removeListener("SIGTERM", requestShutdown);
}

main().catch((error) => {
  for (const telemetry of activeTelemetry) telemetry.finalize("incomplete", error instanceof Error ? error.name : "uncaught failure");
  console.error(error instanceof Error ? error.message : "Staging soak failed.");
  process.exitCode = 1;
});
