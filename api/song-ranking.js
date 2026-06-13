import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'POST') {
      const { userName, lrcPath, accuracy, correct, miss, speed } = req.body;

      if (!userName || !lrcPath) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      await sql`
        INSERT INTO song_rankings (user_name, lrc_path, accuracy, correct, miss, speed)
        VALUES (${userName}, ${lrcPath}, ${accuracy}, ${correct}, ${miss}, ${speed});
      `;

      // Return the updated ranking
      const result = await sql`
        SELECT user_name as "userName", accuracy, correct, miss, speed, created_at as "date"
        FROM song_rankings
        WHERE lrc_path = ${lrcPath}
        ORDER BY accuracy DESC, correct DESC, miss ASC, speed DESC
        LIMIT 10;
      `;
      return res.status(200).json(result.rows);
    }

    if (req.method === 'GET') {
      const { lrcPath } = req.query;

      if (!lrcPath) {
        return res.status(400).json({ error: 'Missing lrcPath' });
      }

      const result = await sql`
        SELECT user_name as "userName", accuracy, correct, miss, speed, created_at as "date"
        FROM song_rankings
        WHERE lrc_path = ${lrcPath}
        ORDER BY accuracy DESC, correct DESC, miss ASC, speed DESC
        LIMIT 10;
      `;

      return res.status(200).json(result.rows);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('API Error in song-ranking:', error);
    return res.status(500).json({ error: error.message });
  }
}
