import { test, expect, type Page } from '@playwright/test';

// Block external requests (Google Fonts) that hang in WSL2 and prevent page load
async function blockExternalRequests(page: Page) {
    await page.route('**/*.googleapis.com/**', (route) => route.abort());
    await page.route('**/*.gstatic.com/**', (route) => route.abort());
}

// Wait for Svelte hydration (the app sets data-hydrated after onMount)
async function waitForHydration(page: Page) {
    await page.locator('[data-hydrated]').waitFor({ state: 'attached', timeout: 10_000 });
}

// Select an option and dispatch a bubbling change event (works with Svelte 5 event delegation)
async function svelteSelect(page: Page, selector: string, value: string) {
    await page.locator(selector).selectOption(value);
    await page.locator(selector).dispatchEvent('change');
}

// Default enhance mock: returns no enhancement (used by most tests)
function mockEnhanceSkip(page: Page) {
    return page.route('**/api/enhance', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ enhanced_image: null, explanation: 'No enhancement needed.' }),
        }),
    );
}

test('sending a message displays AI response and renders a diagram', async ({ page }) => {
    // ── Mock the backend API ─────────────────────────────────────
    await page.route('**/api/chat', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                mermaid_code: 'flowchart TD\n    A[Hello] --> B[World]',
                explanation: 'Here is a simple flowchart.',
                needs_clarification: false,
            }),
        }),
    );
    await mockEnhanceSkip(page);

    // ── Load the app ─────────────────────────────────────────────
    await blockExternalRequests(page);
    await page.goto('/');

    await waitForHydration(page);

    // ── Send a chat message ──────────────────────────────────────
    const textarea = page.locator('.chat-panel textarea');
    await textarea.fill('Draw a simple hello world flowchart');
    await page.locator('#chat-send-btn').click();

    // ── Assert the AI response appears in the chat ───────────────
    await expect(
        page.locator('.message.assistant .message-bubble').nth(1),
    ).toContainText('Here is a simple flowchart.', { timeout: 10_000 });

    // ── Assert a Mermaid diagram (SVG) rendered in the preview ───
    const previewSvg = page.locator('.diagram-wrapper svg');
    await expect(previewSvg).toBeVisible({ timeout: 10_000 });

    // Verify the SVG actually contains content from our mocked code
    const svgContent = await previewSvg.innerHTML();
    expect(svgContent.length).toBeGreaterThan(0);
});

test('shows error message when backend is down', async ({ page }) => {
    // ── Mock the backend to simulate a network failure ──────────
    await page.route('**/api/chat', (route) =>
        route.abort('connectionrefused'),
    );

    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    // ── Send a message ──────────────────────────────────────────
    const textarea = page.locator('.chat-panel textarea');
    await textarea.fill('Make me a diagram');
    await page.locator('#chat-send-btn').click();

    // ── Assert an error message appears ─────────────────────────
    await expect(
        page.locator('.message.assistant .message-bubble').nth(1),
    ).toContainText('Error', { timeout: 10_000 });

    // ── Assert the loading spinner is gone ───────────────────────
    await expect(page.locator('.thinking-badge')).not.toBeVisible();
});

test('image upload generates a diagram', async ({ page }) => {
    // ── Mock the image upload endpoint ──────────────────────────
    await page.route('**/api/chat/image', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                mermaid_code: 'flowchart LR\n    X[From Image] --> Y[Converted]',
                explanation: 'I converted your image to a Mermaid diagram.',
                needs_clarification: false,
            }),
        }),
    );
    await mockEnhanceSkip(page);

    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    // ── Create a tiny test PNG in memory ────────────────────────
    // 1×1 red pixel PNG (smallest valid PNG)
    const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
        'base64',
    );

    // ── Wait for Svelte hydration (event delegation set up) ─────
    const fileInput = page.locator('.chat-panel input[type="file"]');
    await page.waitForFunction(() => {
        const input = document.querySelector('.chat-panel input[type="file"]');
        return input && Object.getOwnPropertySymbols(input).length > 0;
    }, null, { timeout: 10_000 });

    // ── Upload the image via the hidden file input ──────────────
    await fileInput.setInputFiles({
        name: 'test-image.png',
        mimeType: 'image/png',
        buffer: pngBuffer,
    });

    // ── Assert the image preview appears ─────────────────────────
    await expect(page.locator('.image-preview')).toBeVisible({ timeout: 5_000 });

    // ── Click send to submit ────────────────────────────────────
    await page.locator('#chat-send-btn').click();

    // ── Assert the AI response appears ──────────────────────────
    await expect(
        page.locator('.message.assistant .message-bubble').nth(1),
    ).toContainText('I converted your image', { timeout: 10_000 });

    // ── Assert a diagram SVG rendered ───────────────────────────
    const previewSvg = page.locator('.diagram-wrapper svg');
    await expect(previewSvg).toBeVisible({ timeout: 10_000 });
});

