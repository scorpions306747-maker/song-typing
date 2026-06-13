import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'POST') {
      const { userName, stageId, gameMode, score, time, accuracy, endlessLevel } = req.body;

      if (!userName || !stageId || !gameMode) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      await sql`
        INSERT INTO mole_rankings (user_name, stage_id, game_mode, score, time, accuracy, endless_level)
        VALUES (${userName}, ${stageId}, ${gameMode}, ${score}, ${time}, ${accuracy}, ${endlessLevel});
      `;

      return res.status(200).json({ success: true });
    } 
    
    if (req.method === 'GET') {
      const { stageId, gameMode } = req.query;

      if (!stageId || !gameMode) {
        return res.status(400).json({ error: 'Missing stageId or gameMode' });
      }

      let result;
      if (gameMode === 'timeAttack' || gameMode === 'atoz') {
        // タイムアタック系はタイムが短い順
        result = await sql`
          SELECT user_name as "userName", score, time, accuracy, endless_level as "endlessLevel"
          FROM mole_rankings
          WHERE stage_id = ${stageId} AND game_mode = ${gameMode}
          ORDER BY time ASC, accuracy DESC
          LIMIT 10;
        `;
      } else if (stageId === 'endless') {
        // エンドレスは到達レベルが多い順
        result = await sql`
          SELECT user_name as "userName", score, time, accuracy, endless_level as "endlessLevel"
          FROM mole_rankings
          WHERE stage_id = ${stageId} AND game_mode = ${gameMode}
          ORDER BY endless_level DESC, score DESC
          LIMIT 10;
        `;
      } else {
        // 通常はスコアが高い順
        result = await sql`
          SELECT user_name as "userName", score, time, accuracy, endless_level as "endlessLevel"
          FROM mole_rankings
          WHERE stage_id = ${stageId} AND game_mode = ${gameMode}
          ORDER BY score DESC, accuracy DESC
          LIMIT 10;
        `;
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

      return res.status(200).json(formatted);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('API Error in mole-ranking:', error);
    return res.status(500).json({ error: error.message });
  }
}
