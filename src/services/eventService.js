const Normalizer = require('../normalizer');
const IdempotencyHandler = require('../idempotencyHandler');

/**
 * Event Service
 * 
 * Orchestrates the entire event ingestion pipeline:
 * 1. Deduplication check
 * 2. Normalization
 * 3. Atomic persistence
 * 4. Failure handling
 */

class EventService {
  constructor(database) {
    this.db = database;
    this.normalizer = new Normalizer();
  }

  /**
   * Ingest an event with full fault tolerance
   * 
   * Process:
   * 1. Generate content hash
   * 2. Check for duplicates (idempotency)
   * 3. Normalize data
   * 4. Persist in transaction (atomicity)
   * 5. Handle failures gracefully
   * 
   * @param {Object} rawEvent - Raw event from client
   * @param {boolean} simulateFailure - Testing flag to simulate DB failure
   * @returns {Object} - Result with status code and message
   */
  async ingestEvent(rawEvent, simulateFailure = false) {
    const eventHash = IdempotencyHandler.generateEventHash(rawEvent);
    
    // Log the ingestion attempt
    IdempotencyHandler.logProcessing(this.db, eventHash, 'ingest', 'started');

    try {
      // STEP 1: Check for duplicate (idempotency)
      const duplicate = IdempotencyHandler.checkDuplicate(this.db, eventHash);
      
      if (duplicate) {
        IdempotencyHandler.logProcessing(
          this.db, 
          eventHash, 
          'ingest', 
          'duplicate',
          'Event already processed'
        );

        return {
          status: 200,
          success: true,
          message: 'Event already processed (duplicate detected)',
          isDuplicate: true,
          eventHash,
          firstSeenAt: duplicate.firstSeenAt,
          data: duplicate.data
        };
      }

      // STEP 2: Normalize the event
      const normalizationResult = this.normalizer.normalize(rawEvent);
      
      if (!normalizationResult.success) {
        // Store as failed event
        const rawEventId = IdempotencyHandler.storeRawEvent(this.db, eventHash, rawEvent);
        
        if (rawEventId) {
          IdempotencyHandler.storeFailedEvent(
            this.db,
            rawEventId,
            eventHash,
            rawEvent,
            normalizationResult.errors.join('; '),
            'validation_error'
          );
        }

        IdempotencyHandler.logProcessing(
          this.db, 
          eventHash, 
          'normalize', 
          'failed',
          normalizationResult.errors.join('; ')
        );

        return {
          status: 400,
          success: false,
          message: 'Event validation failed',
          errors: normalizationResult.errors,
          warnings: normalizationResult.warnings,
          eventHash
        };
      }

      // STEP 3: Persist in atomic transaction
      // This ensures either both raw and normalized events are saved, or neither
      const processTransaction = this.db.transaction((hash, raw, normalized) => {
        // Store raw event first
        const rawEventId = IdempotencyHandler.storeRawEvent(this.db, hash, raw);
        
        if (!rawEventId) {
          throw new Error('Failed to store raw event (possible race condition)');
        }

        // Simulate failure if requested (for testing)
        if (simulateFailure) {
          throw new Error('Simulated database failure');
        }

        // Store normalized event
        const normalizedEventId = IdempotencyHandler.storeNormalizedEvent(
          this.db,
          rawEventId,
          normalized
        );

        return { rawEventId, normalizedEventId };
      });

      try {
        const result = processTransaction(eventHash, rawEvent, normalizationResult.data);
        
        IdempotencyHandler.logProcessing(
          this.db, 
          eventHash, 
          'ingest', 
          'success',
          'Event processed successfully'
        );

        return {
          status: 201,
          success: true,
          message: 'Event processed successfully',
          eventHash,
          rawEventId: result.rawEventId,
          normalizedEventId: result.normalizedEventId,
          data: normalizationResult.data,
          warnings: normalizationResult.warnings
        };

      } catch (txnError) {
        // Transaction failed - event will NOT be stored
        // On retry, it will be processed again
        
        IdempotencyHandler.logProcessing(
          this.db, 
          eventHash, 
          'persist', 
          'failed',
          txnError.message
        );

        // Store as failed event (outside transaction)
        try {
          const rawEventId = IdempotencyHandler.storeRawEvent(this.db, eventHash, rawEvent);
          if (rawEventId) {
            IdempotencyHandler.storeFailedEvent(
              this.db,
              rawEventId,
              eventHash,
              rawEvent,
              txnError.message,
              'persistence_error'
            );
          }
        } catch (storeError) {
          // Even storing failure failed - log but don't throw
          console.error('Failed to store failure record:', storeError);
        }

        return {
          status: 500,
          success: false,
          message: 'Database error occurred',
          error: txnError.message,
          eventHash,
          retryable: true
        };
      }

    } catch (error) {
      // Unexpected error
      IdempotencyHandler.logProcessing(
        this.db, 
        eventHash, 
        'ingest', 
        'error',
        error.message
      );

      return {
        status: 500,
        success: false,
        message: 'Unexpected error occurred',
        error: error.message,
        eventHash
      };
    }
  }

  /**
   * Get events with optional filtering
   */
  getEvents(filters = {}) {
    let query = `
      SELECT 
        ne.id,
        ne.client_id,
        ne.metric,
        ne.amount,
        ne.timestamp,
        ne.status,
        ne.created_at,
        re.event_hash,
        re.raw_data
      FROM normalized_events ne
      JOIN raw_events re ON ne.raw_event_id = re.id
      WHERE 1=1
    `;

    const params = [];

    if (filters.client_id) {
      query += ' AND ne.client_id = ?';
      params.push(filters.client_id);
    }

    if (filters.status) {
      query += ' AND ne.status = ?';
      params.push(filters.status);
    }

    if (filters.start_date) {
      query += ' AND ne.timestamp >= ?';
      params.push(filters.start_date);
    }

    if (filters.end_date) {
      query += ' AND ne.timestamp <= ?';
      params.push(filters.end_date);
    }

    query += ' ORDER BY ne.created_at DESC LIMIT 100';

    const stmt = this.db.prepare(query);
    return stmt.all(...params);
  }

  /**
   * Get failed events
   */
  getFailedEvents() {
    const stmt = this.db.prepare(`
      SELECT 
        fe.id,
        fe.event_hash,
        fe.raw_data,
        fe.error_message,
        fe.error_type,
        fe.failed_at
      FROM failed_events fe
      ORDER BY fe.failed_at DESC
      LIMIT 100
    `);

    return stmt.all();
  }

  /**
   * Get statistics
   */
  getStats() {
    const totalProcessed = this.db.prepare('SELECT COUNT(*) as count FROM normalized_events').get();
    const totalFailed = this.db.prepare('SELECT COUNT(*) as count FROM failed_events').get();
    const totalRaw = this.db.prepare('SELECT COUNT(*) as count FROM raw_events').get();
    
    const byClient = this.db.prepare(`
      SELECT client_id, COUNT(*) as count
      FROM normalized_events
      GROUP BY client_id
    `).all();

    const byMetric = this.db.prepare(`
      SELECT metric, COUNT(*) as count
      FROM normalized_events
      GROUP BY metric
    `).all();

    return {
      totalProcessed: totalProcessed.count,
      totalFailed: totalFailed.count,
      totalRaw: totalRaw.count,
      duplicateCount: totalRaw.count - totalProcessed.count - totalFailed.count,
      byClient,
      byMetric
    };
  }
}

module.exports = EventService;