test('stops auto-fixing after max retries when code is invalid', async ({ page }) => {
    let chatRequests = 0;
    let fixRequests = 0;
    const fixPayloads: any[] = [];
    await mockEnhanceSkip(page);

    // ── Mock the backend to always return invalid Mermaid code ────
    await page.route('**/api/chat', (route) => {
        chatRequests++;
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                mermaid_code: `flowchart TD\n    A[Hello] -- Broken`, // invalid syntax
                explanation: 'Here is your diagram.',
                follow_up_commands: [],
            }),
        });
    });

    await page.route('**/api/fix', async (route) => {
        fixRequests++;
        // Capture the request body to verify fix_attempts history
        const body = route.request().postDataJSON();
        fixPayloads.push(body);
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                mermaid_code: `flowchart TD\n    A[Hello] -- Still Broken ${fixRequests}`, // still invalid
                explanation: 'Tried to fix.',
                follow_up_commands: [],
            }),
        });
    });

    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    // ── Send a message ──────────────────────────────────────────
    const textarea = page.locator('.chat-panel textarea');
    await textarea.fill('Draw a flowchart');
    await page.locator('#chat-send-btn').click();

    // The first response triggers the first render error, which triggers auto-fix 1.
    // The auto-fix 1 returns broken code, triggers auto-fix 2.
    // The auto-fix 2 returns broken code, triggers auto-fix 3.
    // The auto-fix 3 returns broken code, which triggers the max limit message.

    // ── Assert the final max limit system message appears ─────────
    const systemMessage = page.locator('.message.system .message-bubble').last();
    await expect(systemMessage).toContainText(
        'Auto-fix limit reached (3 attempts). Please fix the code manually.',
        { timeout: 15_000 }
    );

    // 1 chat request + 3 fix requests
    expect(chatRequests).toBe(1);
    expect(fixRequests).toBe(3);

    // ── Verify fix_attempts accumulates correctly across attempts ──
    // Attempt 1: no prior history
    expect(fixPayloads[0].fix_attempts).toHaveLength(0);
    // Attempt 2: 1 prior attempt
    expect(fixPayloads[1].fix_attempts).toHaveLength(1);
    // Attempt 3: 2 prior attempts
    expect(fixPayloads[2].fix_attempts).toHaveLength(2);
});

test('clicking Fix with AI button triggers a fix request', async ({ page }) => {
    let fixRequests = 0;
    await mockEnhanceSkip(page);
    await page.route('**/api/fix', async (route) => {
        fixRequests++;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                mermaid_code: 'flowchart TD\n    A[Fixed]',
                explanation: 'Fixed the diagram.',
                follow_up_commands: [],
            }),
        });
    });

    await blockExternalRequests(page);
    await page.goto('/');

    // Type invalid code to trigger render error
    const editor = page.locator('.cm-content');
    await editor.click();
    await editor.fill('invalid mermaid code');

    // Wait for the "Fix with AI" button to appear
    const fixBtn = page.locator('.fix-btn');
    await expect(fixBtn).toBeVisible({ timeout: 10_000 });

    // Click the button
    await fixBtn.click();

    // Verify it sent a request
    expect(fixRequests).toBe(1);

    // Verify the code gets updated
    await expect(page.locator('.diagram-wrapper svg')).toBeVisible({ timeout: 10_000 });
});


