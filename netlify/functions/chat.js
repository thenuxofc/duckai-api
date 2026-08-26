// Step 1: Get a fresh x-vqd-4 token
const journeyId = uuidv4();
console.log('Fetching status with journey id:', journeyId);

const statusResponse = await fetch('https://duck.ai/duckchat/v1/status', {
  method: 'GET',
  headers: {
    ...browserHeaders,
    'x-ddg-journey-id': journeyId,
    'x-vqd-accept': '1',
  },
});

console.log('Status response status:', statusResponse.status);
console.log('Status response headers:', JSON.stringify(Object.fromEntries(statusResponse.headers)));

// Read body for debugging
const statusBodyText = await statusResponse.text();
console.log('Status response body:', statusBodyText.substring(0, 500));

if (!statusResponse.ok) {
  return {
    statusCode: statusResponse.status,
    headers: corsHeaders,
    body: JSON.stringify({ error: `Failed to get token from Duck.ai (status ${statusResponse.status}), body: ${statusBodyText.substring(0, 200)}` }),
  };
}

// Try to get token from header or body
let vqd4Token = statusResponse.headers.get('x-vqd-4');
if (!vqd4Token) {
  // Attempt to parse JSON body (some versions may return token in body)
  try {
    const statusJson = JSON.parse(statusBodyText);
    vqd4Token = statusJson.token || statusJson['x-vqd-4'] || statusJson.vqd4;
    console.log('Extracted token from body:', vqd4Token);
  } catch (e) {
    console.error('Could not parse status body as JSON');
  }
}

if (!vqd4Token) {
  console.error('x-vqd-4 token missing from both header and body');
  return {
    statusCode: 500,
    headers: corsHeaders,
    body: JSON.stringify({ error: 'No x-vqd-4 token received from Duck.ai' }),
  };
}
