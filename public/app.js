// API Base URL
const API_BASE = '/api';

// Sample events for testing
const SAMPLE_EVENTS = [
    {
        "source": "client_A",
        "payload": {
            "metric": "revenue",
            "amount": "1200",
            "timestamp": "2024/01/01"
        }
    },
    {
        "source": "client_B",
        "payload": {
            "metric": "signup",
            "amount": 5,
            "timestamp": "2024-01-02T10:30:00Z"
        }
    },
    {
        "client_id": "client_C",
        "payload": {
            "event_type": "purchase",
            "value": "350.50",
            "date": "01/03/2024"
        }
    }
];

// DOM Elements
const eventInput = document.getElementById('eventInput');
const simulateFailureCheckbox = document.getElementById('simulateFailure');
const submitBtn = document.getElementById('submitBtn');
const clearBtn = document.getElementById('clearBtn');
const loadSampleBtn = document.getElementById('loadSampleBtn');
const submitResult = document.getElementById('submitResult');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadSample();
    refreshAll();
    
    // Event listeners
    submitBtn.addEventListener('click', submitEvent);
    clearBtn.addEventListener('click', clearForm);
    loadSampleBtn.addEventListener('click', loadSample);
    document.getElementById('refreshStatsBtn').addEventListener('click', refreshStats);
    document.getElementById('refreshEventsBtn').addEventListener('click', refreshEvents);
    document.getElementById('refreshFailedBtn').addEventListener('click', refreshFailedEvents);
    document.getElementById('refreshAggBtn').addEventListener('click', refreshAggregations);
});

// Load random sample event
function loadSample() {
    const sample = SAMPLE_EVENTS[Math.floor(Math.random() * SAMPLE_EVENTS.length)];
    eventInput.value = JSON.stringify(sample, null, 2);
}

// Clear form
function clearForm() {
    eventInput.value = '';
    simulateFailureCheckbox.checked = false;
    submitResult.style.display = 'none';
}

// Submit event
async function submitEvent() {
    const rawEvent = eventInput.value.trim();
    
    if (!rawEvent) {
        showResult('error', 'Please enter event data');
        return;
    }

    try {
        // Parse JSON
        const eventData = JSON.parse(rawEvent);
        
        // Disable button
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
        
        // Make API call
        const simulateFailure = simulateFailureCheckbox.checked;
        const response = await fetch(`${API_BASE}/events?simulate_failure=${simulateFailure}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(eventData)
        });
        
        const result = await response.json();
        
        // Show result
        if (result.success) {
            if (result.isDuplicate) {
                showResult('warning', 'Duplicate Detected', result);
            } else {
                showResult('success', 'Event Processed Successfully', result);
            }
            // Refresh all data
            setTimeout(refreshAll, 500);
        } else {
            showResult('error', 'Processing Failed', result);
        }
        
    } catch (error) {
        showResult('error', 'Invalid JSON or Network Error', { error: error.message });
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Event';
    }
}

// Show result
function showResult(type, message, data = null) {
    submitResult.className = `result-box ${type}`;
    submitResult.style.display = 'block';
    
    let html = `<h4>${message}</h4>`;
    
    if (data) {
        html += `<pre>${JSON.stringify(data, null, 2)}</pre>`;
    }
    
    submitResult.innerHTML = html;
}

// Refresh all data
async function refreshAll() {
    await Promise.all([
        refreshStats(),
        refreshEvents(),
        refreshFailedEvents(),
        refreshAggregations()
    ]);
}

// Refresh statistics
async function refreshStats() {
    try {
        const response = await fetch(`${API_BASE}/stats`);
        const data = await response.json();
        
        if (data.success) {
            const stats = data.stats;
            document.getElementById('statProcessed').textContent = stats.totalProcessed;
            document.getElementById('statFailed').textContent = stats.totalFailed;
            document.getElementById('statDuplicates').textContent = stats.duplicateCount;
            document.getElementById('statTotal').textContent = stats.totalRaw;
        }
    } catch (error) {
        console.error('Error refreshing stats:', error);
    }
}

// Refresh events table
async function refreshEvents() {
    try {
        const response = await fetch(`${API_BASE}/events`);
        const data = await response.json();
        
        const tbody = document.getElementById('eventsTableBody');
        
        if (data.success && data.events.length > 0) {
            tbody.innerHTML = data.events.map(event => `
                <tr>
                    <td>${event.id}</td>
                    <td><strong>${event.client_id}</strong></td>
                    <td>${event.metric}</td>
                    <td><strong>${event.amount.toFixed(2)}</strong></td>
                    <td>${new Date(event.timestamp).toLocaleString()}</td>
                    <td><span class="status-badge processed">✓ Processed</span></td>
                    <td><span class="hash-display">${event.event_hash.substring(0, 12)}...</span></td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No events yet.</td></tr>';
        }
    } catch (error) {
        console.error('Error refreshing events:', error);
    }
}

