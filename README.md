# Fault-Tolerant Data Processing System

A robust data ingestion and processing service that handles unreliable data from multiple clients with idempotency guarantees, normalization, and fault tolerance.

## 🚀 Quick Start

### Installation

```bash
npm install
```

### Running the Application

```bash
npm start
```

Visit `http://localhost:3000` in your browser.

## 📋 What Assumptions Did I Make?

### 1. Data Model Assumptions
- **Required Fields**: Every event must contain client identifier, metric type, amount, and timestamp (in any of their aliased forms)
- **Semantic Uniqueness**: Two events with identical semantic content (client, metric, amount, timestamp) are considered duplicates, regardless of when they were received
- **Amount Interpretation**: All amounts represent positive numeric values that can be summed for aggregation
- **Timestamp Flexibility**: Timestamps without timezone information are assumed to be UTC

### 2. System Behavior Assumptions
- **Retry Strategy**: Clients will retry failed requests with identical payloads
- **No Out-of-Order Guarantees**: Events may arrive in any order; the system doesn't enforce temporal ordering
- **Best-Effort Normalization**: Unknown or extra fields are logged as warnings but don't cause failures
- **Single Instance**: The system runs as a single process (no distributed coordination needed)

### 3. Scale Assumptions
- **Event Volume**: Designed for thousands of events per hour, not millions per second
- **Client Count**: Optimized for 10-100 clients, not 10,000
- **Data Retention**: All data is kept indefinitely (no automatic archival/deletion)
- **Query Patterns**: Aggregations are computed on-demand (no pre-aggregation)

### 4. Operational Assumptions
- **Database**: SQLite is sufficient for this scale (single-file, embedded database)
- **Deployment**: Single-server deployment (no load balancing required)
- **Monitoring**: Application logs are sufficient for debugging (no distributed tracing)

## 🔒 How Does the System Prevent Double Counting?

The system uses a **content-based hashing strategy** combined with database constraints to ensure idempotency:

### 1. Content Hash Generation
```javascript
// Generate deterministic hash from event content
const eventHash = SHA256(normalize(rawEvent))
```

- **Deterministic**: Same event content always produces the same hash
- **Semantic**: Based on business data (client, metric, amount, timestamp), not metadata
- **Collision-Resistant**: SHA-256 provides cryptographic guarantees

### 2. Database-Level Uniqueness
```sql
CREATE TABLE raw_events (
    event_hash TEXT UNIQUE NOT NULL,  -- Prevents duplicates at DB level
    ...
);
```

- **UNIQUE Constraint**: Database rejects duplicate hashes
- **Transaction Safety**: Hash check and insert happen atomically

### 3. Three-Step Processing Pipeline

```
1. CHECK: Query for existing event_hash
   ├─ Found → Return existing result (idempotent)
   └─ Not found → Continue to step 2

2. NORMALIZE: Validate and transform data
   ├─ Invalid → Store as failed event
   └─ Valid → Continue to step 3

3. PERSIST: Store in transaction
   ├─ Transaction BEGIN
   ├─ Insert raw_event (with UNIQUE constraint)
   ├─ Insert normalized_event
   ├─ Transaction COMMIT
   └─ On failure → ROLLBACK (nothing persisted)
```

### 4. Retry Behavior Example

**First Attempt:**
```
Client sends: { "source": "A", "amount": "100" }
Hash: abc123...
DB: Insert successful
Response: 201 Created
```

**Retry (Duplicate):**
```
Client sends: { "source": "A", "amount": "100" }
Hash: abc123... (same!)
DB: Hash already exists
Response: 200 OK (idempotent, no new processing)
```

**Modified Event:**
```
Client sends: { "source": "A", "amount": "200" }
Hash: xyz789... (different!)
DB: Insert successful
Response: 201 Created (new event)
```

### 5. Why This Prevents Double Counting

- ✅ **Same event sent twice**: Hash matches → deduped before insertion
- ✅ **Partial failure + retry**: Hash matches → returns existing result
- ✅ **Network timeout + retry**: Hash matches → idempotent response
- ✅ **Client bug sending duplicates**: Hash matches → counted once
- ❌ **Different events with same hash**: Statistically impossible (SHA-256)

## 🔧 What Happens If the Database Fails Mid-Request?

The system uses **database transactions** to ensure atomic operations. Here's what happens in different failure scenarios:

### Scenario 1: Failure Before Transaction
```
Request arrives
↓
Generate hash: abc123
↓
Check for duplicate → DB query fails ❌
↓
Response: 500 Internal Server Error
Effect: No data written, no state change
```
**Outcome**: Client retries, event processes successfully on retry.

### Scenario 2: Failure During Transaction
```
Transaction BEGIN
↓
Insert raw_event → Success ✓
↓
Insert normalized_event → Fails ❌
↓
Transaction ROLLBACK (automatic)
↓
Response: 500 Internal Server Error
Effect: No data written (both inserts rolled back)
```
**Outcome**: Client retries, event processes successfully on retry.

