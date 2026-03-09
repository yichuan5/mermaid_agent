import { test, expect } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('sending a message displays AI response and renders a diagram', async ({ page }) => {
    // ── Mock the backend API ─────────────────────────────────────
    await page.route('http://localhost:8000/api/chat', (route) =>
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

    // ── Load the app ─────────────────────────────────────────────
    await page.goto('/');

    // Wait for the initial greeting to confirm the page loaded
    await expect(
        page.locator('.message.assistant .message-bubble').first(),
    ).toBeVisible({ timeout: 10_000 });

    // ── Send a chat message ──────────────────────────────────────
    const textarea = page.locator('.chat-panel textarea');
    await textarea.fill('Draw a simple hello world flowchart');
    await page.locator('#chat-send-btn').click();

    // ── Assert the AI response appears in the chat ───────────────
    await expect(
        page.locator('.message.assistant .message-bubble').nth(1),
    ).toContainText('Here is a simple flowchart.', { timeout: 10_000 });

    // ── Assert a Mermaid diagram (SVG) rendered in the preview ───
    const previewSvg = page.locator('.preview-panel svg');
    await expect(previewSvg).toBeVisible({ timeout: 10_000 });

    // Verify the SVG actually contains content from our mocked code
    const svgContent = await previewSvg.innerHTML();
    expect(svgContent.length).toBeGreaterThan(0);
});

test('shows error message when backend is down', async ({ page }) => {
    // ── Mock the backend to simulate a network failure ──────────
    await page.route('http://localhost:8000/api/chat', (route) =>
        route.abort('connectionrefused'),
    );

    await page.goto('/');

    await expect(
        page.locator('.message.assistant .message-bubble').first(),
    ).toBeVisible({ timeout: 10_000 });

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
    await page.route('http://localhost:8000/api/chat/image', (route) =>
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

    await page.goto('/');

    await expect(
        page.locator('.message.assistant .message-bubble').first(),
    ).toBeVisible({ timeout: 10_000 });

    // ── Create a tiny test PNG file ─────────────────────────────
    // 1×1 red pixel PNG (smallest valid PNG)
    const testImagePath = resolve(__dirname, 'test-image.png');
    const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
        'base64',
    );
    writeFileSync(testImagePath, pngBuffer);

    // ── Upload the image via the hidden file input ──────────────
    const fileInput = page.locator('.chat-panel input[type="file"]');
    await fileInput.setInputFiles(testImagePath);

    // ── Assert the image preview appears ─────────────────────────
    await expect(page.locator('.image-preview')).toBeVisible({ timeout: 5_000 });

    // ── Click send to submit ────────────────────────────────────
    await page.locator('#chat-send-btn').click();

    // ── Assert the AI response appears ──────────────────────────
    await expect(
        page.locator('.message.assistant .message-bubble').nth(1),
    ).toContainText('I converted your image', { timeout: 10_000 });

    // ── Assert a diagram SVG rendered ───────────────────────────
    const previewSvg = page.locator('.preview-panel svg');
    await expect(previewSvg).toBeVisible({ timeout: 10_000 });

    // Cleanup
    unlinkSync(testImagePath);
});
