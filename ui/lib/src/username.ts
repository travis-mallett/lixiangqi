// Keep the account character repertoire in sync with core/UsernameRules.scala and mobile username.dart.
/* oxlint-disable no-inferrable-types */
export const hanCharacters: string = String.raw`\u{3007}\u{3400}-\u{4DBF}\u{4E00}-\u{9FFF}\u{20000}-\u{2A6DF}\u{2A700}-\u{2B73F}\u{2B740}-\u{2B81F}\u{2B820}-\u{2CEAF}\u{2CEB0}-\u{2EBEF}\u{2EBF0}-\u{2EE5F}\u{30000}-\u{3134F}\u{31350}-\u{323AF}`;
export const usernameCharacters: string = `a-zA-Z0-9_${hanCharacters}-`;
export const usernamePattern: RegExp = new RegExp(`^[${usernameCharacters}]{2,30}$`, 'u');
export const usernameSearchPattern: RegExp = usernamePattern;
export const usernameCompletionPattern: RegExp = new RegExp(`(^|\\s)@([${usernameCharacters}]{1,30})$`, 'u');
export const usernameMentionPattern: RegExp = new RegExp(
  String.raw`(^|[^\w@#/\[])@([${usernameCharacters}]{2,30})(?![@${usernameCharacters}]|\.\w)`,
  'gu',
);
export const userProfilePath = (name: string): string => '/@/' + encodeURIComponent(name);

// URL paths are encoded; account IDs, mentions and form bodies contain the actual name.
export function userProfileName(
  href: string | null | undefined,
  origin: string = window.location.origin,
): string | undefined {
  if (!href) return;
  try {
    const url = new URL(href, origin);
    if (url.origin !== origin || url.search || url.hash) return;
    const match = /^\/@\/([^/]+)$/.exec(url.pathname);
    if (!match) return;
    const name = decodeURIComponent(match[1]);
    if (usernamePattern.test(name)) return name;
  } catch {
    // Invalid URLs and malformed escapes are not profile links.
  }
  return undefined;
}

export const mentionsUser = (text: string, id: string): boolean =>
  [...text.matchAll(usernameMentionPattern)].some(match => match[2].toLowerCase() === id.toLowerCase());
