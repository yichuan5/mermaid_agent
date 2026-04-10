import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';

// ── Helpers ─────────────────────────────────────────────────────

async function blockExternalRequests(page: Page) {
    await page.route('**/*.googleapis.com/**', (route) => route.abort());
    await page.route('**/*.gstatic.com/**', (route) => route.abort());
}

async function waitForHydration(page: Page) {
    await page.locator('[data-hydrated]').waitFor({ state: 'attached', timeout: 10_000 });
}

/**
 * Mock the WebSocket endpoint. The `handler` receives each parsed message
 * from the frontend and can send responses back via `ws.send()`.
 */
async function mockWebSocket(
    page: Page,
    handler: (msg: any, ws: WebSocketRoute) => void | Promise<void>,
) {
    await page.routeWebSocket('**/api/chat/ws', (ws) => {
        ws.onMessage(async (data) => {
            const msg = JSON.parse(data.toString());
            await handler(msg, ws);
        });
    });
}

/**
 * Convenience: mock a simple WS turn that replies with just text (no diagram edit).
 */
async function mockSimpleWsReply(
    page: Page,
    reply: {
        explanation?: string;
        follow_up_commands?: string[];
    },
) {
    await mockWebSocket(page, (msg, ws) => {
        if (msg.type === 'user_message' || msg.type === 'image_upload') {
            ws.send(JSON.stringify({
                type: 'message',
                content: reply.explanation ?? '',
                follow_up_commands: reply.follow_up_commands ?? [],
            }));
            ws.send(JSON.stringify({ type: 'done' }));
        }
    });
}

/**
 * Mock a WS turn that simulates the edit_diagram tool flow:
 * sends a render_and_capture tool request, waits for the client's tool_result,
 * then sends the final message.
 */
async function mockWsWithDiagram(
    page: Page,
    reply: {
        mermaid_code: string;
        explanation?: string;
        follow_up_commands?: string[];
    },
) {
    await mockWebSocket(page, (msg, ws) => {
        if (msg.type === 'user_message' || msg.type === 'image_upload') {
            ws.send(JSON.stringify({
                type: 'tool_request',
                id: 'tool-' + Math.random().toString(36).slice(2),
                name: 'render_and_capture',
                args: { mermaid_code: reply.mermaid_code },
            }));
        } else if (msg.type === 'tool_result') {
            ws.send(JSON.stringify({
                type: 'message',
                content: reply.explanation ?? '',
                follow_up_commands: reply.follow_up_commands ?? [],
            }));
            ws.send(JSON.stringify({ type: 'done' }));
        }
    });
}


// ── Tests ───────────────────────────────────────────────────────

test('sending a message displays AI response and renders a diagram', async ({ page }) => {
    await mockWsWithDiagram(page, {
        mermaid_code: 'flowchart TD\n    A[Hello] --> B[World]',
        explanation: 'Here is a simple flowchart.',
        follow_up_commands: ['Add more nodes'],
    });

    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    const textarea = page.locator('.chat-panel textarea');
    await textarea.fill('Draw a simple hello world flowchart');
    await page.locator('#chat-send-btn').click();

    await expect(
        page.locator('.message.assistant .message-bubble').nth(1),
    ).toContainText('Here is a simple flowchart.', { timeout: 10_000 });

    const previewSvg = page.locator('.diagram-wrapper svg');
    await expect(previewSvg).toBeVisible({ timeout: 10_000 });

    const svgContent = await previewSvg.innerHTML();
    expect(svgContent.length).toBeGreaterThan(0);
});

test('shows error message when agent returns an error', async ({ page }) => {
    await mockWebSocket(page, (msg, ws) => {
        if (msg.type === 'user_message') {
            ws.send(JSON.stringify({ type: 'error', message: 'LLM failed' }));
            ws.send(JSON.stringify({ type: 'done' }));
        }
    });

    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    const textarea = page.locator('.chat-panel textarea');
    await textarea.fill('Make me a diagram');
    await page.locator('#chat-send-btn').click();

    await expect(
        page.locator('.message.assistant .message-bubble').nth(1),
    ).toContainText('Error', { timeout: 10_000 });

    await expect(page.locator('.thinking-badge')).not.toBeVisible();
});

test('image upload generates a diagram', async ({ page }) => {
    await mockWsWithDiagram(page, {
        mermaid_code: 'flowchart LR\n    X[From Image] --> Y[Converted]',
        explanation: 'I converted your image to a Mermaid diagram.',
    });

    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
        'base64',
    );

    const fileInput = page.locator('.chat-panel input[type="file"]');
    await page.waitForFunction(() => {
        const input = document.querySelector('.chat-panel input[type="file"]');
        return input && Object.getOwnPropertySymbols(input).length > 0;
    }, null, { timeout: 10_000 });

    await fileInput.setInputFiles({
        name: 'test-image.png',
        mimeType: 'image/png',
        buffer: pngBuffer,
    });

    await expect(page.locator('.image-preview')).toBeVisible({ timeout: 5_000 });
    await page.locator('#chat-send-btn').click();

    await expect(
        page.locator('.message.assistant .message-bubble').nth(1),
    ).toContainText('I converted your image', { timeout: 10_000 });

    const previewSvg = page.locator('.diagram-wrapper svg');
    await expect(previewSvg).toBeVisible({ timeout: 10_000 });
});

