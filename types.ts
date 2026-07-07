
export type Speaker = 'VYNO' | 'User' | 'System' | 'THULU';

export interface ChatMessage {
    speaker: Speaker;
    text: string;
}

export type EmotionalMode = 'Professional' | 'Enthusiastic' | 'Cautious' | 'Zen' | 'Thulu';
