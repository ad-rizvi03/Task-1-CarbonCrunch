const crypto = require('crypto');

/**
 * Idempotency Handler
 * 
 * Responsibilities:
 * - Generate consistent hashes for events to detect duplicates
 * - Track processing state to handle retries
 * - Prevent double counting of events
 * 
 * Design Decisions:
 * - Hash includes semantic fields only (not timestamps of receipt)
 * - Uses content-based hashing for deduplication
 * - Tracks processing state separately from event data
 * - Handles partial failures through transaction isolation
 * 
 * How it prevents double counting:
 * 1. Generate content hash from normalized event data
 * 2. Check if hash exists in raw_events table
 * 3. If exists, return existing result (idempotent)
 * 4. If not, process in transaction with rollback on failure
 */

class IdempotencyHandler {
  /**
   * Generate a deterministic hash for an event
   * Hash is based on semantic content, not metadata
   * 
   * @param {Object} rawEvent - Raw event object
   * @returns {string} - SHA256 hash
   */
  static generateEventHash(rawEvent) {
    // Sort keys to ensure consistent ordering
    const normalized = this.normalizeForHashing(rawEvent);
    const content = JSON.stringify(normalized);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Normalize event data for consistent hashing
   * - Sorts object keys recursively
   * - Removes metadata that shouldn't affect deduplication
   * - Handles nested structures
   */
  static normalizeForHashing(obj) {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.normalizeForHashing(item));
    }

    if (typeof obj === 'object') {
      const sorted = {};
      Object.keys(obj)
        .sort()
        .forEach(key => {
          // Skip fields that shouldn't affect deduplication
          // (These are metadata about receipt, not event content)
          if (key === 'received_at' || key === 'created_at' || key === 'id') {
            return;
          }
          sorted[key] = this.normalizeForHashing(obj[key]);
        });
      return sorted;
    }

    // Handle primitives
    if (typeof obj === 'string') {
      return obj.trim().toLowerCase();
    }

    return obj;
  }

  /**
   * Check if event has been processed before
   * @param {Object} db - Database instance
   * @param {string} eventHash - Event hash
   * @returns {Object|null} - Existing event or null
   */
  static checkDuplicate(db, eventHash) {
    const stmt = db.prepare(`
      SELECT re.id, re.event_hash, re.received_at,
             ne.id as normalized_id, ne.status, ne.client_id, ne.metric, ne.amount, ne.timestamp
      FROM raw_events re
      LEFT JOIN normalized_events ne ON ne.raw_event_id = re.id
      WHERE re.event_hash = ?
      LIMIT 1
    `);

    const result = stmt.get(eventHash);
    
    if (result) {
      return {
        isDuplicate: true,
        rawEventId: result.id,
        normalizedId: result.normalized_id,
        status: result.status,
        firstSeenAt: result.received_at,
        data: result.normalized_id ? {
          client_id: result.client_id,
          metric: result.metric,
          amount: result.amount,
          timestamp: result.timestamp
        } : null
      };
    }

    return null;
  }

  /**
   * Log processing attempt
   */
  static logProcessing(db, eventHash, action, status, message = null) {
    const stmt = db.prepare(`
      INSERT INTO processing_log (event_hash, action, status, message)
      VALUES (?, ?, ?, ?)
    `);
    
    stmt.run(eventHash, action, status, message);
  }

  /**
   * Store raw event (first step in processing)
   * Returns rawEventId if successful
   */
  static storeRawEvent(db, eventHash, rawData) {
    try {
      const stmt = db.prepare(`
        INSERT INTO raw_events (event_hash, raw_data)
        VALUES (?, ?)
      `);
      
      const info = stmt.run(eventHash, JSON.stringify(rawData));
      return info.lastInsertRowid;
    } catch (error) {
      // If unique constraint violation, event already exists
      if (error.message.includes('UNIQUE constraint failed')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Store normalized event (second step in processing)
   */
  static storeNormalizedEvent(db, rawEventId, normalizedData) {
    const stmt = db.prepare(`
      INSERT INTO normalized_events (raw_event_id, client_id, metric, amount, timestamp, status)
      VALUES (?, ?, ?, ?, ?, 'processed')
    `);
    
    const info = stmt.run(
      rawEventId,
      normalizedData.client_id,
      normalizedData.metric,
      normalizedData.amount,
      normalizedData.timestamp
    );
    
    return info.lastInsertRowid;
  }

  /**
   * Store failed event
   */
  static storeFailedEvent(db, rawEventId, eventHash, rawData, errorMessage, errorType) {
    const stmt = db.prepare(`
      INSERT INTO failed_events (raw_event_id, event_hash, raw_data, error_message, error_type)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    stmt.run(rawEventId, eventHash, JSON.stringify(rawData), errorMessage, errorType);
  }
}

module.exports = IdempotencyHandler;