### Scenario 3: Failure After Transaction Commit
```
Transaction BEGIN
↓
Insert raw_event → Success ✓
↓
Insert normalized_event → Success ✓
↓
Transaction COMMIT → Success ✓
↓
Network failure before response ❌
```
**Outcome**: Event IS persisted, but client doesn't know. On retry, hash matches → returns existing result (idempotent).

### Key Safety Properties

1. **Atomicity**: Both raw and normalized events are saved together or not at all
   - Achieved through: `db.transaction()` wrapper
   - Guarantee: No partial writes

2. **Consistency**: Event counts are always accurate
   - Duplicates are detected before insertion
   - Failed events are tracked separately
   - Aggregations only include successfully processed events

3. **Idempotency**: Retries are safe and don't cause duplication
   - Hash is checked before any writes
   - Same request → same response
   - Client can retry freely

4. **Failure Tracking**: Failed events are logged for investigation
   ```sql
   INSERT INTO failed_events (
       event_hash, raw_data, error_message, error_type
   )
   ```
   - Captures: What failed, why it failed, when it failed
   - Allows: Manual reprocessing or investigation

### Testing Failure Handling

The UI includes a "Simulate Database Failure" option:

```javascript
// In eventService.js
if (simulateFailure) {
    throw new Error('Simulated database failure');
}
```

**Try it:**
1. Submit event with "Simulate Failure" checked
2. Observe 500 error response
3. Uncheck "Simulate Failure" and submit same event
4. Observe successful processing (no duplicate)

## 📊 What Would Break First at Scale?

### 1. SQLite Database (Most Likely First Failure)
**Breaks at**: ~10,000 concurrent writes/second

**Why**:
- SQLite uses file-level locking
- Write transactions serialize (one at a time)
- No horizontal scaling

**Symptoms**:
```
Error: database is locked
Response times: 1s → 5s → timeouts
```

**Solutions**:
- **Short-term**: Increase timeout, add write-ahead logging (already enabled)
- **Long-term**: Migrate to PostgreSQL/MySQL (allows concurrent writes)

### 2. In-Memory Aggregations (Second Failure)
**Breaks at**: ~1 million events

**Why**:
- Aggregations compute on every query
- No caching or pre-aggregation
- Full table scans on large datasets

**Symptoms**:
```
Query times: 100ms → 5s → 30s
CPU usage: High
Memory: OK (queries stream results)
```

**Solutions**:
- **Short-term**: Add query result caching (Redis)
- **Medium-term**: Materialized views or pre-aggregated tables
- **Long-term**: Time-series database (TimescaleDB, InfluxDB)

### 3. Single-Server Architecture (Third Failure)
**Breaks at**: Server resource limits (CPU, memory, network)

**Why**:
- No redundancy
- No load balancing
- Single point of failure

**Symptoms**:
```
High CPU: Event processing slows
High memory: Risk of OOM crashes
Server down: Complete outage
```

**Solutions**:
- **Short-term**: Vertical scaling (bigger server)
- **Long-term**: Horizontal scaling (multiple servers + message queue)

### 4. Hash Collision (Theoretical, Never in Practice)
**Breaks at**: Never (2^128 events needed for 50% collision probability)

**Why**:
- SHA-256 has 256-bit output space
- Astronomically unlikely

**If it happened**:
- Different events would be treated as duplicates
- Symptom: Events mysteriously "already processed"

### Scaling Roadmap

| Scale | Events/Day | Architecture | Database |
|-------|-----------|--------------|----------|
| **Current** | <100K | Single process | SQLite |
| **Phase 1** | <1M | Single server | PostgreSQL |
| **Phase 2** | <10M | Multi-server + Queue | PostgreSQL + Redis |
| **Phase 3** | >10M | Microservices | PostgreSQL + TimescaleDB |

### What to Monitor

1. **Database Performance**
   ```
   - Write latency (p50, p95, p99)
   - Lock wait time
   - Connection pool usage
   ```

2. **API Performance**
   ```
   - Request latency
   - Throughput (requests/second)
   - Error rate
   ```

3. **Resource Usage**
   ```
   - CPU utilization
   - Memory usage
   - Disk I/O
   ```

4. **Business Metrics**
   ```
   - Duplicate rate (should be stable)
   - Validation failure rate
   - Processing success rate
   ```

## 🏗️ Architecture Overview

### Component Diagram

