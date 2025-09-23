const API = import.meta.env.VITE_API_BASE;

if (!API) {
  console.warn("VITE_API_BASE is not set");
}

export async function fetchProducts(url: string) {
  if (!API) {
    throw new Error("VITE_API_BASE not set");
  }
  
  const params = new URLSearchParams({ url });
  const response = await fetch(`${API}/products?${params.toString()}`, {
    method: "GET"
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  
  return response.json();
}