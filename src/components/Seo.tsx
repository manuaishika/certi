import { Helmet } from 'react-helmet-async'

/** Per-page <title>, description, Open Graph and optional Schema.org JSON-LD. */
export function Seo({ title, description, image, url, jsonLd }: { title: string; description?: string; image?: string; url?: string; jsonLd?: object }) {
  return (
    <Helmet>
      <title>{title}</title>
      {description && <meta name="description" content={description} />}
      <meta property="og:title" content={title} />
      {description && <meta property="og:description" content={description} />}
      {image && <meta property="og:image" content={image} />}
      {url && <meta property="og:url" content={url} />}
      <meta name="twitter:card" content={image ? 'summary_large_image' : 'summary'} />
      {jsonLd && <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>}
    </Helmet>)
}