```
┌─────────────────────────────────────────────────┐
│                   Frontend (UI)                  │
│  ├─ Event Submission Form                       │
│  ├─ Statistics Dashboard                        │
│  └─ Aggregation Views                           │
└────────────────┬────────────────────────────────┘
                 │ HTTP/JSON
                 ↓
┌─────────────────────────────────────────────────┐
│              Express API Server                  │
│  ├─ POST /api/events (ingestion)                │
│  ├─ GET  /api/events (query)                    │
│  ├─ GET  /api/aggregations                      │
│  └─ GET  /api/stats                             │
└────────────────┬────────────────────────────────┘
                 │
       ┌─────────┴─────────┐
       ↓                   ↓
┌──────────────┐    ┌──────────────────┐
│ EventService │    │ AggregationService│
└──────┬───────┘    └──────────────────┘
       │
       ├─ Normalizer (validation, type coercion)
       ├─ IdempotencyHandler (hashing, deduplication)
       └─ Database (SQLite)
          ├─ raw_events (original data)
          ├─ normalized_events (processed data)
          ├─ failed_events (validation failures)
          └─ processing_log (audit trail)
```

### Data Flow

```
1. Raw Event Ingestion
   ├─ Generate content hash
   ├─ Check for duplicate (hash lookup)
   ├─ Normalize data (validation + transformation)
   └─ Persist in transaction

2. Query & Aggregation
   ├─ Filter by client/date/status
   ├─ Group and aggregate
   └─ Return JSON

3. Failure Handling
   ├─ Validation failure → failed_events table
   ├─ Persistence failure → transaction rollback
   └─ Retry → idempotent response
```

## 🧪 Testing

### Manual Testing with UI

1. **Basic Event**:
   ```json
   {
     "source": "client_A",
     "payload": {
       "metric": "revenue",
       "amount": "1200",
       "timestamp": "2024/01/01"
     }
   }
   ```

2. **Duplicate Detection**:
   - Submit same event twice
   - Second submission should show "Duplicate Detected"

3. **Failure Simulation**:
   - Check "Simulate Database Failure"
   - Submit event → 500 error
   - Uncheck and submit again → Success (no duplicate)

4. **Invalid Data**:
   ```json
   {
     "source": "client_A",
     "payload": {
       "metric": "revenue",
       "amount": "invalid_number"
     }
   }
   ```
   - Should show validation errors

### API Testing with cURL

```bash
# Submit event
curl -X POST http://localhost:3000/api/events \
  -H "Content-Type: application/json" \
  -d '{"source":"client_A","payload":{"metric":"test","amount":"100","timestamp":"2024/01/01"}}'

# Get events
curl http://localhost:3000/api/events

# Get aggregations
curl http://localhost:3000/api/aggregations

# Get statistics
curl http://localhost:3000/api/stats
```

## 🎯 Design Decisions

### Why SQLite?
- ✅ Zero configuration
- ✅ Single file, easy to backup
- ✅ ACID transactions built-in
- ✅ Sufficient for assignment scale
- ❌ Limited concurrency (acceptable trade-off)

### Why Content-Based Hashing?
- ✅ Deterministic deduplication
- ✅ Works without unique event IDs
- ✅ Survives partial failures
- ❌ Can't distinguish intentional re-submissions (acceptable)

### Why Separate Raw and Normalized Tables?
- ✅ Audit trail of original data
- ✅ Can reprocess if normalization logic changes
- ✅ Failed events can be investigated
- ❌ Slight storage overhead (acceptable)

### Why Transaction-Based Persistence?
- ✅ Atomic guarantees
- ✅ Simple failure handling
- ✅ No complex state machines
- ❌ Lower throughput (acceptable for scale)

## 📁 Project Structure

```
.
├── server.js                 # Express app and route definitions
├── src/
│   ├── database.js           # SQLite setup and schema
│   ├── normalizer.js         # Data normalization logic
│   ├── idempotencyHandler.js # Hashing and deduplication
│   └── services/
│       ├── eventService.js   # Event ingestion orchestration
│       └── aggregationService.js # Query and aggregation logic
├── public/
│   ├── index.html            # Frontend UI
│   ├── styles.css            # Styling
│   └── app.js                # Frontend JavaScript
├── package.json
└── README.md
```

## 🔑 Key Features

- ✅ Idempotent event ingestion
- ✅ Content-based deduplication
- ✅ Flexible data normalization
- ✅ Transaction-based consistency
- ✅ Partial failure handling
- ✅ Real-time aggregations
- ✅ Failure simulation for testing
- ✅ Comprehensive audit trail

## 🚧 Future Enhancements

### Short-term
1. Add retry queue for failed events
2. Implement query result caching
3. Add more aggregation types (percentiles, time-series)
4. Export functionality (CSV, JSON)

### Medium-term
1. Migrate to PostgreSQL for better concurrency
2. Add authentication and authorization
3. Rate limiting per client
4. Webhook notifications for failures

### Long-term
1. Distributed deployment with message queue
2. Streaming aggregations
3. ML-based anomaly detection
4. Time-series optimized storage

---

**Built with**: Node.js, Express, SQLite, Vanilla JavaScript

**Design Principles**: ACID transactions, idempotency, separation of concerns, fail-safe defaults
