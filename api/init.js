import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

export default async function handler(req, res) {
  try {
    const client = await pool.connect();
    
    // もぐら練習用のランキングテーブル
    await client.query(`
      CREATE TABLE IF NOT EXISTS mole_rankings (
        id SERIAL PRIMARY KEY,
        user_name VARCHAR(100) NOT NULL,
        stage_id VARCHAR(100) NOT NULL,
        game_mode VARCHAR(50) NOT NULL,
        score INT NOT NULL,
        time DOUBLE PRECISION NOT NULL,
        accuracy INT NOT NULL,
        endless_level INT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 歌タイピング用のランキングテーブル
    await client.query(`
      CREATE TABLE IF NOT EXISTS song_rankings (
        id SERIAL PRIMARY KEY,
        user_name VARCHAR(100) NOT NULL,
        lrc_path VARCHAR(500) NOT NULL,
        accuracy INT NOT NULL,
        correct INT NOT NULL,
        miss INT NOT NULL,
        speed DOUBLE PRECISION NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // アクセス状況ログ（プライバシー保護のためIPハッシュを記録）
    await client.query(`
      CREATE TABLE IF NOT EXISTS visit_logs (
        id SERIAL PRIMARY KEY,
        ip_hash VARCHAR(64) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    client.release();
    return res.status(200).json({ success: true, message: 'Tables initialized successfully' });
  } catch (error) {
    console.error('Failed to init tables:', error);
    return res.status(500).json({ error: error.message });
  }
}
