export function setToken(token: string) {
  if (token) sessionStorage.setItem("cdm-token", token);
  else sessionStorage.removeItem("cdm-token");
}
function headers(body?: unknown): Record<string, string> {
  const token = sessionStorage.getItem("cdm-token");
  return {
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
export async function download(path: string, filename: string) {
  const response = await fetch(`/api${path}`, {
    headers: headers(),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const e = await response
      .json()
      .catch(() => ({ error: "No se pudo descargar el archivo." }));
    throw new Error(e.error);
  }
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: headers(body),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error(
      "No se pudo conectar con la API. Comprueba que el backend esté encendido.",
    );
  }
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/login")) {
      setToken("");
      window.dispatchEvent(new Event("cdm-session-expired"));
    }
    const error = await response
      .json()
      .catch(() => ({ error: "Respuesta inválida del servidor" }));
    throw new Error(error.error || `Error ${response.status}`);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
