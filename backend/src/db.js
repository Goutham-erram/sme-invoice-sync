const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const initDb = async () => {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      id SERIAL PRIMARY KEY,
      provider VARCHAR(50) NOT NULL UNIQUE,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      realm_id VARCHAR(100),
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      refresh_expires_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    const client = await pool.connect();
    console.log('Database connected successfully.');
    await client.query(createTableQuery);
    console.log('Database tables verified/created successfully.');
    client.release();
  } catch (err) {
    console.error('Database connection or initialization failed:', err.message);
  }
};

module.exports = {
  pool,
  initDb,
};
