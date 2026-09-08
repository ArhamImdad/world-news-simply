export type CycleOperation<T> = () => Promise<T>;

// Publication and replenishment deliberately have separate failure domains.
// Publication always runs first and replenishment cannot roll it back.
export async function executeSeparatedCycle<TPublication, TReplenishment>(
  publish: CycleOperation<TPublication>,
  replenish: CycleOperation<TReplenishment>
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

  return { publication, publicationError, replenishment, replenishmentError };
}
