export function selectNormalPreparedCandidates<T extends {
  discoveryRank: number;
  disposition: "eligible" | "rejected";
  qualificationScore: number | null;
}>(assessments: T[], limit: number) {
  const ordered = [...assessments].sort((left, right) =>
    (right.qualificationScore ?? -1) - (left.qualificationScore ?? -1) || left.discoveryRank - right.discoveryRank);
  const eligible = ordered.filter((candidate) => candidate.disposition === "eligible");
  const rejected = ordered.filter((candidate) => candidate.disposition === "rejected");
  return [...eligible, ...rejected.slice(0, Math.max(0, limit - eligible.length))];
}
