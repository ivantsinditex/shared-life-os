import type { AppConfig } from "../../config/config.js";

export type VoiceTranscriptionInput = {
  audio: ArrayBuffer;
  filename: string;
  mimeType: string;
};

export interface VoiceTranscriptionGateway {
  isEnabled(): boolean;
  transcribe(input: VoiceTranscriptionInput): Promise<string>;
}

export function createVoiceTranscriptionGateway(config: AppConfig): VoiceTranscriptionGateway {
  if (!config.openAiApiKey) {
    return new DisabledVoiceTranscriptionGateway();
  }

  return new OpenAiVoiceTranscriptionGateway({
    apiKey: config.openAiApiKey,
    model: config.openAiTranscriptionModel,
  });
}

class DisabledVoiceTranscriptionGateway implements VoiceTranscriptionGateway {
  isEnabled(): boolean {
    return false;
  }

  async transcribe(): Promise<string> {
    throw new Error("Voice transcription is disabled. Set OPENAI_API_KEY to enable it.");
  }
}

class OpenAiVoiceTranscriptionGateway implements VoiceTranscriptionGateway {
  constructor(private readonly config: { apiKey: string; model: string }) {}

  isEnabled(): boolean {
    return true;
  }

  async transcribe(input: VoiceTranscriptionInput): Promise<string> {
    const form = new FormData();
    form.set("model", this.config.model);
    form.set("file", new Blob([input.audio], { type: input.mimeType }), input.filename);

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: form,
    });

    const payload = (await response.json()) as OpenAiTranscriptionResponse;

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `OpenAI transcription failed: ${response.status}`);
    }

    if (!payload.text) {
      throw new Error("OpenAI transcription response did not include text.");
    }

    return payload.text.trim();
  }
}

type OpenAiTranscriptionResponse = {
  text?: string;
  error?: {
    message?: string;
  };
};
