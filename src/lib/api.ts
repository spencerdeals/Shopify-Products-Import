const API = import.meta.env.VITE_API_BASE;
if (!API) console.warn('VITE_API_BASE is not set');

export async function fetchProducts(url: string) {
  if (!API) throw new Error('VITE_API_BASE not set');
  const q = new URLSearchParams({ url });
  const r = await fetch(`${API}/products?${q.toString()}`);
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}