test('clicking Fix with AI button sends a fix request via WebSocket', async ({ page }) => {
    const wsPayloads: any[] = [];

    await mockWebSocket(page, (msg, ws) => {
        if (msg.type === 'user_message') {
            wsPayloads.push(msg);
            ws.send(JSON.stringify({
                type: 'tool_request',
                id: 'fix-tool-' + Math.random().toString(36).slice(2),
                name: 'render_and_capture',
                args: { mermaid_code: 'flowchart TD\n    A[Fixed]' },
            }));
        } else if (msg.type === 'tool_result') {
            ws.send(JSON.stringify({
                type: 'message',
                content: 'Fixed the diagram.',
                follow_up_commands: [],
            }));
            ws.send(JSON.stringify({ type: 'done' }));
        }
    });

    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    const editor = page.locator('.cm-content');
    await editor.click();
    await editor.fill('invalid mermaid code');

    const fixBtn = page.locator('.fix-btn');
    await expect(fixBtn).toBeVisible({ timeout: 10_000 });
    await fixBtn.click();

    await expect(page.locator('.diagram-wrapper svg')).toBeVisible({ timeout: 10_000 });
    expect(wsPayloads.length).toBeGreaterThanOrEqual(1);
    expect(wsPayloads[0].message).toContain('Fix the rendering error');
});

test('follow-up messages both render diagrams', async ({ page }) => {
    let requestCount = 0;

    await mockWebSocket(page, (msg, ws) => {
        if (msg.type === 'user_message') {
            requestCount++;
            const code = requestCount === 1
                ? 'flowchart TD\n    A[Start] --> B[End]'
                : 'flowchart TD\n    A[Start] --> B[Middle] --> C[End]';
            ws.send(JSON.stringify({
                type: 'tool_request',
                id: 'tool-' + requestCount,
                name: 'render_and_capture',
                args: { mermaid_code: code },
            }));
        } else if (msg.type === 'tool_result') {
            const isFirst = requestCount === 1;
            ws.send(JSON.stringify({
                type: 'message',
                content: isFirst ? 'First diagram.' : 'Updated diagram.',
                follow_up_commands: ['Add a step'],
            }));
            ws.send(JSON.stringify({ type: 'done' }));
        }
    });

    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    const textarea = page.locator('.chat-panel textarea');
    await textarea.fill('Draw a simple flowchart');
    await page.locator('#chat-send-btn').click();

    await expect(
        page.locator('.message.assistant .message-bubble').nth(1),
    ).toContainText('First diagram.', { timeout: 10_000 });
    await expect(page.locator('.diagram-wrapper svg')).toBeVisible({ timeout: 10_000 });

    await textarea.fill('Add another step in the middle');
    await page.locator('#chat-send-btn').click();

    await expect(
        page.locator('.message.assistant .message-bubble').nth(2),
    ).toContainText('Updated diagram.', { timeout: 10_000 });
    await expect(page.locator('.diagram-wrapper svg')).toBeVisible({ timeout: 10_000 });

    const errorMessages = page.locator('.message.assistant .message-bubble').filter({ hasText: 'Error:' });
    await expect(errorMessages).toHaveCount(0);
    expect(requestCount).toBe(2);
});

test('chart type dropdown is visible', async ({ page }) => {
    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    const chartSelect = page.locator('#chart-select');
    await expect(chartSelect).toBeVisible();
    await expect(chartSelect).toHaveValue('');
});

test('chart_type is included in WebSocket payload', async ({ page }) => {
    const wsPayloads: any[] = [];

    await mockWebSocket(page, (msg, ws) => {
        if (msg.type === 'user_message') {
            wsPayloads.push(msg);
            ws.send(JSON.stringify({
                type: 'message',
                content: 'A sequence diagram.',
                follow_up_commands: [],
            }));
            ws.send(JSON.stringify({ type: 'done' }));
        }
    });

    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    await page.locator('#chart-select').selectOption('sequenceDiagram');
    await page.locator('#chart-select').dispatchEvent('change');

    const textarea = page.locator('.chat-panel textarea');
    await textarea.fill('Draw a sequence diagram');
    await page.locator('#chat-send-btn').click();

    await expect(
        page.locator('.message.assistant .message-bubble').nth(1),
    ).toContainText('A sequence diagram.', { timeout: 10_000 });

    expect(wsPayloads.length).toBe(1);
    expect(wsPayloads[0].chart_type).toBe('sequenceDiagram');
});

