import { requireApiAuth } from "../../../lib/apiAuth";
import { applyCors } from "../../../lib/apiCors";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const user = await requireApiAuth(req, res);
  if (!user) return;

  try {
    const { endpoint, bearerToken } = req.body || {};

    if (!endpoint) {
      return res.status(400).json({ error: "Missing alert source endpoint" });
    }

    const response = await fetch(endpoint, {
      method: "GET",
      headers: bearerToken
        ? {
            Authorization: `Bearer ${bearerToken}`,
          }
        : {},
    });

    if (!response.ok) {
      const failText = await response.text();
      return res
        .status(400)
        .json({ error: failText || `Source API failed (${response.status})` });
    }

    const payload = await response.json();
    return res.status(200).json({ payload });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Unable to pull alerts from source API",
    });
  }
}
