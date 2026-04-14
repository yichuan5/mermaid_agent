export interface Message {
    role: "user" | "assistant" | "system";
    content: string;
    imageUrl?: string;
    followUpSuggestions?: string[];
    isStreaming?: boolean;
}
