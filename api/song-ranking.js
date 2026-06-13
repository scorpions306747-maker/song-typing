import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const client = await pool.connect();

    if (req.method === 'POST') {
      const { userName, lrcPath, accuracy, correct, miss, speed } = req.body;

      if (!userName || !lrcPath) {
        client.release();
        return res.status(400).json({ error: 'Missing required fields' });
      }

      await client.query(
        'INSERT INTO song_rankings (user_name, lrc_path, accuracy, correct, miss, speed) VALUES ($1, $2, $3, $4, $5, $6)',
        [userName, lrcPath, accuracy, correct, miss, speed]
      );

      const result = await client.query(
        'SELECT user_name as "userName", accuracy, correct, miss, speed, created_at as "date" FROM song_rankings WHERE lrc_path = $1 ORDER BY accuracy DESC, correct DESC, miss ASC, speed DESC LIMIT 10',
        [lrcPath]
      );
      
      client.release();
      return res.status(200).json(result.rows);
    }

    if (req.method === 'GET') {
      const { lrcPath } = req.query;

      if (!lrcPath) {
        client.release();
        return res.status(400).json({ error: 'Missing lrcPath' });
      }

      const result = await client.query(
        'SELECT user_name as "userName", accuracy, correct, miss, speed, created_at as "date" FROM song_rankings WHERE lrc_path = $1 ORDER BY accuracy DESC, correct DESC, miss ASC, speed DESC LIMIT 10',
        [lrcPath]
      );

      client.release();
      return res.status(200).json(result.rows);
    }

    client.release();
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('API Error in song-ranking:', error);
    return res.status(500).json({ error: error.message });
  }
}