test('preview panel shows Mermaid and AI Enhanced tabs', async ({ page }) => {
    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    const mermaidTab = page.locator('.preview-tab').filter({ hasText: 'Mermaid' });
    const enhancedTab = page.locator('.preview-tab').filter({ hasText: 'AI Enhanced' });

    await expect(mermaidTab).toBeVisible();
    await expect(enhancedTab).toBeVisible();
    await expect(mermaidTab).toHaveClass(/active/);
});

test('AI Enhanced tab shows placeholder when no enhanced image exists', async ({ page }) => {
    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    await page.locator('.preview-tab').filter({ hasText: 'AI Enhanced' }).click();

    await expect(page.locator('.enhance-placeholder')).toBeVisible();
    await expect(page.locator('.enhance-placeholder')).toContainText('No enhanced image yet');
});

test('clicking the code editor activates the Mermaid tab', async ({ page }) => {
    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    // Switch to AI Enhanced tab first
    await page.locator('.preview-tab').filter({ hasText: 'AI Enhanced' }).click();
    const enhancedTab = page.locator('.preview-tab').filter({ hasText: 'AI Enhanced' });
    await expect(enhancedTab).toHaveClass(/active/);

    // Click into the code editor
    await page.locator('.cm-content').click();

    // Mermaid tab should now be active
    const mermaidTab = page.locator('.preview-tab').filter({ hasText: 'Mermaid' });
    await expect(mermaidTab).toHaveClass(/active/, { timeout: 3_000 });
});

test('WebSocket enhanced_image event switches to AI Enhanced tab', async ({ page }) => {
    await mockWebSocket(page, (msg, ws) => {
        if (msg.type === 'user_message') {
            ws.send(JSON.stringify({
                type: 'enhanced_image',
                image: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
            }));
            ws.send(JSON.stringify({
                type: 'message',
                content: 'Here is your diagram with enhancement.',
                follow_up_commands: [],
            }));
            ws.send(JSON.stringify({ type: 'done' }));
        }
    });

    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    const textarea = page.locator('.chat-panel textarea');
    await textarea.fill('Draw and enhance a flowchart');
    await page.locator('#chat-send-btn').click();

    // The AI Enhanced tab should become active after receiving enhanced_image
    const enhancedTab = page.locator('.preview-tab').filter({ hasText: 'AI Enhanced' });
    await expect(enhancedTab).toHaveClass(/active/, { timeout: 15_000 });

    // Verify the enhanced image is displayed
    await expect(page.locator('.enhanced-wrapper img')).toBeVisible({ timeout: 5_000 });
});

test('follow-up message after fix sends history via WebSocket', async ({ page }) => {
    const wsPayloads: any[] = [];
    let requestCount = 0;

    await mockWebSocket(page, (msg, ws) => {
        if (msg.type === 'user_message') {
            requestCount++;
            wsPayloads.push(msg);
            ws.send(JSON.stringify({
                type: 'tool_request',
                id: 'tool-' + requestCount,
                name: 'render_and_capture',
                args: { mermaid_code: 'flowchart TD\n    A[Start] --> B[End]' },
            }));
        } else if (msg.type === 'tool_result') {
            ws.send(JSON.stringify({
                type: 'message',
                content: requestCount === 1 ? 'First diagram.' : 'Updated diagram.',
                follow_up_commands: [],
            }));
            ws.send(JSON.stringify({ type: 'done' }));
        }
    });

    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    // First chat request
    const textarea = page.locator('.chat-panel textarea');
    await textarea.fill('Draw a diagram');
    await page.locator('#chat-send-btn').click();

    await expect(
        page.locator('.message.assistant .message-bubble').nth(1),
    ).toContainText('First diagram.', { timeout: 10_000 });

    // Trigger a manual fix via the editor
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('invalid mermaid code');

    const fixBtn = page.locator('.fix-btn');
    await expect(fixBtn).toBeVisible({ timeout: 10_000 });
    await fixBtn.click();

    await expect(page.locator('.diagram-wrapper svg')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.thinking-badge')).not.toBeVisible({ timeout: 5_000 });

    // Send follow-up
    await textarea.fill('Now add a third node');
    await page.locator('#chat-send-btn').click();

    await expect(
        page.locator('.message.assistant .message-bubble').last(),
    ).toContainText('Updated diagram.', { timeout: 10_000 });

    // No error messages
    const errorMessages = page.locator('.message.assistant .message-bubble').filter({ hasText: 'Error:' });
    await expect(errorMessages).toHaveCount(0);

    // History must strictly alternate user / assistant
    expect(wsPayloads.length).toBeGreaterThanOrEqual(2);
    const history: { role: string }[] = wsPayloads[wsPayloads.length - 1].history ?? [];
    for (let i = 1; i < history.length; i++) {
        expect(
            history[i].role,
            `History entry ${i} ("${history[i].role}") must not follow entry ${i - 1} ("${history[i - 1].role}")`,
        ).not.toBe(history[i - 1].role);
    }
});
