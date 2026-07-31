/**
 * Meta descriptions.
 *
 * Every route in this app set a `<title>` and none of them set a description,
 * which cost the SEO category four points and failed the budget on every run
 * since the repository was created. A storefront without meta descriptions
 * hands Google the job of inventing its own search snippets, which is a real
 * commercial cost and not a lint nit.
 *
 * Descriptions are trimmed to 155 characters — past roughly that, search
 * results truncate and the tail is wasted.
 */

const MAX = 155;

const FALLBACK =
  'A headless Shopify storefront built on Hydrogen and React Router, running on the Oxygen worker runtime.';

function clean(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  // Collection and product copy arrives with newlines and runs of whitespace;
  // both look like padding inside a search snippet.
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > MAX ? `${text.slice(0, MAX - 1).trimEnd()}…` : text;
}

/**
 * Builds the meta array for a route. Pass the copy the API already returns
 * where there is any; `fallback` is for the routes that have none of their own.
 */
export function pageMeta({
  title,
  description,
  fallback,
}: {
  title: string;
  description?: string | null;
  fallback?: string;
}) {
  return [
    {title},
    {
      name: 'description',
      content: clean(description) ?? clean(fallback) ?? FALLBACK,
    },
  ];
}
