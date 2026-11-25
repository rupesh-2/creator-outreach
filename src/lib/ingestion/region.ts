/**
 * Best-effort creator region + language from public signals. Instagram/TikTok don't expose a creator's country,
 * so we use: post location tags, TikTok's per-video `locationCreated`, place names / flag emoji in the bio,
 * and caption language. Returns null rather than guessing when the signals are weak or conflicting.
 */

export interface RegionGuess {
  country: string | null; // ISO-3166 alpha-2, e.g. "US", "AU"
  evidence: string | null; // human-readable reason, shown in the UI
  language: "en" | "other" | null;
}

export interface RegionInput {
  bio?: string | null;
  displayName?: string | null;
  captions?: (string | null | undefined)[];
  /** Post location tags, e.g. "Manhattan, New York" (one entry per post). */
  locations?: (string | null | undefined)[];
  /** Country codes reported by the platform per post (TikTok `locationCreated`). */
  countryCodes?: (string | null | undefined)[];
}

const US_STATES = [
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "georgia", "hawaii",
  "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan",
  "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey", "new mexico", "new york",
  "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota",
  "tennessee", "texas", "utah", "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming",
];
const US_ABBR = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" ");

/** Patterns per country, checked most-specific first. Each is matched case-insensitively on word boundaries. */
const PLACES: [string, string[]][] = [
  // Disambiguate shared place names before the generic city lists.
  ["CA", ["canada", "british columbia", "alberta", "ontario", "quebec", "québec", "manitoba", "saskatchewan", "nova scotia", "new brunswick", "toronto", "vancouver", "calgary", "montreal", "montréal", "ottawa", "edmonton", "winnipeg"]],
  ["US", ["united states", "usa", "u\\.s\\.a", "america", "nyc", "manhattan", "brooklyn", "queens", "los angeles", "san francisco", "san diego", "chicago", "houston", "dallas", "austin", "miami", "tampa", "orlando", "atlanta", "seattle", "boston", "denver", "phoenix", "las vegas", "philadelphia", "nashville", "detroit", "charlotte", "minneapolis", "salt lake city", "honolulu", "washington dc", "washington, d\\.c", ...US_STATES]],
  ["AU", ["australia", "aussie", "new south wales", "nsw", "queensland", "qld", "western australia", "south australia", "tasmania", "northern territory", "victoria, australia", "vic, australia", "sydney", "melbourne", "brisbane", "perth", "adelaide", "gold coast", "canberra", "hobart", "darwin", "byron bay", "sunshine coast"]],
  ["GB", ["united kingdom", "england", "scotland", "wales", "london", "manchester", "birmingham", "liverpool", "leeds", "glasgow", "edinburgh", "bristol"]],
  ["NZ", ["new zealand", "auckland", "wellington", "christchurch", "queenstown"]],
  ["IE", ["ireland", "dublin", "cork"]],
  ["IN", ["india", "mumbai", "delhi", "bangalore", "bengaluru", "hyderabad", "chennai", "kolkata", "pune"]],
  ["ID", ["indonesia", "jakarta", "bandung", "bali", "surabaya", "yogyakarta"]],
  ["PH", ["philippines", "manila", "cebu"]],
  ["MY", ["malaysia", "kuala lumpur"]],
  ["SG", ["singapore"]],
  ["JP", ["japan", "tokyo", "osaka", "kyoto"]],
  ["TR", ["turkey", "türkiye", "istanbul", "ankara", "izmir"]],
  ["AE", ["dubai", "abu dhabi", "united arab emirates", "uae"]],
  ["BR", ["brazil", "brasil", "são paulo", "sao paulo", "rio de janeiro"]],
  ["MX", ["mexico", "méxico", "cdmx", "guadalajara", "monterrey"]],
  ["ES", ["spain", "españa", "madrid", "barcelona", "bcn", "valencia", "sevilla"]],
  ["VE", ["venezuela", "caracas"]],
  ["CO", ["colombia", "bogotá", "bogota", "medellín", "medellin"]],
  ["AR", ["argentina", "buenos aires"]],
  ["DE", ["germany", "deutschland", "berlin", "munich", "münchen", "hamburg"]],
  ["FR", ["france", "paris", "lyon", "marseille"]],
  ["IT", ["italy", "italia", "rome", "roma", "milan", "milano"]],
  ["NG", ["nigeria", "lagos", "abuja"]],
  ["ZA", ["south africa", "cape town", "johannesburg"]],
  ["PK", ["pakistan", "karachi", "lahore", "islamabad"]],
  ["NP", ["nepal", "kathmandu", "pokhara"]],
];

