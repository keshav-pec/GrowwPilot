// "1 photo", "3 photos"
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
