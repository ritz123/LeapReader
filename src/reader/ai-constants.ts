/** Shared AI constants — single source of truth for model key and default (F-13). */

export const AI_MODEL_KEY = "leapReaderActiveModel";
export const DEFAULT_MODEL = "llama3.2:3b";

export const OLLAMA_URL_KEY = "leapReaderOllamaUrl";
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

export function getOllamaUrl(): string {
  try {
    return localStorage.getItem(OLLAMA_URL_KEY) ?? DEFAULT_OLLAMA_URL;
  } catch {
    return DEFAULT_OLLAMA_URL;
  }
}

export function setOllamaUrl(url: string): void {
  try {
    localStorage.setItem(OLLAMA_URL_KEY, url);
  } catch { /* ignore quota errors */ }
}

export function getActiveModel(): string {
  try {
    return localStorage.getItem(AI_MODEL_KEY) ?? DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

export function setActiveModel(name: string): void {
  try {
    localStorage.setItem(AI_MODEL_KEY, name);
  } catch {
    /* ignore quota errors */
  }
}
