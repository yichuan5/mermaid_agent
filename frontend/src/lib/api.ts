export interface ChatResponse {
    mermaid_code: string | null;
    explanation: string;
    follow_up_commands: string[];
}

export interface ChatPayload {
    message: string;
    current_diagram: string | null;
    current_diagram_image: string | null;
    history: { role: string; content: string }[];
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