test('initial message followed by a follow-up message both render diagrams without errors', async ({ page }) => {
    let requestCount = 0;
    await mockEnhanceSkip(page);

    await page.route('**/api/chat', (route) => {
        requestCount++;
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                mermaid_code: requestCount === 1
                    ? 'flowchart TD\n    A[Start] --> B[End]'
                    : 'flowchart TD\n    A[Start] --> B[Middle] --> C[End]',
                explanation: requestCount === 1 ? 'First diagram.' : 'Updated diagram.',
                follow_up_commands: ['Add a step', 'Change direction'],
            }),
        });
    });

    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    // ── First message ────────────────────────────────────────────
    const textarea = page.locator('.chat-panel textarea');
    await textarea.fill('Draw a simple flowchart');
    await page.locator('#chat-send-btn').click();

    await expect(
        page.locator('.message.assistant .message-bubble').nth(1),
    ).toContainText('First diagram.', { timeout: 10_000 });
    await expect(page.locator('.diagram-wrapper svg')).toBeVisible({ timeout: 10_000 });

    // ── Send a follow-up message ─────────────────────────────────
    await textarea.fill('Add another step in the middle');
    await page.locator('#chat-send-btn').click();

    await expect(
        page.locator('.message.assistant .message-bubble').nth(2),
    ).toContainText('Updated diagram.', { timeout: 10_000 });
    await expect(page.locator('.diagram-wrapper svg')).toBeVisible({ timeout: 10_000 });

    // ── Assert no error messages appeared ────────────────────────
    const errorMessages = page.locator('.message.assistant .message-bubble').filter({ hasText: 'Error:' });
    await expect(errorMessages).toHaveCount(0);

    expect(requestCount).toBe(2);
});

test('follow-up message after fix sends strictly alternating history to the backend', async ({ page }) => {
    const chatPayloads: any[] = [];
    await mockEnhanceSkip(page);

    await page.route('**/api/chat', async (route) => {
        const body = route.request().postDataJSON();
        chatPayloads.push(body);
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                mermaid_code: 'flowchart TD\n    A[Start] --> B[End]',
                explanation: chatPayloads.length === 1 ? 'First diagram.' : 'Updated diagram.',
                follow_up_commands: [],
            }),
        });
    });

    await page.route('**/api/fix', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ mermaid_code: 'flowchart TD\n    A[Fixed] --> B[End]' }),
        }),
    );

    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    // ── First chat request ───────────────────────────────────────
    const textarea = page.locator('.chat-panel textarea');
    await textarea.fill('Draw a diagram');
    await page.locator('#chat-send-btn').click();

    await expect(
        page.locator('.message.assistant .message-bubble').nth(1),
    ).toContainText('First diagram.', { timeout: 10_000 });

    // ── Trigger a manual fix via the editor — injects system + assistant messages ──
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('invalid mermaid code');

    const fixBtn = page.locator('.fix-btn');
    await expect(fixBtn).toBeVisible({ timeout: 10_000 });
    await fixBtn.click();

    // Wait for the fixed diagram SVG and for loading to clear
    await expect(page.locator('.diagram-wrapper svg')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.thinking-badge')).not.toBeVisible({ timeout: 5_000 });

    // ── Send follow-up — this was what triggered the 500 ─────────
    await textarea.fill('Now add a third node');
    await page.locator('#chat-send-btn').click();

    await expect(
        page.locator('.message.assistant .message-bubble').last(),
    ).toContainText('Updated diagram.', { timeout: 10_000 });

    // ── No error messages ─────────────────────────────────────────
    const errorMessages = page.locator('.message.assistant .message-bubble').filter({ hasText: 'Error:' });
    await expect(errorMessages).toHaveCount(0);

    // ── Key assertion: history must strictly alternate user / assistant ──
    expect(chatPayloads.length).toBeGreaterThanOrEqual(2);
    const history: { role: string }[] = chatPayloads[chatPayloads.length - 1].history ?? [];
    for (let i = 1; i < history.length; i++) {
        expect(
            history[i].role,
            `History entry ${i} ("${history[i].role}") must not follow entry ${i - 1} ("${history[i - 1].role}")`
        ).not.toBe(history[i - 1].role);
    }
});
test('history sent to /api/fix always starts with a user message, never an assistant', async ({ page }) => {
    const fixPayloads: any[] = [];
    await mockEnhanceSkip(page);

    // First chat returns valid code so we get a proper conversation turn in history
    await page.route('**/api/chat', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                mermaid_code: 'flowchart TD\n    A[Start] --> B[End]',
                explanation: 'Here is your diagram.',
                follow_up_commands: [],
            }),
        }),
    );

    await page.route('**/api/fix', async (route) => {
        const body = route.request().postDataJSON();
        fixPayloads.push(body);
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ mermaid_code: 'flowchart TD\n    A[Fixed] --> B[End]' }),
        });
    });

    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    // ── Send a chat message to populate history ──────────────────
    const textarea = page.locator('.chat-panel textarea');
    await textarea.fill('Draw me a diagram');
    await page.locator('#chat-send-btn').click();

    await expect(
        page.locator('.message.assistant .message-bubble').nth(1),
    ).toContainText('Here is your diagram.', { timeout: 10_000 });

    // ── Corrupt the editor to trigger the Fix with AI button ─────
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('not valid mermaid at all ###');

    const fixBtn = page.locator('.fix-btn');
    await expect(fixBtn).toBeVisible({ timeout: 10_000 });
    await fixBtn.click();

    await expect(page.locator('.thinking-badge')).not.toBeVisible({ timeout: 10_000 });
    expect(fixPayloads.length).toBeGreaterThanOrEqual(1);

    // ── Key assertion: history must start with "user", never "assistant" ──
    for (const payload of fixPayloads) {
        const history: { role: string }[] = payload.history ?? [];
        if (history.length > 0) {
            expect(
                history[0].role,
                'History sent to /api/fix must start with a user message — the assistant greeting must be excluded',
            ).toBe('user');
        }
        for (let i = 1; i < history.length; i++) {
            expect(
                history[i].role,
                `Fix history entry ${i} ("${history[i].role}") must not follow entry ${i - 1} ("${history[i - 1].role}")`,
            ).not.toBe(history[i - 1].role);
        }
    }
});


