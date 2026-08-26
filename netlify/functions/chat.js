// netlify/functions/chat.js
const fetch = require('node-fetch');

// Generate a random UUID (not strictly required but can be used)
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// CORS headers (Netlify functions are same-origin with frontend, but good for local dev)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  // Handle preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: '',
    };
  }

  // Only POST allowed
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  try {
    // Parse the incoming conversation
    const { messages } = JSON.parse(event.body);
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid request body. "messages" array is required.' }),
      };
    }

    // 1. Get a fresh x-vqd-4 token from Duck.ai status endpoint
    const statusResponse = await fetch('https://duck.ai/duckchat/v1/status', {
      method: 'GET',
      headers: {
        'x-vqd-accept': '1',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
        'Referer': 'https://duck.ai/',
        'Accept': '*/*',
      },
    });

    if (!statusResponse.ok) {
      return {
        statusCode: statusResponse.status,
        headers: corsHeaders,
        body: JSON.stringify({ error: `Failed to get token from Duck.ai (status ${statusResponse.status})` }),
      };
    }

    const vqd4Token = statusResponse.headers.get('x-vqd-4');
    if (!vqd4Token) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No x-vqd-4 token received from Duck.ai' }),
      };
    }

    // 2. Prepare the chat request payload
    //    Adjust model name if needed (inspect Duck.ai network traffic for current model)
    const chatPayload = {
      model: 'gpt-5.6-luna', // <-- update if Duck.ai uses a different model now
      messages: messages,
      canUseTools: false,
      reasoningEffort: 'none',
    };

    // 3. Forward the chat request to Duck.ai
    const chatResponse = await fetch('https://duck.ai/duckchat/v1/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-vqd-4': vqd4Token,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
        'Accept': 'text/event-stream',
        'Referer': 'https://duck.ai/',
        // The following headers may be required in some cases:
        // 'x-ddg-journey-id': uuidv4(),
        // 'x-vqd-hash-1': '...'   // <-- PROOF OF WORK REQUIRED, see notes below
      },
      body: JSON.stringify(chatPayload),
    });

    if (!chatResponse.ok) {
      const errorText = await chatResponse.text();
      console.error('Duck.ai chat error:', errorText);
      return {
        statusCode: chatResponse.status,
        headers: corsHeaders,
        body: JSON.stringify({ error: `Duck.ai chat API error: ${errorText.substring(0, 200)}` }),
      };
    }

    // 4. Stream the response back to the client
    //    Node's fetch returns a web ReadableStream, which Netlify can stream directly.
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
