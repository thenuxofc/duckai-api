const https = require('https');
const { URL } = require('url');

const generateId = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

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
        
        // 1. Generate IDs
        const journeyId = generateId();
        const vqdHash = Buffer.from(journeyId).toString('base64').substring(0, 30);

        // 2. Base Headers
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
            'X-Vqd-Accept': '1',
            'X-Vqd-Hash-1': vqdHash,
            'Referer': 'https://duck.ai/',
            'Origin': 'https://duck.ai'
        };

        // 3. Fetch Capabilities to find the RIGHT model
        const capabilitiesResponse = await makeRequest({
            hostname: 'duck.ai',
            path: '/duckchat/v1/capabilities',
            method: 'GET',
            headers: {
                ...baseHeaders,
                'Accept': 'application/json'
            }
        });

        let modelId = "llama-3.1-70b"; // Fallback
        try {
            const capData = JSON.parse(capabilitiesResponse.data);
            // Duck.ai structure varies, but usually has a 'models' or 'selectedModel' field
            if (capData.models && capData.models.length > 0) {
                // Pick the first available model, or the one marked as default
                modelId = capData.models[0].id || capData.selectedModelId || "llama-3.1-70b";
            } else if (capData.selectedModelId) {
                modelId = capData.selectedModelId;
            }
        } catch (e) {
            console.log("Could not parse capabilities, using fallback model.");
        }

        // 4. Prepare Payload
        const chatPayload = {
            messages: history ? history.map(h => ({
                role: h.role === 'user' ? 'human' : 'assistant',
                content: h.content
            })) : [],
            prompt: message,
            model: modelId, // <--- Use the dynamically fetched model
            conversation_id: null,
            attachments: []
        };

        // 5. Send Chat Request
        const chatResponse = await makeRequest({
            hostname: 'duck.ai',
            path: '/duckchat/v1/chat',
            method: 'POST',
            headers: {
                ...baseHeaders,
                'Accept': 'text/event-stream',
                'Content-Type': 'application/json',
                'Priority': 'u=1, i',
                'X-Fe-Version': 'serp_20260826_073900_ET-static' 
            }
        }, chatPayload);

        // 6. Parse SSE Response
        const lines = chatResponse.data.split('\n');
        let fullResponse = "";
        
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const jsonStr = line.slice(6).trim();
                if (!jsonStr) continue;
                
                try {
                    const parsed = JSON.parse(jsonStr);
                    if (parsed.type === 'message' && parsed.delta) {
                        fullResponse += parsed.delta;
                    }
                } catch (e) {
                    // Ignore malformed chunks
                }
            }
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                response: fullResponse,
                journeyId: journeyId,
                model: modelId
            })
        };

    } catch (error) {
        console.error("Scrape Error:", error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ success: false, error: error.message })
        };
    }
};
