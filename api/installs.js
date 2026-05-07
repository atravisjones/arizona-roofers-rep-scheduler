/**
 * Installs endpoint - returns scheduled/in-progress installs with crew info
 * Queries Supabase directly: calendar_events (production) + jobs table
 *
 * GET /api/installs?date=YYYY-MM-DD (defaults to today in America/Phoenix timezone)
 * Returns: { success: true, date, installs: [...] }
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SUPABASE_URL = process.env.KPI_SUPABASE_URL || 'https://ucfqgkbkxbztxlyniuph.supabase.co';
  const SUPABASE_KEY = process.env.KPI_SUPABASE_ANON_KEY || '';

  if (!SUPABASE_KEY) {
    console.error('KPI_SUPABASE_ANON_KEY not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    // Get requested date (defaults to today in Phoenix timezone)
    let requestedDate = req.query.date;
    if (!requestedDate) {
      const phoenixDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' }));
      requestedDate = phoenixDate.toISOString().split('T')[0];
    }

    const nextDay = new Date(requestedDate + 'T00:00:00');
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDayStr = nextDay.toISOString().split('T')[0];

    const sbHeaders = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    };

    // 1. Fetch production + pickups_and_dropoffs calendar events for the requested date
    const evtParams = new URLSearchParams({
      select: 'event_id,job_id,title,start_date,end_date,category,attendees',
      'category': 'in.(production,pickups_and_dropoffs)',
      'start_date': `gte.${requestedDate} 00:00:00`,
      'start_date': `lt.${nextDayStr} 00:00:00`,
      'order': 'start_date.asc',
    });
    // URLSearchParams overwrites duplicate keys, so build manually
    const evtUrl = `${SUPABASE_URL}/rest/v1/calendar_events?select=event_id,job_id,title,start_date,end_date,category,attendees&category=in.(production,pickups_and_dropoffs)&start_date=gte.${encodeURIComponent(requestedDate + ' 00:00:00')}&start_date=lt.${encodeURIComponent(nextDayStr + ' 00:00:00')}&order=start_date.asc`;

    const evtResp = await fetch(evtUrl, { headers: sbHeaders });
    if (!evtResp.ok) {
      console.error(`Supabase calendar_events query failed: ${evtResp.status}`);
      return res.status(502).json({ error: 'Failed to fetch calendar events' });
    }
    const events = await evtResp.json();

    if (events.length === 0) {
      return res.status(200).json({ success: true, date: requestedDate, installs: [] });
    }

    // 2. Get unique job IDs and fetch job details
    const jobIds = [...new Set(events.map(e => e.job_id).filter(Boolean))];
    const jobMap = {};

    // Batch in chunks of 200
    for (let i = 0; i < jobIds.length; i += 200) {
      const chunk = jobIds.slice(i, i + 200);
      const jobUrl = `${SUPABASE_URL}/rest/v1/jobs?select=job_id,customer,name,address,stage,stage_category,job_owner,value,tags&job_id=in.(${chunk.join(',')})`;
      const jobResp = await fetch(jobUrl, { headers: sbHeaders });
      if (jobResp.ok) {
        const jobs = await jobResp.json();
        for (const j of jobs) jobMap[j.job_id] = j;
      }
    }

    // Parse city from address
    const parseCity = (address) => {
      if (!address) return '';
      const parts = address.split(',').map(p => p.trim());
      if (parts.length >= 3) return parts[parts.length - 2].replace(/\s+AZ\s*\d*/i, '').trim();
      if (parts.length === 2) return parts[1].replace(/\s*AZ\s*\d*/i, '').trim();
      return '';
    };

    // 3. Build installs list — production events create entries, pickups merge crew names
    const installMap = new Map();

    // First pass: create entries from production events
    for (const evt of events) {
      if (evt.category !== 'production') continue;
      const job = jobMap[evt.job_id];
      if (!job) continue;

      const key = evt.job_id;
      if (!installMap.has(key)) {
        installMap.set(key, {
          jobId: evt.job_id,
          customerName: job.customer || job.name || '',
          address: job.address || '',
          city: parseCity(job.address),
          stage: job.stage || '',
          jobOwner: job.job_owner || '',
          value: job.value || null,
          crewNames: [],
          scheduledDate: requestedDate,
          startTime: evt.start_date || null,
          endTime: evt.end_date || null,
          category: 'production',
        });
      }
    }

    // Second pass: resolve attendee IDs to job_owner names (attendees are numeric Roofr user IDs)
    // For now, use job_owner as the primary crew identifier
    for (const install of installMap.values()) {
      if (install.jobOwner && !install.crewNames.includes(install.jobOwner)) {
        install.crewNames.push(install.jobOwner);
      }
    }

    const installs = Array.from(installMap.values());

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    return res.status(200).json({
      success: true,
      date: requestedDate,
      installs,
    });

  } catch (error) {
    console.error('Failed to fetch installs:', error);
    return res.status(502).json({ error: 'Failed to process installs data' });
  }
}