// Refresh failed events table
async function refreshFailedEvents() {
    try {
        const response = await fetch(`${API_BASE}/events`);
        const data = await response.json();
        
        // Get failed events from event service
        const failedResponse = await fetch(`${API_BASE}/stats`);
        const statsData = await failedResponse.json();
        
        const tbody = document.getElementById('failedTableBody');
        
        // For now, just show if there are failed events
        if (statsData.success && statsData.stats.totalFailed > 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="empty-state">${statsData.stats.totalFailed} failed events (check logs for details)</td></tr>`;
        } else {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No failed events.</td></tr>';
        }
    } catch (error) {
        console.error('Error refreshing failed events:', error);
    }
}

// Refresh aggregations
async function refreshAggregations() {
    try {
        const response = await fetch(`${API_BASE}/aggregations`);
        const data = await response.json();
        
        if (data.success) {
            const agg = data.aggregations;
            
            // Summary
            const summaryContainer = document.getElementById('summaryContainer');
            if (agg.summary && agg.summary.total_events > 0) {
                summaryContainer.innerHTML = `
                    <table>
                        <tr>
                            <th>Total Events</th>
                            <td><strong>${agg.summary.total_events}</strong></td>
                        </tr>
                        <tr>
                            <th>Total Amount</th>
                            <td><strong>${agg.summary.total_amount?.toFixed(2) || 0}</strong></td>
                        </tr>
                        <tr>
                            <th>Average Amount</th>
                            <td>${agg.summary.avg_amount?.toFixed(2) || 0}</td>
                        </tr>
                        <tr>
                            <th>Min / Max</th>
                            <td>${agg.summary.min_amount?.toFixed(2) || 0} / ${agg.summary.max_amount?.toFixed(2) || 0}</td>
                        </tr>
                        <tr>
                            <th>Unique Clients</th>
                            <td>${agg.summary.unique_clients}</td>
                        </tr>
                        <tr>
                            <th>Unique Metrics</th>
                            <td>${agg.summary.unique_metrics}</td>
                        </tr>
                    </table>
                `;
            } else {
                summaryContainer.innerHTML = '<p class="empty-state">No data available</p>';
            }
            
            // By Client
            const byClientContainer = document.getElementById('byClientContainer');
            if (agg.byClient && agg.byClient.length > 0) {
                byClientContainer.innerHTML = `
                    <table>
                        <thead>
                            <tr>
                                <th>Client</th>
                                <th>Events</th>
                                <th>Total Amount</th>
                                <th>Avg Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${agg.byClient.map(item => `
                                <tr>
                                    <td><strong>${item.client_id}</strong></td>
                                    <td>${item.event_count}</td>
                                    <td><strong>${item.total_amount.toFixed(2)}</strong></td>
                                    <td>${item.avg_amount.toFixed(2)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
            } else {
                byClientContainer.innerHTML = '<p class="empty-state">No data available</p>';
            }
            
            // By Metric
            const byMetricContainer = document.getElementById('byMetricContainer');
            if (agg.byMetric && agg.byMetric.length > 0) {
                byMetricContainer.innerHTML = `
                    <table>
                        <thead>
                            <tr>
                                <th>Metric</th>
                                <th>Events</th>
                                <th>Total Amount</th>
                                <th>Avg Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${agg.byMetric.map(item => `
                                <tr>
                                    <td><strong>${item.metric}</strong></td>
                                    <td>${item.event_count}</td>
                                    <td><strong>${item.total_amount.toFixed(2)}</strong></td>
                                    <td>${item.avg_amount.toFixed(2)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
            } else {
                byMetricContainer.innerHTML = '<p class="empty-state">No data available</p>';
            }
        }
    } catch (error) {
        console.error('Error refreshing aggregations:', error);
    }
}

// Auto-refresh every 10 seconds
setInterval(refreshAll, 10000);
