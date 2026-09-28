// [] -> "All branches", [id1, id2] -> "Andheri, Bandra"
export function branchLabel(branchIds, branches = []) {
  if (!branchIds?.length) return 'All branches';
  return branchIds.map((id) => branches.find((b) => b._id === id)?.name ?? 'Archived branch').join(', ');
}
