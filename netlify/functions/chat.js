// netlify/functions/chat.js
const crypto = require('crypto');

// Generate a UUID for journey id (crypto.randomUUID is available in Node 16+)
function uuidv4() {
  return crypto.randomUUID();
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Browser-like headers to mimic a real Chrome request
const browserHeaders = {
  'accept': '*/*',
  'accept-language': 'en-GB,en;q=0.9,si-LK;q=0.8,si;q=0.7,en-US;q=0.6,hi;q=0.5',
  'cache-control': 'no-store',
  'priority': 'u=1, i',
  'sec-ch-ua': '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  'Referer': 'https://duck.ai/',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  try {
    const { messages } = JSON.parse(event.body);
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid request body. "messages" array is required.' }),
      };
    }

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
    console.log('Status response headers:', JSON.stringify([...statusResponse.headers.entries()]));

    if (!statusResponse.ok) {
      const statusText = await statusResponse.text();
      console.error('Status request failed:', statusText);
      return {
        statusCode: statusResponse.status,
        headers: corsHeaders,
        body: JSON.stringify({ error: `Failed to get token from Duck.ai (status ${statusResponse.status})` }),
      };
    }

    const vqd4Token = statusResponse.headers.get('x-vqd-4');
    if (!vqd4Token) {
      console.error('x-vqd-4 header missing in status response');
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No x-vqd-4 token received from Duck.ai' }),
      };
    }

    console.log('Got x-vqd-4 token (first 10 chars):', vqd4Token.substring(0, 10));

    // Step 2: Prepare chat payload
    const chatPayload = {
      model: 'gpt-5.6-luna', // Update if needed
      messages: messages,
      canUseTools: false,
      reasoningEffort: 'none',
    };

    // Step 3: Forward the chat request
    const chatResponse = await fetch('https://duck.ai/duckchat/v1/chat', {
      method: 'POST',
      headers: {
        ...browserHeaders,
        'Content-Type': 'application/json',
        'x-vqd-4': vqd4Token,
        'x-ddg-journey-id': journeyId,
        'Accept': 'text/event-stream',
        // Note: 'x-vqd-hash-1' proof-of-work may be required; we are not sending it yet.
      },
      body: JSON.stringify(chatPayload),
    });

    if (!chatResponse.ok) {
      const errorText = await chatResponse.text();
      console.error('Chat request failed:', errorText);
      return {
        statusCode: chatResponse.status,
        headers: corsHeaders,
        body: JSON.stringify({ error: `Duck.ai chat API error: ${errorText.substring(0, 200)}` }),
      };
    }

    // Step 4: Stream the response back
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
      body: chatResponse.body,
    };

  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal Server Error: ' + error.message }),
    };
  }
};
