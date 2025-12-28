/**
 * Aggregation Service
 * 
 * Responsibilities:
 * - Provide aggregated views of processed events
 * - Support filtering by client and time range
 * - Ensure consistency (only count successfully processed events)
 * - Designed for extensibility
 * 
 * Design Decisions:
 * - Aggregations only include successfully processed events
 * - Failed and duplicate events are excluded from aggregations
 * - Results are computed on-demand (can be cached later if needed)
 * - Extensible architecture for adding new aggregation types
 */

class AggregationService {
  constructor(database) {
    this.db = database;
  }

  /**
   * Get aggregated data with optional filtering
   * 
   * @param {Object} filters - Optional filters (client_id, start_date, end_date)
   * @returns {Object} - Aggregated results
   */
  getAggregations(filters = {}) {
    return {
      summary: this.getSummary(filters),
      byClient: this.getByClient(filters),
      byMetric: this.getByMetric(filters),
      byDay: this.getByDay(filters),
      timeRange: this.getTimeRange(filters)
    };
  }

  /**
   * Get overall summary statistics
   */
  getSummary(filters = {}) {
    let query = `
      SELECT 
        COUNT(*) as total_events,
        SUM(amount) as total_amount,
        AVG(amount) as avg_amount,
        MIN(amount) as min_amount,
        MAX(amount) as max_amount,
        COUNT(DISTINCT client_id) as unique_clients,
        COUNT(DISTINCT metric) as unique_metrics
      FROM normalized_events
      WHERE status = 'processed'
    `;

    const params = [];

    if (filters.client_id) {
      query += ' AND client_id = ?';
      params.push(filters.client_id);
    }

    if (filters.start_date) {
      query += ' AND timestamp >= ?';
      params.push(filters.start_date);
    }

    if (filters.end_date) {
      query += ' AND timestamp <= ?';
      params.push(filters.end_date);
    }

    const stmt = this.db.prepare(query);
    return stmt.get(...params);
  }

  /**
   * Get aggregations grouped by client
   */
  getByClient(filters = {}) {
    let query = `
      SELECT 
        client_id,
        COUNT(*) as event_count,
        SUM(amount) as total_amount,
        AVG(amount) as avg_amount,
        MIN(timestamp) as first_event,
        MAX(timestamp) as last_event
      FROM normalized_events
      WHERE status = 'processed'
    `;

    const params = [];

    if (filters.client_id) {
      query += ' AND client_id = ?';
      params.push(filters.client_id);
    }

    if (filters.start_date) {
      query += ' AND timestamp >= ?';
      params.push(filters.start_date);
    }

    if (filters.end_date) {
      query += ' AND timestamp <= ?';
      params.push(filters.end_date);
    }

    query += ' GROUP BY client_id ORDER BY total_amount DESC';

    const stmt = this.db.prepare(query);
    return stmt.all(...params);
  }

  /**
   * Get aggregations grouped by metric type
   */
  getByMetric(filters = {}) {
    let query = `
      SELECT 
        metric,
        COUNT(*) as event_count,
        SUM(amount) as total_amount,
        AVG(amount) as avg_amount
      FROM normalized_events
      WHERE status = 'processed'
    `;

    const params = [];

    if (filters.client_id) {
      query += ' AND client_id = ?';
      params.push(filters.client_id);
    }

    if (filters.start_date) {
      query += ' AND timestamp >= ?';
      params.push(filters.start_date);
    }

    if (filters.end_date) {
      query += ' AND timestamp <= ?';
      params.push(filters.end_date);
    }

    query += ' GROUP BY metric ORDER BY total_amount DESC';

    const stmt = this.db.prepare(query);
    return stmt.all(...params);
  }

  /**
   * Get aggregations grouped by day
   */
  getByDay(filters = {}) {
    let query = `
      SELECT 
        DATE(timestamp) as date,
        COUNT(*) as event_count,
        SUM(amount) as total_amount,
        AVG(amount) as avg_amount
      FROM normalized_events
      WHERE status = 'processed'
    `;

    const params = [];

    if (filters.client_id) {
      query += ' AND client_id = ?';
      params.push(filters.client_id);
    }

    if (filters.start_date) {
      query += ' AND timestamp >= ?';
      params.push(filters.start_date);
    }

    if (filters.end_date) {
      query += ' AND timestamp <= ?';
      params.push(filters.end_date);
    }

    query += ' GROUP BY DATE(timestamp) ORDER BY date DESC LIMIT 30';

    const stmt = this.db.prepare(query);
    return stmt.all(...params);
  }

  /**
   * Get time range of data
   */
  getTimeRange(filters = {}) {
    let query = `
      SELECT 
        MIN(timestamp) as earliest_event,
        MAX(timestamp) as latest_event
      FROM normalized_events
      WHERE status = 'processed'
    `;

    const params = [];

    if (filters.client_id) {
      query += ' AND client_id = ?';
      params.push(filters.client_id);
    }

    const stmt = this.db.prepare(query);
    return stmt.get(...params);
  }

  /**
   * Get client-metric breakdown
   */
  getClientMetricBreakdown(filters = {}) {
    let query = `
      SELECT 
        client_id,
        metric,
        COUNT(*) as event_count,
        SUM(amount) as total_amount
      FROM normalized_events
      WHERE status = 'processed'
    `;

    const params = [];

    if (filters.client_id) {
      query += ' AND client_id = ?';
      params.push(filters.client_id);
    }

    if (filters.start_date) {
      query += ' AND timestamp >= ?';
      params.push(filters.start_date);
    }

    if (filters.end_date) {
      query += ' AND timestamp <= ?';
      params.push(filters.end_date);
    }

    query += ' GROUP BY client_id, metric ORDER BY total_amount DESC';

    const stmt = this.db.prepare(query);
    return stmt.all(...params);
  }
}

module.exports = AggregationService;
