export interface ChatResponse {
    mermaid_code: string | null;
    explanation: string;
    follow_up_commands: string[];
}

export interface ChatPayload {
    message: string;
    current_mermaid_code: string | null;
    current_image: string | null;
    history: { role: string; content: string }[];
    mode?: string;
    chart_type?: string | null;
}

export async function sendChat(payload: ChatPayload): Promise<ChatResponse> {
    const res = await fetch(`/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `Server error ${res.status}`);
    }
    return res.json();
}

export interface FixPayload {
    broken_code: string;
    error: string;
    history: { role: string; content: string }[];
    fix_attempts?: { code: string; error: string }[];
}

export interface FixResponse {
    mermaid_code: string;
}

export async function sendFix(payload: FixPayload): Promise<FixResponse> {
    const res = await fetch(`/api/fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `Server error ${res.status}`);
    }
    return res.json();
}

export async function sendImage(file: File, message: string): Promise<ChatResponse> {
    const formData = new FormData();
    formData.append("image", file);
    formData.append("message", message);

    const res = await fetch(`/api/chat/image`, {
        method: "POST",
        body: formData,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `Server error ${res.status}`);
    }
    return res.json();
}

export interface EnhancePayload {
    image: string;
    message?: string;
    instructions?: string | null;
}

export interface EnhanceResponse {
    enhanced_image: string | null;
    explanation: string;
}

export async function sendEnhance(payload: EnhancePayload): Promise<EnhanceResponse> {
    const res = await fetch(`/api/enhance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `Server error ${res.status}`);
    }
    return res.json();
}
