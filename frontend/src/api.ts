export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  } catch { throw new Error('No se pudo conectar con la API. Comprueba que el backend esté encendido.'); }
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Respuesta inválida del servidor' }));
    throw new Error(error.error || `Error ${response.status}`);
  }
  return response.status === 204 ? undefined as T : response.json();
}