// ── Mode dropdown and chart type tests ──────────────────────────

test('mode dropdown defaults to Auto and chart type dropdown is visible', async ({ page }) => {
    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    const modeSelect = page.locator('#mode-select');
    await expect(modeSelect).toBeVisible();
    await expect(modeSelect).toHaveValue('auto');

    const chartSelect = page.locator('#chart-select');
    await expect(chartSelect).toBeVisible();
    await expect(chartSelect).toHaveValue('');
});

test('chart type dropdown hides when Enhance Graph mode is selected', async ({ page }) => {
    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    // Chart type visible in auto mode
    await expect(page.locator('#chart-select')).toBeVisible();

    // Switch to enhance mode
    await svelteSelect(page, '#mode-select', 'enhance');
    await expect(page.locator('#chart-select')).not.toBeVisible();

    // Switch back to generate mode — chart type should reappear
    await svelteSelect(page, '#mode-select', 'generate');
    await expect(page.locator('#chart-select')).toBeVisible();
});

test('Generate Code mode sends mode and chart_type to backend', async ({ page }) => {
    const chatPayloads: any[] = [];

    await page.route('**/api/chat', async (route) => {
        const body = route.request().postDataJSON();
        chatPayloads.push(body);
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                mermaid_code: 'sequenceDiagram\n    A->>B: Hello',
                explanation: 'A sequence diagram.',
                follow_up_commands: [],
            }),
        });
    });

    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    // Switch to Generate Code mode and select a chart type
    await svelteSelect(page, '#mode-select', 'generate');
    await svelteSelect(page, '#chart-select', 'sequenceDiagram');

    const textarea = page.locator('.chat-panel textarea');
    await textarea.fill('Draw a sequence diagram');
    await page.locator('#chat-send-btn').click();

    await expect(
        page.locator('.message.assistant .message-bubble').nth(1),
    ).toContainText('A sequence diagram.', { timeout: 10_000 });

    // Verify mode and chart_type were sent
    expect(chatPayloads.length).toBe(1);
    expect(chatPayloads[0].mode).toBe('generate');
    expect(chatPayloads[0].chart_type).toBe('sequenceDiagram');
});

test('Generate Code mode does not call /api/enhance', async ({ page }) => {
    let enhanceRequests = 0;

    await page.route('**/api/chat', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                mermaid_code: 'flowchart TD\n    A --> B',
                explanation: 'Done.',
                follow_up_commands: [],
            }),
        }),
    );
    await page.route('**/api/enhance', (route) => {
        enhanceRequests++;
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ enhanced_image: null, explanation: '' }),
        });
    });

    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    await svelteSelect(page, '#mode-select', 'generate');

    const textarea = page.locator('.chat-panel textarea');
    await textarea.fill('Draw a flowchart');
    await page.locator('#chat-send-btn').click();

    await expect(
        page.locator('.message.assistant .message-bubble').nth(1),
    ).toContainText('Done.', { timeout: 10_000 });

    // Wait a bit to ensure no enhance call fires
    await page.waitForTimeout(2000);
    expect(enhanceRequests).toBe(0);
});


// ── Preview tabs tests ──────────────────────────────────────────