const FLAGS: Record<string, string> = { "🇺🇸": "US", "🇦🇺": "AU", "🇨🇦": "CA", "🇬🇧": "GB", "🇳🇿": "NZ", "🇮🇪": "IE", "🇮🇳": "IN", "🇮🇩": "ID", "🇵🇭": "PH", "🇲🇾": "MY", "🇸🇬": "SG", "🇯🇵": "JP", "🇹🇷": "TR", "🇦🇪": "AE", "🇧🇷": "BR", "🇲🇽": "MX", "🇪🇸": "ES", "🇻🇪": "VE", "🇨🇴": "CO", "🇦🇷": "AR", "🇩🇪": "DE", "🇫🇷": "FR", "🇮🇹": "IT", "🇳🇬": "NG", "🇿🇦": "ZA", "🇵🇰": "PK", "🇳🇵": "NP" };

const PATTERNS = PLACES.map(([cc, names]) => [cc, new RegExp(`(?<![\\p{L}])(${names.join("|")})(?![\\p{L}])`, "iu")] as const);
const US_ABBR_RE = new RegExp(`,\\s*(${US_ABBR.join("|")})\\b`); // "Austin, TX" (case-sensitive on purpose)

/** Country for one free-text place string, or null. */
export function countryOf(text: string): string | null {
  if (US_ABBR_RE.test(text)) return "US";
  // "Melbourne, Florida" / "Victoria, British Columbia": a state/province/country later in the string wins over a city.
  const parts = text.split(",").map((p) => p.trim()).reverse();
  for (const part of parts) for (const [cc, re] of PATTERNS) if (re.test(part)) return cc;
  return null;
}

const EN_WORDS = new Set(
  "the and to of a in for is my you your with on this it i me we our be are at from how what more get all out up day my your that just not can will have has love new best".split(" "),
);

export function detectLanguage(texts: string[]): "en" | "other" | null {
  const text = texts.join(" ");
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 40) return null;
  const nonLatin = letters.filter((ch) => !/[a-zà-ɏ]/i.test(ch)).length;
  if (nonLatin / letters.length > 0.3) return "other";
  const words = (text.toLowerCase().match(/\p{L}+/gu) ?? []).filter((w) => w.length > 0);
  if (words.length < 15) return null;
  const ratio = words.filter((w) => EN_WORDS.has(w)).length / words.length;
  if (ratio >= 0.1) return "en";
  if (ratio < 0.04) return "other";
  return null;
}

export function inferRegion(input: RegionInput): RegionGuess {
  const score = new Map<string, number>();
  const why = new Map<string, string[]>();
  const add = (cc: string, pts: number, reason: string) => {
    score.set(cc, (score.get(cc) ?? 0) + pts);
    why.set(cc, [...(why.get(cc) ?? []), reason]);
  };

  // Post location tags: 2 points per tagged post; summarise repeats.
  const tagCounts = new Map<string, { cc: string; n: number }>();
  for (const loc of input.locations ?? []) {
    if (!loc) continue;
    const cc = countryOf(loc);
    if (!cc) continue;
    const t = tagCounts.get(loc) ?? { cc, n: 0 };
    t.n++;
    tagCounts.set(loc, t);
  }
  for (const [loc, { cc, n }] of tagCounts) add(cc, 2 * n, `posts tagged “${loc}”${n > 1 ? ` ×${n}` : ""}`);

  const platformCodes = new Map<string, number>();
  for (const c of input.countryCodes ?? []) if (c && /^[A-Z]{2}$/i.test(c)) platformCodes.set(c.toUpperCase(), (platformCodes.get(c.toUpperCase()) ?? 0) + 1);
  for (const [cc, n] of platformCodes) add(cc, 2 * n, `${n} video${n > 1 ? "s" : ""} posted from ${cc}`);

  const bio = [input.bio, input.displayName].filter(Boolean).join(" ");
  for (const [flag, cc] of Object.entries(FLAGS)) if (bio.includes(flag)) add(cc, 3, `${flag} in bio`);
  const bioCountry = bio ? countryOf(bio) : null;
  if (bioCountry) add(bioCountry, 3, "place named in bio");

  const language = detectLanguage([bio, ...(input.captions ?? []).filter((c): c is string => !!c).slice(0, 12)]);
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  // Need a real signal and a clear winner; otherwise say "unknown" rather than guess.
  if (!top || top[1] < 2 || (second && top[1] < second[1] * 1.5)) return { country: null, evidence: null, language };
  return { country: top[0], evidence: (why.get(top[0]) ?? []).slice(0, 3).join("; "), language };
}

/**
 * Whether a creator is in scope for automatic analysis/drafting. No targets = everyone.
 * Unknown country is allowed only when the content is in English (could still be US/AU).
 */
export function inTargetRegion(c: { country?: string | null; language?: string | null }, targets: string[]): boolean {
  if (!targets.length) return true;
  if (c.country) return targets.includes(c.country);
  return c.language === "en";
}
