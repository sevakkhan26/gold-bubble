/** API token for mutating endpoints (X-API-Token), kept in localStorage. */

const KEY = "gb-api-token";

export function getApiToken(): string {
  try {
    return localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}

export function setApiToken(token: string): void {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable — the token just won't persist */
  }
}
