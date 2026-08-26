const https = require('https');
const { URL } = require('url');

// Helper to generate UUID v4
const generateId = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

// Helper to make https requests
const makeRequest = (options, body = null) => {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data }));
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
};

exports.handler = async (event, context) => {
    // Handle CORS
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        const { message, history } = JSON.parse(event.body || '{}');
        
        // 1. Generate a new Journey ID if missing or use existing
        const journeyId = generateId();
        
        // 2. Setup Base Headers (Mimicking Browser)
        const baseHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Sec-Ch-Ua': '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            'X-Ddg-Journey-Id': journeyId,
            'Referer': 'https://duck.ai/',
            'Origin': 'https://duck.ai'
        };

        // 3. Initialize Chat (Required to get context tokens)
        // We send a payload to establish the session
        const chatPayload = {
            messages: history || [], // Send history if provided
            model: "llama-3.1-70b", // Default model, can be dynamic
            prompt: message,
            conversation_id: null, // New chat
            attachments: []
        };

        const chatResponse = await makeRequest({
            hostname: 'duck.ai',
            path: '/duckchat/v1/chat',
            method: 'POST',
            headers: {
                ...baseHeaders,
                'Accept': 'text/event-stream',
                'Content-Type': 'application/json',
                'X-Vqd-Accept': '1', // Often required
                'X-Fe-Version': 'serp_20260825_133734_ET-ea4548e57b2e941ae25474516138826d8bb4d6ab' // Using a static version for stability
            }
        }, chatPayload);

        // 4. Parse the SSE (Server-Sent Events) response
        // The response comes in chunks. We need to parse the JSON events.
        const lines = chatResponse.data.split('\n');
        let fullResponse = "";
        
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const jsonStr = line.slice(6);
                try {
                    const parsed = JSON.parse(jsonStr);
                    if (parsed.type === 'message' && parsed.delta) {
                        fullResponse += parsed.delta;
                    }
                    // Handle other types like 'search_results' if needed
                } catch (e) {
                    // Ignore parse errors on incomplete chunks
                }
            }
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                response: fullResponse,
                journeyId: journeyId
            })
        };

    } catch (error) {
        console.error(error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ success: false, error: error.message })
        };
    }
};
