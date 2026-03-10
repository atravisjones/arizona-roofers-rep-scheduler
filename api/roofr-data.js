/**
 * Proxy endpoint for roofr-search API.
 * Fetches all Roofr job data server-side using INTERNAL_API_KEY,
 * so the key is never exposed to the browser.
 *
 * Cached at CDN level for 5 minutes (s-maxage=300).
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ROOFR_SEARCH_API_KEY;
  if (!apiKey) {
    console.error('ROOFR_SEARCH_API_KEY not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const response = await fetch('https://roofr-search.vercel.app/api/data', {
      headers: { 'X-Internal-Key': apiKey },
    });

    if (!response.ok) {
      console.error(`roofr-search API returned ${response.status}`);
      return res.status(502).json({ error: 'Upstream API error' });
    }

    const data = await response.json();

    // Cache at Vercel CDN for 5 min, allow stale for 60s while revalidating
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
    return res.status(200).json(data);
  } catch (error) {
    console.error('Failed to fetch from roofr-search:', error);
    return res.status(502).json({ error: 'Failed to reach upstream API' });
  }
}
