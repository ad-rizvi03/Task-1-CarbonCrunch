/**
 * Normalization Layer
 * 
 * Responsibilities:
 * - Convert raw, unreliable data into canonical format
 * - Handle missing, malformed, or inconsistent fields
 * - Tolerate new fields without breaking
 * - Provide clear error messages for validation failures
 * 
 * Design Decisions:
 * - Field mapping is configurable per client
 * - Validation is lenient but tracks issues
 * - Type coercion is explicit and logged
 * - Unknown fields are preserved but not validated
 */

class Normalizer {
  constructor() {
    // Configurable field mappings - can be extended per client
    this.fieldMappings = {
      // Client ID mappings
      client_id: ['source', 'client', 'client_id', 'clientId', 'sender'],
      
      // Metric mappings
      metric: ['metric', 'type', 'event_type', 'eventType', 'name'],
      
      // Amount mappings
      amount: ['amount', 'value', 'quantity', 'total', 'sum'],
      
      // Timestamp mappings
      timestamp: ['timestamp', 'time', 'date', 'created_at', 'createdAt', 'event_time']
    };

    // Date format patterns
    this.dateFormats = [
      /^\d{4}\/\d{2}\/\d{2}$/,          // 2024/01/01
      /^\d{4}-\d{2}-\d{2}$/,            // 2024-01-01
      /^\d{2}\/\d{2}\/\d{4}$/,          // 01/01/2024
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, // ISO format
    ];
  }

  /**
   * Normalize raw event to canonical format
   * @param {Object} rawEvent - Raw event from client
   * @returns {Object} - { success, data, errors, warnings }
   */
  normalize(rawEvent) {
    const errors = [];
    const warnings = [];
    const normalized = {};

    try {
      // Extract and validate client_id
      const clientId = this.extractField(rawEvent, 'client_id');
      if (!clientId) {
        errors.push('Missing required field: client_id (or equivalent)');
      } else {
        normalized.client_id = String(clientId);
      }

      // Extract payload (handle nested structure)
      const payload = rawEvent.payload || rawEvent;

      // Extract and validate metric
      const metric = this.extractField(payload, 'metric');
      if (!metric) {
        errors.push('Missing required field: metric (or equivalent)');
      } else {
        normalized.metric = String(metric);
      }

      // Extract and validate amount (with type coercion)
      const amount = this.extractField(payload, 'amount');
      if (amount === null || amount === undefined) {
        errors.push('Missing required field: amount (or equivalent)');
      } else {
        const parsedAmount = this.parseNumber(amount);
        if (parsedAmount === null) {
          errors.push(`Invalid amount value: ${amount} (cannot be converted to number)`);
        } else {
          normalized.amount = parsedAmount;
          if (typeof amount === 'string') {
            warnings.push(`Amount was provided as string "${amount}", converted to ${parsedAmount}`);
          }
        }
      }

      // Extract and validate timestamp (with format normalization)
      const timestamp = this.extractField(payload, 'timestamp');
      if (!timestamp) {
        // Use current timestamp as fallback
        normalized.timestamp = new Date().toISOString();
        warnings.push('Missing timestamp field, using current time as fallback');
      } else {
        const parsedTimestamp = this.parseTimestamp(timestamp);
        if (!parsedTimestamp) {
          errors.push(`Invalid timestamp format: ${timestamp}`);
          normalized.timestamp = new Date().toISOString();
          warnings.push('Using current time due to invalid timestamp');
        } else {
          normalized.timestamp = parsedTimestamp;
          if (parsedTimestamp !== timestamp) {
            warnings.push(`Timestamp normalized from "${timestamp}" to "${parsedTimestamp}"`);
          }
        }
      }

      // Check for unknown fields (log but don't fail)
      const knownFields = new Set(['source', 'client', 'client_id', 'clientId', 'sender', 'payload']);
      const payloadKnownFields = new Set(['metric', 'type', 'event_type', 'eventType', 'name', 
                                           'amount', 'value', 'quantity', 'total', 'sum',
                                           'timestamp', 'time', 'date', 'created_at', 'createdAt', 'event_time']);
      
      Object.keys(rawEvent).forEach(key => {
        if (!knownFields.has(key)) {
          warnings.push(`Unknown field at root level: ${key}`);
        }
      });
      
      Object.keys(payload).forEach(key => {
        if (!payloadKnownFields.has(key)) {
          warnings.push(`Unknown field in payload: ${key}`);
        }
      });

      // Return result
      if (errors.length > 0) {
        return {
          success: false,
          data: null,
          errors,
          warnings
        };
      }

      return {
        success: true,
        data: normalized,
        errors: [],
        warnings
      };

    } catch (error) {
      return {
        success: false,
        data: null,
        errors: [`Normalization exception: ${error.message}`],
        warnings
      };
    }
  }

  /**
   * Extract field using multiple possible field names
   */
  extractField(obj, canonicalName) {
    const possibleNames = this.fieldMappings[canonicalName] || [canonicalName];
    
    for (const name of possibleNames) {
      if (obj && obj[name] !== undefined && obj[name] !== null && obj[name] !== '') {
        return obj[name];
      }
    }
    
    return null;
  }

  /**
   * Parse number from various formats
   */
  parseNumber(value) {
    if (typeof value === 'number') {
      return isNaN(value) ? null : value;
    }
    
    if (typeof value === 'string') {
      // Remove common formatting characters
      const cleaned = value.replace(/[,$]/g, '').trim();
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? null : parsed;
    }
    
    return null;
  }

  /**
   * Parse timestamp from various formats and normalize to ISO 8601
   */
  parseTimestamp(value) {
    if (!value) return null;

    try {
      // Try parsing as-is first
      let date = new Date(value);
      
      // If invalid, try custom formats
      if (isNaN(date.getTime())) {
        // Handle YYYY/MM/DD format
        if (/^\d{4}\/\d{2}\/\d{2}$/.test(value)) {
          const [year, month, day] = value.split('/');
          date = new Date(`${year}-${month}-${day}T00:00:00Z`);
        }
        // Handle DD/MM/YYYY format
        else if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
          const [day, month, year] = value.split('/');
          date = new Date(`${year}-${month}-${day}T00:00:00Z`);
        }
      }

      // Validate date is valid
      if (isNaN(date.getTime())) {
        return null;
      }

      return date.toISOString();
    } catch (error) {
      return null;
    }
  }

  /**
   * Add custom field mapping for specific client
   */
  addFieldMapping(canonicalName, fieldName) {
    if (!this.fieldMappings[canonicalName]) {
      this.fieldMappings[canonicalName] = [];
    }
    if (!this.fieldMappings[canonicalName].includes(fieldName)) {
      this.fieldMappings[canonicalName].push(fieldName);
    }
  }
}

module.exports = Normalizer;
