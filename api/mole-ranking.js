import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const client = await pool.connect();

    if (req.method === 'POST') {
      const { userName, stageId, gameMode, score, time, accuracy, endlessLevel } = req.body;

      if (!userName || !stageId || !gameMode) {
        client.release();
        return res.status(400).json({ error: 'Missing required fields' });
      }

      await client.query(
        'INSERT INTO mole_rankings (user_name, stage_id, game_mode, score, time, accuracy, endless_level) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [userName, stageId, gameMode, score, time, accuracy, endlessLevel]
      );

      client.release();
      return res.status(200).json({ success: true });
    } 
    
    if (req.method === 'GET') {
      const { stageId, gameMode } = req.query;

      if (!stageId || !gameMode) {
        client.release();
        return res.status(400).json({ error: 'Missing stageId or gameMode' });
      }

      let result;
      if (gameMode === 'timeAttack' || gameMode === 'atoz') {
        result = await client.query(
          'SELECT user_name as "userName", score, time, accuracy, endless_level as "endlessLevel" FROM mole_rankings WHERE stage_id = $1 AND game_mode = $2 ORDER BY time ASC, accuracy DESC LIMIT 10',
          [stageId, gameMode]
        );
      } else if (stageId === 'endless') {
        result = await client.query(
          'SELECT user_name as "userName", score, time, accuracy, endless_level as "endlessLevel" FROM mole_rankings WHERE stage_id = $1 AND game_mode = $2 ORDER BY endless_level DESC, score DESC LIMIT 10',
          [stageId, gameMode]
        );
      } else {
        result = await client.query(
          'SELECT user_name as "userName", score, time, accuracy, endless_level as "endlessLevel" FROM mole_rankings WHERE stage_id = $1 AND game_mode = $2 ORDER BY score DESC, accuracy DESC LIMIT 10',
          [stageId, gameMode]
        );
      }

      const formatted = result.rows.map(r => ({
        userName: r.userName,
        score: r.score,
        time: r.time,
        accuracy: r.accuracy,
        endlessLevel: r.endlessLevel,
        isTimeAttack: gameMode === 'timeAttack' || gameMode === 'atoz',
        isEndless: stageId === 'endless'
      }));

      client.release();
      return res.status(200).json(formatted);
    }

    client.release();
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('API Error in mole-ranking:', error);
    return res.status(500).json({ error: error.message });
  }
}
