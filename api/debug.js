// Debug endpoint — logs exactly what GHL sends
// Remove this file after debugging is done

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  console.log("=== GHL WEBHOOK PAYLOAD ===");
  console.log(JSON.stringify(req.body, null, 2));
  console.log("=== END PAYLOAD ===");

  return res.status(200).json({
    received: true,
    fields_received: Object.keys(req.body),
    full_payload: req.body
  });
};
