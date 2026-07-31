import {Await, useLoaderData, Link} from 'react-router';
import {pageMeta} from '~/lib/seo';
import type {Route} from './+types/_index';
import {Suspense} from 'react';
import {Image} from '@shopify/hydrogen';
import type {
  FeaturedCollectionFragment,
  RecommendedProductsQuery,
} from 'storefrontapi.generated';
import {ProductItem} from '~/components/ProductItem';
import {MockShopNotice} from '~/components/MockShopNotice';
import {perfTraits, resolvePerfMode, type PerfTraits} from '~/lib/perf-mode';

export const meta: Route.MetaFunction = () => {
  return pageMeta({
    title: 'Hydrogen | Home',
    fallback:
      'Shop the featured collection and recommended products, served from the edge by a headless Hydrogen storefront.',
  });
};

export async function loader(args: Route.LoaderArgs) {
  // Start fetching non-critical data without blocking time to first byte
  const deferredData = loadDeferredData(args);

  // Await the critical data required to render initial state of the page
  const criticalData = await loadCriticalData(args);

  return {...deferredData, ...criticalData};
}

/**
 * Load data necessary for rendering content above the fold. This is the critical data
 * needed to render the page. If it's unavailable, the whole page should 400 or 500 error.
 */
async function loadCriticalData({context}: Route.LoaderArgs) {
  const {storefront, env} = context;
  const traits = perfTraits(resolvePerfMode(env.PERF_MODE));

  const [{collections}] = await Promise.all([
    storefront.query(FEATURED_COLLECTION_QUERY, {
      cache: traits.cacheStorefrontQueries
        ? storefront.CacheShort()
        : storefront.CacheNone(),
    }),
    // Add other queries here, so that they are loaded in parallel
  ]);

  return {
    isShopLinked: Boolean(env.PUBLIC_STORE_DOMAIN),
    featuredCollection: collections.nodes[0],
    traits,
  };
}

/**
 * Load data for rendering content below the fold. This data is deferred and will be
 * fetched after the initial page load. If it's unavailable, the page should still 200.
 * Make sure to not throw any errors here, as it will cause the page to 500.
 */
function loadDeferredData({context}: Route.LoaderArgs) {
  const recommendedProducts = context.storefront
    .query(RECOMMENDED_PRODUCTS_QUERY)
    .catch((error: Error) => {
      // Log query errors, but don't throw them so the page can still render
      console.error(error);
      return null;
    });

  return {
    recommendedProducts,
  };
}

export default function Homepage() {
  const data = useLoaderData<typeof loader>();
  return (
    <div className="home">
      {data.isShopLinked ? null : <MockShopNotice />}
      <FeaturedCollection
        collection={data.featuredCollection}
        traits={data.traits}
      />
      <RecommendedProducts
        products={data.recommendedProducts}
        traits={data.traits}
      />
    </div>
  );
}

/** Candidate widths, matching what Hydrogen's <Image> would generate. */
const HERO_WIDTHS = [400, 600, 800, 1000, 1200, 1600, 2000];

function heroSrcSet(url: string) {
  const separator = url.includes('?') ? '&' : '?';
  return HERO_WIDTHS.map((w) => `${url}${separator}width=${w} ${w}w`).join(', ');
}

/**
 * The hero image is the LCP element on this page, so it carries every image
 * lever the two perf modes differ on.
 */
function FeaturedCollection({
  collection,
  traits,
}: {
  collection: FeaturedCollectionFragment;
  traits: PerfTraits;
}) {
  if (!collection) return null;
  const image = collection?.image;
  return (
    <Link
      className="featured-collection"
      to={`/collections/${collection.handle}`}
    >
      {image && (
        <div className="featured-collection-image">
          {traits.reserveImageAspectRatio ? (
            <Image
              data={image}
              sizes={traits.heroSizes}
              loading={traits.heroLoading}
              fetchPriority={traits.heroFetchPriority}
              aspectRatio="1/1"
              alt={image.altText || collection.title}
            />
          ) : (
            /*
             * The bare <img> an unoptimised theme emits: a srcset, but no
             * width, height, or aspect ratio anywhere. Hydrogen's <Image>
             * cannot express this — it always writes intrinsic dimensions,
             * which is the whole point of using it — so the baseline has to
             * hand-roll the tag to reproduce the shift.
             */
            <img
              src={image.url}
              srcSet={heroSrcSet(image.url)}
              sizes={traits.heroSizes}
              loading={traits.heroLoading}
              fetchPriority={traits.heroFetchPriority}
              alt={image.altText || collection.title}
            />
          )}
        </div>
      )}
      <h1>{collection.title}</h1>
    </Link>
  );
}

function RecommendedProducts({
  products,
  traits,
}: {
  products: Promise<RecommendedProductsQuery | null>;
  traits: PerfTraits;
}) {
  return (
    <section
      className="recommended-products"
      aria-labelledby="recommended-products"
    >
      <h2 id="recommended-products">Recommended Products</h2>
      <Suspense fallback={<div>Loading...</div>}>
        <Await resolve={products}>
          {(response) => (
            <div className="recommended-products-grid">
              {response
                ? response.products.nodes.map((product) => (
                    <ProductItem
                      key={product.id}
                      product={product}
                      sizes={traits.gridSizes}
                    />
                  ))
                : null}
            </div>
          )}
        </Await>
      </Suspense>
      <br />
    </section>
  );
}

const FEATURED_COLLECTION_QUERY = `#graphql
  fragment FeaturedCollection on Collection {
    id
    title
    image {
      id
      url
      altText
      width
      height
    }
    handle
  }
  query FeaturedCollection($country: CountryCode, $language: LanguageCode)
    @inContext(country: $country, language: $language) {
    collections(first: 1, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        ...FeaturedCollection
      }
    }
  }
` as const;

const RECOMMENDED_PRODUCTS_QUERY = `#graphql
  fragment RecommendedProduct on Product {
    id
    title
    handle
    priceRange {
      minVariantPrice {
        amount
        currencyCode
      }
    }
    featuredImage {
      id
      url
      altText
      width
      height
    }
  }
  query RecommendedProducts ($country: CountryCode, $language: LanguageCode)
    @inContext(country: $country, language: $language) {
    products(first: 4, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        ...RecommendedProduct
      }
    }
  }
` as const;
