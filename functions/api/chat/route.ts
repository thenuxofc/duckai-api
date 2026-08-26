// functions/api/chat/route.ts
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';

// In-memory store for sessions (Use a database for production scale)
const sessionStore: Record<string, any> = {};

export const config = {
  runtime: 'edge', // Use 'edge' for better performance on Netlify
};

export async function POST(request: Request) {
  try {
    const { message, sessionId } = await request.json();
    
    // Generate or retrieve session ID
    const sid = sessionId || uuidv4();
    if (!sessionStore[sid]) {
      sessionStore[sid] = [];
    }

    // Add user message to history
    sessionStore[sid].push({ role: 'user', content: message });

    // 1. Authenticate & Get Token
    const tokenResponse = await fetch('https://duck.ai/duckchat/v1/auth/token', {
      headers: {
        'Accept': '*/*',
        'Sec-Ch-Ua': '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      },
      credentials: 'omit',
    });

    if (!tokenResponse.ok) {
      throw new Error(`Auth failed: ${tokenResponse.status}`);
    }

    const tokenData = await tokenResponse.json();
    const xVqdHash = tokenData?.data?.xVqdHash || tokenData?.xVqdHash;

    if (!xVqdHash) {
      throw new Error('Could not extract X-VQD-HASH from auth response.');
    }

    // 2. Send Request to Chat API
    const chatUrl = 'https://duck.ai/duckchat/v1/chat';
    
    const response = await fetch(chatUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Sec-Ch-Ua': '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'X-VQD-HASH': xVqdHash, // Crucial for DuckAI API
        'X-DDG-Journey-Id': uuidv4(), // Generate a fresh journey ID
      },
      body: JSON.stringify({
        history: sessionStore[sid], // Send full history for memory
        message: message,
        model: 'gpt-4o', // Default to GPT-4o, can be changed
        plugins: [],
        searchResults: [],
      }),
      // Do not wait for the full response; stream it
    });

    if (!response.ok) {
      throw new Error(`Chat API failed: ${response.status}`);
    }

    // 3. Stream the response as JSON
    const reader = response.body?.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          let fullResponse = '';
          let assistantMessageId = null;

          while (true) {
            const { done, value } = await reader!.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const dataStr = line.slice(6).trim();
                if (dataStr === '[DONE]') continue;

                try {
                  const data = JSON.parse(dataStr);
                  
                  // DuckAI sends SSE events. We need to parse them.
                  // Usually, the assistant message is in 'message' field or 'delta'
                  if (data.type === 'message' && data.role === 'assistant') {
                    assistantMessageId = data.id;
                  }
                  
                  if (data.delta) {
                    fullResponse += data.delta;
                    
                    // Send each token as a JSON object for the client
                    controller.enqueue(encoder.encode(JSON.stringify({
                      type: 'token',
                      content: data.delta,
                      id: assistantMessageId
                    }) + '\n'));
                  }
                } catch (e) {
                  // Skip malformed JSON lines
                }
              }
            }
          }

          // Save assistant response to memory
          sessionStore[sid].push({ role: 'assistant', content: fullResponse });

          // Send final summary
          controller.enqueue(encoder.encode(JSON.stringify({
            type: 'end',
            content: fullResponse,
            id: assistantMessageId,
            sessionId: sid
          }) + '\n'));

        } catch (error) {
          controller.enqueue(encoder.encode(JSON.stringify({
            type: 'error',
            error: (error as Error).message
          }) + '\n'));
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
