function normalizeBaseUrl(value) {
  const base = String(value || "").trim();
  if (!base) return "";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

export function apiUrl(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const base = normalizeBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL);
  return base ? `${base}${normalizedPath}` : normalizedPath;
}
