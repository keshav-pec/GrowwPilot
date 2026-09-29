// Makes user input safe to use inside a regular expression ("a.b" should match a dot, not any character)
export function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
