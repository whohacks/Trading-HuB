import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;

const supabaseAnonKey =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables (SUPABASE_URL and SUPABASE_ANON_KEY).",
  );
}

const authClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

function getBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
}

function createUserScopedClient(token) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
}

export async function requireApiAuth(req, res) {
  const token = getBearerToken(req);

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  const { data, error } = await authClient.auth.getUser(token);

  if (error || !data?.user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  return {
    user: data.user,
    token,
    supabase: createUserScopedClient(token),
  };
}
