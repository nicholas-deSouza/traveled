// Whole words avoid rejecting names such as Scunthorpe or Dickson. Normalize
// accents and separators before checking explicit language.
const explicitLanguage = /(?:^|[^a-z])(?:f+u+c+k+(?:er|ers|ing|ed|s)?|motherfucker(?:s)?|s+h+i+t+(?:ty|s)?|bullshit|bitch(?:es)?|asshole(?:s)?|cunt(?:s)?|cock(?:s)?|dick\s*head(?:s)?|pussy|porn(?:ography)?|nigg(?:er|a)s?|fagg?ot(?:s)?|sex\s+with\s+children)(?=$|[^a-z])/i;

export function displayName(value: string): string {
  const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!name || Array.from(name).length > 80 || !/^[\p{L}\p{M}][\p{L}\p{M} .’'-]*$/u.test(name)) {
    throw new Error('Enter a name of 1–80 characters using letters, spaces, apostrophes, periods, or hyphens.');
  }
  const normalized = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  // Also match explicit words deliberately split into individual letters.
  const unspelled = normalized.replace(/\b(?:[a-z][ .-]+){2,}[a-z]\b/g, word => word.replace(/[ .-]/g, ''));
  if (explicitLanguage.test(normalized) || explicitLanguage.test(unspelled)) {
    throw new Error('Choose a name without explicit words or phrases.');
  }
  return name;
}
