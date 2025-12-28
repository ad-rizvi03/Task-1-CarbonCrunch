// Quick test script to verify the system works
const testEvent = {
  source: "client_A",
  payload: {
    metric: "revenue",
    amount: "1200",
    timestamp: "2024/01/01"
  }
};

console.log('Testing Fault-Tolerant Data Processing System...\n');

// Test 1: Submit event
fetch('http://localhost:3000/api/events', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(testEvent)
})
.then(res => res.json())
.then(data => {
  console.log('✓ Test 1 - Submit Event:', data.success ? 'PASSED' : 'FAILED');
  console.log('  Response:', JSON.stringify(data, null, 2));
  
  // Test 2: Submit duplicate
  return fetch('http://localhost:3000/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testEvent)
  });
})
.then(res => res.json())
.then(data => {
  console.log('\n✓ Test 2 - Duplicate Detection:', data.isDuplicate ? 'PASSED' : 'FAILED');
  console.log('  Response:', JSON.stringify(data, null, 2));
  
  // Test 3: Get events
  return fetch('http://localhost:3000/api/events');
})
.then(res => res.json())
.then(data => {
  console.log('\n✓ Test 3 - Get Events:', data.success ? 'PASSED' : 'FAILED');
  console.log(`  Events retrieved: ${data.events.length}`);
  
  // Test 4: Get aggregations
  return fetch('http://localhost:3000/api/aggregations');
})
.then(res => res.json())
.then(data => {
  console.log('\n✓ Test 4 - Get Aggregations:', data.success ? 'PASSED' : 'FAILED');
  console.log('  Summary:', JSON.stringify(data.aggregations.summary, null, 2));
  
  console.log('\n✅ All tests completed!');
  console.log('\nOpen http://localhost:3000 in your browser to use the UI');
})
.catch(error => {
  console.error('❌ Test failed:', error.message);
});
