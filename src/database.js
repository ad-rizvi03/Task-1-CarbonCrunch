const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

class DatabaseManager {
  constructor(dbPath = './data.db') {
    this.dbPath = dbPath;
    this.db = null;
    this.inTransaction = false;
  }

  async init() {
    const SQL = await initSqlJs();
    
    // Load existing database if it exists
    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }
    
    this.initializeTables();
    return this;
  }

  initializeTables() {
    // Raw events table - stores original incoming data
    this.exec(`
      CREATE TABLE IF NOT EXISTS raw_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_hash TEXT UNIQUE NOT NULL,
        raw_data TEXT NOT NULL,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Normalized events table - stores processed canonical format
    this.exec(`
      CREATE TABLE IF NOT EXISTS normalized_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raw_event_id INTEGER NOT NULL,
        client_id TEXT NOT NULL,
        metric TEXT NOT NULL,
        amount REAL NOT NULL,
        timestamp TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'processed',
        processing_error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (raw_event_id) REFERENCES raw_events(id)
      )
    `);

    // Failed events table - stores events that couldn't be processed
    this.exec(`
      CREATE TABLE IF NOT EXISTS failed_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raw_event_id INTEGER,
        event_hash TEXT NOT NULL,
        raw_data TEXT NOT NULL,
        error_message TEXT NOT NULL,
        error_type TEXT NOT NULL,
        failed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (raw_event_id) REFERENCES raw_events(id)
      )
    `);

    // Processing log - tracks all processing attempts
    this.exec(`
      CREATE TABLE IF NOT EXISTS processing_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_hash TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for better query performance
    this.exec(`
      CREATE INDEX IF NOT EXISTS idx_raw_events_hash ON raw_events(event_hash);
      CREATE INDEX IF NOT EXISTS idx_normalized_events_client ON normalized_events(client_id);
      CREATE INDEX IF NOT EXISTS idx_normalized_events_timestamp ON normalized_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_normalized_events_status ON normalized_events(status);
      CREATE INDEX IF NOT EXISTS idx_failed_events_hash ON failed_events(event_hash);
    `);
  }

  exec(sql) {
    this.db.exec(sql);
    this.save();
  }

  // Transaction support for atomic operations
  transaction(callback) {
    return (...args) => {
      this.inTransaction = true;
      try {
        this.db.exec('BEGIN TRANSACTION');
        const result = callback(...args);
        this.db.exec('COMMIT');
        this.save();
        this.inTransaction = false;
        return result;
      } catch (error) {
        this.db.exec('ROLLBACK');
        this.inTransaction = false;
        throw error;
      }
    };
  }

  prepare(sql) {
    return {
      run: (...params) => {
        this.db.run(sql, params);
        this.save();
        // Get last insert rowid
        const result = this.db.exec('SELECT last_insert_rowid() as id');
        return {
          lastInsertRowid: result[0] ? result[0].values[0][0] : null
        };
      },
      get: (...params) => {
        const result = this.db.exec(sql, params);
        if (result[0] && result[0].values.length > 0) {
          const columns = result[0].columns;
          const values = result[0].values[0];
          const row = {};
          columns.forEach((col, i) => {
            row[col] = values[i];
          });
          return row;
        }
        return null;
      },
      all: (...params) => {
        const result = this.db.exec(sql, params);
        if (result[0]) {
          const columns = result[0].columns;
          return result[0].values.map(values => {
            const row = {};
            columns.forEach((col, i) => {
              row[col] = values[i];
            });
            return row;
          });
        }
        return [];
      }
    };
  }

  save() {
    if (!this.inTransaction) {
      const data = this.db.export();
      fs.writeFileSync(this.dbPath, data);
    }
  }

  close() {
    this.db.close();
  }
}

module.exports = DatabaseManager;
