import {ServerRouter} from 'react-router';
import {isbot} from 'isbot';
import {renderToReadableStream} from 'react-dom/server';
import {
  createContentSecurityPolicy,
  type HydrogenRouterContextProvider,
} from '@shopify/hydrogen';
import type {EntryContext} from 'react-router';

/**
 * How long a deferred loader promise may stay pending before React Router
 * aborts the stream. Every route here defers its below-fold queries, and an
 * abort is not a degraded section — it fails the whole document with
 * `Server Timeout`, which is a 500 the visitor sees instead of a page.
 *
 * React Router defaults to 4950 ms. mock.shop is a shared public mock with no
 * uptime commitment and its cold starts have been measured here at over 12
 * seconds, so that default turns a slow upstream into an outage. Raised to sit
 * under Oxygen's own 30 s request ceiling.
 *
 * A real storefront should lower this. A number this high is a statement about
 * how much latency the upstream is allowed to have, and 20 seconds is not an
 * acceptable answer when the Storefront API is behind a real shop.
 */
export const streamTimeout = 20_000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext,
  context: HydrogenRouterContextProvider,
) {
  const {nonce, header, NonceProvider} = createContentSecurityPolicy({
    shop: {
      checkoutDomain: context.env.PUBLIC_CHECKOUT_DOMAIN,
      storeDomain: context.env.PUBLIC_STORE_DOMAIN,
    },
  });

  const body = await renderToReadableStream(
    <NonceProvider>
      <ServerRouter
        context={reactRouterContext}
        url={request.url}
        nonce={nonce}
      />
    </NonceProvider>,
    {
      nonce,
      signal: request.signal,
      onError(error) {
        console.error(error);
        responseStatusCode = 500;
      },
    },
  );

  if (isbot(request.headers.get('user-agent'))) {
    await body.allReady;
  }

  responseHeaders.set('Content-Type', 'text/html');
  responseHeaders.set('Content-Security-Policy', header);

  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