test('preview panel shows Mermaid and Enhanced tabs', async ({ page }) => {
    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    const mermaidTab = page.locator('.preview-tab').filter({ hasText: 'Mermaid' });
    const enhancedTab = page.locator('.preview-tab').filter({ hasText: 'Enhanced' });

    await expect(mermaidTab).toBeVisible();
    await expect(enhancedTab).toBeVisible();
    await expect(mermaidTab).toHaveClass(/active/);
});

test('Enhanced tab shows placeholder when no enhanced image exists', async ({ page }) => {
    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    // Click the Enhanced tab
    await page.locator('.preview-tab').filter({ hasText: 'Enhanced' }).click();

    await expect(page.locator('.enhance-placeholder')).toBeVisible();
    await expect(page.locator('.enhance-placeholder')).toContainText('No enhanced image yet');
});

test('Enhance button shows popover with input and Go button', async ({ page }) => {
    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    const enhanceBtn = page.locator('.enhance-btn');
    await expect(enhanceBtn).toBeVisible();
    await enhanceBtn.click();

    await expect(page.locator('.enhance-popover')).toBeVisible();
    await expect(page.locator('.enhance-popover input')).toBeVisible();
    await expect(page.locator('.enhance-popover-go')).toBeVisible();
});


// ── Auto mode enhance flow ──────────────────────────────────────

test('Auto mode calls /api/enhance after chat and shows Enhanced tab when image returned', async ({ page }) => {
    let enhanceRequests = 0;

    await page.route('**/api/chat', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                mermaid_code: 'flowchart TD\n    A[Hello] --> B[World]',
                explanation: 'Here is a flowchart.',
                follow_up_commands: [],
            }),
        }),
    );
    await page.route('**/api/enhance', (route) => {
        enhanceRequests++;
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                enhanced_image: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
                explanation: 'Enhanced the diagram.',
            }),
        });
    });

    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    const textarea = page.locator('.chat-panel textarea');
    await textarea.fill('Draw a flowchart');
    await page.locator('#chat-send-btn').click();

    // Wait for the Enhanced tab to become active
    const enhancedTab = page.locator('.preview-tab').filter({ hasText: 'Enhanced' });
    await expect(enhancedTab).toHaveClass(/active/, { timeout: 15_000 });

    // Verify the enhanced image is shown
    await expect(page.locator('.enhanced-wrapper img')).toBeVisible({ timeout: 5_000 });

    expect(enhanceRequests).toBeGreaterThanOrEqual(1);
});

test('Enhance Graph mode skips chat and calls enhance directly', async ({ page }) => {
    let chatRequests = 0;
    let enhanceRequests = 0;

    await page.route('**/api/chat', (route) => {
        chatRequests++;
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                mermaid_code: 'flowchart TD\n    A --> B',
                explanation: 'Done.',
                follow_up_commands: [],
            }),
        });
    });
    await page.route('**/api/enhance', (route) => {
        enhanceRequests++;
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                enhanced_image: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
                explanation: 'Enhanced.',
            }),
        });
    });

    await blockExternalRequests(page);
    await page.goto('/');
    await waitForHydration(page);

    // First generate a diagram in "generate" mode (no enhance) so getDiagramImage() has content
    await svelteSelect(page, '#mode-select', 'generate');
    const textarea = page.locator('.chat-panel textarea');
    await textarea.fill('Draw a flowchart');
    await page.locator('#chat-send-btn').click();
    await expect(
        page.locator('.message.assistant .message-bubble').nth(1),
    ).toContainText('Done.', { timeout: 10_000 });
    await expect(page.locator('.diagram-wrapper svg')).toBeVisible({ timeout: 10_000 });

    // Reset counters — the chat call above was expected
    chatRequests = 0;
    enhanceRequests = 0;

    // Switch to Enhance Graph mode and send an enhance-only request
    await svelteSelect(page, '#mode-select', 'enhance');
    await textarea.fill('Make it look better');
    await page.locator('#chat-send-btn').click();

    // Wait for the Enhanced tab to become active
    const enhancedTab = page.locator('.preview-tab').filter({ hasText: 'Enhanced' });
    await expect(enhancedTab).toHaveClass(/active/, { timeout: 15_000 });

    // Enhance mode should NOT call /api/chat for the second request
    expect(chatRequests).toBe(0);
    expect(enhanceRequests).toBeGreaterThanOrEqual(1);
});

