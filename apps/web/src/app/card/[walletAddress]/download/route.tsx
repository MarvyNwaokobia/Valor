import { renderCardImage } from '../cardImage'

/**
 * GET /card/:wallet/download — the card as a PNG file, not a page.
 *
 * Same picture as the link preview (see ../cardImage), served with a
 * Content-Disposition so the browser saves it instead of rendering it. That is
 * what makes it postable to X: a player downloads their card and attaches it,
 * rather than screenshotting a phone UI with a status bar across the top.
 *
 * A route handler rather than a client-side canvas render on purpose — no extra
 * dependency, no fonts-and-CORS problems rasterising the live DOM, and the file
 * is identical to what everyone else sees when the link unfurls.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ walletAddress: string }> },
) {
  const { walletAddress } = await params
  const image = await renderCardImage(walletAddress)

  const filename = `valor-${walletAddress.slice(0, 10).toLowerCase()}.png`
  const headers = new Headers(image.headers)
  headers.set('Content-Disposition', `attachment; filename="${filename}"`)
  // The card changes as the player plays, so a cached copy would hand someone a
  // stale record. Short cache keeps repeat taps cheap without freezing it.
  headers.set('Cache-Control', 'public, max-age=60')

  return new Response(image.body, { status: image.status, headers })
}
