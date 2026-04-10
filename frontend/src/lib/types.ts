export interface Message {
    role: "user" | "assistant" | "system";
    content: string;
    imageUrl?: string;
    followUpSuggestions?: string[];
    _fixNotice?: boolean;
}
