import pg from 'pg';
import crypto from 'crypto';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

export default async function handler(req, res) {
  // CORSヘッダーの設定
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    // GETメソッドなどの場合は、現在のカウントのみを取得して返す
    try {
      const client = await pool.connect();
      const viewsRes = await client.query('SELECT COUNT(*) as count FROM visit_logs');
      const uniqueRes = await client.query('SELECT COUNT(DISTINCT ip_hash) as count FROM visit_logs');
      client.release();
      return res.status(200).json({
        views: parseInt(viewsRes.rows[0].count),
        uniques: parseInt(uniqueRes.rows[0].count)
      });
    } catch (error) {
      console.error('Failed to get visit stats:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  try {
    const client = await pool.connect();
    
    // クライアントのIPアドレスを取得
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    // プライバシー保護のため、IPアドレスをSHA-256でハッシュ化
    const ipHash = crypto.createHash('sha256').update(ip).digest('hex');
    
    // アクセスログを追加
    await client.query('INSERT INTO visit_logs (ip_hash) VALUES ($1)', [ipHash]);
    
    // 最新のアクセス総数とユニークアクセス数を集計
    const viewsRes = await client.query('SELECT COUNT(*) as count FROM visit_logs');
    const uniqueRes = await client.query('SELECT COUNT(DISTINCT ip_hash) as count FROM visit_logs');
    
    client.release();
    
    return res.status(200).json({
      success: true,
      views: parseInt(viewsRes.rows[0].count),
      uniques: parseInt(uniqueRes.rows[0].count)
    });
  } catch (error) {
    console.error('Failed to track visit:', error);
    return res.status(500).json({ error: error.message });
  }
}
