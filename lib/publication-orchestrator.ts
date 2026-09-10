export type CycleOperation<T> = () => Promise<T>;

// Publication and replenishment deliberately have separate failure domains.
// Publication always runs first and replenishment cannot roll it back.
export async function executeSeparatedCycle<TPublication, TReplenishment>(
  publish: CycleOperation<TPublication>,
  replenish: CycleOperation<TReplenishment>,
  retryEmptyPublication = false
) {
  let publication: TPublication | null = null;
  let publicationError: unknown = null;
  try {
    publication = await publish();
  } catch (error) {
    publicationError = error;
  }

  let replenishment: TReplenishment | null = null;
  let replenishmentError: unknown = null;
  try {
    replenishment = await replenish();
  } catch (error) {
    replenishmentError = error;
  }

  // Preserve the publish-first failure boundary, then let content prepared by
  // this cycle fill an empty slot immediately. The database slot key keeps the
  // retry idempotent when another trigger filled the slot concurrently.
  if (retryEmptyPublication && publication === null && !publicationError && !replenishmentError) {
    try {
      publication = await publish();
    } catch (error) {
      publicationError = error;
    }
  }

  return { publication, publicationError, replenishment, replenishmentError };
}
