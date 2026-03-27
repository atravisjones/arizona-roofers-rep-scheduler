/**
 * Installs endpoint - returns scheduled/in-progress installs with crew info
 * Filters roofr-search /api/data for install jobs and cross-references calendar data
 *
 * GET /api/installs?date=YYYY-MM-DD (defaults to today in America/Phoenix timezone)
 * Returns: { success: true, date, installs: [...] }
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
    // Get requested date (defaults to today in Phoenix timezone)
    let requestedDate = req.query.date;
    if (!requestedDate) {
      const phoenixDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' }));
      requestedDate = phoenixDate.toISOString().split('T')[0];
    }

    // Fetch all job data from roofr-search
    const dataResponse = await fetch('https://roofr-search.vercel.app/api/data', {
      headers: { 'X-Internal-Key': apiKey },
    });

    if (!dataResponse.ok) {
      console.error(`roofr-search /api/data returned ${dataResponse.status}`);
      return res.status(502).json({ error: 'Failed to fetch job data' });
    }

    const dataPayload = await dataResponse.json();
    if (!dataPayload.success || !dataPayload.rows) {
      return res.status(502).json({ error: 'Invalid response from roofr-search' });
    }

    // Fetch calendar/crew data
    const calendarResponse = await fetch('https://roofr-search.vercel.app/api/calendar-summary', {
      headers: { 'X-Internal-Key': apiKey },
    });

    // calendar-summary returns { success, summary: { jobId: { title, date, attendees, category } } }
    let calendarMap = {};
    if (calendarResponse.ok) {
      const calendarPayload = await calendarResponse.json();
      calendarMap = calendarPayload.success && calendarPayload.summary ? calendarPayload.summary : {};
    }

    // Parse city from address like "5825 East Nora Street, Mesa, AZ 85215"
    const parseCity = (address) => {
      if (!address) return '';
      const parts = address.split(',').map(p => p.trim());
      // City is typically the second-to-last part (before "AZ XXXXX")
      if (parts.length >= 3) return parts[parts.length - 2].replace(/\s+AZ\s*\d*/i, '').trim();
      if (parts.length === 2) return parts[1].replace(/\s*AZ\s*\d*/i, '').trim();
      return '';
    };

    // Rows are dictionaries keyed by column name (e.g., row['Stage'], row['Job ID'])
    const installs = [];
    dataPayload.rows.forEach((row) => {
      const stage = (row['Stage'] || '').toLowerCase();
      const stageMatch = stage.includes('install scheduled') || stage.includes('build in progress');

      if (stageMatch) {
        const jobId = row['Job ID'] || null;
        const customerName = row['Customer'] || '';
        const address = row['Address'] || '';
        const value = row['Value'] || null;
        const jobOwner = row['Job owner'] || '';
        const city = parseCity(address);

        // Look up calendar entry for crew info
        const calendarEntry = jobId ? calendarMap[jobId] : null;

        // Filter: only include installs with a calendar event on the requested date
        // Stage already confirms these are install jobs (Install Scheduled / Build In Progress)
        // Calendar event must match the date — category "production" or title containing "install"
        if (!calendarEntry) return; // Skip jobs without calendar events
        const eventDate = calendarEntry.date || '';
        if (eventDate !== requestedDate) return; // Must match the requested date

        const crewNames = calendarEntry.attendees
          ? calendarEntry.attendees.split(',').map(name => name.trim())
          : [];

        installs.push({
          jobId,
          customerName,
          address,
          city,
          stage: row['Stage'] || '',
          jobOwner,
          value,
          crewNames,
          scheduledDate: calendarEntry.date || null,
          startTime: calendarEntry.startTime || null,
          endTime: calendarEntry.endTime || null,
          category: calendarEntry.category || null,
        });
      }
    });

    // Debug info: show calendar matches for install-stage jobs
    const debug = req.query.debug === '1';
    const debugInfo = [];
    if (debug) {
      dataPayload.rows.forEach((row) => {
        const stage = (row['Stage'] || '').toLowerCase();
        if (stage.includes('install scheduled') || stage.includes('build in progress')) {
          const jobId = row['Job ID'] || null;
          const calEntry = jobId ? calendarMap[jobId] : null;
          debugInfo.push({
            jobId,
            customer: row['Customer'] || '',
            stage: row['Stage'],
            hasCalendar: !!calEntry,
            calendarDate: calEntry?.date || null,
            calendarCategory: calEntry?.category || null,
            calendarTitle: calEntry?.title || null,
          });
        }
      });
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    const response = {
      success: true,
      date: requestedDate,
      installs,
    };
    if (debug) {
      response.calendarMapSize = Object.keys(calendarMap).length;
      response.debugInstallStageJobs = debugInfo;
    }
    return res.status(200).json(response);

  } catch (error) {
    console.error('Failed to fetch installs:', error);
    return res.status(502).json({ error: 'Failed to process installs data' });
  }
}
